async function downloadViaPiped(videoId) {
  const mirrors = [
    "https://pipedapi.kavin.rocks",
    "https://piped.mha.fi",
    "https://piped.video",
    "https://pipedapi.tokhmi.xyz"
  ];

  for (const base of mirrors) {
    try {
      console.log(`🌐 Trying Piped mirror: ${base}`);
      const res = await fetch(`${base}/streams/${videoId}`);
      const text = await res.text();

      // If HTML error (starts with '<!DOCTYPE'), skip
      if (text.startsWith("<!DOCTYPE")) {
        console.warn(`⚠️ ${base} returned HTML instead of JSON`);
        continue;
      }

      const json = JSON.parse(text);
      if (!json.videoStreams?.length) throw new Error("No streams found");

      const streamUrl =
        json.videoStreams.find((s) => s.quality === "720p")?.url ||
        json.videoStreams[0]?.url;

      if (!streamUrl) throw new Error("No stream URL found");
      console.log(`✅ Using Piped stream from ${base}`);
      return streamUrl;
    } catch (err) {
      console.warn(`❌ Piped mirror failed (${base}): ${err.message}`);
    }
  }
  throw new Error("All Piped mirrors failed");
}
