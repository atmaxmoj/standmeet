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

// ErrShortSecret — INSTANCE_SECRET is too short; boot is refused. Production
// deploys must supply ≥ 32 bytes.
var ErrShortSecret = errors.New("INSTANCE_SECRET must be ≥ 32 chars")

// ErrTampered — GCM auth tag verification failed: ciphertext was altered,
// truncated, or the wrong key was used.
var ErrTampered = errors.New("ciphertext tampered or wrong key")

// loadKey reads INSTANCE_SECRET from env and sha256's it into a 32-byte
// AES-256 key.
func loadKey() ([aesKeyLen]byte, error) {
	secret := os.Getenv(envSecretName)
	if len(secret) < minSecretLen {
		return [aesKeyLen]byte{}, ErrShortSecret
	}
	return sha256.Sum256([]byte(secret)), nil
}

// Encrypt — encrypts plaintext into a single nonce|ciphertext|tag buffer. aad is
// additional authenticated data: it binds the ciphertext to a context (persisted
// credentials pass owner_id) — if the ciphertext is moved into another owner's
// row, Decrypt fails as tampered. aad never enters the ciphertext, only the auth
// tag. Empty aad = no binding (old wire format; compat during migration). Never
// call this with an empty plaintext.
func Encrypt(plaintext, aad []byte) ([]byte, error) {
	gcm, err := newGCM()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, nonceLen)
	if _, nerr := io.ReadFull(rand.Reader, nonce); nerr != nil {
		return nil, fmt.Errorf("read nonce: %w", nerr)
	}
	return gcm.Seal(nonce, nonce, plaintext, aad), nil
}

// Decrypt — the reverse; verifies the binding against aad. aad mismatch (ciphertext
// moved to another owner's row) / corruption / truncation → ErrTampered; callers
// translate this to 401/500. There is no legacy ciphertext (unreleased yet), so
// there's no no-AAD fallback: AAD must match exactly.
func Decrypt(blob, aad []byte) ([]byte, error) {
	if len(blob) < nonceLen {
		return nil, ErrTampered
	}
	gcm, err := newGCM()
	if err != nil {
		return nil, err
	}
	nonce, ct := blob[:nonceLen], blob[nonceLen:]
	out, oerr := gcm.Open(nil, nonce, ct, aad)
	if oerr != nil {
		return nil, ErrTampered
	}
	return out, nil
}

// newGCM builds the AES-256-GCM cipher mode; consolidating the key-load + aes
// + gcm steps here keeps Encrypt / Decrypt at cyclo ≤ 5.
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
