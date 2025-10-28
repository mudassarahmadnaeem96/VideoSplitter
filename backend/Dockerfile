FROM node:20-bullseye

# Install ffmpeg + yt-dlp dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-pip \
        ca-certificates \
        openssl \
        curl && \
    pip3 install --no-cache-dir yt-dlp certifi && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "index.js"]
