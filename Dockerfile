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
# Compile MCP distribution (normally done by postinstall)
RUN pnpm build:mcp
# Dashboard install (own workspace + lockfile): provides tsx, ws, react
RUN cd apps/web-dashboard && pnpm install --frozen-lockfile

FROM node:22-alpine AS runner
RUN npm install -g pnpm@11.1.1
WORKDIR /app
# Compiled MCP server + runtime deps from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
# Dashboard (source + deps) for the WebSocket server
COPY --from=builder /app/apps/web-dashboard ./apps/web-dashboard
# src/core needed for @gentle-vanguard/core resolution via tsconfig paths
COPY --from=builder /app/src ./src
# Recreate the @gentle-vanguard/core link (mimics src/bootstrap-symlink.ts)
RUN mkdir -p apps/web-dashboard/node_modules/@gentle-vanguard \
    && ln -s /app/src/core apps/web-dashboard/node_modules/@gentle-vanguard/core
EXPOSE 8080 3001 8081 9090
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1
CMD ["sh", "-c", "cd apps/web-dashboard && npx tsx server/websocket-server.ts"]
