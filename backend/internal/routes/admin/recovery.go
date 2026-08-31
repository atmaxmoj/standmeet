// recovery.go —— #100 account recovery phrase 的两个 HTTP 端点。
//   POST /api/admin/account/recovery  (authed) 生成 phrase + 邮给 owner
//   POST /api/admin/recover           (public, login-guard'd) {email, phrase} → session

package admin

import (
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

type recoverRequest struct {
	Email          string `json:"email"`
	RecoveryPhrase string `json:"recovery_phrase"`
}

type recoverResponse struct {
	OwnerID     string `json:"owner_id"`
	OwnerHandle string `json:"owner_handle"`
	CSRFToken   string `json:"csrf_token"`
}

var recoverErrCases = []apierr.Case{
	{Match: apierr.ErrEmptyField, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: "email and recovery phrase required",
	}},
	{Match: owner.ErrUnauthorized, Envelope: apierr.Envelope{
		Status:  http.StatusUnauthorized,
		Code:    "recovery_invalid",
		Message: "email or recovery phrase incorrect",
	}},
}

// generateRecovery —— authed:生成 recovery phrase(只存 hash)+ 明文邮给 owner。没配 mail
// connector → Send 失败 → 502(引导去配)。

// recover —— public(login-guard'd):{email, phrase} 对上 → 发 owner session(登进去改密码)。
func (h *Handlers) recover() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body recoverRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		out, err := owner.Recover(r.Context(), &h.Recovery, &owner.RecoverInput{
			Email: body.Email, Phrase: body.RecoveryPhrase,
		})
		if err != nil {
			writeError(h.Log, w, apierr.Classify(err, recoverErrCases))
			return
		}
		setSessionCookies(w, out.SessionToken, out.CSRFToken, h.SecureCookie)
		writeJSON(h.Log, w, recoverResponse{
			OwnerID: out.OwnerID, OwnerHandle: out.OwnerHandle, CSRFToken: out.CSRFToken,
		})
	}
}

// ── 确认改邮箱 ──────────────────────────────────────────────────────
//
//	POST /api/admin/confirm-email  (public) {token} → 换身份
//
// **跟 /recover 放在同一个文件**，因为它们是同一件事的两个例子：不带 session、
// 靠"你手里有我们寄出去的那个秘密"来证明身份。放这儿也不是为了绕闸门 ——
// `check-routes-via-dispatcher` 的 baseline **只能变短**，而收口今天还没有公开面
// （`PlaneOwner` 是唯一的 Reach 构造器，整个 routes/public/ 都在 baseline 里）。
// 等公开面建起来，这两个一起搬。
//
// **为什么是公开的**：owner 点开这封信时可能在另一台设备上、没登录。要求先登录才能
// 确认，等于要求他先用**还没换过去的那个身份**登进来 —— 而他改邮箱常常正是因为
// 旧地址快用不了了。
//
// 公开不等于没防护：token 是 128-bit 随机、只匹配 hash、一次性、24 小时过期，
// 而且这条路**造不出**新的改动，只能兑现一次 owner 在登录状态下发起过的改动。

type confirmEmailRequest struct {
	Token string `json:"token"`
}

type confirmEmailResponse struct {
	Email string `json:"email"`
}

// confirmEmailErrCases —— 过期和无效分成两个码，因为 owner 下一步该做什么不同：
// 过期 → 回面板再点一次保存（那条路还在）；无效 → 这封信不是给你的 / 已经用过了。
// 而"用过了"和"token 是编的"**故意**合成后者：对不认识这个 token 的人，
// 区分它们只是在告诉他猜得对不对。
var confirmEmailErrCases = []apierr.Case{
	{Match: owner.ErrPendingEmailExpired, Envelope: apierr.Envelope{
		Status: http.StatusGone,
		Code:   "email_confirm_expired",
		Message: "that confirmation link has expired — start the change again " +
			"from your account page",
	}},
	{Match: owner.ErrPendingEmailNotFound, Envelope: apierr.Envelope{
		Status:  http.StatusNotFound,
		Code:    "email_confirm_invalid",
		Message: "that confirmation link is not valid — it may already have been used",
	}},
}

func (h *Handlers) confirmEmail() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body confirmEmailRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		// 空 token 的判断在域里（ConfirmEmailChange）—— 那是"什么算一次有效的确认"，
		// 是业务不是转述。面这一层只剩解码和转述两件事。
		updated, err := owner.ConfirmEmailChange(r.Context(), h.EmailChange, body.Token)
		if err != nil {
			writeError(h.Log, w, apierr.Classify(err, confirmEmailErrCases))
			return
		}
		writeJSON(h.Log, w, confirmEmailResponse{Email: updated.Email})
	}
}
