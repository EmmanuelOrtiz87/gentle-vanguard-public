FROM node:22-alpine AS builder
RUN npm install -g pnpm@11.1.1
WORKDIR /app
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY scripts/mcp/ scripts/mcp/
COPY apps/web-dashboard/package.json apps/web-dashboard/tsconfig.json apps/web-dashboard/
RUN pnpm install --frozen-lockfile
COPY scripts/mcp/ scripts/mcp/
COPY apps/web-dashboard/server/ apps/web-dashboard/server/
RUN pnpm build:mcp
RUN npx tsc apps/web-dashboard/server/websocket-server.ts --outDir apps/web-dashboard/server/dist --moduleResolution node --module nodenext --target es2022 --esModuleInterop --skipLibCheck

FROM node:22-alpine AS runner
RUN npm install -g pnpm@11.1.1
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/apps/web-dashboard/server/dist apps/web-dashboard/server/dist
COPY apps/web-dashboard/package.json apps/web-dashboard/
RUN cd apps/web-dashboard && pnpm install --prod --frozen-lockfile
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1
CMD ["node", "apps/web-dashboard/server/dist/websocket-server.js"]
