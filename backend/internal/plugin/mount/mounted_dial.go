// mounted_dial.go —— dialing an mcpAppFiber with its per-mount native key (rule 4).
// Split out of mounted.go: minting the key on dial, attaching it to the session, and revoking it on
// close (or on a failed dial) is one concern, apart from the fiber adapter's binding/prompt logic.

package mount

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/plugin/nativekey"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// closeAndRevoke —— close the dialed session and retire its per-mount native key. The key is a
// per-dial access token; when this binding closes the fiber is done reaching back, so the key must
// not resolve any longer (rule 4: minted at mount, revoked at unmount).
func closeAndRevoke(sess *mcpclient.Session, key nativekey.Key) func() {
	return func() {
		if key != "" && nativeKeyIssuer != nil {
			nativeKeyIssuer.Revoke(key)
		}
		sess.Close()
	}
}

// dialWithCachedSpecs —— dial once; if the tool specs are already cached, skip ListTools.
//
// Visible on the visitor side: every tool call goes through it (a card's "send confirmation"
// click → /sessions/{id}/tools/send_confirmation → assembly → here). Tool metadata is static
// server-side and caches on the first dial, but the ListTools round trip was being paid on
// every call — especially costly right after sandbox startup, measured up to 19s under load
// (see slowAssembleThreshold in public/tools.go).
//
// The cache does not skip the dial itself: the session is stateful and gets Closed after use
// (sandbox lives one turn, see [[sandbox-lives-one-turn]]). It only skips re-asking a
// question we already know the answer to.
func (c *mcpAppFiber) dialWithCachedSpecs(
	ctx context.Context, in *registry.AssembleInput,
) (*dialedApp, error) {
	workspace := provisionWorkspaceFor(&c.m, in.ConversationID)
	// Mint this dial's native key bound to the fiber and dial a copy of the manifest carrying it
	// in this sandbox's env (rule 4). dm is a copy so the per-dial secret never touches the shared
	// manifest; key is revoked on Close (or here if the dial fails).
	dm, key := withNativeKey(&c.m, in.FiberID())
	if cached, known := c.knownToolSpecs(); known {
		return finishDial(dialOnly(ctx, &dm, workspace, c.dialErrLog, cached))(key)
	}
	ds, derr := dialAndList(ctx, &dm, workspace, c.dialErrLog)
	if derr != nil {
		revokeIfUnclosed(key)
		return nil, derr
	}
	ds.tools = c.cachedToolSpecs(ds.tools)
	ds.nativeKey = key
	return ds, nil
}

// finishDial —— attach the minted key to a successful dial, or revoke it if the dial failed (no
// Close will run to revoke it). Curried so it composes with a `(ds, err)` dial result.
func finishDial(ds *dialedApp, derr error) func(nativekey.Key) (*dialedApp, error) {
	return func(key nativekey.Key) (*dialedApp, error) {
		if derr != nil {
			revokeIfUnclosed(key)
			return nil, derr
		}
		ds.nativeKey = key
		return ds, nil
	}
}

// revokeIfUnclosed —— retire a minted key when no session Close will (dial/mint failure paths).
func revokeIfUnclosed(key nativekey.Key) {
	if key != "" && nativeKeyIssuer != nil {
		nativeKeyIssuer.Revoke(key)
	}
}
