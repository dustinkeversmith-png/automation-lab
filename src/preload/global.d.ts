export {};

declare global {
  interface Window {
    automation: {
      launch: (appKind: string, options: unknown) => Promise<unknown>;
      connect: (appKind: string, sessionId: string) => Promise<unknown>;
      send: (appKind: string, sessionId: string, command: unknown) => Promise<unknown>;
      close: (appKind: string, sessionId: string) => Promise<void>;
      listSessions: () => Promise<unknown>;
    };
  }
}