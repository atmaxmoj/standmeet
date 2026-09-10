// asset_pool.go — the owner-facing global asset pool ops (Resources → Assets).
// docs/design/global-assets.md: list the pool, see who references an asset, and delete —
// but a delete is refused (Conflict, naming the referrers) while anything still uses it.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

var noAssetArgsSchema = json.RawMessage(`{"type":"object","properties":{}}`)

var assetIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"asset_id":{"type":"string","description":"Which pool asset."}},
	"required":["asset_id"]
}`)

type assetIDArgs struct {
	AssetID string `json:"asset_id"`
}

// AssetPoolOps — the pool operation family (list / pool-upload / delete-guarded / references).
func AssetPoolOps(deps usecase.Deps) []fp.Op {
	return []fp.Op{
		assetsListOp(deps), assetsPoolUploadOp(deps),
		assetsPoolDeleteOp(deps), assetsReferencesOp(deps),
	}
}

var poolUploadSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"url":{"type":"string","description":"Public https URL the server fetches the bytes from."},
		"kind":{"type":"string","description":"'image' (default) | 'attachment'."},
		"filename":{"type":"string",
			"description":"Shown on the download button; defaults to the URL's last segment."}
	}
}`)

type poolUploadArgs struct {
	URL      string `json:"url"`
	Kind     string `json:"kind"`
	Filename string `json:"filename"`
}

func assetsPoolUploadOp(deps usecase.Deps) fp.Op {
	return fp.Op{
		ID: "assets.pool_upload",
		Description: "Upload a file straight into your global pool — no corpus entry needed. " +
			"Pass a public https `url` the server fetches; kind='image' (default) or " +
			"'attachment'. The asset lands unreferenced; cite it later with " +
			"'standmeet-asset:<asset_id>' in an entry's body or a microsite. (The Assets panel's " +
			"file picker uses this same op with the bytes attached.)",
		InputSchema: poolUploadSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      uploadPoolAsset(deps),
	}
}

func uploadPoolAsset(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		if !deps.HasMedia() {
			return nil, fp.OpErr("upload asset", errNoMedia)
		}
		in, perr := poolUploadInput(ctx, ownerID, raw)
		if perr != nil {
			return nil, perr
		}
		asset, err := usecase.UploadPoolAsset(ctx, deps.Media.Assets, in)
		if err != nil {
			return nil, assetUploadErr(err)
		}
		return marshalAssetUploaded(&asset)
	}
}

// poolUploadInput — parse the args and pick the intake route: the panel attaches bytes (they ride
// the ctx), the AI hands a URL. Bytes win when present; the file's own name fills in when none was
// given; one of the two must be there.
func poolUploadInput(
	ctx context.Context, ownerID string, raw json.RawMessage,
) (*usecase.PoolUploadInput, error) {
	var args poolUploadArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	in := &usecase.PoolUploadInput{
		OwnerID: ownerID, URL: args.URL, Kind: args.Kind, Filename: args.Filename,
	}
	mergeUploadBytes(ctx, in)
	if len(in.Body) == 0 && in.URL == "" {
		return nil, fp.BadInput("provide a url (or attach a file)")
	}
	return in, nil
}

// mergeUploadBytes — fold the panel's attached file (if any) into the input: its bytes, its
// content-type, and its own name when the caller gave none.
func mergeUploadBytes(ctx context.Context, in *usecase.PoolUploadInput) {
	files := fp.FilesFrom(ctx)
	if len(files) == 0 {
		return
	}
	in.Body = files[0].Body
	in.ContentType = files[0].ContentType
	if in.Filename == "" {
		in.Filename = files[0].Filename
	}
}

func assetsListOp(deps usecase.Deps) fp.Op {
	return fp.Op{
		ID: "assets.list",
		Description: "List every asset in your global pool (images + attachments), newest " +
			"first, each with a reachable URL.",
		InputSchema: noAssetArgsSchema,
		Kind:        fp.Read,
		Reach:       fp.OwnerRead(),
		Invoke:      listPoolAssets(deps),
	}
}

func listPoolAssets(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		if !deps.HasMedia() {
			return nil, fp.OpErr("list assets", errNoMedia)
		}
		views, err := usecase.ListPoolAssetViews(ctx, deps.Media.Assets, ownerID)
		if err != nil {
			return nil, fp.OpErr("list assets", err)
		}
		out, merr := json.Marshal(views)
		if merr != nil {
			return nil, fp.OpErr("encode assets", merr)
		}
		return out, nil
	}
}

