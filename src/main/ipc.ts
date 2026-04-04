import { ipcMain } from "electron";
import { AutomationHost } from "./automation/AutomationHost";

export function registerAutomationIpc() {
  const host = new AutomationHost();

  ipcMain.handle("automation:launch", async (_event, appKind, options) => {
    return await host.launch(appKind, options);
  });

  ipcMain.handle("automation:connect", async (_event, appKind, sessionId) => {
    return await host.connect(appKind, sessionId);
  });

  ipcMain.handle("automation:send", async (_event, appKind, sessionId, command) => {
    return await host.send(appKind, sessionId, command);
  });

  ipcMain.handle("automation:close", async (_event, appKind, sessionId) => {
    return await host.close(appKind, sessionId);
  });

  ipcMain.handle("automation:listSessions", async () => {
    return host.listSessions();
  });
}