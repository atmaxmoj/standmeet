// microsite_preview_token.go — the credential carried inline in the preview URL.
//
// **Why a session cookie won't work**: the preview runs inside a `sandbox="allow-scripts"`
// iframe (no allow-same-origin — otherwise a page the owner's AI wrote could take the
// owner's admin session and do anything with it). And a sandboxed opaque origin's
// **subresource requests carry no cookies**: the document itself gets 200, but the
// `<script src="./assets/index-*.js">` inside it gets 401 and the page renders blank.
// Observed in real logs: `/preview` -> 200 441B, `/preview/assets/index-CQtbe4hQ.js` -> 401 70B.
//
// So the credential has to travel via the **URL**. And it must be in the **path**, not
// the query: query params on `<base href>` are not inherited by relative paths
// (`./assets/x.js` resolves and drops them).
//
// The token is **derived, not stored**: HMAC(server key, owner|slug|exp). No table, no
// lifecycle, none of the "forgot to clean it up" class of problems. exp keeps a copied
// URL from staying valid forever.

package usecase

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// PreviewTokenTTL — how long a preview URL stays alive.
//
// 10 minutes: the owner watching the panel while the agent edits the page is a
// minutes-scale activity, and the panel mounts a fresh token every time it remounts the
// iframe, so this is invisible to him. Meanwhile a copy-pasted URL stops working after
// ten minutes.
const PreviewTokenTTL = 10 * time.Minute

const (
	decimalBase = 10
	bitsInInt64 = 64
)

// ErrPreviewTokenInvalid — the token doesn't match, has expired, or is malformed.
// **All three collapse into one**: distinguishing them for whoever holds a bad token
// would only tell an attacker how close their token is to the right shape.
var ErrPreviewTokenInvalid = errors.New("preview token invalid")

// NewPreviewToken — signs one for this owner's page. Shaped like `<ownerID>.<exp>.<sig>`,
// all URL-safe, so the whole thing can go straight into the path.
func NewPreviewToken(key, ownerID, slug string, now time.Time) string {
	exp := strconv.FormatInt(now.Add(PreviewTokenTTL).Unix(), decimalBase)
	return fmt.Sprintf(
		"%s.%s.%s",
		base64.RawURLEncoding.EncodeToString([]byte(ownerID)),
		exp,
		previewSig(key, ownerID, slug, exp),
	)
}

// VerifyPreviewToken — if the token matches, returns which owner it belongs to.
//
// slug is part of the signature: a preview token for one slug won't work on another —
// otherwise getting a token for any one page would mean getting every page.
func VerifyPreviewToken(key, slug, token string, now time.Time) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", ErrPreviewTokenInvalid
	}
	raw, derr := base64.RawURLEncoding.DecodeString(parts[0])
	if derr != nil {
		return "", ErrPreviewTokenInvalid
	}
	ownerID := string(raw)
	if !hmac.Equal([]byte(previewSig(key, ownerID, slug, parts[1])), []byte(parts[2])) {
		return "", ErrPreviewTokenInvalid
	}
	return ownerID, expiredOr(parts[1], now)
}

// expiredOr — expiry also maps to ErrPreviewTokenInvalid: only one story goes out externally.
func expiredOr(exp string, now time.Time) error {
	unix, perr := strconv.ParseInt(exp, decimalBase, bitsInInt64)
	if perr != nil || now.Unix() > unix {
		return ErrPreviewTokenInvalid
	}
	return nil
}

func previewSig(key, ownerID, slug, exp string) string {
	mac := hmac.New(sha256.New, []byte(key))
	// The separator must be a character that can never appear inside any segment, or
	// `a|b` + `c` and `a` + `b|c` sign to the same value (the same family of problem as
	// [[one-bad-element-voids-the-array]]).
	// ownerID is a UUID, slug is [a-z0-9-], exp is numeric — none contain `\n`.
	// hash.Hash's Write never returns an error (guaranteed by the docs).
	mac.Write([]byte(ownerID + "\n" + slug + "\n" + exp))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
