// envelope.go —— per-secret AES-256-GCM with caller-supplied key（HKDF 派生）。
//
// 设计场景：BYOAI key 不再在 server 端缓存。browser 每次 chat 调用前用
// HKDF(session_token, "standmeet-byoai-v1") 派生 32 字节 AES key，封装
// 自己的 BYOAI key 塞 `X-BYOAI-Key` header；server 用同样 HKDF 派生 + 解
// 封装。session_token 是 browser/server 唯一共享的密钥。
//
// 跟 aesgcm.go 的 Encrypt/Decrypt 区别：那两个用 INSTANCE_SECRET 派生（at-rest
// secret store）；这里用 caller 提供的 key（per-secret envelope，避免一个 key
// 解所有数据）。

package cryptobox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"
)

// DeriveSessionKey —— HKDF-SHA256 把 session_token bytes 派生成 32 字节
// AES-256 key。info 是 domain separation 标签（一个 token 可派生多个用途
// 的 key 而不撞）。salt 用 nil（HKDF-Expand-only form 也行；这里用
// HKDF.Key 标准 derivation 流程，salt 为 nil 等同空 salt）。
func DeriveSessionKey(sessionToken, info string) ([aesKeyLen]byte, error) {
	var out [aesKeyLen]byte
	derived, err := hkdf.Key(sha256.New, []byte(sessionToken), nil, info, aesKeyLen)
	if err != nil {
		return out, fmt.Errorf("hkdf derive: %w", err)
	}
	copy(out[:], derived)
	return out, nil
}

// EncryptWithKey —— 给定 32 字节 key 加密 plaintext 成 nonce|ct|tag。
// 跟 Encrypt() 同 wire format，只是 key 来源不同。
func EncryptWithKey(key [aesKeyLen]byte, plaintext []byte) ([]byte, error) {
	gcm, err := newGCMWithKey(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, nonceLen)
	if _, nerr := io.ReadFull(rand.Reader, nonce); nerr != nil {
		return nil, fmt.Errorf("read nonce: %w", nerr)
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// DecryptWithKey —— 反向。返 ErrTampered 表 ciphertext 损坏 / 用错 key。
func DecryptWithKey(key [aesKeyLen]byte, blob []byte) ([]byte, error) {
	if len(blob) < nonceLen {
		return nil, ErrTampered
	}
	gcm, err := newGCMWithKey(key)
	if err != nil {
		return nil, err
	}
	nonce, ct := blob[:nonceLen], blob[nonceLen:]
	out, oerr := gcm.Open(nil, nonce, ct, nil)
	if oerr != nil {
		return nil, ErrTampered
	}
	return out, nil
}

func newGCMWithKey(key [aesKeyLen]byte) (cipher.AEAD, error) {
	block, berr := aes.NewCipher(key[:])
	if berr != nil {
		return nil, fmt.Errorf("aes new cipher: %w", berr)
	}
	gcm, gerr := cipher.NewGCM(block)
	if gerr != nil {
		return nil, fmt.Errorf("aes gcm: %w", gerr)
	}
	return gcm, nil
}
