# im-bridge —— IM 桥。
#
# 它是这台实例的一个**外部访客客户端**：持一张码、开会话、发一轮 —— 跟浏览器走同一条路。
# 所以镜像里不需要后端的任何东西，只要 node + 这个包 + 它的依赖。
#
# 走**长轮询**（见 src/main.ts），所以这个容器不监听任何端口，也不需要公网入口。

FROM node:22-alpine AS build
WORKDIR /app

# pnpm 工作区：桥依赖 @standmeet/sdk-core（workspace:*），所以要带上它。
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY sdk/packages/core sdk/packages/core
COPY im-bridge im-bridge
RUN pnpm install --filter @standmeet/im-bridge... --frozen-lockfile
# **sdk-core 必须在镜像里构建**：它的 package.json 指向 dist/，而 dist/ 不进 context
# （带进去就会有「镜像里跑的跟仓库里写的不是同一份」的风险）。少了这一步，
# 容器起来会在 import 那一行炸 —— 而本机 tsx 跑得好好的，因为本机有 dist。
RUN pnpm -F @standmeet/sdk-core build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=build /app /app
WORKDIR /app/im-bridge
# tsx 直接跑 TS：这个服务小到不值得为它再加一层构建产物。
# 装进依赖里而不是 `npx` 现拉 —— 镜像要能离线起来。
CMD ["npx", "--no-install", "tsx", "src/main.ts"]
