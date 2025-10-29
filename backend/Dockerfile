# ---------- Base ----------
FROM node:20-bullseye

WORKDIR /app

# ---------- System tools ----------
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-venv python3-pip curl && \
    python3 -m venv /venv && \
    /venv/bin/pip install --no-cache-dir yt-dlp && \
    rm -rf /var/lib/apt/lists/*

# Add venv to PATH
ENV PATH="/venv/bin:$PATH"

# ---------- Node setup ----------
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 10000
CMD ["npm", "start"]
