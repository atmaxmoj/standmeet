// credform.go —— 凭据表单与上传内容的边界类型。CredentialForm 直接 alias connector 层的同名类型：
// 形状本就 1:1（派生逻辑在 DeriveCredentialForm），手抄一份只会让"加字段漏一处"——正是
// apiKey 字段那个 bug 的土壤。alias 让 routes 仍只 import connectorsvc（不碰 connector），又免去拷字段。
// 真要分叉时再 un-alias。

package connector

// CredentialForm —— 一个连接器要 owner 填的凭据表单（认证类型 + 字段 key + oauth2 scope + scheme 列表）。

// UploadedSpec —— 上传/编辑连接器的内容（spec + JSONata binding + 选中的 authScheme +
// 是否把 raw ops 暴露成 agent 工具）。
type UploadedSpec struct {
	AuthScheme         string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}
