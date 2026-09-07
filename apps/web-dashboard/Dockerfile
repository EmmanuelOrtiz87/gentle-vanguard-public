# Build from repo root: docker build -f apps/web-dashboard/Dockerfile .
# Context must be repo root so pnpm workspace resolves correctly.

FROM node:20-alpine AS builder
RUN npm install -g pnpm@11.1.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/web-dashboard/package.json apps/web-dashboard/tsconfig.json apps/web-dashboard/tsconfig.node.json apps/web-dashboard/vite.config.ts apps/web-dashboard/tailwind.config.js apps/web-dashboard/postcss.config.js apps/web-dashboard/index.html apps/web-dashboard/
COPY apps/web-dashboard/src/ apps/web-dashboard/src/
COPY apps/web-dashboard/public/ apps/web-dashboard/public/
RUN pnpm install --frozen-lockfile
RUN cd apps/web-dashboard && pnpm build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/web-dashboard/dist /usr/share/nginx/html
COPY apps/web-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
