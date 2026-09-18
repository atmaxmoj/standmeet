// fixture_install.go — install a bundled example / foreign-ecosystem block by name.
//
// Two things ride on this. (1) Reciprocity: our loader mounts a FOREIGN dsh block
// unchanged — the dsh fixtures below are ordinary sandbox_stdio blocks, mounted through
// the same MountInstalledBlock path as an owner's paste, marked OriginDsh so the panel
// does not present them as builtin and they get no more trust than any installed block.
// (2) A dsh GROUP composes through our loader: `group` mounts every member.
//
// The fixtures reuse the already-provisioned demo block code (server-everything) under a
// foreign id, so a foreign capability appears without shipping new server code. They live
// only in the dev/e2e stack (/srv/plugins-demos, bind-mounted; dropped from every product
// image by .dockerignore); mounting one in prod would name a plugin dir that isn't there
// and simply fail to start.

package blockwire

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// dshEchoManifest / dshUpperManifest — foreign dsh single-block fixtures. No raw_tool_names,
// so their tools carry the mcp__<id>__ prefix a foreign bridged block gets (mcp__dsh-echo__
// echo). They reuse the server-everything code already provisioned at
// /srv/plugins-demos/everything; the id is what makes them distinct foreign blocks.
const dshEchoManifest = `id: dshecho
title: DSH Echo (foreign)
version: "1"
shape: visitor_only
transport:
  kind: sandbox_stdio
  command: node
  args: ["/plugin/node_modules/@modelcontextprotocol/server-everything/dist/index.js", "stdio"]
  sandbox:
    plugin_dir: /srv/plugins-demos/everything
    allow_net: false
`

const dshUpperManifest = `id: dshupper
title: DSH Upper (foreign)
version: "1"
shape: visitor_only
transport:
  kind: sandbox_stdio
  command: node
  args: ["/plugin/node_modules/@modelcontextprotocol/server-everything/dist/index.js", "stdio"]
  sandbox:
    plugin_dir: /srv/plugins-demos/everything
    allow_net: false
`

// fixtureBlocks — the single-block fixtures, by id. Ids are hyphen-free: a discovered
// block's tools surface sanitized as <id>_<tool>, and a hyphen in the id would be rewritten.
var fixtureBlocks = map[string]string{
	"dshecho":  dshEchoManifest,
	"dshupper": dshUpperManifest,
}

// fixtureGroups — a dsh GROUP is a composition of member block ids; installing it mounts
// each member through the same loader.
var fixtureGroups = map[string][]string{
	"dshdemogroup": {"dshecho", "dshupper"},
}

type fixtureInstallArgs struct {
	Fixture   string `json:"fixture"`
	Ecosystem string `json:"ecosystem"`
	Group     bool   `json:"group"`
}

// originFor — a dsh-ecosystem fixture is marked foreign (OriginDsh); anything else is a
// local fixture (OriginFixture).
func originFor(ecosystem string) registry.Origin {
	if ecosystem == "dsh" {
		return registry.OriginDsh
	}
	return registry.OriginFixture
}

// fixtureManifestsFor — the manifest(s) a request resolves to (a group → every member).
func fixtureManifestsFor(in *fixtureInstallArgs) ([]string, bool) {
	if in.Group {
		return groupManifests(in.Fixture)
	}
	mf, ok := fixtureBlocks[in.Fixture]
	if !ok {
		return nil, false
	}
	return []string{mf}, true
}

func groupManifests(name string) ([]string, bool) {
	members, ok := fixtureGroups[name]
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(members))
	for _, m := range members {
		mf, mok := fixtureBlocks[m]
		if !mok {
			return nil, false
		}
		out = append(out, mf)
	}
	return out, true
}

func installFixture(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		if err := doInstallFixture(ctx, d, raw); err != nil {
			return nil, err
		}
		return json.Marshal(okOut{OK: true})
	}
}

func doInstallFixture(ctx context.Context, d *deps.Runtime, raw json.RawMessage) error {
	var in fixtureInstallArgs
	if uerr := json.Unmarshal(raw, &in); uerr != nil {
		return fp.BadInput("invalid arguments: " + uerr.Error())
	}
	if rerr := fp.RequireArgs([2]string{"fixture", in.Fixture}); rerr != nil {
		return rerr
	}
	manifests, ok := fixtureManifestsFor(&in)
	if !ok {
		return fp.NotFound("no such fixture: " + in.Fixture)
	}
	return mountFixtures(ctx, d, manifests, originFor(in.Ecosystem))
}

func mountFixtures(
	ctx context.Context, d *deps.Runtime, manifests []string, origin registry.Origin,
) error {
	for i := range manifests {
		m, perr := plugin.ParseManifest([]byte(manifests[i]))
		if perr != nil {
			return fp.OpErr("parse fixture manifest", perr)
		}
		MountInstalledBlockAs(ctx, d, &m, origin)
	}
	return nil
}
