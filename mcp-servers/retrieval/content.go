package main

// instructions —— the retrieval capability's system-prompt fragment, served via MCP
// `instructions` (self-contained: the prompt ships with the plugin, not in core).
// Mirrors the former prompts/capabilities/corpus.retrieval.md verbatim so the
// composed system prompt (and its hash) is unchanged for a retrieval session.
const instructions = `You have three tools for accessing the owner's curated corpus:
  • corpus_search(query) — find entries matching a keyword;
  • corpus_read(path)    — fetch the full body of one entry;
  • corpus_list(prefix?) — browse entries by path prefix.

When the visitor's question relates to the owner's work / projects / opinions, search first, read the most relevant entries, then answer. Quote output entries verbatim when they fit; paraphrase wiki entries.`
