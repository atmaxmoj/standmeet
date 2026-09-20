// codes_bundle_write.go — the codes.set_bundle op: bind an ALREADY-ISSUED code to a group of blocks
// (a bundle), switch it, or clear it, after the fact.
//
// Split from codes_write.go for the 350-line budget. The create-time binding is bindBundle over
// there (it runs inside issue); this is the after-the-fact rebind, reaching the same two repo
// methods (SetBundle / SetBundleByID) so an owner who assembled a group later can point a live code
// at it without revoking and reissuing. codeErr and codeBundleSchema live in codes.go.

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// codeBundleArgs — input for codes.set_bundle. id wins over name; empty (both) unbinds.
type codeBundleArgs struct {
	CodeID   string `json:"code_id"`
	Bundle   string `json:"bundle"`
	BundleID string `json:"bundle_id"`
}

// codeBundleOut — the binding receipt: the bundle NAME read back after the write, not an echo
// ([[write-with-no-receipt]]). Empty = the code carries no bundle and is judged by its role.
type codeBundleOut struct {
	CodeID string `json:"code_id"`
	Bundle string `json:"bundle"`
}

// setBundleOp — codes.set_bundle. A standalone function (like rotateOp) to keep codeCoreOps
// under its line budget.
func setBundleOp(d CodesDeps) fp.Op {
	return fp.Op{
		ID: "codes.set_bundle",
		Description: "Bind an already-issued code to a group of blocks (a bundle), switch it, " +
			"or clear it. Read live: editing the group moves this code too, and a block removed " +
			"from it leaves an open session on the next turn. An empty bundle unbinds — the code " +
			"falls back to its role's grant. Pass bundle (name) or bundle_id.",
		InputSchema: codeBundleSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      setCodeBundle(d.Codes),
	}
}

// setCodeBundle — bind an EXISTING code to a bundle, switch it, or clear it. The create path
// (bindBundle) does this at issue time; this reaches the same two repo methods after the fact, so
// an owner who assembled a group later can point a live code at it without revoking and reissuing.
func setCodeBundle(deps usecase.CodesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeBundleArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"code_id", in.CodeID}); err != nil {
			return nil, err
		}
		if err := applyBundleBinding(ctx, deps, ownerID, in); err != nil {
			return nil, codeErr(err)
		}
		return marshalCodeBundle(ctx, deps, ownerID, in.CodeID)
	}
}

// applyBundleBinding — id wins over name; an empty name unbinds (SetBundle with "").
func applyBundleBinding(
	ctx context.Context, deps usecase.CodesDeps, ownerID string, in codeBundleArgs,
) error {
	if in.BundleID != "" {
		return deps.Codes.SetBundleByID(ctx, ownerID, in.CodeID, in.BundleID)
	}
	_, err := deps.Codes.SetBundle(ctx, ownerID, in.CodeID, in.Bundle)
	return err
}

// marshalCodeBundle — read the bound name back so the receipt reflects stored state, not the input.
func marshalCodeBundle(
	ctx context.Context, deps usecase.CodesDeps, ownerID, codeID string,
) (json.RawMessage, error) {
	names, err := deps.Codes.BundleNames(ctx, ownerID)
	if err != nil {
		return nil, codeErr(err)
	}
	return json.Marshal(codeBundleOut{CodeID: codeID, Bundle: names[codeID]})
}
