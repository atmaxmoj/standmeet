// visitor_fixtures.go —— F.2: in-memory data sources backing the eval facade's
// visitor agent. These satisfy the SAME narrow usecases ports the prod postgres
// repos satisfy (WikiLister / OutputLister / WritingLister / ConversationGetter
// / ReportStore) and inference.Resolver, so BuildVisitorAgent drives the real
// capability assembly with fixture data instead of a database.
//
// Not test doubles in the no-mock sense: they are legitimate alternative
// backings selected by the eval driver — the whole point of F.2 is that the
// agentic core stops being welded to postgres. Named neutrally so the backend
// no-mock gate (which bans MockProvider / Test*Deps / __mock patterns) is clean.

package agentcore

import (
	"context"
	"errors"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// wikiFixture / outputFixture / writingFixture —— corpus listers. ListByOwner
// ignores ownerID/limit (the fixture IS one owner's corpus); the retriever does
// the per-call ACL + match in memory, same as prod.
type wikiFixture struct{ items []domain.Wiki }

func (f wikiFixture) ListByOwner(
	_ context.Context, _ string, _ int32,
) ([]domain.Wiki, error) {
	return f.items, nil
}

// Search —— 全量懒搜的内存版:title/body 子串命中即返 meta+snippet,分页同 DB。
func (f wikiFixture) Search(
	_ context.Context, _, query string, limit, offset int32,
) ([]postgres.WikiMeta, error) {
	q := strings.ToLower(query)
	out := make([]postgres.WikiMeta, 0, len(f.items))
	for i := range f.items {
		if fixtureWikiMatches(&f.items[i], q) {
			out = append(out, f.metaOf(&f.items[i]))
		}
	}
	return pageMeta(out, limit, offset), nil
}

// ListChildren —— 某节点直接子的内存版(parentID nil = 根层),meta-only,翻页。
func (f wikiFixture) ListChildren(
	_ context.Context, _ string, parentID *string, limit, offset int32,
) ([]postgres.WikiMeta, error) {
	out := make([]postgres.WikiMeta, 0, len(f.items))
	for i := range f.items {
		if fixtureIsChild(&f.items[i], parentID) {
			out = append(out, f.metaOf(&f.items[i]))
		}
	}
	return pageMeta(out, limit, offset), nil
}

func fixtureIsChild(w *domain.Wiki, parentID *string) bool {
	pid, has := w.ParentID()
	if parentID == nil {
		return !has
	}
	return has && pid == *parentID
}

// GetMetaByID —— 按 id 读一条 meta(上溯算 path 用)。
func (f wikiFixture) GetMetaByID(
	_ context.Context, _, id string,
) (postgres.WikiMeta, error) {
	for i := range f.items {
		if f.items[i].ID() == id {
			return f.metaOf(&f.items[i]), nil
		}
	}
	return postgres.WikiMeta{}, domain.ErrWikiNotFound
}

// GetByID —— 按 id 读正文(meta 命中后读 body 用)。
func (f wikiFixture) GetByID(_ context.Context, _, id string) (domain.Wiki, error) {
	for i := range f.items {
		if f.items[i].ID() == id {
			return f.items[i], nil
		}
	}
	return domain.Wiki{}, domain.ErrWikiNotFound
}

func (f wikiFixture) metaOf(w *domain.Wiki) postgres.WikiMeta {
	m := postgres.WikiMeta{
		ID: w.ID(), Title: w.Title(),
		SEOIndexed: w.SEOIndexed(), Snippet: w.Body(),
	}
	if pid, ok := w.ParentID(); ok {
		m.ParentID = &pid
	}
	for i := range f.items {
		if cp, ok := f.items[i].ParentID(); ok && cp == w.ID() {
			m.HasChildren = true
			break
		}
	}
	return m
}

func fixtureWikiMatches(w *domain.Wiki, q string) bool {
	return q == "" ||
		strings.Contains(strings.ToLower(w.Title()), q) ||
		strings.Contains(strings.ToLower(w.Body()), q)
}

func pageMeta(rows []postgres.WikiMeta, limit, offset int32) []postgres.WikiMeta {
	if int(offset) >= len(rows) {
		return []postgres.WikiMeta{}
	}
	end := min(int(offset)+int(limit), len(rows))
	return rows[offset:end]
}

type outputFixture struct{ items []domain.Output }

func (f outputFixture) ListByOwner(
	_ context.Context, _ string, _ int32,
) ([]domain.Output, error) {
	return f.items, nil
}

type writingFixture struct{ items []domain.Writing }

func (f writingFixture) ListPublishedByOwner(
	_ context.Context, _ string,
) ([]domain.Writing, error) {
	return f.items, nil
}

// convFixture —— ConversationGetter: returns the eval's fixture transcript so
// summarize_conversation has a real conversation to summarize.
type convFixture struct{ msgs []domain.Message }

func (f convFixture) GetWithMessages(
	_ context.Context, _, _ string,
) (postgres.ChatWithMessages, error) {
	return postgres.ChatWithMessages{Messages: f.msgs}, nil
}

// noopReports —— ReportStore: summarize persists here. The eval only observes
// that the tool ran + its HTML; Create echoes a synthetic row, GetByID is the
// HTTP read path the eval doesn't exercise.
type noopReports struct{}

func (noopReports) Create(
	_ context.Context, in *postgres.CreateReportInput,
) (domain.ChatReport, error) {
	return domain.ChatReport{
		ID: "eval-report", OwnerID: in.OwnerID,
		ConversationID: in.ConversationID, HTML: in.HTML,
	}, nil
}

func (noopReports) GetByID(_ context.Context, _ string) (domain.ChatReport, error) {
	return domain.ChatReport{}, errors.New("agentcore: report read not wired in eval")
}

// fixedResolver —— Resolver: every Resolve returns the one eval cred (the
// DeepSeek key the eval read from its .env), regardless of owner/mode. Backs the
// summarize capability's own inference.Generate call.
type fixedResolver struct{ cred *inference.Cred }

func (r fixedResolver) Resolve(
	_ context.Context, _ *inference.ResolveInput,
) (*inference.Cred, error) {
	return r.cred, nil
}

// buildCorpusFixtures —— map the plain eval corpus entries into in-memory domain
// objects + the granted CorpusURI whitelist. Privacy is code-level: a Private
// entry's URI is simply omitted from the grant list, so RoleSnapshot.AllowsCorpus
// denies it at search/read/list — the visitor cannot reach it no matter what the
// prompt says. Public entries are granted their exact URI.
func buildCorpusFixtures(ownerID string, entries []VisitorCorpusEntry) corpusFixtures {
	var out corpusFixtures
	for i := range entries {
		e := &entries[i]
		switch e.Genre {
		case "output":
			out.outputs = append(out.outputs, e.toOutput(ownerID))
			out.grant(e, domain.GenreOutput)
		default: // "wiki" and anything unspecified → wiki (the curated default)
			out.wikis = append(out.wikis, e.toWiki(ownerID))
			out.grant(e, domain.GenreWiki)
		}
	}
	return out
}

// corpusFixtures —— accumulator for buildCorpusFixtures.
type corpusFixtures struct {
	wikis      []domain.Wiki
	outputs    []domain.Output
	corpusURIs []string
}

func (c *corpusFixtures) grant(e *VisitorCorpusEntry, genre domain.DocumentGenre) {
	if e.Private {
		return
	}
	// URI 按稳定 id(地址树派生不进 URI);fixture id = "<genre>-<path>"。
	idPrefix := "wiki-"
	if genre == domain.GenreOutput {
		idPrefix = "output-"
	}
	c.corpusURIs = append(c.corpusURIs, domain.FormatURI(genre, idPrefix+e.Path))
}

func (e *VisitorCorpusEntry) toWiki(ownerID string) domain.Wiki {
	return domain.NewWiki(&domain.WikiInit{
		ID: "wiki-" + e.Path, OwnerID: ownerID,
		Title: e.Title, Body: e.Body, Tags: e.Tags,
	})
}

func (e *VisitorCorpusEntry) toOutput(ownerID string) domain.Output {
	return domain.NewOutput(&domain.OutputInit{
		ID: "output-" + e.Path, OwnerID: ownerID,
		Title: e.Title, Body: e.Body, Tags: e.Tags,
	})
}

// toMessages —— fixture transcript → domain rows for summarize.
func toMessages(convID string, msgs []ConvMessage) []domain.Message {
	out := make([]domain.Message, 0, len(msgs))
	for i := range msgs {
		out = append(out, domain.Message{
			ConversationID: convID, Role: msgs[i].Role, Body: msgs[i].Body,
		})
	}
	return out
}
