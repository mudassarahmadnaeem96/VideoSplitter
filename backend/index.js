import express from "express";
import cors from "cors";
import { spawn, exec, execSync } from "child_process";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const OUTPUT_ROOT = "/tmp/output";
if (!fs.existsSync(OUTPUT_ROOT)) fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
app.use("/output", express.static(OUTPUT_ROOT));

/* -------------------------------------------------------------------------- */
/* Utility helpers                                                            */
/* -------------------------------------------------------------------------- */
function emit(stage, payload) {
  io.emit(stage, payload);
  const tag = stage === "progress" ? `[${payload?.type ?? "progress"}]` : "[stage]";
  console.log(`${tag} ${payload?.message ?? payload?.percent ?? ""}`);
}

function getTmpUsage() {
  try {
    const usage = execSync("df -h /tmp").toString();
    console.log("📊 /tmp usage:\n" + usage);
  } catch (e) {
    console.log("⚠️ Disk check failed:", e.message);
  }
}

function cleanupOldJobs() {
  console.log("🧹 Cleaning old jobs...");
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(OUTPUT_ROOT)) {
      const full = path.join(OUTPUT_ROOT, f);
      const ageH = (now - fs.statSync(full).mtimeMs) / 36e5;
      if (ageH > 3) {
        fs.rmSync(full, { recursive: true, force: true });
        console.log("🗑️ Deleted old folder:", f);
      }
    }
  } catch (e) {
    console.log("⚠️ Cleanup error:", e.message);
  }
}

function getDurationSeconds(file) {
  return new Promise((resolve) => {
    const ff = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nk=1:nw=1",
      file,
    ]);
    let out = "";
    ff.stdout.on("data", (d) => (out += d));
    ff.on("close", () => resolve(parseFloat(out) || 0));
  });
}

/* -------------------------------------------------------------------------- */
/* Download helpers                                                           */
/* -------------------------------------------------------------------------- */

// ---- Attempt normal yt-dlp download ---------------------------------------
async function downloadWithYtDlp(url, source) {
  return new Promise((resolve, reject) => {
    console.log("▶️ [yt-dlp] Starting download...");
    const cmd = `yt-dlp -f bestvideo+bestaudio --merge-output-format mp4 -o "${source}" "${url}"`;
    const proc = exec(cmd);
    let errorSeen = "";

    proc.stderr.on("data", (d) => {
      const s = d.toString();
      if (/ERROR|403|429/.test(s)) errorSeen += s;
      console.log("YT-DLP:", s.trim());
    });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(source)) return resolve(true);
      reject(errorSeen || "yt-dlp failed");
    });
  });
}

// ---- Fallback via Piped API -----------------------------------------------
async function downloadViaPiped(url, source) {
  try {
    const idMatch = url.match(/v=([^&]+)/);
    const videoId = idMatch ? idMatch[1] : null;
    if (!videoId) throw new Error("Could not parse videoId");

    console.log("🌐 Using Piped API for", videoId);
    const api = `https://pipedapi.kavin.rocks/streams/${videoId}`;
    const r = await fetch(api);
    if (!r.ok) throw new Error("Piped API error " + r.status);
    const data = await r.json();

    const videoUrl = data.videoStreams?.[0]?.url;
    const audioUrl = data.audioStreams?.[0]?.url;
    if (!videoUrl || !audioUrl) throw new Error("No streams returned from Piped");

    console.log("🎥 Video stream:", videoUrl.slice(0, 80) + "...");
    console.log("🎧 Audio stream:", audioUrl.slice(0, 80) + "...");

    return new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-y",
        "-i", videoUrl,
        "-i", audioUrl,
        "-c", "copy",
        source,
      ]);
      ff.stderr.on("data", (d) => console.log("FFMPEG:", d.toString().trim()));
      ff.on("close", (code) => {
        if (code === 0 && fs.existsSync(source)) {
          console.log("✅ Fallback download done.");
          resolve(true);
        } else reject("ffmpeg failed in fallback");
      });
    });
  } catch (e) {
    console.error("❌ Fallback error:", e.message);
    throw e;
  }
}

/* -------------------------------------------------------------------------- */
/* Main API route                                                             */
/* -------------------------------------------------------------------------- */
app.post("/api/convert", async (req, res) => {
  const { url, prefix = "MyShort", split_seconds = 65 } = req.body || {};
  console.log("\n==============================");
  console.log("📩 Incoming:", url);
  console.log("==============================");
  if (!url) return res.status(400).json({ success: false, error: "Missing URL" });

  const jobId = Date.now().toString();
  const jobDir = path.join(OUTPUT_ROOT, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const source = path.join(jobDir, "source.mp4");

  emit("stage", { stage: "start", message: "📥 Downloading..." });
  getTmpUsage();

  // Step 1: Try yt-dlp
  let success = false;
  try {
    await downloadWithYtDlp(url, source);
    success = true;
  } catch (err) {
    console.log("⚠️ yt-dlp failed:", err);
  }

  // Step 2: Fallback via Piped if yt-dlp failed
  if (!success) {
    try {
      await downloadViaPiped(url, source);
      success = true;
    } catch (err) {
      console.log("❌ Both download methods failed:", err);
      emit("stage", { stage: "error", message: "❌ Download failed." });
      return res.status(500).json({ success: false, error: "Download failed" });
    }
  }

  // Step 3: Split
  emit("progress", { type: "download", percent: 100 });
  emit("stage", { stage: "downloaded", message: "✅ Download complete. Processing…" });

  const duration = await getDurationSeconds(source);
  const outputTemplate = path.join(jobDir, `${prefix} - Part %02d.mp4`);
  const args = [
    "-i", source,
    "-c", "copy",
    "-f", "segment",
    "-segment_time", String(split_seconds),
    "-reset_timestamps", "1",
    outputTemplate,
  ];

  console.log("🎬 Splitting video...");
  const ff = spawn("ffmpeg", args);
  ff.stderr.on("data", (d) => console.log("FFMPEG:", d.toString().trim()));
  ff.on("close", (code2) => {
    if (code2 !== 0)
      return res.status(500).json({ success: false, error: "FFmpeg split failed" });

    const parts = fs.readdirSync(jobDir).filter((f) => f.endsWith(".mp4") && f !== "source.mp4");
    console.log("✅ Parts created:", parts);
    emit("stage", { stage: "done", message: "✅ Processing complete!" });
    res.json({ success: true, jobId, parts });
  });
});

/* -------------------------------------------------------------------------- */
/* Startup                                                                    */
/* -------------------------------------------------------------------------- */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`🚀 Server running at ${url}`);
  exec("yt-dlp --version", (e, o) => console.log("YT-DLP:", o || e?.message));
  exec("ffmpeg -version", (e, o) => console.log("FFmpeg:", o?.split("\n")[0] || e?.message));
  getTmpUsage();
  cleanupOldJobs();
  setInterval(cleanupOldJobs, 30 * 60 * 1000);
});
