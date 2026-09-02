// code_derive.go — when no code is given, derive a human-readable 'LABEL-XXX' code from label.
//
// This rule lives in the domain. It first grew only on the admin panel (so the MCP side had
// to make code required), then got moved into the outbound convergence point — that was
// still "only the caller going through that one path has it". Code creation has three
// entry points (the panel, MCP, job-loop's CreateAccessCodeTx); putting the rule on any one
// of them means the other two each need their own copy, and those copies drift.
// This rule is part of **the act of creating a code itself**, so it travels with creation.

package entity

import (
	"crypto/rand"
	"fmt"
	"strings"
)

const (
	codeLabelMaxLen = 12
	// codeSuffixBytes — random suffix byte count for a system-derived code.
	//
	// **8 bytes = 64 bit**, not 2. Pentest 2026-09-01 proved it: a code on the `invited`
	// role can read the entire private corpus, and this kind of code gets printed in a QR
	// on a resume (public material). 16 bit (the old value) is crackable from a single IP
	// in about 68 days under rate-limiting, faster with a botnet — too weak for a URL
	// bearer that grants the whole private corpus. 64 bit pushes the expected time for
	// online brute-forcing far past any realistic deadline. Old codes are exact-match
	// stored strings, so they still work after the suffix got longer.
	codeSuffixBytes  = 8
	codeSuffixDigits = codeSuffixBytes * 2 // two hex characters per byte
	hexShift         = 4                   // hex nibble: low/high split per byte
	hexLowMask       = 0x0F                // hex nibble mask
)

// codeRand —— wrapped for test injection; defaults to crypto/rand.
var codeRand = cryptoRandRead

func cryptoRandRead(b []byte) (int, error) {
	n, err := rand.Read(b)
	if err != nil {
		return n, fmt.Errorf("read random bytes: %w", err)
	}
	return n, nil
}

// DeriveCode — derive one from label when no code is given. Use it as-is when given.
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
		// rand failing is extremely rare. Return a recognizable sentinel + an error marker,
		// not a low-entropy string that "looks normal" (that would let a weak all-zero
		// code slip through). Same length as a normal suffix, so it's spottable at a glance.
		return strings.Repeat("0", codeSuffixDigits)
	}
	const hex = "0123456789ABCDEF"
	// Two nibbles per byte. Follows codeSuffixBytes — changing the byte count needs no edit here.
	out := make([]byte, 0, codeSuffixDigits)
	for _, b := range buf {
		out = append(out, hex[b>>hexShift], hex[b&hexLowMask])
	}
	return string(out)
}
