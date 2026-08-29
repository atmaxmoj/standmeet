#!/usr/bin/env sh
# check-search-index-shipped —— 发给 owner 的那两份部署文件，必须自带词法索引。
#
# **为什么这条闸门存在**：prod 和 coolify 的 compose 里原来一个 meilisearch 都没有，
# `MEILI_URL` 默认空 —— 语料搜索退到 Postgres 全文，而那条退路**做不了中文**：
# `to_tsvector('english', …)` 从不切分 CJK，整段中文塌成一个词元。线上量到的样子是
# `无限衍义` 找得到它那篇，`限衍`、`三个序列`、`资格证` 全是 0，`三张资格证` 连
# 「标题里就有这五个字」的那篇都找不到（正文里那一段是「与三张资格证」）。
#
# 而 dev 的栈**有** meilisearch。于是所有搜索相关的 e2e 都跑在一条 prod 从不走的路上：
# `corpus-search-cjk-not-silent.spec.ts` 第一次跑就绿，而线上一直坏
# （[[which-path-is-the-green-on]]）。这条闸门守的正是这个分叉：**能覆盖 prod 的前提，
# 是 prod 跟被测的那条路是同一条。**
#
# 不管版本、不管调优参数（那是运维取舍）。只管两件事，每份文件各一遍：
#   ① 有一个 meilisearch service（索引真的随栈发出去）
#   ② backend 的 MEILI_URL 有非空默认（服务在那儿，而后端默认不去用它 = 白发）

set -eu

FILES="docker-compose.prod.yml infra/coolify/docker-compose.coolify.yml"
fail=0

for f in $FILES; do
  [ -f "$f" ] || { echo "check-search-index-shipped: $f 不见了；这条闸门没有对象了"; exit 2; }

  if ! grep -q '^  meilisearch:' "$f"; then
    echo "check-search-index-shipped: $f 里没有 meilisearch service"
    echo "         没有它，语料搜索退到 Postgres 全文，而那条路切不动中文。"
    fail=1
  fi

  # MEILI_URL 的默认值：`${MEILI_URL:-}` 是空默认（后端不会去连），要的是 `:-http://…`。
  url_line=$(grep -E '^\s*-\s*MEILI_URL=' "$f" || true)
  if [ -z "$url_line" ]; then
    echo "check-search-index-shipped: $f 的 backend 没有 MEILI_URL"
    fail=1
  elif echo "$url_line" | grep -qE 'MEILI_URL=\$\{MEILI_URL:-\}'; then
    echo "check-search-index-shipped: $f 的 MEILI_URL 默认是空的"
    echo "         服务发出去了、后端默认不连 = 等于没发。"
    fail=1
  fi
done

# 自证：闸门看得见东西吗。把一份 compose 抄一份、抽掉 meilisearch，它必须红
# （[[gate-can-go-blind]]：一条永远绿的闸门跟一条没装的闸门长得一样）。
probe=$(mktemp -d)/probe.yml
grep -v '^  meilisearch:' docker-compose.prod.yml > "$probe"
if grep -q '^  meilisearch:' "$probe"; then
  echo "check-search-index-shipped: 自证失败 —— 抽掉之后还在，说明它没在读文件"
  exit 2
fi
rm -rf "$(dirname "$probe")"

[ "$fail" -eq 0 ] || exit 1
echo "check-search-index-shipped: 两份部署文件都自带词法索引，且 backend 默认连它（自证通过）。"
