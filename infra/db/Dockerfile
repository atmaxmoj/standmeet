# standmeet-db —— pgvector baked together with this version's schema.
#
# Why this image exists: Coolify's "Docker Compose Empty" **pastes** a
# compose file — there's no repo checkout. A relative mount like
# `./backend/db/schema.sql` only resolves when the repo sits in the deploy
# directory — without a repo, that line mounts onto a path that doesn't
# exist, **postgres silently starts an empty database**, no error, and then
# every backend query blows up with nothing pointing back to the cause.
# Making the owner paste 76K of SQL into the UI would just push this problem
# onto him.
#
# schema.sql remains the **single source of truth**: this image only copies
# a snapshot of it in at build time, and that copy happens alongside the
# other images in `make release-build`, so it can never fall behind the code.
#
# Warning: this schema is run by postgres **only the first time the data
# volume is created**. Shipping a new version of the db image does **not**
# change an existing database — the image is new, but the volume still has
# the old schema.
#
# An already-running instance is upgraded by the **backend applying its own
# migration on startup** (`pgstore.Migrate`, built into the backend binary).
# So these two paths each own one end: a new volume is built here, an old
# volume is upgraded there — there's no third path that requires someone to
# remember it.

FROM pgvector/pgvector:pg16
# ghcr → repo linkage: GitHub reads this to list the pushed image under the repo's Packages.
LABEL org.opencontainers.image.source="https://github.com/atmaxmoj/standmeet"

COPY backend/db/schema.sql /docker-entrypoint-initdb.d/01-schema.sql
