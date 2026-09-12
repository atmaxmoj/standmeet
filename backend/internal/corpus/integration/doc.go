// Package integration says where a corpus document came FROM.
//
// Two things live here, and they are the same subject from two sides: the Integration value
// objects a document carries (this note came from an Obsidian vault, at this path), and the
// sync-source shape that puts them there.
//
// This is the **ingest** direction, and it is the opposite of a supplier. A supplier is the
// host's hand reaching out on demand — a block asks it for a calendar's free/busy. A sync source
// is external content flowing in, on the owner's trigger, unrelated to any one chat. They answer
// the same three questions (name, kind, connected) and are otherwise nothing alike, which is why
// this belongs to corpus rather than to the supplier layer.
package integration
