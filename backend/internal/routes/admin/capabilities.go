// capabilities.go —— Phase H 管理面 /api/admin/capabilities：列全部
// capability + connector + skill，每行带 origin 徽章 + owner-enable 开关 +
// 依赖的 connector 状态。
//
//   GET    /api/admin/capabilities        → 列全部（P.5）
//   PATCH  /api/admin/capabilities/{id}    → {enabled} owner-enable 开关（P.7：builtin 可关）
//   DELETE /api/admin/capabilities/{id}    → 仅 owner-origin 可删（P.6），否则 4xx
//
// origin 决定存在性（可删性）+ enabled 决定可用性（访客 session 是否装配）。
// enabled 闸由 capreg.EnableGate（读 capability_settings）在装配时统一施加。

package admin

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// CapabilityAdminDeps —— /capabilities handler 依赖。Registry 给 origin + 全
// capability 列表；Settings 读/写 owner-enable；Skills 删 owner-origin 条目；
// Calendar/Mail 读 connector 依赖状态。
type CapabilityAdminDeps struct {
	Registry   *capreg.Registry
	Settings   *postgres.CapabilityRepo
	Skills     *marketplace.SkillRepo
	Connectors *connector.Repo
}

// connector 行的稳定 ID（kind=connector）。
const (
	connectorGCalID = "connector.google-calendar"
	connectorMailID = "connector.smtp"
)

// MountCapabilities 挂 /capabilities 子路由。
func (h *Handlers) MountCapabilities(r chi.Router) {
	r.Route("/capabilities", func(r chi.Router) {
		r.Get("/", h.listCapabilities())
		r.Patch("/{id}", h.patchCapability())
		r.Delete("/{id}", h.deleteCapability())
	})
}

// ───── wire types ─────────────────────────────────────────────

type capDependencyResp struct {
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
}

type capabilityRowResp struct {
	Dependency *capDependencyResp `json:"dependency,omitempty"`
	ID         string             `json:"id"`
	// Title —— 人类可读显示名（#109/#110 dock 按钮下拉 label 透传它）。能力没实现 Titled → 空。
	Title     string `json:"title,omitempty"`
	Origin    string `json:"origin"`
	Kind      string `json:"kind"`
	Enabled   bool   `json:"enabled"`
	Deletable bool   `json:"deletable"`
}

// capTitle —— 能力实现 capreg.Titled 就取它的 title（#109/#110 dock label），否则空。
func capTitle(c capreg.Capability) string {
	if t, ok := c.(capreg.Titled); ok {
		return t.Title()
	}
	return ""
}

type capabilitiesListResp struct {
	Capabilities []capabilityRowResp `json:"capabilities"`
}

// ───── GET ────────────────────────────────────────────────────

func (h *Handlers) listCapabilities() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := h.assembleCapabilityRows(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("list capabilities", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, capabilitiesListResp{Capabilities: rows})
	}
}

// capabilityContext —— 装配一次列表所需的 IO 结果（owner 关掉的集合 +
// connector 状态 + owner skills）。
type capabilityContext struct {
	disabled map[string]bool
	skills   []marketplace.Skill
	gcalConn bool
	mailConn bool
}

