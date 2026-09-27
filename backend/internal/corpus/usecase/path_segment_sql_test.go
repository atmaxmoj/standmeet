package usecase_test

// The slug rule has two homes: PathSegment (Go) and corpus_path_segment (SQL, used by the
// corpus_notes event trigger to name an event's subject). The SQL copy may only derive from the
// Go one, so this test is the tripwire: any title on which they disagree fails here, instead of
// an event subject silently naming a different address than the reader serves.

import (
	"context"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
)

// Repeat counts for the long samples: past the 80-rune cut, and a dash landing at the cut.
const (
	longWordRepeats = 20
	longRuneRepeats = 120
	cutFillRepeats  = 59
)

//nolint:gosmopolitan // the CJK titles ARE the thing under test: the slug rule for CJK titles
var paritySamples = []string{
	"Hello, World!", "  leading and trailing  ", "Already-slugged", "UPPER lower MiXeD",
	"卢塞恩项目笔记", "卢塞恩 项目 / 规划", "Ünïcödé Çafé", "日本語のタイトル", "한국어 제목",
	"Ελληνικά γράμματα", "Кириллица тоже", "عنوان عربي", "emoji 🚀 rocket", "tabs\tand\nnewlines",
	"under_score", "dots.in.title", "a—b–c", "C++ & Go", "100% done", "v0.1.71 release",
	"", "!!!", "---", "   ", "x",
	strings.Repeat("long title ", longWordRepeats), strings.Repeat("长", longRuneRepeats),
	"trailing dash at 80 " + strings.Repeat("a", cutFillRepeats) + " b",
	"Pillar 8 · Events: bus, outbox and webhooks",
	"事件总线 · Outbox · Webhook 计划", "why-not-a-broker", "Standard Webhooks (Svix)",
}

func TestSQLPathSegmentMatchesGo(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	ctx := context.Background()
	for _, title := range paritySamples {
		var got string
		row := pool.QueryRow(ctx, `SELECT corpus_path_segment($1)`, title)
		if err := row.Scan(&got); err != nil {
			t.Fatalf("corpus_path_segment(%q): %v", title, err)
		}
		if want := usecase.PathSegment(title); got != want {
			t.Errorf("title %q: SQL %q, Go %q", title, got, want)
		}
	}
}
