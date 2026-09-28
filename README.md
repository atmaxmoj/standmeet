# StandMeet

A self-hostable page that answers for you.

You think out loud in whatever AI client you already use — Claude Desktop, Cursor,
anything that speaks MCP — and it files the substance into a personal corpus. Visitors
land on your page and talk to an AI that answers in your voice, grounded in that corpus.
It replaces the narrow slice of you that a résumé or a LinkedIn profile can hold.

Your notes stay yours: the corpus mirrors an Obsidian vault in both directions, so the
files on your disk remain the thing you edit.

---

## Install

You need a server with Docker and a domain.

1. Point the domain's DNS (an `A` record) at the server, and open ports 80 and 443.
2. On the server, run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/atmaxmoj/standmeet/main/infra/scripts/install.sh \
     | bash -s -- --domain me.example.com
   ```

3. Open the link it prints. It works once: it makes you the owner of this instance.
4. In the admin panel, open **providers** and add the AI provider your page answers with.

The installer writes everything to `~/standmeet`: the compose files and a `.env` with freshly
generated secrets. A bundled Caddy gets a Let's Encrypt certificate for the domain and renews it.
**Back up `.env`**: `INSTANCE_SECRET` in it encrypts the credentials you store, and a new one
cannot read them.

- **No domain yet, or your own proxy?** Run the installer without `--domain`. The app is published
  on port 3000 (`STANDMEET_HTTP_PORT`). Your proxy must terminate TLS and set `X-Forwarded-For`.
- **Upgrading.** Press upgrade in the admin panel: the bundled updater pulls the new images and
  recreates the containers, and the backend applies its own database migrations at boot.
  Re-running the installer does the same and never touches `.env`.
- **Logs.** `cd ~/standmeet && docker compose logs -f backend`.

The install path is tested end to end: `make install-e2e` runs the installer on a clean
docker-in-docker host and then claims, signs in and loads the page over HTTPS.

### On Coolify

New Resource → Docker Based → Docker Compose Empty, then paste
[`infra/deploy/docker-compose.yml`](infra/deploy/docker-compose.yml). Its `SERVICE_*` magic
variables generate the secrets and assign the domain; you type nothing. Coolify's own proxy
terminates TLS. (This is how the reference instance, sijie.xyz, runs.)

| Variable | What it protects |
|---|---|
| `SERVICE_PASSWORD_POSTGRES` | the database |
| `SERVICE_PASSWORD_64_SESSION` | session signing |
| `SERVICE_PASSWORD_64_INSTANCE` | at-rest encryption for supplier credentials |
| `SERVICE_PASSWORD_64_MINIO` | object storage |

The installer writes the same names into `.env`, so both paths run the same compose file.

### Never rotate `INSTANCE_SECRET`

It is the key every stored supplier credential is encrypted with. Rotating it leaves the backend
booting normally while `/admin/suppliers` renders every card as "not connected" above a row of
empty fields — the ciphertext and the `connected_at` timestamps are still in the database, and
the screen says nothing about it. You would be re-entering credentials on a configuration you
cannot read.

### Object storage

The bundled store is the `minio` service, running [Silo](https://github.com/pgsty/silo)
(`pgsty/silo`), the maintained community fork of MinIO: the same S3 API, `MINIO_*` settings and
on-disk format. MinIO deleted `minio/minio` from Docker Hub on 2026-09-11, so a compose that still
pins it no longer pulls; an existing MinIO data volume is read by Silo as-is. Images reach the
browser through the backend (`GET /api/v1/assets/{id}`, a signed link), so storage needs no domain.

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

The exact block to add is in the compose file's closing section.

### Prove it actually came up

A green dot means a container is running. These four say the instance works:

1. **The tables exist.** `docker compose exec db psql -U standmeet -d standmeet -c '\dt'` lists
   `corpus_notes`, `owners`, `access_codes`.
2. **Visitor IPs are visible.** If the backend logs `visitor IP not visible: no forwarding
   header on the proxy hop` at boot, something in front of it is dropping `X-Forwarded-For`.
   The bundled Caddy and Coolify's proxy set it; a second layer you added may not. Until it is
   fixed, conversations record no source IP, IP bans have nothing to target, and the per-IP
   lockout on wrong access codes becomes one shared bucket for everyone.
3. **An image renders.** Attach one to a note and open the public page. Look at the picture,
   not at the markup.
4. **Ask a question through the page.** It should answer from your corpus, not from
   general knowledge.

---

## Development

```bash
make dev-up                       # bring the stack up with the dev mocks
make test                         # the full e2e suite (~1.3h, real services, no mocks for deps)
make test-only SPEC=<name>        # one spec, rebuilding first
make test-asis SPEC=<name>        # one spec against what is already running — no rebuild
make lint                         # every gate: secrets, backend, app, sdk, e2e
make install-e2e                  # a first install on a clean host, over HTTPS
```

Tests are end-to-end by design: real Postgres, real Redis, real object storage, a browser
driving the actual frontend. "It didn't crash" is not a pass — the assertion is the answer
the visitor should have received.

`make test-asis` exists for one specific step: a new guard has to be seen **red** against
the unfixed code before the fix lands. `make test-only` rebuilds first, so a guard run
through it is green the first time you ever run it and has proven nothing.

Suspect a flaky test? `REPEAT=5`. One pass is not evidence.

### Releasing

Merge to `main`, then push a `vX.Y.Z` tag on it. CircleCI (`.circleci/config.yml`) builds every
image for amd64 and arm64 and pushes `vX.Y.Z` and `latest` to ghcr; instances on the `latest`
channel then upgrade from their admin panel. `docker-compose.prod.yml` builds the same stack from
source for development; it is not an install path.

## Layout

| Directory | What it is |
|---|---|
| `backend/` | Go. Domain modules, the corpus, suppliers, the MCP surfaces |
| `app/` | Next.js. The four public surfaces and the owner's admin |
| `sdk/` | `@standmeet/sdk` — embed chat and corpus reading in your own site |
| `builder/` | Sandboxed build of owner-written microsites |
| `im-bridge/` | Talk to the owner's AI from a chat app, on an access code |
| `infra/plugins/` | The block plugins — standalone node MCP servers the sandbox spawns; the host never imports them |
| `infra/` | Deployment: the image-based compose and its two overlays (`infra/deploy/`), the installer (`infra/scripts/install.sh`), updater, plugin manifests, lint tooling |
| `e2e/` | Playwright. The suite the whole product is judged by |
| `docs/design/` | The canonical visual and product spec |
| `standmeet-*/` | Legacy reference from the previous architecture. Not built, not run |

## Licence

AGPL — see [`docs/licensing.md`](docs/licensing.md).
