# ALMTech Business Suite - production Dockerfile
# Multi-stage build:
#   1. Build the React frontend
#   2. Install backend deps
#   3. Final slim image that runs the backend (which serves the frontend)

# ---------- 1. Build frontend ----------
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- 2. Install backend deps ----------
FROM node:22-slim AS backend-deps
WORKDIR /app/backend
COPY backend/package*.json ./
# Production install only — no devDependencies, no mongodb-memory-server downloads
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 3. Final runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy backend source + production node_modules
COPY backend/ ./backend/
COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules

# Copy frontend build into the location server.js expects
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy logo files referenced by the PDF generator
COPY frontend/public/almtech-logo*.png ./frontend/public/

EXPOSE 8080
ENV PORT=8080
WORKDIR /app/backend
CMD ["node", "src/server.js"]
