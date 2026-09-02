// content.go —— the "content" sub-object shared by Wiki / Output / Writing: title + body
// + tags.
//
// LSP contract:
//   - Title carries the same "human-readable label" semantics across Genres, and can be
//     an empty string (Raw has no title field, so it skips this layer and uses an empty
//     value — but Raw doesn't go through the Content sub-object at all; it handles body
//     directly, since the Raw shape has no title concept to begin with).
//   - Body carries the same "the document's primary text content" semantics across
//     Genres. For Writing it's the raw markdown; for Wiki/Output it's the plain-text
//     body.
//   - Tags always returns a non-nil slice (defensive copy).

package entity

import "slices"

// Content —— the content portion of a corpus document.
type Content struct {
	title, body string
	tags        []string
	cssClasses  []string
}

// ContentInit —— constructor params.
type ContentInit struct {
	Title, Body string
	Tags        []string
	CSSClasses  []string
}

// NewContent —— builds a Content; Tags / CSSClasses are defensively cloned into internal
// storage, keeping the non-nil invariant intact. Pointer param, matching the other NewX
// constructors.
func NewContent(i *ContentInit) Content {
	return Content{
		title: i.Title, body: i.Body,
		tags: cloneNonNil(i.Tags), cssClasses: cloneNonNil(i.CSSClasses),
	}
}

func cloneNonNil(s []string) []string {
	if len(s) == 0 {
		return []string{}
	}
	return slices.Clone(s)
}

// Title —— the document title. Raw implements this as "".
func (c *Content) Title() string { return c.title }

// Body —— the document's main text. Each of Wiki / Output / Writing's own "source text".
func (c *Content) Body() string { return c.body }

// Tags —— the tag list. Always returns a non-nil slice (empty returns []string{} too).
// Defensive copy, so callers mutating the result can't touch internal state.
func (c *Content) Tags() []string {
	return slices.Clone(c.tags)
}

// CSSClasses —— per-note cssclasses (a presentation hook). Always returns a non-nil
// slice. Defensive copy.
func (c *Content) CSSClasses() []string {
	return slices.Clone(c.cssClasses)
}

// HasTag —— whether a given tag is present. For callers filtering, so they don't have to
// range + compare by hand.
func (c *Content) HasTag(tag string) bool {
	return slices.Contains(c.tags, tag)
}
