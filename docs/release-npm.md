# Releasing the MCP client to npm

One package publishes: **`standmeet-mcp`**, the owner's MCP bridge (`standmeet-mcp` binary;
sdk-core is bundled in, so it has no runtime dependencies). It lives in `sdk/packages/mcp-client`
and publishes under the owner's personal npm account. The admin page's install snippet runs
`npx -y standmeet-mcp@latest`.

The `@standmeet/*` SDK packages (sdk-core, agent-core, sdk, embed) are not published: a scoped
name needs an npm organisation called `standmeet`. If they are ever wanted on npm, create that
organisation and add them back to `NPM_PACKAGES` in the Makefile (dependents after what they depend
on: sdk-core, agent-core, sdk, embed).

## Versions

The version is the release tag without its `v`: tag `v0.1.138` publishes `0.1.138`. The repo keeps
`0.0.0` in `package.json`; `make npm-stamp` writes the tag's version for the publish and
`make npm-unstamp` puts `0.0.0` back, so the tag stays the only place a version lives. Keeping the
npm version equal to the instance version is what makes the client's version-skew advisory
(`classifySkew`) meaningful.

## Publish

From a machine signed in with `npm login`:

```sh
make npm-publish-here TAG=vX.Y.Z
```

It builds as released, stamps, publishes and unstamps. CI's `npm-publish` job does the same on a
release tag when the project has an `NPM_TOKEN`; without one it prints that it skipped and passes.

The owner's account requires 2FA for writes, with a **security key** (Touch ID / passkey), not
an authenticator code — so `NPM_OTP` does not apply. Publish through npm's web check instead:
run the publish under a pseudo-terminal so npm prints its approval link, open that link, and
the owner touches the key.

```sh
make npm-stamp TAG=vX.Y.Z
cd sdk/packages/mcp-client && script -q /tmp/npmweb.log npm publish --access public --auth-type=web
# open the https://www.npmjs.com/auth/cli/… link from the log; the owner confirms with the key
cd - && make npm-unstamp
```

The first version of a new package is held by npm's own review ("Temporary Holding Version",
`0.0.0-stage`) and appeared as the real version a few minutes later; nothing to approve on the
owner's side (Settings → Staged Packages stayed empty).

## Check before a release (no npm login needed)

```sh
make npm-pack TAG=vX.Y.Z
```

Builds, stamps, packs into `.npm-out/`, and fails if the tarball has no README, carries the wrong
version, or still says `workspace:` in its manifest. Then it unstamps.

npm versions are immutable: a version that published stays.
