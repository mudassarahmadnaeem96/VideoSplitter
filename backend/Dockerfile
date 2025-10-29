# ===================================================
# 📦  Dockerfile for CorixTech Shorts Studio Backend
# ===================================================
FROM node:20-slim

# -----------------------------
# 1️⃣  Install ffmpeg + yt-dlp
# -----------------------------
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl && \
    pip install --no-cache-dir yt-dlp && \
    rm -rf /var/lib/apt/lists/*

# -----------------------------
# 2️⃣  Set up app directory
# -----------------------------
WORKDIR /app

# Copy package manifests first for dependency caching
COPY package*.json ./

# Install dependencies (omit dev)
RUN npm install --omit=dev

# -----------------------------
# 3️⃣  Copy project files
# -----------------------------
COPY . .

# -----------------------------
# 4️⃣  Expose & run
# -----------------------------
EXPOSE 5000
CMD ["node", "index.js"]
