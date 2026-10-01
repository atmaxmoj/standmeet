# Storage decoupling: Silo by default, the owner's own S3 as a setting

Status: DRAFT 2026-10-01. Waiting for the owner on the decisions at the end.

## What the owner asked

2026-09-26, refined 2026-10-01 (summarised):

- MinIO removed its Docker Hub images (2026-09-11) and stopped anonymous quay pulls; a Coolify
  full-stack restart got stuck pulling `minio/minio`. Storage run by one company tends to turn
  (Riak CS, LeoFS, OpenIO, MinIO); the survivors are run by foundations or non-profits (Ceph, Garage).
- **Silo is the default store, not a stopgap.** An owner who wants their own S3 sets it in the
  admin UI under System (GUI + MCP, secret sealed at rest). Never an env var.
- Needed: a one-time move between stores (count and checksum verified), an upgrade test, and the
  same asset e2e green on both stores.

## What exists (read from the code, 2026-10-01)

**Silo.** `pgsty/silo` is a community-maintained fork of MinIO (github.com/pgsty/silo). It is a
drop-in replacement: same S3 API, same `MINIO_*` env, same on-disk format. Its entrypoint accepts
the `server …` argv, and the image ships curl for the healthcheck. Commit 417fe2446 (2026-09-26)
swapped the pinned `minio/minio:RELEASE.2025-04-08…` for `pgsty/silo:RELEASE.2026-09-16T00-00-00Z`
in all three compose files. An object written by upstream MinIO read back byte-identical on Silo,
and the asset specs passed. Commit 6eb8c0a64 did the same for `infra/db/fresh-install-e2e.sh`.

The compose **service is still named `minio`**, volume `miniodata`, internal only with no port and
no domain (infra/deploy/docker-compose.yml:196-216). Keep both names: an upgraded instance finds
its volume by name, and its backend env says `STORAGE_ENDPOINT=minio:9000`. Two compose comments
still call Silo "a stopgap" (docker-compose.dev.yml:537-541, docker-compose.prod.yml:299-303); the
implementation rewrites them to say Silo is the default.

**The adapter.** `backend/internal/infra/storage/storage.go` is the only storage adapter:
`NewClient` + `ensureBucket` (69-83, 190-202), `Put` (135-143), `Delete` (145-151), `Get` reads the
whole object into memory (153-170), `Health` = `BucketExists` (182-188). The region is hard-coded
to `us-east-1` (89-92). **`PresignedGetURL` (172-180) has no caller.** A grep of backend/, app/ and sdk/ finds only its
  definition. With it go `presignTTL` (25-28), the second "presign" client (57-66),
  `buildPresignClient` (100-133), `Config.PublicURL`, `config.StoragePublicURL`
  (config.go:57-65, 195), main.go:177, the whole of storage_test.go (it tests only the scheme
  check of `STORAGE_PUBLIC_URL`), docker-compose.dev.yml:119-124 and docker-compose.prod.yml:108.
  docs/deploy.md:27 already lists `STORAGE_PUBLIC_URL` as removed from the template.

**Callers.** Every caller holds the one `*storage.Client` that the composition root built:

- Writes: `Put` only in corpus/usecase/assets.go:181; `Delete` in assets.go:158, 171. The asset
  row commits first and the bytes are put after the commit (assets.go:133-151). A delete removes
  the bytes before the rows (assets.go:164-168).
- Reads: the asset serve route (cmd/server/boot_wireup_microsites.go:157), the favicon
  (boot_favicon.go:130), the Obsidian export (corpus/obsidian/export.go:200). Health: the system
  panel's "asset blob storage (minio)" ping (cmd/server/port/sysinfo.go:254).
- Wiring: main.go:166-196 builds the client, and a failure stops the boot. `deps.StorageClient`
  (deps/deps.go:123) is copied into `corpus.AssetsDeps` in boot_wireup.go:52, 139,
  boot_wireup_public.go:100, wire/dispatcher.go:149-189, wire/hostdesk.go:141, wire/corpus_deps.go:21.

**Serving.** Browsers never reach storage. Every asset URL is the backend route
`/api/v1/assets/{id}` (corpus/usecase/asset_refs.go:97-99, routes/public/microsites.go:87). The
route checks the HMAC signature (`corpus.VerifyAssetURL`) or a microsite reference, then streams
the bytes that `StorageClient.Get` returns (boot_wireup_microsites.go:141-162). Neither app/src nor
sdk/src names a storage host. So a store change is invisible to every page.

**Configuration today.** `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`,
`STORAGE_BUCKET`, `STORAGE_USE_SSL` are read in config.go:191-208 and required in config.go:234-237.
The deploy template points them at the bundled Silo, and Coolify generates the secret
`SERVICE_PASSWORD_64_MINIO`, which it gives to both containers (infra/deploy/docker-compose.yml:50-54,
203-204). docs/deploy.md:10 already classes `STORAGE_ENDPOINT` as **wiring**, not a setting.

