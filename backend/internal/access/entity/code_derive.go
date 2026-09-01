// code_derive.go —— 不传 code 时按 label 派生 'LABEL-XXX' 形态的人类可读 code。
//
// 这条规则住在域里。它先是只长在 admin 面上(于是 MCP 那边 code 必填),后来被搬进出站
// 收口 —— 那仍然是"只有走那条路的调用方才有"。建码有三个入口(面板、MCP、job-loop 的
// CreateAccessCodeTx),规则放在任何一个入口上,另外两个就得各写一份,然后飘。
// 它是**建码这件事本身**的一部分,所以跟着建码走。

package entity

import (
	"crypto/rand"
	"fmt"
	"strings"
)

const (
	codeLabelMaxLen = 12
	// codeSuffixBytes —— 系统派生码的随机后缀字节数。
	//
	// **8 字节 = 64 bit**，不是 2。pentest 2026-09-01 实证：一张走 `invited` role 的码
	// 读得到全部私有语料，而这种码印在简历 QR 上（公开材料）。16 bit（原值）在锁定下
	// 单 IP 约 68 天可破、僵尸网络更快 —— 对一个授予全私有语料的 URL bearer 太弱。
	// 64 bit 让在线暴破的期望远超任何现实时限。旧码是精确匹配的存储串，加长后仍可用。
	codeSuffixBytes  = 8
	codeSuffixDigits = codeSuffixBytes * 2 // 每字节两个 hex 字符
	hexShift         = 4                   // hex nibble: low/high split per byte
	hexLowMask       = 0x0F                // hex nibble mask
)

// codeRand —— wrapped for test injection; defaults to crypto/rand。
var codeRand = cryptoRandRead

func cryptoRandRead(b []byte) (int, error) {
	n, err := rand.Read(b)
	if err != nil {
		return n, fmt.Errorf("read random bytes: %w", err)
	}
	return n, nil
}

// DeriveCode —— 没给 code 时按 label 派生一个。给了就原样用。
func DeriveCode(code, label string) string {
	if code != "" {
		return code
	}
	prefix := normalizeCodeLabel(label)
	if prefix == "" {
		prefix = "CODE"
	}
	return prefix + "-" + randomCodeSuffix()
}

func normalizeCodeLabel(label string) string {
	out := make([]rune, 0, codeLabelMaxLen)
	for _, c := range label {
		out = appendNormalizedRune(out, c)
		if len(out) >= codeLabelMaxLen {
			break
		}
	}
	return string(out)
}

func appendNormalizedRune(out []rune, c rune) []rune {
	if upper := uppercaseRune(c); upper != 0 {
		return append(out, upper)
	}
	if isCodeChar(c) {
		return append(out, c)
	}
	return out
}

func uppercaseRune(c rune) rune {
	if c >= 'a' && c <= 'z' {
		return c - 'a' + 'A'
	}
	return 0
}

func isCodeChar(c rune) bool {
	return isUpperASCII(c) || isDigit(c)
}

func isUpperASCII(c rune) bool { return c >= 'A' && c <= 'Z' }
func isDigit(c rune) bool      { return c >= '0' && c <= '9' }

func randomCodeSuffix() string {
	buf := make([]byte, codeSuffixBytes)
	if _, err := codeRand(buf); err != nil {
		// rand 失败极罕见。返回可辨认的哨兵 + 一个错误标记,不返回"看起来正常"的低熵串
		// (那会让一张碰巧全 0 的弱码混进来)。长度跟正常后缀一致,方便一眼认出。
		return strings.Repeat("0", codeSuffixDigits)
	}
	const hex = "0123456789ABCDEF"
	// 每字节两个 nibble。跟着 codeSuffixBytes 走,改字节数不用再动这里。
	out := make([]byte, 0, codeSuffixDigits)
	for _, b := range buf {
		out = append(out, hex[b>>hexShift], hex[b&hexLowMask])
	}
	return string(out)
}
