// obsidian.go — admin /obsidian endpoint: export vault as zip / import vault
// from multipart upload.
//
// GET  /api/admin/obsidian/export  → an application/zip stream (inside the zip:
//                                    writings/<slug>.md + attachments/<id>.<ext>)
// POST /api/admin/obsidian/import  → multipart form-data, each file field carries its
//                                    path relative to the vault (webkitRelativePath);
//                                    response JSON { created, updated, skipped, errors }
//
// The shape matches mainstream practice (Quartz / obsidian-importer): each button is its
// own batch, owner-triggered, no file watcher / live sync.

package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/connector"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/obsidian"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// ObsidianDeps — dependencies for the admin obsidian handlers.
type ObsidianDeps struct {
	Writings   *corpus.WritingRepo
	Assets     *corpus.AssetRepo
	Storage    *storage.Client
	Corpus     corpus.Deps    // sync face: VaultSync(notes) + Raw + WikiRefs(refs)
	CSS        owner.CSSStore // .obsidian/snippets harvest → owner CSS
	WritingsTx corpus.WritingsTxDeps
	// PagePins — sync is published's third write path (frontmatter can flip publish);
	// after a batch reconcile, stale pins get swept to keep pinned ⊆ published (the
	// render-time filter is only a fallback).
	PagePins owner.PagePinDeps
	// ImportReceipt — where the fact "when was the last import" lands (UX-62). Without
	// it, an instance holding 1028 notes and an empty instance look identical on this
	// screen.
	ImportReceipt owner.VaultImportStore
	Log           *slog.Logger
}

// cssSyncAdapter — SyncCSSPort: harvested CSS goes through SetOwnerCSS (sanitize+scope).
type cssSyncAdapter struct{ store owner.CSSStore }

func (a cssSyncAdapter) SetCSS(ctx context.Context, ownerID, rawCSS string) error {
	if err := owner.SetOwnerCSS(ctx, a.store, ownerID, rawCSS); err != nil {
		return fmt.Errorf("sync css: %w", err)
	}
	return nil
}

// refsSyncAdapter — obsidian.SyncRefsPort over RebuildNoteRefs: rebuilds one note's
// outbound edges after a batch upsert.
type refsSyncAdapter struct{ deps corpus.Deps }

func (a refsSyncAdapter) RebuildForNote(ctx context.Context, ownerID, noteID, body string) error {
	if err := corpus.RebuildNoteRefs(ctx, a.deps, ownerID, noteID, body); err != nil {
		return fmt.Errorf("sync refs: %w", err)
	}
	return nil
}

// writingsSyncAdapter — obsidian.SyncWritingsPort over ImportVault: the writing/ subtree
// → the writings table.
type writingsSyncAdapter struct {
	tx     corpus.WritingsTxDeps
	setter *corpus.WritingRepo
}

func (a writingsSyncAdapter) ImportWritings(
	ctx context.Context, ownerID string, files []obsidian.VaultFile,
) obsidian.ImportResult {
	return obsidian.ImportVault(ctx, a.tx, a.setter, ownerID, files)
}

// *ObsidianDeps IS the corpus sync-mode connector's ingester (#28 step 2): the vault-sync feed
// folds through the connector layer's SyncIngester abstraction instead of the route calling
// SyncVault inline. The DTOs (SyncFile/SyncResult) match obsidian's 1:1 — a trivial rename at the
// boundary that keeps the connector layer usecase-independent.
var _ connector.SyncIngester = (*ObsidianDeps)(nil)

// toSyncFiles converts parsed vault files → connector-layer DTOs (RelPath/Body match 1:1).
func toSyncFiles(files []obsidian.VaultFile) []connector.SyncFile {
	out := make([]connector.SyncFile, len(files))
	for i, f := range files {
		out[i] = connector.SyncFile{RelPath: f.RelPath, Body: f.Body}
	}
	return out
}

