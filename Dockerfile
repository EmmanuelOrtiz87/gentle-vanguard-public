# Root Dockerfile — builds the Gentle-Vanguard stack image: MCP skill
# server (dist/) + compiled src. The dashboard moved out of the stack repo
# (local-first apps with own git, ADR-0017) and now ships its own image.
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
COPY --from=builder --chown=app:app /app/src ./src
RUN chown -R app:app /app
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('node:fs').statSync('dist/scripts/mcp/skill-server.js')" || exit 1
CMD ["node", "dist/scripts/mcp/skill-server.js"]
