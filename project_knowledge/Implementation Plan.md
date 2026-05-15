# Implementation plan

## Phase 1

Build the harness shell.

- Electron app
- preload API
- IPC handlers
- `AutomationHost`
- `SessionRegistry`
- `ProcessManager`

## Phase 2

Add real transports.

- `HttpJsonClient`
- `CdpClient`
- `SidecarClient`

## Phase 3

Add first adapters.

- `VlcHttpAdapter`
- `ChromiumDebugAdapter`
- `AdbAdapter`
- `ThoriumAdapter`

## Phase 4

Build the C# sidecar.

- stdin/stdout JSON transport
- `findWindowByProcessId`
- `invokeButtonByName`
- later: `getTree`, `getValue`, `selectItem`, `expandCollapse`

## Phase 5

Add tests.

- unit tests for state and routing
- smoke tests behind env vars
- renderer buttons for manual verification

## Phase 6

Only after the lab is stable, embed the adapters into your main application.