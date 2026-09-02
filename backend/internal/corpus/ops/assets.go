// assets.go — attach a file to a corpus entry. **Any genre.**
//
// This step didn't used to exist. Attaching an image had exactly one path:
// hand over inline image URLs together with a writing when creating it
// (writing_create's files). So "an asset" was never its own thing — it was
// part of the writing operation. There was no story for a raw entry or a wiki
// entry wanting a cover image.
//
// Now it's its own step: attach an asset to get an asset_id, then reference it
// in the body as `standmeet-asset:<id>`, or set it as the hero image. This is
// also the precondition writing_create's fp.Only is waiting on — before the
// two surfaces can merge into one op, there first has to be an "upload asset"
// step.
//
// The URL is an https address the owner supplies; the server fetches it
// itself (matching how he actually uses this: the image lives on an image
// host, and he hands the AI a link). Every guard on that fetch path lives in
// usecase/media_guard.go.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// errNoMedia — this build wasn't wired to asset storage. Distinct from "the
// asset was rejected": that's a caller input problem, this is a local
// misconfiguration.
var errNoMedia = errors.New("media storage is not configured")

// AssetOps — the asset operation family.
func AssetOps(deps usecase.Deps) []fp.Op {
	return []fp.Op{assetsUploadOp(deps), assetsDeleteOp(deps)}
}

func assetsDeleteOp(deps usecase.Deps) fp.Op {
	return fp.Op{
		ID: "assets.delete",
		Description: "Remove one file from a corpus entry. If it was the entry's cover, " +
			"the cover is cleared too. Body references to it stop resolving, so drop " +
			"the 'standmeet-asset:<asset_id>' text from the body as well.",
		InputSchema: assetDeleteSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      deleteAsset(deps),
	}
}

var assetDeleteSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"genre":{"type":"string","description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
		"id":{"type":"string","description":"The corpus entry the file is attached to."},
		"asset_id":{"type":"string","description":"Which file, as returned by assets.upload."}
	},
	"required":["genre","id","asset_id"]
}`)

type assetDeleteArgs struct {
	Genre   string `json:"genre"`
	ID      string `json:"id"`
	AssetID string `json:"asset_id"`
}

func deleteAsset(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := parseAssetDelete(raw)
		if perr != nil {
			return nil, perr
		}
		if !deps.HasMedia() {
			return nil, fp.OpErr("delete asset", errNoMedia)
		}
		err := usecase.DeleteNoteAsset(ctx, deps.Media, ownerID, args.ID, args.AssetID)
		if err != nil {
			return nil, assetDeleteErr(err)
		}
		return json.RawMessage(`{"deleted":true}`), nil
	}
}

// assetDeleteErr — not found is not found. Assets have no separate permission
// layer, so "not under this corpus entry" and "no such id at all" are the same
// thing to the caller, and **should** be: answering them differently would
// itself answer "does this id exist?".
func assetDeleteErr(err error) error {
	if errors.Is(err, entity.ErrEntryNotFound) {
		return fp.NotFound("no such file on this corpus entry")
	}
	return fp.OpErr("delete asset", err)
}

func parseAssetDelete(raw json.RawMessage) (assetDeleteArgs, error) {
	var args assetDeleteArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"genre", args.Genre}, [2]string{"id", args.ID},
		[2]string{"asset_id", args.AssetID},
	); err != nil {
		return args, err
	}
	return args, nil
}

func assetsUploadOp(deps usecase.Deps) fp.Op {
	return fp.Op{
		ID: "assets.upload",
		Description: "Attach a file to a corpus entry of any genre (raw / wiki / output). " +
			"The server fetches `url` itself, so pass a public https link. kind='image' " +
			"for inline pictures and hero art, kind='attachment' for downloadables like a " +
			"PDF. Reference the returned asset_id from the body as " +
			"'standmeet-asset:<asset_id>', or set it as cover_image_asset_id via corpus.update.",
		InputSchema: assetUploadSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      uploadAsset(deps),
	}
}

var assetUploadSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"genre":{"type":"string","description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
		"id":{"type":"string","description":"The corpus entry this file belongs to."},
		"url":{"type":"string","description":"Public https URL the server fetches the bytes from."},
		"kind":{"type":"string","description":"'image' (default) | 'attachment'."},
		"filename":{"type":"string",
			"description":"Shown on the download button; defaults to the URL's last segment."}
	},
	"required":["genre","id"]
}`)

// Note: url isn't required in the schema, but **for the generative surface
// (MCP) it's effectively mandatory** — there's no file picker there, so all
// the owner can hand over is a URL. It's left loose in the schema because the
// panel calls this same op with bytes attached inline; parseAssetUpload picks
// between the two, and gets it wrong with "missing required field: url (or
// attach the file itself)". Hard-requiring it in the schema would permanently
// block the panel's path.

