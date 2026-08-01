// res_writings.go —— 资源 writings:owner 的长文。
//
// 这一批是**读和状态开关**:列出、发布、取消发布、删除。写(save)还没搬 —— 它在面板那边是
// multipart(正文里的内联图片跟着表单一起传),在 MCP 那边是一串 URL 让服务端去取。
// 字节流进不了一个 JSON op,所以那件事得先拆成"上传素材"和"存这篇"两步,那是一次会动到
// 编辑器保存路径的改动,不混在这一批里。见 writings.save 的欠账说明(cap_writings.go)。

package dispatcher

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// Writing —— 一篇长文在出站这一层的形状(两个面同一份)。
//
// MCP 那份以前只有一行摘要(没有正文、地址、阅读时长、素材 URL),于是 owner 从 Claude Code
// 看不到自己写了什么,只能看到标题。
type Writing struct {
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

// WritingStore —— writings 这组操作所需的最小口。
type WritingStore interface {
	List(ctx context.Context, ownerID string) ([]Writing, error)
	Publish(ctx context.Context, ownerID, writingID string) (Writing, error)
	Unpublish(ctx context.Context, ownerID, writingID string) (Writing, error)
	Delete(ctx context.Context, ownerID, writingID string) error
}

// Writings —— writings 资源。
func Writings(store WritingStore) Resource {
	return Resource{Name: "writings", Ops: []Op{
		{
			ID: "writings.list",
			Description: "List every writing, draft and published, newest first, with " +
				"body and the resolved URLs of the images it embeds.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      writingsList(store),
		},
		{
			ID:          "writings.publish",
			Description: "Publish a draft writing: it becomes readable at its public path.",
			InputSchema: writingIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writingsSetPublished(store.Publish, "publish writing"),
		},
		{
			ID: "writings.unpublish",
			Description: "Take a published writing back to draft. The text is kept; only " +
				"the public page goes away.",
			InputSchema: writingIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writingsSetPublished(store.Unpublish, "unpublish writing"),
		},
		{
			ID:          "writings.delete",
			Description: "Delete a writing and the images that belong to it.",
			InputSchema: writingIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writingsDelete(store),
		},
	}}
}

var writingIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"writing_id":{"type":"string","description":"Writing id."}},
	"required":["writing_id"]
}`)

type writingIDArgs struct {
	WritingID string `json:"writing_id"`
}

func parseWritingID(raw json.RawMessage) (string, error) {
	var in writingIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", BadInput("invalid arguments: " + err.Error())
	}
	if in.WritingID == "" {
		return "", BadInput("writing_id is required")
	}
	return in.WritingID, nil
}

func writingsList(store WritingStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, opErr("list writings", err)
		}
		if rows == nil {
			rows = []Writing{}
		}
		return marshalOut(rows)
	}
}

// writingsSetPublished —— 发布和取消发布只差调哪个函数;解参和回包形状同一份。
func writingsSetPublished(
	apply func(ctx context.Context, ownerID, writingID string) (Writing, error), what string,
) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseWritingID(raw)
		if perr != nil {
			return nil, perr
		}
		wg, err := apply(ctx, ownerID, id)
		if err != nil {
			return nil, opErr(what, err)
		}
		return marshalOut(wg)
	}
}

// deletedWriting —— 删除的回执:对哪一篇做完了什么。
type deletedWriting struct {
	WritingID string `json:"writing_id"`
	Deleted   bool   `json:"deleted"`
}

func writingsDelete(store WritingStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseWritingID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := store.Delete(ctx, ownerID, id); err != nil {
			return nil, opErr("delete writing", err)
		}
		return marshalOut(deletedWriting{WritingID: id, Deleted: true})
	}
}
