// visitor_chat_prompt.go —— builds the system prompt's base persona + cited helpers.
//
// Assembly order (inside registry.ComposeSystemPrompt):
//   ComposeBasePersona(snapshot)
//   + each capability's SystemPromptFragment (registration order)
//
// ComposeBasePersona = visitorHeader + role.PromptBody + skillPrompts.
// Tool usage instructions go through the capability fragment (the retrieval cap
// contributes the descriptions for the three corpus_search/read/list tools), not in
// base.
//
// The dev endpoint (/internal/test/visitor-capabilities) goes through the same
// ComposeBasePersona + registry.ComposeSystemPrompt as the real SendMessage, so its hash
// truly reflects the downstream prompt.

package usecase

import (
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// ComposeBasePersona —— the "non-capability" part of the system prompt: **who you are**
// + visitor header + role persona body + skill prompts. When snapshot is nil, returns
// only identity + header. Capability fragments are appended in order by
// registry.ComposeSystemPrompt.
//
// ownerName comes first (UX-66). The header demands, verbatim, "you ARE the owner,
// answer in first person" — yet never once says who the owner actually is —— identity
// used to be delivered purely as a side effect of retrieval: the public identity used to
// be able to read the whole wiki, and any random note would surface the person. Once the
// public slice was narrowed down to only what the owner actually published, this
// instance was left with 1 entry that didn't mention him at all, so the AI would tell a
// stranger "there's no one named Sijie in my notes." **A promise needs a mechanism to
// back it**: the name comes from the owner's own field, independent of corpus scope.
func ComposeBasePersona(snapshot *access.RoleSnapshot, ownerName string) string {
	parts := appendTrimmed([]string{}, ownerIdentity(ownerName))
	parts = append(parts, visitorHeader())
	parts = append(parts, snapshotPromptParts(snapshot)...)
	return strings.Join(parts, "\n\n---\n\n")
}

// ownerIdentity —— the "who you are" sentence. When the name is empty (an instance
// that hasn't finished being claimed) → empty string, excluded from the join, so the old
// prompt stays byte-identical (keeps system-prompt-hash-regression honest).
func ownerIdentity(ownerName string) string {
	name := strings.TrimSpace(ownerName)
	if name == "" {
		return ""
	}
	return "You are " + name + ". That is your name, and it is true whether or not the corpus " +
		"happens to mention it — never tell a visitor you don't know who " + name + " is, or " +
		"that there's no such person in your notes. What you may not know is any particular " +
		"fact about your life that the corpus doesn't hold; say that plainly when it comes up."
}

// ComposeDynamicPersona —— the dynamic part of role: **who you are** + PromptBody +
// SkillPrompts, without visitor-header (that goes through a fragment id). When the
// frontend pi-agent-core assembles the system prompt, it treats this segment as the
// inline persona block, combined with the .md fragments pulled by part_ids to form the
// full system prompt.
//
// Difference from ComposeBasePersona: base includes visitor-header; dynamic doesn't
// (to avoid duplication, since the frontend already fetches visitor-header via
// part_ids).
//
// Identity needs a copy **here** too (UX-66): a real visitor's prompt goes through this
// path, base only serves diag and standalone launch. The name can't be baked into a
// static .md fragment (it has to be fetched per-owner), so it belongs to this inline
// persona segment.
func ComposeDynamicPersona(snapshot *access.RoleSnapshot, ownerName string) string {
	parts := appendTrimmed([]string{}, ownerIdentity(ownerName))
	parts = append(parts, snapshotPromptParts(snapshot)...)
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "\n\n---\n\n")
}

// snapshotPromptParts —— role persona body + this code's own prompt (#104) + each skill
// prompt, trimmed of empties.
func snapshotPromptParts(snapshot *access.RoleSnapshot) []string {
	if snapshot == nil {
		return []string{}
	}
	out := make([]string, 0, 2+len(snapshot.SkillPrompts()))
	out = appendTrimmed(out, snapshot.PromptBody())
	// code prompt is layered on after role persona (specialize this code). Empty →
	// not appended, so a non-code / no-code-prompt session's persona stays
	// byte-identical (keeps system-prompt-hash-regression honest).
	out = appendTrimmed(out, snapshot.CodePromptBody())
	for _, p := range snapshot.SkillPrompts() {
		out = appendTrimmed(out, p)
	}
	return out
}

// appendTrimmed —— only appends if non-empty after trim (an empty persona segment
// doesn't enter the join, keeping it byte-stable).
func appendTrimmed(out []string, s string) []string {
	if t := strings.TrimSpace(s); t != "" {
		return append(out, t)
	}
	return out
}

func visitorHeader() string {
	// Phase D-1: single source prompts/visitor-header.md
	return owner.MustLoadPromptFragment("visitor-header")
}

// CitedRef —— citation info pushed to the frontend in the done event: id + title. On
// /dialogs commit the frontend POSTs the retriever's accumulated cited list up in this
// shape.
type CitedRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}
