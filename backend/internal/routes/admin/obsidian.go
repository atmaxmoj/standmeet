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
	// ImportReceipt —— 「上一次导入」这个事实的落点（UX-62）。没有它，装着 1028 条
	// 笔记的实例和一个空实例在这一屏上长得一模一样。
	ImportReceipt owner.VaultImportStore
	Log           *slog.Logger
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
	d.recordImportReceipt(ctx, ownerID, &res)
	return connector.SyncResult{
		Created: res.Created, Updated: res.Updated, Skipped: res.Skipped,
		Deleted: res.Deleted, Errors: res.Errors,
	}, nil
}

// recordImportReceipt —— 把这一次导入记下来（UX-62）。
//
// best-effort，跟 reindex / sweepPins 一样：**记账失败不该让一次成功的导入变成失败** ——
// 笔记已经进库了，回执没写上是可观测性的损失，不是数据的损失。但它必须**出声**。
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

// logReceiptErr —— 记账失败只出声，不改变这一次导入的结局。
func (d *ObsidianDeps) logReceiptErr(err error) {
	if err == nil || d.Log == nil {
		return
	}
	d.Log.Error("record vault import receipt", "err", err)
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
		// state —— 「上一次导入是什么时候」（UX-62）。这一屏此前**没有任何**过去时态：
		// 导入完屏幕上那行计数刷新就没，于是 1028 条笔记的实例跟空实例长得一样。
		r.Get("/state", h.obsidianState())
	})
}

// 那一问的读面（`GET /obsidian/state`）住在 obsidian_state.go：这里是动作，那里是
// 关于动作的事实。

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

// vaultImportWriteBudget —— 一次 vault 导入允许写多久。
//
// `http.Server.WriteTimeout` 是 **30 秒**，压在每一条响应上。对常规 endpoint 合理，对这一条
// 不是：它的耗时随 owner 的 vault 大小长，而真 vault（1082 篇）实测就在 16–30 秒这一档 ——
// 一直贴着墙。撞上去的样子很难认：服务端把连接掐了，浏览器拿到的是一个网络错误，
// 而**导入其实做完了**（库里已经写好，只有回执写不出去，日志里是 "context canceled"）。
// owner 会以为失败了，然后再导一次。
//
// 这跟 F-L-7（1000 个 part 的墙）是同一类：一个没人声明过的数字，让真实规模的 vault 用不了。
// 也跟 agent turn 那次（`extendStreamWriteDeadline`）是同一个解法：把**这条连接**的写期限推开，
// 真正的上限交给 ctx。
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

// extendImportWriteDeadline —— 把这条连接的写期限推到 vaultImportWriteBudget。
// 不支持 deadline 的 writer（httptest 等）返 ErrNotSupported —— 记一行即可。
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

// multipart 的流式读取住在 obsidian_multipart.go —— 一个上千 part 的请求怎么读完
// 而不整份物化，是跟这两个 endpoint 的编排不同的一件事。
