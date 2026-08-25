# Root Dockerfile — builds the full Gentle-Vanguard stack image:
# MCP skill server (dist/) + dashboard WebSocket server (tsx).
# Build from repo root: docker build -t gentle-vanguard .

FROM node:22-alpine AS builder
RUN npm install -g pnpm@11.1.1
RUN apk add --no-cache git
WORKDIR /app
# Full repo copy: the postinstall script (pnpm build:mcp = pnpm tsc)
# compiles every tsconfig include dir (adapters, scripts/*, src), so the
# whole tree must be present.
COPY . .
# Install without prepare scripts (lefthook needs git which fails in copy)
RUN pnpm install --frozen-lockfile --ignore-scripts
# Run the build scripts blocked by --ignore-scripts (better-sqlite3 prebuilt,
# esbuild) — honors allowBuilds in pnpm-workspace.yaml
RUN pnpm rebuild --pending
# Compile MCP distribution (normally done by postinstall)
RUN pnpm build:mcp

FROM node:22-alpine AS runner
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
# Compiled MCP server + runtime deps from builder
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
# Dashboard (source + deps) for the WebSocket server — workspace member installed
# by the root pnpm install in the builder stage
COPY --from=builder --chown=app:app /app/apps/web-dashboard ./apps/web-dashboard
# src/core needed for @gentle-vanguard/core resolution via tsconfig paths
COPY --from=builder --chown=app:app /app/src ./src
# Recreate the @gentle-vanguard/core link (mimics src/bootstrap-symlink.ts)
RUN mkdir -p apps/web-dashboard/node_modules/@gentle-vanguard \
    && ln -s /app/src/core apps/web-dashboard/node_modules/@gentle-vanguard/core \
    && chown -R app:app /app
USER app
EXPOSE 8080 3001 8081 9090
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1
CMD ["sh", "-c", "cd apps/web-dashboard && npx tsx server/websocket-server.ts"]
