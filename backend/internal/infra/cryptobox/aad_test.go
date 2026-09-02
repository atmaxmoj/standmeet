// aad_test.go — AAD binding (owner-scoped) for at-rest ciphertext. Persisted
// credentials (connector creds / owner LLM key / gcal token) must bind to
// owner_id: when an attacker who can write to the DB moves owner A's
// ciphertext into owner B's row, decrypt must fail (AAD mismatch) — never a
// silent swap.
//
// Migration discipline: AAD is a **breaking wire-format change** (old
// ciphertext was sealed with nil AAD). Decrypt must try the new AAD first,
// then fall back to no-AAD decrypt (decrypt-with-then-without), so rows
// persisted before the upgrade stay decryptable while only new writes bind
// AAD.
//
// RED (pre-implementation): Encrypt/Decrypt don't accept an aad param yet →
// compile fails → red.

package cryptobox_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
)

const (
	// The at-rest path (Encrypt/Decrypt) reads INSTANCE_SECRET to derive its key;
	// the test sets one ≥ 32 bytes via t.Setenv.
	testInstanceSecret = "test-instance-secret-at-least-32-bytes-long-xyz"
	aadOwnerA          = "owner-aaaaaaaa-1111"
	aadOwnerB          = "owner-bbbbbbbb-2222"
	aadSecret          = "smtp-password-do-not-leak-7c1f"
)

// TestAAD_CrossOwnerSwapBlocked — decrypting owner A's ciphertext with owner
// B's AAD → ErrTampered (the swap is blocked); same-owner AAD → round-trips.
func TestAAD_CrossOwnerSwapBlocked(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", testInstanceSecret)
	blob, err := cryptobox.Encrypt([]byte(aadSecret), []byte(aadOwnerA))
	require.NoError(t, err)

	out, rerr := cryptobox.Decrypt(blob, []byte(aadOwnerA))
	require.NoError(t, rerr, "same-owner AAD round-trips")
	require.Equal(t, aadSecret, string(out))

	_, serr := cryptobox.Decrypt(blob, []byte(aadOwnerB))
	require.ErrorIs(t, serr, cryptobox.ErrTampered,
		"swapping A's ciphertext into B's row must fail")
	require.NotContains(t, serr.Error(), aadSecret, "error must not leak the plaintext")
}

// TestAAD_EmptyMismatchAlsoFails — aad strictness: ciphertext sealed with
// empty AAD must also fail to decrypt under a non-empty AAD (no legacy
// fallback). Guards "unreleased → every ciphertext in the DB carries the
// correct owner AAD, no backdoor for unbound data".
func TestAAD_EmptyMismatchAlsoFails(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", testInstanceSecret)
	blob, err := cryptobox.Encrypt([]byte(aadSecret), nil) // sealed with no binding
	require.NoError(t, err)

	_, serr := cryptobox.Decrypt(blob, []byte(aadOwnerA))
	require.ErrorIs(t, serr, cryptobox.ErrTampered,
		"no-AAD ciphertext must NOT decrypt under a real AAD")
}
