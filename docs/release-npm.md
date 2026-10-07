# Releasing the @standmeet/* npm packages

The five packages publish with every release tag, from CI, at the tag's version. This page is what
to set up once, what happens on a tag, and how to check a release before it goes out.

## The packages and their order

| order | package | what it is | depends on at runtime |
|---|---|---|---|
| 1 | `@standmeet/mcp-client` | the owner's MCP bridge (`standmeet-mcp` binary) | nothing (sdk-core is bundled in) |
| 2 | `@standmeet/sdk-core` | API client, SSE reader, shared parsers | nothing |
| 3 | `@standmeet/agent-core` | the visitor chat turn, behind ports | nothing |
| 4 | `@standmeet/sdk` | React components and hooks | sdk-core, agent-core (same version); react (peer) |
| 5 | `@standmeet/embed` | `<standmeet-chat>` for any page | nothing (React and the SDK are bundled in) |

Dependents publish after what they depend on, so a fresh install never finds a missing version.

## Versions

The version is the release tag without its `v`: tag `v0.1.130` publishes `0.1.130`. The repo keeps
`0.0.0` in every `package.json`; `make npm-stamp` writes the tag's version for the publish and
`make npm-unstamp` puts `0.0.0` back, so the tag stays the only place a version lives. `pnpm
publish` turns `workspace:*` into that same version. Keeping the npm version equal to the instance
version is what makes the client's version-skew advisory (`classifySkew`) meaningful.

## Set up once (the owner)

1. Sign in to npm and create the organisation **standmeet** (free, public packages). Its scope is
   `@standmeet`.
2. Create an npm **automation** access token with publish rights on that organisation.
3. In CircleCI → the standmeet project → Project Settings → Environment Variables, add
   `NPM_TOKEN` = that token.

Until `NPM_TOKEN` is set, the `npm-publish` job prints "NPM_TOKEN not set — skipping the npm
publish" and passes; the image release is unaffected.

## On a release tag

`git tag vX.Y.Z && git push origin vX.Y.Z` starts the release pipeline. Next to the six image jobs,
`npm-publish` runs `make npm-publish TAG=vX.Y.Z`:

1. builds the SDK as released (`STRIP_TEST_HOOKS=1`, `STANDMEET_VERSION=vX.Y.Z`);
2. stamps `X.Y.Z` into the five `package.json`;
3. `pnpm publish --access public` each package, in the order above;
4. puts `0.0.0` back.

## Check before a release (no npm login needed)

```sh
make npm-pack TAG=v0.1.130
```

Builds, stamps, packs every package into `.npm-out/`, and fails if a tarball has no README, carries
the wrong version, or still says `workspace:` in its manifest. Then it unstamps. Open a tarball with
`tar -tzf .npm-out/standmeet-sdk-0.1.130.tgz` to see exactly what would ship.

## When a publish fails half-way

npm versions are immutable: a version that published stays. Re-run the CI job; packages already at
that version fail with "cannot publish over the previously published version" — publish the rest by
hand from a checkout of the tag:

```sh
make npm-stamp TAG=vX.Y.Z
cd sdk/packages/<package> && pnpm publish --access public --no-git-checks
cd - && make npm-unstamp
```
