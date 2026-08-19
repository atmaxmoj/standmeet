#!/usr/bin/env sh
# check-redis-bounded —— 发给 owner 的那份部署文件，必须给 redis 封顶并给一条淘汰策略。
#
# **为什么这条闸门存在（F-R-10）**：redis 里装着**访客会话、限流桶、job 池（1 天 TTL）**，
# 而 `docker-compose.prod.yml` 原来只有一行 `image: redis:7-alpine` —— 没有 `command:`、
# 容器也没有内存限制。跑起来是 `maxmemory 0` + `maxmemory-policy noeviction`。
#
# 那两个默认值合在一起的意思是：**内存不封顶，涨到宿主受不了为止**；而万一有人在外面
# 封了顶，`noeviction` 又会让写入**直接失败**，而不是丢掉最旧的那几条。
# 自托管的机器往往不大，所以真实的失败形态是 **redis 容器被 OOM 杀掉，所有会话一起没** ——
# 不是「最旧的会话被淘汰」。一个人的实例安静地死掉，而他看到的只是「访客说打不开」。
#
# 上限取多少属于运维取舍（跟机器大小绑着），所以这里**不管数值**，只管三件事：
#   ① 有 `--maxmemory`（封了顶）
#   ② 有 `--maxmemory-policy`，且不是 `noeviction`（顶到了要丢东西，不是拒绝写入）
#   ③ 数值可以被环境变量覆盖（不同大小的机器不该改 compose）
#
# 只看 prod 那份：dev/verify 的栈是测试台，不发给任何人。

set -eu

FILE="docker-compose.prod.yml"
fail=0

[ -f "$FILE" ] || { echo "check-redis-bounded: $FILE is gone; this gate has no subject"; exit 2; }

# redis_block —— 取出 redis 那个 service 的定义（到下一个同级 key 为止）。
redis_block() {
  awk '/^  redis:/ { inblock = 1; next }
       inblock && /^  [a-z]/ { inblock = 0 }
       inblock { print }' "$1"
}

# flatten —— 把整块压成一行再匹配。`command:` 有两种写法（一行字符串 / 一条一项的列表），
# 列表那种每个 token 自成一行，于是「`--maxmemory` 后面跟个空格」这种模式一条都匹配不到。
# 第一版就栽在这儿：红的是我的正则，不是那份 compose（[[read-the-failure-before-theorising]]）。
flatten() { tr '\n' ' ' | tr -s ' '; }

block=$(redis_block "$FILE" | flatten)

printf '%s' "$block" | grep -q -- '--maxmemory[ ]' || {
  echo "check-redis-bounded: redis has no --maxmemory in $FILE"
  echo "                     unbounded means the container grows until the host kills it,"
  echo "                     and every visitor session goes at once (F-R-10)."
  fail=1
}

policy=$(printf '%s' "$block" | grep -o -- '--maxmemory-policy - *[a-z-]*' \
  | awk '{print $NF}')
[ -n "$policy" ] || policy=$(printf '%s' "$block" \
  | grep -o -- '--maxmemory-policy [a-z-]*' | awk '{print $2}')
case "$policy" in
  '')
    echo "check-redis-bounded: redis has no --maxmemory-policy in $FILE"
    fail=1
    ;;
  noeviction)
    echo "check-redis-bounded: policy is noeviction — at the cap, writes FAIL instead of"
    echo "                     dropping the oldest key. A visitor gets an error the owner"
    echo "                     never sees. Pick an evicting policy (allkeys-lru / volatile-ttl)."
    fail=1
    ;;
  *) ;;
esac

printf '%s' "$block" | grep -q '\${' || {
  echo "check-redis-bounded: the cap is not overridable by an environment variable —"
  echo "                     a 1 GB box and a 64 GB box should not need different compose files."
  fail=1
}

# 自证：种一份「只有 image、没有 command」的 redis（也就是修之前的样子），必须判红。
planted=$(mktemp -t redischeck.XXXXXX)
cat > "$planted" <<'PLANTED'
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
  gotenberg:
    image: gotenberg/gotenberg:8
PLANTED
if printf '%s' "$(redis_block "$planted")" | grep -q -- '--maxmemory '; then
  echo "check-redis-bounded: SELF-TEST FAILED — a redis with no command must look unbounded"
  rm -f "$planted"; exit 2
fi
rm -f "$planted"

[ "$fail" -eq 0 ] || exit 1
echo "check-redis-bounded: redis is capped, evicts at the cap, and the cap is tunable by env."
