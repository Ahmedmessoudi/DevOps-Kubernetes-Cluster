# ==============================================================================
# Dockerfile — Task Manager Backend (Express.js)
# Multi-stage build for minimal production image
# ==============================================================================

# --- Stage 1: Install dependencies ---
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# --- Stage 2: Production image ---
FROM node:18-alpine
WORKDIR /app

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy dependencies and source code
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Switch to non-root user
USER appuser

EXPOSE 5000

# Health check — hit the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

CMD ["node", "server.js"]
