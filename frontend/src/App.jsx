import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./index.css";

const socket = io(import.meta.env.VITE_API_URL, { transports: ["websocket"] });


export default function App() {
  const [videoLink, setVideoLink] = useState("");
  const [prefix, setPrefix] = useState("CorixClip");
  const [splitSeconds, setSplitSeconds] = useState(65);

  const [dlPct, setDlPct] = useState(0);
  const [dlText, setDlText] = useState("Waiting…");

  const [prPct, setPrPct] = useState(0);
  const [prText, setPrText] = useState("Waiting…");

  const [outputs, setOutputs] = useState([]);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    socket.on("progress", (p) => {
      if (!p) return;
      if (p.type === "download") {
        setDlPct(p.percent ?? 0);
        setDlText(`Downloading source… ${Math.floor(p.percent ?? 0)}%`);
      } else if (p.type === "process") {
        setPrPct(p.percent ?? 0);
        setPrText(`Processing & splitting… ${Math.floor(p.percent ?? 0)}%`);
      }
    });
    socket.on("stage", (s) => {
      if (!s) return;
      setStatusMsg(s.message || "");
    });
    return () => {
      socket.off("progress");
      socket.off("stage");
    };
  }, []);

  const start = async () => {
    setOutputs([]);
    setDlPct(0); setPrPct(0);
    setDlText("Starting…"); setPrText("Waiting…");
    setStatusMsg("Submitting job…");
    const res = await fetch("http://localhost:5000/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoLink, prefix, split_seconds: splitSeconds }),
    });
    const data = await res.json();
    if (data.success === false) {
      setStatusMsg("❌ " + (data.error || "Job failed"));
      return;
    }
    const urls = (data.parts || []).map((p) => `http://localhost:5000/output/${data.jobId}/${encodeURIComponent(p)}`);
    setOutputs(urls);
    setStatusMsg("✅ Completed");
    setPrPct(100);
  };

  return (
    <div className="page">
      <header className="header">
        <img src="/corixtech_logo-white.png" alt="CorixTech" className="logo" />
        <h1 className="brand">CorixTech Shorts Studio</h1>
      </header>

      <section className="hero">
        <div className="hero-text">
          <h2>AI‑Powered Shorts Converter — <span className="accent2">Fast</span> & <span className="accent1">Local</span></h2>
          <p>Convert public YouTube links into ready‑to‑post shorts. Instant cutting with no re‑encoding, live progress, and inline previews — all styled in the CorixTech look & feel.</p>
        </div>
        <div className="card">
          <input
            className="input"
            placeholder="Paste public YouTube link"
            value={videoLink}
            onChange={(e) => setVideoLink(e.target.value)}
          />
          <div className="row">
            <input
              className="input"
              placeholder="Filename prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
            <input
              type="number"
              min={60}
              className="input"
              value={splitSeconds}
              onChange={(e) => setSplitSeconds(Number(e.target.value))}
              title="Split duration in seconds (>=60)"
            />
          </div>
          <button className="button" onClick={start} disabled={!videoLink}>
            Start
          </button>
          <p className="status">{statusMsg}</p>
        </div>
      </section>

      <section className="progress-wrap">
        <div className="progress-card">
          <p className="label">📥 Source Download</p>
          <div className="bar">
            <div className="bar-fill purple" style={{ width: `${Math.min(100, Math.max(0, dlPct))}%` }} />
          </div>
          <p className="small">{dlText}</p>
        </div>
        <div className="progress-card">
          <p className="label">🎬 Processing / Splitting</p>
          <div className="bar">
            <div className="bar-fill blue" style={{ width: `${Math.min(100, Math.max(0, prPct))}%` }} />
          </div>
          <p className="small">{prText}</p>
        </div>
      </section>

      <section className="outputs">
        {outputs.length > 0 && <h3>🎥 Output Parts</h3>}

        <div className="grid">
          {outputs.map((url, i) => (
            <div key={i} className="out-card">
              <p className="small">Part {String(i + 1).padStart(2, "0")}</p>
              <video controls className="video" src={url} />
              <a className="dl" href={url} download>⬇ Download</a>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        © {new Date().getFullYear()} CorixTech — Shorts Studio
      </footer>
    </div>
  );
}
