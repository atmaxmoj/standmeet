// credform.go —— 凭据表单与上传内容的边界类型。CredentialForm 直接 alias connector 层的同名类型：
// 形状本就 1:1（派生逻辑在 DeriveCredentialForm），手抄一份只会让"加字段漏一处"——正是
// apiKey 字段那个 bug 的土壤。alias 让 routes 仍只 import connectorsvc（不碰 connector），又免去拷字段。
// 真要分叉时再 un-alias。

package connector

// CredentialForm —— 一个连接器要 owner 填的凭据表单（认证类型 + 字段 key + oauth2 scope + scheme 列表）。

// UploadedSpec —— 上传/编辑连接器的内容（spec + JSONata binding + 选中的 authScheme +
// 是否把 raw ops 暴露成 agent 工具）。
//
// BaseURL —— owner 手填的 base URL。真厂商文档常常不带可用的 `servers`（Cal.com v2 写的是
// 显式的 `"servers": []`），而 owner 不该去手改 vendor 的文件（F-C-22）。它在 Create/Update
// 的入口就被并进 Spec，**不往下游传**：存下去的那份 spec 自己就有 servers，于是运行时、
// 出站校验、凭据表单派生都只看到一份普通的 spec。
// URL —— spec 是「从 URL 抓来的」时,owner 手上**没有正文** —— 正文只在后端那次抓取里存在过
// (F-C-25:面板据此出了候选,装配却送出一份空 spec)。所以建/改时把来源 URL 一并送来,由这一层
// 重新抓一次:抓取本来就带出站守卫,也免得把 1.47 MB 的厂商文档送去浏览器再送回来。
// Spec 非空时以 Spec 为准,URL 只是没有正文时的来源。
type UploadedSpec struct {
	AuthScheme         string
	BaseURL            string
	URL                string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}
