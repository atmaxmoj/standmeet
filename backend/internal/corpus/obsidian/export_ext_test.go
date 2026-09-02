package obsidian

import "testing"

// TestExtFromContentType -- export attachment extension normalization:
// common types get their canonical name (not mime's alphabetical pick,
// e.g. image/jpeg -> .jpe), the "; charset" parameter is stripped, matching
// is case-insensitive, and unknown types fall back to .bin.
func TestExtFromContentType(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"image/jpeg":                ".jpg", // not mime's .jpe
		"image/jpeg; charset=utf-8": ".jpg", // strips the parameter
		"IMAGE/PNG":                 ".png", // case-insensitive
		"application/pdf":           ".pdf",
		"text/markdown":             ".md",
		"image/svg+xml":             ".svg",
		"totally/unknown-xyz":       ".bin", // unknown -> falls back to .bin
	}
	for ct, want := range cases {
		if got := extFromContentType(ct); got != want {
			t.Errorf("extFromContentType(%q) = %q, want %q", ct, got, want)
		}
	}
}
