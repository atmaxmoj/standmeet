// writings.go —— owner 的长文:列出 / 发布 / 取消发布 / 删除。
//
// 写(save)不在这儿:面板那边它是 multipart(正文里的内联图片跟表单一起传),MCP 那边是
// 一串 URL 让服务端去取。字节流进不了一个 JSON op —— 要并成一个,得先把"上传素材"拆成
// 独立一步,那会动到编辑器的保存路径。这是**已知的欠账**,不是"这条不该统一"。
//
// MCP 那份列表以前只有一行摘要(没有正文、地址、阅读时长、配图 URL),于是 owner 从
// Claude Code 看不到自己写了什么,只看得到标题。现在两个面同一份完整记录。

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

// noArgs —— 不吃参数的操作共用这份 schema。
var noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// WritingsDeps —— 这一组要的依赖。Tx 那份带素材存储(删文章要连着删配图,
// 列表要把配图解析成可访问地址)。
type WritingsDeps struct {
	Writings usecase.WritingsDeps
	Tx       usecase.WritingsTxDeps
	Log      *slog.Logger
}

// Writings —— 列出 / 发布 / 取消发布 / 删除。
func Writings(deps WritingsDeps) []fp.Op {
	return []fp.Op{
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

// writingOut —— 一篇长文的出站形状(两个面同一份)。
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

// assetURLs —— 正文和封面引用的素材 → 可访问地址。取不到给空表:一篇文章的配图取不到
// 地址,不该让整份列表打不开。
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

// publishFn —— 发布 / 取消发布在域里是两个函数;这一层只选其一。
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
