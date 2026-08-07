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

// RepoStars 是 *int(nil = 这个源报不出星数,不是零颗星),所以测试里用 new(值) 取地址。

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
		{Name: "skill-comply", Author: "affaan-m", Description: cjk, RepoStars: new(dupStars)},
		{Name: "skill-comply", Author: "affaan-m", Description: en, RepoStars: new(dupStars)},
		{Name: "pdf", Author: "anthropics", Description: "Use for PDFs", RepoStars: new(loStars)},
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
		{Name: "x", Author: "a", Description: "same english", RepoStars: new(tieLo)},
		{Name: "x", Author: "a", Description: "same english", RepoStars: new(tieHi)},
	}
	out := dedupePreferEnglish(in)
	if len(out) != 1 || starsOrZero(&out[0]) != tieHi {
		t.Fatalf("want 1 entry with %d stars, got %+v", tieHi, out)
	}
}
