// res_page.go —— 资源 page:owner 的公开主页,以及这台实例对外的两个地址(handle、public URL)。
//
// 主页的 insights / projects 是**语料的 pin 列表**(想法只存一份,主页放引用)。
// 所以这一组有两种写:整段配置的 put,和逐条的 pin / unpin。
//
// 迁移时发现的三处:
//
//   - page.get 两个面给的东西不一样:MCP 那份是**join 过的**(pin 连着标题、摘要、地址),
//     面板那份是裸的 id 列表。owner 从哪边看到的主页应该是同一个。
//   - "能 pin 什么"(已公开的 wiki)只有面板有,而且那条规则写在它的 handler 里。
//     从 Claude Code 问"我能 pin 什么"问不到 —— 现在两个面都有,规则在域里。
//   - page.put 在 MCP 那边**拒绝** pin 列表(怕绕开单一维护点),面板那边整段一起存。
//     两条路的不变量其实都由域守着(ValidatePagePins / PinToPage),所以统一成都接。

package dispatcher

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// PageStore —— page 这组操作所需的最小口。载荷是 join 过的主页视图,形状由 owner 域给出,
// 收口原样透传:它是**读**,再拆一遍 struct 只会多一份要同步的形状。
type PageStore interface {
	Get(ctx context.Context, ownerID string) (json.RawMessage, error)
	Put(ctx context.Context, ownerID string, body json.RawMessage) (json.RawMessage, error)
	Pinnable(ctx context.Context, ownerID string) ([]PinCandidate, error)
	Pin(ctx context.Context, ownerID, section, wikiID string) ([]string, error)
	Unpin(ctx context.Context, ownerID, section, wikiID string) ([]string, error)
	SetHandle(ctx context.Context, ownerID, handle string) (OwnerAddress, error)
	SetPublicURL(ctx context.Context, ownerID, publicURL string) (OwnerAddress, error)
}

// PinCandidate —— 一个可以 pin 到主页的条目。
type PinCandidate struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

// OwnerAddress —— 这台实例对外的地址:handle 是路径前缀,public URL 是 QR 和 canonical 用的。
type OwnerAddress struct {
	OwnerID   string `json:"owner_id"`
	Handle    string `json:"handle"`
	PublicURL string `json:"public_url"`
}

// Page —— page 资源。
func Page(store PageStore) Resource {
	return Resource{Name: "page", Ops: append(pageContentOps(store), pageAddressOps(store)...)}
}

func pageContentOps(store PageStore) []Op {
	return []Op{
		{
			ID: "page.get",
			Description: "Read the owner's public page as a visitor sees it: hero prose, " +
				"where, contact, and the pinned insights/projects joined to their corpus " +
				"entries (title, excerpt, path).",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      pageGet(store),
		},
		{
			ID: "page.put",
			Description: "Replace the page's own content: hero prose, hero examples, where, " +
				"contact. Pin lists may be included; every pinned entry must be published.",
			InputSchema: pagePutSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      pagePut(store),
		},
		{
			ID: "page.pinnable",
			Description: "List the corpus entries that may be pinned to the homepage — the " +
				"published wiki entries, with the path each one links to.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      pagePinnable(store),
		},
		{
			ID: "page.pin",
			Description: "Pin a published wiki entry onto a homepage section. The page shows " +
				"its title and excerpt and links into the reader — the text itself is never " +
				"copied. Pinning an unpublished entry is refused: publish it first.",
			InputSchema: pagePinSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      pagePinMutate(store.Pin, "pin to page"),
		},
		{
			ID:          "page.unpin",
			Description: "Take a pinned entry off a homepage section. Idempotent.",
			InputSchema: pagePinSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      pagePinMutate(store.Unpin, "unpin from page"),
		},
	}
}

func pageAddressOps(store PageStore) []Op {
	return []Op{
		{
			ID: "page.set_handle",
			Description: "Change the owner's public handle (the URL prefix). The old handle " +
				"stays as an alias, so codes and QR links already handed out keep working.",
			InputSchema: pageHandleSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      pageSetHandle(store),
		},
		{
			ID: "page.set_public_url",
			Description: "Set this deployment's canonical public URL, used for QR codes and " +
				"canonical links. Must be http(s):// with a host.",
			InputSchema: pagePublicURLSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      pageSetPublicURL(store),
		},
	}
}

var pagePutSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"hero_prose":{"type":"string"},
		"hero_examples":{"type":"array","items":{"type":"string"}},
		"where":{"type":"object"},
		"contact":{"type":"object"},
		"insights":{"type":"array","items":{"type":"string"},
			"description":"Pinned wiki ids; each must be published."},
		"projects":{"type":"array","items":{"type":"string"},
			"description":"Pinned wiki ids; each must be published."}
	}
}`)

var pagePinSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"section":{"type":"string","enum":["insights","projects"]},
		"wiki_id":{"type":"string","description":"Wiki entry id."}
	},
	"required":["section","wiki_id"]
}`)

var pageHandleSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"handle":{"type":"string",
		"description":"New handle, 2-64 chars of a-z0-9-."}},
	"required":["handle"]
}`)

var pagePublicURLSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"public_url":{"type":"string",
		"description":"Canonical public URL, e.g. https://me.example.com."}},
	"required":["public_url"]
}`)
