FROM python:3.12-slim-bullseye AS ytdlp-builder
# 🧰 Install yt-dlp and dependencies into /usr/local/bin
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl ffmpeg && \
    pip install --upgrade pip && \
    pip install --no-cache-dir yt-dlp certifi && \
    update-ca-certificates

FROM node:20-bullseye
# Copy yt-dlp & ffmpeg from builder image
COPY --from=ytdlp-builder /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=ytdlp-builder /usr/bin/ffmpeg /usr/bin/ffmpeg
COPY --from=ytdlp-builder /etc/ssl/certs /etc/ssl/certs

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "index.js"]
