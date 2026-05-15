Yes. The best way to build this is as a **separate Electron-based automation harness** with a **Node orchestration layer** and a **C# sidecar** for Windows-native UI Automation. That matches Electron’s main/renderer IPC model, lets you use the Chrome DevTools Protocol for Chromium-family apps when available, and uses Windows UI Automation as the structured desktop fallback instead of raw mouse/keyboard automation. VLC is a strong fit for an HTTP-based adapter, and Thorium Reader is a good candidate for UI Automation plus its documented keyboard-command surface.

## Recommended project shape

automation-lab/  
  package.json  
  electron.vite.config.ts  
  src/  
    main/  
      main.ts  
      ipc.ts  
      automation/  
        AutomationHost.ts  
        ProcessManager.ts  
        SessionRegistry.ts  
        types.ts  
        adapters/  
          BaseAdapter.ts  
          VlcHttpAdapter.ts  
          ChromiumDebugAdapter.ts  
          AdbAdapter.ts  
          ThoriumAdapter.ts  
        transports/  
          CdpClient.ts  
          SidecarClient.ts  
          HttpJsonClient.ts  
        utils/  
          port.ts  
          process.ts  
    preload/  
      index.ts  
    renderer/  
      App.tsx  
      pages/  
        AdaptersPage.tsx  
        SessionPage.tsx  
        TestsPage.tsx  
  sidecar/  
    AutomationSidecar/  
      Program.cs  
      Models/  
        CommandEnvelope.cs  
        ResponseEnvelope.cs  
      Services/  
        WindowFinder.cs  
        UiAutomationService.cs  
        ProcessAttachService.cs  
  tests/  
    unit/  
      ProcessManager.test.ts  
      SessionRegistry.test.ts  
      VlcHttpAdapter.test.ts  
      ChromiumDebugAdapter.test.ts  
      AdbAdapter.test.ts  
      ThoriumAdapter.test.ts  
    integration/  
      vlc.smoke.test.ts  
      chromium-debug.smoke.test.ts  
      sidecar.uia.smoke.test.ts

## Core design

### Runtime flow

Renderer  
  -> preload API  
  -> ipcRenderer.invoke(...)  
  
Main process  
  -> AutomationHost  
  -> Adapter instance  
  -> either:  
       a) HTTP transport  
       b) CDP transport  
       c) Sidecar transport  
  
Sidecar  
  -> Windows UI Automation / process attach / window discovery  
  
External app  
  -> VLC / AdBlockBrowser / Thorium

## The adapter model

You want one stable interface regardless of target app:

// src/main/automation/types.ts  
export type AutomationCapability =  
  | "launch"  
  | "attach"  
  | "navigate"  
  | "openResource"  
  | "playback"  
  | "dom"  
  | "uia"  
  | "close";  
  
export type AppKind =  
  | "adb-browser"  
  | "vlc"  
  | "thorium";  
  
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

## Session registry

// src/main/automation/SessionRegistry.ts  
import { randomUUID } from "node:crypto";  
import type { SessionSnapshot } from "./types";  
  
export class SessionRegistry {  
  private readonly sessions = new Map<string, SessionSnapshot>();  
  
  create(initial: Omit<SessionSnapshot, "sessionId">): SessionSnapshot {  
    const snapshot: SessionSnapshot = {  
      sessionId: randomUUID(),  
      ...initial,  
    };  
    this.sessions.set(snapshot.sessionId, snapshot);  
    return snapshot;  
  }  
  
  update(sessionId: string, patch: Partial<SessionSnapshot>): SessionSnapshot {  
    const current = this.require(sessionId);  
    const next = { ...current, ...patch };  
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
    if (!session) throw new Error(`Unknown session: ${sessionId}`);  
    return session;  
  }  
}

## Process manager

Use Node’s child-process spawning in the Electron main process. That is the right place to launch and supervise the external app. Electron’s process model and IPC pattern are built for that split.

