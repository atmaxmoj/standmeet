package entity

import (
	"encoding/json"
	"errors"
)

// MicrositeDocument — one stored document in a microsite's persistence namespace, paired with its
// record id. The store is NoSQL: a document is opaque JSON the page defines; the id is a stable
// handle the owner's management view uses to delete one row. Each page's documents live in the
// page's OWN Postgres schema (page_<id>, the capstore pattern) — physical isolation, not a shared
// table keyed by id, dropped with the page.
type MicrositeDocument struct {
	ID         string
	Collection string
	Doc        json.RawMessage
}

// ErrMicrositeStoreQuota — the page already holds the maximum number of documents; a new write is
// refused so one page can't grow storage without bound (an abuse/leak guard).
var ErrMicrositeStoreQuota = errors.New("page store is full")

// ErrMicrositeStoreNotWritable — the owner has not opened this page's store to visitor writes.
var ErrMicrositeStoreNotWritable = errors.New("page store is not open for writes")
