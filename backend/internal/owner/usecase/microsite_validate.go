// microsite_validate.go — slug / path / bundle-size validation for custom pages. Split out of
// microsite.go to keep that file under the max-lines gate.

package usecase

import (
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

func validateSlug(slug string) error {
	if slug == "" {
		return apierr.ErrEmptyField
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
		return apierr.ErrEmptyField
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
