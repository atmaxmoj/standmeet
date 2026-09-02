// note_assets.go —— the media attached to one corpus entry: attach it, list it, and
// have it go away with the entry.
//
// **Media is attached to its article.** It isn't its own independent thing, so there is
// no such concept as "media's own permissions" here — there shouldn't be one. If there
// were, it would mean media had come loose from its article: the owner revokes a wiki
// entry from an access code, but an image embedded in it is still reachable — then that
// "revoke" is a lie.
//
// Two invariants, one source:
//
//	lifetime    blob lifetime ⊆ entry lifetime — the entry is gone, its bytes go too
//	visibility  blob visibility ⊆ entry visibility — only reading the entry gets you the URL
//
// The visibility invariant **is not judged here**: media's only exit is "read the entry,
// and get its media along with it." Reading the entry has already gone through ACL, and
// media hangs off it, inheriting naturally. There is no second path that fetches media by
// id — not building that path is more reliable than building it and then guarding it.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
)

// NoteAssetsDeps —— what these media operations need.
type NoteAssetsDeps struct {
	Assets AssetsDeps
	Hero   *repo.NoteHeroRepo
}

// AttachAssetInput —— attach a piece of media to a corpus entry.
type AttachAssetInput struct {
	OwnerID  string
	NoteID   string
	URL      string
	Kind     string
	Filename string
}

// AttachAsset —— fetches a piece of media by URL and attaches it to this entry.
//
// The order is **confirm the entry exists first**, then fetch the bytes: attaching to a
// nonexistent entry must be rejected, rather than fetching first and landing an unclaimed
// piece of media — that kind of row is an orphan nobody will ever look at again.
func AttachAsset(
	ctx context.Context, deps *NoteAssetsDeps, in *AttachAssetInput,
) (entity.Asset, error) {
	if _, err := deps.Hero.Get(ctx, in.OwnerID, in.NoteID); err != nil {
		return entity.Asset{}, fmt.Errorf("attach asset: %w", err)
	}
	media, ferr := FetchMedia(ctx, &FetchMediaInput{
		URL: in.URL, Kind: in.Kind, Filename: in.Filename,
	})
	if ferr != nil {
		return entity.Asset{}, ferr
	}
	return storeAsset(ctx, deps.Assets, in, &media)
}

// AttachBytesInput —— the owner picked a local file in the admin panel; the bytes are
// already in hand.
type AttachBytesInput struct {
	OwnerID     string
	NoteID      string
	Kind        string
	Filename    string
	ContentType string
	Body        []byte
}

// AttachAssetBytes —— attaches a file handed in directly to this entry.
//
// Two intake routes for the same thing as [AttachAsset]: what the owner gives via the AI
// is a URL (the image lives on an image host), what the owner gives via the panel is
// bytes (the file lives on their machine). Both routes **converge on the same
// storeAsset** — confirm the entry exists, then insert the row, then upload the blob,
// then compensate on failure. Writing this as two separate implementations would leave
// one of the two routes running an unverified write order.
func AttachAssetBytes(
	ctx context.Context, deps *NoteAssetsDeps, in *AttachBytesInput,
) (entity.Asset, error) {
	if _, err := deps.Hero.Get(ctx, in.OwnerID, in.NoteID); err != nil {
		return entity.Asset{}, fmt.Errorf("attach asset: %w", err)
	}
	media, aerr := AcceptMedia(&AcceptMediaInput{
		Filename: in.Filename, Kind: in.Kind, DeclaredCT: in.ContentType, Body: in.Body,
	})
	if aerr != nil {
		return entity.Asset{}, aerr
	}
	return storeAsset(ctx, deps.Assets, &AttachAssetInput{
		OwnerID: in.OwnerID, NoteID: in.NoteID, Kind: in.Kind, Filename: in.Filename,
	}, &media)
}

// storeAsset —— the DB row lands first, the blob uploads after. If the upload fails, the
// row is deleted.
//
// This order turns the failure mode from "unclaimed bytes sitting in MinIO nobody
// recognizes" into "a DB row pointing at nothing" — the latter is visible and can be
// deleted; the former can only be found by scanning.
func storeAsset(
	ctx context.Context, deps AssetsDeps, in *AttachAssetInput, media *FetchedMedia,
) (entity.Asset, error) {
	prepared, ierr := insertOneAsset(ctx, deps, in.NoteID, media, kindOrImage(in.Kind))
	if ierr != nil {
		return entity.Asset{}, ierr
	}
	if _, uerr := UploadBlobs(ctx, deps, []PreparedAsset{prepared}); uerr != nil {
		// Compensate: the bytes never made it up, so the row shouldn't stick around
		// either. The compensation itself can also fail — that leaves a row pointing at
		// nothing, and it has to be reported alongside, not swallowed under a bare
		// "upload failed."
		if _, derr := deps.Repo.DeleteByIDs(ctx, []string{prepared.Asset.ID}); derr != nil {
			return entity.Asset{}, fmt.Errorf("upload asset: %w (row left behind: %w)", uerr, derr)
		}
		return entity.Asset{}, fmt.Errorf("upload asset: %w", uerr)
	}
	return prepared.Asset, nil
}

