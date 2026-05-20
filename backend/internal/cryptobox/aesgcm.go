// Package cryptobox provides AES-256-GCM symmetric encryption for storing
// owner-supplied secrets (LLM API keys, eventually OAuth tokens) at rest.
//
// Format on the wire: nonce(12) || ciphertext || tag(16). Single contiguous
// byte slice, no framing. Decrypt detects truncation / tampering via GCM auth tag.
//
// Key derivation: SHA-256 of INSTANCE_SECRET env var. INSTANCE_SECRET must be
// ≥ 32 chars; production deploy generates a random 64-hex string at first boot.
package cryptobox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
)

const (
	nonceLen      = 12
	aesKeyLen     = 32 // AES-256
	minSecretLen  = 32
	envSecretName = "INSTANCE_SECRET"
)

// ErrShortSecret —— INSTANCE_SECRET 太短，拒绝 boot。生产环境必须给 ≥32 字节。
var ErrShortSecret = errors.New("INSTANCE_SECRET must be ≥ 32 chars")

// ErrTampered —— GCM auth tag 校验失败：密文被改 / 截断 / 用错 key。
var ErrTampered = errors.New("ciphertext tampered or wrong key")

// loadKey 从 env 读 INSTANCE_SECRET，sha256 它出 32 字节 AES-256 key。
func loadKey() ([aesKeyLen]byte, error) {
	secret := os.Getenv(envSecretName)
	if len(secret) < minSecretLen {
		return [aesKeyLen]byte{}, ErrShortSecret
	}
	return sha256.Sum256([]byte(secret)), nil
}

// Encrypt —— plaintext 加密为 nonce|ciphertext|tag 单 buf。empty plaintext
// 不调本函数，caller 拿 nil 当 "未设置" 处理。
func Encrypt(plaintext []byte) ([]byte, error) {
	gcm, err := newGCM()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, nonceLen)
	if _, nerr := io.ReadFull(rand.Reader, nonce); nerr != nil {
		return nil, fmt.Errorf("read nonce: %w", nerr)
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt —— 反向。返 ErrTampered 表 ciphertext 损坏；调用者按 401 / 500 翻译。
func Decrypt(blob []byte) ([]byte, error) {
	if len(blob) < nonceLen {
		return nil, ErrTampered
	}
	gcm, err := newGCM()
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

// newGCM 构造 AES-256-GCM cipher mode；统一 key load + aes + gcm 三步以让
// Encrypt / Decrypt 都 cyclo ≤ 5。
func newGCM() (cipher.AEAD, error) {
	key, err := loadKey()
	if err != nil {
		return nil, err
	}
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
