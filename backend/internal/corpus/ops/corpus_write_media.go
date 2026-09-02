// corpus_write_media.go — the half of corpus writes that deals with **media**: the hero
// block, and media getting deleted along with an entry.
//
// hero and the entry itself are **two different things**, so the write paths must stay
// separate too: the entry half is a "full replace" (a field that isn't given is cleared),
// the hero half is "only overwrite what's given this time". Mixing the two into one
// replace produces an ugly result — the owner just wanted to set a picture on a wiki entry,
// and instead the title and body got wiped by an empty payload.
//
// The reverse must also hold: an existing caller (editing the body, carrying no hero
// fields at all) must not wipe out a hero the owner already set. So the three hero fields
// in the input are pointers, nil = leave alone.

package ops

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// heroPatch — which hero fields this call is changing.
func (a *corpusWriteArgs) heroPatch() usecase.HeroPatch {
	return usecase.HeroPatch{
		CoverAssetID: a.CoverImageAssetID, CoverHeadline: a.CoverHeadline, CoverHue: a.CoverHue,
	}
}

// entryTouched — whether this call touches the entry itself (as opposed to only
// touching hero).
//
// A hero-only edit must not also run a full replace as a side effect: that would wipe the
// entry with an empty title/body — "just gave it a picture" turns into "wiped it clean".
func (a *corpusWriteArgs) entryTouched() bool {
	given := []bool{
		a.Title != "", a.Body != "", a.ParentID != nil,
		len(a.Tags) > 0, len(a.CSSClasses) > 0, a.ShowAsSource != nil, a.FlaggedPrivate != nil,
	}
	for _, g := range given {
		if g {
			return true
		}
	}
	return false
}

// applyCorpusUpdate — hero and the entry itself are two separate things, and land
// separately.
//
// Given only hero fields, change only hero, then read the entry's current value back as
// the response — instead of running a full replace with an empty payload.
func applyCorpusUpdate(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	hero := in.heroPatch()
	if !hero.Touched() {
		return updateByGenre(ctx, deps, ownerID, in)
	}
	if err := writeHero(ctx, deps, ownerID, in.ID, &hero); err != nil {
		return corpusItemOut{}, err
	}
	if in.entryTouched() {
		return updateByGenre(ctx, deps, ownerID, in)
	}
	return getByGenre(ctx, deps, ownerID, corpusGetArgs{Genre: in.Genre, ID: in.ID})
}

func writeHero(
	ctx context.Context, deps usecase.Deps, ownerID, id string, hero *usecase.HeroPatch,
) error {
	if !deps.HasMedia() {
		return fp.OpErr("set hero", errNoMedia)
	}
	return usecase.SetNoteHero(ctx, deps.Media, ownerID, id, hero)
}

// dropEntryAssets — cleans out an entry's media before deleting the entry itself.
//
// Media goes first, the entry goes second. Doing it the other way around leaves an orphan
// — "entry deleted, bytes still there" — bytes nobody can identify anymore, recoverable
// only by scanning; doing it this order instead just leaves a corpus entry missing its
// picture, which is visible and fixable.
func dropEntryAssets(ctx context.Context, deps usecase.Deps, id string) error {
	if !deps.HasMedia() {
		return nil
	}
	return usecase.DeleteNoteAssets(ctx, deps.Media, id)
}