// insertOneAsset —— pre-generates id + storage_key, lands one row (doesn't touch MinIO).
func insertOneAsset(
	ctx context.Context, deps AssetsDeps, noteID string, media *FetchedMedia, kind string,
) (PreparedAsset, error) {
	id, gerr := newAssetUUID()
	if gerr != nil {
		return PreparedAsset{}, gerr
	}
	asset, cerr := deps.Repo.Create(ctx, &repo.CreateAssetInput{
		ID: id, HolderID: noteID, StorageKey: noteID + "/" + id,
		ContentType: media.ContentType, SizeBytes: int64(len(media.Body)),
		SHA256: sha256Hex(media.Body), OriginalFilename: media.Filename, Kind: kind,
	})
	if cerr != nil {
		return PreparedAsset{}, fmt.Errorf("create asset row: %w", cerr)
	}
	return PreparedAsset{Asset: asset, Body: media.Body, ContentType: media.ContentType}, nil
}

func kindOrImage(k string) string {
	if k == "" {
		return entity.AssetKindImage
	}
	return k
}

// AssetView —— how a piece of media reads back. This is exactly what a download button
// needs: name, size, a reachable URL.
type AssetView struct {
	AssetID     string `json:"asset_id"`
	Kind        string `json:"kind"`
	ContentType string `json:"content_type"`
	Filename    string `json:"original_filename"`
	URL         string `json:"url"`
	SizeBytes   int64  `json:"size_bytes"`
}

// NoteAssets —— every piece of media on one corpus entry, with reachable URLs.
//
// The caller must have **already confirmed the reader can read this entry** — that's
// where visibility inheritance is settled; it isn't judged again here.
func NoteAssets(
	ctx context.Context, deps *NoteAssetsDeps, noteID string,
) ([]AssetView, error) {
	rows, err := deps.Assets.Repo.ListByHolder(ctx, noteID)
	if err != nil {
		return nil, fmt.Errorf("list note assets: %w", err)
	}
	out := make([]AssetView, 0, len(rows))
	for i := range rows {
		out = append(out, assetView(ctx, deps.Assets.Storage, &rows[i]))
	}
	return out, nil
}

func assetView(ctx context.Context, store *storage.Client, a *entity.Asset) AssetView {
	v := AssetView{
		AssetID: a.ID, Kind: a.Kind, ContentType: a.ContentType,
		Filename: a.OriginalFilename, SizeBytes: a.SizeBytes,
	}
	// Leave it blank if the URL can't be obtained: one piece of media failing to get a
	// URL shouldn't make the whole entry unreadable.
	if url, err := store.PresignedGetURL(ctx, a.StorageKey); err == nil {
		v.URL = url
	}
	return v
}

// NoteAssetURLs —— the standmeet-asset references in the body plus the hero image →
// reachable URLs. This is the table the body-rendering side needs.
func NoteAssetURLs(
	ctx context.Context, deps *NoteAssetsDeps, hero *entity.NoteHero,
) (map[string]string, error) {
	ids := ScanAssetReferences(hero.Body)
	if hero.CoverAssetID != "" {
		ids = append(ids, hero.CoverAssetID)
	}
	urls, err := ResolveAssetURLs(ctx, deps.Assets.Repo, deps.Assets.Storage, ids)
	if err != nil {
		return map[string]string{}, fmt.Errorf("resolve note asset urls: %w", err)
	}
	return urls, nil
}

