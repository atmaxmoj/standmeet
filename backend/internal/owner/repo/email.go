// email.go —— 邮箱的**存储身份规则**：什么样的两个字符串算同一行。
//
// 这条规则原来只活在 `usecase.normalizeEmail` 里，而那个函数**只有 change_email 调**。
// claim / login / recover 三个入口都把原值直接透传下去。大小写侥幸没出事 —— `owners.email`
// 是 citext；**空格会出事**：citext 不 trim。claim 时带一个前导空格进去，那个带空格的字符串
// 就成了身份，之后正常输入永远登不上，recover 也救不回来（同一条查找路径）。
//
// 所以规则落在 repo：邮箱进出数据库只有三个口（CreateOwner / UpdateOwnerEmail /
// GetOwnerByEmail），全在这一层。放在这里之后**没有什么需要记得** —— 以后新加一个读邮箱的
// 入口，它自动就是对的。放在 usecase 就得每个入口各记一次，而忘记调用的人和写检查器的人
// 是同一个（CLAUDE.md A4：外来数据在入口规范化一次，下游当字段总在）。
//
// 分工：**repo 规范化**（trim + 转小写，决定"是不是同一行"），**usecase 校验格式**
// （有没有 @、长度，决定"能不能收"）。citext 已经管了大小写，这里补上空格那一半。

package repo

import "strings"

// NormalizeEmail —— 存储身份用的形式。导出是因为 usecase 在校验前也要按同一把尺子量，
// 否则"校验通过的串"和"存进去的串"会是两个东西。
func NormalizeEmail(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}
