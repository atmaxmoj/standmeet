// envelope_test.go — connector-deps-tests.md §4 E5: credential decrypt failure
// (vault corrupted / wrong key) must degrade friendly, and **the error must
// never contain ciphertext/plaintext**. cryptobox is the last line for
// connector-credential no-leak: secrets are persisted only as ciphertext, and
// decryption happens only inside the connector layer. This guards the decrypt
// failure path.

package cryptobox_test

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
)

const (
	e5Secret    = "super-secret-smtp-password-xyz-9f3a"
	flipTagByte = 0xFF // flip the ciphertext's last byte → GCM auth tag verification fails
)

// TestDecryptFailure_NoSecretLeak — E5: wrong key / corrupted ciphertext /
// truncation all return ErrTampered, the error string contains neither the
// plaintext key nor ciphertext bytes, and truncated input doesn't panic;
// same-key round-trip works normally.
func TestDecryptFailure_NoSecretLeak(t *testing.T) {
	t.Parallel()
	keyA, err := cryptobox.DeriveSessionKey("session-token-A", "connector-cred")
	require.NoError(t, err)
	keyB, err := cryptobox.DeriveSessionKey("session-token-B", "connector-cred")
	require.NoError(t, err)

	secret := []byte(e5Secret)
	blob, err := cryptobox.EncryptWithKey(keyA, secret)
	require.NoError(t, err)

	// Positive case: same-key round-trip restores it.
	out, rerr := cryptobox.DecryptWithKey(keyA, blob)
	require.NoError(t, rerr)
	require.Equal(t, secret, out, "same key round-trips")

	// Wrong key (key mismatch) → ErrTampered, error doesn't leak the secret.
	_, kerr := cryptobox.DecryptWithKey(keyB, blob)
	require.ErrorIs(t, kerr, cryptobox.ErrTampered, "wrong key → ErrTampered")
	requireNoLeak(t, kerr.Error(), secret, blob)

	// Vault corruption (flip the auth tag's last byte) → ErrTampered.
	corrupt := append([]byte(nil), blob...)
	corrupt[len(corrupt)-1] ^= flipTagByte
	_, cerr := cryptobox.DecryptWithKey(keyA, corrupt)
	require.ErrorIs(t, cerr, cryptobox.ErrTampered, "corrupt blob → ErrTampered")
	requireNoLeak(t, cerr.Error(), secret, blob)

	// Truncated to shorter than the nonce → ErrTampered, no panic.
	_, serr := cryptobox.DecryptWithKey(keyA, []byte("x"))
	require.ErrorIs(t, serr, cryptobox.ErrTampered, "truncated blob → ErrTampered, no panic")
}

func requireNoLeak(t *testing.T, msg string, secret, blob []byte) {
	t.Helper()
	require.NotContains(t, msg, string(secret), "error must not leak the plaintext secret")
	require.False(t, bytes.Contains([]byte(msg), blob), "error must not leak ciphertext bytes")
}
