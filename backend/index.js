import express from "express";
import cors from "cors";
import { spawn, exec, execSync } from "child_process";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/* -------------------------------------------------------------------------- */
/*                         ✅ Writable Output Directory                        */
/* -------------------------------------------------------------------------- */
const OUTPUT_ROOT = "/tmp/output";
if (!fs.existsSync(OUTPUT_ROOT)) fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
app.use("/output", express.static(OUTPUT_ROOT));

/* -------------------------------------------------------------------------- */
/*                              Helper Functions                              */
/* -------------------------------------------------------------------------- */
function emit(stage, payload) {
  io.emit(stage, payload);
  const tag = stage === "progress" ? `[${payload?.type ?? "progress"}]` : "[stage]";
  console.log(`${tag} ${payload?.message ?? payload?.percent ?? ""}`);
}

// log disk usage
function getTmpUsage() {
  try {
    const usage = execSync("df -h /tmp").toString();
    console.log("📊 /tmp disk usage:\n" + usage);
  } catch (err) {
    console.error("⚠️ Could not read /tmp usage:", err.message);
  }
}

// cleanup old folders (>3 hours old)
function cleanupOldJobs() {
  console.log("🧹 Running cleanup for old jobs...");
  try {
    const now = Date.now();
    const folders = fs.readdirSync(OUTPUT_ROOT);
    for (const folder of folders) {
      const dir = path.join(OUTPUT_ROOT, folder);
      const stat = fs.statSync(dir);
      const ageHours = (now - stat.mtimeMs) / (1000 * 60 * 60);
      if (ageHours > 3) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`🗑️ Deleted old job folder: ${folder}`);
      }
    }
  } catch (err) {
    console.error("⚠️ Cleanup error:", err.message);
  }
}

function getDurationSeconds(file) {
  return new Promise((resolve, reject) => {
    console.log("⏱️ Running ffprobe to get duration...");
    const ff = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nk=1:nw=1",
      file,
    ]);
    let out = "";
    ff.stdout.on("data", (d) => (out += d.toString()));
    ff.stderr.on("data", (d) => console.log("FFPROBE STDERR:", d.toString()));
    ff.on("close", () => {
      const m = out.match(/([0-9]+(\.[0-9]+)?)/);
      console.log("📏 Video duration (s):", m ? m[1] : "unknown");
      resolve(m ? parseFloat(m[1]) : 0);
    });
    ff.on("error", (err) => {
      console.error("❌ ffprobe failed:", err);
      reject(err);
    });
  });
}

