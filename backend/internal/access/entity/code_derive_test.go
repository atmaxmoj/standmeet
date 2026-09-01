// code_derive_test.go —— how much entropy a system-derived access code must carry.
//
// Why this test exists (pentest 2026-09-01): a code assuming the `invited` role can read the
// ENTIRE private corpus (wiki + output + writing, published or not). Such a code is a URL bearer,
// and the product prints it on a résumé QR — a public artifact. A credential that grants the full
// private corpus must have enough entropy that online brute-force, under the lockout (CodeGuard,
// 10 tries / 15 min), is infeasible.
//
// The system suffix used to be 2 bytes = 4 hex = 16 bits = 65536 — brute-forceable in ~68 days
// from one IP, under a day with an X-Forwarded-For botnet. This test pins the floor at 64 bits.

package entity_test

import (
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
)

const (
	minSuffixBits  = 64 // floor for a URL-bearer credential that grants private corpus
	bitsPerHexChar = 4  // a hex nibble is 4 bits
)

func suffixOf(code string) string {
	i := strings.LastIndexByte(code, '-')
	if i < 0 {
		return code
	}
	return code[i+1:]
}

// TestDerivedCodeHasEnoughEntropy —— the random suffix of a derived code must be >= 64 bits.
func TestDerivedCodeHasEnoughEntropy(t *testing.T) {
	t.Parallel()
	suffix := suffixOf(entity.DeriveCode("", "RECRUIT"))
	bits := len(suffix) * bitsPerHexChar
	if bits < minSuffixBits {
		t.Fatalf("derived-code suffix is only %d bits (%q) — a URL bearer that grants the "+
			"full private corpus is still brute-forceable at this size; floor is %d bits",
			bits, suffix, minSuffixBits)
	}
}

// TestDerivedCodesAreDistinct —— a batch of derived codes are all distinct: the suffix really
// uses its bits (not a constant / low-entropy source). A collision means the effective entropy
// is far below what the length implies.
func TestDerivedCodesAreDistinct(t *testing.T) {
	t.Parallel()
	const n = 512
	seen := make(map[string]bool, n)
	for range n {
		s := suffixOf(entity.DeriveCode("", "RECRUIT"))
		if seen[s] {
			t.Fatalf("a repeated suffix %q in 512 derivations — entropy is far below the length", s)
		}
		seen[s] = true
	}
}

// TestCustomCodePassesThroughVerbatim —— an owner-supplied code is used verbatim (known ceiling).
// Pinned here because this is where a weak code like ROOM-001 legitimately lives: the entropy
// floor governs SYSTEM-derived codes only; a short code the owner typed is the owner's own call.
func TestCustomCodePassesThroughVerbatim(t *testing.T) {
	t.Parallel()
	if got := entity.DeriveCode("ROOM-001", "READING ROOM"); got != "ROOM-001" {
		t.Fatalf("a custom code must be returned verbatim, got %q", got)
	}
}