**Coupling to keep.** The monitor's viewer-hash salt derives from `STORAGE_SECRET_KEY`
(cmd/server/monitor_wireup.go:29, 39-49). The salt must stay stable, so this env var stays.

**The pattern to copy (v0.1.106).** Instance settings are columns on `instance_settings`
(owner/entity/instance_config.go). The owner domain seals the secret and never unseals it
(owner/usecase/instance_config.go:172-189). `livesettings` holds the running copy, reloads it on
every write, re-reads a copy older than 2 s, and unseals in the composition root
(cmd/server/livesettings/livesettings.go:28-150). `ImportLegacyEnv` copies old env values once
(livesettings.go:59-68).

## Mechanism

### One fact, one home

- The **bundled store** is wiring. Its address and keys stay in `STORAGE_*`, because the compose
  file is the only place that can hand one generated password to two containers. The owner never
  types it.
- The **custom store** is an owner setting. It lives in `instance_settings`, and its secret is
  sealed with cryptobox under its own AAD (`StorageSecretAAD`). No env var names it.
- The **active store** is a stored setting: `bundled` (the default, also when nothing is stored)
  or `custom`.

New columns on `instance_settings`:

```
storage_active       text  NOT NULL DEFAULT 'bundled'   -- 'bundled' | 'custom'
storage_custom       jsonb                              -- {endpoint, bucket, region, access_key, path_style}
storage_secret_enc   bytea                              -- sealed secret key
storage_previous     text                               -- the store kept after a move, until the owner forgets it
```

`endpoint` is a full URL (`https://s3.eu-central-1.amazonaws.com`, `http://garage:3900`). The
scheme sets TLS, which removes `use_ssl` as a separate field. `region` defaults to `us-east-1`.
`path_style` maps to minio-go's `BucketLookupPath` / `BucketLookupDNS` options.

### The live client

- `storage.Client` keeps its methods. Inside, it holds `atomic.Pointer[conn]` (minio client +
  bucket), and `Swap(cfg)` replaces it. Callers keep the same `*Client`: no wiring changes.
- `livesettings.Reload` resolves the active store (bundled → env, custom → stored fields + the
  unsealed secret) and calls `Swap` when it differs. A save applies at once, like the Turnstile pair.
- `ensureBucket` runs at boot only for the bundled store. An unreachable custom store does not stop
  the boot (the owner must still reach the admin to fix it): the health ping turns red, named
  "asset storage (<endpoint>/<bucket>)", and an upload fails with "Your storage at <endpoint>
  cannot be reached."

### The connection check (before saving)

`instance.storage_check` (an owner op in the registry, so the admin page and the MCP both get it)
builds a throw-away client from the form values. It puts `.standmeet-check/<random>`, gets it back
and compares the bytes, then deletes it. Pass: "Connected — wrote, read and deleted a test file in
<bucket>." Each failure maps to one sentence, never a raw S3 code:

| S3 / network result | Sentence shown |
|---|---|
| `InvalidAccessKeyId`, `SignatureDoesNotMatch` | The access key or secret key is wrong. |
| `NoSuchBucket` | There is no bucket named "<bucket>" at this endpoint. Create it with your provider first. |
| `AccessDenied` | These keys cannot write to "<bucket>". Give them read, write and delete. |
| `AuthorizationHeaderMalformed` (region) | The region is wrong for this bucket. |
| dial / DNS / TLS error | This instance cannot reach <endpoint>. |

The client's transport is the outbound guard (`httpx`), so an internal endpoint must be in the
internal-hosts list. Save runs the same check and refuses with the same sentence. The bucket must
already exist; StandMeet does not create buckets in the owner's account.

### The move (copy, verify, switch)

`instance.storage_move` starts one River job. The owner presses one button on the tab, and the tab
polls the job's progress. The source of truth for "what must be copied" is the `assets` table:
every row has `storage_key` and `sha256` (backend/db/schema.sql:644-647).

1. **Copy.** For each asset row, the job reads the object from the active store. If the target
   already holds an object with the same SHA-256, the job skips it, so a re-run is cheap. Else the
   job puts it. Uploads continue to the active store during this pass.
2. **Freeze.** The client has a write gate: `Put` and `Delete` hold it shared, and the move holds
   it exclusive. In-flight writes finish, and new writes **wait** (they are not rejected). The job
   runs a second pass over rows that appeared or changed since pass 1. This pass lasts seconds.
