package entity

import (
	"encoding/json"
	"errors"
	"time"
)

// MicrositeDocument — one stored document in a microsite's persistence namespace, paired with its
// record id. The store is NoSQL: a document is opaque JSON the page defines; the id is a stable
// handle the owner's management view uses to delete one row. Each page's documents live in the
// page's OWN Postgres schema (page_<id>, the blockstore pattern) — physical isolation, not a shared
// table keyed by id, dropped with the page.
type MicrositeDocument struct {
	CreatedAt  time.Time
	ID         string
	Collection string
	Doc        json.RawMessage
}

// ErrMicrositeStoreQuota — the page already holds the maximum number of documents; a new write is
// refused so one page can't grow storage without bound (an abuse/leak guard).
var ErrMicrositeStoreQuota = errors.New("page store is full")

// ErrMicrositeStoreNotWritable — the owner has not opened this page's store to visitor writes.
var ErrMicrositeStoreNotWritable = errors.New("page store is not open for writes")

// StorePolicy — the owner's rules for one page's store: at most MaxDocs documents, and with Review
// on a new document waits (pending) until the owner approves it.
type StorePolicy struct {
	MaxDocs int32 `json:"max_docs"`
	Review  bool  `json:"review"`
}

// DefaultStorePolicy — a page whose owner never set a policy.
var DefaultStorePolicy = StorePolicy{MaxDocs: 500}

// DocAuthor — who wrote a document, stamped by the host from the session (never from the body).
type DocAuthor struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	MemberID string `json:"member_id,omitempty"`
}

// Author kinds: a visitor writing by hand, the agent writing for a visitor, the owner.
const (
	AuthorMember = "member"
	AuthorAgent  = "agent"
	AuthorOwner  = "owner"
)

// Document status (host key `_status`): visible to visitors, or waiting for the owner.
const (
	DocPublished = "published"
	DocPending   = "pending"
)
