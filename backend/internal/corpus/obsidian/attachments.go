// attachments.go -- extraction / rewrite tools for image references in
// body_md.
//
// Handles 4 markdown image forms (the first 2 are what we emit on export,
// the last 2 are what the owner writes in Obsidian):
//  1. ![alt](standmeet-asset:<uuid>)   -- StandMeet's internal URI (no
//                                         rewrite needed)
//  2. ![alt](attachments/foo.png)      -- the portable form emitted on
//                                         export
//  3. ![alt](path/to/foo.png "title")  -- Obsidian / standard markdown
//  4. ![[foo.png]]                     -- Obsidian crosslink-embed
//
// Form 1 is already ingested; 2/3/4 are raw references the owner edited in
// the vault -- on import we must find the matching attachment file in the
// vault -> upload to MinIO -> rewrite it to form 1.
//
// The resolve rule matches Obsidian: basename wins (any subdirectory in
// the vault is fine), we don't force-match the full relative path.

package obsidian

import (
	"path"
	"regexp"
	"strings"
)

// stdImageRefRegex -- ![alt](URL "optional title"), standard markdown
// image. Captures alt + URL + optional title. URL contains no whitespace.
var stdImageRefRegex = regexp.MustCompile(
	`!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)`,
)

// embedRefRegex -- Obsidian ![[file.png]] / ![[file.png|alt]] / ![[file.png|100x100]].
// Captures the file path (may include subdirectories, but Obsidian
// actually resolves by basename) + optional alt.
var embedRefRegex = regexp.MustCompile(
	`!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]`,
)

// internalAssetURIPrefix -- our own URI prefix. A ref carrying this is
// already ingested and needs no further rewrite.
const internalAssetURIPrefix = "standmeet-asset:"

// stdImageRefSubmatchURL / stdImageRefSubmatchAlt -- regexp submatch
// indices. FindAllStringSubmatchIndex returns 4 = (start, end) of group 2
// (url).
const (
	imgRefMatchAltStart = 2
	imgRefMatchAltEnd   = 3
	imgRefMatchURLStart = 4
	imgRefMatchURLEnd   = 5
	embedMatchAltStart  = 4
	embedMatchAltEnd    = 5
)

// ImageRef -- one image reference extracted from body_md. Original is the
// literal text to replace in body (the full markdown snippet); Basename is
// the filename to look up in the vault.
type ImageRef struct {
	Original string
	Basename string
	Alt      string
}

// ExtractImageRefs -- extracts every non-standmeet-asset image reference
// from body_md. Refs already in internal URI form (standmeet-asset:...)
// are skipped -- that's the ingested state.
func ExtractImageRefs(body string) []ImageRef {
	out := make([]ImageRef, 0)
	out = appendStdImageRefs(out, body)
	out = appendEmbedRefs(out, body)
	return out
}

func appendStdImageRefs(out []ImageRef, body string) []ImageRef {
	for _, m := range stdImageRefRegex.FindAllStringSubmatchIndex(body, -1) {
		full := body[m[0]:m[1]]
		alt := body[m[imgRefMatchAltStart]:m[imgRefMatchAltEnd]]
		url := body[m[imgRefMatchURLStart]:m[imgRefMatchURLEnd]]
		if strings.HasPrefix(url, internalAssetURIPrefix) {
			continue
		}
		if isExternalURL(url) {
			continue
		}
		out = append(out, ImageRef{
			Original: full, Basename: path.Base(url), Alt: alt,
		})
	}
	return out
}

func appendEmbedRefs(out []ImageRef, body string) []ImageRef {
	for _, m := range embedRefRegex.FindAllStringSubmatchIndex(body, -1) {
		full := body[m[0]:m[1]]
		ref := body[m[imgRefMatchAltStart]:m[imgRefMatchAltEnd]]
		alt := ""
		if m[embedMatchAltStart] >= 0 {
			alt = body[m[embedMatchAltStart]:m[embedMatchAltEnd]]
		}
		out = append(out, ImageRef{
			Original: full, Basename: path.Base(ref), Alt: alt,
		})
	}
	return out
}

// isExternalURL -- http(s):// external links are skipped, not treated as
// attachments.
func isExternalURL(u string) bool {
	return strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://")
}

// RewriteToInternalURI -- replaces an image ref's whole Original span in
// body with the standard markdown form pointing at an internal URI.
// Usage: rewrite[ref.Original] = `![alt](standmeet-asset:pending-<id>)`
// then substitute into body with strings.ReplaceAll.
func RewriteToInternalURI(alt, pendingID string) string {
	return "![" + alt + "](" + internalAssetURIPrefix + pendingID + ")"
}

// RewriteToVaultPath -- used on export. Changes every
// standmeet-asset:<uuid> image ref in body into the standard markdown form
// attachments/<filename>.
// The caller supplies a uuid -> vault-filename map (the filename is chosen
// by export, usually `<asset-id>.<ext>`, with the extension taken from
// content-type).
func RewriteToVaultPath(body string, uriToFilename map[string]string) string {
	return stdImageRefRegex.ReplaceAllStringFunc(body, func(match string) string {
		sub := stdImageRefRegex.FindStringSubmatch(match)
		if len(sub) < 3 {
			return match
		}
		alt := sub[1]
		url := sub[2]
		if !strings.HasPrefix(url, internalAssetURIPrefix) {
			return match
		}
		uuid := strings.TrimPrefix(url, internalAssetURIPrefix)
		filename, ok := uriToFilename[uuid]
		if !ok {
			return match
		}
		return "![" + alt + "](attachments/" + filename + ")"
	})
}
