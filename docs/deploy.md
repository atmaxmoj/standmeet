# Deployment notes

The why behind `infra/deploy/docker-compose.yml`. The template keeps one line per item; the
incidents that set each line live here.

## What the deployment file carries

Only three kinds of thing:

1. **Wiring** — how the services find each other (`BACKEND_URL`, `DATABASE_URL`, `STORAGE_ENDPOINT`,
   `MEILI_URL`, the upgrade signal path).
2. **Secrets the platform generates** — `SERVICE_PASSWORD_*` (Coolify), or the installer's `.env`.
3. **What the sandbox needs from the host** — `user`, `security_opt`, `cap_add` on the backend.

Never the owner's settings. Those live in the app, at `/admin`, and take effect on save:

| Setting | Where | Was |
|---|---|---|
| Login check (Cloudflare Turnstile) | `/admin/system` → Instance settings | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` |
| Internal hosts the instance may reach | `/admin/system` → Instance settings | `EGRESS_ALLOW_HOSTS`, `SUPPLIER_EGRESS_ALLOW` |
| Skill catalogue | `/admin/system` → Instance settings | `MARKETPLACE_GITHUB_BASE_URL` |
| Public IP on the system panel | resolved from the page's public URL | `PUBLIC_IP` |
| Largest OpenAPI spec | fixed at 16 MiB (GitHub's own spec is 12 MB) | `SUPPLIER_SPEC_MAX_BYTES` |
| Suppliers, bot tokens, AI providers | `/admin/suppliers`, `/admin/providers` | — |

Lines that only repeated a built-in default are gone too: `HOST`, `PORT`, `SECURE_COOKIE`,
`MICROSITES_ROOT`, `GOTENBERG_URL`, `STORAGE_PUBLIC_URL`, `STANDMEET_RELEASE_REGISTRY` / `_REPO`,
`STANDMEET_SEED_DEFAULT_SOURCES`.

### Upgrading an instance that set these as env vars

Nothing to do. The first boot of the new version copies the old values into the instance settings
— only into fields still empty — and marks the import done. After that the app's settings win: a
field you clear in the UI is not refilled from the env on the next restart. The upgrade keeps the
old env because the updater recreates each container from its own existing configuration.
(`e2e/test/upgrade-instance-owner-settings.spec.ts` plays exactly this upgrade.)

The internal-hosts list is one list now. Every outbound check honours it, including the address a
visitor's own AI key points at — the same reach the two env lists gave. List only hosts you are
fine exposing that way.

## Why the remaining lines are what they are

- **No `networks:` on `app`.** Coolify puts every service on its own project network. A second
  network on `app` (it once had one, only for a dotted alias) made Traefik resolve the app's IP on
  the wrong network: connections hung 30 s and came back 504, re-rolled on every deploy. The alias
  never worked anyway — gotenberg was not on that network, so PDF printing was broken all along.
- **`INSTANCE_SECRET` never changes.** It encrypts every stored credential. It was rotated once in
  production: the backend came up healthy and every supplier card showed "not connected" over
  empty fields, with the ciphertext still in the database.
- **`PRINT_BASE_URL` is the public https URL.** gotenberg loads the print page from it. The internal
  `http://app:3000` was redirected toward https on a single-label host with no certificate, and
  Chromium died on `ERR_SSL_PROTOCOL_ERROR`. The print route is one-shot-token gated, so the public
  origin leaks nothing.
- **The backend's `user` / `security_opt` / `cap_add`.** The built-in capabilities (retrieval,
  asking the visitor, summarising, booking, sending mail) run through `sandbox_stdio`, where bwrap
  starts each one in its own namespaces. The default seccomp/apparmor profile blocks that, and the
  failure is silent: the model gets no tools and, in production once, wrote its tool calls out as
  plain text to the visitor. `SYS_ADMIN` creates the namespaces; `NET_ADMIN` brings up loopback
  inside the sandbox. docker.sock is not mounted — that is the half that would make the container
  the host's administrator.
- **Meilisearch ships with the stack.** Postgres full text (`to_tsvector('english', …)`) cannot
  tokenize Chinese: on a bilingual corpus a Chinese query only matched a byte-identical run. The
  backend backfills the index at boot. It is `service_started`, not `service_healthy`: search
  falls back to Postgres without it, and an optional index must not stop the instance coming up.
- **Redis is capped and evicts (`allkeys-lru`).** Uncapped, it grows until the container is
  OOM-killed and every session goes at once. `noeviction` would make writes fail instead.
- **gotenberg's deny-list is cleared.** Its default blocks the private ranges the docker network
  uses, so every internal render returned 403.
- **minio is internal only.** The backend serves uploads (`GET /api/v1/assets/{id}`, a signed
  link), so storage needs no domain. Silo replaced `minio/minio` after MinIO deleted it from Docker
  Hub (2026-09-11).
- **stt ships with the stack, and is optional.** Voice input turns a visitor's recording into text
  on this server (SenseVoice on sherpa-onnx, CPU only, ~400 MB RAM); audio never leaves the
  instance and is not stored. The backend reaches it at `http://stt:8080`, its built-in default.
  Without the service the chat offers no microphone and works as before. **An instance installed
  before voice input has no `stt` service**: the upgrade button recreates existing services only, so
  add the `stt` block from `infra/deploy/docker-compose.yml` to your compose (Coolify: edit the
  stack) and redeploy once. (docs/design/voice-input.md)
- **The updater has docker.sock; nothing else does.** On the upgrade button it reads its own
  compose project label, lists its siblings and recreates each in place on the new image — same
  volumes, networks and env. An earlier version ran `docker compose up` on a fetched file and built
  an empty parallel stack wherever the project name differed.

## Optional: third-party sandboxed MCP servers

Off by default; the product works fully without it. To run MCP servers you declare at deploy time,
add to the backend:

```yaml
    environment:
      - STANDMEET_PLUGINS=/etc/standmeet/plugins.json
      - SANDBOX_DRIVER=docker
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./infra/prod-plugins.json:/etc/standmeet/plugins.json:ro
```

docker.sock makes the backend an administrator of the host, able to start containers and read
every other tenant's volumes. Only on a host that is yours alone.
