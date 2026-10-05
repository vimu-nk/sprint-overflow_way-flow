# Build context: repo root. Multi-stage, non-root runtime (specs/19 SEC-64).
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@wayflow/api
RUN pnpm deploy --filter=@wayflow/api --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production TZ=Asia/Colombo
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=12 CMD wget -qO- http://127.0.0.1:3000/api/v1/ready || exit 1
CMD ["node", "dist/main.js"]
