# Automation Lab Starter Repo

A starter scaffold for an Electron-based automation harness with:

- Electron + Vite + React renderer
- Electron main-process automation host
- Adapter architecture for VLC / AdBlockBrowser / Thorium
- C# sidecar transport for Windows UI Automation
- Vitest test scaffolding

---

## 1) Suggested repo structure

```txt
automation-lab/
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  electron.vite.config.ts
  .env.example
  src/
    main/
      main.ts
      ipc.ts
      automation/
        types.ts
        SessionRegistry.ts
        ProcessManager.ts
        AutomationHost.ts
        adapters/
          BaseAdapter.ts
          VlcHttpAdapter.ts
          ChromiumDebugAdapter.ts
          AdbAdapter.ts
          ThoriumAdapter.ts
        transports/
          HttpJsonClient.ts
          CdpClient.ts
          SidecarClient.ts
    preload/
      index.ts
      global.d.ts
    renderer/
      index.html
      main.tsx
      App.tsx
      styles.css
  sidecar/
    AutomationSidecar/
      AutomationSidecar.csproj
      Program.cs
      Models/
        CommandEnvelope.cs
        ResponseEnvelope.cs
      Services/
        UiAutomationService.cs
  tests/
    unit/
      SessionRegistry.test.ts
      VlcHttpAdapter.test.ts
```

---

## 2) `package.json`

```json
{
  "name": "automation-lab",
  "version": "0.1.0",
  "private": true,
  "main": "dist-electron/main/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "electron": "^37.2.0",
    "electron-vite": "^3.1.0",
    "typescript": "^5.8.3",
    "vite": "^7.0.0",
    "vitest": "^3.2.4"
  }
}
```

---

## 3) `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": "."
  },
  "include": ["src"]
}
```

---

## 4) `electron.vite.config.ts`

```ts
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      outDir: "dist-electron/main"
    }
  },
  preload: {
    build: {
      outDir: "dist-electron/preload"
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@main": resolve("src/main"),
        "@preload": resolve("src/preload")
      }
    }
  }
});
```

---

## 5) Shared automation types

### `src/main/automation/types.ts`

```ts
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
```

---

## 6) Session registry

### `src/main/automation/SessionRegistry.ts`

```ts
import { randomUUID } from "node:crypto";
import type { SessionSnapshot } from "./types";

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionSnapshot>();

  create(initial: Omit<SessionSnapshot, "sessionId">): SessionSnapshot {
    const snapshot: SessionSnapshot = {
      sessionId: randomUUID(),
      ...initial
    };

    this.sessions.set(snapshot.sessionId, snapshot);
    return snapshot;
  }

  update(sessionId: string, patch: Partial<SessionSnapshot>): SessionSnapshot {
    const current = this.require(sessionId);
    const next: SessionSnapshot = { ...current, ...patch };
    this.sessions.set(sessionId, next);
    return next;
  }

  get(sessionId: string): SessionSnapshot | undefined {
    return this.sessions.get(sessionId);
  }

  list(): SessionSnapshot[] {
    return [...this.sessions.values()];
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private require(sessionId: string): SessionSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }
}
```

---

## 7) Process manager

### `src/main/automation/ProcessManager.ts`

```ts
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
```

---

## 8) Base adapter

### `src/main/automation/adapters/BaseAdapter.ts`

```ts
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
```

---

## 9) VLC HTTP transport

### `src/main/automation/transports/HttpJsonClient.ts`

```ts
export class HttpJsonClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth?: { username: string; password: string }
  ) {}

  async get(path: string): Promise<Response> {
    const headers = new Headers();

    if (this.auth) {
      const encoded = Buffer.from(
        `${this.auth.username}:${this.auth.password}`
      ).toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    }

    return fetch(new URL(path, this.baseUrl), {
      method: "GET",
      headers
    });
  }
}
```

### `src/main/automation/adapters/VlcHttpAdapter.ts`

```ts
import { BaseAdapter } from "./BaseAdapter";
import { HttpJsonClient } from "../transports/HttpJsonClient";
import type { CommandRequest, SessionSnapshot } from "../types";

export class VlcHttpAdapter extends BaseAdapter {
  readonly appKind = "vlc" as const;
  readonly capabilities = ["launch", "attach", "playback", "close"];

