// issuer_test.go — a minted key resolves to its fiber; distinct fibers get distinct keys; a
// forged/revoked key never resolves; and concurrent mint/resolve/revoke is race-free (the issuer
// is touched from mount, unmount, and reach-back auth on different goroutines).

package nativekey_test

import (
	"sync"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/plugin/nativekey"
)

const (
	fiberA     = "fiber-A"
	churnIters = 200
)

// mustIssue — mint or fail the test (keeps errcheck happy and the cases short).
func mustIssue(t *testing.T, iss *nativekey.Issuer, fiberID string) nativekey.Key {
	t.Helper()
	k, err := iss.Issue(fiberID)
	if err != nil {
		t.Fatalf("issue %q: %v", fiberID, err)
	}
	return k
}

func TestIssuer_ResolvesToFiber(t *testing.T) {
	t.Parallel()
	iss := nativekey.NewIssuer()
	got, ok := iss.Resolve(mustIssue(t, iss, fiberA))
	if !ok || got != fiberA {
		t.Fatalf("Resolve = (%q, %v), want (fiber-A, true)", got, ok)
	}
}

func TestIssuer_DistinctKeysPerIssue(t *testing.T) {
	t.Parallel()
	iss := nativekey.NewIssuer()
	a := mustIssue(t, iss, fiberA)
	b := mustIssue(t, iss, "fiber-B")
	a2 := mustIssue(t, iss, fiberA) // re-mint for the same fiber
	seen := map[nativekey.Key]bool{a: true, b: true, a2: true}
	if len(seen) != 3 {
		t.Fatal("keys collided across issues")
	}
	resolvesTo(t, iss, a, fiberA)
	resolvesTo(t, iss, b, "fiber-B")
	resolvesTo(t, iss, a2, fiberA)
}

func resolvesTo(t *testing.T, iss *nativekey.Issuer, k nativekey.Key, want string) {
	t.Helper()
	if got, ok := iss.Resolve(k); !ok || got != want {
		t.Fatalf("Resolve = (%q,%v), want (%q,true)", got, ok, want)
	}
}

func TestIssuer_ForgedKeyDoesNotResolve(t *testing.T) {
	t.Parallel()
	iss := nativekey.NewIssuer()
	_ = mustIssue(t, iss, fiberA)
	// A key the issuer never minted — no path to succeed (unforgeable + self-only: knowing a
	// fiber id gives no way to obtain its key, and a guessed key is not in the table).
	if id, ok := iss.Resolve(nativekey.Key("not-a-real-minted-key")); ok {
		t.Fatalf("forged key resolved to %q — must not", id)
	}
}

func TestIssuer_RevokedKeyStopsResolving(t *testing.T) {
	t.Parallel()
	iss := nativekey.NewIssuer()
	k := mustIssue(t, iss, fiberA)
	iss.Revoke(k)
	if id, ok := iss.Resolve(k); ok {
		t.Fatalf("revoked key still resolved to %q", id)
	}
	iss.Revoke(k) // idempotent — no panic
}

// TestIssuer_ConcurrentAccess — mount (Issue), unmount (Revoke), and reach-back auth (Resolve)
// run on different goroutines. Run under `go test -race`; the assertion is the absence of a data
// race and no panic, plus every live key resolving to its own fiber.
func TestIssuer_ConcurrentAccess(t *testing.T) {
	t.Parallel()
	iss := nativekey.NewIssuer()
	const workers = 16
	var wg sync.WaitGroup
	wg.Add(workers)
	for w := range workers {
		go func(id string) {
			defer wg.Done()
			churn(t, iss, id)
		}(string(rune('A' + w)))
	}
	wg.Wait()
}

// churn — one worker's mint→resolve→revoke loop, extracted so the goroutine body stays simple.
// Uses t.Errorf (not Fatalf): this runs on a child goroutine, where Fatalf's Goexit is illegal.
func churn(t *testing.T, iss *nativekey.Issuer, id string) {
	t.Helper()
	for range churnIters {
		k, err := iss.Issue(id)
		if err != nil {
			t.Errorf("issue %q: %v", id, err)
			return
		}
		if got, ok := iss.Resolve(k); !ok || got != id {
			t.Errorf("Resolve = (%q,%v), want (%q,true)", got, ok, id)
			return
		}
		iss.Revoke(k)
	}
}