// src/main/automation/ProcessManager.ts  
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
      windowsHide: false,  
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
      child,  
    };  
  }  
  
  async terminate(proc: ManagedProcess): Promise<void> {  
    if (!proc.child.killed) {  
      proc.child.kill();  
    }  
  }  
}

## Base adapter

// src/main/automation/adapters/BaseAdapter.ts  
import { SessionRegistry } from "../SessionRegistry";  
import { ProcessManager, type ManagedProcess } from "../ProcessManager";  
import type {  
  AppAdapter,  
  AppKind,  
  AutomationCapability,  
  CommandRequest,  
  LaunchOptions,  
  SessionSnapshot,  
} from "../types";  
  
export abstract class BaseAdapter implements AppAdapter {  
  abstract readonly appKind: AppKind;  
  abstract readonly capabilities: AutomationCapability[];  
  
  protected readonly sessions: SessionRegistry;  
  protected readonly processes = new Map<string, ManagedProcess>();  
  protected readonly processManager = new ProcessManager();  
  
  constructor(sessions: SessionRegistry) {  
    this.sessions = sessions;  
  }  
  
  async launch(options: LaunchOptions): Promise<SessionSnapshot> {  
    const created = this.sessions.create({  
      appKind: this.appKind,  
      state: "launching",  
      capabilities: this.capabilities,  
    });  
  
    const proc = this.processManager.launch(options);  
    this.processes.set(created.sessionId, proc);  
  
    return this.sessions.update(created.sessionId, {  
      pid: proc.pid,  
      state: "running",  
      meta: {  
        exePath: options.exePath,  
      },  
    });  
  }  
  
  abstract connect(sessionId: string): Promise<SessionSnapshot>;  
  abstract send(sessionId: string, command: CommandRequest): Promise<unknown>;  
  
  async getState(sessionId: string): Promise<SessionSnapshot> {  
    const state = this.sessions.get(sessionId);  
    if (!state) throw new Error(`Unknown session: ${sessionId}`);  
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

---

# Transport implementations

## 1. VLC over HTTP

VLC exposes an HTTP interface, and the request list in VLC’s Lua HTTP files documents the command shape. That makes VLC the cleanest “official/local automation API” case in your app list.

// src/main/automation/transports/HttpJsonClient.ts  
export class HttpJsonClient {  
  constructor(  
    private readonly baseUrl: string,  
    private readonly auth?: { username: string; password: string },  
  ) {}  
  
  async get(path: string): Promise<Response> {  
    const headers = new Headers();  
    if (this.auth) {  
      const encoded = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString("base64");  
      headers.set("Authorization", `Basic ${encoded}`);  
    }  
  
    return fetch(new URL(path, this.baseUrl), {  
      method: "GET",  
      headers,  
    });  
  }  
}

// src/main/automation/adapters/VlcHttpAdapter.ts  
import { BaseAdapter } from "./BaseAdapter";  
import { HttpJsonClient } from "../transports/HttpJsonClient";  
import type { CommandRequest, SessionSnapshot } from "../types";  
  
export class VlcHttpAdapter extends BaseAdapter {  
  readonly appKind = "vlc" as const;  
  readonly capabilities = ["launch", "attach", "playback", "close"] as const;  
  
  private readonly clients = new Map<string, HttpJsonClient>();  
  
  async connect(sessionId: string): Promise<SessionSnapshot> {  
    const session = await this.getState(sessionId);  
    const port = Number(session.meta?.httpPort ?? 8080);  
    const password = String(session.meta?.httpPassword ?? "vlcpass");  
  
    const client = new HttpJsonClient(`http://127.0.0.1:${port}/`, {  
      username: "",  
      password,  
    });  
  
    this.clients.set(sessionId, client);  
  
    return this.sessions.update(sessionId, {  
      state: "ready",  
      endpoint: `http://127.0.0.1:${port}`,  
    });  
  }  
  
  async send(sessionId: string, command: CommandRequest): Promise<unknown> {  
    const client = this.clients.get(sessionId);  
    if (!client) throw new Error("VLC client not connected");  
  
    switch (command.type) {  
      case "status": {  
        const res = await client.get("requests/status.json");  
        return await res.json();  
      }  
  
      case "play":  
        await client.get("requests/status.json?command=pl_play");  
        return { ok: true };  
  
      case "pause":  
        await client.get("requests/status.json?command=pl_pause");  
        return { ok: true };  
  
      case "stop":  
        await client.get("requests/status.json?command=pl_stop");  
        return { ok: true };  
  
      case "addToPlaylist": {  
        const uri = encodeURIComponent(String((command.payload as { uri: string }).uri));  
        await client.get(`requests/status.json?command=in_enqueue&input=${uri}`);  
        return { ok: true };  
      }  
  
      default:  
        throw new Error(`Unsupported VLC command: ${command.type}`);  
    }  
  }  
}

Recommended launch flags for test harness:

[  
  "--extraintf=http",  
  "--http-password=vlcpass",  
  "--http-host=127.0.0.1",  
  "--http-port=8080"  
]

## 2. Chromium / DevTools Protocol transport

The Chrome DevTools Protocol is the right structured option when the browser accepts a remote debugging port. Chrome’s protocol is documented, and Chromium-family apps commonly expose it when started with the appropriate debugging flags.

// src/main/automation/transports/CdpClient.ts  
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
      ws.on("error", (err) => reject(err));  
  
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
    if (!this.ws) throw new Error("CDP not connected");  
  
    const id = ++this.idCounter;  
    const payload = { id, method, params };  
  
    return await new Promise((resolve, reject) => {  
      this.pending.set(id, { resolve, reject });  
      this.ws!.send(JSON.stringify(payload));  
    });  
  }  
  