func (h *Handlers) assembleCapabilityRows(
	ctx context.Context, ownerID string,
) ([]capabilityRowResp, error) {
	cc, err := h.loadCapabilityContext(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	rows := h.registryRows(&cc)
	rows = append(rows, connectorRows(&cc)...)
	rows = append(rows, skillRows(&cc)...)
	return rows, nil
}

func (h *Handlers) loadCapabilityContext(
	ctx context.Context, ownerID string,
) (capabilityContext, error) {
	disabled, derr := h.CapabilitiesAdmin.Settings.DisabledSet(ctx, ownerID)
	if derr != nil {
		return capabilityContext{}, derr
	}
	skills, serr := h.CapabilitiesAdmin.Skills.ListByOwner(ctx, ownerID)
	if serr != nil {
		return capabilityContext{}, serr
	}
	return capabilityContext{
		disabled: disabled,
		gcalConn: h.calendarConnected(ctx, ownerID),
		mailConn: h.mailConnected(ctx, ownerID),
		skills:   skills,
	}, nil
}

// registryRows —— 每个有访客面的 capability 一行（kind=capability）。
//
// 本面板是**访客可用性**平面：owner-enable 闸只作用于 visitor 装配
// (AssembleVisitor)，所以只列 visitor-facing 能力（visitor_only / both）。
// owner-only 能力（seo / writings / prompts… 是 owner 自己 AI 客户端的工具）
// 不在此列 —— 给它们放开关纯属 no-op。给 owner MCP 也加闸是另一件事（需要把
// owner 上下文穿进 OwnerMCPBindings），本期不做。
func (h *Handlers) registryRows(cc *capabilityContext) []capabilityRowResp {
	caps := h.CapabilitiesAdmin.Registry.List()
	out := make([]capabilityRowResp, 0, len(caps))
	for _, c := range caps {
		if c.Shape() == capreg.ShapeOwnerOnly {
			continue
		}
		id := c.ID()
		origin, _ := h.CapabilitiesAdmin.Registry.OriginOf(id)
		out = append(out, capabilityRowResp{
			ID:         id,
			Title:      capTitle(c),
			Origin:     string(origin),
			Kind:       "capability",
			Enabled:    !cc.disabled[id],
			Deletable:  origin.Deletable(),
			Dependency: dependencyFor(id, cc),
		})
	}
	return out
}

// dependencyFor —— capability 依赖的 connector 状态。calendar.book → 日历品类槽；mail.send →
// mail 品类槽（connected 由 active 连接器决定，不绑具体 provider）。无依赖返 nil。
func dependencyFor(id string, cc *capabilityContext) *capDependencyResp {
	switch id {
	case "calendar.book":
		return &capDependencyResp{Name: "Google Calendar", Connected: cc.gcalConn}
	case "mail.send":
		return &capDependencyResp{Name: "Mail", Connected: cc.mailConn}
	default:
		return nil
	}
}

// connectorRows —— connector 类型各一行（kind=connector，origin=managed，
// 平台托管，可关不可删）。enabled 透出连接状态。
func connectorRows(cc *capabilityContext) []capabilityRowResp {
	return []capabilityRowResp{
		{
			ID: connectorGCalID, Origin: string(capreg.OriginManaged), Kind: "connector",
			Enabled: cc.gcalConn, Deletable: false,
			Dependency: &capDependencyResp{Name: "Google Calendar", Connected: cc.gcalConn},
		},
		{
			ID: connectorMailID, Origin: string(capreg.OriginManaged), Kind: "connector",
			Enabled: cc.mailConn, Deletable: false,
			Dependency: &capDependencyResp{Name: "SMTP", Connected: cc.mailConn},
		},
	}
}

// skillRows —— owner author 的 skill 各一行（kind=skill，origin=owner，可删）。
// enabled 透出 skill 自己的全局开关（marketplace.Skill.Enabled —— skill runner 真读
// 的那个），不是 capability_settings：skill 不是 registry capability，走自己那套
// enable 机制（SetSkillEnabled），别拿 owner-enable 闸的表当真值。
func skillRows(cc *capabilityContext) []capabilityRowResp {
	out := make([]capabilityRowResp, 0, len(cc.skills))
	for i := range cc.skills {
		s := &cc.skills[i]
		if s.IsBuiltin {
			continue // 内建 skill 不算 owner-origin（不可删）
		}
		out = append(out, capabilityRowResp{
			ID: s.ID, Origin: string(capreg.OriginOwner), Kind: "skill",
			Enabled: s.Enabled, Deletable: true,
		})
	}
	return out
}

func (h *Handlers) calendarConnected(ctx context.Context, ownerID string) bool {
	return h.categoryConnected(ctx, ownerID, "calendar")
}

func (h *Handlers) mailConnected(ctx context.Context, ownerID string) bool {
	return h.categoryConnected(ctx, ownerID, "mail")
}

// categoryConnected —— #155：某品类是否有 active 且已连的连接器（统一 owner_connectors）。
func (h *Handlers) categoryConnected(ctx context.Context, ownerID, category string) bool {
	ok, err := h.CapabilitiesAdmin.Connectors.CategoryConnected(ctx, ownerID, category)
	if err != nil {
		return false
	}
	return ok
}

// ───── PATCH ──────────────────────────────────────────────────

type patchCapabilityReq struct {
	Enabled bool `json:"enabled"`
}

func (h *Handlers) patchCapability() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		id := chi.URLParam(r, "id")
		var req patchCapabilityReq
		if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		if err := h.applyCapabilityEnabled(r.Context(), ownerID, id, req.Enabled); err != nil {
			h.Log.Error("set capability enabled", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}

// applyCapabilityEnabled —— 开关写到**真正读它的**那张表：registry capability →
// capability_settings（owner-enable 闸读它）；owner skill → skill.Enabled
// （skill runner 读它，不是 capability_settings）。connector 行前端锁死、不 PATCH。
func (h *Handlers) applyCapabilityEnabled(
	ctx context.Context, ownerID, id string, enabled bool,
) error {
	if _, ok := h.CapabilitiesAdmin.Registry.OriginOf(id); ok {
		return h.CapabilitiesAdmin.Settings.SetEnabled(ctx, ownerID, id, enabled)
	}
	_, err := h.CapabilitiesAdmin.Skills.SetEnabled(ctx, ownerID, id, enabled)
	return err
}

// ───── DELETE ─────────────────────────────────────────────────

func (h *Handlers) deleteCapability() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		id := chi.URLParam(r, "id")
		if !h.capabilityDeletable(id) {
			writeError(h.Log, w, envBadReq("this capability is built in and cannot be deleted"))
			return
		}
		if err := h.CapabilitiesAdmin.Skills.Delete(r.Context(), ownerID, id); err != nil {
			h.Log.Error("delete capability", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
}

// capabilityDeletable —— 仅 owner-origin 可删（P.6）。registry cap（builtin/
// managed）与 connector 行一律拒；其余视作 owner skill ID。
func (h *Handlers) capabilityDeletable(id string) bool {
	if _, ok := h.CapabilitiesAdmin.Registry.OriginOf(id); ok {
		return false // 注册的 capability 都是 builtin/managed origin → 不可删
	}
	return !isConnectorRowID(id)
}

// isConnectorRowID —— connector kind 的稳定行 ID（不可删，断开而非删）。
func isConnectorRowID(id string) bool {
	return id == connectorGCalID || id == connectorMailID
}
