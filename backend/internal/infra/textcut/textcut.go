// Package textcut —— 切一段文本,一处实现。
//
// 为什么值得有个包:`s[:n]` 按**字节**切,n 落在一个多字节字符中间就切出半个字符。后果按
// 落点不同:一个坏了的 title 一路传到 postgres,整条 INSERT 被拒(`invalid byte sequence
// for encoding "UTF8"`),owner 那边看到的是"这条笔记存不进去",而错误里没有一个字提到标题。
// 中文每字 3 字节,所以对中文 vault 这不是边角:一行 21 个汉字就踩上了。
//
// 这个错在这个仓库里犯过至少四次(job 抓取的标题、raw 的派生标题、wiki 的 path 段、证据
// 摘要),每次都在原地补一个私有 helper —— 于是同一件事有四份写法、三种语义。这里收成一处:
// 单位说清楚(字符 / 字节),截断了要不要留记号说清楚。
package textcut

import "unicode/utf8"

// Mark —— 截断留下的记号。人看的文本用它明示"后面还有";机器读的地址(path 段、slug)
// 不能带它,那种场合用 Runes。
const Mark = "…"

// Runes —— 最多 n 个字符,**不留记号**。给 path 段 / slug 这类要进地址的东西用。
func Runes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// RunesMark —— 最多 n 个字符,切了就在末尾加一个 Mark。给标题这类给人看的短文本用。
func RunesMark(s string, n int) string {
	cut := Runes(s, n)
	if cut == s {
		return s
	}
	return cut + Mark
}

// BytesMark —— 最多 n **字节**,且绝不切开一个字符;切了就加一个 Mark。
//
// 单位是字节而不是字符,因为它的调用方是**预算**(证据摘要、片段上限):算的是这段东西
// 占多大,不是它有几个字。记号本身不算进 n。
func BytesMark(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if len(s) <= n {
		return s
	}
	cut := s[:n]
	for cut != "" && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut + Mark
}
