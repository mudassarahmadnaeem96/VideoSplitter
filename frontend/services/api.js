// frontend/src/services/api.js
const API_BASE = "https://videosplitter.onrender.com"; // ✅ your live backend

export async function convertVideo(url) {
  const res = await fetch(`${API_BASE}/api/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return res.json();
}
