package usecase_test

// The "what search sees" rule has two homes: Searchable (Go, the Meili index) and
// corpus_searchable (SQL, the Postgres full-text path). They must agree, or one note answers a
// query on one backend and not on the other. This is the tripwire.

import (
	"context"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
)

var searchableSamples = []string{
	"plain prose\nsecond line",
	"> [!i18n]\n> <label><input type=\"radio\" name=\"x\" checked>EN</label>\n>\n" +
		"> > [!lang] en\n> > hi",
	"> > [!lang] zh\n> > 中文\n> > [!LANG]- ja",
	"[!i18n]+\nkeep me",
	"a < b is prose, not a tag\n<label for=x>gone</label>\ninline <input/> gone",
	"> [!tip] Owner title stays\n> body",
	"",
	"no trailing newline <label>",
}

func TestSearchableMatchesSQL(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	ctx := context.Background()
	for _, body := range searchableSamples {
		var got string
		if err := pool.QueryRow(ctx, `SELECT corpus_searchable($1)`, body).Scan(&got); err != nil {
			t.Fatalf("corpus_searchable(%q): %v", body, err)
		}
		if want := usecase.Searchable(body); got != want {
			t.Errorf("body %q:\n SQL %q\n Go  %q", body, got, want)
		}
	}
}