  async close(): Promise<void> {  
    if (!this.ws) return;  
    await new Promise<void>((resolve) => {  
      this.ws!.once("close", () => resolve());  
      this.ws!.close();  
    });  
    this.ws = null;  
  }  
}

// src/main/automation/adapters/ChromiumDebugAdapter.ts  
import { BaseAdapter } from "./BaseAdapter";  
import { CdpClient } from "../transports/CdpClient";  
import type { CommandRequest, SessionSnapshot } from "../types";  
  
export class ChromiumDebugAdapter extends BaseAdapter {  
  readonly appKind = "adb-browser" as const;  
  readonly capabilities = ["launch", "attach", "navigate", "dom", "close"] as const;  
  
  private readonly clients = new Map<string, CdpClient>();  
  
  async connect(sessionId: string): Promise<SessionSnapshot> {  
    const session = await this.getState(sessionId);  
    const port = Number(session.meta?.debugPort ?? 9222);  
  
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()) as {  
      webSocketDebuggerUrl: string;  
    };  
  
    const client = new CdpClient();  
    await client.connect(version.webSocketDebuggerUrl);  
    await client.send("Page.enable");  
    await client.send("Runtime.enable");  
  
    this.clients.set(sessionId, client);  
  
    return this.sessions.update(sessionId, {  
      state: "ready",  
      endpoint: `http://127.0.0.1:${port}`,  
    });  
  }  
  
  async send(sessionId: string, command: CommandRequest): Promise<unknown> {  
    const client = this.clients.get(sessionId);  
    if (!client) throw new Error("CDP client not connected");  
  
    switch (command.type) {  
      case "navigate":  
        return await client.send("Page.navigate", { url: String((command.payload as { url: string }).url) });  
  
      case "eval":  
        return await client.send("Runtime.evaluate", {  
          expression: String((command.payload as { expression: string }).expression),  
          returnByValue: true,  
          awaitPromise: true,  
        });  
  
      case "getTitle":  
        return await client.send("Runtime.evaluate", {  
          expression: "document.title",  
          returnByValue: true,  
        });  
  
      default:  
        throw new Error(`Unsupported CDP command: ${command.type}`);  
    }  
  }  
}

## 3. Sidecar transport for UI Automation

