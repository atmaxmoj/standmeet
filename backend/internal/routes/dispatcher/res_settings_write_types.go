// res_settings_write_types.go —— 改设置的**入参**形状(读出来的那几个在 res_settings_types.go)。
//
// WriteAIProvider 是唯一带原始 key 的入参:它只往域里走,不参与任何出站形状。

package dispatcher

// WriteBYOAI —— 改 byoai 的入参。
type WriteBYOAI struct {
	OwnerID   string
	Blurb     string
	Providers []string
	Enabled   bool
}

// WriteAIProvider —— 改 ai provider 的入参。KeyChange 三态:keep / set / clear,
// 只有 set 才看 Key。
type WriteAIProvider struct {
	OwnerID   string
	Provider  string
	Endpoint  string
	Model     string
	KeyChange string
	Key       string
}

// AIPreset —— 一个内置 provider 预设(填下拉和默认 endpoint/model 用)。
type AIPreset struct {
	Name      string
	Label     string
	BaseURL   string
	KeyPrefix string
}
