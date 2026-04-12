import { BaseAdapter } from "./BaseAdapter";
import { SidecarClient } from "../transports/SidecarClient";
import type { CommandRequest, SessionSnapshot } from "../types";
import { AutomationCapability } from "../types";

type ThoriumWindowInfo = {
  processId?: number;
  hwnd?: number | string;
  title?: string;
};

type ThoriumCommandPayload = Record<string, unknown> | undefined;

export class ThoriumAdapter extends BaseAdapter {
  readonly appKind = "thorium" as const;

  readonly capabilities = [
    "launch",
    "attach",
    "uia",
    "openResource",
    "close",
  ] as AutomationCapability[];

  private readonly sidecar = new SidecarClient();
  private sidecarStarted = false;

  private readonly windows = new Map<string, ThoriumWindowInfo>();
  private readonly launched = new Set<string>();

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async ensureSidecarStarted(sidecarExe: string): Promise<void> {
    if (this.sidecarStarted) return;

    if (!sidecarExe) {
      throw new Error("Missing sidecarExe in session metadata");
    }

    console.log("Starting Thorium sidecar:", sidecarExe);
    this.sidecar.start(sidecarExe);
    this.sidecarStarted = true;
  }

  private normalizeFileList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((v) => String(v)).filter(Boolean);
    }

    if (typeof value === "string" && value.trim()) {
      return [value];
    }

    return [];
  }

  private buildThoriumLaunchArgs(payload?: ThoriumCommandPayload): string[] {
    const files = this.normalizeFileList(payload?.files ?? payload?.file ?? payload?.uri);
    const extraArgs = this.normalizeFileList(payload?.args);

    // Thorium can open publications passed as command line arguments / file-launch inputs.
    return [...extraArgs, ...files];
  }

  private async launchThorium(
    sessionId: string,
    payload?: ThoriumCommandPayload
  ): Promise<void> {
    const session = await this.getState(sessionId);

    const sidecarExe = String(session.meta?.sidecarExe ?? "");
    const thoriumExe = String(
      session.meta?.thoriumExe ??
      session.meta?.exePath ??
      ""
    );

    if (!thoriumExe) {
      throw new Error("Missing thoriumExe in session metadata");
    }

    await this.ensureSidecarStarted(sidecarExe);

    const args = this.buildThoriumLaunchArgs(payload);

    console.log("Launching Thorium via sidecar", {
      thoriumExe,
      args,
      detached: true,
    });

    await this.sidecar.send(
      "launchProcess",
      {
        exePath: thoriumExe,
        args,
        detached: true,
      },
      { timeoutMs: 15000 }
    );

    this.launched.add(sessionId);
  }

  private async findThoriumWindow(sessionId: string): Promise<ThoriumWindowInfo> {
    const state = await this.getState(sessionId);

    if (!state.pid) {
      throw new Error("Thorium session has no process id");
    }

    const result = (await this.sidecar.send("findWindowByProcessId", {
      processId: state.pid,
    })) as ThoriumWindowInfo | undefined;

    if (!result) {
      throw new Error(`No Thorium window found for pid=${state.pid}`);
    }

    this.windows.set(sessionId, result);
    return result;
  }

  private async waitForThoriumWindow(
    sessionId: string,
    attempts = 30,
    delayMs = 500
  ): Promise<ThoriumWindowInfo> {
    let lastError: unknown;

    for (let i = 0; i < attempts; i++) {
      try {
        const win = await this.findThoriumWindow(sessionId);
        console.log(`Thorium window found on attempt ${i + 1}/${attempts}`, win);
        return win;
      } catch (error) {
        lastError = error;
        console.log(
          `Thorium window probe failed (attempt ${i + 1}/${attempts}), retrying...`,
          error
        );
        await this.delay(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Thorium window never became available");
  }

  private async focusThoriumWindow(sessionId: string): Promise<void> {
    const state = await this.getState(sessionId);

    if (!state.pid) {
      throw new Error("Thorium session has no process id");
    }

    // Assumes sidecar transformWindow supports focus/bringToFront/restore style actions.
    await this.sidecar.send("transformWindow", {
      processId: state.pid,
      action: "bringToFront",
    });

    await this.sidecar.send("transformWindow", {
      processId: state.pid,
      action: "focus",
    });
  }

  private async sendKeys(
    sessionId: string,
    keys: string[],
    options?: { text?: string }
  ): Promise<unknown> {
    const state = await this.getState(sessionId);

    if (!state.pid) {
      throw new Error("Thorium session has no process id");
    }

    await this.focusThoriumWindow(sessionId);

    // Assumes sidecar has / will have a generic key injection endpoint.
    return await this.sidecar.send("sendKeys", {
      processId: state.pid,
      keys,
      text: options?.text,
    });
  }

  private async openFilesInThorium(
    sessionId: string,
    files: string[]
  ): Promise<unknown> {
    if (!files.length) {
      throw new Error("No files were provided");
    }

    const state = await this.getState(sessionId);

    // If the session is already running, launching Thorium again with files is
    // a practical way to emulate shell “open with” behavior for Electron apps.
    if (state.pid) {
      return await this.launchThorium(sessionId, { files });
    }

    return await this.launchThorium(sessionId, { files });
  }

  async connect(sessionId: string): Promise<SessionSnapshot> {
    const session = await this.getState(sessionId);
    const sidecarExe = String(session.meta?.sidecarExe ?? "");

    await this.ensureSidecarStarted(sidecarExe);

    // Optional eager launch. This mirrors VLC’s connect lifecycle more closely.
    if (session.meta?.autoLaunch && !this.launched.has(sessionId)) {
      await this.launchThorium(sessionId);
    }

    try {
      await this.waitForThoriumWindow(sessionId, 10, 300);
    } catch {
      // It is okay for Thorium to be started later via "launch".
    }

    return this.sessions.update(sessionId, {
      state: "ready",
      endpoint: "sidecar://thorium-uia",
      meta: {
        ...(session.meta ?? {}),
        mode: "thorium-uia",
      },
    });
  }

  async send(sessionId: string, command: CommandRequest): Promise<unknown> {
    const payload = (command.payload ?? {}) as ThoriumCommandPayload;

    switch (command.type) {
      case "launch": {
        await this.launchThorium(sessionId, payload);
        await this.waitForThoriumWindow(sessionId, 30, 500);
        return { ok: true };
      }

      case "attach": {
        const win = await this.waitForThoriumWindow(sessionId, 30, 500);
        return win;
      }

      case "status": {
        const state = await this.getState(sessionId);
        const win = this.windows.get(sessionId) ?? (state.pid ? await this.findThoriumWindow(sessionId) : undefined);

        return {
          pid: state.pid ?? null,
          endpoint: state.endpoint ?? null,
          mode: state.meta?.mode ?? null,
          window: win ?? null,
        };
      }

      case "findWindow": {
        return await this.findThoriumWindow(sessionId);
      }

      case "focus":
      case "bringToFront": {
        await this.focusThoriumWindow(sessionId);
        return { ok: true };
      }

      case "openFile":
      case "openFiles":
      case "openResource":
      case "playFile": {
        const files = this.normalizeFileList(payload?.files ?? payload?.file ?? payload?.uri);
        return await this.openFilesInThorium(sessionId, files);
      }

      case "nextPage": {
        return await this.sendKeys(sessionId, ["RIGHT"]);
      }

      case "previousPage": {
        return await this.sendKeys(sessionId, ["LEFT"]);
      }

      case "nextChapter": {
        return await this.sendKeys(sessionId, ["CTRL", "SHIFT", "ALT", "RIGHT"]);
      }

      case "previousChapter": {
        return await this.sendKeys(sessionId, ["CTRL", "SHIFT", "ALT", "LEFT"]);
      }

      case "toggleFullscreen": {
        return await this.sendKeys(sessionId, ["CTRL", "F11"]);
      }

      case "toggleBookmark": {
        return await this.sendKeys(sessionId, ["CTRL", "B"]);
      }

      case "focusReaderSettings": {
        return await this.sendKeys(sessionId, ["CTRL", "S"]);
      }

      case "focusNavigation": {
        return await this.sendKeys(sessionId, ["CTRL", "N"]);
      }

      case "focusToc": {
        return await this.sendKeys(sessionId, ["CTRL", "SHIFT", "N"]);
      }

      case "focusSearch": {
        return await this.sendKeys(sessionId, ["CTRL", "F"]);
      }

      case "gotoPage": {
        // Opens Thorium's go-to-page UI.
        return await this.sendKeys(sessionId, ["CTRL", "SHIFT", "P"]);
      }

      case "ttsToggle":
      case "toggleAutoRead":
      case "startReadAloud":
      case "pauseReadAloud": {
        return await this.sendKeys(sessionId, ["CTRL", "2"]);
      }

      case "ttsPrevious":
      case "previousReadAloudChunk": {
        return await this.sendKeys(sessionId, ["CTRL", "1"]);
      }

      case "ttsNext":
      case "nextReadAloudChunk": {
        return await this.sendKeys(sessionId, ["CTRL", "3"]);
      }

      case "setAutoReadingSpeed": {
        // Thorium does not expose a documented direct command API for this.
        // Best-effort approach:
        // 1) focus reader settings
        // 2) let caller optionally provide tabCount / direction
        // 3) use left/right to adjust focused speed control
        const tabCount = Number(payload?.tabCount ?? 0);
        const direction = String(payload?.direction ?? "right").toLowerCase();
        const steps = Math.max(1, Number(payload?.steps ?? 1));

        await this.sendKeys(sessionId, ["CTRL", "S"]);

        for (let i = 0; i < tabCount; i++) {
          await this.sendKeys(sessionId, ["TAB"]);
        }

        const arrow = direction === "left" ? "LEFT" : "RIGHT";
        for (let i = 0; i < steps; i++) {
          await this.sendKeys(sessionId, [arrow]);
        }

        return { ok: true, tabCount, direction, steps };
      }

      case "close": {
        return await this.sendKeys(sessionId, ["CTRL", "W"]);
      }

      default:
        throw new Error(`Unsupported Thorium command: ${command.type}`);
    }
  }
}