// byoai_envelope.go —— X-BYOAI-Provider + X-BYOAI-Key header 的解封逻辑。
// chat.go 跟 summary.go 共用；拆出来让两个 route 都 ≤ 350 行。
//
// 设计要点：
//   - BYOAI api key 不在 server 任何持久层。browser localStorage 加密 vault
//     (IndexedDB Web Crypto non-extractable wrap) 自己保管，每次 chat/summary
//     在 `X-BYOAI-Key` header 信封带过来。
//   - 信封的对称密钥从 session_token 派生：
//     HKDF-SHA256(ikm=session_token, info="standmeet-byoai-v1") → 32B AES key。
//     browser 跟 server 唯一共享密钥 = session_token (browser 创建 session 之后
//     存，每次请求 Authorization Bearer 都带；server 在 Redis 用它当 key 查 session)。
//   - cipher = AES-256-GCM；wire format = nonce(12) || ciphertext || tag(16)
//     的连续 byte slice，整体 base64 URL（兼容 std padding）。
//
// 不引入新的 keypair / 不新增 server-side secret。

package public

import (
	"encoding/base64"
	"fmt"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

const (
	byoaiProviderHeader = "X-Byoai-Provider"
	byoaiKeyHeader      = "X-Byoai-Key"
	byoaiEndpointHeader = "X-Byoai-Endpoint"
	byoaiModelHeader    = "X-Byoai-Model"
	byoaiHKDFInfo       = "standmeet-byoai-v1"
)

// unwrapBYOAIKey —— wrappedB64 是 base64 编码的 nonce|ct|tag；HKDF 派生 AES
// key 解封；返 plaintext API key。
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
	// URL-safe base64 (no padding) 优先；fallback std padding（兼容浏览器
	// btoa 默认输出）。
	if blob, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return blob, nil
	}
	blob, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decode byoai envelope b64: %w", err)
	}
	return blob, nil
}

// readBYOAICredFromHeaders —— /llm/chat/stream + /agent/turn 共用。tier=byoai
// 才调。4 个 header (provider / key / endpoint / model) 都必填；browser
// 端用 preset 给 UI 自动填默认，但 server 不做 fallback：cred 永远完整。
//
// I.3 起 caller 都用 nopResponseWriter 屏蔽 writeError (BYOAI 缺 header
// 等价于退回非 BYOAI 路径，cred=nil 让上游 fallback 到 owner provider)，
// bool ok 不再被消费 (lint unparam) —— 简化签名只返指针，nil 等价老
// false 语义。
func readBYOAICredFromHeaders(
	h *Handlers, w http.ResponseWriter, r *http.Request, sessionToken string,
) *owner.AICredential {
	hdrs, hok := requireBYOAIHeaders(h, w, r)
	if !hok {
		return nil
	}
	plain, derr := unwrapBYOAIKey(sessionToken, hdrs.Wrapped)
	if derr != nil {
		writeError(h.Log, w, unauthorizedEnv("invalid byoai key envelope"))
		return nil
	}
	return &owner.AICredential{
		Provider: hdrs.Provider, Key: plain,
		Endpoint: hdrs.Endpoint, Model: hdrs.Model,
	}
}

// byoaiHeaders —— requireBYOAIHeaders 多返打包（避开 funcresult-limit 2 +
// confusing-results）。4 个字段全是必填值。
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
