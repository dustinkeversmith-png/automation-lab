import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { LaunchOptions } from "./types";

export type ManagedProcess = {
  pid?: number;
  child: ChildProcessWithoutNullStreams;
};

export class ProcessManager extends EventEmitter {
  launch(options: LaunchOptions): ManagedProcess {
    const child = spawn(options.exePath, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: "pipe",
      windowsHide: false
    });

    console.log(`Spawned process with PID ${child.pid} for ${options.exePath}`);

    child.stdout.on("data", (chunk) => {
      this.emit("stdout", chunk.toString());
    });

    child.stderr.on("data", (chunk) => {
      this.emit("stderr", chunk.toString());
    });

    child.on("exit", (code, signal) => {
      this.emit("exit", { code, signal });
    });

    child.on("error", (error) => {
      this.emit("error", error);
    });

    return {
      pid: child.pid,
      child
    };
  }

  async terminate(proc: ManagedProcess): Promise<void> {
    if (!proc.child.killed) {
      proc.child.kill();
    }
  }
}