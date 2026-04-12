import { WebSocket } from "ws";
import { CdpWebFrameExtension, type CdpEventMessage } from "./CdpWebFrameExtension";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type CdpResponseMessage = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  sessionId?: string;
  method?: string;
  params?: any;
};

export class CdpClient {
  private ws: WebSocket | null = null;
  private idCounter = 0;
  private readonly pending = new Map<number, Pending>();
  private isConnected = false;

  readonly webFrames = new CdpWebFrameExtension(
    (method, params, sessionId) => this.send(method, params, sessionId)
  );

  async connect(webSocketDebuggerUrl: string): Promise<void> {
    if (this.ws) {
      this.cleanupSocket();
    }

    return await new Promise<void>((resolve, reject) => {
      let settled = false;

      const ws = new WebSocket(webSocketDebuggerUrl);
      this.ws = ws;
      this.isConnected = false;

      const failConnect = (error: Error) => {
        if (settled) return;
        settled = true;

        console.log("CDP connection failed:", error.message);
        this.cleanupSocket();
        reject(error);
      };

      const succeedConnect = () => {
        if (settled) return;
        settled = true;

        console.log("Connected to CDP");
        this.isConnected = true;
        resolve();
      };

      ws.on("open", () => {
        succeedConnect();
      });

      ws.on("error", (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        console.log("Error connecting to CDP:", error);

        if (!settled) {
          failConnect(error);
          return;
        }

        this.rejectAllPending(
          new Error(`CDP socket error: ${error.message || "Unknown socket error"}`)
        );
      });

      ws.on("close", (code, reason) => {
        const reasonText =
          typeof reason === "string"
            ? reason
            : reason?.toString?.() || "";

        console.log(`CDP socket closed. code=${code} reason=${reasonText}`);

        this.isConnected = false;

        if (!settled) {
          failConnect(
            new Error(
              `CDP socket closed before connection completed (code=${code}${
                reasonText ? `, reason=${reasonText}` : ""
              })`
            )
          );
          return;
        }

        this.rejectAllPending(
          new Error(
            `CDP socket closed (code=${code}${
              reasonText ? `, reason=${reasonText}` : ""
            })`
          )
        );

        if (this.ws === ws) {
          this.cleanupSocket(false);
        }
      });

      ws.on("message", (raw) => {
        const text = raw.toString();

        let msg: CdpResponseMessage;
        try {
          msg = JSON.parse(text) as CdpResponseMessage;
        } catch {
          return;
        }

        if (typeof msg.id === "number") {
          const pending = this.pending.get(msg.id);
          if (!pending) {
            console.log(`No pending CDP command found for id ${msg.id}`);
            return;
          }

          this.pending.delete(msg.id);

          if (msg.error) {
            const message = msg.error.message ?? "Unknown CDP error";
            console.log(`CDP command with id ${msg.id} failed:`, message);
            pending.reject(new Error(message));
            return;
          }

          const resultPreview =
            msg.result && typeof msg.result === "object"
              ? JSON.stringify(msg.result).slice(0, 100)
              : String(msg.result);

          console.log(`CDP command with id ${msg.id} succeeded:`, resultPreview);
          pending.resolve(msg.result);
          return;
        }

        this.webFrames.handleEventMessage(msg as CdpEventMessage).catch((error) => {
          console.log("CdpWebFrameExtension event handling failed:", error);
        });
      });
    });
  }

  async send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown> {
    if (!this.ws || !this.isConnected || this.ws.readyState !== WebSocket.OPEN) {
      console.log("CDP not connected");
      throw new Error("CDP not connected");
    }

    const id = ++this.idCounter;
    const payload: Record<string, unknown> = { id, method };

    if (params !== undefined) {
      payload.params = params;
    }

    if (sessionId) {
      payload.sessionId = sessionId;
    }

    return await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      try {
        this.ws!.send(JSON.stringify(payload), (err?: Error) => {
          if (err) {
            console.log(`Failed to send CDP command ${id}:`, err);

            const pending = this.pending.get(id);
            if (pending) {
              this.pending.delete(id);
              pending.reject(
                new Error(`Failed to send CDP command: ${err.message}`)
              );
            }
          }
        });
      } catch (err) {
        this.pending.delete(id);
        reject(
          err instanceof Error
            ? err
            : new Error("Unknown error while sending CDP command")
        );
      }
    });
  }

  async disconnect(): Promise<void> {
    if (!this.ws) {
      this.isConnected = false;
      return;
    }

    const ws = this.ws;

    if (
      ws.readyState === WebSocket.CLOSING ||
      ws.readyState === WebSocket.CLOSED
    ) {
      this.rejectAllPending(new Error("CDP disconnected"));
      this.cleanupSocket(false);
      return;
    }

    await new Promise<void>((resolve) => {
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      ws.once("close", () => {
        finish();
      });

      try {
        ws.close();
      } catch {
        finish();
      }

      setTimeout(() => {
        if (
          ws.readyState !== WebSocket.CLOSED &&
          ws.readyState !== WebSocket.CLOSING
        ) {
          try {
            ws.terminate();
          } catch {
            // ignore terminate failure
          }
        }
        finish();
      }, 1000);
    });

    this.rejectAllPending(new Error("CDP disconnected"));
    this.cleanupSocket(false);
  }

  private rejectAllPending(error: Error): void {
    if (this.pending.size === 0) return;

    const entries = [...this.pending.entries()];
    this.pending.clear();

    for (const [id, pending] of entries) {
      console.log(`Rejecting pending CDP command ${id}: ${error.message}`);
      pending.reject(error);
    }
  }

  private cleanupSocket(clearPending: boolean = true): void {
    if (clearPending) {
      this.rejectAllPending(new Error("CDP connection reset"));
    }

    if (this.ws) {
      this.ws.removeAllListeners();
    }

    this.ws = null;
    this.isConnected = false;
    this.webFrames.reset();
  }
}