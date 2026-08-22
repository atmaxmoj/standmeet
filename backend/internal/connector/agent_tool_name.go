// agent_tool_name.go —— operationId → LLM 工具名。
//
// provider 对 `tools[].name` 的约束是 `^[a-zA-Z0-9_-]{1,64}$`，而且**整个数组一起拒**：
// 一条不合法，这一轮所有工具（订会、检索、发信）都不进模型。所以名字要按目标那一侧的
// **字符集**规范化，而不是逐个字符打补丁 —— 以前这里只换点号（`ReplaceAll(id, ".", "_")`），
// 而 GitHub 整套 REST 的 operationId 是 `gists/list` 这种带斜杠的形状（F-C-58）。
//
// 规范化会把不同的 operationId 压成同一个名字（`gists/list` 和 `gists.list`），而
// `Spec.Operations()` 的顺序来自 map 遍历、每次调用都不一样。所以消歧**不能靠先来后到**：
// 那会让同一个 op 这次叫 `op_x`、下次叫 `op_x_2`，而 owner 授权用的正是这个名字。
// 撞名时带的后缀从 operationId 自己算，跟遍历顺序无关。

package connector

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

const (
	// agentToolNameMax —— provider 的名字长度上限。
	agentToolNameMax = 64
	// agentToolHashLen —— 撞名时那段摘要的长度。
	agentToolHashLen = 6
)

var agentToolIllegal = regexp.MustCompile(`[^A-Za-z0-9_-]`)

// agentToolNames —— 一组 operation → 各自的工具名（下标对齐 ops）。
func agentToolNames(ops []openapi.OpInfo) []string {
	shared := collidingBases(ops)
	out := make([]string, len(ops))
	for i := range ops {
		base := agentToolBase(ops[i].ID)
		if !shared[base] {
			out[i] = base
			continue
		}
		out[i] = clampToolName(base, agentToolNameMax-agentToolHashLen-1) +
			"_" + opIDDigest(ops[i].ID)
	}
	return out
}

// agentToolBase —— 规范化之后的名字（还没消歧）。
func agentToolBase(opID string) string {
	return clampToolName("op_"+agentToolIllegal.ReplaceAllString(opID, "_"), agentToolNameMax)
}

// clampToolName —— 截到上限。截断本身也会制造撞名，所以它排在消歧之前。
func clampToolName(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	return s[:limit]
}

// collidingBases —— 被多于一个 operationId 共用的 base。
func collidingBases(ops []openapi.OpInfo) map[string]bool {
	owner := make(map[string]string, len(ops))
	shared := map[string]bool{}
	for i := range ops {
		base := agentToolBase(ops[i].ID)
		prev, seen := owner[base]
		if seen && prev != ops[i].ID {
			shared[base] = true
			continue
		}
		owner[base] = ops[i].ID
	}
	return shared
}

// opIDDigest —— operationId 自己的摘要。跟遍历顺序无关，所以同一份 spec 每次算出同一个名字。
func opIDDigest(opID string) string {
	sum := sha256.Sum256([]byte(opID))
	return hex.EncodeToString(sum[:])[:agentToolHashLen]
}
