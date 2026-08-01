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
)

const (
	codeLabelMaxLen  = 12
	codeSuffixBytes  = 2
	codeSuffixDigits = 4
	hexShift         = 4    // hex nibble: low/high split per byte
	hexLowMask       = 0x0F // hex nibble mask
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
		return "0000"
	}
	const hex = "0123456789ABCDEF"
	out := make([]byte, codeSuffixDigits)
	out[0] = hex[buf[0]>>hexShift]
	out[1] = hex[buf[0]&hexLowMask]
	out[2] = hex[buf[1]>>hexShift]
	out[3] = hex[buf[1]&hexLowMask]
	return string(out)
}