// Ingest — connector.SyncIngester: build the vault SyncDeps, run the sync, rebuild the
// index.
func (d *ObsidianDeps) Ingest(
	ctx context.Context, ownerID string, files []connector.SyncFile, opts connector.SyncOpts,
) (connector.SyncResult, error) {
	vfiles := make([]obsidian.VaultFile, len(files))
	for i, f := range files {
		vfiles[i] = obsidian.VaultFile{RelPath: f.RelPath, Body: f.Body}
	}
	res := obsidian.SyncVault(ctx, &obsidian.SyncDeps{
		Notes:    d.Corpus.VaultSync,
		Refs:     refsSyncAdapter{deps: d.Corpus},
		Writings: writingsSyncAdapter{tx: d.WritingsTx, setter: d.Writings},
		CSS:      cssSyncAdapter{store: d.CSS},
	}, ownerID, vfiles, obsidian.SyncMode{Authoritative: opts.Authoritative})
	// After a batch sync, rebuild the whole Meili index (reflects additions/edits/
	// deletions, leaves no drift). Best-effort.
	corpus.ReindexCorpusOwner(ctx, d.Corpus, ownerID)
	d.sweepPinsAfterSync(ctx, ownerID)
	d.recordImportReceipt(ctx, ownerID, &res)
	return connector.SyncResult{
		Created: res.Created, Updated: res.Updated, Skipped: res.Skipped,
		Deleted: res.Deleted, Errors: res.Errors,
	}, nil
}

// recordImportReceipt records this import (UX-62).
//
// Best-effort, same as reindex / sweepPins: **a bookkeeping failure must not turn a
// successful import into a failed one** — the notes are already in the database; a
// missing receipt is a loss of observability, not a loss of data. But it must **make
// noise**.
func (d *ObsidianDeps) recordImportReceipt(
	ctx context.Context, ownerID string, res *obsidian.ImportResult,
) {
	if d.ImportReceipt == nil {
		return
	}
	d.logReceiptErr(d.ImportReceipt.RecordVaultImport(ctx, ownerID, owner.VaultImportReceipt{
		New: res.Created, Updated: res.Updated, Skipped: res.Skipped, Deleted: res.Deleted,
	}))
}

// logReceiptErr — a bookkeeping failure only makes noise; it never changes this import's
// outcome.
func (d *ObsidianDeps) logReceiptErr(err error) {
	if err == nil || d.Log == nil {
		return
	}
	d.Log.Error("record vault import receipt", "err", err)
}

// sweepPinsAfterSync — sync may unpublish/delete an already-pinned entry → sweeps the
// homepage's pins (pinned ⊆ published). Best-effort.
func (d *ObsidianDeps) sweepPinsAfterSync(ctx context.Context, ownerID string) {
	if serr := owner.SweepPagePins(ctx, d.PagePins, ownerID); serr != nil && d.Log != nil {
		d.Log.Error("sweep page pins after vault sync", "err", serr)
	}
}

// 200 MB — the whole vault uploaded at once, bigger than a writing save.
const maxObsidianImportSize = 200 << 20

// MountObsidian mounts the /obsidian subrouter.
func (h *Handlers) MountObsidian(r chi.Router) {
	r.Route("/obsidian", func(r chi.Router) {
		r.Get("/export", h.exportObsidian())
		r.Post("/import", h.importObsidian())
		// state — "when was the last import" (UX-62). This screen previously had
		// **no** past tense at all: the moment the import-finished count faded from
		// the screen, an instance with 1028 notes looked identical to an empty one.
		r.Get("/state", h.obsidianState())
	})
}

// The read facade for that question (`GET /obsidian/state`) lives in
// obsidian_state.go: this file is the action, that one is the fact about the action.

