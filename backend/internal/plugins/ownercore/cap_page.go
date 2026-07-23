// cap_page.go —— Phase E-14b: owner-side page.update_handle parity tool。
// owner-only。让 AI 在 Claude Code 直接调 page.update_handle("new-handle")
// 改 owner 的 public handle (跟 /admin/account "change handle" 同 path)。
//
// 命名 page.* 而不是 owner.* —— owner 资源散在多处 (page handle / SEO
// settings / AI provider)，page.update_handle 专指 visitor 看到的 URL prefix。

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

const capPageBundle = "page.bundle"

// pageContentStore —— owner page_content 读写（避开直接 import postgres.OwnerRepo）。
type pageContentStore interface {
	GetPageContent(ctx context.Context, ownerID string) (domain.PageContent, error)
	UpsertPageContent(
		ctx context.Context, ownerID string, in *domain.PageContent,
	) (domain.PageContent, error)
}

type pageCapability struct {
	pages     pageContentStore
	handle    *usecases.HandleDeps
	publicURL usecases.PublicURLDeps
	pins      usecases.PagePinDeps
	log       *slog.Logger
}

func newPageCapability(
	handle *usecases.HandleDeps, pages pageContentStore,
	publicURL usecases.PublicURLDeps, pins usecases.PagePinDeps, log *slog.Logger,
) *pageCapability {
	return &pageCapability{
		handle: handle, pages: pages, publicURL: publicURL, pins: pins, log: log,
	}
}

func (*pageCapability) ID() string          { return capPageBundle }
func (*pageCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*pageCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*pageCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*pageCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *pageCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.updateHandleBinding(), c.getBinding(), c.putBinding(), c.setPublicURLBinding(),
		c.pinBinding(), c.unpinBinding(),
	}
}

func (c *pageCapability) updateHandleBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "page.update_handle",
		Description: "Change owner's public handle (URL prefix). New handle must be " +
			"2-64 chars of a-z0-9-. Old handle remains as alias (handle_aliases table) " +
			"so existing access codes / QR URLs keep working.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"handle":{"type":"string",
					"description":"New handle, 2-64 chars of a-z0-9-."}
			},
			"required":["handle"]
		}`),
		Handler: c.handleUpdateHandle,
	}
}

type updateHandleArgsWire struct {
	Handle string `json:"handle"`
}

func (c *pageCapability) handleUpdateHandle(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args updateHandleArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.Handle == "" {
		return capreg.MCPError("handle is required")
	}
	owner, err := usecases.UpdateOwnerHandle(ctx, *c.handle, ownerID, args.Handle)
	if err != nil {
		return updateHandleErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "page.update_handle", map[string]string{
		"owner_id": owner.ID, "handle": owner.Handle,
	})
}

func updateHandleErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, usecases.ErrEmptyField) {
		return capreg.MCPError("handle must be 2-64 chars of a-z0-9-")
	}
	if errors.Is(err, domain.ErrHandleTaken) {
		return capreg.MCPError("handle already taken")
	}
	log.Error("cap page.update_handle", "err", err)
	return capreg.MCPError("update handle failed")
}

// ───── page.get ─────────────────────────────────────────────────

func (c *pageCapability) getBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "page.get",
		Description: "Return the owner's public page as the visitor sees it: hero prose, " +
			"where, contact, and the pinned insights/projects joined to their corpus entries " +
			"(title + excerpt + path). Pin lists are edited via page.pin / page.unpin.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleGet,
	}
}

func (c *pageCapability) handleGet(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	content, err := c.pages.GetPageContent(ctx, ownerID)
	if err != nil {
		if !errors.Is(err, domain.ErrPageNotFound) {
			c.log.Error("cap page.get", "err", err)
			return capreg.MCPError("page.get failed")
		}
		content = usecases.DefaultPageContent(ownerID)
	}
	// join 成渲染视图 —— AI 看到的和访客一致(设计:page.get 返 joined)。
	view, verr := usecases.BuildPageContentView(ctx, usecases.PageDeps{
		Owners: c.pins.Owners, Wiki: c.pins.Wiki,
	}, ownerID, &content)
	if verr != nil {
		c.log.Error("cap page.get join", "err", verr)
		return capreg.MCPError("page.get failed")
	}
	return mcputil.MarshalResult(c.log, "page.get", &view)
}

// ───── page.put ─────────────────────────────────────────────────

func (c *pageCapability) putBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "page.put",
		Description: "Replace the owner's public page config: hero_prose, hero_examples, " +
			"where, contact. Insights/projects are corpus PIN lists and are NOT accepted " +
			"here — use page.pin / page.unpin (existing pins are preserved).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"hero_prose":{"type":"string"},
				"hero_examples":{"type":"array","items":{"type":"string"}},
				"where":{"type":"object"},
				"contact":{"type":"object"}
			}
		}`),
		Handler: c.handlePut,
	}
}

// pagePutWire —— page.put 的入参形:config 字段 only。pin 列表不在这条路上
// (单一维护点 PinToPage/UnpinFromPage 守不变量;整段替换会绕过它)。
type pagePutWire struct {
	HeroProse    string             `json:"hero_prose"`
	Where        domain.PageWhere   `json:"where"`
	Contact      domain.PageContact `json:"contact"`
	HeroExamples []string           `json:"hero_examples"`
}

func (c *pageCapability) handlePut(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var body pagePutWire
	if err := json.Unmarshal(raw, &body); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	current, err := c.pages.GetPageContent(ctx, ownerID)
	if err != nil {
		if !errors.Is(err, domain.ErrPageNotFound) {
			c.log.Error("cap page.put load", "err", err)
			return capreg.MCPError("page.put failed")
		}
		current = usecases.DefaultPageContent(ownerID)
	}
	current.OwnerID = ownerID
	current.HeroProse = body.HeroProse
	current.HeroExamples = body.HeroExamples
	current.Where = body.Where
	current.Contact = body.Contact
	saved, uerr := c.pages.UpsertPageContent(ctx, ownerID, &current)
	if uerr != nil {
		c.log.Error("cap page.put", "err", uerr)
		return capreg.MCPError("page.put failed")
	}
	return mcputil.MarshalResult(c.log, "page.put", &saved)
}

// ───── page.set_public_url ──────────────────────────────────────

func (c *pageCapability) setPublicURLBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "page.set_public_url",
		Description: "Set the deployment's canonical public URL (used for QR codes and SEO " +
			"canonical links). Must be http(s):// with a non-empty host.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{"public_url":{"type":"string",
				"description":"Canonical public URL, e.g. https://me.example.com."}},
			"required":["public_url"]
		}`),
		Handler: c.handleSetPublicURL,
	}
}

type setPublicURLArgsWire struct {
	PublicURL string `json:"public_url"`
}

func (c *pageCapability) handleSetPublicURL(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args setPublicURLArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	owner, err := usecases.UpdateOwnerPublicURL(ctx, c.publicURL, ownerID, args.PublicURL)
	if err != nil {
		return setPublicURLErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "page.set_public_url", map[string]string{
		"owner_id": owner.ID, "public_url": owner.PublicURL,
	})
}

func setPublicURLErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, usecases.ErrEmptyField) {
		return capreg.MCPError("public_url is required")
	}
	if errors.Is(err, usecases.ErrPublicURLInvalid) {
		return capreg.MCPError("public_url must be http(s):// with a non-empty host")
	}
	log.Error("cap page.set_public_url", logErrKey, err)
	return capreg.MCPError("page.set_public_url failed")
}
