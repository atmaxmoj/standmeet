// envelope.go — per-secret AES-256-GCM with caller-supplied key (HKDF-derived).
//
// Design scenario: the BYOAI key is never cached server-side. Before each
// chat call, the browser derives a 32-byte AES key via
// HKDF(session_token, "standmeet-byoai-v1"), encrypts its own BYOAI key into
// the `X-BYOAI-Key` header; the server derives the same HKDF key and
// decrypts it. session_token is the only secret the browser and server
// share.
//
// Difference from aesgcm.go's Encrypt/Decrypt: those derive from
// INSTANCE_SECRET (the at-rest secret store); here the key comes from the
// caller (a per-secret envelope, so one key can't decrypt everything).

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

// DeriveSessionKey — HKDF-SHA256 derives the session_token bytes into a
// 32-byte AES-256 key. info is the domain-separation label (one token can
// derive keys for multiple purposes without collision). salt is nil (an
// HKDF-Expand-only form would also work; this uses the standard HKDF.Key
// derivation flow, where a nil salt is equivalent to an empty salt).
func DeriveSessionKey(sessionToken, info string) ([aesKeyLen]byte, error) {
	var out [aesKeyLen]byte
	derived, err := hkdf.Key(sha256.New, []byte(sessionToken), nil, info, aesKeyLen)
	if err != nil {
		return out, fmt.Errorf("hkdf derive: %w", err)
	}
	copy(out[:], derived)
	return out, nil
}

// EncryptWithKey — encrypts plaintext into nonce|ct|tag given a 32-byte key.
// Same wire format as Encrypt(), just a different key source.
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

// DecryptWithKey — the reverse. Returns ErrTampered if the ciphertext is
// corrupted or the wrong key was used.
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
