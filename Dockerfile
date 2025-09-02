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

# Install production dependencies for server and root
RUN --mount=type=cache,target=/root/.yarn \
  --mount=type=cache,target=/root/.cache \
  yarn install --frozen-lockfile --production --ignore-workspaces --cwd server && \
  yarn install --frozen-lockfile --production

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

# Copy production dependencies (both server and root dependencies for plugins)
COPY --from=prod-deps --chown=nodejs:nodejs /app/server/node_modules ./node_modules
COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./root_node_modules

# Copy plugins directly into the image
COPY --chown=nodejs:nodejs plugins ./plugins

# Install axios in plugins directory for ES module compatibility and create config directory
WORKDIR /app/plugins
RUN npm init -y && npm install axios@1.7.9 && \
  mkdir -p /app/config && chown -R nodejs:nodejs /app/config

# Install axios globally for all plugin locations
RUN npm install -g axios@1.7.9

# Switch back to app directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV WEEB_SYNC_SERVER_HTTP_PORT=42380
# Extended NODE_PATH to include global modules and potential external plugin paths
ENV NODE_PATH=/usr/local/lib/node_modules:/app/plugins/node_modules:/app/root_node_modules:/app/node_modules

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
