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
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// CapabilityAdminDeps —— /capabilities handler 依赖。Registry 给 origin + 全
// capability 列表；Settings 读/写 owner-enable；Skills 删 owner-origin 条目；
// Calendar/Mail 读 connector 依赖状态。
type CapabilityAdminDeps struct {
	Registry *capreg.Registry
	Settings *postgres.CapabilityRepo
	Skills   *postgres.SkillRepo
	Calendar *postgres.CalendarRepo
	Mail     *postgres.MailRepo
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
	Origin     string             `json:"origin"`
	Kind       string             `json:"kind"`
	Enabled    bool               `json:"enabled"`
	Deletable  bool               `json:"deletable"`
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
	skills   []domain.Skill
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

// registryRows —— 每个注册的 capability 一行（kind=capability）。origin 来自
// registry；enabled = 没被 owner 关掉；deletable 由 origin 决定（builtin 不可删）。
func (h *Handlers) registryRows(cc *capabilityContext) []capabilityRowResp {
	caps := h.CapabilitiesAdmin.Registry.List()
	out := make([]capabilityRowResp, 0, len(caps))
	for _, c := range caps {
		id := c.ID()
		origin, _ := h.CapabilitiesAdmin.Registry.OriginOf(id)
		out = append(out, capabilityRowResp{
			ID:         id,
			Origin:     string(origin),
			Kind:       "capability",
			Enabled:    !cc.disabled[id],
			Deletable:  origin.Deletable(),
			Dependency: dependencyFor(id, cc),
		})
	}
	return out
}

// dependencyFor —— capability 依赖的 connector 状态（目前只有 calendar.book
// 依赖 Google Calendar）。无依赖返 nil。
func dependencyFor(id string, cc *capabilityContext) *capDependencyResp {
	if id == "calendar.book" {
		return &capDependencyResp{Name: "Google Calendar", Connected: cc.gcalConn}
	}
	return nil
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
func skillRows(cc *capabilityContext) []capabilityRowResp {
	out := make([]capabilityRowResp, 0, len(cc.skills))
	for i := range cc.skills {
		s := &cc.skills[i]
		if s.IsBuiltin {
			continue // 内建 skill 不算 owner-origin（不可删）
		}
		out = append(out, capabilityRowResp{
			ID: s.ID, Origin: string(capreg.OriginOwner), Kind: "skill",
			Enabled: !cc.disabled[s.ID], Deletable: true,
		})
	}
	return out
}

func (h *Handlers) calendarConnected(ctx context.Context, ownerID string) bool {
	conn, err := h.CapabilitiesAdmin.Calendar.GetConnector(ctx, ownerID, domain.CalendarProvider)
	if err != nil {
		return false
	}
	return conn.Connected()
}

func (h *Handlers) mailConnected(ctx context.Context, ownerID string) bool {
	conn, err := h.CapabilitiesAdmin.Mail.GetConnector(ctx, ownerID, domain.MailProvider)
	if err != nil {
		return false
	}
	return conn.Connected()
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
		err := h.CapabilitiesAdmin.Settings.SetEnabled(r.Context(), ownerID, id, req.Enabled)
		if err != nil {
			h.Log.Error("set capability enabled", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, map[string]bool{"ok": true})
	}
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
