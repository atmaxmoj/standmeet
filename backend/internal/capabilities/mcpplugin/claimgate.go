// claimgate.go —— 一个能力可以声明：**我做的事要么发生了要么没发生，光说不算**。
//
// F-A-37 的由来：真实环境里连约四场之后，第五次请求的回答是 *"Booked. ✅ Monday, August 31 ·
// 13:00–13:30 UTC … Invite went to …"*，而那一轮**一个工具都没调**，真日历整天空的。浏览器
// 回放给模型的历史只有 `{role, content}` —— 它读回去的是四条自己写的 "Booked"，看不到任何
// 工具痕迹，于是要补全的成了**那句话**而不是那个动作。
//
// 光靠 prompt 说「不要编」挡不住这个：那是概率，不是机制。这份声明把它变成宿主执行的**必要
// 条件** —— 答案里出现「已经完成」的说法时，本轮必须有该工具的成功回执，否则宿主判这一轮
// 不算数（`ClaimUnbacked` 停止原因），访客那边收到产品自己的话，而不是模型的。
//
// 宿主只读这两个字段，永远不知道 "booking" 是什么；下一个做「已发出 / 已提交 / 已下单」这
// 类动作的能力，照抄这两行就能得到同一道闸。

package mcpplugin

import "strings"

// ClaimGateDecl —— 一个能力对「说了就得做」的声明。nil = 这个能力不闸主张。
type ClaimGateDecl struct {
	// Tool —— 支撑这类主张的工具名。本轮该工具有成功回执 = 主张有据。
	Tool string
	// Phrases —— 断言「动作已完成」的说法（小写子串匹配）。
	//
	// **要窄**：只收完成态的断言。提议（"shall I book"）、提问、拒绝都不是主张 —— 闸门错杀
	// 一句正常回答，比它挡下的那句谎话更贵，所以宁可漏也不要滥。
	Phrases []string
}

// Usable —— 这份声明能不能真的执行：缺工具名或没有任何说法就判不了，那时候「不闸」比「瞎闸」对。
// nil 接收者合法（大多数能力不闸主张）。
func (c *ClaimGateDecl) Usable() bool {
	return c != nil && c.Tool != "" && len(c.Phrases) > 0
}

// Claims —— 这段答案有没有断言动作已完成。大小写不敏感；空答案不算主张。
func (c *ClaimGateDecl) Claims(answer string) bool {
	if !c.Usable() {
		return false
	}
	low := strings.ToLower(answer)
	for _, p := range c.Phrases {
		if p != "" && strings.Contains(low, strings.ToLower(p)) {
			return true
		}
	}
	return false
}
