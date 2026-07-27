// sessions_guard.go —— #169 访问码兑换的失败锁定接线(从 sessions.go 拆出守 max-lines)。
// createSession / codeIntro 两个 handler 委托到这里:锁定检查 + 兑换 + 失败/成功记账,
// 让 handler 本身保持 routes-cyclo ≤ 3。

package public

import (
	"context"
	"errors"
	"net/http"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

// guardedIssueSession —— code-tier 锁定 → 兑换 → 记账。返 (res, true)=可写成功响应;
// (_, false)=已写(429 锁定 / error 响应)。
func (h *Handlers) guardedIssueSession(
	w http.ResponseWriter, r *http.Request, req *createSessionRequest,
) (conversation.IssueCodeSessionResult, bool) {
	ip := clientIP(r)
	if h.codeLocked(w, r, req.Mode, req.CaptchaToken, ip) {
		return conversation.IssueCodeSessionResult{}, false
	}
	res, err := dispatchIssueSession(r.Context(), &h.Visitor, req, ip)
	if err != nil {
		h.noteCodeFail(r.Context(), ip, err)
		handleVisitorErr(h.Log, w, err)
		return conversation.IssueCodeSessionResult{}, false
	}
	h.CodeGuard.Reset(r.Context(), ip)
	return res, true
}

// guardedIntro —— 同上,针对名字选择器 pre-issue peek(同样是 code 枚举 oracle,同守卫)。
func (h *Handlers) guardedIntro(
	w http.ResponseWriter, r *http.Request, req *codeIntroRequest,
) (conversation.CodeIntroResult, bool) {
	ip := clientIP(r)
	if h.codeLocked(w, r, "code", req.CaptchaToken, ip) {
		return conversation.CodeIntroResult{}, false
	}
	res, err := conversation.CodeIntro(r.Context(), &h.Visitor, req.Code)
	if err != nil {
		h.noteCodeFail(r.Context(), ip, err)
		handleVisitorErr(h.Log, w, err)
		return conversation.CodeIntroResult{}, false
	}
	h.CodeGuard.Reset(r.Context(), ip)
	return res, true
}

// codeLocked —— code-tier 且该 IP 已锁 → 写 429 并返 true;否则 false 放行。
func (h *Handlers) codeLocked(
	w http.ResponseWriter, r *http.Request, mode, captchaToken, ip string,
) bool {
	if mode != "code" {
		return false
	}
	if !h.CodeGuard.Locked(r.Context(), ip, captchaToken) {
		return false
	}
	writeError(h.Log, w, envCodeLocked())
	return true
}

// noteCodeFail —— 只在**无效码**时累计失败(暴力枚举信号);过期/其他错误不计。
func (h *Handlers) noteCodeFail(ctx context.Context, ip string, err error) {
	if errors.Is(err, access.ErrCodeInvalid) {
		h.CodeGuard.RecordFail(ctx, ip)
	}
}
