# StandMeet

A self-hostable page that answers for you.

You think out loud in whatever AI client you already use — Claude Desktop, Cursor,
anything that speaks MCP — and it files the substance into a personal corpus. Visitors
land on your page and talk to an AI that answers in your voice, grounded in that corpus.
It replaces the narrow slice of you that a résumé or a LinkedIn profile can hold.

Your notes stay yours: the corpus mirrors an Obsidian vault in both directions, so the
files on your disk remain the thing you edit.

---

## Deploying on Coolify

Template: [`infra/coolify/docker-compose.coolify.yml`](infra/coolify/docker-compose.coolify.yml)

**New Resource → Docker Based → Docker Compose Empty**, then paste the template in. No git
source needed: there is not a single host mount, and all five images come from ghcr.

The schema is baked into the `standmeet-db` image rather than bind-mounted, because a pasted
compose has no repository behind it — `./backend/db/schema.sql` would resolve to nothing, and
**Postgres starts an empty database silently** rather than failing, leaving every later query
broken with nothing pointing back at the cause. `backend/db/schema.sql` is still the one
source; the image copies it at build time, alongside the other four.

### It pulls images, it does not build them

`app/Dockerfile` copies a `.next/standalone` that was built on the host; it does not run
`next build` itself. A fresh checkout has no `.next`, so building this stack from git cannot
work. The template therefore pins published images — `v0.0.3` is on ghcr and is what it
points at.

To cut your own:

```bash
git tag -a v0.0.4 -m "…"                      # the tag is the version; nothing else holds it
docker login ghcr.io                           # a PAT, or: gh auth refresh -s write:packages
make release-build && make release-push
```

The image tag comes from `git describe`, so a dirty tree publishes as `v0.0.4-dirty` rather
than quietly claiming to be the release. `make release-push` will not push until `make
secrets` (the full history) and `make secrets-image` (the built image filesystems) both come
back clean.

`release-build` is not `app-build`. It sets `STRIP_TEST_HOOKS=1`, which removes every
`data-testid` from the shipped markup, and then asserts they are gone rather than trusting
the flag — the switch lives in a string comparison in `next.config.ts`, and a strip that
silently stopped working looks exactly like one that works. The dev and prod stacks keep
their testids: e2e and the real-environment audits both locate by them, and neither is the
build that goes to visitors.

### Two domains

- **the app** — your public page. Coolify assigns it from `SERVICE_FQDN_APP_3000`.
- **object storage** — `SERVICE_FQDN_MINIO_9000`, e.g. `files.yourdomain`.

The second one is not optional. Images you attach to notes are handed to visitors as signed
URLs, and those URLs go to a *browser*, which cannot resolve `minio:9000`. Point
`STORAGE_PUBLIC_URL` at something the public internet can reach or every image renders as a
zero-sized box — which neither a screenshot nor a DOM assertion will show you.

### Secrets

Coolify generates and persists these; you never type them:

| Variable | What it protects |
|---|---|
| `SERVICE_PASSWORD_POSTGRES` | the database |
| `SERVICE_PASSWORD_64_SESSION` | session signing |
| `SERVICE_PASSWORD_64_INSTANCE` | at-rest encryption for connector credentials |
| `SERVICE_PASSWORD_64_MINIO` | object storage |

**Never rotate `INSTANCE_SECRET` on a running instance.** It is the key every stored
connector credential is encrypted with. Rotating it leaves the backend booting normally
while `/admin/connectors` renders every card as "not connected" above a row of empty
fields — the ciphertext and the `connected_at` timestamps are still in the database, and
the screen says nothing about it. You would be re-entering credentials on a configuration
you cannot read.

### Optional: sandboxed MCP plugins

Off by default, and the product works fully without it — corpus retrieval, booking, asking
the visitor a question, summarising and sending mail are compiled into the backend. The
sandbox exists only for MCP plugins you declare at deploy time.

