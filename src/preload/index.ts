import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("automation", {
  launch: (appKind: string, options: unknown) =>
    ipcRenderer.invoke("automation:launch", appKind, options),
  connect: (appKind: string, sessionId: string) =>
    ipcRenderer.invoke("automation:connect", appKind, sessionId),
  send: (appKind: string, sessionId: string, command: unknown) =>
    ipcRenderer.invoke("automation:send", appKind, sessionId, command),
  close: (appKind: string, sessionId: string) =>
    ipcRenderer.invoke("automation:close", appKind, sessionId),
  listSessions: () => ipcRenderer.invoke("automation:listSessions")
});