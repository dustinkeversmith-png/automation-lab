import { randomUUID } from "node:crypto";
import type { SessionSnapshot } from "./types";

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionSnapshot>();

  create(initial: Omit<SessionSnapshot, "sessionId">): SessionSnapshot {
    const snapshot: SessionSnapshot = {
      sessionId: randomUUID(),
      ...initial
    };

    console.log(`Creating session ${snapshot.sessionId} for ${snapshot.appKind}`);

    this.sessions.set(snapshot.sessionId, snapshot);
    return snapshot;
  }

  update(sessionId: string, patch: Partial<SessionSnapshot>): SessionSnapshot {
    const current = this.require(sessionId);
    const next: SessionSnapshot = { ...current, ...patch };
    this.sessions.set(sessionId, next);
    console.log(`Updated session ${sessionId} for ${next.appKind}`);
    return next;
  }

  get(sessionId: string): SessionSnapshot | undefined {
    return this.sessions.get(sessionId);
  }

  list(): SessionSnapshot[] {
    return [...this.sessions.values()];
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private require(sessionId: string): SessionSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }
}