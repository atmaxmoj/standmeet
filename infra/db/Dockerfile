# standmeet-db —— pgvector + 这一版的 schema，烤在一起。
#
# 为什么要有它：Coolify 的 "Docker Compose Empty" 是**粘贴**一份 compose，没有仓库。
# 而 `./backend/db/schema.sql` 那种相对挂载要仓库在部署目录里才解析得到 —— 没有仓库时
# 那一行挂到一个不存在的路径上，**postgres 会静默起一个空库**，不报错，然后后端每条查询
# 都炸，没有任何线索指回这里。让 owner 去 UI 里粘 76K 的 SQL 是把这个问题转嫁给他。
#
# schema.sql 仍然是**唯一真源**：这个镜像只是在构建时抄一份进去，抄的动作在
# `make release-build` 里跟别的镜像一起发生，所以它不可能落后于代码。
#
# ⚠️ 这份 schema **只在数据卷第一次创建时**被 postgres 跑一遍。换个新版本的 db 镜像
# **不会**改动已有的库 —— 镜像是新的，卷还是旧 schema。
#
# 已经在跑的实例靠**后端启动时自己打 migration**（`pgstore.Migrate`，编在后端二进制里）。
# 所以这两条路各管一端：新卷由这里建，老卷由那一头升 —— 没有第三条要人记得的路。

FROM pgvector/pgvector:pg16
# ghcr → repo linkage: GitHub reads this to list the pushed image under the repo's Packages.
LABEL org.opencontainers.image.source="https://github.com/atmaxmoj/standmeet"

COPY backend/db/schema.sql /docker-entrypoint-initdb.d/01-schema.sql
