// ======================
// CorixTech Shorts Studio Backend
// ======================

import express from "express";
import cors from "cors";
import { spawn, exec } from "child_process";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

// ---------- Setup ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ---------- Output Directory ----------
const OUTPUT_ROOT = "/tmp/output";
if (!fs.existsSync(OUTPUT_ROOT)) fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
app.use("/output", express.static(OUTPUT_ROOT));

function emit(stage, payload) {
  io.emit(stage, payload);
  const tag = stage === "progress" ? `[${payload?.type ?? "progress"}]` : "[stage]";
  console.log(`${tag} ${payload?.message ?? payload?.percent ?? ""}`);
}

// ---------- Helper: Check /tmp Space ----------
function printDiskUsage() {
  console.log("📊 /tmp usage:");
  exec("df -h /tmp", (err, out) => console.log(out));
}

// ---------- Helper: Get Duration ----------
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
    ff.on("close", () => {
      const match = out.match(/([0-9]+(\.[0-9]+)?)/);
      resolve(match ? parseFloat(match[1]) : 0);
    });
    ff.on("error", reject);
  });
}

// ---------- Helper: Piped API ----------
async function downloadViaPiped(videoId, outputPath) {
  try {
    console.log(`🌐 Using Piped API for ${videoId}`);
    const r = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
    const data = await r.json();
    if (!data.videoStreams?.length) throw new Error("No streams found from Piped");
    const url = data.videoStreams[0].url;
    console.log(`🎥 Piped stream URL: ${url.slice(0, 60)}...`);

    return new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", ["-y", "-i", url, "-c", "copy", outputPath]);
      ff.stderr.on("data", (d) => process.stdout.write(d.toString()));
      ff.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}`))
      );
    });
  } catch (err) {
    throw new Error(`Piped API error ${err.message}`);
  }
}

// ---------- Main API ----------
app.post("/api/convert", async (req, res) => {
  const { url, prefix = "MyShort", split_seconds = 65 } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "Missing URL" });

  const jobId = Date.now().toString();
  const jobDir = path.join(OUTPUT_ROOT, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const source = path.join(jobDir, "source.mp4");

  console.log("==============================");
  console.log("📩 Incoming:", url);
  console.log("==============================");

  emit("stage", { stage: "start", message: "📥 Downloading..." });
  printDiskUsage();

  // ---------- Determine Mode ----------
  const isYouTube = /youtube\.com|youtu\.be/.test(url);
  const isDirectVideo = /\.(mp4|mkv|mov|m3u8)$/i.test(url);

  try {
    if (isDirectVideo) {
      console.log("🎯 Direct media link detected — streaming to ffmpeg...");
      await new Promise((resolve, reject) => {
        const ff = spawn("ffmpeg", [
          "-y",
          "-i", url,
          "-c", "copy",
          source,
        ]);
        ff.stderr.on("data", (d) => process.stdout.write(d.toString()));
        ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
      });
    } else if (isYouTube) {
      console.log("🎯 YouTube link detected — streaming yt-dlp → ffmpeg...");
      await new Promise((resolve, reject) => {
        const ytdlp = spawn("yt-dlp", ["-f", "bestvideo+bestaudio", "-o", "-", url]);
        const ff = spawn("ffmpeg", ["-y", "-i", "pipe:0", "-c", "copy", source]);

        ytdlp.stdout.pipe(ff.stdin);
        ytdlp.stderr.on("data", (d) => process.stdout.write(`YT-DLP: ${d}`));
        ff.stderr.on("data", (d) => process.stdout.write(`FFmpeg: ${d}`));

        ff.on("close", (code) => {
          if (code === 0) resolve();
          else {
            console.log("⚠️ Streaming failed, trying Piped fallback...");
            const idMatch = url.match(/(?:v=|be\/)([a-zA-Z0-9_-]{11})/);
            const videoId = idMatch ? idMatch[1] : null;
            if (videoId) downloadViaPiped(videoId, source).then(resolve).catch(reject);
            else reject(new Error("Invalid YouTube URL, no video ID"));
          }
        });
      });
    } else {
      throw new Error("Unsupported URL type");
    }

    // ---------- Check Source Exists ----------
    if (!fs.existsSync(source)) throw new Error("No source video created");

    // ---------- Process the Video ----------
    emit("stage", { stage: "process", message: "🎬 Processing video..." });
    const duration = await getDurationSeconds(source);
    console.log(`📏 Duration: ${duration}s`);

    const outputTemplate = path.join(jobDir, `${prefix} - Part %02d.mp4`);
    await new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-y",
        "-i", source,
        "-c", "copy",
        "-f", "segment",
        "-segment_time", String(split_seconds),
        "-reset_timestamps", "1",
        "-progress", "pipe:2",
        outputTemplate,
      ]);
      ff.stderr.on("data", (d) => process.stdout.write(d.toString()));
      ff.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`FFmpeg split exited ${code}`))
      );
    });

    // ---------- Return Result ----------
    const parts = fs.readdirSync(jobDir).filter(f => f.endsWith(".mp4") && f !== "source.mp4");
    emit("stage", { stage: "done", message: "✅ Done!" });
    console.log("✅ Final success. Parts:", parts);
    return res.json({ success: true, jobId, parts });
  } catch (err) {
    console.error("❌ Conversion failed:", err.message);
    emit("stage", { stage: "error", message: `❌ ${err.message}` });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- Startup ----------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`🚀 Server running at ${publicUrl}`);
  exec("yt-dlp --version", (err, out, errout) => console.log("YT-DLP:", out || errout));
  exec("ffmpeg -version", (err, out, errout) => console.log("FFmpeg:", out?.split('\n')[0] || errout));
});
