// codes_codegen.go —— frontend / fixture 不传 code 时按 label 派生
// 'LABEL-XXX' 形态的人类可读 code。从 codes.go 拆出守 350-line cap。

package admin

import "crypto/rand"

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
		return n, err
	}
	return n, nil
}

// ensureCodePlaintext —— mutates req.Code if empty。
func ensureCodePlaintext(req *createCodeRequest) {
	if req.Code != "" {
		return
	}
	prefix := normalizeCodeLabel(req.Label)
	if prefix == "" {
		prefix = "CODE"
	}
	req.Code = prefix + "-" + randomCodeSuffix()
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
