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
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
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
		New: res.Created, Updated: res.Updated, Skipped: res.Skipped,
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

// parseImportMultipart —— **流式**读 part,不用 ParseMultipartForm。
//
// 为什么不能用 ParseMultipartForm:它把整个表单先缓冲下来,而 Go 的 mime/multipart.ReadForm 对
// 一张表单的 part 数有个 **1000 的硬上限**,超了整个请求报 "message too large"。那个数字我们从
// 没声明过,也调不了 —— 而本文件声明的 maxObsidianImportSize 是**字节**(200MB),跟它毫不相干。
// 结果就是:一个 574 wiki + 435 raw 的真实 vault(过完客户端过滤 1033 个文件)导不进来,而负载
// 只有 6.2MB,连声明额度的 4% 都不到。实测边界:999 个 part 成功,1001 个 part 400(F-L-20)。
//
// 换成 NextPart() 逐个读,是把「自建 git 服务怎么吞一个仓库」翻译过来:forge 收 packfile 是
// **一个流、边读边处理**,对象再多也碰不到任何 part 计数 —— 因为它压根不把请求拆成 N 份缓冲。
// 这里同理:一次一个 part,读完就转成 VaultFile,没有全表单物化,也就没有份数上限。
// 字节数仍由 MaxBytesReader 兜住,那才是我们**声明过**的那道限制。
func parseImportMultipart(
	w http.ResponseWriter, r *http.Request,
) ([]obsidian.VaultFile, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxObsidianImportSize)
	mr, merr := r.MultipartReader()
	if merr != nil {
		return nil, fmt.Errorf("parse multipart: %w", merr)
	}
	return streamVaultFiles(mr, r)
}

// streamVaultFiles —— 逐个 part 读完整个请求,读一个丢一个,不留整表单。
func streamVaultFiles(mr *multipart.Reader, r *http.Request) ([]obsidian.VaultFile, error) {
	acc := &vaultParts{files: make([]obsidian.VaultFile, 0), form: url.Values{}}
	for {
		p, err := mr.NextPart()
		if err != nil {
			return acc.done(err, r)
		}
		acc.take(p)
	}
}

// vaultParts —— 流式读的累加器。读错先记下来,等流走完再一起报:半路 return 会把剩下的 part
// 留在连接上,客户端拿到的是一个断掉的写。
type vaultParts struct {
	err   error
	form  url.Values
	files []obsidian.VaultFile
}

func (a *vaultParts) take(p *multipart.Part) {
	defer closeBestEffort(p)
	body, rerr := io.ReadAll(p)
	if rerr != nil {
		a.err = fmt.Errorf("read vault file %q: %w", p.FormName(), rerr)
		return
	}
	a.put(p.FormName(), p.FileName(), body)
}

// put —— 有 filename 的是 vault 文件;其余是普通表单值(authoritative 就走这条)。
// field 名携带完整 rel;剥可能的 vault-name 前缀让 path 从 vault root 算起(genre 前缀保留)。
func (a *vaultParts) put(name, filename string, body []byte) {
	if filename == "" {
		a.form.Set(name, string(body))
		return
	}
	a.files = append(a.files, obsidian.VaultFile{
		RelPath: normalizeVaultRel(name), Body: body,
	})
}

// done —— 流结束。非文件 part 回填进 r.Form:走 MultipartReader 之后 r.FormValue 不再自己解析,
// 不回填的话 authoritative 标记会静默丢失,一次「整个 vault」的同步就退化成只增不删。
func (a *vaultParts) done(err error, r *http.Request) ([]obsidian.VaultFile, error) {
	r.Form = a.form
	if a.err != nil {
		return nil, a.err
	}
	if !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("parse multipart: %w", err)
	}
	return a.files, nil
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
