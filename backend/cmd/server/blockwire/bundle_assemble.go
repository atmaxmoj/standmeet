// bundle_assemble.go — grouping blocks into a bundle: create, delete, add, remove, list.
//
// Split from bundle_ops.go along the seam its own header named. That file had grown to hold
// two subjects — installing a block, and assembling blocks into a bundle — and the max-lines
// gate is the thing that says so out loud. The resource declarations stay together there,
// beside BlockResource; the bundle work lives here.
//
// Bundles are `frontend.md`'s replacement for the subtractive ACL: what a code can do becomes
// a list the owner reads instead of a rule they simulate. The membership is read LIVE at every
// assembly, which is why add and remove bite a session that is already open.

package blockwire

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin/assembly"
)

// bundleView — one bundle as the panel reads it.
type bundleView struct {
	Name     string        `json:"name"`
	Blocks   []string      `json:"blocks"`
	Failures []failureView `json:"failures"`
}

type failureView struct {
	BlockID string `json:"block_id"`
	Title   string `json:"title"`
	Stderr  string `json:"stderr"`
}

type bundleListOut struct {
	Bundles []bundleView `json:"bundles"`
}

func listBundles(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		bs, err := d.Assembly.ListBundles(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list bundles", err)
		}
		return json.Marshal(bundleListOut{Bundles: toBundleViews(bs)})
	}
}

func toBundleViews(bs []assembly.Bundle) []bundleView {
	out := make([]bundleView, 0, len(bs))
	for i := range bs {
		out = append(out, bundleView{
			Name: bs[i].Name, Blocks: bs[i].Blocks, Failures: toFailureViews(bs[i].Failures),
		})
	}
	return out
}

func toFailureViews(fs []assembly.Failure) []failureView {
	out := make([]failureView, 0, len(fs))
	for i := range fs {
		out = append(out, failureView{
			BlockID: fs[i].BlockID, Title: fs[i].Title, Stderr: fs[i].Stderr,
		})
	}
	return out
}

type bundleNameArgs struct {
	Name string `json:"name"`
}

type bundleMemberArgs struct {
	Name    string `json:"name"`
	BlockID string `json:"block_id"`
}

func createBundle(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, err := decodeBundleName(raw)
		if err != nil {
			return nil, err
		}
		if _, cerr := d.Assembly.CreateBundle(ctx, ownerID, in.Name); cerr != nil {
			// A name they already used is something the owner can fix; anything else is ours.
			if errors.Is(cerr, assembly.ErrNameTaken) {
				return nil, fp.BadInput("a bundle called " + in.Name + " already exists")
			}
			return nil, fp.OpErr("create bundle", cerr)
		}
		return json.Marshal(okOut{OK: true})
	}
}

func deleteBundle(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, err := decodeBundleName(raw)
		if err != nil {
			return nil, err
		}
		if derr := d.Assembly.DeleteBundle(ctx, ownerID, in.Name); derr != nil {
			return nil, fp.OpErr("delete bundle", derr)
		}
		return json.Marshal(okOut{OK: true})
	}
}

func addBundleBlock(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, err := decodeBundleMember(raw)
		if err != nil {
			return nil, err
		}
		if aerr := d.Assembly.AddBlock(ctx, ownerID, in.Name, in.BlockID); aerr != nil {
			return nil, bundleWriteErr("add block to bundle", aerr)
		}
		return json.Marshal(okOut{OK: true})
	}
}

func removeBundleBlock(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, err := decodeBundleMember(raw)
		if err != nil {
			return nil, err
		}
		if rerr := d.Assembly.RemoveBlock(ctx, ownerID, in.Name, in.BlockID); rerr != nil {
			return nil, bundleWriteErr("remove block from bundle", rerr)
		}
		return json.Marshal(okOut{OK: true})
	}
}

// bundleWriteErr — an unknown bundle is a wrong address, not a broken instance.
func bundleWriteErr(what string, err error) error {
	if errors.Is(err, assembly.ErrNotFound) {
		return fp.BadInput("no such bundle")
	}
	return fp.OpErr(what, err)
}

func decodeBundleName(raw json.RawMessage) (bundleNameArgs, error) {
	var in bundleNameArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"name", in.Name}); err != nil {
		return in, err
	}
	return in, nil
}

func decodeBundleMember(raw json.RawMessage) (bundleMemberArgs, error) {
	var in bundleMemberArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"name", in.Name}, [2]string{"block_id", in.BlockID},
	); err != nil {
		return in, err
	}
	return in, nil
}
