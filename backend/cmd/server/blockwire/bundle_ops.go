// bundle_ops.go — installing a block, and grouping blocks into a bundle.
//
// The two halves of `frontend.md`'s replacement for the subtractive ACL. Installing is
// what makes "adding a block costs no code" true for the owner rather than only for us;
// bundles are what make "what can this code do" a list they read instead of a rule they
// simulate.
//
// Declared here, beside `BlockResource`, for the same reason it is: these read the
// block tree and the owner's assembly, which live on the composition-root side and
// belong to no domain.

package blockwire

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/assembly"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// BlockResource — the whole `blocks` resource: the owner's panel (list / set_enabled /
// delete, declared in block_ops.go) plus install of an owner-supplied block.
//
// One resource, because they are one subject. Two resources over the same nouns is how
// the two plugin axes ended up with two words for one thing in the first place.
//
// **There is no separate `uninstall`.** `blocks.delete` already is it: `blockOps.Delete`
// branches on `ownerInstalled` and uninstalls, which is what lets the panel's delete
// button and the row's `deletable` flag agree. A second verb for the same action was
// worse than redundant — it reached `Assembly.Uninstall` directly, skipping the
// built-in refusal that `Delete` applies.
func BlockResource(d *deps.Runtime) dispatcher.Resource {
	return dispatcher.Resource{Name: "blocks", Ops: append(blockPanelOps(d), []fp.Op{
		{
			ID: "blocks.install",
			Description: "Install a block from its manifest. The manifest is the whole " +
				"block: id, what it faces, how to start it, and the settings it wants. " +
				"Installing an id that is already installed replaces it.",
			InputSchema: blockInstallSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      installBlock(d),
		},
		{
			ID: "blocks.install_fixture",
			Description: "Install a bundled example / foreign-ecosystem block by name " +
				"(ecosystem 'dsh' marks it foreign; group mounts every member). Mounted through " +
				"the same loader as any block, with no more trust.",
			InputSchema: fixtureInstallSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      installFixture(d),
		},
		{
			ID: "blocks.marketplace_search",
			Description: "Search the dsh block marketplace by query (id / tool) and optional " +
				"seam. Each hit carries an install id + the tools it provides; install by id " +
				"with blocks.install_fixture (ecosystem 'marketplace').",
			InputSchema: marketBlockSearchSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      searchMarketplaceBlocks(d),
		},
		blockGraphOp(d),
	}...)}
}

// BundleResource — the assembler: create, delete, add, remove, list (bundleCoreOps) plus
// the additive-surface writes (bundleWriteOps: set-list, include, delete-by-id).
func BundleResource(d *deps.Runtime) dispatcher.Resource {
	return dispatcher.Resource{
		Name: "bundles",
		Ops:  append(bundleCoreOps(d), bundleWriteOps(d)...),
	}
}

func bundleCoreOps(d *deps.Runtime) []fp.Op {
	return []fp.Op{
		{
			ID: "bundles.list",
			Description: "List the owner's bundles, each with the blocks it contains and " +
				"any block that failed to start the last time it was used.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listBundles(d),
		},
		{
			ID: "bundles.create",
			Description: "Create a bundle by name, optionally with an initial block list and " +
				"included bundles. A code bound to it can use exactly the blocks it resolves to.",
			InputSchema: bundleCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createBundle(d),
		},
		{
			ID: "bundles.delete",
			Description: "Delete a bundle. Codes bound to it keep working and fall back to " +
				"their role's grant; they are not revoked.",
			InputSchema: bundleNameSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteBundle(d),
		},
		{
			ID: "bundles.add_block",
			Description: "Set a bundle's whole block list (by id, {blocks:[…]}) or add one " +
				"block (by name, {block_id}). Read live: an open session's grant changes on its " +
				"next turn.",
			InputSchema: bundleWriteBlocksSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writeBundleBlocks(d),
		},
		{
			ID: "bundles.remove_block",
			Description: "Take a block out of a bundle. It becomes uncallable at once — " +
				"there is no draining and no grace period.",
			InputSchema: bundleMemberSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      removeBundleBlock(d),
		},
	}
}

func bundleWriteOps(d *deps.Runtime) []fp.Op {
	return []fp.Op{
		{
			ID: "bundles.set_includes",
			Description: "Set the bundles a bundle includes (by id). A code resolves to the " +
				"recursive, deduped union. An edge that would create a cycle is refused.",
			InputSchema: bundleIncludesSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setBundleIncludes(d),
		},
		{
			ID: "bundles.delete_by_id",
			Description: "Delete a bundle by id. Codes bound to it fall back to their role's " +
				"grant; they are not revoked.",
			InputSchema: bundleIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteBundleByID(d),
		},
	}
}

