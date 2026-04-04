// scripts/chromiumDebugSmoke.ts

import { SessionRegistry } from "../src/main/automation/SessionRegistry";
import { ChromiumDebugAdapter } from "../src/main/automation/adapters/ChromiumDebugAdapter";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const sessions = new SessionRegistry();
  const adapter = new ChromiumDebugAdapter(sessions);

  const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9222);
  const targetUrl = process.env.CHROME_TEST_URL ?? "https://example.com";

  console.log("==================================================");
  console.log("ChromiumDebugAdapter live smoke test");
  console.log("==================================================");
  console.log("Debug port:", debugPort);
  console.log("Target URL:", targetUrl);

  const created = sessions.create({
    appKind: "adb-browser",
    state: "running",
    capabilities: ["launch", "attach", "navigate", "dom", "close"],
    meta: {
      debugPort,
    },
  });

  console.log("Session created:", created.sessionId);

  const snapshot = await adapter.connect(created.sessionId);
  console.log("Connect snapshot:", snapshot);

  assert(snapshot.state === "ready", "Expected session state to be 'ready'");
  assert(
    snapshot.endpoint === `http://127.0.0.1:${debugPort}`,
    `Expected endpoint http://127.0.0.1:${debugPort}`
  );

  const navigateResult = await adapter.send(created.sessionId, {
    type: "navigate",
    payload: { url: targetUrl },
  });
  console.log("Navigate result:", navigateResult);

  const titleResult = await adapter.send(created.sessionId, {
    type: "getTitle",
  });
  console.log("Title result:", titleResult);

  const evalResult = await adapter.send(created.sessionId, {
    type: "eval",
    payload: {
      expression: "({ href: location.href, title: document.title, readyState: document.readyState })",
    },
  });
  console.log("Eval result:", evalResult);

  console.log("Smoke test completed successfully.");
}

main().catch((error) => {
  console.error("Smoke test failed:");
  console.error(error);
  process.exit(1);
});