import fs from "node:fs";
import path from "node:path";

export type DownloadStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "failed";

export type DownloadInfo = {
  id: string;
  url: string;
  fileName: string;
  filePath: string;
  status: DownloadStatus;
  percent: number;
  bytesReceived: number;
  totalBytes: number | null;
  startedAt: number;
  finishedAt?: number;
  error?: Error;
};

export type DownloadResult = {
  percent: number;
  error?: Error;
  filePath?: string;
};

export type DownloadOptions = {
  onFinish: (info: DownloadInfo) => void;
  onError: (error: Error) => void;
  onProgress?: (info: DownloadInfo) => void;
  downloadDir?: string;
  overwrite?: boolean;
  signal?: AbortSignal;
};

export class DownloadAdapter {
  private readonly downloads = new Map<string, DownloadInfo>();
  private nextId = 1;
  private readonly defaultDownloadDir: string;

  constructor(defaultDownloadDir?: string) {
    this.defaultDownloadDir =
      defaultDownloadDir ??
      path.join(process.cwd(), "downloads");
  }

  getDownload(id: string): DownloadInfo | undefined {
    const info = this.downloads.get(id);
    return info ? { ...info } : undefined;
  }

  getAllDownloads(): DownloadInfo[] {
    return Array.from(this.downloads.values()).map((info) => ({ ...info }));
  }

  clearFinished(): void {
    for (const [id, info] of this.downloads.entries()) {
      if (info.status === "completed" || info.status === "failed") {
        this.downloads.delete(id);
      }
    }
  }

  async download(
    url: string,
    fileName: string,
    options: DownloadOptions
  ): Promise<DownloadInfo> {
    const id = `download-${this.nextId++}`;
    const targetDir = options.downloadDir ?? this.defaultDownloadDir;

    fs.mkdirSync(targetDir, { recursive: true });

    const filePath = this.resolveTargetPath(
      targetDir,
      fileName,
      options.overwrite ?? false
    );

    const info: DownloadInfo = {
      id,
      url,
      fileName: path.basename(filePath),
      filePath,
      status: "pending",
      percent: 0,
      bytesReceived: 0,
      totalBytes: null,
      startedAt: Date.now(),
    };

    this.downloads.set(id, info);

    try {
      info.status = "in-progress";
      this.emitProgress(options, info);

      const response = await fetch(url, {
        signal: options.signal,
      });

      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
      }

      if (!response.body) {
        throw new Error(`Download response had no body for ${url}`);
      }

      const contentLengthHeader = response.headers.get("content-length");
      const totalBytes = contentLengthHeader
        ? Number.parseInt(contentLengthHeader, 10)
        : NaN;

      info.totalBytes = Number.isFinite(totalBytes) ? totalBytes : null;
      this.downloads.set(id, { ...info });

      const writer = fs.createWriteStream(filePath);
      const reader = response.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          if (options.signal?.aborted) {
            throw new Error(`Download aborted for ${url}`);
          }

          if (value && value.length > 0) {
            await this.writeChunk(writer, value);
            info.bytesReceived += value.length;

            if (info.totalBytes && info.totalBytes > 0) {
              info.percent = Math.min(
                100,
                Math.round((info.bytesReceived / info.totalBytes) * 100)
              );
            } else {
              info.percent = 0;
            }

            this.downloads.set(id, { ...info });
            this.emitProgress(options, info);
          }
        }

        await this.closeWriter(writer);
      } catch (error) {
        writer.destroy();

        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // ignore cleanup failure
        }

        throw error;
      }

      info.status = "completed";
      info.percent = 100;
      info.finishedAt = Date.now();

      this.downloads.set(id, { ...info });
      options.onFinish({ ...info });

      return { ...info };
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));

      info.status = "failed";
      info.error = normalized;
      info.finishedAt = Date.now();

      this.downloads.set(id, { ...info });
      options.onError(normalized);

      return { ...info };
    }
  }

  private emitProgress(options: DownloadOptions, info: DownloadInfo): void {
    if (options.onProgress) {
      options.onProgress({ ...info });
    }
  }

  private resolveTargetPath(
    downloadDir: string,
    requestedFileName: string,
    overwrite: boolean
  ): string {
    const safeName = path.basename(requestedFileName);
    const initialPath = path.join(downloadDir, safeName);

    if (overwrite || !fs.existsSync(initialPath)) {
      return initialPath;
    }

    const parsed = path.parse(safeName);

    let counter = 1;
    while (true) {
      const candidate = path.join(
        downloadDir,
        `${parsed.name} (${counter})${parsed.ext}`
      );

      if (!fs.existsSync(candidate)) {
        return candidate;
      }

      counter += 1;
    }
  }

  private writeChunk(
    writer: fs.WriteStream,
    chunk: Uint8Array
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      writer.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private closeWriter(writer: fs.WriteStream): Promise<void> {
    return new Promise((resolve, reject) => {
      writer.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

export default DownloadAdapter;