# Velite QA Nexus — Coolify-compatible Dockerfile
FROM node:20-alpine

# Install build tools for better-sqlite3 native binding
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY src ./src
COPY public ./public

# SQLite database + any persistent files live here.
# In Coolify, mount a Persistent Volume to /app/data so it survives redeploys.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8080

# Healthcheck — Coolify uses this to know the app is up
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "src/server.js"]
