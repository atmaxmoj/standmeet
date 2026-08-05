// capreg_mcp_app_session.go —— 数据型内建插件的可信 session 上下文构造(从 capreg_mcp_app.go
// 拆出,守 max-lines ≤350)。sessionMetaFor 只给声明了 HostSockets 的内建拿(经 tool-call
// `_meta` 递进它自己的沙箱,再转宿主窄 socket API);第三方 / 无 socket 插件 → nil,防泄漏。

package capload

import (
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// sessionMetaFor —— 会回头找宿主(manifest 点了 host op)的能力才拿到可信 session 上下文。
// 没点过(ask_visitor / 第三方)→ nil。
func sessionMetaFor(m *mcpplugin.Manifest, in *capreg.AssembleInput) *mcpclient.SessionContext {
	if m.Transport.Sandbox == nil || len(m.Transport.Sandbox.HostOps) == 0 {
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
		// 这个能力自己那份 per-role 配置(冻在 snapshot 里)。只给它自己的 ——
		// 一个插件不该看见别的能力的设置。
		CapConfig: capConfigOf(in, m.ID),
	}
}

// capConfigOf —— 这个 session 的 role 上,**这一个能力**的配置。没有 role / 这个能力没有
// per-role 配置 → nil(沙箱那侧读到"没设过",走它自己的默认值)。
//
// 按能力挑出来而不是整张表递过去:递整张表的话,一个第三方插件能读到 owner 给别的能力配的东西。
func capConfigOf(in *capreg.AssembleInput, capID string) json.RawMessage {
	if in.RoleSnapshot == nil {
		return nil
	}
	return in.RoleSnapshot.CapConfig()[capID]
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
