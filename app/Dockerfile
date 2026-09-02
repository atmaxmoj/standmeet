# StandMeet web app —— minimal runtime image.
#
# Build 在 host 上跑（pnpm install + pnpm build），Docker 只装运行时。
# 这避开了在容器里跑 pnpm install 走 npm registry 的慢网络（实测 30 KiB/s）。
#
# 使用流程：
#   1. host 执行 `pnpm install && pnpm run build`（Makefile 的 app-build target）
#   2. docker compose build app  —— 只 COPY 已生成的 .next/standalone
#
# 这相当于 "build artifact → image"，类似 Go binary 镜像的做法。

FROM node:22-alpine
# ghcr → repo linkage: GitHub reads this to list the pushed image under the repo's Packages.
LABEL org.opencontainers.image.source="https://github.com/atmaxmoj/standmeet"
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# outputFileTracingRoot 改成 workspace 根之后，.next/standalone 内部布局
# 是 `<workspace>/app/server.js` + `<workspace>/node_modules/.pnpm/...`。
# 整个 standalone 整体当 /app 用，server.js 在子目录 app/。
COPY --chown=nextjs:nodejs .next/standalone ./
COPY --chown=nextjs:nodejs .next/static ./app/.next/static
COPY --chown=nextjs:nodejs public ./app/public
USER nextjs
WORKDIR /app/app
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
