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
# domain nodes = the 8 core modules from the class diagram + the capability axis. infra (leaf)/routes (top) are
# guarded by check-infra-not-domain + check-routes-not-imported respectively; here we only enforce **inter-domain** acyclicity.
DOMAINS = ["corpus", "conversation", "connector", "access", "owner",
           "security", "marketplace", "stats", "capabilities"]
# Sub-modules that keep their OWN boundary (same set check-domain-facade-boundary exempts): they are
# not the domain's DDD core, they are aggregators/plugins hanging off it with their own entry points
# (owner/ownercore is the owner-MCP cap bundle, owner/jobs the job loop, corpus/obsidian vault I/O,
# conversation/inference the agent engine). Since the facade rule already treats them as separate
# boundaries, this graph treats them as separate NODES -- otherwise an aggregator that legitimately
# reaches across domains would forge a cycle onto the core it merely sits next to. The core of each
# domain must still be a clean node.
SUBMODULES = {"jobs", "inference", "obsidian", "ownercore"}

def node_for(domain, dirpath):
    rel = os.path.relpath(dirpath, os.path.join(internal, domain)).split(os.sep)
    if rel and rel[0] in SUBMODULES:
        return domain + "/" + rel[0]
    return domain

nodes = list(DOMAINS)
for d in DOMAINS:
    for sub in sorted(SUBMODULES):
        if os.path.isdir(os.path.join(internal, d, sub)):
            nodes.append(d + "/" + sub)
edges = {d: set() for d in nodes}
for d in DOMAINS:
    for dirpath, _, files in os.walk(os.path.join(internal, d)):
        src = node_for(d, dirpath)
        for fn in files:
            if not fn.endswith(".go") or fn.endswith("_test.go"):
                continue
            txt = open(os.path.join(dirpath, fn)).read()
            for imp in re.findall(r'atmaxmoj/standmeet/internal/([a-z0-9_]+)(?:/([a-z0-9_]+))?', txt):
                dom, sub = imp
                if dom not in edges:
                    continue
                dst = dom + "/" + sub if sub in SUBMODULES and (dom + "/" + sub) in edges else dom
                if dst != src:
                    edges[src].add(dst)

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
print(f"check-domain-acyclic: {len(nodes)} domain/sub-module nodes, dependency graph is acyclic (DAG holds).")
PY
