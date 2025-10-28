import express from "express";
import cors from "cors";
import { spawn, exec } from "child_process";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP + WebSocket server
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/* -------------------------------------------------------------------------- */
/*                         ✅ Writable Output Directory                        */
/* -------------------------------------------------------------------------- */
// Render only allows writing to /tmp
const OUTPUT_ROOT = "/tmp/output";
if (!fs.existsSync(OUTPUT_ROOT)) fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
app.use("/output", express.static(OUTPUT_ROOT));

/* -------------------------------------------------------------------------- */
/*                                Helper Utils                                */
/* -------------------------------------------------------------------------- */
function emit(stage, payload) {
  io.emit(stage, payload);
  const tag = stage === "progress" ? `[${payload?.type ?? "progress"}]` : "[stage]";
  console.log(`${tag} ${payload?.message ?? payload?.percent ?? ""}`);
}

function getDurationSeconds(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nk=1:nw=1",
      file,
    ]);
    let out = "";
    ff.stdout.on("data", (d) => (out += d.toString()));
    ff.stderr.on("data", (d) => (out += d.toString()));
    ff.on("close", () => {
      const m = out.match(/([0-9]+(\.[0-9]+)?)/);
      resolve(m ? parseFloat(m[1]) : 0);
    });
    ff.on("error", reject);
  });
}

/* -------------------------------------------------------------------------- */
/*                                 API Route                                  */
/* -------------------------------------------------------------------------- */
app.post("/api/convert", async (req, res) => {
  const { url, prefix = "MyShort", split_seconds = 65 } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "Missing URL" });
  if (split_seconds < 60)
    return res.status(400).json({ success: false, error: "Split time must be ≥ 60s" });

  const jobId = Date.now().toString();
  const jobDir = path.join(OUTPUT_ROOT, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const source = path.join(jobDir, "source.mp4");

  emit("stage", { stage: "start", message: "📥 Starting download..." });

  // Debug: log command
  const downloadCmd = `yt-dlp -f bestvideo+bestaudio --merge-output-format mp4 -o "${source}" "${url}"`;
  console.log("YT-DLP CMD:", downloadCmd);

  const ytdlp = exec(downloadCmd);

  // Track % progress from yt-dlp
  const pctRe = /(\d+(?:\.\d+)?)%/;
  ytdlp.stderr.on("data", (data) => {
    const s = data.toString();
    const m = s.match(pctRe);
    if (m) {
      const percent = Math.min(100, parseFloat(m[1]));
      emit("progress", { type: "download", percent });
    } else if (/Merging|merging/i.test(s)) {
      emit("progress", { type: "download", percent: 99 });
      emit("stage", { stage: "merging", message: "🔗 Merging audio/video..." });
    }
  });

  ytdlp.on("close", async (code) => {
    console.log("YT-DLP EXIT CODE:", code);
    if (code !== 0) {
      emit("stage", { stage: "error", message: "❌ Download failed." });
      return res.status(500).json({ success: false, error: "Download failed" });
    }

    emit("progress", { type: "download", percent: 100 });
    emit("stage", { stage: "downloaded", message: "✅ Download complete. Processing…" });

    const duration = await getDurationSeconds(source);
    if (!duration || !isFinite(duration)) {
      emit("stage", { stage: "error", message: "❌ Could not probe duration." });
      return res.status(500).json({ success: false, error: "Probe failed" });
    }

    /* ---------------------------- FFmpeg Splitting --------------------------- */
    const outputTemplate = path.join(jobDir, `${prefix} - Part %02d.mp4`);
    const args = [
      "-i", source,
      "-c", "copy",
      "-f", "segment",
      "-segment_time", String(split_seconds),
      "-reset_timestamps", "1",
      "-progress", "pipe:2",
      outputTemplate,
    ];

    const ff = spawn("ffmpeg", args);
    let lastPct = 0;

    ff.stderr.on("data", (d) => {
      const line = d.toString().trim();
      const m = line.match(/out_time_ms=(\d+)/);
      if (m) {
        const outMs = parseInt(m[1], 10);
        const pct = Math.min(100, (outMs / (duration * 1000 * 1000)) * 100);
        if (pct - lastPct >= 0.5 || pct === 100) {
          lastPct = pct;
          emit("progress", { type: "process", percent: Math.floor(pct) });
        }
      }
    });

    ff.on("close", (code2) => {
      console.log("FFmpeg EXIT CODE:", code2);
      if (code2 !== 0) {
        emit("stage", { stage: "error", message: "❌ FFmpeg failed during splitting." });
        return res.status(500).json({ success: false, error: "FFmpeg failed" });
      }

      emit("progress", { type: "process", percent: 100 });
      emit("stage", { stage: "done", message: "✅ Processing complete!" });

      fs.readdir(jobDir, (err, files) => {
        const parts = (files || []).filter(
          (f) => f.endsWith(".mp4") && f !== "source.mp4"
        );
        return res.json({ success: true, jobId, parts });
      });
    });
  });
});

/* -------------------------------------------------------------------------- */
/*                             Startup / Environment                           */
/* -------------------------------------------------------------------------- */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`🚀 Server running at ${publicUrl}`);
  console.log("📂 Videos served from /output/<jobId>/…");
  // Print tool versions for Render logs
  exec("yt-dlp --version", (err, out, errout) =>
    console.log("YT-DLP:", out || errout || err?.message)
  );
  exec("ffmpeg -version", (err, out, errout) =>
    console.log("FFmpeg:", out ? out.split('\n')[0] : errout || err?.message)
  );
});
