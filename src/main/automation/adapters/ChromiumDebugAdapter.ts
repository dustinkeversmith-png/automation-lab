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

type DomDescribeNodeResult = {
  node?: {
    nodeId?: number;
    frameId?: string;
    nodeName?: string;
    localName?: string;
    backendNodeId?: number;
  };
};

type DomGetDocumentResult = {
  root: {
    nodeId: number;
  };
};

type DomQuerySelectorResult = {
  nodeId: number;
};

type DomResolveNodeResult = {
  object?: {
    objectId?: string;
  };
};

type DomBoxModelResult = {
  model?: {
    content?: number[];
    border?: number[];
    padding?: number[];
    margin?: number[];
    width?: number;
    height?: number;
  };
};

type PageCreateIsolatedWorldResult = {
  executionContextId?: number;
};

type RuntimeEvaluateResult = {
  result?: {
    type?: string;
    value?: unknown;
    objectId?: string;
    description?: string;
  };
  exceptionDetails?: unknown;
};

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

  readonly capabilities = [
    "launch" as AutomationCapability,
    "attach" as AutomationCapability,
    "navigate" as AutomationCapability,
    "dom" as AutomationCapability,
    "close" as AutomationCapability
  ];

  private readonly clients = new Map<string, CdpClient>();

  constructor(
    sessions: SessionRegistry,
    private readonly retryOptions: RetryOptions = { attempts: 20, delayMs: 500 }
  ) {
    super(sessions);
  }

  async connect(sessionId: string): Promise<SessionSnapshot> {
    const session = await this.getState(sessionId);

    const port = Number(
      (session.meta as { debugPort?: number } | undefined)?.debugPort ?? 9222
    );

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

    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("DOM.enable");
    await client.send("CSS.enable");

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
    //console.log("Received command for session", sessionId, command);

    const client = this.clients.get(sessionId);
    if (!client) {
      throw new Error("CDP client not connected");
    }

    switch (command.type) {
      case "navigate":
        return await client.send("Page.navigate", {
          url: String((command.payload as { url: string }).url)
        });

      case "eval":
      case "evaluateRawRuntime":
        return await this.evaluateRawRuntime(
          client,
          String((command.payload as { expression: string }).expression),
          Boolean((command.payload as { returnByValue?: boolean }).returnByValue ?? true),
          Boolean((command.payload as { awaitPromise?: boolean }).awaitPromise ?? true)
        );

      case "getTitle":
        return await client.send("Runtime.evaluate", {
          expression: "document.title",
          returnByValue: true
        });

      case "querySelector":
        return await this.querySelector(
          client,
          String((command.payload as { selector: string }).selector)
        );

      case "clickElement":
        return await this.clickElement(
          client,
          String((command.payload as { selector: string }).selector)
        );

      case "inputValue":
        return await this.inputValue(
          client,
          String((command.payload as { selector: string }).selector),
          (command.payload as { value: string | number }).value
        );

      case "evaluateInFrame":
        return await this.evaluateInFrame(
          client,
          String((command.payload as any).iframeSelector),
          String((command.payload as any).expression)
        );
      case "waitForIframeReady":
        return await this.waitForIframeReady(
          client,
          String((command.payload as any).iframeSelector),
          {
            loadingSelector: String((command.payload as any).loadingSelector ?? "#embed-loading"),
            timeoutMs: Number((command.payload as any).timeoutMs ?? 15000),
            pollMs: Number((command.payload as any).pollMs ?? 300),
            requiredFrameSelector: (command.payload as any).requiredFrameSelector ?? null
          }
        );
      case "clickInFrame":
        return await this.clickInFrame(
          client,
          String((command.payload as any).iframeSelector),
          String((command.payload as any).selector)
        );

      case "inputInFrame":
        return await this.inputInFrame(
          client,
          String((command.payload as any).iframeSelector),
          String((command.payload as any).selector),
          (command.payload as any).value
        );

      case "getFrameForSelector":
        return await this.getFrameForSelector(
          client,
          String((command.payload as any).iframeSelector)
        );

      case "querySelectorInFrame":
        return await this.querySelectorInFrame(
          client,
          String((command.payload as any).iframeSelector),
          String((command.payload as any).selector)
        );

      case "querySelectorAllInFrame":
        return await this.querySelectorAllInFrame(
          client,
          String((command.payload as any).iframeSelector),
          String((command.payload as any).selector)
        );

      case "waitForSelectorInFrame":
        return await this.waitForSelectorInFrame(
          client,
          String((command.payload as any).iframeSelector),
          String((command.payload as any).selector),
          Number((command.payload as any).timeoutMs ?? 10000),
          Number((command.payload as any).pollMs ?? 250)
        );

      case "clickInFrameUsingCoordinates":
        return await this.clickInFrameUsingCoordinates(
          client,
          String((command.payload as any).iframeSelector),
          String((command.payload as any).selector)
        );

      default:
        throw new Error(`Unsupported Chromium command: ${command.type}`);
    }
  }

  private async querySelector(
    client: CdpClient,
    selector: string
  ): Promise<{
    ok: boolean;
    selector: string;
    nodeId: number | null;
    objectId: string | null;
  }> {
    const rootNodeId = await this.getRootNodeId(client);
    const queryResult = (await client.send("DOM.querySelector", {
      nodeId: rootNodeId,
      selector
    })) as DomQuerySelectorResult;

    const nodeId = queryResult?.nodeId ?? 0;
    if (!nodeId) {
      return {
        ok: false,
        selector,
        nodeId: null,
        objectId: null
      };
    }

    const objectId = await this.resolveNodeObjectId(client, nodeId);

    return {
      ok: true,
      selector,
      nodeId,
      objectId
    };
  }

  private async getFrameIdForIframe(
    client: CdpClient,
    iframeSelector: string
  ): Promise<string> {
    const rootNodeId = await this.getRootNodeId(client);

    const iframe = (await client.send("DOM.querySelector", {
      nodeId: rootNodeId,
      selector: iframeSelector
    })) as DomQuerySelectorResult;

    if (!iframe?.nodeId) {
      throw new Error(`Iframe not found for selector: ${iframeSelector}`);
    }

    const described = (await client.send("DOM.describeNode", {
      nodeId: iframe.nodeId,
      depth: 0
    })) as DomDescribeNodeResult;

    const frameId = described?.node?.frameId;
    if (!frameId) {
      throw new Error(`Failed to resolve frameId for iframe selector: ${iframeSelector}`);
    }

    return frameId;
  }

  private async getFrameForSelector(
    client: CdpClient,
    iframeSelector: string
  ): Promise<{
    ok: boolean;
    iframeSelector: string;
    frameId: string | null;
  }> {
    try {
      const frameId = await this.getFrameIdForIframe(client, iframeSelector);
      return {
        ok: true,
        iframeSelector,
        frameId
      };
    } catch {
      return {
        ok: false,
        iframeSelector,
        frameId: null
      };
    }
  }

  private async createFrameContext(
    client: CdpClient,
    frameId: string
  ): Promise<number> {


    const stillPresent = await this.canUseFrameInCurrentSession(client, frameId);
  if (!stillPresent) {
    throw new Error(`Frame ${frameId} is no longer present in the current CDP session; likely cross-origin/OOPIF`);
  }

    const world = (await client.send("Page.createIsolatedWorld", {
      frameId,
      worldName: "automation-lab",
      grantUniversalAccess: true
    })) as PageCreateIsolatedWorldResult;

    const contextId = world?.executionContextId;
    if (!contextId) {
      throw new Error(`Failed to create execution context for frame ${frameId}`);
    }

    return contextId;
  }

  private async evaluateInFrameContext(
    client: CdpClient,
    contextId: number,
    expression: string,
    returnByValue: boolean = true,
    awaitPromise: boolean = true
  ): Promise<RuntimeEvaluateResult> {
    return (await client.send("Runtime.evaluate", {
      contextId,
      expression,
      returnByValue,
      awaitPromise
    })) as RuntimeEvaluateResult;
  }

  private async evaluateInFrame(
    client: CdpClient,
    iframeSelector: string,
    expression: string
  ): Promise<RuntimeEvaluateResult> {
    const frameId = await this.getFrameIdForIframe(client, iframeSelector);
    const contextId = await this.createFrameContext(client, frameId);
    return await this.evaluateInFrameContext(client, contextId, expression, true, true);
  }

  private async clickInFrame(
    client: CdpClient,
    iframeSelector: string,
    selector: string
  ): Promise<RuntimeEvaluateResult> {
    const frameId = await this.getFrameIdForIframe(client, iframeSelector);
    const contextId = await this.createFrameContext(client, frameId);

    return await this.evaluateInFrameContext(
      client,
      contextId,
      `
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { ok: false, error: "not found" };
          el.click();
          return { ok: true };
        })()
      `,
      true,
      true
    );
  }

  private async inputInFrame(
    client: CdpClient,
    iframeSelector: string,
    selector: string,
    value: string | number
  ): Promise<RuntimeEvaluateResult> {
    const frameId = await this.getFrameIdForIframe(client, iframeSelector);
    const contextId = await this.createFrameContext(client, frameId);

    return await this.evaluateInFrameContext(
      client,
      contextId,
      `
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { ok: false, error: "not found" };

          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));

          return {
            ok: true,
            tag: el.tagName,
            value: el.value
          };
        })()
      `,
      true,
      true
    );
  }

  private async clickElement(
    client: CdpClient,
    selector: string
  ): Promise<{
    ok: boolean;
    selector: string;
    nodeId: number | null;
    clickedBy: "input" | "runtime-fallback" | null;
  }> {
    const found = await this.querySelector(client, selector);
    if (!found.ok || !found.nodeId) {
      return {
        ok: false,
        selector,
        nodeId: null,
        clickedBy: null
      };
    }

    try {
      const box = (await client.send("DOM.getBoxModel", {
        nodeId: found.nodeId
      })) as DomBoxModelResult;

      const quad = box?.model?.content;
      if (!quad || quad.length < 8) {
        throw new Error("No usable box model returned");
      }

      const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
      const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;

      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none"
      });

      await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1
      });

      await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1
      });

      return {
        ok: true,
        selector,
        nodeId: found.nodeId,
        clickedBy: "input"
      };
    } catch (error) {
      console.warn("DOM/Input click failed, falling back to Runtime click()", error);

      if (!found.objectId) {
        throw error;
      }

      await client.send("Runtime.callFunctionOn", {
        objectId: found.objectId,
        functionDeclaration: `
          function() {
            this.scrollIntoView?.({ block: "center", inline: "center" });
            this.click?.();
            return true;
          }
        `,
        returnByValue: true,
        awaitPromise: true
      });

      return {
        ok: true,
        selector,
        nodeId: found.nodeId,
        clickedBy: "runtime-fallback"
      };
    }
  }

  private async inputValue(
    client: CdpClient,
    selector: string,
    value: string | number
  ): Promise<{
    ok: boolean;
    selector: string;
    nodeId: number | null;
    value: string | number;
  }> {
    const found = await this.querySelector(client, selector);
    if (!found.ok || !found.nodeId || !found.objectId) {
      return {
        ok: false,
        selector,
        nodeId: null,
        value
      };
    }

    await client.send("Runtime.callFunctionOn", {
      objectId: found.objectId,
      functionDeclaration: `
        function(value) {
          this.scrollIntoView?.({ block: "center", inline: "center" });
          this.focus?.();

          this.value = value;

          this.dispatchEvent(new Event("input", { bubbles: true }));
          this.dispatchEvent(new Event("change", { bubbles: true }));

          return {
            tagName: this.tagName,
            type: this.type ?? null,
            value: this.value
          };
        }
      `,
      arguments: [{ value }],
      returnByValue: true,
      awaitPromise: true
    });

    return {
      ok: true,
      selector,
      nodeId: found.nodeId,
      value
    };
  }

  private async evaluateRawRuntime(
    client: CdpClient,
    expression: string,
    returnByValue: boolean = true,
    awaitPromise: boolean = true
  ): Promise<unknown> {
    return await client.send("Runtime.evaluate", {
      expression,
      returnByValue,
      awaitPromise
    });
  }

  private async getRootNodeId(client: CdpClient): Promise<number> {
    const documentResult = (await client.send("DOM.getDocument", {
      depth: 1,
      pierce: true
    })) as DomGetDocumentResult;

    const rootNodeId = documentResult?.root?.nodeId;
    if (!rootNodeId) {
      throw new Error("Failed to retrieve DOM root nodeId");
    }

    return rootNodeId;
  }

  private async resolveNodeObjectId(
    client: CdpClient,
    nodeId: number
  ): Promise<string | null> {
    const result = (await client.send("DOM.resolveNode", {
      nodeId
    })) as DomResolveNodeResult;

    return result?.object?.objectId ?? null;
  }

  private async getIframeHostState(
    client: CdpClient,
    iframeSelector: string,
    loadingSelector: string = "#embed-loading"
  ): Promise<{
    iframeFound: boolean;
    iframeSrc: string | null;
    iframeVisible: boolean;
    loadingFound: boolean;
    loadingVisible: boolean;
  }> {
    const result = await this.evaluateRawRuntime(
      client,
      `
        (() => {
          const iframe = document.querySelector(${JSON.stringify(iframeSelector)});
          const loading = document.querySelector(${JSON.stringify(loadingSelector)});

          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  style.opacity !== "0";
          };

          return {
            iframeFound: !!iframe,
            iframeSrc: iframe ? iframe.getAttribute("src") : null,
            iframeVisible: isVisible(iframe),
            loadingFound: !!loading,
            loadingVisible: isVisible(loading)
          };
        })()
      `,
      true,
      true
    ) as any;

    return result?.result?.value ?? result?.value ?? result;
  }

  private async getIframeDocumentState(
    client: CdpClient,
    iframeSelector: string
  ): Promise<{
    href: string;
    readyState: string;
    title: string;
    bodyTextSample: string;
    hasVideo: boolean;
    hasControls: boolean;
  }> {
    const frameId = await this.getFrameIdForIframe(client, iframeSelector);
    const contextId = await this.createFrameContext(client, frameId);

    const result = await this.evaluateInFrameContext(
      client,
      contextId,
      `
        (() => {
          const bodyText = document.body ? document.body.innerText : "";
          const hasVideo = !!document.querySelector("video");
          const hasControls = !!document.querySelector(
            "button, input, [role='button'], [class*='play'], [class*='pause'], [class*='control'], [class*='player']"
          );

          return {
            href: location.href,
            readyState: document.readyState,
            title: document.title,
            bodyTextSample: bodyText.slice(0, 500),
            hasVideo,
            hasControls
          };
        })()
      `,
      true,
      true
    );

    return (result?.result?.value ?? {}) as {
      href: string;
      readyState: string;
      title: string;
      bodyTextSample: string;
      hasVideo: boolean;
      hasControls: boolean;
    };
  }

  private async waitForIframeReady(
    client: CdpClient,
    iframeSelector: string,
    options?: {
      loadingSelector?: string;
      timeoutMs?: number;
      pollMs?: number;
      requiredFrameSelector?: string | null;
    }
  ): Promise<{
    ok: boolean;
    iframeSelector: string;
    elapsedMs: number;
    hostState: unknown;
    frameState: unknown;
  }> {
    const loadingSelector = options?.loadingSelector ?? "#embed-loading";
    const timeoutMs = options?.timeoutMs ?? 15000;
    const pollMs = options?.pollMs ?? 300;
    const requiredFrameSelector = options?.requiredFrameSelector ?? null;

    const started = Date.now();
    let lastHostState: unknown = null;
    let lastFrameState: unknown = null;

    while (Date.now() - started < timeoutMs) {
      try {
        const hostState = await this.getIframeHostState(client, iframeSelector, loadingSelector);
        lastHostState = hostState;

        const hostReady =
          hostState.iframeFound &&
          !!hostState.iframeSrc &&
          hostState.loadingVisible === false;

        if (!hostReady) {
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          continue;
        }

        const frameState = await this.getIframeDocumentState(client, iframeSelector);
        lastFrameState = frameState;

        const frameReady =
          (frameState.readyState === "interactive" || frameState.readyState === "complete");

        if (!frameReady) {
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          continue;
        }

        if (requiredFrameSelector) {
          const probe = await this.querySelectorInFrame(client, iframeSelector, requiredFrameSelector);
          if (!probe.found) {
            await new Promise((resolve) => setTimeout(resolve, pollMs));
            continue;
          }
        }

        return {
          ok: true,
          iframeSelector,
          elapsedMs: Date.now() - started,
          hostState,
          frameState
        };
      } catch (error) {
        lastFrameState = {
          error: error instanceof Error ? error.message : String(error)
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return {
      ok: false,
      iframeSelector,
      elapsedMs: Date.now() - started,
      hostState: lastHostState,
      frameState: lastFrameState
    };
  }

  private async querySelectorInFrame(
    client: CdpClient,
    iframeSelector: string,
    selector: string
  ): Promise<{
    ok: boolean;
    iframeSelector: string;
    selector: string;
    found: boolean;
    tagName: string | null;
    id: string | null;
    className: string | null;
    text: string | null;
  }> {
    const frameId = await this.getFrameIdForIframe(client, iframeSelector);

    console.log(`Resolved frameId ${frameId} for iframe selector ${iframeSelector}`);

    const contextId = await this.createFrameContext(client, frameId);

    console.log(`Created execution context ${contextId} for frameId ${frameId} (iframe selector: ${iframeSelector})`);

    // Here print out the elements of the frame to verify what aelements are there.
    const frameElements = await this.evaluateInFrameContext(
    client,
    contextId,
    `
      (() => {
        return Array.from(document.querySelectorAll("*"))
          .slice(0, 300)
          .map((el) => ({
            tagName: el.tagName ?? null,
            id: el.id ?? null,
            className: el.className ?? null,
            name: el.getAttribute("name"),
            type: el.getAttribute("type"),
            role: el.getAttribute("role"),
            ariaLabel: el.getAttribute("aria-label"),
            text: (el.textContent || "").trim().slice(0, 120)
          }));
      })()
    `,
    true,
    true
  );

  console.log("Iframe element inventory:", JSON.stringify(frameElements, null, 2));

    const result = await this.evaluateInFrameContext(
      client,
      contextId,
      `
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) {
            return {
              found: false,
              tagName: null,
              id: null,
              className: null,
              text: null
            };
          }

          return {
            found: true,
            tagName: el.tagName ?? null,
            id: el.id ?? null,
            className: el.className ?? null,
            text: el.textContent ?? null
          };
        })()
      `,
      true,
      true
    );

    const value = (result?.result?.value ?? {}) as any;

    return {
      ok: true,
      iframeSelector,
      selector,
      found: Boolean(value?.found),
      tagName: value?.tagName ?? null,
      id: value?.id ?? null,
      className: value?.className ?? null,
      text: value?.text ?? null
    };
  }

  private async canUseFrameInCurrentSession(
    client: CdpClient,
    frameId: string
  ): Promise<boolean> {
    try {
      const tree = await client.send("Page.getFrameTree");
      const json = JSON.stringify(tree);
      return json.includes(frameId);
    } catch {
      return false;
    }
  }

  private async querySelectorAllInFrame(
    client: CdpClient,
    iframeSelector: string,
    selector: string
  ): Promise<{
    ok: boolean;
    iframeSelector: string;
    selector: string;
    count: number;
    items: Array<{
      tagName: string | null;
      id: string | null;
      className: string | null;
      text: string | null;
    }>;
  }> {
    const frameId = await this.getFrameIdForIframe(client, iframeSelector);
    const contextId = await this.createFrameContext(client, frameId);

    const result = await this.evaluateInFrameContext(
      client,
      contextId,
      `
        (() => {
          const items = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((el) => ({
            tagName: el.tagName ?? null,
            id: el.id ?? null,
            className: el.className ?? null,
            text: el.textContent ?? null
          }));

          return {
            count: items.length,
            items
          };
        })()
      `,
      true,
      true
    );

    const value = (result?.result?.value ?? {}) as any;

    return {
      ok: true,
      iframeSelector,
      selector,
      count: Number(value?.count ?? 0),
      items: Array.isArray(value?.items) ? value.items : []
    };
  }

  private async waitForSelectorInFrame(
    client: CdpClient,
    iframeSelector: string,
    selector: string,
    timeoutMs: number = 10000,
    pollMs: number = 250
  ): Promise<{
    ok: boolean;
    iframeSelector: string;
    selector: string;
    found: boolean;
    elapsedMs: number;
  }> {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {

      

      const probe = await this.querySelectorInFrame(client, iframeSelector, selector);
      if (probe.found) {
        return {
          ok: true,
          iframeSelector,
          selector,
          found: true,
          elapsedMs: Date.now() - started
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return {
      ok: false,
      iframeSelector,
      selector,
      found: false,
      elapsedMs: Date.now() - started
    };
  }

  private async clickInFrameUsingCoordinates(
    client: CdpClient,
    iframeSelector: string,
    selector: string
  ): Promise<{
    ok: boolean;
    iframeSelector: string;
    selector: string;
    clicked: boolean;
    x: number | null;
    y: number | null;
  }> {
    const rootNodeId = await this.getRootNodeId(client);

    const iframeQuery = (await client.send("DOM.querySelector", {
      nodeId: rootNodeId,
      selector: iframeSelector
    })) as DomQuerySelectorResult;

    if (!iframeQuery?.nodeId) {
      return {
        ok: false,
        iframeSelector,
        selector,
        clicked: false,
        x: null,
        y: null
      };
    }

    const iframeBox = (await client.send("DOM.getBoxModel", {
      nodeId: iframeQuery.nodeId
    })) as DomBoxModelResult;

    const iframeQuad = iframeBox?.model?.content;
    if (!iframeQuad || iframeQuad.length < 8) {
      return {
        ok: false,
        iframeSelector,
        selector,
        clicked: false,
        x: null,
        y: null
      };
    }

    const iframeLeft = Math.min(iframeQuad[0], iframeQuad[2], iframeQuad[4], iframeQuad[6]);
    const iframeTop = Math.min(iframeQuad[1], iframeQuad[3], iframeQuad[5], iframeQuad[7]);

    const frameId = await this.getFrameIdForIframe(client, iframeSelector);
    const contextId = await this.createFrameContext(client, frameId);

    const localPointResult = await this.evaluateInFrameContext(
      client,
      contextId,
      `
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;

          const rect = el.getBoundingClientRect();
          if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
            return null;
          }

          return {
            x: rect.left + (rect.width / 2),
            y: rect.top + (rect.height / 2)
          };
        })()
      `,
      true,
      true
    );

    const point = localPointResult?.result?.value as any;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return {
        ok: false,
        iframeSelector,
        selector,
        clicked: false,
        x: null,
        y: null
      };
    }

    const x = iframeLeft + Number(point.x);
    const y = iframeTop + Number(point.y);

    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none"
    });

    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1
    });

    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1
    });

    return {
      ok: true,
      iframeSelector,
      selector,
      clicked: true,
      x,
      y
    };
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
        } else {
          //console.log(`Received HTTP ${response.status} from CDP version endpoint`);
        }

        return await response.json();
      } catch (error) {
        lastError = error;
        if (i < this.retryOptions.attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, this.retryOptions.delayMs));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("CDP unavailable");
  }
}