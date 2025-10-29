export async function convertVideo(url, prefix, split_seconds) {
  const res = await fetch("https://videosplitter.onrender.com/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, prefix, split_seconds }),
  });
  return await res.json();
}
