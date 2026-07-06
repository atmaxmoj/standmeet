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

	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/storage"
	"github.com/atmaxmoj/standmeet/internal/usecases"
	"github.com/atmaxmoj/standmeet/internal/usecases/obsidian"
)

// ObsidianDeps —— admin obsidian handlers 依赖。
type ObsidianDeps struct {
	Writings   *postgres.WritingRepo
	Assets     *postgres.AssetRepo
	Storage    *storage.Client
	Corpus     usecases.CorpusDeps // sync face: VaultSync(notes) + Raw + WikiRefs(refs)
	WritingsTx usecases.WritingsTxDeps
}

// rawSyncAdapter —— obsidian.SyncRawPort over RawRepo：raw/ 文件追加进 inbox，source 标 vault 来源。
type rawSyncAdapter struct{ raw *postgres.RawRepo }

func (a rawSyncAdapter) UpsertFromVault(
	ctx context.Context, ownerID, sourcePath, body string, tags []string,
) error {
	if _, err := a.raw.Create(ctx, &postgres.CreateRawInput{
		OwnerID: ownerID, Body: body, Source: "obsidian:" + sourcePath, Tags: tags,
	}); err != nil {
		return fmt.Errorf("sync raw: %w", err)
	}
	return nil
}

// refsSyncAdapter —— obsidian.SyncRefsPort over RebuildNoteRefs：整批 upsert 后重建一条的出度边。
type refsSyncAdapter struct{ deps usecases.CorpusDeps }

func (a refsSyncAdapter) RebuildForNote(ctx context.Context, ownerID, noteID, body string) error {
	if err := usecases.RebuildNoteRefs(ctx, a.deps, ownerID, noteID, body); err != nil {
		return fmt.Errorf("sync refs: %w", err)
	}
	return nil
}

// writingsSyncAdapter —— obsidian.SyncWritingsPort over ImportVault：writing/ 子树 → writings 表。
type writingsSyncAdapter struct {
	tx     usecases.WritingsTxDeps
	setter *postgres.WritingRepo
}

func (a writingsSyncAdapter) ImportWritings(
	ctx context.Context, ownerID string, files []obsidian.VaultFile,
) obsidian.ImportResult {
	return obsidian.ImportVault(ctx, a.tx, a.setter, ownerID, files)
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
}

func (h *Handlers) importObsidian() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		files, err := parseImportMultipart(w, r)
		if err != nil {
			writeError(h.Log, w, envBadReq(err.Error()))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		result := obsidian.SyncVault(r.Context(), obsidian.SyncDeps{
			Notes:    h.Obsidian.Corpus.VaultSync,
			Raw:      rawSyncAdapter{raw: h.Obsidian.Corpus.Raw},
			Refs:     refsSyncAdapter{deps: h.Obsidian.Corpus},
			Writings: writingsSyncAdapter{tx: h.Obsidian.WritingsTx, setter: h.Obsidian.Writings},
		}, ownerID, files)
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
		Skipped: r.Skipped, Errors: errs,
	}
	if err := json.NewEncoder(w).Encode(view); err != nil {
		logEncodeErr(log, "encode import result", err)
	}
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
	if len(parts) == 2 && !obsidian.IsVaultTopFolder(parts[0]) {
		return parts[1]
	}
	return name
}
