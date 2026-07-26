// import_parse.go —— 单个 .md 文件的解析 + image ref 改写。从 import.go
// 拆出来守 350-line cap。
//
// 流程：
//  1. SplitFrontmatter → frontmatter YAML + body
//  2. ParseFrontmatter → Frontmatter struct
//  3. body 里的 image ref（`![alt](path)` 或 `![[file.png]]`）→ 在
//     attachments 索引按 basename 查 → 没找到的 ref 留原文，找到的 rewrite
//     成 `![alt](standmeet-asset:pending-<uuid>)` 等 SavePost 来 ingest
//  4. frontmatter cover_image 同样处理 → 出 CoverImageRef = pending-<uuid>

package obsidian

import (
	"net/http"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus"

	"github.com/google/uuid"
)

// parsedVault —— parseVaultMarkdown 的输出（避开 funcresult-limit）。
// fieldalignment: 大 struct (Frontmatter) 最后，slice / string 先。
type parsedVault struct {
	files []corpus.FileInput
	body  string
	cover string
	fm    Frontmatter
}

func parseVaultMarkdown(
	md *VaultFile, attachments map[string]VaultFile,
) (parsedVault, error) {
	parts := SplitFrontmatter(string(md.Body))
	fm, ferr := ParseFrontmatter(parts.YAML)
	if ferr != nil {
		return parsedVault{}, ferr
	}
	body, files := rewriteBodyAttachments(parts.Body, attachments)
	cover, coverFile := resolveCoverRef(fm.CoverImage, attachments)
	if coverFile != nil {
		files = append(files, *coverFile)
	}
	return parsedVault{fm: fm, body: body, files: files, cover: cover}, nil
}

// rewriteBodyAttachments —— body 里所有 image ref → 在 attachments 里查
// bytes，找到的生成 pending-<uuid> 并把 ref 替成
// `![alt](standmeet-asset:pending-<uuid>)`。SavePost 那条 multipart 路径
// 在 tx 里 insert asset 行 + commit 后 upload blob。
func rewriteBodyAttachments(
	body string, attachments map[string]VaultFile,
) (string, []corpus.FileInput) {
	refs := ExtractImageRefs(body)
	files := make([]corpus.FileInput, 0, len(refs))
	for i := range refs {
		ref := &refs[i]
		att, ok := attachments[ref.Basename]
		if !ok {
			continue
		}
		pid := newPendingID()
		body = strings.ReplaceAll(body, ref.Original, RewriteToInternalURI(ref.Alt, pid))
		files = append(files, fileInputFromAttachment(pid, &att))
	}
	return body, files
}

func resolveCoverRef(
	coverRef string, attachments map[string]VaultFile,
) (string, *corpus.FileInput) {
	if coverRef == "" {
		return "", nil
	}
	base := basename(strings.TrimPrefix(coverRef, "attachments/"))
	att, ok := attachments[base]
	if !ok {
		return "", nil
	}
	pid := newPendingID()
	f := fileInputFromAttachment(pid, &att)
	return pid, &f
}

func fileInputFromAttachment(pendingID string, att *VaultFile) corpus.FileInput {
	return corpus.FileInput{
		PendingID:        pendingID,
		ContentType:      http.DetectContentType(att.Body),
		OriginalFilename: basename(att.RelPath),
		Body:             att.Body,
	}
}

func newPendingID() string {
	return "pending-" + uuid.NewString()
}
