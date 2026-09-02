// import_parse.go — parsing a single .md file + rewriting its image refs. Split out of
// import.go to stay under the 350-line cap.
//
// Flow:
//  1. SplitFrontmatter → frontmatter YAML + body
//  2. ParseFrontmatter → Frontmatter struct
//  3. image refs in the body (`![alt](path)` or `![[file.png]]`) → looked up by
//     basename in the attachments index → an unmatched ref is left as-is; a matched
//     one is rewritten to `![alt](standmeet-asset:pending-<uuid>)` for SavePost to ingest
//  4. frontmatter cover_image gets the same treatment → yields CoverImageRef = pending-<uuid>

package obsidian

import (
	"net/http"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"

	"github.com/google/uuid"
)

// parsedVault — the output of parseVaultMarkdown (avoids the funcresult-limit lint).
// fieldalignment: the large struct (Frontmatter) goes last; slices/strings come first.
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

// rewriteBodyAttachments — for every image ref in the body, look up its bytes in
// attachments; a match gets a pending-<uuid> and its ref is rewritten to
// `![alt](standmeet-asset:pending-<uuid>)`. SavePost's multipart path inserts the
// asset row inside the tx and uploads the blob after commit.
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
