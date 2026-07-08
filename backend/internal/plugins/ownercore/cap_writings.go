// cap_writings.go —— Phase E-9: owner writings CRUD via Capability。
// 4 tools: writing_create / writing_list / writing_publish / writing_delete。
// owner-only。inline file uploads (`files` array) 走 cap_writings_files.go。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capWritingsBundle = "writings.bundle"

type writingsCapability struct {
	rw  *usecases.WritingsTxDeps
	ro  *usecases.WritingsDeps
	log *slog.Logger
}

func newWritingsCapability(
	rw *usecases.WritingsTxDeps, ro *usecases.WritingsDeps, log *slog.Logger,
) *writingsCapability {
	return &writingsCapability{rw: rw, ro: ro, log: log}
}

func (*writingsCapability) ID() string          { return capWritingsBundle }
func (*writingsCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*writingsCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*writingsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*writingsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *writingsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.createBinding(), c.listBinding(),
		c.publishBinding(), c.deleteBinding(),
	}
}

// ───── writing_create ─────────────────────────────────────────────

func (c *writingsCapability) createBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "writing_create",
		Description: "Write a long-form piece to the owner's /writings. body_md " +
			"is GitHub-flavored markdown; publish=true makes it visible immediately; " +
			"otherwise draft. Inline image uploads via `files`: each {pending_id, url}; " +
			"body_md / cover_image_asset_id reference 'standmeet-asset:pending-<id>'.",
		InputSchema: writingCreateInputSchema(),
		Handler:     c.handleCreate,
	}
}

func writingCreateInputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"slug":{"type":"string"},
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
}

type writingCreateArgsWire struct {
	Slug              string            `json:"slug"`
	Title             string            `json:"title"`
	Excerpt           string            `json:"excerpt"`
	BodyMD            string            `json:"body_md"`
	CoverHeadline     string            `json:"cover_headline"`
	CoverHue          string            `json:"cover_hue"`
	CoverImageAssetID string            `json:"cover_image_asset_id"`
	Visibility        string            `json:"visibility"`
	LockedBody        string            `json:"locked_body"`
	ParentID          string            `json:"parent_id"`
	Tags              []string          `json:"tags"`
	CrossRefs         []string          `json:"cross_refs"`
	Files             []writingFileWire `json:"files"`
	Publish           bool              `json:"publish"`
}

func (c *writingsCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseWritingCreateArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	files, ferr := fetchInlineFiles(ctx, args.Files)
	if ferr != nil {
		return capreg.MCPError(ferr.Error())
	}
	in := buildWritingSaveInput(&args, ownerID)
	in.Files = files
	wg, err := usecases.SaveWriting(ctx, *c.rw, in)
	if err != nil {
		return writingCreateErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "writing_create", map[string]any{
		"writing_id": wg.ID(), "slug": wg.Slug(), "published": wg.IsPublished(),
	})
}

func writingCreateErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, domain.ErrWritingSlugTaken) {
		return capreg.MCPError("writing slug already taken")
	}
	log.Error("cap writing_create", "err", err)
	return capreg.MCPError("create writing failed")
}

func parseWritingCreateArgs(raw json.RawMessage) (writingCreateArgsWire, error) {
	var args writingCreateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if err := validateWritingCreateRequired(&args); err != nil {
		return args, err
	}
	applyWritingCreateDefaults(&args)
	return args, nil
}

func validateWritingCreateRequired(args *writingCreateArgsWire) error {
	if args.Slug == "" {
		return errors.New("slug is required")
	}
	if args.Title == "" {
		return errors.New("title is required")
	}
	return nil
}

func applyWritingCreateDefaults(args *writingCreateArgsWire) {
	if args.CoverHue == "" {
		args.CoverHue = "amber"
	}
	if args.Visibility == "" {
		args.Visibility = "public"
	}
}

