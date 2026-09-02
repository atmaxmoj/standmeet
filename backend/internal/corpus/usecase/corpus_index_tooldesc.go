// corpus_index_tooldesc.go —— **the sentence the agent reads** for the corpus search tool.
//
// Split out of corpus_index_socket.go: that file is the wiring (who runs, what it's
// called, how the params parse), this file is the **basis for choosing**. The agent
// decides which retrieval path to use at the moment it reads this description, so the
// wording is as much a part of the product as runtime behavior is — not a comment. Kept
// separate so editing the description never touches the wiring, and editing the wiring
// never accidentally shortens the description.

package usecase

// searchToolDesc —— the description of corpus_search. **Must say up front that it can
// miss** (F-S-2).
//
// This is a lexical index: whether something hits depends on the tokenizer, and anything
// the tokenizer can't cut (a substring inside a word, a term glued to punctuation, a CJK
// bigram) simply won't be found — an empty result therefore does **not** mean the topic
// is absent from the corpus. Real evidence: `递归收敛` returned `[]` against a corpus
// containing a full Chinese passage, while an English query in the same turn got back
// 7883 bytes, and the agent had no way to know it should switch paths — half the question
// went silently unanswered.
//
// The name needs to appear in this sentence: corpus_grep is the second path (never-miss)
// built for exactly this. **The hint can only live here**: the "empty scope must return
// `[]`" wire is pinned down by `tool-endpoint-corpus.spec.ts:146`, and that constraint is
// legitimate — so today "nothing in scope" and "the tokenizer can't represent it" are
// squeezed into the same value and can't be told apart. Separating them means giving the
// search tool a second "why is it empty" channel, which is a product decision, tracked
// under F-S-2.
const searchToolDesc = "Search the corpus under this session's ACL scope. This is a lexical " +
	"index, so a hit depends on how the text was tokenized: substrings inside a word, terms " +
	"glued to punctuation, and CJK bigrams can all miss. An empty result therefore does NOT " +
	"mean the corpus lacks the topic — when it comes back empty and you still believe the " +
	"material exists, use corpus_grep, which is literal and never-miss."
