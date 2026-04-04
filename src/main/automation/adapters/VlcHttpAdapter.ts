import { BaseAdapter } from "./BaseAdapter";
import { HttpJsonClient, HttpError } from "../transports/HttpJsonClient";
import type { CommandRequest, SessionSnapshot } from "../types";
import { AutomationCapability } from "../types";

import { SidecarClient } from "../transports/SidecarClient";

type VlcStatus = Record<string, unknown>;

type VlcStatusResponse = {
  state?: string;
  time?: number;
  length?: number;
  volume?: number;
  information?: unknown;
};

function looksLikeVlcStatus(value: unknown): value is VlcStatusResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    "state" in v ||
    "time" in v ||
    "length" in v ||
    "volume" in v ||
    "information" in v
  );
}

export class VlcHttpAdapter extends BaseAdapter {
  readonly appKind = "vlc" as const;
  readonly capabilities = [
    "launch",
    "attach",
    "playback",
    "close",
  ] as AutomationCapability[];

  private readonly clients = new Map<string, HttpJsonClient>();
  private readonly sidecar = new SidecarClient();
  private sidecarStarted = false;

  private createClient(port: number, password: string): HttpJsonClient {
    return new HttpJsonClient(`http://127.0.0.1:${port}/`, {
      auth: { username: "", password },
      timeoutMs: 3000,
    });
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async waitForVlcHttp(
    client: HttpJsonClient,
    attempts = 30,
    delayMs = 500
  ): Promise<void> {
    let lastError: unknown;

    for (let i = 0; i < attempts; i++) {
      try {
        const json = await client.getJson<VlcStatus>("requests/status.json");

        if (!looksLikeVlcStatus(json)) {
          console.log(
            "Received response from VLC HTTP endpoint, but it doesn't look like status.json:",
            json
          );
          throw new Error(
            "Endpoint responded, but it does not look like VLC status.json"
          );
        }

        console.log("VLC HTTP endpoint is ready");
        return;
      } catch (error) {
        lastError = error;
        console.log(
          `VLC HTTP probe failed (attempt ${i + 1}/${attempts}), retrying...`,
          error
        );
        await this.delay(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("VLC HTTP endpoint never became available");
  }

  private getClient(sessionId: string): HttpJsonClient {
    const client = this.clients.get(sessionId);
    if (!client) throw new Error("VLC client not connected");
    return client;
  }

  private async statusCommand(
    client: HttpJsonClient,
    command: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<VlcStatus> {
    return await client.getJson<VlcStatus>("requests/status.json", {
      query: { command, ...params },
    });
  }

  private async ensureSidecarStarted(sidecarExe: string): Promise<void> {
    if (this.sidecarStarted) return;

    console.log("Starting VLC sidecar:", sidecarExe);
    this.sidecar.start(sidecarExe);
    this.sidecarStarted = true;
  }

  private buildVlcLaunchArgs(port: number, password: string): string[] {
    return [
      "--extraintf=http",
      "--http-host=127.0.0.1",
      `--http-port=${port}`,
      `--http-password=${password}`,
    ];
  }

  private async ensureVlcLaunched(sessionId: string): Promise<void> {
    const session = await this.getState(sessionId);

    const sidecarExe = String(session.meta?.sidecarExe ?? "");
    const vlcExe = String(session.meta?.vlcExe ?? "");
    const port = Number(session.meta?.httpPort ?? 8080);
    const password = String(session.meta?.httpPassword ?? "vlcpass");

    if (!sidecarExe) {
      throw new Error("Missing sidecarExe in session metadata");
    }

    if (!vlcExe) {
      throw new Error("Missing vlcExe in session metadata");
    }

    await this.ensureSidecarStarted(sidecarExe);

    const args = this.buildVlcLaunchArgs(port, password);

    console.log("Launching VLC via sidecar", {
      vlcExe,
      args,
      port,
    });

    await this.sidecar.send(
      "launchProcess",
      {
        exePath: vlcExe,
        args,
        detached: true,
      },
      { timeoutMs: 10000 }
    );
  }

  async connect(sessionId: string): Promise<SessionSnapshot> {
    const session = await this.getState(sessionId);
    const port = Number(session.meta?.httpPort ?? 8080);
    const password = String(session.meta?.httpPassword ?? "vlcpass");

    await this.ensureVlcLaunched(sessionId);

    const client = this.createClient(port, password);
    await this.waitForVlcHttp(client);

    this.clients.set(sessionId, client);

    return this.sessions.update(sessionId, {
      state: "ready",
      endpoint: `http://127.0.0.1:${port}`,
      meta: {
        ...(session.meta ?? {}),
        mode: "vlc-http",
      },
    });
  }

  async send(sessionId: string, command: CommandRequest): Promise<unknown> {
    const client = this.getClient(sessionId);

    switch (command.type) {
      case "status":
        return await client.getJson<VlcStatus>("requests/status.json");

      case "play":
        return await this.statusCommand(client, "pl_play");

      case "pause":
        return await this.statusCommand(client, "pl_pause");

      case "stop":
        return await this.statusCommand(client, "pl_stop");

      case "next":
        return await this.statusCommand(client, "pl_next");

      case "previous":
        return await this.statusCommand(client, "pl_previous");

      case "seek":
        return await this.statusCommand(client, "seek", {
          val: (command.payload as { val: string | number }).val,
        });

      case "setVolume":
        return await this.statusCommand(client, "volume", {
          val: (command.payload as { val: number }).val,
        });

      case "addToPlaylist":
        return await this.statusCommand(client, "in_enqueue", {
          input: String((command.payload as { uri: string }).uri),
        });

      case "playFile":
        return await this.statusCommand(client, "in_play", {
          input: String((command.payload as { uri: string }).uri),
        });

      default:
        throw new Error(`Unsupported VLC command: ${command.type}`);
    }
  }
}