  private readonly clients = new Map<string, HttpJsonClient>();

  async connect(sessionId: string): Promise<SessionSnapshot> {
    const session = await this.getState(sessionId);
    const port = Number(session.meta?.httpPort ?? 8080);
    const password = String(session.meta?.httpPassword ?? "vlcpass");

    const client = new HttpJsonClient(`http://127.0.0.1:${port}/`, {
      username: "",
      password
    });

    this.clients.set(sessionId, client);

    return this.sessions.update(sessionId, {
      state: "ready",
      endpoint: `http://127.0.0.1:${port}`
    });
  }

  async send(sessionId: string, command: CommandRequest): Promise<unknown> {
    const client = this.clients.get(sessionId);
    if (!client) {
      throw new Error("VLC client not connected");
    }

    switch (command.type) {
      case "status": {
        const res = await client.get("requests/status.json");
        return await res.json();
      }

      case "play": {
        await client.get("requests/status.json?command=pl_play");
        return { ok: true };
      }

      case "pause": {
        await client.get("requests/status.json?command=pl_pause");
        return { ok: true };
      }

      case "stop": {
        await client.get("requests/status.json?command=pl_stop");
        return { ok: true };
      }

      case "addToPlaylist": {
        const uri = encodeURIComponent(
          String((command.payload as { uri: string }).uri)
        );
        await client.get(`requests/status.json?command=in_enqueue&input=${uri}`);
        return { ok: true };
      }

      default:
        throw new Error(`Unsupported VLC command: ${command.type}`);
    }
  }
}
```

---

## 10) CDP transport and Chromium adapter

### `src/main/automation/transports/CdpClient.ts`

```ts
import WebSocket from "ws";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class CdpClient {
  private ws: WebSocket | null = null;
  private idCounter = 0;
  private readonly pending = new Map<number, Pending>();

  async connect(webSocketDebuggerUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(webSocketDebuggerUrl);
      this.ws = ws;

      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err as Error));
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };

        if (typeof msg.id === "number") {
          const pending = this.pending.get(msg.id);
          if (!pending) return;
          this.pending.delete(msg.id);

          if (msg.error) {
            pending.reject(new Error(msg.error.message ?? "Unknown CDP error"));
          } else {
            pending.resolve(msg.result);
          }
        }
      });
    });
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws) {
      throw new Error("CDP not connected");
    }

    const id = ++this.idCounter;
    const payload = { id, method, params };

    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(payload));
    });
  }
}
```

### `src/main/automation/adapters/ChromiumDebugAdapter.ts`

```ts
import { BaseAdapter } from "./BaseAdapter";
import { CdpClient } from "../transports/CdpClient";
import type { CommandRequest, SessionSnapshot } from "../types";

export class ChromiumDebugAdapter extends BaseAdapter {
  readonly appKind = "adb-browser" as const;
  readonly capabilities = ["launch", "attach", "navigate", "dom", "close"];

  private readonly clients = new Map<string, CdpClient>();

  async connect(sessionId: string): Promise<SessionSnapshot> {
    const session = await this.getState(sessionId);
    const port = Number(session.meta?.debugPort ?? 9222);

    const version = (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) =>
      r.json()
    )) as { webSocketDebuggerUrl: string };

    const client = new CdpClient();
    await client.connect(version.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    this.clients.set(sessionId, client);

    return this.sessions.update(sessionId, {
      state: "ready",
      endpoint: `http://127.0.0.1:${port}`
    });
  }

  async send(sessionId: string, command: CommandRequest): Promise<unknown> {
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
}
```

---

## 11) Sidecar transport

### `src/main/automation/transports/SidecarClient.ts`

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class SidecarClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private idCounter = 0;
  private readonly pending = new Map<number, Pending>();
  private buffer = "";

  start(exePath: string): void {
    this.child = spawn(exePath, [], { stdio: "pipe" });

    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();

      let index = this.buffer.indexOf("\n");
      while (index >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);

        if (line) {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: unknown;
            error?: string;
          };

          if (typeof msg.id === "number") {
            const pending = this.pending.get(msg.id);
            if (pending) {
              this.pending.delete(msg.id);
              if (msg.error) pending.reject(new Error(msg.error));
              else pending.resolve(msg.result);
            }
          }
        }

        index = this.buffer.indexOf("\n");
      }
    });
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.child) {
      throw new Error("Sidecar not started");
    }

    const id = ++this.idCounter;
    const payload = JSON.stringify({ id, method, params }) + "\n";

    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(payload);
    });
  }
}
```

