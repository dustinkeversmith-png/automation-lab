import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
};

export class SidecarClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private idCounter = 0;
  private readonly pending = new Map<number, Pending>();
  private buffer = "";
  private startedExePath: string | null = null;
  private startedArgsKey: string | null = null;

start(exePath: string, args: string[] = []): void {
    const argsKey = JSON.stringify(args);

    if (this.child) {
      if (this.startedExePath === exePath && this.startedArgsKey === argsKey) {
        return;
      }
      throw new Error(
        `Sidecar already started with ${this.startedExePath ?? "unknown executable"} ${this.startedArgsKey ?? ""}`
      );
    }

    this.startedExePath = exePath;
    this.startedArgsKey = argsKey;
    this.child = spawn(exePath, args, { stdio: "pipe" });


    console.log(`Started sidecar process with PID ${this.child.pid} using executable "${exePath}" and args ${argsKey}`);

    this.child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      console.log("Received chunk from sidecar:", text);

      this.buffer += text;

      let index = this.buffer.indexOf("\n");
      while (index >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);

        if (line) {
          try {
            const msg = JSON.parse(line) as {
              id?: number;
              result?: unknown;
              error?: string;
            };

            console.log("Received message from sidecar:", msg);

            if (typeof msg.id === "number") {
              const pending = this.pending.get(msg.id);
              if (pending) {
                this.pending.delete(msg.id);
                if (pending.timeout) clearTimeout(pending.timeout);

                if (msg.error) pending.reject(new Error(msg.error));
                else pending.resolve(msg.result);
              }
            }
          } catch (error) {
            console.log(
              "Ignoring malformed JSON message from sidecar:",
              line,
              error
            );
          }
        }

        index = this.buffer.indexOf("\n");
      }
    });

    this.child.stderr.on("data", (chunk) => {
      console.log("Sidecar stderr:", chunk.toString());
    });

    this.child.on("error", (error) => {
      console.log("Sidecar process error:", error);
      this.rejectAllPending(
        new Error(`Sidecar process error: ${error.message}`)
      );
      this.child = null;
      this.startedExePath = null;
      this.startedArgsKey = null;
      this.buffer = "";
    });

    this.child.on("exit", (code, signal) => {
      console.log("Sidecar exited:", { code, signal });
      this.rejectAllPending(
        new Error(
          `Sidecar exited before replying (code=${code ?? "null"}, signal=${signal ?? "null"})`
        )
      );
      this.child = null;
      this.startedExePath = null;
      this.startedArgsKey = null;
      this.buffer = "";
    });

    this.child.on("close", (code, signal) => {
      console.log("Sidecar closed:", { code, signal });
    });
  }

  stop(): void {
    if (!this.child) return;

    this.child.kill();
    this.rejectAllPending(new Error("Sidecar stopped"));
    this.child = null;
    this.startedExePath = null;
    this.startedArgsKey = null;
    this.buffer = "";
  }

  async send(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<unknown> {
    if (!this.child) {
      throw new Error("Sidecar not started");
    }

    const id = ++this.idCounter;
    const payload =
      JSON.stringify({ id, method, Params: params ?? {} }) + "\n";

    return await new Promise((resolve, reject) => {
      const pending: Pending = { resolve, reject };

      if (options?.timeoutMs && options.timeoutMs > 0) {
        pending.timeout = setTimeout(() => {
          if (this.pending.delete(id)) {
            reject(
              new Error(
                `Sidecar request timed out for method "${method}" after ${options.timeoutMs}ms`
              )
            );
          }
        }, options.timeoutMs);
      }

      this.pending.set(id, pending);

      console.log("Sending message to sidecar:", payload);

      this.child!.stdin.write(payload, (error) => {
        if (error) {
          const current = this.pending.get(id);
          if (current?.timeout) clearTimeout(current.timeout);
          this.pending.delete(id);
          reject(new Error(`Failed to write to sidecar stdin: ${error.message}`));
        }
      });
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}