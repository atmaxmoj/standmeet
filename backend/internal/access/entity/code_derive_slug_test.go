// code_derive_slug_test.go —— DeriveSlug: the code's landing-path slug (`/<slug>`). Owner-provided
// slug wins when valid; otherwise the caller's generated fallback (a snowflake short id). Always
// non-empty. Covers test-design C1-C4 (default / owner-set / reserved / charset).

package entity_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
)

func TestDeriveSlug(t *testing.T) {
	t.Parallel()
	const gen = "snow123"
	cases := []struct {
		name, provided, want string
	}{
		{"empty falls back to generated", "", gen},
		{"owner slug used, lowercased", "Hire_Me", "hire_me"},
		{"bad chars stripped, dashes/underscores kept", "My-Cool_Path!!", "my-cool_path"},
		{"all-stripped falls back to generated", "!!! ???", gen},
		{"reserved slug falls back to generated", "admin", gen},
		{"reserved (home) falls back", "home", gen},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := entity.DeriveSlug(c.provided, gen); got != c.want {
				t.Fatalf("DeriveSlug(%q, %q) = %q, want %q", c.provided, gen, got, c.want)
			}
		})
	}
}

// TestDeriveSlugAlwaysNonEmpty — with a non-empty fallback, the result is never empty whatever the
// owner typed (the DB column is NOT NULL — this is the invariant create relies on).
func TestDeriveSlugAlwaysNonEmpty(t *testing.T) {
	t.Parallel()
	for _, provided := range []string{"", "ok", "!!!", "admin", "A/B C"} {
		if entity.DeriveSlug(provided, "fallback") == "" {
			t.Fatalf("DeriveSlug(%q, fallback) is empty", provided)
		}
	}
}