/* -------------------------------------------------------------------------- */
/*                                 API Route                                  */
/* -------------------------------------------------------------------------- */
app.post("/api/convert", async (req, res) => {
  console.log("\n==============================");
  console.log("📩 Incoming request:", req.body);
  console.log("==============================\n");

  const { url, prefix = "MyShort", split_seconds = 65 } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "Missing URL" });
  if (split_seconds < 60)
    return res.status(400).json({ success: false, error: "Split time must be ≥ 60s" });

  const jobId = Date.now().toString();
  const jobDir = path.join(OUTPUT_ROOT, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const source = path.join(jobDir, "source.mp4");

  console.log("🧾 Job created:", jobId);
  console.log("📂 Working directory:", jobDir);
  console.log("➡️ Output source file:", source);

  emit("stage", { stage: "start", message: "📥 Starting download..." });
  console.log("\n💾 Checking /tmp space before download...");
  getTmpUsage();

  const downloadCmd = `yt-dlp -f bestvideo+bestaudio --merge-output-format mp4 -o "${source}" "${url}"`;
  console.log("▶️ Executing command:", downloadCmd);

  const ytdlp = exec(downloadCmd);
  let downloadFailed = false;

  ytdlp.stdout.on("data", (d) => console.log("YT-DLP STDOUT:", d.toString()));
  ytdlp.stderr.on("data", (d) => {
    const s = d.toString();
    console.log("YT-DLP STDERR:", s);
    const pctRe = /(\d+(?:\.\d+)?)%/;
    const m = s.match(pctRe);
    if (m) {
      const percent = Math.min(100, parseFloat(m[1]));
      emit("progress", { type: "download", percent });
    } else if (/Merging|merging/i.test(s)) {
      emit("progress", { type: "download", percent: 99 });
      emit("stage", { stage: "merging", message: "🔗 Merging audio/video..." });
    }
    if (/ERROR/i.test(s)) downloadFailed = true;
  });

  ytdlp.on("close", async (code) => {
    console.log("YT-DLP EXIT CODE:", code);
    console.log("\n💾 Checking /tmp space after download...");
    getTmpUsage();

    if (code !== 0 || downloadFailed) {
      console.error("❌ Download failed (yt-dlp error).");
      emit("stage", { stage: "error", message: "❌ Download failed." });
      return res.status(500).json({ success: false, error: "Download failed" });
    }

    if (!fs.existsSync(source)) {
      console.error("❌ File not found after download (Render tmp limit?)");
      return res.status(500).json({ success: false, error: "File missing after download" });
    }

    const stats = fs.statSync(source);
    console.log("📦 File downloaded:", source, "Size:", stats.size, "bytes");

    if (stats.size < 500000) {
      console.error("⚠️ File too small, likely failed or truncated (Render limit hit)");
      return res.status(500).json({ success: false, error: "File too small" });
    }

    emit("progress", { type: "download", percent: 100 });
    emit("stage", { stage: "downloaded", message: "✅ Download complete. Processing…" });

    const duration = await getDurationSeconds(source);
    if (!duration || !isFinite(duration)) {
      emit("stage", { stage: "error", message: "❌ Could not probe duration." });
      console.error("❌ FFprobe failed to detect duration.");
      return res.status(500).json({ success: false, error: "Probe failed" });
    }

    console.log("\n🎬 Starting FFmpeg split process...");
    getTmpUsage();

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

    console.log("FFMPEG CMD:", ["ffmpeg", ...args].join(" "));
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
      } else console.log("FFMPEG:", line);
    });

    ff.on("close", (code2) => {
      console.log("FFmpeg EXIT CODE:", code2);
      console.log("\n💾 Checking /tmp space after processing...");
      getTmpUsage();

      if (code2 !== 0) {
        emit("stage", { stage: "error", message: "❌ FFmpeg failed during splitting." });
        console.error("❌ FFmpeg failed — possible disk or format issue.");
        return res.status(500).json({ success: false, error: "FFmpeg failed" });
      }

      const parts = fs.readdirSync(jobDir).filter((f) => f.endsWith(".mp4") && f !== "source.mp4");
      console.log("📜 Split parts:", parts);
      if (parts.length === 0) {
        console.error("⚠️ No split files created — likely disk or permission issue.");
        return res.status(500).json({ success: false, error: "No split files created" });
      }

      emit("progress", { type: "process", percent: 100 });
      emit("stage", { stage: "done", message: "✅ Processing complete!" });

      console.log("✅ Job completed successfully.");
      getTmpUsage();

      return res.json({ success: true, jobId, parts });
    });
  });
});

/* -------------------------------------------------------------------------- */
/*                               Server Startup                               */
/* -------------------------------------------------------------------------- */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`🚀 Server running at ${publicUrl}`);
  console.log("📂 Videos served from /output/<jobId>/…");
  exec("yt-dlp --version", (err, out, errout) =>
    console.log("YT-DLP:", out || errout || err?.message)
  );
  exec("ffmpeg -version", (err, out, errout) =>
    console.log("FFmpeg:", out ? out.split('\n')[0] : errout || err?.message)
  );

  getTmpUsage();

  // Run cleanup every 30 minutes
  setInterval(cleanupOldJobs, 30 * 60 * 1000);
  cleanupOldJobs();
});
