// conversations.go —— conversation list / transcript queries from the admin's viewpoint.
// The business logic is thin enough to be almost just repo forwarding + default param
// clamping; it's still its own use case to decouple from the routes layer, so adding
// "filter / search / pagination" later won't pollute the handler.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// ConversationsDeps —— repos needed by ListConversations / GetTranscript.
// Wiki + Writing + Output are for the transcript to resolve cited_*_ids into id+title;
// Subjectivity resolves cited_subjectivity_ids (only opt-in ones get recorded onto the
// message; this is purely id→ref display).
type ConversationsDeps struct {
	Chats        *repo.ChatRepo
	Wiki         *corpus.WikiRepo
	Writing      *corpus.WritingRepo
	Output       *corpus.OutputRepo
	Subjectivity corpus.SubjectivityCiteLookup
}

// TitledRef —— the (id, title) TranscriptBundle exposes; upper layers (routes / mcp)
// don't import postgres directly, so usecases provides a corresponding type. Fields have
// the same names and order as postgres.TitledRef; the conversion is field-by-field.
type TitledRef struct {
	ID    string
	Title string
	Path  string
}

// SubjectivityRef —— resolved ref for opt-in subjectivity in the transcript. Carries Body
// (subjectivity_refs exposes {id,path,title,body}) —— only show_as_source=true entries
// ever enter message.cited_subjectivity_ids, so any body appearing here is one the owner
// explicitly opted in, never a private leak.
type SubjectivityRef struct {
	ID    string
	Title string
	Path  string
	Body  string
}

// TranscriptBundle —— what GetConversationTranscript returns: conversation + messages
// + the id→ref index for cited wiki / output / subjectivity (hydrated once, frontend
// looks up as needed).
type TranscriptBundle struct {
	ConvBundle       repo.ChatWithMessages
	WikiRefs         []TitledRef
	WritingRefs      []TitledRef
	OutputRefs       []TitledRef
	SubjectivityRefs []SubjectivityRef
	// GroundingRefs —— subjectivity that shaped the voice but wasn't opt-in, carrying
	// only title/path (F-A-27).
	GroundingRefs []TitledRef
}

const (
	defaultConvListLimit = 50
	maxConvListLimit     = 200
)

