package entity

import (
	"encoding/json"
	"errors"
)

// PageDocument — one stored document in a custom page's persistence namespace, paired with its
// record id. The store is NoSQL: a document is opaque JSON the page defines; the id is a stable
// handle the owner's management view uses to delete one row. Each page's documents live in the
// page's OWN Postgres schema (page_<id>, the capstore pattern) — physical isolation, not a shared
// table keyed by id, dropped with the page.
type PageDocument struct {
	ID         string
	Collection string
	Doc        json.RawMessage
}

// ErrPageStoreQuota — the page already holds the maximum number of documents; a new write is
// refused so one page can't grow storage without bound (an abuse/leak guard).
var ErrPageStoreQuota = errors.New("page store is full")

// ErrPageStoreNotWritable — the owner has not opened this page's store to visitor writes.
var ErrPageStoreNotWritable = errors.New("page store is not open for writes")
