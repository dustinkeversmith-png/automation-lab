import { SessionRegistry } from "../SessionRegistry";
import { ProcessManager, type ManagedProcess } from "../ProcessManager";
import type {
  AppAdapter,
  AppKind,
  AutomationCapability,
  CommandRequest,
  LaunchOptions,
  SessionSnapshot
} from "../types";

export abstract class BaseAdapter implements AppAdapter {
  abstract readonly appKind: AppKind;
  abstract readonly capabilities: AutomationCapability[];

  protected readonly sessions: SessionRegistry;
  protected readonly processManager = new ProcessManager();
  protected readonly processes = new Map<string, ManagedProcess>();

  constructor(sessions: SessionRegistry) {
    this.sessions = sessions;
  }

  async launch(options: LaunchOptions): Promise<SessionSnapshot> {
    const created = this.sessions.create({
      appKind: this.appKind,
      state: "launching",
      capabilities: [...this.capabilities],
      meta: options.meta ?? {}
    });

    console.log(`Launching ${this.appKind} with PID ${created.pid}`);

    const proc = this.processManager.launch(options);
    this.processes.set(created.sessionId, proc);

    return this.sessions.update(created.sessionId, {
      pid: proc.pid,
      state: "running",
      meta: {
        ...(created.meta ?? {}),
        exePath: options.exePath
      }
    });
  }

  abstract connect(sessionId: string): Promise<SessionSnapshot>;
  abstract send(sessionId: string, command: CommandRequest): Promise<unknown>;

  async getState(sessionId: string): Promise<SessionSnapshot> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return state;
  }

  async close(sessionId: string): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (proc) {
      await this.processManager.terminate(proc);
      this.processes.delete(sessionId);
    }

    this.sessions.update(sessionId, { state: "closed" });
  }
}