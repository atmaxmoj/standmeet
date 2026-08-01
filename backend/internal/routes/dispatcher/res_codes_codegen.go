// res_codes_codegen.go —— 不传 code 时按 label 派生 'LABEL-XXX' 形态的人类可读 code。
//
// 以前它只长在 admin 面上,于是同一件事两个面不一样:面板可以不填 code(后端派生一个),
// 而 MCP 的 codes.create 必须显式给。它是**业务**,不是 REST 形状,所以归收口 —— 两个面
// 现在都能省略 code。

package dispatcher

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

// derivedCode —— 没给 code 时按 label 派生一个。给了就原样用。
func derivedCode(code, label string) string {
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
