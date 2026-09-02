// uri.go —— URI parsing / formatting for corpus documents.
//
// Shape: `<genre>://<path>`
//   - raw://<uuid>           (raw has no semantic path; the UUID is the sole address)
//   - wiki://projects/lucerna
//   - output://essays/principles
//   - writing://my-slug
//
// The scheme must be exactly one of the 4 DocumentGenre literals; anything else is
// invalid. The path after `://` is not encoded (owners configuring a path aren't allowed
// URL meta-characters like `?` / `#`, keeping it a plain file-path shape, matching
// Quartz / Obsidian vault paths).
//
// **Phase A.2 deliberately skips net/url** — avoids its baked-in semantics for host /
// port / query; a plain split-on-"://" is enough. Swap in stricter URI validation later
// if it's ever actually needed.

package entity

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// URIRef —— the parsed result of a Document URI. Path carries no leading `/`, lining up
// directly with owner-configured fields like Wiki.Path / Writing.Slug.
type URIRef struct {
	Genre DocumentGenre
	Path  string
}

// ErrURIInvalid —— a URI literal that ParseURI can't recognize.
var ErrURIInvalid = errors.New("invalid corpus URI")

// uriSep —— `://` is the fixed separator between URI scheme and path; extracted here to
// avoid scattering the magic string.
const uriSep = "://"

// ParseURI —— `wiki://projects/lucerna` → URIRef{Genre: GenreWiki, Path:
// "projects/lucerna"}. An empty path is valid (`writing://` refers to the writing
// collection itself), but genre must be one of the 4 enum values; anything else is
// wrapped in ErrURIInvalid.
func ParseURI(s string) (URIRef, error) {
	idx := strings.Index(s, uriSep)
	if idx <= 0 {
		return URIRef{}, fmt.Errorf("%w: missing scheme: %q", ErrURIInvalid, s)
	}
	genre := DocumentGenre(s[:idx])
	if !isValidGenre(genre) {
		return URIRef{}, fmt.Errorf("%w: unknown genre %q", ErrURIInvalid, genre)
	}
	return URIRef{Genre: genre, Path: s[idx+len(uriSep):]}, nil
}

// FormatURI —— URIRef → `<genre>://<path>`. An empty path formats as `<genre>://`.
// Callers usually go through `Document.URI()` rather than calling this directly, but
// admin / migration tools call it directly when assembling from Genre + path.
func FormatURI(genre DocumentGenre, path string) string {
	return string(genre) + uriSep + path
}

// isValidGenre —— whether a DocumentGenre literal is on the whitelist. AllGenres is the
// source of truth here, so no case gets missed.
func isValidGenre(g DocumentGenre) bool {
	return slices.Contains(AllGenres, g)
}