func buildWritingSaveInput(
	args *writingCreateArgsWire, ownerID string,
) *usecases.SaveWritingInput {
	return &usecases.SaveWritingInput{
		OwnerID: ownerID, Slug: args.Slug, Title: args.Title,
		Excerpt:       args.Excerpt,
		BodyMD:        args.BodyMD,
		CoverImageRef: args.CoverImageAssetID,
		CoverHeadline: args.CoverHeadline,

		CoverHue:   args.CoverHue,
		Tags:       mcputil.NonNilStrings(args.Tags),
		Visibility: args.Visibility,
		CrossRefs:  mcputil.NonNilStrings(args.CrossRefs),
		LockedBody: args.LockedBody,
		ParentID:   args.ParentID,
		Publish:    args.Publish,
	}
}

// ───── writing_list ────────────────────────────────────────────

func (c *writingsCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "writing_list",
		Description: "List all writings (drafts + published, newest first).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

type writingListRow struct {
	PublishedAt string   `json:"published_at,omitempty"`
	UpdatedAt   string   `json:"updated_at"`
	ID          string   `json:"id"`
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Excerpt     string   `json:"excerpt,omitempty"`
	Visibility  string   `json:"visibility"`
	Tags        []string `json:"tags"`
	Published   bool     `json:"published"`
}

func (c *writingsCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	rows, err := usecases.ListAllWritings(ctx, *c.ro, ownerID)
	if err != nil {
		c.log.Error("cap writing_list", "err", err)
		return capreg.MCPError("list writings failed")
	}
	out := make([]writingListRow, 0, len(rows))
	for i := range rows {
		out = append(out, writingRowToCapView(&rows[i]))
	}
	return mcputil.MarshalResult(c.log, "writing_list", out)
}

func writingRowToCapView(w *domain.Writing) writingListRow {
	row := writingListRow{
		ID: w.ID(), Slug: w.Slug(), Title: w.Title(),
		Excerpt: w.Excerpt(), Visibility: w.VisibilityMode(),
		Tags: w.Tags(), Published: w.IsPublished(),
		UpdatedAt: w.UpdatedAt().Format(mcpTimeFmt),
	}
	if pub, ok := w.PublishedAt(); ok {
		row.PublishedAt = usecases.PublishedAtRFC3339(&pub)
	}
	return row
}

// ───── writing_publish ────────────────────────────────────────

func (c *writingsCapability) publishBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "writing_publish",
		Description: "Publish a draft writing (sets published_at=now).",
		InputSchema: writingByIDSchema(),
		Handler:     c.handlePublish,
	}
}

type writingByIDArgsWire struct {
	WritingID string `json:"writing_id"`
}

func writingByIDSchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"writing_id":{"type":"string"}
		},
		"required":["writing_id"]
	}`)
}

func (c *writingsCapability) handlePublish(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args writingByIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.WritingID == "" {
		return capreg.MCPError("writing_id is required")
	}
	wg, err := usecases.PublishWriting(ctx, *c.ro, ownerID, args.WritingID)
	if err != nil {
		c.log.Error("cap writing_publish", "err", err)
		return capreg.MCPError("publish writing failed")
	}
	return mcputil.MarshalResult(c.log, "writing_publish", map[string]any{
		"writing_id": wg.ID(), "slug": wg.Slug(), "published": true,
	})
}

// ───── writing_delete ────────────────────────────────────────

func (c *writingsCapability) deleteBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "writing_delete",
		Description: "Delete a writing.",
		InputSchema: writingByIDSchema(),
		Handler:     c.handleDelete,
	}
}

func (c *writingsCapability) handleDelete(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args writingByIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.WritingID == "" {
		return capreg.MCPError("writing_id is required")
	}
	if err := usecases.DeleteWritingWithAssets(
		ctx, *c.rw, ownerID, args.WritingID,
	); err != nil {
		c.log.Error("cap writing_delete", "err", err)
		return capreg.MCPError("delete writing failed")
	}
	return mcputil.MarshalResult(c.log, "writing_delete", map[string]string{
		"writing_id": args.WritingID,
	})
}