3. **Verify.** Every row whose object exists in the old store must exist in the target, and the
   SHA-256 of the target's bytes must equal the row's `sha256`. A row with an empty `sha256` is
   compared against the old store's bytes. Count = rows verified, against rows with bytes in the
   old store. A row with no bytes in the old store either is reported ("3 assets had no stored
   file before the move") and does not block the move.
4. **Switch, only on a full match.** One transaction sets `storage_active` and
   `storage_previous`. `Reload` swaps the client, and then the gate opens. Waiting writes land in
   the new store.
5. **On any mismatch** the switch does not happen. The old store stays active, and the tab names
   the count: "Copied 41 of 42. One file did not match; nothing was switched."

In-flight writes: a row commits before its bytes are put (assets.go:133-151), so a put that waits
at the gate lands in whichever store is active when it gets through. Pass 2 covers every row
committed before the freeze. A delete during pass 1 also deletes in the target (best effort), so
the target keeps no stray copy.

**Keep the old store.** After the switch, the old store stays untouched and is recorded as
`storage_previous`. The tab shows "Previous store kept: bundled Silo · Forget it". Forget clears
the record (and the sealed secret, when the previous store was custom). It never deletes objects.

**Rollback** = the same move in the other direction. The old store still holds everything from
before the switch, so pass 1 copies only what was uploaded since.

### The tab

A new nav item `storage` (`/admin/storage`) in the settings group, beside `system`
(app/src/lib/admin/nav.ts:96). It shows the active store with its object count and health; the
custom-store form (endpoint, bucket, region, access key, secret as `SecretInput` with keep / set /
clear, path-style); Check, then "Move assets here"; the progress line; the previous store with its
Forget link. MCP: `instance.storage_get` / `_set` / `_check` / `_move` / `_forget_previous`, from
the same op registry.

### Upgrade

There is nothing to import. An upgraded instance has no stored row, so `storage_active` defaults
to `bundled`, and the bundled store is the `STORAGE_*` its compose still carries. Its assets keep
serving. An old compose may still carry `STORAGE_PUBLIC_URL`. Today a value without a scheme stops
the boot (storage.go:126-131). After this change the backend never reads it.

## Acceptance

The rig gets a second S3 service, `s3-alt`, in docker-compose.dev.yml and in the verify compose.
Its bucket and keys are created at startup. Makefile targets run every spec. The specs drive only
user actions and assert visible results. The one look behind the page is that a fixture lists
`s3-alt`'s bucket, the same way the IM bridge's test double is read.

**`storage-custom-s3.spec.ts`** (serial):

1. On the bundled store, the owner uploads two images to a writing and publishes it. The public
   page shows both (`naturalWidth > 0`).
2. On `/admin/storage` the owner enters `s3-alt` with a wrong secret and presses Check: "The access
   key or secret key is wrong." Save refuses with the same sentence.
3. With the right secret, Check shows "Connected — …". The owner presses Move; the tab reaches
   "Copied and verified 2 of 2", the active store reads `s3-alt`, the fixture lists 2 objects there.
4. The fixture deletes those 2 objects from the bundled bucket. The public page still shows both
   images, so the bytes come from `s3-alt`. A new upload renders, and its object is in `s3-alt`.
5. The owner moves back to bundled. Only the new upload is copied; all three images render.

**Same asset e2e on both stores.** A Playwright project `assets@s3-alt` sets the active store to
`s3-alt` through the owner API in its setup (the product API, never SQL). It then runs the existing
asset specs unchanged: asset-upload-dedup, assets-pool-upload, assets-preview-loads,
genre-assets-reader, favicon, microsite-asset-widget, and asset-reference-recompute.

**`upgrade-storage-target.spec.ts`** mirrors upgrade-instance-owner-settings.spec.ts:

claim and upload an image; drop the new columns and delete the migration's ledger row;
`recreateBackendWithEnv` with the old env, including `STORAGE_PUBLIC_URL=files.example.com` (no
scheme, as Coolify's FQDN variable writes it). Assert that the backend comes up healthy, the image
renders on the public page, and `/admin/storage` shows "bundled Silo" active with the same count.

Each is red on the code of 2026-10-01: `storage-custom-s3` because `/admin/storage` and `s3-alt` do
not exist; `assets@s3-alt` in its setup; the upgrade spec at boot, because a scheme-less
`STORAGE_PUBLIC_URL` crash-loops today's backend.

## Decisions for the owner

1. **The second S3 in the rig.** *Garage (recommended)*: a different implementation proves "any
   S3"; its default region `garage` catches today's hard-coded `us-east-1` (storage.go:92); it
   needs a one-shot init container (layout, key, bucket). *A second Silo*: no init, but it shares
   MinIO's code with the bundled store, so it cannot catch MinIO-only assumptions.
2. **What "Forget the previous store" does.** *Forget the record only (recommended)*: nothing is
   irreversible; the bundled volume keeps its disk until the owner wipes it. *Also delete the old
   objects*: frees disk, and it is the one irreversible button on the tab.
3. **An instance whose `STORAGE_*` already names an external S3** (a hand-edited compose; no
   shipped template does this). *Keep it as the bundled store (recommended)*: the tab labels it
   with its endpoint; no code; one home for the wiring. *Import it once as the custom store*:
   needs a rule that guesses "bundled or not" from the host name.

## Not in this change

- Replacing Silo as the bundled image (for example with Garage). The adapter speaks plain S3, so
  that change is a compose edit plus this move.
- The monitor salt's dependency on `STORAGE_SECRET_KEY`. It needs its own home only if the bundled
  store ever leaves the compose file.
- Assets for every corpus genre (planned separately; the move covers whatever the `assets` table
  holds).
