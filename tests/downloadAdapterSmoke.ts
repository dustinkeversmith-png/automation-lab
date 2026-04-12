import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DownloadAdapter, type DownloadInfo } from "../src/main/automation/adapters/DownloadAdapter";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDownloadToFinish(
  adapter: DownloadAdapter,
  downloadId: string,
  timeoutMs: number = 30000,
  pollMs: number = 250
): Promise<DownloadInfo> {
  const started = Date.now();
  let last: DownloadInfo | undefined;

  while (Date.now() - started < timeoutMs) {
    last = adapter.getDownload(downloadId);

    if (last) {
      console.log("[download status]", {
        id: last.id,
        status: last.status,
        percent: last.percent,
        bytesReceived: last.bytesReceived,
        totalBytes: last.totalBytes,
        filePath: last.filePath,
      });

      if (last.status === "completed" || last.status === "failed") {
        return last;
      }
    }

    await sleep(pollMs);
  }

  throw new Error(
    `Timed out waiting for download ${downloadId} to finish. Last state: ${JSON.stringify(last)}`
  );
}

async function main() {
  const targetUrl =
    process.env.DOWNLOAD_TEST_URL ??
    "https://proof.ovh.net/files/1Mb.dat";

  const requestedFileName =
    process.env.DOWNLOAD_TEST_FILE_NAME ??
    "download-smoke.bin";

  const downloadDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "download-adapter-smoke-")
  );

  console.log("==================================================");
  console.log("DownloadAdapter smoke test");
  console.log("==================================================");
  console.log("Target URL:", targetUrl);
  console.log("Requested file name:", requestedFileName);
  console.log("Download directory:", downloadDir);

  const adapter = new DownloadAdapter(downloadDir);

  let finishedInfo: DownloadInfo | null = null;
  let finishedCalled = false;
  let errorCalled = false;

  const startedPromise = adapter.download(targetUrl, requestedFileName, {
    downloadDir,
    onProgress(info) {
      console.log("[onProgress]", {
        id: info.id,
        status: info.status,
        percent: info.percent,
        bytesReceived: info.bytesReceived,
        totalBytes: info.totalBytes,
      });
    },
    onFinish(info) {
      finishedCalled = true;
      finishedInfo = info;

      console.log("[onFinish]", {
        id: info.id,
        status: info.status,
        percent: info.percent,
        filePath: info.filePath,
        bytesReceived: info.bytesReceived,
        totalBytes: info.totalBytes,
      });
    },
    onError(error) {
      errorCalled = true;
      console.error("[onError]", error);
    },
  });

  const immediateInfo = await startedPromise;

  console.log("[initial returned info]");
  console.dir(immediateInfo, { depth: 5 });

  const finalInfo = await waitForDownloadToFinish(adapter, immediateInfo.id);

  console.log("\n=== final download info ===");
  console.dir(finalInfo, { depth: 6 });

  assert(finalInfo.status === "completed", "Expected download to complete");
  assert(finishedCalled, "Expected onFinish to have been called");
  assert(!errorCalled, "Did not expect onError to be called");
  assert(finishedInfo != null, "Expected finishedInfo to be populated");
  assert(fs.existsSync(finalInfo.filePath), "Expected downloaded file to exist");

  const stat = fs.statSync(finalInfo.filePath);
  console.log("\n=== downloaded file stats ===");
  console.dir(
    {
      filePath: finalInfo.filePath,
      size: stat.size,
    },
    { depth: 4 }
  );

  assert(stat.size > 0, "Expected downloaded file size to be > 0");

  console.log("\nSmoke test completed successfully.");
}

main().catch((error) => {
  console.error("Smoke test failed:");
  console.error(error);
  process.exit(1);
});