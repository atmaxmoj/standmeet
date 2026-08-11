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
		CorpusScope:    corpusScopeOf(in),
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

// corpusScopeOf —— 当前 session 冻下的 corpus-ACL scope，**整块**序列化过线。
//
// 不在这里拆成"授了哪些 / 收回哪些"两个列表：那样每加一条准入规则就要在四个接缝上各抄一遍，
// 而漏抄的那一处不会编译失败（F-D-7 的修复第一次就是这么丢掉 published_only 的）。
// 无 role → 空 scope（什么都读不到），不是"不带这个字段"。
func corpusScopeOf(in *capreg.AssembleInput) json.RawMessage {
	if in.RoleSnapshot == nil {
		return emptyCorpusScope()
	}
	raw, err := json.Marshal(in.RoleSnapshot.CorpusScope())
	if err != nil {
		return emptyCorpusScope()
	}
	return raw
}

func emptyCorpusScope() json.RawMessage {
	return json.RawMessage(`{"granted":[],"denied":[],"published_only":false}`)
}
