// page.go —— 资源 page:owner 的公开主页,以及这台实例对外的两个地址(handle、public URL)。
//
// 主页的 insights / projects 是**语料的 pin 列表**(想法只存一份,主页放引用)。
// 所以这一组有两种写:整段配置的 put,和逐条的 pin / unpin。
//
// 归一化时收掉的三处:
//
//   - page.get 两个面给的东西不一样:MCP 那份是**join 过的**(pin 连着标题、摘要、地址),
//     面板那份是裸的 id 列表。owner 从哪边看到的主页应该是同一个。
//   - "能 pin 什么"(已公开的 wiki)只有面板有,而且那条规则写在它的 handler 里。
//     从 Claude Code 问"我能 pin 什么"问不到 —— 现在每个面都有,规则在域里。
//   - page.put 在 MCP 那边**拒绝** pin 列表(怕绕开单一维护点),面板那边整段一起存。
//     两条路的不变量其实都由域守着(ValidatePagePins / PinToPage),所以统一成都接。

package ops

import (
	"context"
	"encoding/json"
	"errors"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// PageOpsDeps —— 主页内容 + pin 的 join,外加改地址那两条。
type PageOpsDeps struct {
	Owners    *repo.Repo
	Pins      usecase.PagePinDeps
	Handle    usecase.HandleDeps
	PublicURL usecase.PublicURLDeps
}

// Page —— 主页内容(get / put / pinnable / pin / unpin)+ 对外地址(handle / public URL)。
func Page(d PageOpsDeps) []fp.Op {
	return append(pageContentOps(d), pageAddressOps(d)...)
}

func pageContentOps(d PageOpsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "page.get",
			Description: "Read the owner's public page as a visitor sees it: hero prose, " +
				"where, contact, and the pinned insights/projects joined to their corpus " +
				"entries (title, excerpt, path).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getPage(d),
		},
		{
			ID: "page.put",
			Description: "Replace the page's own content: hero prose, hero examples, where, " +
				"contact. Pin lists may be included; every pinned entry must be published.",
			InputSchema: pagePutSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      putPage(d),
		},
		{
			ID: "page.pinnable",
			Description: "List the corpus entries that may be pinned to the homepage — the " +
				"published wiki entries, with the path each one links to.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listPinnable(d.Pins),
		},
		{
			ID: "page.pin",
			Description: "Pin a published wiki entry onto a homepage section. The page shows " +
				"its title and excerpt and links into the reader — the text itself is never " +
				"copied. Pinning an unpublished entry is refused: publish it first.",
			InputSchema: pagePinSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      mutatePin(d.Pins, usecase.PinToPage),
		},
		{
			ID:          "page.unpin",
			Description: "Take a pinned entry off a homepage section. Idempotent.",
			InputSchema: pagePinSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      mutatePin(d.Pins, usecase.UnpinFromPage),
		},
	}
}

func pageAddressOps(d PageOpsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "page.set_handle",
			Description: "Change the owner's public handle (the URL prefix). The old handle " +
				"stays as an alias, so codes and QR links already handed out keep working.",
			InputSchema: pageHandleSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setHandle(d.Handle),
		},
		{
			ID: "page.set_public_url",
			Description: "Set this deployment's canonical public URL, used for QR codes and " +
				"canonical links. Must be http(s):// with a host.",
			InputSchema: pagePublicURLSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setPublicURL(d.PublicURL),
		},
	}
}

var (
	pagePutSchema = json.RawMessage(`{
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

	pagePinSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"section":{"type":"string","enum":["insights","projects"]},
			"wiki_id":{"type":"string","description":"Wiki entry id."}
		},
		"required":["section","wiki_id"]
	}`)

	pageHandleSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"handle":{"type":"string",
			"description":"New handle, 2-64 chars of a-z0-9-."}},
		"required":["handle"]
	}`)

	pagePublicURLSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"public_url":{"type":"string",
			"description":"Canonical public URL, e.g. https://me.example.com."}},
		"required":["public_url"]
	}`)
)

// pinCandidateOut —— 一个可以 pin 到主页的条目。
type pinCandidateOut struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

// ownerAddressOut —— 这台实例对外的地址:handle 是路径前缀,public URL 是 QR 和 canonical 用的。
type ownerAddressOut struct {
	OwnerID   string `json:"owner_id"`
	Handle    string `json:"handle"`
	PublicURL string `json:"public_url"`
}

// pinnedOut —— pin / unpin 的回执:动完之后这个栏目是什么样。
type pinnedOut struct {
	Section string   `json:"section"`
	Pinned  []string `json:"pinned"`
}

func getPage(d PageOpsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		content, err := usecase.PageContentOrDefault(ctx, d.Owners, ownerID)
		if err != nil {
			return nil, pageErr(err)
		}
		return joinedPageView(ctx, d, ownerID, &content)
	}
}

