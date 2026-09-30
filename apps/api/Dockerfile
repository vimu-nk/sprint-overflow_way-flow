# Build context: repo root
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@wayflow/api
RUN pnpm deploy --filter=@wayflow/api --prod --legacy /out

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
EXPOSE 3000
CMD ["node", "dist/main.js"]
