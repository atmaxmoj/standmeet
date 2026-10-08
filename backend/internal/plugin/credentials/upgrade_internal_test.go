// upgrade_internal_test.go — the vault→credmgr move's per-row decision (moveLegacyValue).
// A legacy value sitting in block_connections.credentials_enc goes into credmgr once at boot; a
// value credmgr already holds wins; a blob that won't decrypt is reported as "disconnect", not
// copied. The end-to-end proof (a real old volume + a deploy) is
// upgrade-credmgr-legacy-creds.spec.ts.
//
// White-box with a fake SecretStore — no DB. Not parallel: t.Setenv (INSTANCE_SECRET) forbids it.

package credentials

import (
	"context"
	"testing"
)

const (
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

func sealLegacy(t *testing.T, value string) []byte {
	t.Helper()
	enc, err := encBytes([]byte(value), []byte(upgradeOwner))
	if err != nil {
		t.Fatalf("seal legacy: %v", err)
	}
	return enc
}

func TestMoveLegacyValue_MovesIntoEmptyCredmgr(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", upgradeSecret)
	fake := newFakeSecrets()
	disconnect, err := moveLegacyValue(context.Background(), fake, upgradeOwner, upgradeBlock,
		sealLegacy(t, upgradeValue))
	if err != nil || disconnect {
		t.Fatalf("move: disconnect=%v err=%v, want false/nil", disconnect, err)
	}
	got, gerr := fake.Get(context.Background(), upgradeOwner, upgradeBlock)
	if gerr != nil || got != upgradeValue {
		t.Fatalf("credmgr value = %q (err %v), want %q", got, gerr, upgradeValue)
	}
}

func TestMoveLegacyValue_CredmgrValueWins(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", upgradeSecret)
	fake := newFakeSecrets()
	if err := fake.Set(context.Background(), upgradeOwner, upgradeBlock, upgradeValue); err != nil {
		t.Fatal(err)
	}
	fake.sets = 0
	disconnect, err := moveLegacyValue(context.Background(), fake, upgradeOwner, upgradeBlock,
		sealLegacy(t, `{"token":"stale-legacy"}`))
	if err != nil || disconnect || fake.sets != 0 {
		t.Fatalf("credmgr hit: disconnect=%v err=%v sets=%d, want false/nil/0",
			disconnect, err, fake.sets)
	}
}

func TestMoveLegacyValue_RotatedBlobDisconnects(t *testing.T) {
	t.Setenv("INSTANCE_SECRET", upgradeSecret)
	fake := newFakeSecrets()
	disconnect, err := moveLegacyValue(context.Background(), fake, upgradeOwner, upgradeBlock,
		[]byte("not-a-sealed-blob-at-all"))
	if err != nil || !disconnect || fake.sets != 0 {
		t.Fatalf("rotated blob: disconnect=%v err=%v sets=%d, want true/nil/0",
			disconnect, err, fake.sets)
	}
}
