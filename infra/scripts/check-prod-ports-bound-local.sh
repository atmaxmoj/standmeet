#!/usr/bin/env sh
# check-prod-ports-bound-local —— 内部服务的发布端口只许绑到 127.0.0.1。
#
# **为什么这条闸门存在**（pentest 2026-09-01，整场最严重的一条）：
# docker 的 `"5532:5432"` 默认绑 **0.0.0.0** —— 所有网卡。而这台是自托管、本该只由
# 前面的 TLS 反代对外。于是 db / redis / minio / backend 的端口对**整个网络**敞开。
# redis 还没设密码：从 app 网络外无认证连上 :6479，SCAN 一下就读到 owner 的管理员
# session token（key 名就是明文 token），拿它当 smt_session cookie → **整个实例接管**，
# 零猜码。postgres / minio 同样只差一个密码。
#
# 这些端口没有任何东西需要它们对外：app 走 docker 内网服务名连，`make prod-psql` /
# `prod-redis` 走 `docker compose exec`。绑到 127.0.0.1 保留宿主侧调试，去掉网络暴露。
#
# 闸门守一个方向：下面这些服务的每一条 `ports:` 发布，host 侧必须是 127.0.0.1
# （或一个由运维显式选择的 ${...} 变量）。bare `"NNNN:MMMM"` = 0.0.0.0 → 红。

set -eu

COMPOSE="docker-compose.prod.yml"
[ -f "$COMPOSE" ] || { echo "check-prod-ports-bound-local: $COMPOSE 不见了；闸门没有对象了"; exit 2; }

# 内部服务：绝不该对网络暴露。app 是有意的对外面（另由 ${APP_BIND_HOST} 控制），不在此列。
INTERNAL="db redis minio backend meilisearch"

# scan —— 走一遍 compose，跟踪当前 service，对 INTERNAL 服务的每条发布端口，
# 要求 host 侧是 127.0.0.1 或 ${变量}。返回违规行（空 = 干净）。
scan() {
  awk -v internal=" $INTERNAL " '
    /^  [a-zA-Z0-9_-]+:/ {
      svc=$1; sub(/:$/,"",svc); inports=0; next
    }
    /^    ports:/ { inports=(index(internal, " " svc " ")>0); next }
    /^    [a-zA-Z]/ { inports=0 }
    inports && /^      - / {
      line=$0
      # 取引号里的映射，例如 "5532:5432" 或 "127.0.0.1:5532:5432"
      gsub(/[" ]/,"",line); sub(/^-/,"",line)
      # host 侧 = 第一段（到第一个冒号）。冒号数 <2 表示没写 host bind = 0.0.0.0。
      n=gsub(/:/,":",line)
      hostpart=line; sub(/:.*/,"",hostpart)
      if (n < 2) { print svc " -> " line "  (binds 0.0.0.0 — 全网可达)"; next }
      if (hostpart != "127.0.0.1" && hostpart !~ /^\$\{/) {
        print svc " -> " line "  (host bind " hostpart " 不是 127.0.0.1)"
      }
    }
  ' "$COMPOSE"
}

# self-test：把一个 0.0.0.0 发布种进一个临时 compose，必须被抓到。
selftest() {
  tmp=$(mktemp)
  printf '  redis:\n    image: r\n    ports:\n      - "6479:6379"\n' > "$tmp"
  hit=$(COMPOSE="$tmp" ; awk -v internal=" redis " '
    /^  [a-zA-Z0-9_-]+:/ { svc=$1; sub(/:$/,"",svc); inports=0; next }
    /^    ports:/ { inports=(index(internal, " " svc " ")>0); next }
    inports && /^      - / { l=$0; gsub(/[" ]/,"",l); sub(/^-/,"",l); if (gsub(/:/,":",l)<2) print "hit" }
  ' "$tmp")
  rm -f "$tmp"
  [ "$hit" = "hit" ] || { echo "check-prod-ports-bound-local: self-test 没抓到种下的 0.0.0.0 绑定 —— 闸门坏了"; exit 2; }
}

selftest
violations=$(scan)
if [ -n "$violations" ]; then
  echo "check-prod-ports-bound-local: 内部服务的端口绑到了 0.0.0.0（全网可达）——"
  echo "$violations" | sed 's/^/  /'
  echo "  改成 127.0.0.1:<host>:<container>（自托管本该只由 TLS 反代对外；"
  echo "  这些端口没有东西需要对外，app 走内网、prod-psql/redis 走 exec）。"
  exit 1
fi
echo "check-prod-ports-bound-local: 内部服务($INTERNAL)的发布端口都绑在 127.0.0.1（self-test 通过）。"
