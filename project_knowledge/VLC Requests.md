
I'm trying to connect to VLC Media Player app (v 3.0.4 : [https://www.videolan.org/vlc/download-windows.html](https://www.videolan.org/vlc/download-windows.html)) via its http (Web) interface.

I've enabled the Web interface and set the Lua password to "test" per this page: [https://www.howtogeek.com/117261/how-to-activate-vlcs-web-interface-control-vlc-from-a-browser-use-a...](https://www.howtogeek.com/117261/how-to-activate-vlcs-web-interface-control-vlc-from-a-browser-use-any-smartphone-as-a-remote/)

Please use --http-password, or set a password in

Preferences > All > Main interfaces > Lua > Lua HTTP > Password.

password = password

Yes. The short version is: VLC exposes a tiny HTTP server, and `requests/status.json` is one of the server-side endpoints implemented by VLC’s built-in Lua web interface. Your adapter is not talking to “magic VLC internals” directly; it is just sending authenticated HTTP GETs to that web interface, and VLC interprets query parameters like `command=pl_pause` or `command=in_enqueue` on the server side. The VideoLAN source tree documents that the `requests/` endpoints accept URL-encoded parameters, and `status.json` is meant to mirror the same control/status behavior as `status.xml`.

GET /requests/status.json

you are asking VLC:

- what is the current playback state?
- current time / length?
- current item / playlist state?



- VLC’s HTTP interface is usually enabled locally and protected with Basic Auth. In your code you send an empty username and the configured password, which becomes `":" + password` before base64 encoding. That matches your current implementation.
- The endpoint name is stable: `requests/status.json`.
- Commands are passed as query params, usually:
    - `command=pl_play`
    - `command=pl_pause`
    - `command=pl_stop`
    - `command=in_enqueue`
    - plus extra params like `input=...` or `id=...` depending on the command. VLC’s request README explicitly says parameters need URL encoding.
- VLC parses those params in its HTTP/Lua layer, executes the command against the player/playlist, then returns JSON describing the resulting state. That is why a control request can still return a JSON status document rather than just `{ ok: true }`.