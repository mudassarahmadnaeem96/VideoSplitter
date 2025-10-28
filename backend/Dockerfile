# Use a Node image that can install system packages
FROM node:20-bullseye

# --- Install dependencies ---
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3-pip \
    ca-certificates \
 && pip3 install --no-cache-dir yt-dlp \
 && rm -rf /var/lib/apt/lists/*

# --- Set up app ---
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 5000

# --- Start app ---
CMD ["node", "index.js"]
