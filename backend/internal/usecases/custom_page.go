// custom_page.go —— custom_pages 全套 usecase。
//
// 流程：
//   1. CreatePage(slug)
//   2. WriteFile(page, path, content) 累计 source_files
//   3. Build(page) 落一条 pending build，builder 服务消费
//   4. GetBuild(buildID) 让 owner / MCP poll 状态
//   5. PromoteToStaging / PromoteToLive
//   6. Rollback / Delete

package usecases

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/owner"
)

// CustomPageDeps —— custom page usecase 依赖。
type CustomPageDeps struct {
	Pages  *owner.CustomPageRepo
	Builds *owner.CustomBuildRepo
}

// CreatePageInput —— 创建一个 custom page 入参。
type CreatePageInput struct {
	OwnerID string
	Slug    string
	Title   string
}

// CreatePage —— slug 必须 a-z0-9-，长度 ≤ 64。
func CreatePage(
	ctx context.Context, deps CustomPageDeps, in *CreatePageInput,
) (owner.CustomPage, error) {
	if err := validateSlug(in.Slug); err != nil {
		return owner.CustomPage{}, err
	}
	page, err := deps.Pages.Create(ctx, in.OwnerID, in.Slug, in.Title)
	if err != nil {
		return owner.CustomPage{}, fmt.Errorf("create page: %w", err)
	}
	return page, nil
}

// WriteFileInput —— 累计写一个文件到 page 的下一个 draft。
type WriteFileInput struct {
	OwnerID string
	Slug    string
	Path    string
	Content string
}

const (
	maxFiles        = 32
	maxFileBytes    = 64 * 1024
	maxTotalBytes   = 512 * 1024
	maxPathLen      = 256
	maxSlugLen      = 64
	maxErrorMessage = 2000
)

// WriteFile —— path 必须不含 '..' / 绝对路径；内容 ≤ 64KB；总 ≤ 512KB。
// 合并新 path/content 到上一个 build 的 source_files，落一条新 pending build。
func WriteFile(
	ctx context.Context, deps CustomPageDeps, in *WriteFileInput,
) (owner.CustomPageBuild, error) {
	if verr := validatePathContent(in.Path, in.Content); verr != nil {
		return owner.CustomPageBuild{}, verr
	}
	page, lerr := lookupPage(ctx, deps, in.OwnerID, in.Slug)
	if lerr != nil {
		return owner.CustomPageBuild{}, lerr
	}
	files, ferr := mergedDraft(ctx, deps, page.ID, in.Path, in.Content)
	if ferr != nil {
		return owner.CustomPageBuild{}, ferr
	}
	build, berr := deps.Builds.Create(ctx, page.ID, files)
	if berr != nil {
		return owner.CustomPageBuild{}, fmt.Errorf("create build: %w", berr)
	}
	return build, nil
}

// mergedDraft —— 加载上一次 source_files、merge 这次写入、校验 bundle 大小。
func mergedDraft(
	ctx context.Context, deps CustomPageDeps,
	pageID, path, content string,
) (map[string]string, error) {
	files, err := loadDraftFiles(ctx, deps, pageID)
	if err != nil {
		return nil, err
	}
	files[path] = content
	if verr := validateBundleSize(files); verr != nil {
		return nil, verr
	}
	return files, nil
}

// Build —— 显式触发一次 build：从 latest pending 落实变成 builder 可消费。
// 当前实现：直接返回 latest pending build（WriteFile 已经写了一条 pending）。
// 没有任何 pending 时返 ErrCustomPageBuildNotFound。
func Build(
	ctx context.Context, deps CustomPageDeps, ownerID, slug string,
) (owner.CustomPageBuild, error) {
	page, perr := lookupPage(ctx, deps, ownerID, slug)
	if perr != nil {
		return owner.CustomPageBuild{}, perr
	}
	build, berr := deps.Builds.GetLatestForPage(ctx, page.ID)
	if berr != nil {
		return owner.CustomPageBuild{}, fmt.Errorf("get latest build: %w", berr)
	}
	return build, nil
}

// GetBuild —— MCP poll 状态用。
func GetBuild(
	ctx context.Context, deps CustomPageDeps, buildID string,
) (owner.CustomPageBuild, error) {
	build, err := deps.Builds.GetByID(ctx, buildID)
	if err != nil {
		return owner.CustomPageBuild{}, fmt.Errorf("get build: %w", err)
	}
	return build, nil
}

// PromoteToStaging —— 把 build 设为 page 的 staging_build_id。
// build 必须属于该 page + status 必须 built。
func PromoteToStaging(
	ctx context.Context, deps CustomPageDeps, ownerID, slug, buildID string,
) (owner.CustomPage, error) {
	page, err := promoteCheck(ctx, deps, ownerID, slug, buildID)
	if err != nil {
		return owner.CustomPage{}, err
	}
	updated, perr := deps.Pages.SetStaging(ctx, page.ID, buildID)
	if perr != nil {
		return owner.CustomPage{}, fmt.Errorf("set staging: %w", perr)
	}
	return updated, nil
}

