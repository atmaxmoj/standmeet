// cap_writings.go —— 只剩 writing_create 一个工具。
//
// 列出 / 发布 / 取消发布 / 删除都搬进了出站收口(dispatcher.Writings)。**写**没搬:
// 面板那边它是 multipart(正文里的内联图片跟表单一起传),MCP 这边是一串 URL 让服务端去取。
// 字节流进不了一个 JSON op —— 要并成一个 op,得先把"上传素材"拆成独立一步,那会动到
// 编辑器的保存路径。这是**已知的欠账**,不是"这条不该统一"。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

const capWritingsBundle = "writings.bundle"

type writingsCapability struct {
	rw  *corpus.WritingsTxDeps
	ro  *corpus.WritingsDeps
	log *slog.Logger
}

func newWritingsCapability(
	rw *corpus.WritingsTxDeps, ro *corpus.WritingsDeps, log *slog.Logger,
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
	return []*capreg.MCPBinding{c.createBinding()}
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
	wg, err := corpus.SaveWriting(ctx, *c.rw, in)
	if err != nil {
		return writingCreateErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "writing_create", map[string]any{
		"writing_id": wg.ID(), "slug": wg.Slug(), "published": wg.IsPublished(),
	})
}

func writingCreateErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, corpus.ErrWritingSlugTaken) {
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
) *corpus.SaveWritingInput {
	return &corpus.SaveWritingInput{
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
