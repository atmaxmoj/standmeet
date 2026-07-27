package usecase

import (
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
)

const (
	dupStars = 228936
	loStars  = 5
	tieLo    = 10
	tieHi    = 999
	cjkRune  = 0x4E2D // a CJK code point (non-English description)
	cjkLen   = 20
)

func findSkill(skills []entity.MarketSkill, name string) *entity.MarketSkill {
	for i := range skills {
		if skills[i].Name == name {
			return &skills[i]
		}
	}
	return nil
}

// TestDedupePreferEnglish —— SkillsMP indexes EN + translated variants of the same skill as
// separate rows; dedup collapses them (by name+author) and keeps the English description.
func TestDedupePreferEnglish(t *testing.T) {
	t.Parallel()
	cjk := strings.Repeat(string(rune(cjkRune)), cjkLen) // non-English (CJK) description
	en := "Visualize whether skills followed"
	in := []entity.MarketSkill{
		{Name: "skill-comply", Author: "affaan-m", Description: cjk, Stars: dupStars},
		{Name: "skill-comply", Author: "affaan-m", Description: en, Stars: dupStars},
		{Name: "pdf", Author: "anthropics", Description: "Use for PDFs", Stars: loStars},
	}
	out := dedupePreferEnglish(in)
	if len(out) != 2 {
		t.Fatalf("want 2 after dedup, got %d", len(out))
	}
	comply := findSkill(out, "skill-comply")
	if comply == nil {
		t.Fatal("skill-comply was dropped entirely")
	}
	if !strings.HasPrefix(comply.Description, "Visualize") {
		t.Fatalf("want the English variant kept, got %q", comply.Description)
	}
}

// TestDedupeTieHigherStars —— same language → higher stars wins.
func TestDedupeTieHigherStars(t *testing.T) {
	t.Parallel()
	in := []entity.MarketSkill{
		{Name: "x", Author: "a", Description: "same english", Stars: tieLo},
		{Name: "x", Author: "a", Description: "same english", Stars: tieHi},
	}
	out := dedupePreferEnglish(in)
	if len(out) != 1 || out[0].Stars != tieHi {
		t.Fatalf("want 1 entry with %d stars, got %+v", tieHi, out)
	}
}
