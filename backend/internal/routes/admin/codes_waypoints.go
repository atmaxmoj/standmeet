// codes_waypoints.go —— ghost-steering 目的地的 **per-code 覆盖层** 的 owner 读写面。
// 挂在 /codes 下（见 MountCodes），同 denials 的子资源形态。owner-scope：先校验 code 属本 owner。
//
// 为什么是子资源而不是「更新整张 code」：codes 没有整体 update 路由（只有 quotas / revoke），
// 且覆盖层是独立一张表（code_waypoints）。GET 同时返回**继承来的 role 的**和**本码覆盖的**，
// 让 UI 能如实显示「继承 / 已覆盖」，而不是逼 owner 自己去对照两页。
//
// 合并语义在 domain.MergeWaypoints（同 waypoint_id → code 覆盖，新 id → 追加）；授权过滤仍在
// 冻结那刻由 FilterWaypointsByCorpus 执行 —— 这里不放松 feasibility floor。

package admin

import (
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/accessdomain"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// codeWaypointsView —— owner 视角的一张 code 的 steering 目的地全景。
type codeWaypointsView struct {
	// Inherited —— 这张 code 的 role 上配的（code 没覆盖时生效的那份）。
	Inherited []domain.Waypoint `json:"inherited"`
	// Overrides —— 这张 code 自己配的覆盖层（空 = 完全继承）。
	Overrides []domain.Waypoint `json:"overrides"`
	// Effective —— 合并后实际会冻进 snapshot 的（未经 corpus 过滤；过滤发生在发码/开会话时）。
	Effective []domain.Waypoint `json:"effective"`
}

type putCodeWaypointsRequest struct {
	Waypoints []domain.Waypoint `json:"waypoints"`
}

func (h *Handlers) getCodeWaypoints() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codeID, ok := h.scopedCodeID(w, r)
		if !ok {
			return
		}
		inherited := h.inheritedWaypoints(r, codeID)
		overrides, err := h.CodesAdmin.Codes.Waypoints(r.Context(), codeID)
		if err != nil {
			h.Log.Error("list code waypoints", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, codeWaypointsView{
			Inherited: nonNilWaypoints(inherited),
			Overrides: nonNilWaypoints(overrides),
			Effective: nonNilWaypoints(domain.MergeWaypoints(inherited, overrides)),
		})
	}
}

func (h *Handlers) putCodeWaypoints() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codeID, ok := h.scopedCodeID(w, r)
		if !ok {
			return
		}
		h.runPutCodeWaypoints(w, r, codeID)
	}
}

// runPutCodeWaypoints —— owner-scope 通过后的写入：解 body → 校验(domain 规则,同 role 面)
// → 存覆盖层 → 回读全景。成功时复用 GET 的响应，owner 立刻看到合并后的 effective。
func (h *Handlers) runPutCodeWaypoints(w http.ResponseWriter, r *http.Request, codeID string) {
	ws, ok := h.decodeWaypointsBody(w, r)
	if !ok {
		return
	}
	if err := h.CodesAdmin.Codes.SetWaypoints(r.Context(), codeID, ws); err != nil {
		h.Log.Error("set code waypoints", "err", err)
		writeError(h.Log, w, serverErr())
		return
	}
	h.getCodeWaypoints()(w, r)
}

// inheritedWaypoints —— 这张 code 的 role 上配的 waypoints（code 没覆盖时生效的那份）。
// 读不到 → 空（GET 不因此 500：覆盖层本身仍然可读可写）。
func (h *Handlers) inheritedWaypoints(r *http.Request, codeID string) []domain.Waypoint {
	code, err := h.CodesAdmin.Codes.GetByID(r.Context(), codeID)
	if err != nil {
		return []domain.Waypoint{}
	}
	role, rerr := h.CodesAdmin.Roles.GetByID(
		r.Context(), code.OwnerID, code.AssumedRoleID)
	if rerr != nil {
		return []domain.Waypoint{}
	}
	return role.Waypoints()
}

func nonNilWaypoints(w []domain.Waypoint) []domain.Waypoint {
	if w == nil {
		return []domain.Waypoint{}
	}
	return w
}

// attachCreateWaypoints —— 建码时随请求带的覆盖层（可空 = 完全继承 role）。
// 码已建成，覆盖层写失败只 warn —— 不把一张已经发出去的码回滚成 500；owner 可在
// PUT /codes/{id}/waypoints 重设。
func (h *Handlers) attachCreateWaypoints(
	r *http.Request, code *accessdomain.AccessCode, ws []domain.Waypoint,
) {
	if len(ws) == 0 {
		return
	}
	if err := h.CodesAdmin.Codes.SetWaypoints(r.Context(), code.ID, ws); err != nil {
		h.Log.Warn("set code waypoints on create", "err", err, "code_id", code.ID)
	}
}

// decodeWaypointsBody —— 解 body + domain 形态校验（同 role 面一条规则）。失败已写好响应。
func (h *Handlers) decodeWaypointsBody(
	w http.ResponseWriter, r *http.Request,
) ([]domain.Waypoint, bool) {
	var req putCodeWaypointsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return []domain.Waypoint{}, false
	}
	if err := domain.ValidateWaypoints(req.Waypoints); err != nil {
		writeError(h.Log, w, envBadReq(err.Error()))
		return []domain.Waypoint{}, false
	}
	return req.Waypoints, true
}
