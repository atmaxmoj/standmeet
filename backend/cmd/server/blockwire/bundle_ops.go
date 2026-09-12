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
	}...)}
}

// BundleResource — the assembler: create, delete, add, remove, list.
func BundleResource(d *deps.Runtime) dispatcher.Resource {
	return dispatcher.Resource{Name: "bundles", Ops: []fp.Op{
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
			Description: "Create an empty bundle by name. A code bound to it can use " +
				"exactly the blocks it contains.",
			InputSchema: bundleNameSchema,
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
			Description: "Put a block in a bundle. Every code bound to that bundle gains it " +
				"immediately, including sessions already open.",
			InputSchema: bundleMemberSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      addBundleBlock(d),
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
	}}
}

var (
	blockInstallSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"manifest":{"type":"string","description":"The block's manifest, as YAML."}
		},
		"required":["manifest"]
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