Turning it on means giving the backend container `/var/run/docker.sock`, `SYS_ADMIN`,
`NET_ADMIN` and `apparmor:unconfined`. Together those do not make the application more
privileged — they make it **an administrator of the host**, able to start containers and
read every other tenant's volumes on the same machine.

So: run it on a host that is yours alone. On 2026-07-16 a server-wide log cleanup on a
shared Coolify host broke logging for every container that was not subsequently restarted,
including another tenant's production. On a shared host the blast radius of anything
destructive is the whole machine, not your slice of it.

The exact block to add is in the template's closing section.

### Prove it actually came up

A green dot in Coolify means the container is running. These four say the instance works:

1. **The tables exist.** `psql -U standmeet -d standmeet -c '\dt'` should list
   `corpus_notes`, `owners`, `access_codes`. If the schema mount missed, this is empty and
   nothing else told you.
2. **Visitor IPs are visible.** If the backend logs `visitor IP not visible: no forwarding
   header on the proxy hop` at boot, something in front of it is dropping
   `X-Forwarded-For`. Coolify's own proxy sets it; a second layer you added may not. Until
   it is fixed, conversations record no source IP, IP bans have nothing to target, and the
   per-IP lockout on wrong access codes becomes one shared bucket for everyone.
3. **An image renders.** Attach one to a note and open the public page. Look at the picture,
   not at the markup.
4. **Ask a question through the page.** It should answer from your corpus, not from
   general knowledge.

### Upgrading is not installing

`schema.sql` runs exactly once, when the data volume is first created. Rebuilding an image
never touches a running database. To move an existing instance to a new version, apply the
new files in `backend/db/migrations/` and then confirm with `make schema-drift` that the
live database and `schema.sql` agree.

Write the migration for a database that already holds data and traffic — an `ADD COLUMN`
with a default on a large table, a `NOT NULL` without one, a rename that the previous
binary is still writing to. A fresh volume passes every one of those.

---

## Deploying anywhere else

`docker-compose.prod.yml` is the same stack without Coolify's domain and secret handling:
host ports are published and you front them with your own TLS proxy.

```bash
cp .env.example .env     # fill it in — INSTANCE_SECRET must be ≥32 characters
make prod-up
```

The app listens on `38227`. Whatever you put in front of it must set `X-Forwarded-For`;
see point 2 above for what happens when it does not.

---

## Development

```bash
make dev-up                       # bring the stack up with the dev mocks
make test                         # the full e2e suite (~1.3h, real services, no mocks for deps)
make test-only SPEC=<name>        # one spec, rebuilding first
make test-asis SPEC=<name>        # one spec against what is already running — no rebuild
make lint                         # every gate: secrets, backend, app, sdk, e2e
```

Tests are end-to-end by design: real Postgres, real Redis, real object storage, a browser
driving the actual frontend. "It didn't crash" is not a pass — the assertion is the answer
the visitor should have received.

`make test-asis` exists for one specific step: a new guard has to be seen **red** against
the unfixed code before the fix lands. `make test-only` rebuilds first, so a guard run
through it is green the first time you ever run it and has proven nothing.

Suspect a flaky test? `REPEAT=5`. One pass is not evidence.

## Layout

| Directory | What it is |
|---|---|
| `backend/` | Go. Domain modules, the corpus, connectors, the MCP surfaces |
| `app/` | Next.js. The four public surfaces and the owner's admin |
| `sdk/` | `@standmeet/sdk` — embed chat and corpus reading in your own site |
| `builder/` | Sandboxed build of owner-written custom pages |
| `im-bridge/` | Talk to the owner's AI from a chat app, on an access code |
| `mcp-servers/` | Capability plugins, linked into the backend |
| `infra/` | Deployment: the Coolify template, plugin manifests, lint tooling |
| `e2e/` | Playwright. The suite the whole product is judged by |
| `docs/design/` | The canonical visual and product spec |
| `standmeet-*/` | Legacy reference from the previous architecture. Not built, not run |

## Licence

AGPL — see [`docs/licensing.md`](docs/licensing.md).