func putPage(d PageOpsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		content, err := usecase.PageContentOrDefault(ctx, d.Owners, ownerID)
		if err != nil {
			return nil, pageErr(err)
		}
		// 覆盖式合并:入参里出现的字段盖掉当前值,没出现的保持原样。
		if uerr := json.Unmarshal(raw, &content); uerr != nil {
			return nil, fp.BadInput("invalid page content: " + uerr.Error())
		}
		saved, serr := usecase.SavePageContent(ctx, d.Pins, ownerID, &content)
		if serr != nil {
			return nil, pageErr(serr)
		}
		return joinedPageView(ctx, d, ownerID, &saved)
	}
}

// joinedPageView —— pin 的 id 连上它在语料里的标题 / 摘要 / 地址。每个面拿到的都是这一份。
func joinedPageView(
	ctx context.Context, d PageOpsDeps, ownerID string, content *entity.PageContent,
) (json.RawMessage, error) {
	view, err := usecase.BuildOwnerPageView(
		ctx, usecase.PageDeps{Owners: d.Pins.Owners, Wiki: d.Pins.Wiki}, ownerID, content,
	)
	if err != nil {
		return nil, pageErr(err)
	}
	out, merr := json.Marshal(&view)
	if merr != nil {
		return nil, fp.OpErr("encode page view", merr)
	}
	return out, nil
}

func listPinnable(pins usecase.PagePinDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListPinnable(ctx, pins, ownerID)
		if err != nil {
			return nil, pageErr(err)
		}
		out := make([]pinCandidateOut, 0, len(rows))
		for i := range rows {
			out = append(out, pinCandidateOut{
				ID: rows[i].ID, Title: rows[i].Title, Path: rows[i].Path,
			})
		}
		return json.Marshal(out)
	}
}

type pinArgs struct {
	Section string `json:"section"`
	WikiID  string `json:"wiki_id"`
}

// pinWrite —— pin 和 unpin 只差调哪个用例;解参和回包形状同一份。
type pinWrite func(
	ctx context.Context, pins usecase.PagePinDeps, ownerID, section, wikiID string,
) ([]string, error)

func mutatePin(pins usecase.PagePinDeps, apply pinWrite) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parsePinArgs(raw)
		if perr != nil {
			return nil, perr
		}
		pinned, err := apply(ctx, pins, ownerID, in.Section, in.WikiID)
		if err != nil {
			return nil, pageErr(err)
		}
		return json.Marshal(pinnedOut{Section: in.Section, Pinned: nonNilStrings(pinned)})
	}
}

func parsePinArgs(raw json.RawMessage) (pinArgs, error) {
	var in pinArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs(
		[2]string{"section", in.Section}, [2]string{"wiki_id", in.WikiID})
}

type pageHandleArgs struct {
	Handle string `json:"handle"`
}

func setHandle(deps usecase.HandleDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in pageHandleArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		updated, err := usecase.UpdateOwnerHandle(ctx, deps, ownerID, in.Handle)
		if err != nil {
			return nil, pageErr(err)
		}
		return json.Marshal(toOwnerAddressOut(&updated))
	}
}

type pagePublicURLArgs struct {
	PublicURL string `json:"public_url"`
}

func setPublicURL(deps usecase.PublicURLDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in pagePublicURLArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		updated, err := usecase.UpdateOwnerPublicURL(ctx, deps, ownerID, in.PublicURL)
		if err != nil {
			return nil, pageErr(err)
		}
		return json.Marshal(toOwnerAddressOut(&updated))
	}
}

func toOwnerAddressOut(o *entity.Owner) ownerAddressOut {
	return ownerAddressOut{OwnerID: o.ID, Handle: o.Handle, PublicURL: o.PublicURL}
}

// pageErr —— 域的哨兵 → 协议无关的类别。code 是已经发出去的契约,显式钉住。
func pageErr(err error) error {
	for _, c := range pageErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	// 校验失败:域已经写好了给人看的话(handle 的字符范围之类),原样带出去 ——
	// 这一层再写一遍就成了第二份文案。
	if errors.Is(err, apierr.ErrEmptyField) {
		return fp.BadInput(err.Error())
	}
	return fp.OpErr("page op", err)
}

var pageErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{entity.ErrPinUnpublished, func() error {
		return fp.Coded(fp.BadInput(
			"that entry is not published — publish it first, then pin it"), "pin_unpublished")
	}},
	{entity.ErrPinNotFound, func() error {
		return fp.Coded(fp.NotFound("wiki entry not found"), "pin_not_found")
	}},
	{entity.ErrHandleTaken, func() error {
		return fp.Coded(fp.Conflict("handle already taken"), "handle_taken")
	}},
	{usecase.ErrPublicURLInvalid, func() error {
		return fp.Coded(fp.BadInput(
			"public_url must be http(s):// with a non-empty host"), "public_url_invalid")
	}},
	{corpus.ErrWikiNotFound, func() error {
		return fp.Coded(fp.NotFound("wiki entry not found"), "pin_not_found")
	}},
}
