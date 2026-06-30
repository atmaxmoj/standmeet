// connectors_mail.go —— owner 的 mail 连接器自测端（POST /connectors/mail/test-send）：经 active
// mail 品类契约发一封，报 via_kind 证 mailer 不挑 kind。拆出 connectors.go 守 max-lines。

package admin

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

type mailTestSendReq struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
}

type mailTestSendResp struct {
	ViaKind string `json:"via_kind,omitempty"`
	Ok      bool   `json:"ok"`
}

// mailTestSend —— owner 自测：经 active mail 连接器（品类契约）发一封。报 via_kind 证 mailer 不挑 kind。
func (h *Handlers) mailTestSend() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		var body mailTestSendReq
		dec := json.NewDecoder(io.LimitReader(r.Body, maxCredBytes))
		if derr := dec.Decode(&body); derr != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		serr := h.ConnectorsAdmin.Mail.Send(r.Context(), ownerID,
			usecases.MailMessage{To: body.To, Subject: body.Subject, Body: body.Text})
		if serr != nil {
			// 自测发信失败 → {ok:false}，但要留痕：否则 SMTP 挂 / 认证错这类基建故障无声，运维查无可查。
			h.Log.Warn("connector mail test-send", logErrKey, serr)
			writeJSON(h.Log, w, mailTestSendResp{Ok: false})
			return
		}
		writeJSON(h.Log, w, mailTestSendResp{
			Ok: true, ViaKind: h.ConnectorsAdmin.MailKind(r.Context(), ownerID),
		})
	}
}
