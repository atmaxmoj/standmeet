// public_url_validate.go — validation/normalization of owner public_url (shared by
// claim + settings).

package usecase

import (
	"errors"
	"strings"
)

// ErrPublicURLInvalid — public_url is not a URL starting with http(s)://.
var ErrPublicURLInvalid = errors.New("public_url must be a full URL with scheme")

const (
	httpPrefix  = "http://"
	httpsPrefix = "https://"
)

// ValidPublicURL — whether public_url is a full URL starting with http(s)://.
func ValidPublicURL(s string) bool {
	return len(s) > len(httpsPrefix) &&
		(strings.HasPrefix(s, httpPrefix) || strings.HasPrefix(s, httpsPrefix))
}

// NormalizePublicURL — strips the trailing slash. In dev, "http://localhost:38127/"
// and "http://localhost:38127" end up identical once written to the DB; the QR builder
// can then just append "/?code=" directly.
func NormalizePublicURL(s string) string {
	for s != "" && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
