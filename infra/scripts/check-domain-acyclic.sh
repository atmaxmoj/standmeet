#!/usr/bin/env bash
# check-domain-acyclic.sh —— backend/internal/ 的**域级依赖图必须无环**。
#
# go-arch-lint 只管**包级**无环(Go 本来就编译不过环)。但把每个 internal/<top-dir>/**
# 当**一个节点**看,子包可以把一个域级环拆成包级 DAG —— 逃过 go-arch-lint。这个 lint
# 把每个 internal 顶层目录当节点,构域间 import 图,有环即红。
#
# 每个域应是干净节点(能给它一个薄 facade);域级环 = 层次没理清,先解环。
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INTERNAL="$ROOT/backend/internal"

python3 - "$INTERNAL" <<'PY'
import os, re, sys
internal = sys.argv[1]
# 域节点 = 类图 8 个 core module + capability 轴。infra(叶子)/routes(顶层)/usecases 由
# check-infra-not-domain + check-routes-not-imported 分别守;这里只管**域间**无环。
nodes = ["corpus", "conversation", "connector", "access", "owner",
         "security", "marketplace", "stats", "capabilities"]
edges = {d: set() for d in nodes}
for d in nodes:
    for dirpath, _, files in os.walk(os.path.join(internal, d)):
        for fn in files:
            if not fn.endswith(".go") or fn.endswith("_test.go"):
                continue
            txt = open(os.path.join(dirpath, fn)).read()
            for imp in re.findall(r'atmaxmoj/standmeet/internal/([a-z0-9_]+)', txt):
                if imp in edges and imp != d:
                    edges[d].add(imp)

# DFS cycle detection
WHITE, GREY, BLACK = 0, 1, 2
color = {d: WHITE for d in nodes}
cycles = []
def dfs(u, stack):
    color[u] = GREY; stack.append(u)
    for v in sorted(edges[u]):
        if color[v] == GREY:
            cycles.append(stack[stack.index(v):] + [v])
        elif color[v] == WHITE:
            dfs(v, stack)
    color[u] = BLACK; stack.pop()
for d in sorted(nodes):
    if color[d] == WHITE:
        dfs(d, [])

if cycles:
    print("check-domain-acyclic: internal/ 域级依赖出现环 —— 层次没理清,先解环:")
    for c in cycles:
        print("  CYCLE: " + " -> ".join(c))
    sys.exit(1)
print(f"check-domain-acyclic: {len(nodes)} 个域节点,依赖图无环 (DAG 成立)。")
PY
