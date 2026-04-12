type AttachedTargetInfo = {
  sessionId: string;
  targetInfo?: {
    targetId?: string;
    type?: string;
    title?: string;
    url?: string;
    attached?: boolean;
    openerId?: string;
    browserContextId?: string;
    subtype?: string;
  };
  waitingForDebugger?: boolean;
};

type DetachedTargetInfo = {
  sessionId: string;
  targetId?: string;
};

type FrameAttachedEvent = {
  frameId: string;
  parentFrameId?: string;
  stack?: unknown;
};

type FrameDetachedEvent = {
  frameId: string;
  reason?: string;
};

type FrameNavigatedEvent = {
  frame: {
    id: string;
    parentId?: string;
    loaderId?: string;
    name?: string;
    url?: string;
    domainAndRegistry?: string;
    securityOrigin?: string;
    mimeType?: string;
    unreachableUrl?: string;
  };
  type?: string;
};

type TargetInfo = {
  targetId?: string;
  type?: string;
  title?: string;
  url?: string;
  attached?: boolean;
  openerId?: string;
  browserContextId?: string;
  subtype?: string;
};

type GetTargetsResult = {
  targetInfos?: TargetInfo[];
};

type AttachToTargetResult = {
  sessionId?: string;
};

export type CdpEventMessage = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  sessionId?: string;
  method?: string;
  params?: any;
};

export type CdpSendLike = (
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string
) => Promise<unknown>;

export class CdpWebFrameExtension {
  private autoAttachEnabled = false;

  private readonly childSessions = new Map<
    string,
    {
      targetId?: string;
      type?: string;
      url?: string;
      title?: string;
    }
  >();

  private readonly frameToSession = new Map<string, string>();
  private readonly frameToUrl = new Map<string, string>();
  private readonly frameParent = new Map<string, string>();

  constructor(private readonly sendFn: CdpSendLike) {}

  async initialize(): Promise<void> {
    await this.enableTargetAutoAttach();
    await this.sendFn("Page.enable");
    await this.sendFn("Target.setDiscoverTargets", { discover: true });

    try {
      const targets = (await this.sendFn("Target.getTargets")) as GetTargetsResult;
      console.log(
        "Initial CDP targets:",
        (targets?.targetInfos ?? []).map((t) => ({
          targetId: t.targetId,
          type: t.type,
          url: t.url,
          title: t.title,
          attached: t.attached
        }))
      );
    } catch (error) {
      console.log("Target.getTargets failed during initialization:", error);
    }
  }

  async enableTargetAutoAttach(): Promise<void> {
    if (this.autoAttachEnabled) {
      return;
    }

    await this.sendFn("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true
    });

