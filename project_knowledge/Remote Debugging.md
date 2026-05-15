
Port **9222** is the common default port for the **Chrome/Chromium remote debugging server**.

So this code:

fetch(`http://127.0.0.1:${port}/json/version`)

is not talking to an ordinary website. It is trying to talk to a **Chromium-based browser that was launched with remote debugging enabled**, usually with something like:

--remote-debugging-port=9222

## What `/json/version` is

When Chrome or Chromium is launched in remote-debug mode, it starts a small local HTTP server on that port.

That server exposes endpoints like:

- `/json/version`
- `/json/list`
- `/json/protocol`

`/json/version` usually returns info like:

{  
  "Browser": "Chrome/123.0.0.0",  
  "Protocol-Version": "1.3",  
  "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/..."  
}

The important part is:

"webSocketDebuggerUrl": "ws://..."

Your adapter fetches `/json/version` first so it can discover the **actual WebSocket endpoint** to use for CDP.

## So why is it connecting to port 9222?

Because the adapter is probably doing this flow:

1. assume Chromium is exposing remote debugging on port `9222`
2. poll `http://127.0.0.1:9222/json/version`
3. once it responds, extract `webSocketDebuggerUrl`
4. connect the CDP client to that WebSocket URL
5. send CDP commands like `Page.enable` and `Runtime.enable`

So 9222 is not magical by itself. It is just the chosen **debug server port**.

## Why your test log shows repeated attempts


chrome.exe --remote-debugging-port=9222

Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222","--user-data-dir=C:\temp\chrome-debug","--no-first-run","--no-default-browser-check"

Start-Process "C:\Users\Cutie Magic 500\AppData\Local\AdblockBrowser\Application\adblockbrowser.exe" `-ArgumentList "--remote-debugging-port=9222","--user-data-dir=C:\temp\adb-debug","--no-first-run","--no-default-browser-check"

http://127.0.0.1:9222/json/version

Invoke-WebRequest http://127.0.0.1:9222/json/version | Select-Object -Expand Content
This is what I am getting back for some reason from this fetch request
{
  json: [Function: spy] {
    getMockName: [Function (anonymous)],
    mockName: [Function (anonymous)],
    mockClear: [Function (anonymous)],
    mockReset: [Function (anonymous)],
    mockRestore: [Function (anonymous)],
    getMockImplementation: [Function (anonymous)],
    mockImplementation: [Function (anonymous)],
    mockImplementationOnce: [Function (anonymous)],
    withImplementation: [Function: withImplementation],
    mockReturnThis: [Function (anonymous)],
    mockReturnValue: [Function (anonymous)],
    mockReturnValueOnce: [Function (anonymous)],
    mockResolvedValue: [Function (anonymous)],
    mockResolvedValueOnce: [Function (anonymous)],
    mockRejectedValue: [Function (anonymous)],
    mockRejectedValueOnce: [Function (anonymous)],
    [Symbol(nodejs.dispose)]: [Function (anonymous)]
  }
}



