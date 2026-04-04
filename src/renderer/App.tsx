import { useState } from "react";

type SessionLike = {
  sessionId: string;
};

export default function App() {
  const [sessionId, setSessionId] = useState<string>("");
  const [output, setOutput] = useState<string>("");

  async function launchVlc() {
    const result = (await window.automation.launch("vlc", {
      exePath: "C:/Program Files/VideoLAN/VLC/vlc.exe",
      args: [
        "--extraintf=http",
        "--http-password=vlcpass",
        "--http-host=127.0.0.1",
        "--http-port=8080"
      ],
      meta: {
        httpPort: 8080,
        httpPassword: "vlcpass"
      }
    })) as SessionLike;

    setSessionId(result.sessionId);
    setOutput(JSON.stringify(result, null, 2));
  }

  async function connectVlc() {
    const result = await window.automation.connect("vlc", sessionId);
    setOutput(JSON.stringify(result, null, 2));
  }

  async function getVlcStatus() {
    const result = await window.automation.send("vlc", sessionId, {
      type: "status"
    });
    setOutput(JSON.stringify(result, null, 2));
  }

  return (
    <div className="page">
      <h1>Automation Lab</h1>
      <div className="toolbar">
        <button onClick={launchVlc}>Launch VLC</button>
        <button onClick={connectVlc} disabled={!sessionId}>Connect VLC</button>
        <button onClick={getVlcStatus} disabled={!sessionId}>VLC Status</button>
      </div>
      <pre>{output}</pre>
    </div>
  );
}