---

## 12) AdBlockBrowser adapter with fallback

### `src/main/automation/adapters/AdbAdapter.ts`

```ts
import { ChromiumDebugAdapter } from "./ChromiumDebugAdapter";
import { SidecarClient } from "../transports/SidecarClient";
import { SessionRegistry } from "../SessionRegistry";
import type { CommandRequest, SessionSnapshot } from "../types";

export class AdbAdapter extends ChromiumDebugAdapter {
  private readonly sidecar = new SidecarClient();

  constructor(sessions: SessionRegistry) {
    super(sessions);
  }

  async connect(sessionId: string): Promise<SessionSnapshot> {
    try {
      return await super.connect(sessionId);
    } catch {
      const state = await this.getState(sessionId);
      const sidecarExe = String(state.meta?.sidecarExe ?? "");
      if (!sidecarExe) {
        throw new Error("CDP unavailable and no sidecar configured");
      }

      this.sidecar.start(sidecarExe);

      return this.sessions.update(sessionId, {
        state: "ready",
        endpoint: "sidecar://uia",
        meta: {
          ...(state.meta ?? {}),
          mode: "uia"
        }
      });
    }
  }

  async send(sessionId: string, command: CommandRequest): Promise<unknown> {
    const state = await this.getState(sessionId);

    if (state.meta?.mode === "uia") {
      switch (command.type) {
        case "findWindow":
          return await this.sidecar.send("findWindowByProcessId", {
            processId: state.pid
          });

        default:
          throw new Error(`Unsupported ADB UIA command: ${command.type}`);
      }
    }

    return await super.send(sessionId, command);
  }
}
```

---

## 13) Thorium adapter

### `src/main/automation/adapters/ThoriumAdapter.ts`

```ts
import { BaseAdapter } from "./BaseAdapter";
import { SidecarClient } from "../transports/SidecarClient";
import type { CommandRequest, SessionSnapshot } from "../types";

export class ThoriumAdapter extends BaseAdapter {
  readonly appKind = "thorium" as const;
  readonly capabilities = ["launch", "attach", "uia", "openResource", "close"];

  private readonly sidecar = new SidecarClient();

  async connect(sessionId: string): Promise<SessionSnapshot> {
    const session = await this.getState(sessionId);
    const sidecarExe = String(session.meta?.sidecarExe ?? "");

    if (!sidecarExe) {
      throw new Error("Missing sidecar executable path");
    }

    this.sidecar.start(sidecarExe);

    return this.sessions.update(sessionId, {
      state: "ready",
      endpoint: "sidecar://uia"
    });
  }

  async send(sessionId: string, command: CommandRequest): Promise<unknown> {
    const state = await this.getState(sessionId);

    switch (command.type) {
      case "findWindow":
        return await this.sidecar.send("findWindowByProcessId", {
          processId: state.pid
        });

      default:
        throw new Error(`Unsupported Thorium command: ${command.type}`);
    }
  }
}
```

---

## 14) Automation host

### `src/main/automation/AutomationHost.ts`

```ts
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
      "adb-browser": new AdbAdapter(this.sessions),
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
```

---

## 15) Electron main and IPC

### `src/main/ipc.ts`

```ts
import { ipcMain } from "electron";
import { AutomationHost } from "./automation/AutomationHost";

export function registerAutomationIpc() {
  const host = new AutomationHost();

  ipcMain.handle("automation:launch", async (_event, appKind, options) => {
    return await host.launch(appKind, options);
  });

  ipcMain.handle("automation:connect", async (_event, appKind, sessionId) => {
    return await host.connect(appKind, sessionId);
  });

  ipcMain.handle("automation:send", async (_event, appKind, sessionId, command) => {
    return await host.send(appKind, sessionId, command);
  });

  ipcMain.handle("automation:close", async (_event, appKind, sessionId) => {
    return await host.close(appKind, sessionId);
  });

  ipcMain.handle("automation:listSessions", async () => {
    return host.listSessions();
  });
}
```

### `src/main/main.ts`

```ts
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerAutomationIpc } from "./ipc";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerAutomationIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
```

