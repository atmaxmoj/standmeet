package mount

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/nativekey"
)

// TestWithNativeKey_MintsDeliversConfines — a reach-back block gets a per-dial key in a COPY of its
// env, resolvable to the fiber; the shared manifest is untouched; revoke retires it.
// The issuer is passed as a value (withKeyFrom), not set on the package global, so these tests
// share nothing and run in parallel.
func TestWithNativeKey_MintsDeliversConfines(t *testing.T) {
	t.Parallel()
	iss := nativekey.NewIssuer()

	m := &plugin.Manifest{ID: "booker", Transport: plugin.Transport{
		Sandbox: &plugin.Sandbox{HostOps: []string{"blockstore.insert"}},
		Env:     map[string]string{"EXISTING": "1"},
	}}
	dm, key := withKeyFrom(iss, m, "b_bundle1")
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
func TestWithNativeKey_NoKeyWhenNotApplicable(t *testing.T) {
	t.Parallel()
	reach := &plugin.Manifest{Transport: plugin.Transport{
		Sandbox: &plugin.Sandbox{HostOps: []string{"blockstore.insert"}},
	}}
	_, noIssuerKey := withKeyFrom(nil, reach, "f")
	require.Empty(t, noIssuerKey, "no issuer configured → no key")

	noOps := &plugin.Manifest{Transport: plugin.Transport{Sandbox: &plugin.Sandbox{}}}
	dm, key := withKeyFrom(nativekey.NewIssuer(), noOps, "f")
	require.Empty(t, key, "no host ops → no key")
	require.NotContains(t, dm.Transport.Env, plugin.NativeKeyEnv, "no host ops → no delivery")
}
