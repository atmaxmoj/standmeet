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
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// guardedIssueSession —— code-tier 锁定 → 兑换 → 记账。返 (res, true)=可写成功响应;
// (_, false)=已写(429 锁定 / error 响应)。
func (h *Handlers) guardedIssueSession(
	w http.ResponseWriter, r *http.Request, req *createSessionRequest,
) (conversation.IssueCodeSessionResult, bool) {
	ip := clientIP(r)
	if h.preIssueBlocked(w, r, req, ip) {
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

// preIssueBlocked —— 签发前的两道拦截合成一个（各自在拦下时已写好响应）：
// ① code 兑换失败锁定（429）② embed 来源白名单（403）。合成一个是为了让 guardedIssueSession
// 的圈复杂度留在 3 以内 —— 顺序即优先级：先锁定，再来源。
func (h *Handlers) preIssueBlocked(
	w http.ResponseWriter, r *http.Request, req *createSessionRequest, ip string,
) bool {
	if h.codeLocked(w, r, req.Mode, req.CaptchaToken, ip) {
		return true
	}
	return h.embedAuthBlocked(w, r, req)
}

// embedAuthBlocked —— 带 embed_token 就验 widget 的 JWT（code 明文不进客户端）；否则是**明文 code
// 直连**——不受 origin 限制（白名单只 gate widget/token 那条路）。明文直连跟没有 embed 时一样：
// QR / 分享链接落到实例页、直接粘码都能用，泄露了就 revoke（[[embed-direct-code-stays-open]]）。
func (h *Handlers) embedAuthBlocked(
	w http.ResponseWriter, r *http.Request, req *createSessionRequest,
) bool {
	if req.EmbedToken != "" {
		return h.embedTokenBlocked(w, r, req)
	}
	return false
}

// embedTokenBlocked —— 验 JWT。通过 → 把它暴露的 code 填进 req（转成 code 模式），放行；
// 失败 → 写 401/403 并拦下。code 明文只在这一步、服务端拿到（req 从没带过它）。
func (h *Handlers) embedTokenBlocked(
	w http.ResponseWriter, r *http.Request, req *createSessionRequest,
) bool {
	code, err := access.VerifyEmbedToken(
		r.Context(), h.embedTokenDeps(), req.EmbedToken, r.Header.Get("Origin"))
	if err != nil {
		handleVisitorErr(h.Log, w, err)
		return true
	}
	req.Code = code
	req.Mode = "code"
	return false
}

func (h *Handlers) embedTokenDeps() access.EmbedTokenDeps {
	return access.EmbedTokenDeps{Embeds: h.Embeds, Nonce: h.EmbedNonce, Log: h.Log}
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
	writeError(h.Log, w, h.codeLockedEnvelope())
	return true
}

// codeLockedEnvelope —— 说哪一句，取决于这台实例此刻给不给得出那条出路。
func (h *Handlers) codeLockedEnvelope() apierr.Envelope {
	if h.CodeGuard.HasLift() {
		return envCodeLockedCaptcha()
	}
	return envCodeLockedWait()
}

// noteCodeFail —— 只在**无效码**时累计失败(暴力枚举信号);过期/其他错误不计。
func (h *Handlers) noteCodeFail(ctx context.Context, ip string, err error) {
	if errors.Is(err, access.ErrCodeInvalid) {
		h.CodeGuard.RecordFail(ctx, ip)
	}
}
