import { BaseAdapter } from "./BaseAdapter";
import { SidecarClient } from "../transports/SidecarClient";
import type { AppKind, CommandRequest, SessionSnapshot } from "../types";
import { AutomationCapability } from "../types";

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";

export type TorrentJobState =
  | "pending"
  | "launching"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "removed";

export type TorrentSourceKind = "file" | "magnet" | "torrent-url";

export type TorrentInfo = {
  id: string;
  source: string;
  sourceKind: TorrentSourceKind;
  fileName?: string;
  filePath?: string;
  savePath?: string;
  status: TorrentJobState;
  createdAt: number;
  updatedAt: number;
  processId?: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

type TorrentControlAction =
  | "focus"
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "remove";

type SidecarUiAction =
  | {
      method: "sidecar";
      sidecarMethod: string;
      args?: Record<string, unknown>;
    }
  | {
      method: "keys";
      keys: string[];
    };

type TorrentAdapterMeta = {
  sidecarExe?: string;
  bittorrentExe?: string;
  autoLaunch?: boolean;
  detached?: boolean;
  tempDir?: string;
  savePath?: string;
  extraLaunchArgs?: string[];
  processId?: number;
  mainWindowTitle?: string;
  controllerMode?: "none" | "sidecar-config";
  controlBindings?: Partial<Record<TorrentControlAction, SidecarUiAction>>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMagnetUri(value: string): boolean {
  return /^magnet:\?/i.test(value);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikeTorrentUrl(value: string): boolean {
  return isHttpUrl(value) && /\.torrent(\?|#|$)/i.test(value);
}

function looksLikeTorrentFile(value: string): boolean {
  return /\.torrent$/i.test(value);
}

function getFileNameFromPath(filePath: string): string {
  return path.basename(filePath);
}

function getSafeTempRoot(custom?: string): string {
  return custom && custom.trim().length > 0
    ? custom
    : path.join(os.tmpdir(), "automation-lab", "torrents");
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class TorrentAdapter extends BaseAdapter {
    readonly appKind = "torrent" as AppKind;

  readonly capabilities = [
    "launch",
    "attach",
    "downloads",
    "close",
  ] as AutomationCapability[];

  private readonly sidecar = new SidecarClient();
  private sidecarStarted = false;

  private readonly jobsBySession = new Map<string, Map<string, TorrentInfo>>();

  private getJobs(sessionId: string): Map<string, TorrentInfo> {
    let jobs = this.jobsBySession.get(sessionId);
    if (!jobs) {
      jobs = new Map<string, TorrentInfo>();
      this.jobsBySession.set(sessionId, jobs);
    }
    return jobs;
  }

  private getMeta(session: SessionSnapshot): TorrentAdapterMeta {
    return (session.meta ?? {}) as TorrentAdapterMeta;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async ensureSidecarStarted(sidecarExe: string): Promise<void> {
    if (this.sidecarStarted) return;
    this.sidecar.start(sidecarExe);
    this.sidecarStarted = true;
  }

  private async ensureTempDir(session: SessionSnapshot): Promise<string> {
    const meta = this.getMeta(session);
    const root = getSafeTempRoot(meta.tempDir);
    await fs.mkdir(root, { recursive: true });
    return root;
  }

  private async ensureBitTorrentLaunched(sessionId: string): Promise<void> {
    const session = await this.getState(sessionId);
    const meta = this.getMeta(session);

    if (!meta.autoLaunch) return;

    const sidecarExe = String(meta.sidecarExe ?? "");
    const bittorrentExe = String(meta.bittorrentExe ?? "");

    if (!sidecarExe) {
      throw new Error("Missing sidecarExe in session metadata");
    }
    if (!bittorrentExe) {
      throw new Error("Missing bittorrentExe in session metadata");
    }

    await this.ensureSidecarStarted(sidecarExe);

    const launchResult = await this.sidecar.send(
      "launchProcess",
      {
        exePath: bittorrentExe,
        args: Array.isArray(meta.extraLaunchArgs) ? meta.extraLaunchArgs : [],
        detached: meta.detached ?? true,
      },
      { timeoutMs: 15000 }
    );

    const processId =
      launchResult &&
      typeof launchResult === "object" &&
      "processId" in (launchResult as Record<string, unknown>)
        ? Number((launchResult as Record<string, unknown>).processId)
        : undefined;

    await this.sessions.update(sessionId, {
      meta: {
        ...(session.meta ?? {}),
        processId: Number.isFinite(processId) ? processId : meta.processId,
      },
    });
  }

  private async downloadTorrentFile(
    session: SessionSnapshot,
    url: string
  ): Promise<string> {
    const tempRoot = await this.ensureTempDir(session);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch torrent URL: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const buf = Buffer.from(await response.arrayBuffer());

    let baseName = "download.torrent";
    try {
      const parsed = new URL(url);
      const maybeName = path.basename(parsed.pathname);
      if (maybeName && maybeName !== "/") {
        baseName = maybeName;
      }
    } catch {
      // ignore malformed URL parsing here, fetch would have failed earlier for truly invalid URLs
    }

    if (!looksLikeTorrentFile(baseName)) {
      baseName = `${baseName.replace(/[^\w.-]+/g, "_")}.torrent`;
    }

    const filePath = path.join(
      tempRoot,
      `${Date.now()}-${randomUUID()}-${baseName}`
    );

    await fs.writeFile(filePath, buf);

    // Soft validation only; some servers use generic octet-stream.
    if (
      contentType &&
      !/application\/x-bittorrent|application\/octet-stream|binary\/octet-stream/i.test(
        contentType
      ) &&
      !looksLikeTorrentFile(filePath)
    ) {
      throw new Error(
        `Downloaded resource does not look like a torrent file (content-type: ${contentType})`
      );
    }

    return filePath;
  }

  private async resolveTorrentSource(
    sessionId: string,
    payload: Record<string, unknown>
  ): Promise<{
    sourceToLaunch: string;
    sourceKind: TorrentSourceKind;
    downloadedTorrentFile?: string;
    displayName?: string;
  }> {
    const session = await this.getState(sessionId);

    const raw =
      (payload.uri as string | undefined) ??
      (payload.url as string | undefined) ??
      (payload.magnet as string | undefined) ??
      (payload.filePath as string | undefined) ??
      (payload.source as string | undefined);

    if (!isNonEmptyString(raw)) {
      throw new Error("Missing torrent source. Expected filePath, magnet, url, uri, or source.");
    }

    const source = raw.trim();

    if (isMagnetUri(source)) {
      return {
        sourceToLaunch: source,
        sourceKind: "magnet",
        displayName: source,
      };
    }

    if (looksLikeTorrentFile(source)) {
      return {
        sourceToLaunch: source,
        sourceKind: "file",
        displayName: getFileNameFromPath(source),
      };
    }

    if (looksLikeTorrentUrl(source) || isHttpUrl(source)) {
      const downloadedTorrentFile = await this.downloadTorrentFile(session, source);
      return {
        sourceToLaunch: downloadedTorrentFile,
        sourceKind: "torrent-url",
        downloadedTorrentFile,
        displayName: getFileNameFromPath(downloadedTorrentFile),
      };
    }

    throw new Error(
      "Unsupported torrent source. Expected magnet link, .torrent file path, or URL to a .torrent file."
    );
  }

  private async launchBitTorrentWithSource(
    sessionId: string,
    sourceToLaunch: string
  ): Promise<{ processId?: number }> {
    const session = await this.getState(sessionId);
    const meta = this.getMeta(session);

    const sidecarExe = String(meta.sidecarExe ?? "");
    const bittorrentExe = String(meta.bittorrentExe ?? "");

    if (!sidecarExe) {
      throw new Error("Missing sidecarExe in session metadata");
    }
    if (!bittorrentExe) {
      throw new Error("Missing bittorrentExe in session metadata");
    }

    await this.ensureSidecarStarted(sidecarExe);

    const args = [
      ...(Array.isArray(meta.extraLaunchArgs) ? meta.extraLaunchArgs : []),
      sourceToLaunch,
    ];

    const result = await this.sidecar.send(
      "launchProcess",
      {
        exePath: bittorrentExe,
        args,
        detached: meta.detached ?? true,
      },
      { timeoutMs: 15000 }
    );

    const processId =
      result &&
      typeof result === "object" &&
      "processId" in (result as Record<string, unknown>)
        ? Number((result as Record<string, unknown>).processId)
        : undefined;

    const current = await this.getState(sessionId);
    await this.sessions.update(sessionId, {
      meta: {
        ...(current.meta ?? {}),
        processId: Number.isFinite(processId) ? processId : (current.meta?.processId as number | undefined),
      },
    });

    return { processId: Number.isFinite(processId) ? processId : undefined };
  }

  private createJob(
    sessionId: string,
    init: Omit<TorrentInfo, "id" | "createdAt" | "updatedAt">
  ): TorrentInfo {
    const now = Date.now();
    const job: TorrentInfo = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...init,
    };

    this.getJobs(sessionId).set(job.id, job);
    return job;
  }

  private updateJob(
    sessionId: string,
    jobId: string,
    patch: Partial<TorrentInfo>
  ): TorrentInfo {
    const jobs = this.getJobs(sessionId);
    const current = jobs.get(jobId);
    if (!current) {
      throw new Error(`Unknown torrent job: ${jobId}`);
    }

    const next: TorrentInfo = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };

    jobs.set(jobId, next);
    return next;
  }

  private listJobs(sessionId: string): TorrentInfo[] {
    return Array.from(this.getJobs(sessionId).values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  private async focusBitTorrentWindow(sessionId: string): Promise<void> {
    const session = await this.getState(sessionId);
    const meta = this.getMeta(session);

    if (!meta.sidecarExe) {
      throw new Error("Missing sidecarExe in session metadata");
    }

    await this.ensureSidecarStarted(meta.sidecarExe);

    const processId = Number(meta.processId ?? 0);
    if (!Number.isFinite(processId) || processId <= 0) {
      return;
    }

    // This assumes your sidecar already supports these methods,
    // or that you'll add them to match your other adapters.
    const window = await this.sidecar.send(
      "findWindowByProcessId",
      { processId },
      { timeoutMs: 5000 }
    );

    const hwnd =
      window &&
      typeof window === "object" &&
      "hwnd" in (window as Record<string, unknown>)
        ? (window as Record<string, unknown>).hwnd
        : undefined;

    if (hwnd == null) return;

    await this.sidecar.send(
      "transformWindow",
      {
        hwnd,
        bringToFront: true,
        focus: true,
      },
      { timeoutMs: 5000 }
    );
  }

  private async invokeConfiguredControl(
    sessionId: string,
    action: TorrentControlAction,
    payload?: Record<string, unknown>
  ): Promise<unknown> {
    const session = await this.getState(sessionId);
    const meta = this.getMeta(session);

    if (meta.controllerMode !== "sidecar-config") {
      throw new Error(
        `Torrent control "${action}" is not configured. ` +
          `Set session.meta.controllerMode="sidecar-config" and provide controlBindings.`
      );
    }

    const binding = meta.controlBindings?.[action];
    if (!binding) {
      throw new Error(`No control binding configured for action "${action}"`);
    }

    if (!meta.sidecarExe) {
      throw new Error("Missing sidecarExe in session metadata");
    }

    await this.ensureSidecarStarted(meta.sidecarExe);
    await this.focusBitTorrentWindow(sessionId);

    if (binding.method === "sidecar") {
      return await this.sidecar.send(
        binding.sidecarMethod,
        {
          ...(binding.args ?? {}),
          ...(payload ?? {}),
          processId: Number(meta.processId ?? 0) || undefined,
          windowTitle: meta.mainWindowTitle ?? "BitTorrent",
        },
        { timeoutMs: 10000 }
      );
    }

    if (binding.method === "keys") {
      return await this.sidecar.send(
        "sendKeys",
        {
          keys: binding.keys,
          processId: Number(meta.processId ?? 0) || undefined,
          windowTitle: meta.mainWindowTitle ?? "BitTorrent",
        },
        { timeoutMs: 10000 }
      );
    }

    throw new Error(`Unsupported control binding for action "${action}"`);
  }

  async connect(sessionId: string): Promise<SessionSnapshot> {
    await this.ensureBitTorrentLaunched(sessionId);

    const session = await this.getState(sessionId);
    return await this.sessions.update(sessionId, {
      state: "ready",
      endpoint: "sidecar://bittorrent",
      meta: {
        ...(session.meta ?? {}),
        mode: "bittorrent-sidecar",
      },
    });
  }

  async send(sessionId: string, command: CommandRequest): Promise<unknown> {
    switch (command.type) {
      case "status":
      case "listTorrents":
        return {
          torrents: this.listJobs(sessionId),
        };

      case "focus":
        await this.focusBitTorrentWindow(sessionId);
        return { ok: true };

      case "launch":
        await this.ensureBitTorrentLaunched(sessionId);
        return { ok: true };

      case "addTorrent":
      case "startTorrent":
      case "downloadFromUrl":
      case "openTorrent":
      case "openMagnet": {
        const payload = (command.payload ?? {}) as Record<string, unknown>;
        const resolved = await this.resolveTorrentSource(sessionId, payload);

        const job = this.createJob(sessionId, {
          source: String(
            (payload.source as string | undefined) ??
              (payload.uri as string | undefined) ??
              (payload.url as string | undefined) ??
              (payload.filePath as string | undefined) ??
              resolved.sourceToLaunch
          ),
          sourceKind: resolved.sourceKind,
          fileName: resolved.displayName,
          filePath: resolved.downloadedTorrentFile ?? (resolved.sourceKind === "file" ? resolved.sourceToLaunch : undefined),
          savePath: (payload.savePath as string | undefined) ?? undefined,
          status: "launching",
          metadata: {
            requestedBy: command.type,
          },
        });

        try {
          const result = await this.launchBitTorrentWithSource(
            sessionId,
            resolved.sourceToLaunch
          );

          const updated = this.updateJob(sessionId, job.id, {
            processId: result.processId,
            status: "downloading",
          });

          return updated;
        } catch (error) {
          const failed = this.updateJob(sessionId, job.id, {
            status: "failed",
            error: normalizeError(error),
          });
          throw Object.assign(new Error(failed.error), { torrent: failed });
        }
      }

      case "pauseTorrent": {
        const payload = (command.payload ?? {}) as Record<string, unknown>;
        const result = await this.invokeConfiguredControl(sessionId, "pause", payload);

        const jobId = payload.jobId as string | undefined;
        if (jobId) {
          this.updateJob(sessionId, jobId, { status: "paused" });
        }

        return { ok: true, result, torrents: this.listJobs(sessionId) };
      }

      case "resumeTorrent": {
        const payload = (command.payload ?? {}) as Record<string, unknown>;
        const result = await this.invokeConfiguredControl(sessionId, "resume", payload);

        const jobId = payload.jobId as string | undefined;
        if (jobId) {
          this.updateJob(sessionId, jobId, { status: "downloading" });
        }

        return { ok: true, result, torrents: this.listJobs(sessionId) };
      }

      case "stopTorrent": {
        const payload = (command.payload ?? {}) as Record<string, unknown>;
        const result = await this.invokeConfiguredControl(sessionId, "stop", payload);

        const jobId = payload.jobId as string | undefined;
        if (jobId) {
          this.updateJob(sessionId, jobId, { status: "paused" });
        }

        return { ok: true, result, torrents: this.listJobs(sessionId) };
      }

      case "removeTorrent": {
        const payload = (command.payload ?? {}) as Record<string, unknown>;
        const result = await this.invokeConfiguredControl(sessionId, "remove", payload);

        const jobId = payload.jobId as string | undefined;
        if (jobId) {
          this.updateJob(sessionId, jobId, { status: "removed" });
        }

        return { ok: true, result, torrents: this.listJobs(sessionId) };
      }

      case "startControlledTorrent": {
        const payload = (command.payload ?? {}) as Record<string, unknown>;
        const result = await this.invokeConfiguredControl(sessionId, "start", payload);

        const jobId = payload.jobId as string | undefined;
        if (jobId) {
          this.updateJob(sessionId, jobId, { status: "downloading" });
        }

        return { ok: true, result, torrents: this.listJobs(sessionId) };
      }

      default:
        throw new Error(`Unsupported TorrentAdapter command: ${command.type}`);
    }
  }
}