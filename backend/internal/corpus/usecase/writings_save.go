// writings_save.go — transactional writing create / update / delete with assets.
//
// Entry point: admin POST/PATCH /api/admin/writings takes multipart (writing JSON +
// inline image files keyed by a client-side pending UUID); the route layer parses it
// into a SaveWritingInput → here:
//
//   CREATE/UPDATE: 1) tx: insert writing shell + asset rows (uuid pre-generated,
//   storage_key fixed, not yet PUT to MinIO) + update body_md (pending-id → real uuid)
//   2) commit 3) only then does UploadBlobs push the bytes to MinIO 4) upload failure →
//   compensating DeleteWritingWithAssets rolls the writing back, plus a best-effort
//   delete of whichever blobs already made it up
//
//   DELETE: 1) list storage_keys (no tx) 2) DeleteBlobsStrict against MinIO (any
//   failure aborts immediately, DB untouched) 3) tx: DELETE asset rows + writing row
//
// Invariant: a blob's lifetime ⊆ a writing's lifetime — wherever MinIO has a blob, the
// DB must have the matching writing + asset row. Failure mode: "silent MinIO orphan"
// becomes "visibly broken writing" or an "owner-retryable delete".

package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// FileInput — one uploaded image. PendingID is the client-side UUID the frontend editor
// assigns; body_md / cover_image_ref write `pending-<id>` (the raw id, no
// `standmeet-asset:` prefix — body_md writes the full `standmeet-asset:pending-<id>`).
type FileInput struct {
	PendingID        string
	ContentType      string
	OriginalFilename string
	Body             []byte
}

// SaveWritingInput — shared by create + update. Empty WritingID = create, non-empty = update.
// CoverImageRef: a pending-<id> placeholder, an existing asset's real UUID, or empty (no cover).
type SaveWritingInput struct {
	BodyMD        string
	CoverImageRef string
	LockedBody    string
	OwnerID       string
	WritingID     string
	Slug          string
	Visibility    string
	Title         string
	CoverHue      string
	Excerpt       string
	CoverHeadline string
	ParentID      string
	Tags          []string
	CrossRefs     []string
	Files         []FileInput
	Publish       bool
}

// saveCommitted — shared return of runSaveInTx / saveInTxAndCommit: Prepared holds
// already-inserted asset rows + bytes awaiting upload, pushed to MinIO once tx commits.
type saveCommitted struct {
	Prepared []PreparedAsset
	Writing  entity.Writing
}

// SaveWriting — one entry point handles both create and update. Order: tx (insert
// writing + insert asset rows + update body_md) → commit → UploadBlobs. An upload
// failure does a compensating DeleteWritingWithAssets to roll the writing back.
func SaveWriting(
	ctx context.Context, deps WritingsTxDeps, in *SaveWritingInput,
) (entity.Writing, error) {
	if verr := validateSaveInput(in); verr != nil {
		return entity.Writing{}, verr
	}
	if perr := validateWritingParent(ctx, deps, in); perr != nil {
		return entity.Writing{}, perr
	}
	committed, terr := saveInTxAndCommit(ctx, deps, in)
	if terr != nil {
		return entity.Writing{}, terr
	}
	if err := uploadAndCompensate(ctx, deps, in.OwnerID, &committed); err != nil {
		return entity.Writing{}, err
	}
	return committed.Writing, nil
}

// validateSaveInput — create + update share one entry point, but slug is only taken from
// the input on the create path (the edit UI's slug field is readonly, so the client no
// longer sends it); on update, loadExistingWriting reads slug back from the DB, so
// input.Slug being empty at this point is legitimate.
func validateSaveInput(in *SaveWritingInput) error {
	if in.OwnerID == "" || in.Title == "" {
		return apierr.ErrEmptyField
	}
	if in.WritingID == "" && in.Slug == "" {
		return apierr.ErrEmptyField
	}
	return nil
}

// saveInTxAndCommit — open a tx → write writing + write asset rows + write body_md →
// commit. Doesn't touch MinIO. Returns the prepared bytes still awaiting upload after
// commit.
func saveInTxAndCommit(
	ctx context.Context, deps WritingsTxDeps, in *SaveWritingInput,
) (saveCommitted, error) {
	tx, err := deps.Writings.Pool().Begin(ctx)
	if err != nil {
		return saveCommitted{}, fmt.Errorf("begin tx: %w", err)
	}
	res, serr := runSaveInTx(ctx, deps, tx, in)
	if serr != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			_ = rerr
		}
		return saveCommitted{}, serr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return saveCommitted{}, fmt.Errorf("commit save writing: %w", cerr)
	}
	return res, nil
}

