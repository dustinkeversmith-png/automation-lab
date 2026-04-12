/* tools/smoke/realEnvironmentSmoke.ts */
import process from "node:process";
import { CdpClient } from "../src/main/automation/transports/CdpClient";
import { HttpJsonClient } from "../src/main/automation/transports/HttpJsonClient";
import { SidecarClient } from "../src/main/automation/transports/SidecarClient";
import { VlcHttpAdapter } from "../src/main/automation/adapters/VlcHttpAdapter";
import { AdbAdapter } from "../src/main/automation/adapters/AdbAdapter";
import { SessionRegistry } from "../src/main/automation/SessionRegistry";

import dotenv from "dotenv";

dotenv.config({ path: ".env.smoke" });

type SmokeResult = {
  name: string;
  ok: boolean;
  detail?: unknown;
};

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value == null) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function envNum(name: string, fallback?: number): number {
  const raw = process.env[name] ?? (fallback != null ? String(fallback) : undefined);
  if (raw == null) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${raw}`);
  }
  return n;
}

function printHeader(title: string): void {
  console.log("");
  console.log("============================================================");
  console.log(title);
  console.log("============================================================");
}

function printResult(result: SmokeResult): void {
  console.log(`[${result.ok ? "PASS" : "FAIL"}] ${result.name}`);
  if (result.detail !== undefined) {
    console.dir(result.detail, { depth: 8 });
  }
}

async function smokeHttpJsonClient(): Promise<SmokeResult> {
  const baseUrl = env("SMOKE_HTTP_BASE_URL");
  const path = process.env.SMOKE_HTTP_PATH ?? "";
  const authPassword = process.env.SMOKE_HTTP_PASSWORD;
  const authUsername = process.env.SMOKE_HTTP_USERNAME ?? "";

  const client = new HttpJsonClient(baseUrl, {
    auth: authPassword ? { username: authUsername, password: authPassword } : undefined,
    timeoutMs: envNum("SMOKE_HTTP_TIMEOUT_MS", 5000),
  });

  const json = await client.getJson<unknown>(path);
  return {
    name: "HttpJsonClient",
    ok: true,
    detail: {
      baseUrl,
      path,
      json,
    },
  };
}

async function smokeSidecarClient(): Promise<SmokeResult> {
  const sidecarExe = env("SMOKE_SIDECAR_EXE");
  const method = process.env.SMOKE_SIDECAR_METHOD ?? "ping";

  const sidecar = new SidecarClient();
  sidecar.start(sidecarExe);

  try {
    const result = await sidecar.send(method, {}, { timeoutMs: envNum("SMOKE_SIDECAR_TIMEOUT_MS", 5000) });
    return {
      name: "SidecarClient",
      ok: true,
      detail: {
        exe: sidecarExe,
        method,
        result,
      },
    };
  } finally {
    sidecar.stop();
  }
}

async function smokeCdpClient(): Promise<SmokeResult> {
  const debugPort = envNum("SMOKE_CHROME_DEBUG_PORT", 9222);
  const versionUrl = `http://127.0.0.1:${debugPort}/json/list`;



  const res = await fetch(versionUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${versionUrl}: HTTP ${res.status}`);
  }

  const pages = await res.json();
  const page = pages[0];

  const versionJson = page as { webSocketDebuggerUrl?: string };

  console.log(`stuff -> ${page}, ${versionJson} `);

  if (!versionJson.webSocketDebuggerUrl) {
    throw new Error(`Missing webSocketDebuggerUrl from ${versionUrl}`);
  }

  const client = new CdpClient();
  await client.connect(versionJson.webSocketDebuggerUrl);

  try {
    const browserVersion = await client.send("Browser.getVersion");
    const targetUrl = process.env.SMOKE_CHROME_TEST_URL ?? "https://example.com";
    const nav = await client.send("Page.navigate", { url: targetUrl });
    const title = await client.send("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
      awaitPromise: true,
    });

    return {
      name: "CdpClient",
      ok: true,
      detail: {
        versionUrl,
        webSocketDebuggerUrl: versionJson.webSocketDebuggerUrl,
        browserVersion,
        navigate: nav,
        title,
      },
    };
  } finally {
    await client.disconnect();
  }
}



async function smokeVlcHttpAdapter(): Promise<SmokeResult> {
  const sessions = new SessionRegistry();
  const adapter = new VlcHttpAdapter(sessions);

  const created = sessions.create({
    appKind: "vlc",
    state: "running",
    capabilities: ["launch", "attach", "playback", "close"],
    meta: {
      sidecarExe: env("SMOKE_SIDECAR_EXE"),
      vlcExe: env("SMOKE_VLC_EXE"),
      httpPort: envNum("SMOKE_VLC_HTTP_PORT", 8080),
      httpPassword: env("SMOKE_VLC_HTTP_PASSWORD", "vlcpass"),
    },
  });

  const snapshot = await adapter.connect(created.sessionId);
  const status = await adapter.send(created.sessionId, { type: "status" });

  const maybeUri = process.env.SMOKE_VLC_MEDIA_URI;
  let playFileResult: unknown = undefined;
  if (maybeUri) {
    playFileResult = await adapter.send(created.sessionId, {
      type: "playFile",
      payload: { uri: maybeUri },
    });
  }

  return {
    name: "VlcHttpAdapter",
    ok: true,
    detail: {
      snapshot,
      status,
      playFileResult,
    },
  };
}

async function smokeAdbAdapter(): Promise<SmokeResult> {
  const sessions = new SessionRegistry();
  const adapter = new AdbAdapter(sessions);

  const created = sessions.create({
    appKind: "adb-browser",
    state: "running",
    capabilities: ["launch", "attach", "navigate", "dom", "close"],
    pid: undefined,
    meta: {
      debugPort: envNum("SMOKE_ADB_DEBUG_PORT", 9222),
      sidecarExe: process.env.SMOKE_SIDECAR_EXE ?? "",
      sidecarArgs: [],
      adbPath: process.env.SMOKE_ADB_EXE ?? "",
    },
  });

  const snapshot = await adapter.connect(created.sessionId);

  let commandResult: unknown;
  const mode = snapshot.meta?.mode;

  if (mode === "uia") {
    commandResult = await adapter.send(created.sessionId, {
      type: "findWindow",
    });
  } else {
    const url = process.env.SMOKE_ADB_TEST_URL ?? "https://example.com";
    commandResult = await adapter.send(created.sessionId, {
      type: "navigate",
      payload: { url },
    });
  }

  return {
    name: "AdbAdapter",
    ok: true,
    detail: {
      snapshot,
      commandResult,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function smokeAdbWindowStateTransitions(): Promise<SmokeResult> {
  const sessions = new SessionRegistry();
  const adapter = new AdbAdapter(sessions);

  const created = sessions.create({
    appKind: "adb-browser",
    state: "running",
    capabilities: ["launch", "attach", "navigate", "dom", "close"],
    pid: undefined,
    meta: {
      debugPort: envNum("SMOKE_ADB_DEBUG_PORT", 9222),
      sidecarExe: process.env.SMOKE_SIDECAR_EXE ?? "",
      sidecarArgs: [],
      adbPath: process.env.SMOKE_ADB_EXE ?? "",
    },
  });

  const snapshot = await adapter.connect(created.sessionId);

  const steps: Array<{ step: string; result: unknown }> = [];

  steps.push({
    step: "resize-baseline",
    result: await adapter.resizeWindow(created.sessionId, 1000, 700),
  });

  await sleep(500);

  steps.push({
    step: "minimize",
    result: await adapter.minimizeWindow(created.sessionId),
  });

  await sleep(500);

  steps.push({
    step: "restore-and-focus",
    result: await adapter.focusWindow(created.sessionId),
  });

  await sleep(500);

  steps.push({
    step: "maximize",
    result: await adapter.maximizeWindow(created.sessionId),
  });

  await sleep(500);

  steps.push({
    step: "bring-to-front",
    result: await adapter.bringWindowToFront(created.sessionId),
  });

  return {
    name: "AdbAdapter Window State Transitions",
    ok: true,
    detail: {
      snapshot,
      steps,
    },
  };
}


async function smoketransformAdbAdapter(): Promise<SmokeResult> {
  const sessions = new SessionRegistry();
  const adapter = new AdbAdapter(sessions);

  const created = sessions.create({
    appKind: "adb-browser",
    state: "running",
    capabilities: ["launch", "attach", "navigate", "dom", "close"],
    pid: undefined,
    meta: {
      debugPort: envNum("SMOKE_ADB_DEBUG_PORT", 9222),
      sidecarExe: process.env.SMOKE_SIDECAR_EXE ?? "",
      sidecarArgs: [],
      adbPath: process.env.SMOKE_ADB_EXE ?? "",
    },
  });

  const snapshot = await adapter.connect(created.sessionId);

  

  let commandResult: unknown;

  commandResult = await adapter.transformWindow(created.sessionId, {
    width: 800,
    height: 600,
  });

  return {
    name: "AdbAdapter Transform",
    ok: true,
    detail: {
      snapshot,
      commandResult,
    },
  };
}

async function main(): Promise<void> {
  const target = (process.argv[2] ?? "all").toLowerCase();
  const results: SmokeResult[] = [];

  const run = async (name: string, fn: () => Promise<SmokeResult>) => {
    printHeader(name);
    try {
      const result = await fn();
      results.push(result);
      printResult(result);
    } catch (error) {
      const result: SmokeResult = {
        name,
        ok: false,
        detail: error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
      };
      results.push(result);
      printResult(result);
    }
  };

  if (target === "httpjson" || target === "all") {
    await run("HttpJsonClient", smokeHttpJsonClient);
  }

  if (target === "sidecar" || target === "all") {
    await run("SidecarClient", smokeSidecarClient);
  }

  if (target === "cdp" || target === "all") {
    await run("CdpClient", smokeCdpClient);
  }

  if (target === "vlc" || target === "all") {
    await run("VlcHttpAdapter", smokeVlcHttpAdapter);
  }

  if (target === "adb" || target === "all") {
    await run("AdbAdapter", smokeAdbAdapter);
  }

  if (target === "adb-transform" || target === "all") {
    await run("AdbAdapter Transform", smoketransformAdbAdapter);
  }

  if (target === "adb-window-states" || target === "all") {
    await run("AdbAdapter Window State Transitions", smokeAdbWindowStateTransitions);
  }


  printHeader("Summary");
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} - ${result.name}`);
  }

  if (results.some((r) => !r.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Fatal smoke runner failure:");
  console.error(error);
  process.exit(1);
});