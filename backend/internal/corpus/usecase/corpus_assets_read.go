// corpus_assets_read.go —— reading one corpus entry also reads the assets attached to it.
//
// **Visibility inheritance lives here.** Assets have no ACL of their own, and shouldn't:
// their only exit is "you read the entry, so you also get its assets." By the time the
// visitor path reaches this point, ACL has already been decided — someone who can't read
// the entry never gets here, so "can't read the article -> gets zero assets" is
// **structurally guaranteed**, not a second check.
//
// The flip side: if a second path resolved asset addresses directly by asset id, this
// inheritance would break — an owner could revoke a wiki entry from a code and the image
// embedded in it would still be reachable. So that path does not exist.
//
// The owner surface and the visitor surface read the **same** thing: both go through here
// instead of each assembling their own view (assembling separately is how you get a
// runtime-only divergence like "visible on the admin panel, missing for the visitor").

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
)

// NoteMediaView —— everything asset-related on one corpus entry: the hero trio (inside
// Hero), the asset list, and the addresses resolved from the standmeet-asset references
// in the body.
type NoteMediaView struct {
	URLs   map[string]string
	Hero   entity.NoteHero
	Assets []AssetView
}

// ready —— whether this wiring has asset storage attached. If not (some read-only paths
// don't), the asset read/write steps are skipped.
func (d *NoteAssetsDeps) ready() bool {
	return d != nil && d.Hero != nil && d.Assets.Repo != nil
}

// LoadNoteMedia —— reads the assets of one corpus entry. ok=false means the entry can't
// be read (no storage attached / not this owner's / doesn't exist); the caller treats
// that as "no assets."
//
// A problem with one asset drops only that one: a single image whose address can't be
// resolved must not make the whole entry unreadable.
func LoadNoteMedia(
	ctx context.Context, deps *NoteAssetsDeps, ownerID, noteID string,
) (NoteMediaView, bool) {
	out := NoteMediaView{Assets: []AssetView{}, URLs: map[string]string{}}
	if !deps.ready() {
		return out, false
	}
	hero, herr := deps.Hero.Get(ctx, ownerID, noteID)
	if herr != nil {
		return out, false
	}
	out.Hero = hero
	if urls, uerr := NoteAssetURLs(ctx, deps, &hero); uerr == nil {
		out.URLs = urls
	}
	if assets, aerr := NoteAssets(ctx, deps, noteID); aerr == nil {
		out.Assets = assets
	}
	return out, true
}

// assetReader —— a lister that can supply the assets of one corpus entry. pgCorpusLister
// implements it when asset storage is attached; agentcore's eval mini-host doesn't ->
// its results simply come back without the asset fields.
type assetReader interface {
	NoteMedia(ctx context.Context, ownerID, noteID string) ([]AssetView, map[string]string)
}

// NoteMedia —— when a visitor reads one corpus entry, its asset list plus the addresses
// resolved from its references.
func (l *pgCorpusLister) NoteMedia(
	ctx context.Context, ownerID, noteID string,
) ([]AssetView, map[string]string) {
	media, _ := LoadNoteMedia(ctx, l.media, ownerID, noteID)
	return media.Assets, media.URLs
}
