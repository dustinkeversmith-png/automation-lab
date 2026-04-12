// scripts/chromiumDebugSmoke.ts

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { SessionRegistry } from "../src/main/automation/SessionRegistry";
import { ChromiumDebugAdapter } from "../src/main/automation/adapters/ChromiumDebugAdapter";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function send(
  adapter: ChromiumDebugAdapter,
  sessionId: string,
  type: string,
  payload?: Record<string, unknown>
): Promise<any> {
  const result = await adapter.send(sessionId, { type, payload } as any);
  console.log(`\n[${type}]`);
  console.dir(result, { depth: 6 });
  return result;
}

async function logWebFrameSnapshot(
  adapter: ChromiumDebugAdapter,
  sessionId: string
): Promise<void> {
  const snapshot = await send(adapter, sessionId, "getWebFrameDebugSnapshot");
  console.log("\n=== Web frame snapshot ===");
  console.dir(snapshot, { depth: 8 });
}

function getBrowserExe(): string {
  const fromEnv =
    process.env.CHROME_EXE ||
    process.env.BROWSER_EXE ||
    process.env.ADB_BROWSER_EXE;

  if (fromEnv) {
    return fromEnv;
  }

  if (process.platform === "win32") {
    const candidates = [
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
        : "",
      process.env["PROGRAMFILES"]
        ? path.join(process.env["PROGRAMFILES"], "Google", "Chrome", "Application", "chrome.exe")
        : "",
      process.env["PROGRAMFILES(X86)"]
        ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
        : "",
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
        : "",
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "AdblockBrowser", "Application", "adblockbrowser.exe")
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
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return process.env.BROWSER_COMMAND || "chrome";
}

function buildBrowserArgs(
  targetUrl: string,
  debugPort: number,
  userDataDir: string
): string[] {
  return [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--new-window",
    targetUrl,
  ];
}

function launchDebugBrowser(
  exePath: string,
  targetUrl: string,
  debugPort: number
): {
  process: ChildProcess;
  userDataDir: string;
} {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "chromium-debug-smoke-")
  );

  const args = buildBrowserArgs(targetUrl, debugPort, userDataDir);

  console.log("Launching browser:");
  console.log("  exe:", exePath);
  console.log("  args:", args);
  console.log("  userDataDir:", userDataDir);

  const child = spawn(exePath, args, {
    detached: false,
    stdio: "inherit",
    windowsHide: false,
  });

  child.on("exit", (code, signal) => {
    console.log(`Browser exited. code=${code} signal=${signal}`);
  });

  return {
    process: child,
    userDataDir,
  };
}

async function waitForDebuggerEndpoint(
  debugPort: number,
  timeoutMs: number = 20000,
  pollMs: number = 300
): Promise<void> {
  const started = Date.now();
  let lastError: unknown = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const data = await response.json();
        console.log("Debugger endpoint is ready. Targets:");
        console.dir(data, { depth: 5 });
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(pollMs);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for debugger endpoint");
}

async function getPageState(
  adapter: ChromiumDebugAdapter,
  sessionId: string
): Promise<{
  href: string;
  readyState: string;
  title: string;
  bodyText: string;
}> {
  const result = await adapter.send(sessionId, {
    type: "eval",
    payload: {
      expression: `
        ({
          href: location.href,
          readyState: document.readyState,
          title: document.title,
          bodyText: document.body ? document.body.innerText : ""
        })
      `
    }
  }) as any;

  const value =
    result?.result?.value ??
    result?.value ??
    result;

  return {
    href: String(value?.href ?? ""),
    readyState: String(value?.readyState ?? ""),
    title: String(value?.title ?? ""),
    bodyText: String(value?.bodyText ?? "")
  };
}