func (h *Handlers) exportObsidian() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="standmeet-vault.zip"`)
		deps := obsidian.ExportDeps{
			Writings: h.Obsidian.Writings, Assets: h.Obsidian.Assets, Storage: h.Obsidian.Storage,
			Corpus: h.Obsidian.Corpus.VaultSync,
		}
		if err := obsidian.WriteZip(r.Context(), deps, ownerID, w); err != nil {
			logEncodeErr(h.Log, "obsidian export", err)
			// The headers are already flushed; all we can do here is stop writing —
			// the client gets a truncated zip.
		}
	}
}

type importResultView struct {
	Errors  []string `json:"errors"`
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Skipped int      `json:"skipped"`
	// Deleted —— notes pruned because they are gone from the vault (F-L-6). Surfaced so a sync that
	// removes things says so out loud instead of deleting silently.
	Deleted int `json:"deleted"`
}

// vaultImportWriteBudget — how long a single vault import is allowed to take to write.
//
// `http.Server.WriteTimeout` is **30 seconds**, pressed onto every response. That's
// reasonable for a regular endpoint, but not for this one: its duration scales with the
// owner's vault size, and a real vault (1082 entries) measured in at 16–30 seconds —
// constantly pressed against the wall. Hitting it is hard to recognize: the server cuts
// the connection, the browser sees a network error, and **the import actually finished**
// (the database is already written, only the receipt fails to write out, and the log
// shows "context canceled"). The owner thinks it failed and imports again.
//
// This is the same class of bug as F-L-7 (the 1000-part wall): a number nobody ever
// declared, breaking a real-scale vault. It's also the same fix as the agent-turn case
// (`extendStreamWriteDeadline`): push out **this connection's** write deadline, and hand
// the real limit off to ctx.
const vaultImportWriteBudget = 10 * time.Minute

func (h *Handlers) importObsidian() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		extendImportWriteDeadline(h.Log, w)
		files, err := parseImportMultipart(w, r)
		if err != nil {
			writeError(h.Log, w, envBadReq(err.Error()))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		var ingester connector.SyncIngester = &h.Obsidian // fold through the sync-mode connector
		res, err := ingester.Ingest(
			r.Context(), ownerID, toSyncFiles(files),
			connector.SyncOpts{Authoritative: isAuthoritativeUpload(r)},
		)
		if err != nil {
			writeError(h.Log, w, envBadReq(err.Error()))
			return
		}
		result := obsidian.ImportResult{
			Created: res.Created, Updated: res.Updated, Skipped: res.Skipped,
			Deleted: res.Deleted, Errors: res.Errors,
		}
		writeImportJSON(h.Log, w, &result)
	}
}

// extendImportWriteDeadline pushes this connection's write deadline out to
// vaultImportWriteBudget. A writer that doesn't support a deadline (httptest, etc.)
// returns ErrNotSupported — just log a line for it.
func extendImportWriteDeadline(log *slog.Logger, w http.ResponseWriter) {
	rc := http.NewResponseController(w)
	if err := rc.SetWriteDeadline(time.Now().Add(vaultImportWriteBudget)); err != nil {
		log.Warn("vault import: extend write deadline unsupported (capped at server WriteTimeout)",
			"err", err)
	}
}

func writeImportJSON(log *slog.Logger, w http.ResponseWriter, r *obsidian.ImportResult) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	errs := r.Errors
	if errs == nil {
		errs = []string{} // JSON: don't let a nil slice serialize to null; clients expect []
	}
	view := importResultView{
		Created: r.Created, Updated: r.Updated,
		Skipped: r.Skipped, Deleted: r.Deleted, Errors: errs,
	}
	if err := json.NewEncoder(w).Encode(view); err != nil {
		logEncodeErr(log, "encode import result", err)
	}
}

// isAuthoritativeUpload —— the `authoritative` form field: "this upload IS the whole vault", so
// notes absent from it were deleted from the vault and get pruned (F-L-6). The owner's
// directory-picker import sets it. OPT-IN, defaulting to false: the safe reading of a subset is
// "a partial feed", and guessing "authoritative" would delete the rest of the corpus.
// Missing/garbage → false (see sync-h-reconcile's partial-never-delete guard).
func isAuthoritativeUpload(r *http.Request) bool {
	return r.FormValue("authoritative") == "true"
}

// The streaming multipart read lives in obsidian_multipart.go — how a request with
// thousands of parts gets read without materializing the whole thing is a different
// concern from orchestrating these two endpoints.
