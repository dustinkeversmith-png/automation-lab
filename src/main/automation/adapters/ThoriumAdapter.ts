import { BaseAdapter } from "./BaseAdapter";
import { SidecarClient } from "../transports/SidecarClient";
import type { CommandRequest, SessionSnapshot, RetryOptions } from "../types";


import { AutomationCapability } from "../types";

export class ThoriumAdapter extends BaseAdapter {
  readonly appKind = "thorium" as const;
  readonly capabilities = ["launch" as AutomationCapability, "attach" as AutomationCapability, "uia" as AutomationCapability, "openResource" as AutomationCapability, "close" as AutomationCapability];

  private readonly sidecar = new SidecarClient();

  async connect(sessionId: string): Promise<SessionSnapshot> {
    const session = await this.getState(sessionId);
    const sidecarExe = String(session.meta?.sidecarExe ?? "");

    if (!sidecarExe) {
      throw new Error("Missing sidecar executable path");
    }

    this.sidecar.start(sidecarExe);

    return this.sessions.update(sessionId, {
      state: "ready",
      endpoint: "sidecar://uia"
    });
  }

  async send(sessionId: string, command: CommandRequest): Promise<unknown> {
    const state = await this.getState(sessionId);

    switch (command.type) {
      case "findWindow":
        return await this.sidecar.send("findWindowByProcessId", {
          processId: state.pid
        });

      default:
        throw new Error(`Unsupported Thorium command: ${command.type}`);
    }
  }
}