var (
	blockInstallSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"manifest":{"type":"string","description":"The block's manifest, as YAML."}
		},
		"required":["manifest"]
	}`)

	fixtureInstallSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"fixture":{"type":"string","description":"Bundled fixture id (e.g. dshecho)."},
			"ecosystem":{"type":"string","description":"'dsh' foreign; 'marketplace' installed."},
			"group":{"type":"boolean","description":"Install every member of a fixture group."}
		},
		"required":["fixture"]
	}`)

	marketBlockSearchSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"query":{"type":"string","description":"Match against block id / tool names."},
			"seam":{"type":"string","description":"Filter by seam/capability (optional)."}
		}
	}`)

	bundleNameSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"name":{"type":"string","description":"The bundle's name."}},
		"required":["name"]
	}`)

	bundleMemberSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"name":{"type":"string","description":"The bundle's name."},
			"block_id":{"type":"string","description":"The block's declared id."}
		},
		"required":["name","block_id"]
	}`)

	// bundleCreateSchema — name required; blocks / include_bundles optional initial content.
	bundleCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"name":{"type":"string","description":"The bundle's name."},
			"blocks":{"type":"array","items":{"type":"string"},
				"description":"Optional initial block ids."},
			"include_bundles":{"type":"array","items":{"type":"string"},
				"description":"Optional initial included bundle ids."}
		},
		"required":["name"]
	}`)

	// bundleWriteBlocksSchema — name is the bundle id (set) or the bundle name (add). blocks
	// present → replace the whole list; block_id present → add one.
	bundleWriteBlocksSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"name":{"type":"string","description":"Bundle id (set) or name (add)."},
			"block_id":{"type":"string","description":"Block id to add."},
			"blocks":{"type":"array","items":{"type":"string"},
				"description":"The whole block list to set."}
		},
		"required":["name"]
	}`)

	bundleIncludesSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"name":{"type":"string","description":"The bundle's id."},
			"include_bundles":{"type":"array","items":{"type":"string"},
				"description":"The bundle ids this bundle includes."}
		},
		"required":["name"]
	}`)

	bundleIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"name":{"type":"string","description":"The bundle's id."}},
		"required":["name"]
	}`)
)

type manifestArgs struct {
	Manifest string `json:"manifest"`
}

// installBlock — parse, persist, and mount, in that order.
//
// Parsing first means a manifest that cannot be read is rejected while the owner is
// still looking at the form, with the reason. Persisting before mounting means a block
// that mounts today is still installed after a restart — the alternative is a block that
// works until the process dies, which is worse than one that never worked.
func installBlock(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		rec, err := parseInstallArgs(raw)
		if err != nil {
			return nil, err
		}
		if serr := persistAndMount(ctx, d, ownerID, rec); serr != nil {
			return nil, serr
		}
		return json.Marshal(installedOut{OK: true, ID: rec.m.ID})
	}
}

// installedOut — the receipt: which id is now installed. A named type rather than a
// map[string]any, because `any` is banned in business code and the shape is fixed anyway.
type installedOut struct {
	ID string `json:"id"`
	OK bool   `json:"ok"`
}

// parsedInstall — the parsed manifest AND the text it came from. Both are needed: the parsed
// form to mount, the original text to store, and re-deriving either from the other is how they
// drift.
//
// Passed by pointer everywhere: a Manifest is ~592 bytes, and copying one per call on the
// install path buys nothing.
type parsedInstall struct {
	text string
	m    plugin.Manifest
}

// parseInstallArgs — decode, require, and parse the manifest, in that order.
//
// Parsing before anything is persisted means a manifest that cannot be read is rejected while
// the owner is still looking at the form, with the reason.
func parseInstallArgs(raw json.RawMessage) (*parsedInstall, error) {
	var in manifestArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"manifest", in.Manifest}); err != nil {
		return nil, err
	}
	m, perr := plugin.ParseManifest([]byte(in.Manifest))
	if perr != nil {
		// The owner's own text, so the reason goes back to them: this is the one
		// place in the product where "invalid input" has an author who can fix it.
		return nil, fp.BadInput(perr.Error())
	}
	return &parsedInstall{m: m, text: in.Manifest}, nil
}

// persistAndMount — persist before mounting, so a block that mounts today is still installed
// after a restart. The alternative is a block that works until the process dies, which is
// worse than one that never worked.
func persistAndMount(
	ctx context.Context, d *deps.Runtime, ownerID string, p *parsedInstall,
) error {
	// Refuse a cyclic composition BEFORE persisting: a block whose requires close a loop with the
	// already-installed set has no load order and must not be stored or mounted.
	if cerr := refuseIfCycle(ctx, d, ownerID, &p.m); cerr != nil {
		return cerr
	}
	rec := assembly.InstalledBlock{BlockID: p.m.ID, Title: p.m.Title, Manifest: p.text}
	if serr := d.Assembly.Install(ctx, ownerID, &rec); serr != nil {
		return fp.OpErr("install block", serr)
	}
	// Re-installing is the owner's way of saying "I fixed it", so last time's
	// failure stops being the current state. A health indicator nobody can clear is
	// one nobody reads, and it would go red permanently on the first bad paste.
	if cerr := d.Assembly.ClearFailure(ctx, ownerID, p.m.ID); cerr != nil {
		d.Log.Warn("clear block failure on install", "id", p.m.ID, "err", cerr)
	}
	MountInstalledBlock(ctx, d, &p.m)
	return nil
}

// The bundle half — list / create / delete / add_block / remove_block and their payload
// shapes — lives in bundle_assemble.go. The two resources are declared together above because
// the owner meets them together; the work behind them is two subjects.

// okOut — the bare receipt for an action with nothing to report but success.
type okOut struct {
	OK bool `json:"ok"`
}