// PromoteToLive —— 同上 + 落 previous，让 Rollback 能用。
func PromoteToLive(
	ctx context.Context, deps CustomPageDeps, ownerID, slug, buildID string,
) (owner.CustomPage, error) {
	page, err := promoteCheck(ctx, deps, ownerID, slug, buildID)
	if err != nil {
		return owner.CustomPage{}, err
	}
	updated, perr := deps.Pages.SetLive(ctx, page.ID, buildID)
	if perr != nil {
		return owner.CustomPage{}, fmt.Errorf("set live: %w", perr)
	}
	return updated, nil
}

// Rollback —— previous_live_build_id 重新提到 live。
func Rollback(
	ctx context.Context, deps CustomPageDeps, ownerID, slug string,
) (owner.CustomPage, error) {
	page, err := lookupPage(ctx, deps, ownerID, slug)
	if err != nil {
		return owner.CustomPage{}, err
	}
	updated, rerr := deps.Pages.Rollback(ctx, page.ID)
	if rerr != nil {
		return owner.CustomPage{}, fmt.Errorf("rollback: %w", rerr)
	}
	return updated, nil
}

// DeletePage —— 软删（保留 build artifact 给 audit）。
func DeletePage(ctx context.Context, deps CustomPageDeps, ownerID, slug string) error {
	page, lerr := lookupPage(ctx, deps, ownerID, slug)
	if lerr != nil {
		return lerr
	}
	if derr := deps.Pages.Delete(ctx, page.ID); derr != nil {
		return fmt.Errorf("delete page: %w", derr)
	}
	return nil
}

// ListPages —— admin 显示所有 active page。
func ListPages(
	ctx context.Context, deps CustomPageDeps, ownerID string,
) ([]owner.CustomPage, error) {
	pages, err := deps.Pages.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list pages: %w", err)
	}
	return pages, nil
}

// --- helpers ---------------------------------------------------------------

func lookupPage(
	ctx context.Context, deps CustomPageDeps, ownerID, slug string,
) (owner.CustomPage, error) {
	page, err := deps.Pages.GetBySlug(ctx, ownerID, slug)
	if err != nil {
		return owner.CustomPage{}, fmt.Errorf("lookup page: %w", err)
	}
	return page, nil
}

// loadDraftFiles —— 拿 latest build 的 source_files；如果 latest 已经 built/failed
// 就基于它做 fork（克隆 files）。没 build 时返 empty map。
func loadDraftFiles(
	ctx context.Context, deps CustomPageDeps, pageID string,
) (map[string]string, error) {
	latest, err := deps.Builds.GetLatestForPage(ctx, pageID)
	if err != nil {
		if errors.Is(err, owner.ErrCustomPageBuildNotFound) {
			return map[string]string{}, nil
		}
		return nil, fmt.Errorf("get latest build: %w", err)
	}
	out := make(map[string]string, len(latest.SourceFiles))
	maps.Copy(out, latest.SourceFiles)
	return out, nil
}

func promoteCheck(
	ctx context.Context, deps CustomPageDeps, ownerID, slug, buildID string,
) (owner.CustomPage, error) {
	page, perr := lookupPage(ctx, deps, ownerID, slug)
	if perr != nil {
		return owner.CustomPage{}, perr
	}
	build, berr := deps.Builds.GetByID(ctx, buildID)
	if berr != nil {
		return owner.CustomPage{}, fmt.Errorf("get build: %w", berr)
	}
	if err := assertBuildBelongsBuilt(&page, &build, buildID); err != nil {
		return owner.CustomPage{}, err
	}
	return page, nil
}

func assertBuildBelongsBuilt(
	page *owner.CustomPage, build *owner.CustomPageBuild, buildID string,
) error {
	if build.PageID != page.ID {
		return fmt.Errorf("build %s does not belong to %s", buildID, page.ID)
	}
	if build.Status != "built" {
		return fmt.Errorf("build %s status=%s, not built", buildID, build.Status)
	}
	return nil
}

func validateSlug(slug string) error {
	if slug == "" {
		return ErrEmptyField
	}
	if len(slug) > maxSlugLen {
		return fmt.Errorf("slug too long (max %d)", maxSlugLen)
	}
	if !slugCharsOK(slug) {
		return fmt.Errorf("slug must be a-z0-9-, got %q", slug)
	}
	return nil
}

func slugCharsOK(slug string) bool {
	for _, r := range slug {
		if !isSlugChar(r) {
			return false
		}
	}
	return true
}

func isSlugChar(r rune) bool {
	if r == '-' {
		return true
	}
	return isLowerAlnum(r)
}

func isLowerAlnum(r rune) bool {
	if r >= 'a' && r <= 'z' {
		return true
	}
	return r >= '0' && r <= '9'
}

func validatePathContent(path, content string) error {
	if path == "" {
		return ErrEmptyField
	}
	if !validRelPath(path) {
		return fmt.Errorf("path must be relative, got %q", path)
	}
	if len(content) > maxFileBytes {
		return fmt.Errorf("file too large (max %d bytes)", maxFileBytes)
	}
	return nil
}

func validRelPath(path string) bool {
	if strings.Contains(path, "..") || strings.HasPrefix(path, "/") {
		return false
	}
	return len(path) <= maxPathLen
}

func validateBundleSize(files map[string]string) error {
	if len(files) > maxFiles {
		return fmt.Errorf("too many files (max %d)", maxFiles)
	}
	total := 0
	for _, v := range files {
		total += len(v)
	}
	if total > maxTotalBytes {
		return fmt.Errorf("bundle too large (max %d bytes)", maxTotalBytes)
	}
	return nil
}
