import { ChromiumDebugAdapter } from "./ChromiumDebugAdapter";
import { SidecarClient } from "../transports/SidecarClient";
import { SessionRegistry } from "../SessionRegistry";
import type { CommandRequest, SessionSnapshot } from "../types";
import { AutomationCapability, RetryOptions } from "../types";


// Kind of just a generic session meta.
type AdbSessionMeta = {
  sidecarExe?: string;
  sidecarArgs?: string[];
  adbPath?: string;
  debugPort?: number;
  launchUrl?: string;
  bringToFront?: boolean;
};

export class AdbAdapter extends ChromiumDebugAdapter {
  private readonly sidecar = new SidecarClient();

  constructor(
    sessions: SessionRegistry,
    retryOptions: RetryOptions = { attempts: 20, delayMs: 500 }
  ) {
    super(sessions, retryOptions);
  }

  async connect(sessionId: string): Promise<SessionSnapshot> {
    const state = await this.getState(sessionId);
    const meta = (state.meta ?? {}) as AdbSessionMeta;

    console.log(`Connecting session ${sessionId} with ADB adapter... ${JSON.stringify(meta)}`);

    const sidecarExe = String(meta.sidecarExe ?? "");
    const sidecarArgs = Array.isArray(meta.sidecarArgs) ? meta.sidecarArgs : [];
    const debugPort = Number(meta.debugPort ?? 9222);
  

    // If given initial launch url, use CDP to communicate with the side car.
    const launchUrl =
      meta.launchUrl != null ? String(meta.launchUrl) : "";
    const bringToFront = meta.bringToFront ?? true;

    if (!sidecarExe) {
      throw new Error("No sidecarExe configured for ADB adapter");
    }

    console.log(
      `Starting sidecar before CDP connect for session ${sessionId}...`
    );
    this.sidecar.start(sidecarExe, sidecarArgs);

    await this.sidecar.send(
      "launchProcess",
      {
        exePath: meta.adbPath ?? "adb",
        args: [
          "--remote-debugging-port=9222",
          "--user-data-dir=C:\\temp\\adb-debug",
          "--no-first-run",
          "--no-default-browser-check"
        ],
        detached: true,
      },
      { timeoutMs: 10000 }
    );

    // Check that the side car has started.


    try {
      console.log(
        `Requesting sidecar to ensure browser is running with remote debugging on port ${debugPort}...`
      );

      console.log(`PID before ensureAdbBrowserReady: ${state.pid}`);

      const connected = await super.connect(sessionId);
      // Attempting to connect to the debug port.

      console.log("Connected the Chromeium Debugger", connected);

      return this.sessions.update(sessionId, {
        ...connected,
        meta: {
          ...(connected.meta ?? {}),
          ...meta,
          mode: "cdp",
          debugPort,
          launchUrl: launchUrl || undefined,
          bringToFront
        }
      });
    } catch (cdpError) {
      console.warn(
        `CDP bootstrap/connect failed for session ${sessionId}, falling back to UIA mode:`,
        cdpError
      );

      return this.sessions.update(sessionId, {
        state: "ready",
        endpoint: "sidecar://uia",
        meta: {
          ...meta,
          mode: "uia",
          debugPort,
          launchUrl: launchUrl || undefined,
          bringToFront
        }
      });
    }
  }


  
  

}