async function waitForPageLoad(
  adapter: ChromiumDebugAdapter,
  sessionId: string,
  expectedUrl: string,
  timeoutMs: number = 20000,
  pollMs: number = 250
): Promise<{
  ok: boolean;
  href: string;
  title: string;
  readyState: string;
  elapsedMs: number;
}> {
  const started = Date.now();
  let lastState: {
    href: string;
    readyState: string;
    title: string;
    bodyText: string;
  } | null = null;

  while (Date.now() - started < timeoutMs) {
    lastState = await getPageState(adapter, sessionId);

    const urlMatches =
      lastState.href === expectedUrl ||
      lastState.href.startsWith(expectedUrl);

    const ready =
      lastState.readyState === "interactive" ||
      lastState.readyState === "complete";

    if (urlMatches && ready) {
      return {
        ok: true,
        href: lastState.href,
        title: lastState.title,
        readyState: lastState.readyState,
        elapsedMs: Date.now() - started
      };
    }

    await sleep(pollMs);
  }

  return {
    ok: false,
    href: lastState?.href ?? "",
    title: lastState?.title ?? "",
    readyState: lastState?.readyState ?? "",
    elapsedMs: Date.now() - started
  };
}

async function waitForPageContents(
  adapter: ChromiumDebugAdapter,
  sessionId: string,
  expectedUrl: string,
  contentExample: string | string[] | null,
  timeoutMs: number = 25000,
  pollMs: number = 300
): Promise<{
  ok: boolean;
  href: string;
  title: string;
  readyState: string;
  matchedContent: string | null;
  elapsedMs: number;
}> {
  const started = Date.now();
  const wanted = contentExample == null
    ? []
    : Array.isArray(contentExample)
      ? contentExample
      : [contentExample];

  let lastState: {
    href: string;
    readyState: string;
    title: string;
    bodyText: string;
  } | null = null;

  while (Date.now() - started < timeoutMs) {
    lastState = await getPageState(adapter, sessionId);

    const urlMatches =
      lastState.href === expectedUrl ||
      lastState.href.startsWith(expectedUrl);

    const ready =
      lastState.readyState === "interactive" ||
      lastState.readyState === "complete";

    if (urlMatches && ready) {
      if (wanted.length === 0) {
        return {
          ok: true,
          href: lastState.href,
          title: lastState.title,
          readyState: lastState.readyState,
          matchedContent: null,
          elapsedMs: Date.now() - started
        };
      }

      const matched = wanted.find((text) => lastState!.bodyText.includes(text)) ?? null;
      if (matched) {
        return {
          ok: true,
          href: lastState.href,
          title: lastState.title,
          readyState: lastState.readyState,
          matchedContent: matched,
          elapsedMs: Date.now() - started
        };
      }
    }

    await sleep(pollMs);
  }

  return {
    ok: false,
    href: lastState?.href ?? "",
    title: lastState?.title ?? "",
    readyState: lastState?.readyState ?? "",
    matchedContent: null,
    elapsedMs: Date.now() - started
  };
}

async function waitForDocumentComplete(
  adapter: ChromiumDebugAdapter,
  sessionId: string,
  timeoutMs: number = 15000,
  pollMs: number = 250
): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const result = await send(adapter, sessionId, "eval", {
      expression: "document.readyState"
    });

    //console.log("Current return expression.", result);

    const readyState =
      result.params?.returnByValue ??
      result?.result?.value ??
      result?.value ??
      result;

    if (readyState === "complete" || readyState === "interactive") {
        console.log("Document ready status is complete.");
      return;
    }

    await sleep(pollMs);
  }

  throw new Error("Timed out waiting for top-level document readiness");
}

async function clickServerOption(
  adapter: ChromiumDebugAdapter,
  sessionId: string,
  type: "sub" | "dub",
  serverId: string,
  label: string
): Promise<void> {
  const selector = `.item .server-item[data-type="${type}"][data-server-id="${serverId}"]`;

  console.log(`\n--- Clicking ${label} using selector: ${selector}`);

  const exists = await send(adapter, sessionId, "querySelector", {
    selector
  });

  assert(exists?.ok === true, `Expected server option to exist: ${selector}`);

  const clickResult = await send(adapter, sessionId, "clickElement", {
    selector
  });

  assert(clickResult?.ok === true, `Expected clickElement to succeed for ${selector}`);

  await sleep(3000);
}

