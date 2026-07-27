#!/usr/bin/env bash
# check-domain-acyclic.sh —— backend/internal/ **domain-level dependency graph must be acyclic**.
#
# go-arch-lint only enforces **package-level** acyclicity (Go won't compile a cycle anyway). But
# treating each internal/<top-dir>/** as **one node**, sub-packages can split a domain-level cycle
# into a package-level DAG —— slipping past go-arch-lint. This lint treats each internal top-level
# directory as a node, builds the inter-domain import graph, and is red if there is a cycle.
#
# Each domain should be a clean node (able to get a thin facade); a domain-level cycle = layering not sorted out, break the cycle first.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INTERNAL="$ROOT/backend/internal"

python3 - "$INTERNAL" <<'PY'
import os, re, sys
internal = sys.argv[1]
# domain nodes = the 8 core modules from the class diagram + the capability axis. infra (leaf)/routes (top)/usecases are
# guarded by check-infra-not-domain + check-routes-not-imported respectively; here we only enforce **inter-domain** acyclicity.
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
    print("check-domain-acyclic: internal/ domain-level dependencies have a cycle —— layering not sorted out, break the cycle first:")
    for c in cycles:
        print("  CYCLE: " + " -> ".join(c))
    sys.exit(1)
print(f"check-domain-acyclic: {len(nodes)} domain nodes, dependency graph is acyclic (DAG holds).")
PY
