import { BaseAdapter } from "./BaseAdapter";
import { CdpClient } from "../transports/CdpClient";
import type { CommandRequest, SessionSnapshot } from "../types";
import { SessionRegistry } from "../SessionRegistry";
import { AutomationCapability, RetryOptions } from "../types";

type CdpTarget = {
  id?: string;
  title?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

function isRealPageTarget(target: CdpTarget): boolean {
  if (!target.webSocketDebuggerUrl) return false;

  // Best match: real web pages
  if (target.type === "page" && /^https?:\/\//i.test(target.url ?? "")) {
    return true;
  }

  // Accept browser pages like new tab only if no better target exists
  if (target.type === "page") {
    return true;
  }

  return false;
}

function chooseBestTarget(targets: CdpTarget[]): CdpTarget {
  const httpPage = targets.find(
    (t) => t.type === "page" && /^https?:\/\//i.test(t.url ?? "")
  );
  if (httpPage) return httpPage;

  const anyPage = targets.find((t) => t.type === "page");
  if (anyPage) return anyPage;

  throw new Error(
    `No usable CDP page target found. Targets were: ${JSON.stringify(
      targets.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        url: t.url,
      })),
      null,
      2
    )}`
  );
}


export class ChromiumDebugAdapter extends BaseAdapter {
  readonly appKind = "adb-browser" as const;
  readonly capabilities = [ "launch" as AutomationCapability, "attach" as AutomationCapability, "navigate" as AutomationCapability, "dom" as AutomationCapability, "close" as AutomationCapability];

  private readonly clients = new Map<string, CdpClient>();


  constructor(
    sessions: SessionRegistry,
    private readonly retryOptions: RetryOptions = { attempts: 20, delayMs: 500 }
  ) {
    super(sessions);
  }


  async connect(sessionId: string): Promise<SessionSnapshot> {
      const session = await this.getState(sessionId);


      
      const port = Number((session.meta as { debugPort?: number } | undefined)?.debugPort ?? 9222);

      console.log("Connecting to Chromium Debug Adapter on port", port);

      const targets = (await this.waitForJsonVersion(port)) as CdpTarget[];

        console.log(
      "Discovered CDP targets:",
      targets.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        url: t.url,
        hasWs: !!t.webSocketDebuggerUrl,
      }))
    );

    const target = chooseBestTarget(targets);

    console.log("Selected CDP target:", {
      id: target.id,
      type: target.type,
      title: target.title,
      url: target.url,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    });

    if (!target.webSocketDebuggerUrl) {
      throw new Error("Selected CDP target has no websocket debugger URL");
    }

    const client = new CdpClient();

      
      try {
        await client.connect(target.webSocketDebuggerUrl);

      } catch (error) {

        console.error("Failed to connect to CDP:", error);
        throw new Error("Failed to connect to CDP");
      }
      console.log("Connected to CDP, enabling domains...");

      // If the client has connected and has worked, then we can move forward.

      await client.send("Page.enable");
      await client.send("Runtime.enable");

      this.clients.set(sessionId, client);

      return this.sessions.update(sessionId, {
        state: "ready",
        endpoint: `http://127.0.0.1:${port}`,
        meta: {
          ...(session.meta ?? {}),
          mode: "cdp"
        }
      });
  }

  async send(sessionId: string, command: CommandRequest): Promise<unknown> {

    console.log("Received command for session", sessionId, command);

    const client = this.clients.get(sessionId);
    if (!client) {
      throw new Error("CDP client not connected");
    } else {
      console.log("Retrieved the client for the session", client);
    }

    switch (command.type) {
      case "navigate":
        return await client.send("Page.navigate", {
          url: String((command.payload as { url: string }).url)
        });

      case "eval":
        return await client.send("Runtime.evaluate", {
          expression: String((command.payload as { expression: string }).expression),
          returnByValue: true,
          awaitPromise: true
        });

      case "getTitle":
        return await client.send("Runtime.evaluate", {
          expression: "document.title",
          returnByValue: true
        });

      default:
        throw new Error(`Unsupported Chromium command: ${command.type}`);
    }
  }


  private async waitForJsonVersion(port: number): Promise<any> {
    let lastError: unknown;

    for (let i = 0; i < this.retryOptions.attempts; i++) {

      console.log(`Attempt ${i + 1} to fetch CDP version info from port ${port}...`);

      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        
        


        if (!response.ok) {

          console.log(response);

          throw new Error(`HTTP ${response.status}`);
        }else {
          console.log(`Received HTTP ${response.status} from CDP version endpoint`);
        }
          return await response.json();
        } catch (error) {

        //console.log(`Attempt ${i + 1} failed:`, error instanceof Error ? error.message : error);
        //console.log(error);

        lastError = error;
        if (i < this.retryOptions.attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, this.retryOptions.delayMs));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("CDP unavailable");
  }
}