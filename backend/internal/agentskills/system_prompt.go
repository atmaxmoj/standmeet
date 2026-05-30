// system_prompt.go —— system prompt 拼接：base + role persona + 每个
// capability 的 SystemPromptFragment。Hash 给 dev endpoint 用，验确定性。

package agentskills

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// ComposeSystemPrompt —— 拼一份完整 system prompt。
//   - basePersona：来自 RoleSnapshot.PromptBody，由 caller 解出来传入。
//   - registry：walk 注册顺序，每个 cap 调 SystemPromptFragment 拿片段。
//     片段为空 string 的 cap 不贡献文本。
//
// 顺序：[basePersona] + [for cap in register order: fragment(cap)]
// 用 "\n\n" 连接。
func (r *Registry) ComposeSystemPrompt(
	ctx context.Context, basePersona string, in *AssembleInput,
) string {
	parts := make([]string, 0, 1+len(r.caps))
	if basePersona != "" {
		parts = append(parts, basePersona)
	}
	for _, c := range r.List() {
		if frag := c.SystemPromptFragment(ctx, in); frag != "" {
			parts = append(parts, frag)
		}
	}
	return strings.Join(parts, "\n\n")
}

// SystemPromptHash —— ComposeSystemPrompt 的 SHA-256 hex 前缀。dev endpoint
// 用：相同 (basePersona, in) 应永远返同 hash —— invariants spec 跑 3 次
// 验稳定，捕捉任何"装配顺序 / fragment 内容含时间戳 / map iter"等抖动源。
func (r *Registry) SystemPromptHash(
	ctx context.Context, basePersona string, in *AssembleInput,
) string {
	prompt := r.ComposeSystemPrompt(ctx, basePersona, in)
	sum := sha256.Sum256([]byte(prompt))
	return hex.EncodeToString(sum[:])
}