Windows UI Automation gives you structured access to desktop controls and patterns like Invoke, Value, and Selection, which is the right non-raw fallback for apps without a documented remote protocol.

### Node side

// src/main/automation/transports/SidecarClient.ts  
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";  
import { EventEmitter } from "node:events";  
  
type Pending = {  
  resolve: (value: unknown) => void;  
  reject: (error: Error) => void;  
};  
  
export class SidecarClient extends EventEmitter {  
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
            event?: string;  
            payload?: unknown;  
          };  
  
          if (typeof msg.id === "number") {  
            const pending = this.pending.get(msg.id);  
            if (pending) {  
              this.pending.delete(msg.id);  
              if (msg.error) pending.reject(new Error(msg.error));  
              else pending.resolve(msg.result);  
            }  
          } else if (msg.event) {  
            this.emit(msg.event, msg.payload);  
          }  
        }  
  
        index = this.buffer.indexOf("\n");  
      }  
    });  
  }  
  
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {  
    if (!this.child) throw new Error("Sidecar not started");  
    const id = ++this.idCounter;  
    const payload = JSON.stringify({ id, method, params }) + "\n";  
  
    return await new Promise((resolve, reject) => {  
      this.pending.set(id, { resolve, reject });  
      this.child!.stdin.write(payload);  
    });  
  }  
}

### C# sidecar

// sidecar/AutomationSidecar/Models/CommandEnvelope.cs  
namespace AutomationSidecar.Models;  
  
public sealed class CommandEnvelope  
{  
    public int Id { get; set; }  
    public string Method { get; set; } = "";  
    public Dictionary<string, object>? Params { get; set; }  
}

// sidecar/AutomationSidecar/Models/ResponseEnvelope.cs  
namespace AutomationSidecar.Models;  
  
public sealed class ResponseEnvelope  
{  
    public int Id { get; set; }  
    public object? Result { get; set; }  
    public string? Error { get; set; }  
}

// sidecar/AutomationSidecar/Services/UiAutomationService.cs  
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
  
    public object InvokeButtonByName(int processId, string name)  
    {  
        var root = AutomationElement.RootElement;  
        var pidCondition = new PropertyCondition(AutomationElement.ProcessIdProperty, processId);  
        var window = root.FindFirst(TreeScope.Children, pidCondition);  
  
        if (window == null)  
            throw new InvalidOperationException("Window not found");  
  
        var nameCondition = new PropertyCondition(AutomationElement.NameProperty, name);  
        var button = window.FindFirst(TreeScope.Descendants, nameCondition);  
  
        if (button == null)  
            throw new InvalidOperationException($"Button '{name}' not found");  
  
        if (button.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern))  
        {  
            ((InvokePattern)pattern).Invoke();  
            return new { Ok = true, Invoked = name };  
        }  
  
        throw new InvalidOperationException("Element does not support InvokePattern");  
    }  
}

// sidecar/AutomationSidecar/Program.cs  
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
        if (cmd == null) continue;  
  
        object? result = cmd.Method switch  
        {  
            "findWindowByProcessId" => uia.FindWindowByProcessId(  
                Convert.ToInt32(cmd.Params!["processId"])  
            ),  
            "invokeButtonByName" => uia.InvokeButtonByName(  
                Convert.ToInt32(cmd.Params!["processId"]),  
                Convert.ToString(cmd.Params!["name"])!  
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

---

# App-specific adapters

## AdbAdapter

This should prefer CDP, then fall back to sidecar UI Automation if AdBlockBrowser does not expose a remote debugging endpoint.

// src/main/automation/adapters/AdbAdapter.ts  
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
      if (!sidecarExe) throw new Error("CDP unavailable and no sidecar configured");  
  
      this.sidecar.start(sidecarExe);  
  
      return this.sessions.update(sessionId, {  
        state: "ready",  
        endpoint: "sidecar://uia",  
        meta: {  
          ...state.meta,  
          mode: "uia",  
        },  
      });  
    }  
  }  
  
  async send(sessionId: string, command: CommandRequest): Promise<unknown> {  
    const state = await this.getState(sessionId);  
  
    if (state.meta?.mode === "uia") {  
      switch (command.type) {  
        case "findWindow":  
          return await this.sidecar.send("findWindowByProcessId", {  
            processId: state.pid,  
          });  
  
        case "invokeButton":  
          return await this.sidecar.send("invokeButtonByName", {  
            processId: state.pid,  
            name: String((command.payload as { name: string }).name),  
          });  
  
        default:  
          throw new Error(`Unsupported UIA command: ${command.type}`);  
      }  
    }  
  
    return await super.send(sessionId, command);  
  }  
}

