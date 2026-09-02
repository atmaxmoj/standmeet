// writings_create.go —— write one long-form piece.
//
// It's the last operation in this domain to come home from ownercore, and it came home later
// than it should have: that package's comment kept saying "a byte stream can't fit through a
// JSON op", so this one got treated as **unmovable**. But it was never a byte stream — the MCP
// path receives a list of https URLs and the server fetches them itself
// (see writings_inline_files.go).
//
// What was genuinely unmovable was **merging two surfaces into one op**: the admin panel sends
// multipart (inline images in the body travel with the form), and that required splitting
// "upload an asset" into its own independent step first. Two separate things had been fused
// into one, so neither got done.
//
// That debt is now paid off, in two steps:
//
//  1. "upload an asset" became its own step (assets.upload, any genre);
//  2. the convergence point gained **a channel that carries bytes**
//     (fp.File / WithFiles / Face.OpFiles) — that was the missing piece all along, which is
//     why "the panel uses multipart" could only ever manifest as bypassing the convergence point.
//
// So Reach goes from Only(reason, "mcp") back to OwnerAction(): one op, two paths in —
// the AI gives a list of https URLs (the server fetches them itself), the browser gives
// bytes (field name `file:<pending-id>`). The two converge in saveInputWithFiles; downstream
// there's only one path.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// There used to be a writingCreateReason constant here — the reason string for Only, saying
// "the panel sends multipart while this op takes a list of URLs; merging into one op requires
// splitting asset upload into its own step first." Both things are now done, so the reason
// string was deleted along with Only.

// writingsCreateOp —— write one long-form piece (create or update). Same domain as the four
// in Writings(), but its own file: it's the only op in this domain that carries bytes
// alongside the call, and that part deserves to be read on its own.
func writingsCreateOp(deps WritingsDeps) fp.Op {
	return fp.Op{
		// The id is the MCP tool name, and it keeps its **historical name** — it's already
		// shipped. It genuinely is inconsistent with the neighboring writings.list /
		// publish / delete, but the cost of a rename falls on every caller, while
		// consistency is only cosmetic. (Same story for prompt_create / role_create.)
		ID: "writing_create",
		Description: "Write a long-form piece to the owner's /writings, or update one by " +
			"passing writing_id. body_md is GitHub-flavored markdown; publish=true makes it " +
			"visible immediately, otherwise draft. Inline images go in `files` as " +
			"{pending_id, url}; body_md and cover_image_asset_id reference them as " +
			"'standmeet-asset:pending-<id>'.",
		InputSchema: writingCreateSchema,
		Kind:        fp.Action,
		// Both surfaces owed this. It used to be fp.Only(..., "mcp"): the panel's path used
		// multipart, and the convergence point had no channel to carry bytes, so it could
		// only bypass the convergence point and call the domain directly (see the
		// check-routes-via-dispatcher baseline). Once the channel existed that reason was
		// gone — one op, two paths in (the AI gives a URL / the browser gives bytes).
		Reach:  fp.OwnerAction(),
		Invoke: createWriting(deps),
	}
}

var writingCreateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"writing_id":{"type":"string",
			"description":"Existing writing to update; empty creates a new one."},
		"slug":{"type":"string",
			"description":"Required when creating; on update the address is already set."},
		"title":{"type":"string"},
		"excerpt":{"type":"string"},
		"body_md":{"type":"string"},
		"cover_headline":{"type":"string"},
		"cover_hue":{"type":"string","description":"'amber' (default) | 'violet' | 'acid'."},
		"cover_image_asset_id":{"type":"string"},
		"tags":{"type":"array","items":{"type":"string"}},
		"visibility":{"type":"string","description":"'public' (default) | 'private'."},
		"cross_refs":{"type":"array","items":{"type":"string"}},
		"locked_body":{"type":"string"},
		"parent_id":{"type":"string","description":"Optional parent writing id (reader tree)."},
		"publish":{"type":"boolean"},
		"files":{"type":"array","items":{"type":"object",
			"properties":{
				"pending_id":{"type":"string"},
				"url":{"type":"string"}
			},
			"required":["pending_id","url"]}}
	},
	"required":["slug","title"]
}`)

type writingCreateArgs struct {
	WritingID         string           `json:"writing_id"`
	Slug              string           `json:"slug"`
	Title             string           `json:"title"`
	Excerpt           string           `json:"excerpt"`
	BodyMD            string           `json:"body_md"`
	CoverHeadline     string           `json:"cover_headline"`
	CoverHue          string           `json:"cover_hue"`
	CoverImageAssetID string           `json:"cover_image_asset_id"`
	Visibility        string           `json:"visibility"`
	LockedBody        string           `json:"locked_body"`
	ParentID          string           `json:"parent_id"`
	Tags              []string         `json:"tags"`
	CrossRefs         []string         `json:"cross_refs"`
	Files             []writingFileRef `json:"files"`
	Publish           bool             `json:"publish"`
}

// The output is exactly writingOut (the same shape as writings.list). There used to be a
// separate three-field writingCreateOut{writing_id, slug, published} here — so the same
// resource had two shapes, and "two shapes" is exactly what the convergence point exists to
// eliminate. The writing_id key still exists (see marshalWritingSaved); the owner's AI has
// always read the created id by that name.

func createWriting(deps WritingsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := parseWritingCreate(raw)
		if perr != nil {
			return nil, perr
		}
		in, ferr := saveInputWithFiles(ctx, &args, ownerID)
		if ferr != nil {
			return nil, ferr
		}
		wg, err := usecase.SaveWriting(ctx, deps.Tx, in)
		if err != nil {
			return nil, writingCreateErr(deps.Log, err)
		}
		// Returns the **full view** (byte-for-byte the same shape as writings.list), not a
		// three-field receipt. The panel needs to render this entry the instant it's saved —
		// an incomplete response would force it to either fire a second read request or
		// assemble a view of its own, and that's exactly where the two surfaces start
		// diverging into two different shapes.
		out := deps.toWritingOut(ctx, &wg)
		return marshalWritingSaved(&out)
	}
}

// saveInputWithFiles —— assembles the args into a save input, gathering up the inline
// images along the way.
//
// Images have **two paths in**, converging here:
//
//	`files:[{pending_id,url}]`  a URL the owner gave via the AI — the server fetches it itself
//	carried bytes (fp.FilesFrom)  a file the owner picked in the panel — field name
//	                              `file:<pending_id>`
//
// Both sides match the same pending_id against `standmeet-asset:pending-<id>` in the body;
// past this point there's only one path. If any one image can't be fetched → the whole piece
// doesn't save: a body with a dangling unreachable image is harder to debug than a failed save.
func saveInputWithFiles(
	ctx context.Context, args *writingCreateArgs, ownerID string,
) (*usecase.SaveWritingInput, error) {
	files, ferr := fetchInlineFiles(ctx, args.Files)
	if ferr != nil {
		return nil, fp.BadInput(ferr.Error())
	}
	in := writingSaveInput(args, ownerID)
	carried := carriedFiles(ctx)
	all := make([]usecase.FileInput, 0, len(files)+len(carried))
	all = append(all, files...)
	all = append(all, carried...)
	in.Files = all
	return in, nil
}

// carriedFilePrefix —— the field-name prefix for carried bytes. The frontend names fields
// `file:<pending-id>`, the placeholder in the body is `standmeet-asset:pending-<id>`, and
// the two sides match up by this id.
const carriedFilePrefix = "file:"

// carriedFiles —— bytes carried along with this call. Empty just means "the owner gave a
// URL instead" — not that something is broken.
func carriedFiles(ctx context.Context) []usecase.FileInput {
	carried := fp.FilesFrom(ctx)
	out := make([]usecase.FileInput, 0, len(carried))
	for i := range carried {
		pending, ok := strings.CutPrefix(carried[i].Field, carriedFilePrefix)
		if !ok {
			continue // doesn't match this naming convention, not meant for body illustration
		}
		out = append(out, usecase.FileInput{
			PendingID: pending, ContentType: carried[i].ContentType,
			OriginalFilename: carried[i].Filename, Body: carried[i].Body,
		})
	}
	return out
}

// writingSavedOut —— the full view + a writing_id alias.
//
// The alias exists for the owner's AI: it has always read the id of a just-created writing
// as `writing_id`, while that field is called `id` in the list shape. **Adding a key is
// cheaper than renaming one** — a rename forces every caller to follow along, and those
// callers live on other people's machines.
// Merged via a map rather than an embedded struct: embedding trips either "embedded fields
// must come first" or "a blank line is required between an embedded field and a regular
// one" — two lint rules biting each other. What's wanted here is exactly "that shape, plus
// one more key".
func marshalWritingSaved(out *writingOut) (json.RawMessage, error) {
	b, err := json.Marshal(out)
	if err != nil {
		return nil, fp.OpErr("encode writing", err)
	}
	var fields map[string]json.RawMessage
	if uerr := json.Unmarshal(b, &fields); uerr != nil {
		return nil, fp.OpErr("encode writing", uerr)
	}
	fields["writing_id"] = json.RawMessage(strconv.Quote(out.ID))
	merged, merr := json.Marshal(fields)
	if merr != nil {
		return nil, fp.OpErr("encode writing", merr)
	}
	return merged, nil
}

// writingCreateErr —— the caller gave it something wrong vs. this machine is broken.
//
// The two parent-node error cases used to live only in the admin route's error table
// (saveWritingErrCases). Once saving moved into the convergence point that table was gone,
// and only the slug-conflict case survived here — so "attach an article under its own
// descendant" went from a **400 plus a human-readable message** to a 500. The owner sees
// "server error", when what actually went wrong was the click they just made.
//
// The lesson is about moving code: **error classification travels with the capability**. The
// error table at the routing layer was part of the capability, not decoration on the
// routing — leaving it behind is the same as deleting it.
func writingCreateErr(log *slog.Logger, err error) error {
	for _, c := range writingSaveErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	log.Error("writings.save", "err", err)
	return fp.OpErr("save writing", err)
}

// writingSaveErrClasses —— the few "**caller gave it something wrong**" cases on the save
// path. Order doesn't matter (errors.Is walks the unwrap chain). Anything not in this table
// is treated as a local machine fault: log it + 500.
var writingSaveErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{entity.ErrWritingSlugTaken, func() error {
		return fp.Coded(fp.Conflict("a writing with this slug already exists"), "slug_taken")
	}},
	{entity.ErrParentNotFound, func() error {
		return fp.BadInput("parent writing not found")
	}},
	{entity.ErrParentCycle, func() error {
		return fp.BadInput("that parent would put the writing inside its own subtree")
	}},
	{apierr.ErrEmptyField, func() error {
		return fp.BadInput("slug and title are required")
	}},
}

func parseWritingCreate(raw json.RawMessage) (writingCreateArgs, error) {
	var args writingCreateArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := requireWritingSaveArgs(&args); err != nil {
		return args, err
	}
	applyWritingCreateDefaults(&args)
	return args, nil
}

// requireWritingSaveArgs —— **the required set differs between create and update**.
//
// Create: slug + title — a new article has nowhere to live without an address.
// Update: title only — the address is already fixed (and part of its identity, not casually
//
//	changed), so the caller usually doesn't send a slug at all. Requiring slug
//	unconditionally would give the panel a 400 on every title edit, with the error saying
//	"slug is missing" — a field it should never have had to send in the first place.
func requireWritingSaveArgs(args *writingCreateArgs) error {
	if args.WritingID == "" {
		return fp.RequireArgs(
			[2]string{"slug", args.Slug}, [2]string{"title", args.Title},
		)
	}
	return fp.RequireArgs([2]string{"title", args.Title})
}

func applyWritingCreateDefaults(args *writingCreateArgs) {
	if args.CoverHue == "" {
		args.CoverHue = "amber"
	}
	if args.Visibility == "" {
		args.Visibility = "public"
	}
}

func writingSaveInput(args *writingCreateArgs, ownerID string) *usecase.SaveWritingInput {
	return &usecase.SaveWritingInput{
		OwnerID: ownerID, WritingID: args.WritingID, Slug: args.Slug, Title: args.Title,
		Excerpt:       args.Excerpt,
		BodyMD:        args.BodyMD,
		CoverImageRef: args.CoverImageAssetID,
		CoverHeadline: args.CoverHeadline,
		CoverHue:      args.CoverHue,
		Tags:          nonNilStrings(args.Tags),
		Visibility:    args.Visibility,
		CrossRefs:     nonNilStrings(args.CrossRefs),
		LockedBody:    args.LockedBody,
		ParentID:      args.ParentID,
		Publish:       args.Publish,
	}
}
