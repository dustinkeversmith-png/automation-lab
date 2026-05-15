import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DownloadAdapter,
  type DownloadInfo,
  type DownloadHandle,
} from "../src/main/automation/adapters/DownloadAdapter";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function logDownloadSnapshot(adapter: DownloadAdapter): void {
  const downloads = adapter.getAllDownloads();

  console.log("\n=== download snapshot ===");
  console.dir(
    downloads.map((item) => ({
      id: item.id,
      status: item.status,
      percent: item.percent,
      bytesReceived: item.bytesReceived,
      totalBytes: item.totalBytes,
      fileName: item.fileName,
      filePath: item.filePath,
    })),
    { depth: 6 }
  );
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

      if (
        last.status === "completed" ||
        last.status === "failed" ||
        last.status === "cancelled"
      ) {
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
  console.log("DownloadAdapter live smoke test");
  console.log("==================================================");
  console.log("Target URL:", targetUrl);
  console.log("Requested file name:", requestedFileName);
  console.log("Download directory:", downloadDir);

  const adapter = new DownloadAdapter(downloadDir);

  let finishedInfo: DownloadInfo | null = null;
  let finishedCalled = false;
  let errorCalled = false;
  let progressCalls = 0;

  const handle: DownloadHandle = adapter.download(targetUrl, requestedFileName, {
    downloadDir,
    onProgress(info) {
      progressCalls += 1;

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

  console.log("\n=== returned download handle ===");
  console.dir(
    {
      id: handle.id,
      info: handle.info,
    },
    { depth: 6 }
  );

  const immediateLookup = adapter.getDownload(handle.id);
  assert(immediateLookup, "Expected download to be immediately tracked");

  logDownloadSnapshot(adapter);

  const trackedFinal = await waitForDownloadToFinish(adapter, handle.id);
  const promisedFinal = await handle.promise;

  console.log("\n=== tracked final info ===");
  console.dir(trackedFinal, { depth: 6 });

  console.log("\n=== promised final info ===");
  console.dir(promisedFinal, { depth: 6 });

  assert(trackedFinal.status === "completed", "Expected tracked download to complete");
  assert(promisedFinal.status === "completed", "Expected promised download to complete");
  assert(finishedCalled, "Expected onFinish to have been called");
  assert(!errorCalled, "Did not expect onError to be called");
  assert(progressCalls > 0, "Expected onProgress to be called at least once");
  assert(finishedInfo != null, "Expected finishedInfo to be populated");
  assert(fs.existsSync(promisedFinal.filePath), "Expected downloaded file to exist");

  const stat = fs.statSync(promisedFinal.filePath);

  console.log("\n=== downloaded file stats ===");
  console.dir(
    {
      filePath: promisedFinal.filePath,
      size: stat.size,
    },
    { depth: 4 }
  );

  assert(stat.size > 0, "Expected downloaded file size to be > 0");
  assert(promisedFinal.percent === 100, "Expected final percent to be 100");

  logDownloadSnapshot(adapter);

  console.log("\nSmoke test completed successfully.");
}

main().catch((error) => {
  console.error("Smoke test failed:");
  console.error(error);
  process.exit(1);
});