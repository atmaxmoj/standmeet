// timestamps.go —— the timestamps sub-object shared across corpus documents.
//
// One Timestamps is shared across every Genre. PublishedAt is stored internally as a
// nilable *time.Time — always nil for Genres with no publish concept (currently Raw /
// Wiki / Output). Raw has no UpdatedAt field of its own (it never changes once dumped);
// the LSP boundary documents this as Raw.UpdatedAt() == Raw.CreatedAt() — when Raw wraps
// Timestamps it stuffs the same time into both created and updated.
//
// PublishedAt returns (time.Time, bool) rather than *time.Time — this avoids exposing a
// pointer / letting internal state get mutated via *p = newVal; callers write
// `if t, ok := x.PublishedAt(); ok { ... }`, which reads more idiomatic Go than
// `if p := x.PublishedAt(); p != nil { ... }`.

package entity

import "time"

// Timestamps —— the trio of created/updated/published timestamps.
type Timestamps struct {
	createdAt   time.Time
	updatedAt   time.Time
	publishedAt *time.Time
}

// TimestampsInit —— constructor params. PublishedAt is nilable (nil means unpublished).
type TimestampsInit struct {
	CreatedAt   time.Time
	UpdatedAt   time.Time
	PublishedAt *time.Time
}

// NewTimestamps —— builds a Timestamps from Init; PublishedAt gets an internal defensive
// copy (deref the caller's pointer and re-allocate, to prevent *p = newVal mutation).
func NewTimestamps(i *TimestampsInit) Timestamps {
	t := Timestamps{
		createdAt: i.CreatedAt,
		updatedAt: i.UpdatedAt,
	}
	if i.PublishedAt != nil {
		cp := *i.PublishedAt
		t.publishedAt = &cp
	}
	return t
}

// CreatedAt —— creation timestamp. Required for every Genre.
func (t Timestamps) CreatedAt() time.Time { return t.createdAt }

// UpdatedAt —— last-updated time. For Raw, the caller feeds this the same value as
// createdAt when calling NewTimestamps (LSP contract: Raw is immutable, so updated ==
// created).
func (t Timestamps) UpdatedAt() time.Time { return t.updatedAt }

// PublishedAt —— publish time, returned as (time.Time, bool); ok=false means unpublished.
// Defensive copy: returns a value, not the internal *time.Time, so callers never get the
// internal pointer.
func (t Timestamps) PublishedAt() (time.Time, bool) {
	if t.publishedAt == nil {
		return time.Time{}, false
	}
	return *t.publishedAt, true
}

// IsPublished —— whether this is published. A boolean-only version of PublishedAt(), for
// frontend views assembling JSON / list filters — reads better than the (_, ok) idiom
// everywhere.
func (t Timestamps) IsPublished() bool {
	return t.publishedAt != nil
}