---

## 16) Preload bridge

### `src/preload/index.ts`

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("automation", {
  launch: (appKind: string, options: unknown) =>
    ipcRenderer.invoke("automation:launch", appKind, options),
  connect: (appKind: string, sessionId: string) =>
    ipcRenderer.invoke("automation:connect", appKind, sessionId),
  send: (appKind: string, sessionId: string, command: unknown) =>
    ipcRenderer.invoke("automation:send", appKind, sessionId, command),
  close: (appKind: string, sessionId: string) =>
    ipcRenderer.invoke("automation:close", appKind, sessionId),
  listSessions: () => ipcRenderer.invoke("automation:listSessions")
});
```

### `src/preload/global.d.ts`

```ts
export {};

declare global {
  interface Window {
    automation: {
      launch: (appKind: string, options: unknown) => Promise<unknown>;
      connect: (appKind: string, sessionId: string) => Promise<unknown>;
      send: (appKind: string, sessionId: string, command: unknown) => Promise<unknown>;
      close: (appKind: string, sessionId: string) => Promise<void>;
      listSessions: () => Promise<unknown>;
    };
  }
}
```

---

## 17) Minimal renderer

### `src/renderer/main.tsx`

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### `src/renderer/App.tsx`

```tsx
import { useState } from "react";

type SessionLike = {
  sessionId: string;
};

export default function App() {
  const [sessionId, setSessionId] = useState<string>("");
  const [output, setOutput] = useState<string>("");

  async function launchVlc() {
    const result = (await window.automation.launch("vlc", {
      exePath: "C:/Program Files/VideoLAN/VLC/vlc.exe",
      args: [
        "--extraintf=http",
        "--http-password=vlcpass",
        "--http-host=127.0.0.1",
        "--http-port=8080"
      ],
      meta: {
        httpPort: 8080,
        httpPassword: "vlcpass"
      }
    })) as SessionLike;

    setSessionId(result.sessionId);
    setOutput(JSON.stringify(result, null, 2));
  }

  async function connectVlc() {
    const result = await window.automation.connect("vlc", sessionId);
    setOutput(JSON.stringify(result, null, 2));
  }

  async function getVlcStatus() {
    const result = await window.automation.send("vlc", sessionId, {
      type: "status"
    });
    setOutput(JSON.stringify(result, null, 2));
  }

  return (
    <div className="page">
      <h1>Automation Lab</h1>
      <div className="toolbar">
        <button onClick={launchVlc}>Launch VLC</button>
        <button onClick={connectVlc} disabled={!sessionId}>Connect VLC</button>
        <button onClick={getVlcStatus} disabled={!sessionId}>VLC Status</button>
      </div>
      <pre>{output}</pre>
    </div>
  );
}
```

### `src/renderer/styles.css`

```css
body {
  margin: 0;
  font-family: Arial, sans-serif;
}

.page {
  padding: 20px;
}

.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

button {
  padding: 10px 14px;
  cursor: pointer;
}

pre {
  background: #111;
  color: #ddd;
  padding: 16px;
  border-radius: 8px;
  overflow: auto;
}
```

---

## 18) C# sidecar project

### `sidecar/AutomationSidecar/AutomationSidecar.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <UseWPF>false</UseWPF>
  </PropertyGroup>

  <ItemGroup>
    <Reference Include="UIAutomationClient" />
    <Reference Include="UIAutomationTypes" />
  </ItemGroup>
</Project>
```

### `sidecar/AutomationSidecar/Models/CommandEnvelope.cs`

```csharp
namespace AutomationSidecar.Models;

public sealed class CommandEnvelope
{
    public int Id { get; set; }
    public string Method { get; set; } = "";
    public Dictionary<string, object>? Params { get; set; }
}
```

### `sidecar/AutomationSidecar/Models/ResponseEnvelope.cs`

```csharp
namespace AutomationSidecar.Models;

public sealed class ResponseEnvelope
{
    public int Id { get; set; }
    public object? Result { get; set; }
    public string? Error { get; set; }
}
```

### `sidecar/AutomationSidecar/Services/UiAutomationService.cs`

```csharp
using System.Windows.Automation;

namespace AutomationSidecar.Services;

