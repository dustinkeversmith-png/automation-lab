export type AutomationCapability =
  | "launch"
  | "attach"
  | "navigate"
  | "openResource"
  | "playback"
  | "dom"
  | "uia"
  | "close";

export type AppKind = "adb-browser" | "vlc" | "thorium";

export type SessionState =
  | "idle"
  | "launching"
  | "running"
  | "connecting"
  | "ready"
  | "error"
  | "closed";

export type LaunchOptions = {
  exePath: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  meta?: Record<string, unknown>;
};



export type CommandRequest = {
  type: string;
  payload?: unknown;
};



export type SessionSnapshot = {
  sessionId: string;
  appKind: AppKind;
  pid?: number;
  state: SessionState;
  capabilities: AutomationCapability[];
  endpoint?: string;
  meta?: Record<string, unknown>;
};

export interface AppAdapter {
  readonly appKind: AppKind;
  readonly capabilities: AutomationCapability[];

  launch(options: LaunchOptions): Promise<SessionSnapshot>;
  connect(sessionId: string): Promise<SessionSnapshot>;
  send(sessionId: string, command: CommandRequest): Promise<unknown>;
  getState(sessionId: string): Promise<SessionSnapshot>;
  close(sessionId: string): Promise<void>;
}

export type RetryOptions = {
  attempts: number;
  delayMs: number;
};