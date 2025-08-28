# syntax=docker/dockerfile:1

# Build arguments for flexible versioning
ARG NODE_VERSION=22-alpine
ARG BUILD_DATE
ARG VCS_REF

# --- Base Stage ---
FROM node:${NODE_VERSION} AS base

# Set working directory
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# --- Dependencies Stage ---
FROM base AS deps

# Copy package files for better layer caching
COPY package.json yarn.lock ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install all dependencies with cache mount for faster rebuilds
RUN --mount=type=cache,target=/root/.yarn \
  --mount=type=cache,target=/root/.cache \
  yarn install --frozen-lockfile

# --- Build Stage ---
FROM base AS build

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules

# Copy all source files
COPY . .

# Build the application with cache mount
RUN --mount=type=cache,target=/root/.yarn \
  --mount=type=cache,target=/root/.cache \
  yarn run build

# --- Production Dependencies Stage ---
FROM base AS prod-deps

# Copy package files with bind mounts for efficiency
COPY package.json yarn.lock ./
COPY server/package.json ./server/

# Install only production dependencies for server with cache mount
RUN --mount=type=cache,target=/root/.yarn \
  --mount=type=cache,target=/root/.cache \
  yarn install --frozen-lockfile --production --ignore-workspaces --cwd server

# --- Runtime Stage ---
FROM node:${NODE_VERSION} AS runtime

# Re-declare ARGs in this stage to use them in labels
ARG BUILD_DATE
ARG VCS_REF

# Install dumb-init, python3, and create non-root user for security
RUN apk add --no-cache dumb-init py3-pip python3 && \
  # Remove the EXTERNALLY-MANAGED file to allow pip installs
  rm -f /usr/lib/python*/EXTERNALLY-MANAGED && \
  addgroup -g 1001 -S nodejs && \
  adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy built application directly to root (not in build subdirectory)
COPY --from=build --chown=nodejs:nodejs /app/build .

# Copy production dependencies
COPY --from=prod-deps --chown=nodejs:nodejs /app/server/node_modules ./node_modules

# Create config directory with proper permissions
RUN mkdir -p /app/config && chown -R nodejs:nodejs /app/config

# Set production environment
ENV NODE_ENV=production
ENV WEEB_SYNC_SERVER_HTTP_PORT=42380

# Add metadata labels
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
  org.opencontainers.image.source="https://github.com/BastianGanze/weebsync" \
  org.opencontainers.image.revision="${VCS_REF}" \
  org.opencontainers.image.vendor="WeebSync" \
  org.opencontainers.image.title="WeebSync" \
  org.opencontainers.image.description="A small tool to automatically sync files from an ftp server." \
  org.opencontainers.image.licenses="MIT"

# Switch to non-root user
USER nodejs

# Expose the port
EXPOSE 42380

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:42380/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => { process.exit(1); })" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run the application
CMD ["node", "index.js"]
