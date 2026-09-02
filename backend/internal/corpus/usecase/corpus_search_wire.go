// corpus_search_wire.go — the shape of corpus_search's response.
//
// Kept in its own file: it isn't "just another op's plumbing" — it's a rule
// about **how to speak when the hands come back empty**, and that rule has its
// own history (F-S-2, below). corpus_index_socket.go over there is the wiring.

package usecase

import "encoding/json"

// searchResultWire — corpus_search's response. **hits is always present; note
// appears only when the hands come back empty.**
//
// F-S-2: this tool used to reply with a bare `[]` on an empty result, and that
// one value stood for two different things — "the corpus genuinely has none of
// this" and "this index can't represent your query." The agent read it as the
// former, so that half of the question went silently unanswered (proven in prod:
// a query for `recursive convergence` returned `[]`, while an English query in
// the same turn returned 7883 bytes; the answer generated as usual, and nothing
// in the UI showed the gap).
//
// **What the note can honestly say is limited, so it says only what's always
// true.** It never says "your query can't be indexed" — Meili's response never
// tells us that, so writing it would be making it up ([[names-that-lie]]).
// It says only: this result is empty, and this index depends on tokenization,
// so empty doesn't mean absent; use the never-miss tool if you need certainty.
//
// Why leaving this in the tool description alone isn't enough: the description
// is read by the agent **at the moment it picks a tool**; the note is read
// **at the moment it gets an empty hand** — and that's the moment it actually
// needs to reconsider (same principle as
// [[receipt-check-belongs-next-to-the-action]]).
//
// Warning: two earlier comments here both claimed "this wire is pinned by
// tool-endpoint-corpus.spec.ts:146, can't be changed." That test only asserts
// `status==200 && body.ok==true` — it never pinned the shape. A fabricated
// blocker written down as a "reason" froze this for a whole cycle
// ([[blocker-written-as-reason-ossifies]]).
type searchResultWire struct {
	// Field order follows govet fieldalignment: string before slice.
	Note string `json:"note,omitempty"`
	Hits []Row  `json:"hits"`
}

// emptySearchNote — the message shown on an empty result. Names corpus_grep
// explicitly so the agent can act on it directly.
const emptySearchNote = "No hits. This is a lexical index, so a miss can be tokenization " +
	"(substrings inside a word, terms glued to punctuation, CJK bigrams) rather than absence — " +
	"an empty result does NOT mean the corpus lacks the topic. If you still believe the material " +
	"exists, use corpus_grep, which is literal and never-miss."

func marshalSearchResult(metas []Meta) string {
	out := searchResultWire{Hits: rowsOf(metas)}
	if len(out.Hits) == 0 {
		out.Note = emptySearchNote
	}
	body, err := json.Marshal(out)
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(body)
}

// rowsOf — []Meta → []Row. search and list/resolve share this mapping; they
// only differ in the outer wrapper.
func rowsOf(metas []Meta) []Row {
	rows := make([]Row, 0, len(metas))
	for i := range metas {
		rows = append(rows, Row{
			Path: metas[i].Path, Title: metas[i].Title,
			Genre: metas[i].Genre, Summary: metas[i].Snippet,
		})
	}
	return rows
}
