// obsidian.go —— admin /obsidian endpoint: export vault as zip / import vault
// from multipart upload。
//
// GET  /api/admin/obsidian/export  → application/zip 流（zip 内 writings/<slug>.md
//                                    + attachments/<id>.<ext>）
// POST /api/admin/obsidian/import  → multipart form-data，每个 file field
//                                    携带 vault 内相对路径（webkitRelativePath）；
//                                    response JSON { created, updated, skipped, errors }
//
// 形态对齐主流做法（Quartz / obsidian-importer）：两个 button 各自 batch，
// owner 触发，没有 file watcher / live sync。

package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/connector"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/obsidian"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// ObsidianDeps —— admin obsidian handlers 依赖。
type ObsidianDeps struct {
	Writings   *corpus.WritingRepo
	Assets     *corpus.AssetRepo
	Storage    *storage.Client
	Corpus     corpus.Deps    // sync face: VaultSync(notes) + Raw + WikiRefs(refs)
	CSS        owner.CSSStore // .obsidian/snippets harvest → owner CSS
	WritingsTx corpus.WritingsTxDeps
	// PagePins —— sync 是 published 的第三条写路径(frontmatter 可翻 publish);
	// 批量 reconcile 后清扫失效 pin,保住 pinned ⊆ published(渲染过滤只是兜底)。
	PagePins owner.PagePinDeps
	Log      *slog.Logger
}

// cssSyncAdapter —— SyncCSSPort:harvest 的 CSS 经 SetOwnerCSS(sanitize+scope)。
type cssSyncAdapter struct{ store owner.CSSStore }

func (a cssSyncAdapter) SetCSS(ctx context.Context, ownerID, rawCSS string) error {
	if err := owner.SetOwnerCSS(ctx, a.store, ownerID, rawCSS); err != nil {
		return fmt.Errorf("sync css: %w", err)
	}
	return nil
}

// refsSyncAdapter —— obsidian.SyncRefsPort over RebuildNoteRefs：整批 upsert 后重建一条的出度边。
type refsSyncAdapter struct{ deps corpus.Deps }

func (a refsSyncAdapter) RebuildForNote(ctx context.Context, ownerID, noteID, body string) error {
	if err := corpus.RebuildNoteRefs(ctx, a.deps, ownerID, noteID, body); err != nil {
		return fmt.Errorf("sync refs: %w", err)
	}
	return nil
}

// writingsSyncAdapter —— obsidian.SyncWritingsPort over ImportVault：writing/ 子树 → writings 表。
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

// toSyncFiles —— parsed vault files → connector-layer DTOs (RelPath/Body match 1:1).
func toSyncFiles(files []obsidian.VaultFile) []connector.SyncFile {
	out := make([]connector.SyncFile, len(files))
	for i, f := range files {
		out[i] = connector.SyncFile{RelPath: f.RelPath, Body: f.Body}
	}
	return out
}

// Ingest —— connector.SyncIngester: build the vault SyncDeps, run the sync, rebuild the index.
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
	// 批量 sync 后整批重建 Meili index(反映新增/改/删,漂移不留)。best-effort。
	corpus.ReindexCorpusOwner(ctx, d.Corpus, ownerID)
	d.sweepPinsAfterSync(ctx, ownerID)
	return connector.SyncResult{
		Created: res.Created, Updated: res.Updated, Skipped: res.Skipped,
		Deleted: res.Deleted, Errors: res.Errors,
	}, nil
}

// sweepPinsAfterSync —— sync 可能 unpublish/删除已 pin 条目 → 清扫主页 pin
// (pinned ⊆ published)。best-effort。
func (d *ObsidianDeps) sweepPinsAfterSync(ctx context.Context, ownerID string) {
	if serr := owner.SweepPagePins(ctx, d.PagePins, ownerID); serr != nil && d.Log != nil {
		d.Log.Error("sweep page pins after vault sync", "err", serr)
	}
}

