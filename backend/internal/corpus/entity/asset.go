// asset.go —— metadata for owner-uploaded binaries (images/attachments). Bytes
// land in MinIO; this only carries the PG-side row. posts/wiki/raw reference
// via asset_id; the backend presigns the URL on demand, the frontend never
// touches storage credentials directly.

package entity

import (
	"errors"
	"time"
)

// Asset —— value object for the assets table. HolderID is the id of the entity
// this asset belongs to (post.id / wiki.id / ...). Owner is looked up indirectly
// via holder → holder.owner_id.
type Asset struct {
	CreatedAt        time.Time
	ID               string
	HolderID         string
	StorageKey       string
	ContentType      string
	SHA256           string
	OriginalFilename string
	// Kind —— 'image' (inline body image / hero) | 'attachment' (downloadable file).
	// What types and how big are allowed is split by this: a video is inherently
	// bigger than an image, so sharing one size cap between the two effectively
	// bans video.
	Kind      string
	SizeBytes int64
}

// Asset kinds —— what types and how big are allowed is split by this.
const (
	AssetKindImage      = "image"      // inline body image / hero
	AssetKindAttachment = "attachment" // downloadable attachment (PDF etc.)
)

// ErrEntryNotFound —— a corpus entry lookup by id missed (**cross-genre**). An
// asset attaches to a corpus entry, and at attach time only the id is known;
// each genre has its own not-found sentinel, but "the entry an asset should
// attach to isn't there" is the same situation across all of them.
var ErrEntryNotFound = errors.New("corpus entry not found")

// ErrAssetNotFound —— the asset id doesn't exist / doesn't belong to this owner.
var ErrAssetNotFound = errors.New("asset not found")

// NoteHero —— a note's hero section, plus its body (which carries
// standmeet-asset references inline).
//
// A hero isn't "just an image": by design it's the image + the headline overlaid
// on it + the hue, all three together. All three live on the shared corpus_notes
// table, so **any genre can have one** — previously only the writing path wrote them.
type NoteHero struct {
	Body          string
	CoverAssetID  string
	CoverHeadline string
	CoverHue      string
}

// ErrMediaRejected —— this piece of media is rejected (type not on the allowlist /
// bytes don't match the declared size / over the size cap / unreachable / not
// https). All of these are problems with **what the caller supplied**, not a
// local fault — it should surface as 4xx.
var ErrMediaRejected = errors.New("media rejected")