// uploadAndCompensate — after the tx commits, actually PUTs the bytes to MinIO. Any
// failure triggers a compensating delete: first undo-delete whichever blobs already
// uploaded (best-effort), then cascade-delete the writing + all its asset rows.
func uploadAndCompensate(
	ctx context.Context, deps WritingsTxDeps, ownerID string, c *saveCommitted,
) error {
	done, uerr := UploadBlobs(ctx, deps.Assets, c.Prepared)
	if uerr == nil {
		return nil
	}
	DeleteBlobs(ctx, deps.Assets, done)
	// A failed orphan-row cleanup can't be swallowed: the writing row would point at a
	// deleted blob. This layer has no logger, so the cleanup failure is folded into the
	// returned error and logged at the boundary instead (a better fit for this arch than
	// slog.Default).
	if derr := DeleteWritingWithAssets(ctx, deps, ownerID, c.Writing.ID()); derr != nil {
		return fmt.Errorf(
			"upload blobs: %w; orphan writing-row cleanup also failed: %w", uerr, derr,
		)
	}
	return fmt.Errorf("upload blobs: %w", uerr)
}

func runSaveInTx(
	ctx context.Context, deps WritingsTxDeps, tx pgx.Tx, in *SaveWritingInput,
) (saveCommitted, error) {
	writing, perr := upsertWritingShell(ctx, deps, tx, in)
	if perr != nil {
		return saveCommitted{}, perr
	}
	prepared, ierr := insertAssetsForWriting(ctx, deps, tx, writing.ID(), in.Files)
	if ierr != nil {
		return saveCommitted{}, ierr
	}
	finalWriting, werr := writeWritingBody(ctx, &writeBodyArgs{
		Deps: deps, Tx: tx, Writing: &writing, In: in, Rewrite: rewriteFromPrepared(prepared),
	})
	if werr != nil {
		return saveCommitted{Writing: finalWriting, Prepared: prepared}, werr
	}
	if lerr := refreshCrossLinks(ctx, deps, tx, &finalWriting); lerr != nil {
		return saveCommitted{Writing: finalWriting, Prepared: prepared}, lerr
	}
	return saveCommitted{Writing: finalWriting, Prepared: prepared}, nil
}

// refreshCrossLinks — extracts `[[X]]` from finalWriting.BodyMD (already rewritten for
// pending-asset / cover refs), resolves each to another writing.id by slug / title, and
// rebuilds this src's outgoing edges in the writing_refs table. HasCrossLinks short-circuits
// so a writing with no links doesn't also pay for the owner-writings list query.
func refreshCrossLinks(
	ctx context.Context, deps WritingsTxDeps, tx pgx.Tx, writing *entity.Writing,
) error {
	writingID := writing.ID()
	writingOwner := writing.OwnerID()
	writingBody := writing.Body()
	if !HasCrossLinks(writingBody) {
		// The body has no [[ ]] — still need to clear any edges that used to be stored
		// (also covers the owner having deleted a link).
		if err := deps.WritingRefs.ReplaceRefsBySrcTx(
			ctx, tx, writingID, writingOwner, []string{},
		); err != nil {
			return fmt.Errorf("clear crosslinks: %w", err)
		}
		return nil
	}
	candidates, lerr := deps.Writings.ListByOwner(ctx, writingOwner)
	if lerr != nil {
		return fmt.Errorf("list owner writings for crosslink resolve: %w", lerr)
	}
	dstIDs := resolveAndDedupForOwner(writingBody, candidates)
	// Exclude self-links (src == dst) — meaningless, and it would make the backlink UI
	// show the writing pointing at itself.
	dstIDs = excludeSelf(dstIDs, writingID)
	if err := deps.WritingRefs.ReplaceRefsBySrcTx(
		ctx, tx, writingID, writingOwner, dstIDs,
	); err != nil {
		return fmt.Errorf("rewrite crosslinks: %w", err)
	}
	return nil
}

func excludeSelf(ids []string, selfID string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != selfID {
			out = append(out, id)
		}
	}
	return out
}

// rewriteFromPrepared — builds a pending-id → real-id replacement map from the
// PreparedAsset list (the PendingID field was already passed through in InsertAssetRowTx).
func rewriteFromPrepared(prepared []PreparedAsset) map[string]string {
	rewrite := make(map[string]string, len(prepared))
	for i := range prepared {
		rewrite[prepared[i].PendingID] = prepared[i].Asset.ID
	}
	return rewrite
}

