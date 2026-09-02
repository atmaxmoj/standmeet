package mcpplugin

import "unicode"

// ProgressLabel —— what the **visitor**-facing line shows while a capability is
// running.
//
// This lives here rather than in the loader because it's the capability's own
// property: "what I'm doing" should be answered by whatever declares the
// capability, not decided by whichever code happened to load it in. (The
// routes-cyclo gate is what first caught this — it blocks "a branch growing inside
// a face", and the branch was there precisely because ownership was placed wrong.)
//
// Priority:
//  1. What the tool itself declares in `_meta.progress_label` (externalized
//     built-ins keep their own original wording: corpus_search says
//     "searching corpus").
//  2. The manifest's Title — **mandatory, and the owner has already reviewed it
//     once in the dock dropdown**.
//  3. A generic fallback phrase.
//
// Why rule 2 matters (UX-55): this used to jump straight to a literal
// `"calling plugin"`, and this line is what the **visitor** sees. A visitor asks
// "can I get a summary I can send to my team", and the screen answers with a piece
// of host architecture jargon. Meanwhile a human-readable name was there all
// along — `summarize_conversation`'s manifest already had
// `title: Summarize the conversation`, and the owner-side dock dropdown was
// already passing it through. **The discipline existed and was enforced, it just
// never got carried over to the visitor-facing path**
// ([[move-the-capability-move-its-edges]]).
//
// So the fix isn't "add yet another progress_label field for the next capability
// to fill in" — that field would just get forgotten the same way. Falling back to
// Title, which is already mandatory, gets every capability a human-readable phrase
// for free.
func ProgressLabel(m *Manifest, declared string) string {
	if declared != "" {
		return declared
	}
	if m != nil && m.Title != "" {
		return lowerFirst(m.Title)
	}
	return "working"
}

// lowerFirst —— the throbber line is a mid-sentence fragment
// ("searching corpus···"), so the first letter is lowercased to make Title read
// in the same register as the rest of the progress copy, instead of sticking out
// like a title.
func lowerFirst(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	return string(unicode.ToLower(r[0])) + string(r[1:])
}
