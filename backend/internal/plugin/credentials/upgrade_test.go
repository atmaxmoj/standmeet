// upgrade_test.go — the vault→credmgr migration's upgrade path (item 10). Credentials moved off
// the block_connections.credentials_enc column into the credential-manager (credmgr). An existing
// owner's value still sits in the legacy column with nothing in credmgr yet; resolveCreds must fall
// back to the legacy blob AND self-heal it into credmgr so the next read hits the new source. When
// credmgr already has the value it wins and the legacy blob is ignored.
//
// White-box (resolveCreds is unexported) with a fake SecretStore — no DB, so the fallback logic is
// pinned fast. Not parallel: t.Setenv (INSTANCE_SECRET) forbids it.

package credentials //nolint:testpackage // white-box: resolveCreds is unexported

import (
	"context"
	"testing"
)

const (
	//nolint:lll // test fixture, not a real secret
	upgradeSecret = "upgrade-test-instance-secret-32-bytes-plus" //gitleaks:allow
	upgradeOwner  = "11111111-1111-1111-1111-111111111111"
	upgradeBlock  = "up-legacy"
	upgradeValue  = `{"token":"legacy-value"}`
)

func secretKey(owner, name string) string { return owner + "\x00" + name }

// fakeSecrets — an in-memory SecretStore. Get returns "" for absent (the port's contract).
type fakeSecrets struct {
	store map[string]string
	sets  int
}

func newFakeSecrets() *fakeSecrets { return &fakeSecrets{store: map[string]string{}} }

func (f *fakeSecrets) Get(_ context.Context, owner, name string) (string, error) {
	return f.store[secretKey(owner, name)], nil
}

func (f *fakeSecrets) Set(_ context.Context, owner, name, value string) error {
	f.store[secretKey(owner, name)] = value
	f.sets++
	return nil
}

func (f *fakeSecrets) Delete(_ context.Context, owner, name string) error {
	delete(f.store, secretKey(owner, name))
	return nil
}

func TestResolveCreds_LegacyFallbackSelfHeals(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", upgradeSecret)
	aad := []byte(upgradeOwner)
	legacyEnc, err := encBytes([]byte(upgradeValue), aad)
	if err != nil {
		t.Fatalf("seal legacy: %v", err)
	}
	fake := newFakeSecrets() // credmgr empty → must fall back
	r := &Repo{secrets: fake}

	got, rerr := r.resolveCreds(context.Background(), upgradeOwner, upgradeBlock, legacyEnc, aad)
	if rerr != nil {
		t.Fatalf("resolveCreds: %v", rerr)
	}
	assertHealed(t, fake, string(got))
}

// assertHealed — the fallback returned the legacy value and self-healed it into credmgr.
func assertHealed(t *testing.T, fake *fakeSecrets, got string) {
	t.Helper()
	if got != upgradeValue {
		t.Fatalf("fallback value = %q, want %q", got, upgradeValue)
	}
	if fake.sets != 1 {
		t.Fatalf("expected one self-heal Set, got %d", fake.sets)
	}
	healed, gerr := fake.Get(context.Background(), upgradeOwner, upgradeBlock)
	if gerr != nil || healed != upgradeValue {
		t.Fatalf("self-healed value = %q (err %v), want %q", healed, gerr, upgradeValue)
	}
}

func TestResolveCreds_CredmgrWinsOverLegacy(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", upgradeSecret)
	aad := []byte(upgradeOwner)
	legacyEnc, err := encBytes([]byte(`{"token":"stale-legacy"}`), aad)
	if err != nil {
		t.Fatalf("seal legacy: %v", err)
	}
	fake := newFakeSecrets()
	seedCredmgr(t, fake)
	r := &Repo{secrets: fake}

	got, rerr := r.resolveCreds(context.Background(), upgradeOwner, upgradeBlock, legacyEnc, aad)
	if rerr != nil {
		t.Fatalf("resolveCreds: %v", rerr)
	}
	assertCredmgrWon(t, fake, string(got))
}

func seedCredmgr(t *testing.T, fake *fakeSecrets) {
	t.Helper()
	if err := fake.Set(context.Background(), upgradeOwner, upgradeBlock, upgradeValue); err != nil {
		t.Fatalf("seed credmgr: %v", err)
	}
	fake.sets = 0
}

// assertCredmgrWon — credmgr's value was returned and the legacy blob was ignored (no self-heal).
func assertCredmgrWon(t *testing.T, fake *fakeSecrets, got string) {
	t.Helper()
	if got != upgradeValue {
		t.Fatalf("credmgr value = %q, want %q (legacy must be ignored)", got, upgradeValue)
	}
	if fake.sets != 0 {
		t.Fatalf("credmgr hit must not self-heal; got %d Sets", fake.sets)
	}
}
