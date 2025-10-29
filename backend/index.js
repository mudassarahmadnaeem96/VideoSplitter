// ---------------------------------------------------------------------------
// ✅ Robust Piped Fallback Downloader (works in both ESM & CommonJS)
// ---------------------------------------------------------------------------

let fetch;
try {
  // Try native fetch (Node 18+)
  fetch = global.fetch || (await import("node-fetch")).default;
} catch {
  fetch = (await import("node-fetch")).default;
}

export async function downloadViaPiped(videoId) {
  const mirrors = [
    "https://pipedapi.kavin.rocks",
    "https://piped.mha.fi",
    "https://piped.video",
    "https://pipedapi.tokhmi.xyz",
    "https://pipedapi.adminforge.de",
    "https://pipedapi.syncpundit.io"
  ];

  console.log(`🎯 Starting Piped fallback for videoId=${videoId}`);

  for (const base of mirrors) {
    const url = `${base}/streams/${videoId}`;
    console.log(`🌐 Trying Piped mirror: ${url}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CorixTechBot/1.0)" },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        console.warn(`⚠️ ${base} returned status ${res.status}`);
        continue;
      }

      const text = await res.text();

      if (text.startsWith("<!DOCTYPE") || text.includes("<html")) {
        console.warn(`⚠️ ${base} returned HTML instead of JSON, skipping...`);
        continue;
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        console.warn(`⚠️ JSON parse error from ${base}: ${err.message}`);
        continue;
      }

      if (!json.videoStreams || json.videoStreams.length === 0) {
        console.warn(`⚠️ ${base} returned no valid streams`);
        continue;
      }

      const stream =
        json.videoStreams.find((s) => s.quality === "720p") ||
        json.videoStreams[0];

      if (!stream?.url) {
        console.warn(`⚠️ ${base} has no playable stream URL`);
        continue;
      }

      console.log(`✅ Success! Using Piped stream from ${base}`);
      return stream.url;
    } catch (err) {
      console.warn(`❌ ${base} failed: ${err.name} - ${err.message}`);
    }
  }

  throw new Error("❌ All Piped mirrors failed — no valid response found.");
}
