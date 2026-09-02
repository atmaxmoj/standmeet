// byoai_envelope.go —— unwrapping logic for the X-BYOAI-Provider + X-BYOAI-Key headers.
// Shared by chat.go and summary.go; split out so both routes stay ≤ 350 lines.
//
// Design points:
//   - The BYOAI API key never lives in any server-side persistence layer. The browser's
//     localStorage encrypted vault (IndexedDB, Web Crypto non-extractable wrap) holds it,
//     and it's carried in the `X-BYOAI-Key` header envelope on every chat/summary call.
//   - The envelope's symmetric key is derived from session_token:
//     HKDF-SHA256(ikm=session_token, info="standmeet-byoai-v1") → 32B AES key.
//     The only key shared between browser and server is session_token (the browser
//     stores it after creating the session, and sends it on every request's
//     Authorization Bearer; the server uses it as the Redis key to look up the session).
//   - cipher = AES-256-GCM; wire format = nonce(12) || ciphertext || tag(16) as one
//     contiguous byte slice, the whole thing base64 URL-encoded (accepts std padding
//     too).
//
// Introduces no new keypair and no new server-side secret.

package public

import (
	"encoding/base64"
	"fmt"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
)

const (
	byoaiProviderHeader = "X-Byoai-Provider"
	byoaiKeyHeader      = "X-Byoai-Key"
	byoaiEndpointHeader = "X-Byoai-Endpoint"
	byoaiModelHeader    = "X-Byoai-Model"
	byoaiHKDFInfo       = "standmeet-byoai-v1"
)

// unwrapBYOAIKey —— wrappedB64 is base64-encoded nonce|ct|tag; unwraps using an
// HKDF-derived AES key; returns the plaintext API key.
func unwrapBYOAIKey(sessionToken, wrappedB64 string) (string, error) {
	blob, derr := decodeEnvelopeB64(wrappedB64)
	if derr != nil {
		return "", derr
	}
	return deriveAndDecrypt(sessionToken, blob)
}

func deriveAndDecrypt(sessionToken string, blob []byte) (string, error) {
	key, kerr := cryptobox.DeriveSessionKey(sessionToken, byoaiHKDFInfo)
	if kerr != nil {
		return "", fmt.Errorf("derive byoai key: %w", kerr)
	}
	plain, oerr := cryptobox.DecryptWithKey(key, blob)
	if oerr != nil {
		return "", fmt.Errorf("decrypt byoai envelope: %w", oerr)
	}
	return string(plain), nil
}

func decodeEnvelopeB64(s string) ([]byte, error) {
	// URL-safe base64 (no padding) first; falls back to std padding (compatible with
	// the browser's default btoa output).
	if blob, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return blob, nil
	}
	blob, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decode byoai envelope b64: %w", err)
	}
	return blob, nil
}

// readBYOAICredFromHeaders —— shared by /llm/chat/stream and /agent/turn. Only called
// when tier=byoai. All 4 headers (provider / key / endpoint / model) are required; the
// browser side uses a preset to auto-fill UI defaults, but the server does no fallback:
// cred is always complete or nil.
//
// Since I.3 every caller passes nopResponseWriter to suppress writeError (missing BYOAI
// headers is equivalent to falling back to the non-BYOAI path, cred=nil lets upstream
// fall back to the owner provider), so the bool ok is no longer consumed (lint unparam)
// — the signature is simplified to return just the pointer, nil carrying the old false
// semantics.
func readBYOAICredFromHeaders(
	h *Handlers, w http.ResponseWriter, r *http.Request, sessionToken string,
) *inference.VisitorCred {
	hdrs, hok := requireBYOAIHeaders(h, w, r)
	if !hok {
		return nil
	}
	plain, derr := unwrapBYOAIKey(sessionToken, hdrs.Wrapped)
	if derr != nil {
		writeError(h.Log, w, unauthorizedEnv("invalid byoai key envelope"))
		return nil
	}
	return &inference.VisitorCred{
		Provider: hdrs.Provider, Key: plain,
		Endpoint: hdrs.Endpoint, Model: hdrs.Model,
	}
}

// byoaiHeaders —— the packaged multi-return of requireBYOAIHeaders (avoids
// funcresult-limit 2 + confusing-results). All 4 fields are required values.
type byoaiHeaders struct {
	Provider string
	Wrapped  string
	Endpoint string
	Model    string
}

func requireBYOAIHeaders(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (byoaiHeaders, bool) {
	hdrs := byoaiHeaders{
		Provider: r.Header.Get(byoaiProviderHeader),
		Wrapped:  r.Header.Get(byoaiKeyHeader),
		Endpoint: r.Header.Get(byoaiEndpointHeader),
		Model:    r.Header.Get(byoaiModelHeader),
	}
	if !hdrs.complete() {
		writeError(h.Log, w, unauthorizedEnv(
			"byoai tier requires X-Byoai-Provider + X-Byoai-Key + "+
				"X-Byoai-Endpoint + X-Byoai-Model headers",
		))
		return byoaiHeaders{}, false
	}
	return hdrs, true
}

func (h byoaiHeaders) complete() bool {
	for _, v := range [...]string{h.Provider, h.Wrapped, h.Endpoint, h.Model} {
		if v == "" {
			return false
		}
	}
	return true
}