async function inspectIframe(
  adapter: ChromiumDebugAdapter,
  sessionId: string,
  iframeSelector: string
): Promise<void> {

  await adapter.send(sessionId, {
    type: "waitForIframeReady",
    payload: {
      iframeSelector: "#iframe-embed",
      loadingSelector: "#embed-loading",
      timeoutMs: 20000,
      pollMs: 300,
      requiredFrameSelector: "video, button, [role='button']",
      expectedIframeSrcIncludes: "rapid-cloud.co"
    }
  });

    await logWebFrameSnapshot(adapter, sessionId);




  const frameInfo = await send(adapter, sessionId, "getFrameForSelector", {
    iframeSelector
  });

  console.log("getFrameForSelector result:", frameInfo);

  console.log("Using selector as", iframeSelector);

  assert(frameInfo?.ok === true, `Expected iframe frame to resolve for ${iframeSelector}`);
  assert(frameInfo?.frameId, `Expected non-empty frameId for ${iframeSelector}`);

  const iframeProbe = await send(adapter, sessionId, "querySelectorInFrame", {
    iframeSelector,
    selector: "iframe"
  });

  console.log("iframeProbe summary:", iframeProbe);

  const waitResult = await send(adapter, sessionId, "waitForSelectorInFrame", {
    iframeSelector,
    selector: "video, button, [role='button'], input[type='range']",
    timeoutMs: 15000,
    pollMs: 400
  });

  console.log("waitForSelectorInFrame summary:", waitResult);

  const inventory = await send(adapter, sessionId, "querySelectorAllInFrame", {
    iframeSelector,
    selector: "video, button, [role='button'], input, .jw-icon, .vjs-control, [class*='play'], [class*='pause']"
  });

  console.log("iframe control inventory count:", inventory?.count ?? 0);

  const frameEval = await send(adapter, sessionId, "evaluateInFrame", {
    iframeSelector,
    expression: `
      (() => {
        const video = document.querySelector("video");
        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          hasVideo: !!video,
          video: video ? {
            currentSrc: video.currentSrc || null,
            src: video.src || null,
            paused: typeof video.paused === "boolean" ? video.paused : null,
            volume: typeof video.volume === "number" ? video.volume : null,
            currentTime: typeof video.currentTime === "number" ? video.currentTime : null
          } : null
        };
      })()
    `
  });

  console.log("evaluateInFrame summary:", frameEval);
}

async function testIframeInteractions(
  adapter: ChromiumDebugAdapter,
  sessionId: string,
  iframeSelector: string
): Promise<void> {
  console.log("\n=== Testing iframe interactions ===");

  const tryPlayClick = await send(adapter, sessionId, "clickInFrame", {
    iframeSelector,
    selector: "button, .jw-icon-play, .vjs-big-play-button, [class*='play'], [role='button']"
  });

  console.log("clickInFrame result:", tryPlayClick);

  const tryCoordClick = await send(adapter, sessionId, "clickInFrameUsingCoordinates", {
    iframeSelector,
    selector: "video, .jw-video, .vjs-tech, button, [role='button']"
  });

  console.log("clickInFrameUsingCoordinates result:", tryCoordClick);

  const trySlider = await send(adapter, sessionId, "inputInFrame", {
    iframeSelector,
    selector: 'input[type="range"]',
    value: 0.5
  });

  console.log("inputInFrame result:", trySlider);

  const postEval = await send(adapter, sessionId, "evaluateInFrame", {
    iframeSelector,
    expression: `
      (() => {
        const video = document.querySelector("video");
        return {
          hasVideo: !!video,
          paused: video ? video.paused : null,
          volume: video ? video.volume : null,
          currentTime: video ? video.currentTime : null
        };
      })()
    `
  });

  console.log("post interaction iframe state:", postEval);
}

