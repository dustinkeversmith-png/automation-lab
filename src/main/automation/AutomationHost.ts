import { SessionRegistry } from "./SessionRegistry";
import { VlcHttpAdapter } from "./adapters/VlcHttpAdapter";
import { AdbAdapter } from "./adapters/AdbAdapter";
import { ThoriumAdapter } from "./adapters/ThoriumAdapter";
import type { AppAdapter, AppKind, CommandRequest, LaunchOptions } from "./types";

export class AutomationHost {
  private readonly sessions = new SessionRegistry();
  private readonly adapters: Record<AppKind, AppAdapter>;

  constructor() {
    this.adapters = {
      "vlc": new VlcHttpAdapter(this.sessions),
      "adb-browser": new AdbAdapter(this.sessions, { attempts: 20, delayMs: 500}),
      "thorium": new ThoriumAdapter(this.sessions)
    };
  }

  async launch(appKind: AppKind, options: LaunchOptions) {
    return await this.adapters[appKind].launch(options);
  }

  async connect(appKind: AppKind, sessionId: string) {
    return await this.adapters[appKind].connect(sessionId);
  }

  async send(appKind: AppKind, sessionId: string, command: CommandRequest) {
    return await this.adapters[appKind].send(sessionId, command);
  }

  async close(appKind: AppKind, sessionId: string) {
    return await this.adapters[appKind].close(sessionId);
  }

  listSessions() {
    return this.sessions.list();
  }
}