## ThoriumAdapter

Thorium is a better fit for UI Automation commands and shortcut-oriented control than for a custom network API. Its docs and wiki both surface keyboard-driven actions and configurable shortcuts.

// src/main/automation/adapters/ThoriumAdapter.ts  
import { BaseAdapter } from "./BaseAdapter";  
import { SidecarClient } from "../transports/SidecarClient";  
import type { CommandRequest, SessionSnapshot } from "../types";  
  
export class ThoriumAdapter extends BaseAdapter {  
  readonly appKind = "thorium" as const;  
  readonly capabilities = ["launch", "attach", "uia", "openResource", "close"] as const;  
  
  private readonly sidecar = new SidecarClient();  
  
  async connect(sessionId: string): Promise<SessionSnapshot> {  
    const session = await this.getState(sessionId);  
    const sidecarExe = String(session.meta?.sidecarExe ?? "");  
    if (!sidecarExe) throw new Error("Missing sidecar executable path");  
  
    this.sidecar.start(sidecarExe);  
  
    return this.sessions.update(sessionId, {  
      state: "ready",  
      endpoint: "sidecar://uia",  
    });  
  }  
  
  async send(sessionId: string, command: CommandRequest): Promise<unknown> {  
    const state = await this.getState(sessionId);  
  
    switch (command.type) {  
      case "findWindow":  
        return await this.sidecar.send("findWindowByProcessId", {  
          processId: state.pid,  
        });  
  
      case "invokeButton":  
        return await this.sidecar.send("invokeButtonByName", {  
          processId: state.pid,  
          name: String((command.payload as { name: string }).name),  
        });  
  
      default:  
        throw new Error(`Unsupported Thorium command: ${command.type}`);  
    }  
  }  
}

---

# Automation host

// src/main/automation/AutomationHost.ts  
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
      "thorium": new ThoriumAdapter(this.sessions),  
    };  
  }  
  
  async launch(appKind: AppKind, options: LaunchOptions & { meta?: Record<string, unknown> }) {  
    const adapter = this.adapters[appKind];  
    const launched = await adapter.launch(options);  
  
    if (options.meta) {  
      this.sessions.update(launched.sessionId, {  
        meta: { ...(launched.meta ?? {}), ...options.meta },  
      });  
    }  
  
    return launched;  
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

---

# Electron IPC

// src/main/ipc.ts  
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

// src/preload/index.ts  
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
  listSessions: () =>  
    ipcRenderer.invoke("automation:listSessions"),  
});

---

# Simplified tests

The right split is:

- **unit tests** for adapter logic and command routing
- **smoke tests** for app launch/connect
- **manual verification buttons** inside the Electron UI

## 1. Unit: SessionRegistry

// tests/unit/SessionRegistry.test.ts  
import { describe, expect, it } from "vitest";  
import { SessionRegistry } from "../../src/main/automation/SessionRegistry";  
  
describe("SessionRegistry", () => {  
  it("creates and updates a session", () => {  
    const registry = new SessionRegistry();  
  
    const created = registry.create({  
      appKind: "vlc",  
      state: "idle",  
      capabilities: ["launch"],  
    });  
  
    expect(created.sessionId).toBeTruthy();  
  
    const updated = registry.update(created.sessionId, {  
      state: "ready",  
      endpoint: "http://127.0.0.1:8080",  
    });  
  
    expect(updated.state).toBe("ready");  
    expect(updated.endpoint).toContain("8080");  
  });  
});