const maxObsidianImportSize = 200 << 20 // 200 MB — vault 整个上传，比 writing save 大。

// MountObsidian 挂 /obsidian 子路由。
func (h *Handlers) MountObsidian(r chi.Router) {
	r.Route("/obsidian", func(r chi.Router) {
		r.Get("/export", h.exportObsidian())
		r.Post("/import", h.importObsidian())
	})
}

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
			// header 已 flush 出去；这里只能停止写，client 拿到 truncated zip。
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

func (h *Handlers) importObsidian() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

func writeImportJSON(log *slog.Logger, w http.ResponseWriter, r *obsidian.ImportResult) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	errs := r.Errors
	if errs == nil {
		errs = []string{} // JSON: 别让 nil slice 序列化成 null，client 都按 [] 处理
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

func parseImportMultipart(
	w http.ResponseWriter, r *http.Request,
) ([]obsidian.VaultFile, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxObsidianImportSize)
	// #nosec G120 -- 上游 MaxBytesReader bound。
	if err := r.ParseMultipartForm(maxObsidianImportSize); err != nil {
		return nil, fmt.Errorf("parse multipart: %w", err)
	}
	if r.MultipartForm == nil {
		return []obsidian.VaultFile{}, nil
	}
	return collectVaultFiles(r.MultipartForm.File)
}

func collectVaultFiles(
	fileMap map[string][]*multipart.FileHeader,
) ([]obsidian.VaultFile, error) {
	out := make([]obsidian.VaultFile, 0)
	for field, fhs := range fileMap {
		next, err := appendHeaderBatch(out, field, fhs)
		if err != nil {
			return nil, err
		}
		out = next
	}
	return out, nil
}

func appendHeaderBatch(
	out []obsidian.VaultFile, field string, fhs []*multipart.FileHeader,
) ([]obsidian.VaultFile, error) {
	for _, fh := range fhs {
		vf, err := readVaultFile(field, fh)
		if err != nil {
			return nil, err
		}
		out = append(out, vf)
	}
	return out, nil
}

// readVaultFile —— vault 内相对路径来自**form field 名**(不是 filename)：Go 的 multipart.FileName()
// 会 filepath.Base 掉目录(防穿越),路径存不下;所以 client 把 webkitRelativePath 放进 field 名传来。
func readVaultFile(field string, fh *multipart.FileHeader) (obsidian.VaultFile, error) {
	f, oerr := fh.Open()
	if oerr != nil {
		return obsidian.VaultFile{}, fmt.Errorf("open vault file: %w", oerr)
	}
	defer closeBestEffort(f)
	body, rerr := io.ReadAll(f)
	if rerr != nil {
		return obsidian.VaultFile{}, fmt.Errorf("read vault file: %w", rerr)
	}
	// field 名携带完整 rel;剥可能的 vault-name 前缀让 path 从 vault root 算起(genre 前缀保留)。
	return obsidian.VaultFile{RelPath: normalizeVaultRel(field), Body: body}, nil
}

func closeBestEffort(c io.Closer) {
	if err := c.Close(); err != nil {
		_ = err
	}
}

// normalizeVaultRel —— webkitRelativePath 首段若是 vault 文件夹名(非 genre)则剥掉,让 path 从
// vault root 算起(owner 选 my-vault/,filename = "my-vault/wiki/x.md" → "wiki/x.md")。首段本身就是
// genre(wiki/…,如直接上传或测试)则原样保留 —— 否则 genre 会被误当 vault 名剥掉。
func normalizeVaultRel(name string) string {
	parts := strings.SplitN(name, "/", 2)
	if len(parts) == 2 && stripsVaultPrefix(parts[0]) {
		return parts[1]
	}
	return name
}

// stripsVaultPrefix —— 首段是要剥的 vault 文件夹名:既非 genre 又非 dotdir(.obsidian config 要留)。
func stripsVaultPrefix(seg string) bool {
	return !obsidian.IsVaultTopFolder(seg) && !strings.HasPrefix(seg, ".")
}
