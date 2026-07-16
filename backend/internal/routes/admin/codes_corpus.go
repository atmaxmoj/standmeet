// codes_corpus.go —— corpus 准入的 **per-code 收窄面**（ACL 三类里的 corpus 那类的 owner 读写）。
// 挂在 /codes 下（见 MountCodes），同 denials 的子资源形态；owner-scope 复用 scopedCodeID。
//
// role 授的是「这个受众」能读的正列表；一张码可以再减 ——「这一次邀约」不该看的。典型：一个通用
// role 授了整个 subjectivity（stance 都要给），但给外部的那张码收回 `subjectivity://cv`（record
// 笔记：真名/学历/雇主）。
//
// GET 同时返回**继承来的 role 正列表**和**本码收回的**，让 UI 能如实显示「继承 / 已收回」，而不是
// 逼 owner 自己去对照两页（同 codes_waypoints 的 inherited/overrides/effective）。

package admin

import (
	"encoding/json"
	"net/http"
)

// codeCorpusView —— owner 视角的一张 code 的 corpus 准入全景。
type codeCorpusView struct {
	// Granted —— 这张 code 的 role 授的正列表（继承来的；code 改不了它，只能减）。
	Granted []string `json:"granted"`
	// Denied —— 这张 code 收回的 glob（空 = 完全继承 role）。
	Denied []string `json:"denied"`
}

type putCodeCorpusRequest struct {
	Denied []string `json:"denied"`
}

func (h *Handlers) getCodeCorpus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codeID, ok := h.scopedCodeID(w, r)
		if !ok {
			return
		}
		denied, err := h.CodesAdmin.Denials.ListCorpusURIs(r.Context(), codeID)
		if err != nil {
			h.Log.Error("list code corpus denials", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, codeCorpusView{
			Granted: h.inheritedCorpusURIs(r, codeID),
			Denied:  nonNilStrings(denied),
		})
	}
}

func (h *Handlers) putCodeCorpus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codeID, ok := h.scopedCodeID(w, r)
		if !ok {
			return
		}
		h.runPutCodeCorpus(w, r, codeID)
	}
}

// runPutCodeCorpus —— owner-scope 通过后的写入：解 body → 存收回列表 → 回读全景。
// 不校验 glob 语法：跟 role 的正列表同一种语言，写错了顶多少读到东西（**纯减法，写错不会泄露**）。
func (h *Handlers) runPutCodeCorpus(w http.ResponseWriter, r *http.Request, codeID string) {
	var req putCodeCorpusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return
	}
	if err := h.CodesAdmin.Denials.SetCorpusURIs(r.Context(), codeID, req.Denied); err != nil {
		h.Log.Error("set code corpus denials", logErrKey, err)
		writeError(h.Log, w, serverErr())
		return
	}
	h.getCodeCorpus()(w, r)
}

// inheritedCorpusURIs —— 这张 code 的 role 授的正列表（读不到 → 空；GET 不因此 500，收回层仍可读写）。
func (h *Handlers) inheritedCorpusURIs(r *http.Request, codeID string) []string {
	code, err := h.CodesAdmin.Codes.GetByID(r.Context(), codeID)
	if err != nil {
		return []string{}
	}
	role, rerr := h.CodesAdmin.Roles.GetByID(r.Context(), code.OwnerID, code.AssumedRoleID)
	if rerr != nil {
		return []string{}
	}
	return nonNilStrings(role.CorpusURIs())
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