// DeleteNoteAsset —— deletes **one specific** piece of media under this corpus entry.
//
// assetID comes from the caller, so it's looked up first in **this entry's own media
// table** — not found means not found, not "deleted someone else's." Media has no
// permissions of its own; its ownership has exactly one description: which entry it's
// attached to. Deleting straight by id would mean building a path that fetches media by
// id, and this package's header comment already ruled that path out.
//
// If the hero points at it, clear that too: a cover pointing at media that no longer
// exists renders as a broken image slot, and the owner has no way to tell why from the
// panel.
func DeleteNoteAsset(
	ctx context.Context, deps *NoteAssetsDeps, ownerID, noteID, assetID string,
) error {
	target, ferr := findHolderAsset(ctx, deps, noteID, assetID)
	if ferr != nil {
		return ferr
	}
	if derr := DeleteBlobsStrict(ctx, deps.Assets, []string{target.StorageKey}); derr != nil {
		return derr
	}
	if _, rerr := deps.Assets.Repo.DeleteByIDs(ctx, []string{target.ID}); rerr != nil {
		return fmt.Errorf("delete asset row: %w", rerr)
	}
	return clearHeroIfPointsAt(ctx, deps, ownerID, noteID, assetID)
}

func findHolderAsset(
	ctx context.Context, deps *NoteAssetsDeps, noteID, assetID string,
) (entity.Asset, error) {
	rows, err := deps.Assets.Repo.ListByHolder(ctx, noteID)
	if err != nil {
		return entity.Asset{}, fmt.Errorf("list note assets: %w", err)
	}
	for i := range rows {
		if rows[i].ID == assetID {
			return rows[i], nil
		}
	}
	return entity.Asset{}, fmt.Errorf("%w: no such asset on this entry", entity.ErrEntryNotFound)
}

func clearHeroIfPointsAt(
	ctx context.Context, deps *NoteAssetsDeps, ownerID, noteID, assetID string,
) error {
	cur, err := deps.Hero.Get(ctx, ownerID, noteID)
	if err != nil {
		return fmt.Errorf("read hero: %w", err)
	}
	if cur.CoverAssetID != assetID {
		return nil
	}
	empty := ""
	return SetNoteHero(ctx, deps, ownerID, noteID, &HeroPatch{CoverAssetID: &empty})
}

// DeleteNoteAssets —— deletes every piece of media under one corpus entry (blobs first,
// DB rows after).
//
// The order is deliberate: the blob's lifetime ⊆ the entry's lifetime. Reversing it would
// leave an orphan — DB deleted, bytes still there — that nobody recognizes and can only
// be found by scanning.
func DeleteNoteAssets(ctx context.Context, deps *NoteAssetsDeps, noteID string) error {
	rows, err := deps.Assets.Repo.ListByHolder(ctx, noteID)
	if err != nil {
		return fmt.Errorf("list note assets: %w", err)
	}
	keys := make([]string, 0, len(rows))
	for i := range rows {
		keys = append(keys, rows[i].StorageKey)
	}
	if derr := DeleteBlobsStrict(ctx, deps.Assets, keys); derr != nil {
		return derr
	}
	if _, rerr := deps.Assets.Repo.DeleteByHolder(ctx, noteID); rerr != nil {
		return fmt.Errorf("delete note asset rows: %w", rerr)
	}
	return nil
}

// SetNoteHero —— edits the hero section. **Overwrites only the fields given this time**:
// reads back the current value first, then writes the whole thing back. Otherwise an
// existing caller of corpus.update (one that carries no hero fields at all) would wipe
// out a hero the owner already set up.
func SetNoteHero(
	ctx context.Context, deps *NoteAssetsDeps, ownerID, noteID string, in *HeroPatch,
) error {
	cur, err := deps.Hero.Get(ctx, ownerID, noteID)
	if err != nil {
		return fmt.Errorf("read hero: %w", err)
	}
	in.applyTo(&cur)
	if serr := deps.Hero.Set(ctx, ownerID, noteID, &cur); serr != nil {
		return fmt.Errorf("write hero: %w", serr)
	}
	return nil
}

// HeroPatch —— which hero fields to change this time. nil = leave alone (not "clear").
type HeroPatch struct {
	CoverAssetID  *string
	CoverHeadline *string
	CoverHue      *string
}

// Touched —— whether hero is being changed at all this time. If everything is nil, skip
// the database read/write.
func (h *HeroPatch) Touched() bool {
	return h.CoverAssetID != nil || h.CoverHeadline != nil || h.CoverHue != nil
}

// applyTo —— overlays the fields given this time onto the current value. Whatever wasn't
// given stays as-is — that's exactly what nil means.
func (h *HeroPatch) applyTo(cur *entity.NoteHero) {
	overwrite(&cur.CoverAssetID, h.CoverAssetID)
	overwrite(&cur.CoverHeadline, h.CoverHeadline)
	overwrite(&cur.CoverHue, h.CoverHue)
}

func overwrite(dst, given *string) {
	if given != nil {
		*dst = *given
	}
}
