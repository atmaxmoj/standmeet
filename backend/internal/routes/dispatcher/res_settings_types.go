// res_settings_types.go —— owner 推理设置在收口这一层的数据形状。
//
// 注意 AISettings 里**没有 key**:那是密钥,只进不出。类型里没有这个字段,
// 所以任何一个面都无从把它露出去 —— 不是靠谁记得不写。

package dispatcher

// Settings —— owner 推理设置的完整形状(两块一起)。
type Settings struct {
	AI    AISettings
	BYOAI BYOAISettings
}

// AISettings —— owner 自己的 provider。刻意**没有** key:那是密钥,只进不出,
// 出站只说"配没配"。
type AISettings struct {
	Provider      string
	Endpoint      string
	Model         string
	KeyConfigured bool
}

// BYOAISettings —— 访客自带 key 的规则。
type BYOAISettings struct {
	PublicBlurb string
	Providers   []string
	Enabled     bool
}