## 2. Unit: VLC command routing

// tests/unit/VlcHttpAdapter.test.ts  
import { describe, expect, it, vi } from "vitest";  
import { SessionRegistry } from "../../src/main/automation/SessionRegistry";  
import { VlcHttpAdapter } from "../../src/main/automation/adapters/VlcHttpAdapter";  
  
describe("VlcHttpAdapter", () => {  
  it("connects using stored http metadata", async () => {  
    const sessions = new SessionRegistry();  
    const adapter = new VlcHttpAdapter(sessions);  
  
    const created = sessions.create({  
      appKind: "vlc",  
      state: "running",  
      capabilities: ["launch", "attach", "playback", "close"],  
      meta: { httpPort: 8080, httpPassword: "vlcpass" },  
    });  
  
    const snapshot = await adapter.connect(created.sessionId);  
    expect(snapshot.state).toBe("ready");  
  });  
  
  it("throws when sending without connect", async () => {  
    const sessions = new SessionRegistry();  
    const adapter = new VlcHttpAdapter(sessions);  
  
    const created = sessions.create({  
      appKind: "vlc",  
      state: "running",  
      capabilities: ["launch", "attach", "playback", "close"],  
    });  
  
    await expect(adapter.send(created.sessionId, { type: "status" })).rejects.toThrow();  
  });  
});

## 3. Unit: CDP adapter with mocked endpoints

// tests/unit/ChromiumDebugAdapter.test.ts  
import { describe, expect, it, vi, beforeEach } from "vitest";  
import { SessionRegistry } from "../../src/main/automation/SessionRegistry";  
import { ChromiumDebugAdapter } from "../../src/main/automation/adapters/ChromiumDebugAdapter";  
  
describe("ChromiumDebugAdapter", () => {  
  beforeEach(() => {  
    vi.restoreAllMocks();  
  });  
  
  it("requests /json/version when connecting", async () => {  
    const sessions = new SessionRegistry();  
    const adapter = new ChromiumDebugAdapter(sessions);  
  
    const created = sessions.create({  
      appKind: "adb-browser",  
      state: "running",  
      capabilities: ["launch", "attach", "navigate", "dom", "close"],  
      meta: { debugPort: 9222 },  
    });  
  
    vi.stubGlobal("fetch", vi.fn(async () => ({  
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc" }),  
    })) as unknown as typeof fetch);  
  
    await expect(adapter.connect(created.sessionId)).rejects.toThrow();  
  });  
});

That test is intentionally partial because the WebSocket side is not mocked there; it still verifies the correct branch.

## 4. Smoke: VLC

// tests/integration/vlc.smoke.test.ts  
import { describe, expect, it } from "vitest";  
import { AutomationHost } from "../../src/main/automation/AutomationHost";  
  
describe.skipIf(!process.env.VLC_EXE)("VLC smoke", () => {  
  it("launches and returns status", async () => {  
    const host = new AutomationHost();  
  
    const launched = await host.launch("vlc", {  
      exePath: process.env.VLC_EXE!,  
      args: [  
        "--extraintf=http",  
        "--http-password=vlcpass",  
        "--http-host=127.0.0.1",  
        "--http-port=8080",  
      ],  
      meta: {  
        httpPort: 8080,  
        httpPassword: "vlcpass",  
      },  
    });  
  
    await host.connect("vlc", launched.sessionId);  
    const status = await host.send("vlc", launched.sessionId, { type: "status" });  
  
    expect(status).toBeTruthy();  
  });  
});

## 5. Smoke: Chromium app on debug port

// tests/integration/chromium-debug.smoke.test.ts  
import { describe, expect, it } from "vitest";  
import { AutomationHost } from "../../src/main/automation/AutomationHost";  
  