async function main() {
  const sessions = new SessionRegistry();
  const adapter = new ChromiumDebugAdapter(sessions);

  const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9222);
  const targetUrl =
    process.env.CHROME_TEST_URL ??
    "https://9animetv.to/watch/dragon-ball-509?ep=10218";

  const iframeSelector =
    process.env.CHROME_TEST_IFRAME_SELECTOR ?? "#iframe-embed";

  const browserExe = getBrowserExe();

  console.log("==================================================");
  console.log("ChromiumDebugAdapter live iframe smoke test");
  console.log("==================================================");
  console.log("Debug port:", debugPort);
  console.log("Target URL:", targetUrl);
  console.log("Iframe selector:", iframeSelector);
  console.log("Browser executable:", browserExe);

  const launched = launchDebugBrowser(browserExe, targetUrl, debugPort);

  const cleanup = () => {
    try {
      if (!launched.process.killed) {
        launched.process.kill();
      }
    } catch {
      // ignore
    }

    try {
      fs.rmSync(launched.userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  process.on("exit", () => {
    cleanup();
  });

  await waitForDebuggerEndpoint(debugPort, 25000, 400);

  const created = sessions.create({
    appKind: "adb-browser",
    state: "running",
    capabilities: ["launch", "attach", "navigate", "dom", "close"],
    meta: {
      debugPort,
      browserExe,
      launchedBySmokeTest: true,
      browserUserDataDir: launched.userDataDir,
    },
  });

  console.log("Session created:", created.sessionId);

  const snapshot = await adapter.connect(created.sessionId);

  

  await logWebFrameSnapshot(adapter, created.sessionId);
  console.log("Connect snapshot:", snapshot);

  assert(snapshot.state === "ready", "Expected session state to be 'ready'");
  assert(
    snapshot.endpoint === `http://127.0.0.1:${debugPort}`,
    `Expected endpoint http://127.0.0.1:${debugPort}`
  );

  // Add obligatory wait sleep
  
  //await sleep(1000); // 1 second

  const pageLoad = await waitForPageLoad(
    adapter,
    created.sessionId,
    targetUrl,
    20000,
    300
    );

    console.log("waitForPageLoad:", pageLoad);
    assert(pageLoad.ok, `Page did not finish loading for URL ${targetUrl}`);

    const pageContents = await waitForPageContents(
    adapter,
    created.sessionId,
    targetUrl,
    ["Dragon Ball", "Vidcloud", "Vidstreaming"],
    25000,
    300
    );

    console.log("waitForPageContents:", pageContents);
    assert(
    pageContents.ok,
    `Expected page contents did not appear for URL ${targetUrl}`
    );

  

  await send(adapter, created.sessionId, "getTitle");

  await send(adapter, created.sessionId, "eval", {
    expression: `
      ({
        href: location.href,
        title: document.title,
        readyState: document.readyState
      })
    `,
  });

  await logWebFrameSnapshot(adapter, created.sessionId);

  console.log("\n=== Initial iframe inspection ===");
  await inspectIframe(adapter, created.sessionId, iframeSelector);

  console.log("\n=== Initial iframe interaction attempts ===");
  await testIframeInteractions(adapter, created.sessionId, iframeSelector);

  console.log("\n=== Testing server options on parent page ===");

//   await clickServerOption(adapter, created.sessionId, "sub", "4", "SUB Vidstreaming");
//   await inspectIframe(adapter, created.sessionId, iframeSelector);

//   await clickServerOption(adapter, created.sessionId, "sub", "1", "SUB Vidcloud");
//   await inspectIframe(adapter, created.sessionId, iframeSelector);

//   await clickServerOption(adapter, created.sessionId, "sub", "6", "SUB DouVideo");
//   await inspectIframe(adapter, created.sessionId, iframeSelector);

//   await clickServerOption(adapter, created.sessionId, "dub", "4", "DUB Vidstreaming");
//   await inspectIframe(adapter, created.sessionId, iframeSelector);

//   await clickServerOption(adapter, created.sessionId, "dub", "1", "DUB Vidcloud");
//   await inspectIframe(adapter, created.sessionId, iframeSelector);

//   await clickServerOption(adapter, created.sessionId, "dub", "6", "DUB DouVideo");
//   await inspectIframe(adapter, created.sessionId, iframeSelector);

  console.log("\nSmoke test completed successfully.");
}

main().catch((error) => {
  console.error("Smoke test failed:");
  console.error(error);
  process.exit(1);
});