func assetsPoolDeleteOp(deps usecase.Deps) fp.Op {
	return fp.Op{
		ID: "assets.pool_delete",
		Description: "Permanently delete one asset from your pool. Refused, naming who uses " +
			"it, while any corpus entry or microsite still references it — remove those first.",
		InputSchema: assetIDSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      deletePoolAsset(deps),
	}
}

func deletePoolAsset(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := parseAssetID(raw)
		if perr != nil {
			return nil, perr
		}
		if !deps.HasMedia() {
			return nil, fp.OpErr("delete asset", errNoMedia)
		}
		derr := usecase.DeletePoolAsset(ctx, deps.Media.Assets, ownerID, args.AssetID)
		if derr != nil {
			return nil, poolDeleteErr(ctx, deps, ownerID, args.AssetID, derr)
		}
		return json.RawMessage(`{"deleted":true}`), nil
	}
}

// poolDeleteErr — a referenced asset becomes a Conflict that names the referrers (what the
// owner must remove first); a missing/other-owner asset is NotFound.
func poolDeleteErr(
	ctx context.Context, deps usecase.Deps, ownerID, assetID string, err error,
) error {
	switch {
	case errors.Is(err, usecase.ErrAssetReferenced):
		refs, refErr := usecase.AssetReferences(ctx, deps.Media.Assets, ownerID, assetID)
		if refErr != nil {
			return fp.Conflict("still in use by a corpus entry or microsite — remove those first")
		}
		return fp.Conflict(referencedMessage(refs))
	case errors.Is(err, entity.ErrAssetNotFound):
		return fp.NotFound("no such asset in your pool")
	default:
		return fp.OpErr("delete asset", err)
	}
}

func referencedMessage(refs []entity.AssetReference) string {
	corpusN, siteN := 0, 0
	for i := range refs {
		if refs[i].Kind == entity.AssetRefMicrosite {
			siteN++
			continue
		}
		corpusN++
	}
	return fmt.Sprintf(
		"still used by %d corpus %s and %d %s — remove those first",
		corpusN, plural(corpusN, "entry", "entries"),
		siteN, plural(siteN, "microsite", "microsites"),
	)
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func assetsReferencesOp(deps usecase.Deps) fp.Op {
	return fp.Op{
		ID:          "assets.references",
		Description: "List what references one pool asset (corpus entries + microsites).",
		InputSchema: assetIDSchema,
		Kind:        fp.Read,
		Reach:       fp.OwnerRead(),
		Invoke:      listAssetReferences(deps),
	}
}

type assetRefView struct {
	Kind       string `json:"kind"`
	ReferrerID string `json:"referrer_id"`
}

func listAssetReferences(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := parseAssetID(raw)
		if perr != nil {
			return nil, perr
		}
		if !deps.HasMedia() {
			return nil, fp.OpErr("asset references", errNoMedia)
		}
		refs, err := fetchReferences(ctx, deps, ownerID, args.AssetID)
		if err != nil {
			return nil, err
		}
		return marshalRefs(refs)
	}
}

func fetchReferences(
	ctx context.Context, deps usecase.Deps, ownerID, assetID string,
) ([]entity.AssetReference, error) {
	refs, err := usecase.AssetReferences(ctx, deps.Media.Assets, ownerID, assetID)
	if err == nil {
		return refs, nil
	}
	if errors.Is(err, entity.ErrAssetNotFound) {
		return nil, fp.NotFound("no such asset in your pool")
	}
	return nil, fp.OpErr("asset references", err)
}

func marshalRefs(refs []entity.AssetReference) (json.RawMessage, error) {
	views := make([]assetRefView, 0, len(refs))
	for i := range refs {
		views = append(views, assetRefView{Kind: refs[i].Kind, ReferrerID: refs[i].ReferrerID})
	}
	out, err := json.Marshal(views)
	if err != nil {
		return nil, fp.OpErr("encode references", err)
	}
	return out, nil
}

func parseAssetID(raw json.RawMessage) (assetIDArgs, error) {
	var args assetIDArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"asset_id", args.AssetID}); err != nil {
		return args, err
	}
	return args, nil
}
