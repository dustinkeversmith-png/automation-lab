// scripts/thoriumReaderSmoke.ts

import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { SessionRegistry } from "../src/main/automation/SessionRegistry";
import { ThoriumAdapter } from "../src/main/automation/adapters/ThoriumAdapter";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function send(
  adapter: ThoriumAdapter,
  sessionId: string,
  type: string,
  payload?: Record<string, unknown>
): Promise<any> {
  const result = await adapter.send(sessionId, { type, payload } as any);
  console.log(`\n[${type}]`);
  console.dir(result, { depth: 8 });
  return result;
}

function getThoriumExe(): string {
  const fromEnv =
    process.env.THORIUM_EXE ||
    process.env.THORIUM_READER_EXE ||
    process.env.EREADER_EXE;

  if (fromEnv) {
    return fromEnv;
  }

  if (process.platform === "win32") {
    const candidates = [
      process.env.LOCALAPPDATA
        ? path.join(
            process.env.LOCALAPPDATA,
            "Programs",
            "Thorium",
            "Thorium Reader.exe"
          )
        : "",
      process.env.LOCALAPPDATA
        ? path.join(
            process.env.LOCALAPPDATA,
            "Programs",
            "EDRLab.ThoriumReader",
            "Thorium Reader.exe"
          )
        : "",
      process.env["PROGRAMFILES"]
        ? path.join(
            process.env["PROGRAMFILES"],
            "Thorium Reader",
            "Thorium Reader.exe"
          )
        : "",
      process.env["PROGRAMFILES(X86)"]
        ? path.join(
            process.env["PROGRAMFILES(X86)"],
            "Thorium Reader",
            "Thorium Reader.exe"
          )
        : "",
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  if (process.platform === "darwin") {
    const candidates = [
      "/Applications/Thorium Reader.app/Contents/MacOS/Thorium Reader",
      "/Applications/Thorium.app/Contents/MacOS/Thorium",
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return "thorium";
}

function getSidecarExe(): string {
  const fromEnv =
    process.env.SIDECAR_EXE ||
    process.env.AUTOMATION_SIDECAR_EXE ||
    process.env.THORIUM_SIDECAR_EXE;

  if (!fromEnv) {
    throw new Error(
      "Missing sidecar executable. Set SIDECAR_EXE or AUTOMATION_SIDECAR_EXE."
    );
  }

  return fromEnv;
}

function getBookPath(): string {
  const fromEnv =
    process.env.THORIUM_BOOK_PATH ||
    process.env.BOOK_PATH ||
    process.env.EPUB_PATH;

  if (!fromEnv) {
    throw new Error(
      "Missing book path. Set THORIUM_BOOK_PATH (or BOOK_PATH / EPUB_PATH)."
    );
  }

  if (!fs.existsSync(fromEnv)) {
    throw new Error(`Book path does not exist: ${fromEnv}`);
  }

  return fromEnv;
}

async function waitForWindow(
  adapter: ThoriumAdapter,
  sessionId: string,
  timeoutMs = 20000,
  pollMs = 500
): Promise<any> {
  const started = Date.now();
  let lastError: unknown;

  while (Date.now() - started < timeoutMs) {
    try {
      const result = await send(adapter, sessionId, "findWindow");
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(pollMs);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for Thorium window");
}

async function waitForStatusReady(
  adapter: ThoriumAdapter,
  sessionId: string,
  timeoutMs = 10000,
  pollMs = 400
): Promise<any> {
  const started = Date.now();
  let lastStatus: any = null;

  while (Date.now() - started < timeoutMs) {
    lastStatus = await send(adapter, sessionId, "status");

    if (
      lastStatus &&
      (lastStatus.window || lastStatus.pid || lastStatus.mode === "thorium-uia")
    ) {
      return lastStatus;
    }

    await sleep(pollMs);
  }

  return lastStatus;
}

async function exerciseReaderCommands(
  adapter: ThoriumAdapter,
  sessionId: string
): Promise<void> {
  console.log("\n==================================================");
  console.log("Thorium reader command smoke sequence");
  console.log("==================================================");

  await send(adapter, sessionId, "focus");
  await sleep(1000);

  await send(adapter, sessionId, "nextPage");
  await sleep(1200);

  await send(adapter, sessionId, "previousPage");
  await sleep(1200);

  await send(adapter, sessionId, "toggleBookmark");
  await sleep(1000);

  await send(adapter, sessionId, "focusReaderSettings");
  await sleep(1500);

  await send(adapter, sessionId, "toggleAutoRead");
  await sleep(2500);

  await send(adapter, sessionId, "ttsNext");
  await sleep(1500);

  await send(adapter, sessionId, "ttsPrevious");
  await sleep(1500);

  await send(adapter, sessionId, "toggleAutoRead");
  await sleep(1500);

  await send(adapter, sessionId, "toggleFullscreen");
  await sleep(1500);

  await send(adapter, sessionId, "toggleFullscreen");
  await sleep(1500);
}

async function main() {
  const sessions = new SessionRegistry();
  const adapter = new ThoriumAdapter(sessions);

  const thoriumExe = getThoriumExe();
  const sidecarExe = getSidecarExe();
  const bookPath = getBookPath();
  const autoLaunch = String(process.env.THORIUM_AUTO_LAUNCH ?? "false") === "true";

  console.log("==================================================");
  console.log("ThoriumAdapter live smoke test");
  console.log("==================================================");
  console.log("Thorium executable:", thoriumExe);
  console.log("Sidecar executable:", sidecarExe);
  console.log("Book path:", bookPath);
  console.log("Auto launch:", autoLaunch);

  const created = sessions.create({
    appKind: "thorium",
    state: "running",
    capabilities: ["launch", "attach", "uia", "openResource", "close"],
    meta: {
      thoriumExe,
      sidecarExe,
      autoLaunch,
      launchedBySmokeTest: true,
      smokeBookPath: bookPath,
    },
  });

  console.log("Session created:", created.sessionId);

  const snapshot = await adapter.connect(created.sessionId);
  console.log("Connect snapshot:");
  console.dir(snapshot, { depth: 6 });

  assert(snapshot.state === "ready", "Expected session state to be 'ready'");
  assert(
    snapshot.endpoint === "sidecar://thorium-uia",
    `Expected endpoint sidecar://thorium-uia, received ${snapshot.endpoint}`
  );

  if (!autoLaunch) {
    console.log("\nLaunching Thorium from adapter...");
    await send(adapter, created.sessionId, "launch", {
      files: [bookPath],
    });
  }

  console.log("\nWaiting for Thorium window...");
  const win = await waitForWindow(adapter, created.sessionId, 25000, 500);
  console.log("Thorium window:");
  console.dir(win, { depth: 6 });

  console.log("\nChecking adapter status...");
  const status = await waitForStatusReady(adapter, created.sessionId, 12000, 500);
  console.log("Thorium status:");
  console.dir(status, { depth: 6 });

  console.log("\nOpening book through adapter...");
  await send(adapter, created.sessionId, "openFile", {
    file: bookPath,
  });

  await sleep(4000);

  console.log("\nAttaching to current reader window...");
  await send(adapter, created.sessionId, "attach");

  await sleep(2000);

  await exerciseReaderCommands(adapter, created.sessionId);

  console.log("\nSmoke test completed successfully.");
  console.log("Thorium should still be open for manual inspection.");
}

main().catch((error) => {
  console.error("Thorium smoke test failed:");
  console.error(error);
  process.exit(1);
});