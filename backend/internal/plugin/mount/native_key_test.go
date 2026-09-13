package mount

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/nativekey"
)

// TestWithNativeKey_MintsDeliversConfines — a reach-back block gets a per-dial key in a COPY of its
// env, resolvable to the fiber; the shared manifest is untouched; revoke retires it.
// Not parallel: both tests set the package-global issuer via SetNativeKeyIssuer, so they must
// serialize (a shared global, the same pattern as the workspace provisioner).
//
//nolint:paralleltest // mutates the package-global nativeKeyIssuer; cannot run in parallel
func TestWithNativeKey_MintsDeliversConfines(t *testing.T) {
	iss := nativekey.NewIssuer()
	SetNativeKeyIssuer(iss)
	t.Cleanup(func() { SetNativeKeyIssuer(nil) })

	m := &plugin.Manifest{ID: "booker", Transport: plugin.Transport{
		Sandbox: &plugin.Sandbox{HostOps: []string{"blockstore.insert"}},
		Env:     map[string]string{"EXISTING": "1"},
	}}
	dm, key := withNativeKey(m, "b_bundle1")
	require.NotEmpty(t, key, "a reach-back block must get a minted key")

	got := dm.Transport.Env[plugin.NativeKeyEnv]
	require.NotEmpty(t, got, "native key must be delivered into the dial env")
	fiber, ok := iss.Resolve(nativekey.Key(got))
	require.True(t, ok, "delivered key must resolve")
	require.Equal(t, "b_bundle1", fiber, "resolves to the minting fiber")
	require.NotContains(t, m.Transport.Env, plugin.NativeKeyEnv, "shared manifest untouched")
	require.Equal(t, "1", dm.Transport.Env["EXISTING"], "existing env preserved in the copy")

	iss.Revoke(key)
	_, stillOK := iss.Resolve(key)
	require.False(t, stillOK, "revoked key must not resolve")
}

// TestWithNativeKey_NoKeyWhenNotApplicable — no issuer, or no host ops, gets no key or delivery.
//
//nolint:paralleltest // mutates the package-global nativeKeyIssuer; cannot run in parallel
func TestWithNativeKey_NoKeyWhenNotApplicable(t *testing.T) {
	SetNativeKeyIssuer(nil)
	reach := &plugin.Manifest{Transport: plugin.Transport{
		Sandbox: &plugin.Sandbox{HostOps: []string{"blockstore.insert"}},
	}}
	_, noIssuerKey := withNativeKey(reach, "f")
	require.Empty(t, noIssuerKey, "no issuer configured → no key")

	SetNativeKeyIssuer(nativekey.NewIssuer())
	t.Cleanup(func() { SetNativeKeyIssuer(nil) })
	noOps := &plugin.Manifest{Transport: plugin.Transport{Sandbox: &plugin.Sandbox{}}}
	dm, key := withNativeKey(noOps, "f")
	require.Empty(t, key, "no host ops → no key")
	require.NotContains(t, dm.Transport.Env, plugin.NativeKeyEnv, "no host ops → no delivery")
}
