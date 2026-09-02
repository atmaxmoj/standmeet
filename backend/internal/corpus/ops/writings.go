// writings.go — the owner's long-form pieces: create / list / publish / unpublish / delete.
//
// The create declaration lives in its own file (writings_create.go), because it
// carries its own debt: the admin panel still goes through a hand-written
// multipart route, so its Reach is Only(reason, "mcp"). The discrepancy is
// recorded in the convergence point, not hidden by staying outside it.
//
// The MCP list used to return just a one-line summary (no body, no address, no
// read time, no image URLs), so the owner couldn't see what they'd written from
// Claude Code — only the title. Now both surfaces get the same full record.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

const writingPreviewMaxLen = 200

// noArgs — shared schema for operations that take no parameters.
var noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// WritingsDeps — the dependencies this group needs. The Tx one carries asset
// storage (deleting an article must delete its images along with it; listing
// must resolve images to accessible URLs).
type WritingsDeps struct {
	Writings usecase.WritingsDeps
	Tx       usecase.WritingsTxDeps
	Log      *slog.Logger
}

// Writings — create / list / publish / unpublish / delete.
func Writings(deps WritingsDeps) []fp.Op {
	return []fp.Op{
		writingsCreateOp(deps),
		{
			ID: "writings.list",
			Description: "List every writing, draft and published, newest first, with body " +
				"and the resolved URLs of the images it embeds.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listWritings(deps),
		},
		{
			ID:          "writings.publish",
			Description: "Publish a draft writing: it becomes readable at its public path.",
			InputSchema: writingIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setWritingPublished(deps, usecase.PublishWriting, "publish writing"),
		},
		{
			ID: "writings.unpublish",
			Description: "Take a published writing back to draft. The text is kept; only the " +
				"public page goes away.",
			InputSchema: writingIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setWritingPublished(deps, usecase.UnpublishWriting, "unpublish writing"),
		},
		{
			ID:          "writings.delete",
			Description: "Delete a writing and the images that belong to it.",
			InputSchema: writingIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteWriting(deps),
		},
	}
}

var writingIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"writing_id":{"type":"string","description":"Writing id."}},
	"required":["writing_id"]
}`)

// writingOut — the outbound shape of one writing (shared by both surfaces).
type writingOut struct {
	AssetURLs         map[string]string `json:"asset_urls"`
	PublishedAt       string            `json:"published_at,omitempty"`
	CreatedAt         string            `json:"created_at"`
	UpdatedAt         string            `json:"updated_at"`
	ID                string            `json:"id"`
	Slug              string            `json:"slug"`
	Title             string            `json:"title"`
	Excerpt           string            `json:"excerpt"`
	BodyMD            string            `json:"body_md"`
	Preview           string            `json:"preview"`
	CoverHeadline     string            `json:"cover_headline"`
	CoverHue          string            `json:"cover_hue"`
	CoverImageAssetID string            `json:"cover_image_asset_id"`
	Visibility        string            `json:"visibility"`
	LockedBody        string            `json:"locked_body"`
	ParentID          string            `json:"parent_id"`
	Path              string            `json:"path"`
	Tags              []string          `json:"tags"`
	CrossRefs         []string          `json:"cross_refs"`
	ReadMinutes       int32             `json:"read_minutes"`
	Published         bool              `json:"published"`
}

func (d WritingsDeps) toWritingOut(ctx context.Context, wg *entity.Writing) writingOut {
	parentID, _ := wg.ParentID()
	return writingOut{
		ID: wg.ID(), Slug: wg.Slug(), Title: wg.Title(), Excerpt: wg.Excerpt(),
		BodyMD:        wg.Body(),
		Preview:       usecase.LeadLine(wg.Body(), writingPreviewMaxLen),
		CoverHeadline: wg.CoverHeadline(), CoverHue: wg.CoverHue(),
		CoverImageAssetID: wg.CoverImageAssetID(),
		Tags:              wg.Tags(), Visibility: wg.VisibilityMode(),
		CrossRefs: wg.CrossRefs(), Path: wg.Path(),
		ReadMinutes: wg.ReadMinutes(), LockedBody: wg.LockedBody(),
		ParentID:    parentID,
		Published:   wg.IsPublished(),
		PublishedAt: writingPublishedAt(wg),
		CreatedAt:   wg.CreatedAt().Format(time.RFC3339),
		UpdatedAt:   wg.UpdatedAt().Format(time.RFC3339),
		AssetURLs:   d.assetURLs(ctx, wg),
	}
}

func writingPublishedAt(wg *entity.Writing) string {
	pub, ok := wg.PublishedAt()
	if !ok {
		return ""
	}
	return usecase.PublishedAtRFC3339(&pub)
}

// assetURLs — assets referenced by the body and cover → accessible URLs. Give
// an empty map when resolution fails: one article's images failing to resolve
// must not break the whole list from loading.
func (d WritingsDeps) assetURLs(ctx context.Context, wg *entity.Writing) map[string]string {
	var coverPtr *string
	if cover := wg.CoverImageAssetID(); cover != "" {
		coverPtr = &cover
	}
	urls, err := usecase.ResolveAssetURLs(
		ctx, d.Tx.Assets.Repo, d.Tx.Assets.Storage,
		usecase.WritingAssetIDs(wg.Body(), coverPtr),
	)
	if err != nil {
		d.Log.Error("resolve writing asset urls", "err", err, "writing_id", wg.ID())
		return map[string]string{}
	}
	return urls
}

func listWritings(deps WritingsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListAllWritings(ctx, deps.Writings, ownerID)
		if err != nil {
			return nil, writingErr(err)
		}
		out := make([]writingOut, 0, len(rows))
		for i := range rows {
			out = append(out, deps.toWritingOut(ctx, &rows[i]))
		}
		return json.Marshal(out)
	}
}

// publishFn — publish / unpublish are two functions in the domain; this layer
// just picks one.
type publishFn func(
	ctx context.Context, deps usecase.WritingsDeps, ownerID, writingID string,
) (entity.Writing, error)

func setWritingPublished(deps WritingsDeps, apply publishFn, what string) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseWritingID(raw)
		if perr != nil {
			return nil, perr
		}
		wg, err := apply(ctx, deps.Writings, ownerID, id)
		if err != nil {
			return nil, fp.OpErr(what, writingErr(err))
		}
		return json.Marshal(deps.toWritingOut(ctx, &wg))
	}
}

func deleteWriting(deps WritingsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseWritingID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeleteWritingWithAssets(ctx, deps.Tx, ownerID, id); err != nil {
			return nil, writingErr(err)
		}
		return json.Marshal(map[string]bool{"deleted": true})
	}
}

func parseWritingID(raw json.RawMessage) (string, error) {
	var in struct {
		WritingID string `json:"writing_id"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"writing_id", in.WritingID}); err != nil {
		return "", err
	}
	return in.WritingID, nil
}

func writingErr(err error) error {
	for _, c := range writingErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("writing op", err)
}

var writingErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{entity.ErrWritingNotFound, func() error {
		return fp.Coded(fp.NotFound("writing not found"), "writing_not_found")
	}},
	{entity.ErrWritingSlugTaken, func() error {
		return fp.Coded(fp.Conflict("writing slug already taken"), "slug_taken")
	}},
}
