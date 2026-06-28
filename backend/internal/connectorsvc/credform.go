// credform.go —— 凭据表单类型（admin 路由 JSON 化它，不直接暴露 connector 层类型）。派生逻辑
// 在 connector.DeriveCredentialForm；本类型只是 service↔route 的边界形状。

package connectorsvc

// CredentialForm —— 一个连接器要 owner 填的凭据表单：认证类型 + 字段 key 列表。
type CredentialForm struct {
	AuthType string
	Fields   []string
}

// UploadedSpec —— 上传/编辑连接器的内容（spec + JSONata binding + 选中的 authScheme +
// 是否把 raw ops 暴露成 agent 工具）。
type UploadedSpec struct {
	AuthScheme         string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}
