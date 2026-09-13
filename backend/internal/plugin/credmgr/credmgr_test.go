// credmgr_test.go — the credential-manager's crypto boundary: a sealed secret round-trips
// back to the same value for its owner, is bound to that owner (another owner cannot open it),
// and a tampered blob is refused. Persistence (blockstore) is covered by the e2e; this pins the
// security-critical encode/decode pair, which is pure (no DB).
//
// Not parallel: t.Setenv (INSTANCE_SECRET) forbids t.Parallel.

package credmgr //nolint:testpackage // white-box: encode/decode are unexported crypto helpers

import (
	"strings"
	"testing"
)

const (
	//nolint:lll // test fixture, not a real secret
	testInstanceSecret = "test-instance-secret-at-least-32-bytes-long" //gitleaks:allow
	ownerA             = "11111111-1111-1111-1111-111111111111"
	ownerB             = "22222222-2222-2222-2222-222222222222"
	probeValue         = "reddish-noon-anchor-42-do-not-leak"
)

func TestEncodeDecode_RoundTrips(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", testInstanceSecret)
	blob, err := encode(ownerA, probeValue)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if strings.Contains(blob, probeValue) {
		t.Fatalf("sealed blob leaks the plaintext: %q", blob)
	}
	got, derr := decode(ownerA, blob)
	if derr != nil {
		t.Fatalf("decode: %v", derr)
	}
	if got != probeValue {
		t.Fatalf("round-trip = %q, want %q", got, probeValue)
	}
}

func TestDecode_WrongOwnerRefused(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", testInstanceSecret)
	blob, err := encode(ownerA, probeValue)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	// A row lifted into another owner's context must not open (owner id is the AAD).
	if _, derr := decode(ownerB, blob); derr == nil {
		t.Fatal("decode under a different owner succeeded — AAD binding not enforced")
	}
}

func TestDecode_TamperedRefused(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", testInstanceSecret)
	blob, err := encode(ownerA, probeValue)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	// Flip a byte of the base64 payload → the GCM tag no longer verifies.
	tampered := "A" + blob[1:]
	if tampered == blob {
		tampered = "B" + blob[1:]
	}
	if _, derr := decode(ownerA, tampered); derr == nil {
		t.Fatal("decode of a tampered blob succeeded — integrity not enforced")
	}
}
