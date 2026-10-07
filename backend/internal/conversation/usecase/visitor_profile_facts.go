// visitor_profile_facts.go —— the owner's own fact notes, handed to the agent up front (agent
// speedup W3, hard facts).
//
// A role can name single subjectivity notes in its corpus scope — the hiring role names
// subjectivity://background, ://resume and ://operations-record. These hold the facts every
// visitor of that role asks about: where the owner may work, the employers, the dates. The agent
// used to have to find them with its tools, and when it did not look it said the facts were not
// in its notes (sijie.xyz, 2026-10-07: "can he legally work for a US company?" answered "my
// notes don't cover visa status" with zero searches, while background states the work permit).
// Named notes go into every turn's instruction instead: the answer needs no search, and it can
// not miss them.
//
// Only exact names, never globs: a glob (wiki://**) is a library to search, not a fact sheet.
// The role's denies and the note's published flag still apply (RoleSnapshot.AllowsCorpus).

package usecase

import (
	"context"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// profileFactsBudget —— the most text the fact notes may add to an instruction. A note that does
// not fit is named instead, so the agent knows to read it.
const profileFactsBudget = 16000

// ProfileNoteReader —— reads one note by its exact URI (corpus.RefResolver).
type ProfileNoteReader interface {
	NoteText(ctx context.Context, ownerID, uri string) (corpus.RefNote, bool)
}

// BuildProfileFacts —— the role's named subjectivity notes, as one block of text; "" when the
// role names none, or nothing is wired to read them.
func BuildProfileFacts(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, snap *access.RoleSnapshot,
) string {
	if deps.ProfileNotes == nil || snap == nil {
		return ""
	}
	var b strings.Builder
	var skipped []string
	for _, uri := range namedFactNotes(snap.CorpusURIs()) {
		if body, ok := readableNote(ctx, deps.ProfileNotes, ownerID, snap, uri); ok {
			skipped = appendFactNote(&b, skipped, uri, body)
		}
	}
	return b.String() + skippedLine(skipped)
}

// readableNote —— the note's body, when it exists and this role may read it.
func readableNote(
	ctx context.Context, r ProfileNoteReader, ownerID string, snap *access.RoleSnapshot, uri string,
) (string, bool) {
	note, ok := r.NoteText(ctx, ownerID, uri)
	if !ok || !snap.AllowsCorpus(uri, note.Published) {
		return "", false
	}
	return note.Body, true
}

// skippedLine —— names the notes that did not fit, so the agent knows to read them.
func skippedLine(skipped []string) string {
	if len(skipped) == 0 {
		return ""
	}
	return "Also yours, not shown here (read with your corpus tools): " +
		strings.Join(skipped, ", ") + "\n"
}

// appendFactNote —— writes the note if it fits the budget; otherwise adds it to skipped.
func appendFactNote(b *strings.Builder, skipped []string, uri, body string) []string {
	if b.Len()+len(body) > profileFactsBudget {
		return append(skipped, uri)
	}
	b.WriteString("<note uri=\"" + uri + "\">\n" + strings.TrimSpace(body) + "\n</note>\n")
	return skipped
}

// namedFactNotes —— the exact subjectivity:// names in a scope (no glob characters).
func namedFactNotes(uris []string) []string {
	out := make([]string, 0, len(uris))
	for _, u := range uris {
		if strings.HasPrefix(u, "subjectivity://") && !strings.ContainsAny(u, "*?") {
			out = append(out, u)
		}
	}
	return out
}