    this.autoAttachEnabled = true;
  }

  async attachToTarget(targetId: string): Promise<string> {
    const result = (await this.sendFn("Target.attachToTarget", {
      targetId,
      flatten: true
    })) as AttachToTargetResult;

    const sessionId = result?.sessionId;
    if (!sessionId) {
      throw new Error(`Failed to attach to target ${targetId}`);
    }

    return sessionId;
  }

  async handleEventMessage(msg: CdpEventMessage): Promise<void> {
    const method = msg.method;
    const params = msg.params;
    const sessionId = msg.sessionId;


    console.log("CDP event:", {
    method,
    sessionId,
    hasParams: !!params
    });

    if (!method) {
      return;
    }

    

    if (method === "Target.attachedToTarget") {
      const info = params as AttachedTargetInfo;
      const childSessionId = info?.sessionId;
      const targetInfo = info?.targetInfo;

      if (childSessionId) {
        this.childSessions.set(childSessionId, {
          targetId: targetInfo?.targetId,
          type: targetInfo?.type,
          url: targetInfo?.url,
          title: targetInfo?.title
        });

        console.log("Attached to child target:", {
          sessionId: childSessionId,
          type: targetInfo?.type,
          targetId: targetInfo?.targetId,
          url: targetInfo?.url
        });

        await this.initializeChildSession(childSessionId);
      }

      return;
    }

    if (method === "Target.detachedFromTarget") {
      const info = params as DetachedTargetInfo;
      const childSessionId = info?.sessionId;

      if (childSessionId) {
        this.childSessions.delete(childSessionId);

        for (const [frameId, mappedSessionId] of [...this.frameToSession.entries()]) {
          if (mappedSessionId === childSessionId) {
            this.frameToSession.delete(frameId);
            this.frameToUrl.delete(frameId);
            this.frameParent.delete(frameId);
          }
        }

        console.log("Detached from child target:", {
          sessionId: childSessionId,
          targetId: info?.targetId
        });
      }

      return;
    }

    if (method === "Page.frameAttached") {
      const info = params as FrameAttachedEvent;
      if (info?.frameId && sessionId) {
        this.frameToSession.set(info.frameId, sessionId);
        if (info.parentFrameId) {
          this.frameParent.set(info.frameId, info.parentFrameId);
        }

        console.log("Frame attached:", {
          frameId: info.frameId,
          parentFrameId: info.parentFrameId,
          sessionId
        });
      }

      return;
    }

    if (method === "Page.frameNavigated") {
      const info = params as FrameNavigatedEvent;
      const frameId = info?.frame?.id;
      const url = info?.frame?.url;

      if (frameId) {
        if (sessionId) {
          this.frameToSession.set(frameId, sessionId);
        }
        if (url) {
          this.frameToUrl.set(frameId, url);
        }
        if (info?.frame?.parentId) {
          this.frameParent.set(frameId, info.frame.parentId);
        }

        console.log("Frame navigated:", {
          frameId,
          parentId: info?.frame?.parentId,
          url,
          sessionId
        });
      }

      return;
    }

    if (method === "Page.frameDetached") {
      const info = params as FrameDetachedEvent;
      if (info?.frameId) {
        this.frameToSession.delete(info.frameId);
        this.frameToUrl.delete(info.frameId);
        this.frameParent.delete(info.frameId);

        console.log("Frame detached:", {
          frameId: info.frameId,
          reason: info.reason,
          sessionId
        });
      }
    }
  }

  getSessionIdForFrame(frameId: string): string | null {
    return this.frameToSession.get(frameId) ?? null;
  }

  getKnownFrameIds(): string[] {
    return [...this.frameToSession.keys()];
  }

  getKnownChildSessions(): Array<{
    sessionId: string;
    targetId?: string;
    type?: string;
    url?: string;
    title?: string;
  }> {
    return [...this.childSessions.entries()].map(([sessionId, info]) => ({
      sessionId,
      ...info
    }));
  }

  getFrameDebugSnapshot(): {
    frameToSession: Record<string, string>;
    frameToUrl: Record<string, string>;
    frameParent: Record<string, string>;
    childSessions: Array<{
      sessionId: string;
      targetId?: string;
      type?: string;
      url?: string;
      title?: string;
    }>;
  } {
    return {
      frameToSession: Object.fromEntries(this.frameToSession.entries()),
      frameToUrl: Object.fromEntries(this.frameToUrl.entries()),
      frameParent: Object.fromEntries(this.frameParent.entries()),
      childSessions: this.getKnownChildSessions()
    };
  }

  reset(): void {
    this.autoAttachEnabled = false;
    this.childSessions.clear();
    this.frameToSession.clear();
    this.frameToUrl.clear();
    this.frameParent.clear();
  }

  private async initializeChildSession(sessionId: string): Promise<void> {
    try {
      await this.sendFn("Runtime.enable", undefined, sessionId);
    } catch (error) {
      console.log(`Runtime.enable failed for child session ${sessionId}:`, error);
    }

    try {
      await this.sendFn("DOM.enable", undefined, sessionId);
    } catch (error) {
      console.log(`DOM.enable failed for child session ${sessionId}:`, error);
    }

    try {
      await this.sendFn("Page.enable", undefined, sessionId);
    } catch (error) {
      console.log(`Page.enable failed for child session ${sessionId}:`, error);
    }
  }
}