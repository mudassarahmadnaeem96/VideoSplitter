FROM node:20-bullseye

# Install system dependencies (ffmpeg, Python, yt-dlp, certifi)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-pip \
        ca-certificates \
        curl \
        openssl && \
    pip3 install --no-cache-dir --upgrade yt-dlp certifi && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "index.js"]
