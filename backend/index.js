// ---------------------------------------------------------------------------
// Enhanced Piped API Downloader (multi-mirror, safe JSON parsing, full logging)
// ---------------------------------------------------------------------------
async function downloadViaPiped(videoId) {
  const mirrors = [
    "https://pipedapi.kavin.rocks",
    "https://piped.mha.fi",
    "https://piped.video",
    "https://pipedapi.tokhmi.xyz",
    "https://pipedapi.adminforge.de",
    "https://pipedapi.syncpundit.io"
  ];

  console.log(`🎯 Trying to fetch via Piped fallback for videoId=${videoId}`);

  for (const base of mirrors) {
    try {
      console.log(`🌐 Trying Piped mirror: ${base}`);

      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000
      });

      const text = await res.text();

      // Check for HTML response (usually Cloudflare / error page)
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

      if (!json.videoStreams?.length) {
        console.warn(`⚠️ No valid streams returned by ${base}`);
        continue;
      }

      // Choose 720p if available, else first available stream
      const streamUrl =
        json.videoStreams.find((s) => s.quality === "720p")?.url ||
        json.videoStreams[0]?.url;

      if (!streamUrl) {
        console.warn(`⚠️ No stream URL found in ${base} response`);
        continue;
      }

      console.log(`✅ Success! Using Piped stream from ${base}`);
      return streamUrl;
    } catch (err) {
      console.warn(`❌ Piped mirror failed (${base}): ${err.message}`);
    }
  }

  throw new Error("All Piped mirrors failed — none returned valid JSON.");
}
