// capreg_mcp_app_session.go —— 数据型内建插件的可信 session 上下文构造(从 capreg_mcp_app.go
// 拆出,守 max-lines ≤350)。sessionMetaFor 只给声明了 HostSockets 的内建拿(经 tool-call
// `_meta` 递进它自己的沙箱,再转宿主窄 socket API);第三方 / 无 socket 插件 → nil,防泄漏。

package usecases

import (
	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
)

// sessionMetaFor —— 数据型内建(manifest 声明了 HostSockets)才拿到可信 session 上下文。
// 无 HostSockets(ask_visitor / 第三方)→ nil。
func sessionMetaFor(m *mcpplugin.Manifest, in *capreg.AssembleInput) *mcpclient.SessionContext {
	if m.Transport.Sandbox == nil || len(m.Transport.Sandbox.HostSockets) == 0 {
		return nil
	}
	return &mcpclient.SessionContext{
		OwnerID:        in.OwnerID,
		CodeID:         in.CodeID,
		ConversationID: in.ConversationID,
		Mode:           in.Mode,
		VisitorName:    in.Visitor.Name,
		VisitorEmail:   in.Visitor.Email,
		RoleID:         roleIDOf(in),
		CorpusURIs:     corpusURIsOf(in),
		CorpusDenials:  corpusDenialsOf(in),
	}
}

// roleIDOf —— 当前 session 的 role id。无 role(public/byoai)→ 空串。
func roleIDOf(in *capreg.AssembleInput) string {
	if in.RoleSnapshot == nil {
		return ""
	}
	return in.RoleSnapshot.RoleID()
}

// corpusDenialsOf —— code 从 role 正列表收回的 corpus glob(ACL 第三类)。无 role → 空。
func corpusDenialsOf(in *capreg.AssembleInput) []string {
	if in.RoleSnapshot == nil {
		return []string{}
	}
	return in.RoleSnapshot.DeniedCorpusURIs()
}

// corpusURIsOf —— 当前 session 的 corpus-ACL scope(role snapshot 的 URI glob 白名单),
// 给外置 retrieval 插件的 host op 重建 AllowsCorpus 用。无 role → 空。
func corpusURIsOf(in *capreg.AssembleInput) []string {
	if in.RoleSnapshot == nil {
		return []string{}
	}
	return in.RoleSnapshot.CorpusURIs()
}