public sealed class UiAutomationService
{
    public object FindWindowByProcessId(int processId)
    {
        var root = AutomationElement.RootElement;
        var condition = new PropertyCondition(AutomationElement.ProcessIdProperty, processId);
        var window = root.FindFirst(TreeScope.Children, condition);

        if (window == null)
            throw new InvalidOperationException($"Window not found for process {processId}");

        return new
        {
            Name = window.Current.Name,
            ClassName = window.Current.ClassName,
            NativeHandle = window.Current.NativeWindowHandle
        };
    }
}
```

### `sidecar/AutomationSidecar/Program.cs`

```csharp
using System.Text.Json;
using AutomationSidecar.Models;
using AutomationSidecar.Services;

var uia = new UiAutomationService();

string? line;
while ((line = Console.ReadLine()) != null)
{
    try
    {
        var cmd = JsonSerializer.Deserialize<CommandEnvelope>(line);
        if (cmd == null)
            continue;

        object? result = cmd.Method switch
        {
            "findWindowByProcessId" => uia.FindWindowByProcessId(
                Convert.ToInt32(cmd.Params!["processId"])
            ),
            _ => throw new InvalidOperationException($"Unknown method: {cmd.Method}")
        };

        Console.WriteLine(JsonSerializer.Serialize(new ResponseEnvelope
        {
            Id = cmd.Id,
            Result = result
        }));
    }
    catch (Exception ex)
    {
        Console.WriteLine(JsonSerializer.Serialize(new ResponseEnvelope
        {
            Error = ex.Message
        }));
    }
}
```

---

## 19) Tests

### `tests/unit/SessionRegistry.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { SessionRegistry } from "../../src/main/automation/SessionRegistry";

describe("SessionRegistry", () => {
  it("creates and updates a session", () => {
    const registry = new SessionRegistry();

    const created = registry.create({
      appKind: "vlc",
      state: "idle",
      capabilities: ["launch"]
    });

    expect(created.sessionId).toBeTruthy();

    const updated = registry.update(created.sessionId, {
      state: "ready",
      endpoint: "http://127.0.0.1:8080"
    });

    expect(updated.state).toBe("ready");
    expect(updated.endpoint).toContain("8080");
  });
});
```

### `tests/unit/VlcHttpAdapter.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { SessionRegistry } from "../../src/main/automation/SessionRegistry";
import { VlcHttpAdapter } from "../../src/main/automation/adapters/VlcHttpAdapter";

describe("VlcHttpAdapter", () => {
  it("connects using stored HTTP metadata", async () => {
    const sessions = new SessionRegistry();
    const adapter = new VlcHttpAdapter(sessions);

    const created = sessions.create({
      appKind: "vlc",
      state: "running",
      capabilities: ["launch", "attach", "playback", "close"],
      meta: {
        httpPort: 8080,
        httpPassword: "vlcpass"
      }
    });

    const snapshot = await adapter.connect(created.sessionId);
    expect(snapshot.state).toBe("ready");
  });
});
```

---

## 20) First manual test flow

### VLC
1. Launch VLC with HTTP flags.
2. Connect the adapter.
3. Call `status`.
4. Verify JSON comes back.
5. Call `addToPlaylist` with a local media URI.

### AdBlockBrowser
1. Launch with `--remote-debugging-port=9222` if supported.
2. Connect the `AdbAdapter`.
3. If CDP works, call `navigate` and `getTitle`.
4. If CDP fails, configure `sidecarExe` and verify `findWindow` works.

### Thorium
1. Launch the process.
2. Connect through sidecar.
3. Call `findWindow`.
4. Later add named control resolution methods.

---

## 21) Next extensions

Add these next once the shell is stable:

- named pipe transport instead of stdin/stdout for the sidecar
- process discovery / attach by executable name
- control tree dump for UIA
- button invocation by automation id
- document open commands for Thorium
- richer CDP target selection for AdBlockBrowser
- renderer pages per adapter instead of one shared `App.tsx`

---

## 22) Notes

This scaffold is intentionally minimal.

The most likely first real-world fixes you will need are:

- wait/retry logic before connecting to VLC HTTP
- wait/retry logic before hitting `/json/version` on CDP
- target-page selection for Chromium-based browsers
- sidecar command framing improvements
- stronger error propagation from child processes

Once those are stable, this becomes a solid automation lab for testing process launch, transport negotiation, and adapter behavior.

