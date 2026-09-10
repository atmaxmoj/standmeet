// asset_url_token.go — the signature carried in a gated asset's serve URL.
//
// **Why a signature at all.** An asset embedded in a corpus entry inherits that entry's
// visibility: read the entry, get the asset URL along with it; can't read the entry, the
// URL is never handed out (loadWikiLandingView emits AssetURLs only for an in-scope
// entry). But the serve route (GET /api/v1/assets/{id}) is reachable by anyone who knows
// the id — dev tools, a leaked id, a copied link. Without more, "the id is unguessable"
// is the only thing standing between a revoked visitor and the bytes, and that makes a
// revoke a lie (genre-assets-inherit.spec.ts:74). So the URL the render hands out is
// *signed*: the route serves a bare id only when the asset is public (microsite-referenced,
// see AssetIsPublic in the composition root); otherwise it demands a signature that only an
// authorized render could have produced.
//
// **Derived, not stored** — HMAC(server key, id|exp), the same shape as the microsite
// preview token (owner/usecase/microsite_preview_token.go). No table, no lifecycle. exp
// bounds a copied URL the way the presigned-minio TTL used to, so a link handed out to an
// authorized reader stops working after the window rather than living forever.

package usecase

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"strconv"
	"time"
)

// AssetURLTTL — how long a signed asset URL stays valid. The reader fetches the image
// within seconds of the page load; a lazy/scroll-triggered fetch or a kept-open tab is
// still well inside an hour, while a copied link dies within it.
const AssetURLTTL = time.Hour

const (
	assetExpBase    = 10
	assetExpBits    = 64
	assetURLExpKey  = "e"
	assetURLSigKey  = "s"
	assetSigSepByte = "\n" // never appears in a UUID or a decimal exp — see previewSig
)

// SignAssetURL — the serve path for a gated asset, signed so the route will honor it.
// Shaped `/api/v1/assets/<id>?e=<exp>&s=<sig>`; every segment is URL-safe (id is a UUID,
// exp is decimal, sig is base64url), so it needs no escaping.
func SignAssetURL(key, id string, now time.Time) string {
	exp := strconv.FormatInt(now.Add(AssetURLTTL).Unix(), assetExpBase)
	return assetPublicPath(id) + "?" + assetURLExpKey + "=" + exp +
		"&" + assetURLSigKey + "=" + assetSig(key, id, exp)
}

// VerifyAssetURL — true iff the query carries a signature this server produced for this
// id and it has not expired. A missing/malformed/expired/mismatched signature all return
// false alike: whoever holds a bad one learns only "no", never how close it was.
func VerifyAssetURL(key, id string, q url.Values, now time.Time) bool {
	exp := q.Get(assetURLExpKey)
	sig := q.Get(assetURLSigKey)
	if exp == "" || sig == "" {
		return false
	}
	if !hmac.Equal([]byte(assetSig(key, id, exp)), []byte(sig)) {
		return false
	}
	return assetURLUnexpired(exp, now)
}

// assetURLUnexpired — false if exp is malformed or already past. Split out to keep
// VerifyAssetURL under the cyclomatic-complexity gate.
func assetURLUnexpired(exp string, now time.Time) bool {
	unix, perr := strconv.ParseInt(exp, assetExpBase, assetExpBits)
	return perr == nil && now.Unix() <= unix
}

func assetSig(key, id, exp string) string {
	mac := hmac.New(sha256.New, []byte(key))
	// hash.Hash.Write never errors (documented). The separator can never appear inside
	// id or exp, so `a|b`+`c` and `a`+`b|c` cannot collide (cf. previewSig).
	_, _ = mac.Write([]byte(id + assetSigSepByte + exp))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