type assetUploadArgs struct {
	Genre    string `json:"genre"`
	ID       string `json:"id"`
	URL      string `json:"url"`
	Kind     string `json:"kind"`
	Filename string `json:"filename"`
}

// assetUploadOut — what's returned once the attach succeeds. asset_id is the
// only key for referencing it afterward.
type assetUploadOut struct {
	AssetID     string `json:"asset_id"`
	Kind        string `json:"kind"`
	ContentType string `json:"content_type"`
	Filename    string `json:"original_filename"`
	SizeBytes   int64  `json:"size_bytes"`
}

// uploadAsset — one operation, two sources.
//
//	owner via the AI    hands over an https URL (image lives on an image host) — server fetches it
//	owner in the panel   hands over bytes (file is on his machine) — inline bytes ride the ctx
//
// The two converge here; past this point there's only one path — the same
// asset guards, the same persistence order. Splitting this into two ops would
// leave the panel's path off the convergence point's books: the MCP surface
// wouldn't know it exists, and the policy chain wouldn't apply to it — which
// is exactly why this op originally accepted only URLs, forcing the panel to
// bypass the convergence point and hit the domain directly.
func uploadAsset(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		files := fp.FilesFrom(ctx)
		args, perr := parseAssetUpload(raw, files)
		if perr != nil {
			return nil, perr
		}
		if !deps.HasMedia() {
			return nil, fp.OpErr("attach asset", errNoMedia)
		}
		asset, err := attachEitherWay(ctx, deps, ownerID, &args, files)
		if err != nil {
			return nil, assetUploadErr(err)
		}
		return marshalAssetUploaded(&asset)
	}
}

func attachEitherWay(
	ctx context.Context, deps usecase.Deps, ownerID string,
	args *assetUploadArgs, files []fp.File,
) (entity.Asset, error) {
	if len(files) == 0 {
		return usecase.AttachAsset(ctx, deps.Media, &usecase.AttachAssetInput{
			OwnerID: ownerID, NoteID: args.ID, URL: args.URL,
			Kind: args.Kind, Filename: args.Filename,
		})
	}
	f := files[0]
	return usecase.AttachAssetBytes(ctx, deps.Media, &usecase.AttachBytesInput{
		OwnerID: ownerID, NoteID: args.ID, Kind: args.Kind,
		Filename:    pickName(args.Filename, f.Filename),
		ContentType: f.ContentType, Body: f.Body,
	})
}

// pickName — an explicitly given filename wins; fall back to the file's own.
func pickName(given, fromFile string) string {
	if given != "" {
		return given
	}
	return fromFile
}

func marshalAssetUploaded(a *entity.Asset) (json.RawMessage, error) {
	out, err := json.Marshal(assetUploadOut{
		AssetID: a.ID, Kind: a.Kind, ContentType: a.ContentType,
		Filename: a.OriginalFilename, SizeBytes: a.SizeBytes,
	})
	if err != nil {
		return nil, fp.OpErr("encode asset", err)
	}
	return out, nil
}

// assetUploadErr — a rejected asset is **a caller input problem**, not a
// local failure: say clearly what's wrong so the AI can try a different URL,
// instead of returning a 500 that makes it think the service is broken.
func assetUploadErr(err error) error {
	switch {
	case errors.Is(err, entity.ErrEntryNotFound):
		return fp.NotFound("corpus entry not found: nothing with this id to attach to")
	case usecase.MediaRejected(err):
		return fp.BadInput(err.Error())
	default:
		return fp.OpErr("attach asset", err)
	}
}

// parseAssetUpload — files are the bytes riding along with this call.
// Requiring url when bytes are already attached would force the panel to
// upload the file elsewhere first and paste the link back; requiring neither
// bytes nor url leaves nothing to attach.
func parseAssetUpload(raw json.RawMessage, files []fp.File) (assetUploadArgs, error) {
	var args assetUploadArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"genre", args.Genre}, [2]string{"id", args.ID},
	); err != nil {
		return args, err
	}
	if err := requireSource(args.URL, files); err != nil {
		return args, err
	}
	return args, validGenre(args.Genre)
}

func requireSource(url string, files []fp.File) error {
	if url == "" && len(files) == 0 {
		return fp.BadInput("missing required field: url (or attach the file itself)")
	}
	return nil
}

// validGenre — which genres can carry an asset: **all four count**, including
// subjectivity.
//
// The underlying mechanism has always been genre-agnostic (assets attach by
// holder_id, with no genre column; the hero image lives on the shared
// corpus_notes table, and NoteHeroRepo fetches only by id+owner). One genre
// used to be missing here purely because the allowlist omitted it — and the
// entire point of this feature is "doesn't discriminate by genre", so
// omitting one made that claim false.
func validGenre(genre string) error {
	switch genre {
	case genreRaw, genreWiki, genreOutput, genreSubjectivity:
		return nil
	default:
		return fp.BadInput("genre must be one of raw, wiki, output, subjectivity")
	}
}