// ListConversations —— admin lists all of the owner's conversations. limit ≤ 0 uses the
// default; over max gets clamped.
func ListConversations(
	ctx context.Context, deps ConversationsDeps, ownerID string, limit int32,
) ([]repo.ChatSummary, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Chats.ListByOwner(ctx, ownerID, clampConvLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	return rows, nil
}

// GetConversationTranscript —— fetches the full conversation + messages and hydrates the
// title index for cited wiki/output. When convID doesn't exist / doesn't belong to owner,
// returns domain.ErrConversationNotFound. A hydrate failure isn't fatal: refs come back
// empty and the frontend falls back to showing the id.
func GetConversationTranscript(
	ctx context.Context, deps ConversationsDeps, ownerID, convID string,
) (TranscriptBundle, error) {
	if ownerID == "" || convID == "" {
		return TranscriptBundle{}, apierr.ErrEmptyField
	}
	bundle, err := deps.Chats.GetWithMessages(ctx, ownerID, convID)
	if err != nil {
		return TranscriptBundle{}, fmt.Errorf("get transcript: %w", err)
	}
	cited := collectCitedIDs(bundle.Messages)
	subjRefs := subjectivityCitedRefs(ctx, deps.Subjectivity, ownerID, cited.subjectivities)
	return TranscriptBundle{
		ConvBundle:       bundle,
		WikiRefs:         wikiCitedRefs(ctx, deps.Wiki, ownerID, cited.wikis),
		WritingRefs:      writingCitedRefs(ctx, deps.Writing, ownerID, cited.writings),
		OutputRefs:       outputCitedRefs(ctx, deps.Output, ownerID, cited.outputs),
		SubjectivityRefs: subjRefs,
		GroundingRefs:    groundingRefs(ctx, deps.Subjectivity, ownerID, cited.grounded),
	}, nil
}

// subjectivityCitedRefs —— cited subjectivity id → {id,path,title,body}. These ids are
// already opt-in (passed the show_as_source gate before being written to the message);
// this is pure hydration. lookup not wired / resolution failed → skipped.
func subjectivityCitedRefs(
	ctx context.Context, lookup corpus.SubjectivityCiteLookup, ownerID string, ids []string,
) []SubjectivityRef {
	out := make([]SubjectivityRef, 0, len(ids))
	if lookup == nil {
		return out
	}
	for _, id := range ids {
		ref, err := lookup.ResolveCite(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, SubjectivityRef{
			ID: ref.ID, Title: ref.Title, Path: ref.Path, Body: ref.Body,
		})
	}
	return out
}

// groundingRefs —— grounded subjectivity id → {id,title,path}. **Doesn't take body**.
//
// These are private standpoint notes that weren't opt-in: they shaped this turn's voice,
// and the owner previously had no view anywhere showing they'd been involved (F-A-27).
// What the owner needs to judge is "which ones were in play" — a title is enough for
// that —— the body isn't copied into the transcript's response; private content stays in
// its own table.
func groundingRefs(
	ctx context.Context, lookup corpus.SubjectivityCiteLookup, ownerID string, ids []string,
) []TitledRef {
	out := make([]TitledRef, 0, len(ids))
	if lookup == nil {
		return out
	}
	for _, id := range ids {
		ref, err := lookup.ResolveCite(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, TitledRef{ID: ref.ID, Title: ref.Title, Path: ref.Path})
	}
	return out
}

// wikiCitedRefs —— resolves cited wiki ids into (id, title, tree-derived path). The
// address is purely tree-derived (load the whole tree → corpus.WikiTreePaths), doesn't
// read the retired path column. load failure / id already deleted → skipped; the
// transcript's main data is already in hand, the frontend falls back to showing the id,
// the whole transcript shouldn't 502 over this.
func wikiCitedRefs(
	ctx context.Context, repo *corpus.WikiRepo, ownerID string, ids []string,
) []TitledRef {
	// Only walk up to compute path + meta for the ids that are actually cited, one by
	// one (no 50-cap; ones beyond the in-memory window still resolve).
	titles := make(map[string]string, len(ids))
	paths := make(map[string]string, len(ids))
	for _, id := range ids {
		meta, merr := repo.GetMetaByID(ctx, ownerID, id)
		if merr != nil {
			continue
		}
		path, perr := corpus.WikiPathByID(ctx, repo, ownerID, id)
		if perr != nil {
			continue
		}
		titles[id] = meta.Title
		paths[id] = path
	}
	return refsFor(ids, titles, paths)
}

// writingCitedRefs —— resolves cited writing ids into (id, title, path). writing has its
// own slug-derived path column ("writings/"+slug), no need to walk the tree; GetByID one
// by one for title+slug. No gate before it's written into the message (writing is a
// public/published blog). repo not wired / id already deleted → skipped.
func writingCitedRefs(
	ctx context.Context, repo *corpus.WritingRepo, ownerID string, ids []string,
) []TitledRef {
	out := make([]TitledRef, 0, len(ids))
	if repo == nil {
		return out
	}
	for _, id := range ids {
		w, err := repo.GetByID(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, TitledRef{ID: id, Title: w.Title(), Path: w.Path()})
	}
	return out
}

// outputCitedRefs —— output's twin of wiki: walk up to compute path + meta for each
// cited id, one by one (no 50-cap; a cited output beyond the in-memory window still
// resolves).
func outputCitedRefs(
	ctx context.Context, repo *corpus.OutputRepo, ownerID string, ids []string,
) []TitledRef {
	titles := make(map[string]string, len(ids))
	paths := make(map[string]string, len(ids))
	for _, id := range ids {
		meta, merr := repo.GetMetaByID(ctx, ownerID, id)
		if merr != nil {
			continue
		}
		path, perr := corpus.OutputPathByID(ctx, repo, ownerID, id)
		if perr != nil {
			continue
		}
		titles[id] = meta.Title
		paths[id] = path
	}
	return refsFor(ids, titles, paths)
}

// refsFor —— cited id → TitledRef, filled from the title/path maps; ones not in the maps
// (already deleted) are skipped, preserving the old GetTitlesByIDs "only returns existing
// ones" semantics.
func refsFor(ids []string, titles, paths map[string]string) []TitledRef {
	out := make([]TitledRef, 0, len(ids))
	for _, id := range ids {
		title, ok := titles[id]
		if !ok {
			continue
		}
		out = append(out, TitledRef{ID: id, Title: title, Path: paths[id]})
	}
	return out
}

// citedIDs —— the grouped results returned by collectCitedIDs, avoiding named-return +
// multi-return.
type citedIDs struct {
	wikis          []string
	writings       []string
	outputs        []string
	subjectivities []string
	// grounded —— subjectivity that wasn't opt-in (F-A-27). Collected separately from
	// subjectivities: they go through different hydration (only title and path, no
	// body) and render in a different block too.
	grounded []string
}

const citedSetInitialCap = 16

// collectCitedIDs —— scans every message's CitedWikiIDs / CitedWritingIDs /
// CitedOutputIDs / CitedSubjectivityIDs, deduplicated.
func collectCitedIDs(messages []entity.Message) citedIDs {
	wikiSet := make(map[string]struct{}, citedSetInitialCap)
	writingSet := make(map[string]struct{}, citedSetInitialCap)
	outputSet := make(map[string]struct{}, citedSetInitialCap)
	subjSet := make(map[string]struct{}, citedSetInitialCap)
	groundSet := make(map[string]struct{}, citedSetInitialCap)
	for i := range messages {
		addAll(wikiSet, messages[i].CitedWikiIDs)
		addAll(writingSet, messages[i].CitedWritingIDs)
		addAll(outputSet, messages[i].CitedOutputIDs)
		addAll(subjSet, messages[i].CitedSubjectivityIDs)
		addAll(groundSet, messages[i].GroundedSubjectivityIDs)
	}
	return citedIDs{
		wikis: keysOf(wikiSet), writings: keysOf(writingSet),
		outputs: keysOf(outputSet), subjectivities: keysOf(subjSet),
		grounded: keysOf(groundSet),
	}
}

func addAll(set map[string]struct{}, ids []string) {
	for _, id := range ids {
		set[id] = struct{}{}
	}
}

func keysOf(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	return out
}

func clampConvLimit(n int32) int32 {
	if n <= 0 {
		return defaultConvListLimit
	}
	if n > maxConvListLimit {
		return maxConvListLimit
	}
	return n
}