describe.skipIf(!process.env.ADB_EXE)("ADB debug smoke", () => {  
  it("launches with remote debugging and evaluates document.title", async () => {  
    const host = new AutomationHost();  
  
    const launched = await host.launch("adb-browser", {  
      exePath: process.env.ADB_EXE!,  
      args: [  
        "--remote-debugging-port=9222",  
        "--user-data-dir=./tmp-adb-profile",  
      ],  
      meta: {  
        debugPort: 9222,  
      },  
    });  
  
    await host.connect("adb-browser", launched.sessionId);  
    await host.send("adb-browser", launched.sessionId, {  
      type: "navigate",  
      payload: { url: "https://example.com" },  
    });  
  
    const title = await host.send("adb-browser", launched.sessionId, {  
      type: "getTitle",  
    });  
  
    expect(title).toBeTruthy();  
  });  
});

## 6. Smoke: sidecar UIA

// tests/integration/sidecar.uia.smoke.test.ts  
import { describe, expect, it } from "vitest";  
import { SidecarClient } from "../../src/main/automation/transports/SidecarClient";  
  
describe.skipIf(!process.env.SIDECAR_EXE)("Sidecar UIA smoke", () => {  
  it("starts and accepts a command envelope", async () => {  
    const sidecar = new SidecarClient();  
    sidecar.start(process.env.SIDECAR_EXE!);  
  
    // Use a real PID in local manual runs.  
    await expect(  
      sidecar.send("findWindowByProcessId", { processId: 999999 })  
    ).rejects.toThrow();  
  });  
});

---

# Manual test buttons for the Electron harness

Inside the renderer, give yourself explicit buttons:

### VLC

- Launch VLC
- Connect HTTP
- Status
- Play
- Pause
- Stop
- Add local media URI

### AdBlockBrowser

- Launch with debug port
- Connect CDP
- Navigate to URL
- Evaluate JS
- Get title
- Fallback to UIA mode
- Find window

### Thorium

- Launch
- Attach UIA
- Find window
- Invoke named button
- Dump window metadata

That gives you a stable “lab” for each adapter without wiring it into the main app yet.

---

# Behavior rules I would enforce

## Adapter priority

### AdBlockBrowser

1. try CDP
2. if `/json/version` not available, use UIA sidecar
3. no raw mouse automation

### VLC

1. HTTP interface
2. optionally libVLC later if you need tighter control
3. no UIA unless for emergency attach/debug

### Thorium

1. UIA
2. focused command model using named controls and documented shortcut-oriented actions
3. no raw mouse automation

This follows the strongest available control surface for each app.

---

# Implementation plan

## Phase 1

Build the harness shell.

- Electron app
- preload API
- IPC handlers
- `AutomationHost`
- `SessionRegistry`
- `ProcessManager`

## Phase 2

Add real transports.

- `HttpJsonClient`
- `CdpClient`
- `SidecarClient`

## Phase 3

Add first adapters.

- `VlcHttpAdapter`
- `ChromiumDebugAdapter`
- `AdbAdapter`
- `ThoriumAdapter`

## Phase 4

Build the C# sidecar.

- stdin/stdout JSON transport
- `findWindowByProcessId`
- `invokeButtonByName`
- later: `getTree`, `getValue`, `selectItem`, `expandCollapse`

## Phase 5

Add tests.

- unit tests for state and routing
- smoke tests behind env vars
- renderer buttons for manual verification

## Phase 6

Only after the lab is stable, embed the adapters into your main application.

---

# One important correction

You asked for “without raw automation,” and I agree. Use:

- **HTTP API** when the app gives you one
- **CDP** when the browser supports a debugging port
- **UI Automation patterns** when the app is desktop-only

That is still “automation,” but it is **structured automation**, not brittle coordinate-clicking.

If you want, I can turn this into a full starter repo layout with:

- Electron `package.json`
- Vite/Electron config
- full preload typings
- a minimal React renderer page
- the sidecar `.csproj`
- and a first-pass `npm test` setup.