// upsertWritingShell — step one: insert/update the writing row (body_md still carries
// pending placeholders, cover_image_asset_id set to NULL). This step exists only to get
// a writing.id so later asset rows have a holder_id to hang off; body_md / cover get
// their real write in writeWritingBody.
func upsertWritingShell(
	ctx context.Context, deps WritingsTxDeps, tx pgx.Tx, in *SaveWritingInput,
) (entity.Writing, error) {
	if in.WritingID == "" {
		p, err := deps.Writings.CreateTx(ctx, tx, buildShellCreateInput(in))
		if err != nil {
			return entity.Writing{}, fmt.Errorf("create writing: %w", err)
		}
		return p, nil
	}
	return loadExistingWriting(ctx, deps, in)
}

func buildShellCreateInput(in *SaveWritingInput) *repo.CreateWritingInput {
	// path is no longer a stored column: now that writing folds into corpus_notes, it's
	// derived from slug as "writings/"+slug.
	return &repo.CreateWritingInput{
		OwnerID: in.OwnerID, Slug: in.Slug, Title: in.Title, Excerpt: in.Excerpt,
		BodyMD: "", CoverHeadline: in.CoverHeadline,
		CoverHue: in.CoverHue, CoverImageAssetID: nil,
		Tags: in.Tags, Visibility: in.Visibility, CrossRefs: in.CrossRefs,
		ReadMinutes: 0, LockedBody: in.LockedBody, Publish: in.Publish,
		ParentID: in.ParentID,
	}
}

func loadExistingWriting(
	ctx context.Context, deps WritingsTxDeps, in *SaveWritingInput,
) (entity.Writing, error) {
	p, err := deps.Writings.GetByID(ctx, in.OwnerID, in.WritingID)
	if err != nil {
		return entity.Writing{}, fmt.Errorf("load existing writing: %w", err)
	}
	return p, nil
}

// insertAssetsForWriting — inserts each asset row inside the tx (doesn't touch MinIO).
// PendingID is passed through into PreparedAsset; the caller (writeWritingBody) builds
// the rewrite map from it on the spot via rewriteFromPrepared.
func insertAssetsForWriting(
	ctx context.Context, deps WritingsTxDeps, tx pgx.Tx,
	writingID string, files []FileInput,
) ([]PreparedAsset, error) {
	prepared := make([]PreparedAsset, 0, len(files))
	for i := range files {
		f := &files[i]
		p, err := InsertAssetRowTx(ctx, deps.Assets, tx, writingID, &AssetUploadInput{
			Body: f.Body, ContentType: f.ContentType,
			OriginalFilename: f.OriginalFilename, PendingID: f.PendingID,
		})
		if err != nil {
			return prepared, fmt.Errorf("insert asset %s: %w", f.PendingID, err)
		}
		prepared = append(prepared, p)
	}
	return prepared, nil
}

// writeBodyArgs — the parameter bundle for writeWritingBody, dodging the argument-limit-5 lint.
type writeBodyArgs struct {
	Rewrite map[string]string
	Tx      pgx.Tx
	Writing *entity.Writing
	In      *SaveWritingInput
	Deps    WritingsTxDeps
}

// writeWritingBody — uses the rewrite map to swap pending placeholders for real asset
// ids, then writes the final body_md + cover_image_asset_id.
func writeWritingBody(ctx context.Context, a *writeBodyArgs) (entity.Writing, error) {
	body := rewriteRefs(a.In.BodyMD, a.Rewrite)
	cover := rewriteCoverRef(a.In.CoverImageRef, a.Rewrite)
	p, err := a.Deps.Writings.UpdateTx(ctx, a.Tx, &repo.UpdateWritingInput{
		OwnerID: a.In.OwnerID, WritingID: a.Writing.ID(), Title: a.In.Title,
		Excerpt: a.In.Excerpt, BodyMD: body,
		CoverHeadline: a.In.CoverHeadline,
		CoverHue:      a.In.CoverHue, CoverImageAssetID: cover,
		Tags: a.In.Tags, Visibility: a.In.Visibility, CrossRefs: a.In.CrossRefs,
		ReadMinutes: estimateReadMinutes(body),
		LockedBody:  a.In.LockedBody, ParentID: effectiveWritingParent(a),
	})
	if err != nil {
		return entity.Writing{}, fmt.Errorf("update writing body: %w", err)
	}
	return p, nil
}

// rewriteRefs — replaces standmeet-asset:pending-<id> with standmeet-asset:<real-id>
// throughout body_md.
func rewriteRefs(body string, rewrite map[string]string) string {
	for pendingID, realID := range rewrite {
		body = strings.ReplaceAll(body,
			AssetURIScheme+pendingID, AssetURIScheme+realID)
	}
	return body
}

func rewriteCoverRef(ref string, rewrite map[string]string) *string {
	if ref == "" {
		return nil
	}
	resolved := ref
	if realID, ok := rewrite[ref]; ok {
		resolved = realID
	}
	return &resolved
}

// DeleteWritingWithAssets lives in writings_delete.go.
