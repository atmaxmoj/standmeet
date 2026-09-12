// grants.go — the parts of a block's declaration the owner's panel still needs after
// the block has been registered.
//
// A registered block is a BEHAVIOUR, not a declaration: by the time the panel asks
// "what does this reach" or "what settings does it want", the manifest is gone. Two
// questions need it, and both are the owner's:
//
//	grants   what the block may reach. `isolation.md`'s argument for making a
//	         permission a block rather than a flag inside a transport config is that
//	         the owner ASSEMBLING it can see the permission — which only holds if the
//	         permission reaches the screen.
//	config   what settings it declares, so the panel can render a form it was never
//	         written for. `frontend.md` calls this the load-bearing piece: without it
//	         the block list is a directory of links to hand-written forms and nothing
//	         is gained.
//
// Noted as each block registers, and **every registration path in this package goes
// through `noteBlock`** — built-in, deploy-declared, and owner-installed alike. A block
// whose declaration was recorded on one path and not another is a block whose settings
// appear only sometimes, which is worse than never showing them.

package blockwire

import (
	"maps"
	"sync"

	"github.com/atmaxmoj/standmeet/internal/plugin"
)

// grantNet — the one grant name today. A block whose sandbox allows egress carries it;
// every other block carries nothing, because omission fails closed and there is no
// "net: off" to report.
const grantNet = "net"

var (
	blockFactsMu sync.RWMutex
	blockGrants  = map[string][]string{}
	blockConfig  = map[string][]plugin.ConfigField{}
)

// noteBlock — record what each of these blocks reaches and what it wants configured.
func noteBlock(manifests []plugin.Manifest) {
	blockFactsMu.Lock()
	defer blockFactsMu.Unlock()
	for i := range manifests {
		id := manifests[i].ID
		blockGrants[id] = grantsIn(&manifests[i])
		if len(manifests[i].Config) > 0 {
			blockConfig[id] = manifests[i].Config
		}
	}
}

func grantsIn(m *plugin.Manifest) []string {
	out := make([]string, 0, 1)
	if m.Transport.Sandbox != nil && m.Transport.Sandbox.AllowNet {
		out = append(out, grantNet)
	}
	return out
}

// grantsOf — the permissions this block carries, by name.
//
// An unknown id gets an empty list rather than nil, so the panel renders "carries
// nothing" instead of having to tell "nothing" from "I do not know" — a distinction it
// has no way to act on.
func grantsOf(id string) []string {
	blockFactsMu.RLock()
	defer blockFactsMu.RUnlock()
	if g, ok := blockGrants[id]; ok {
		return g
	}
	return []string{}
}

// configDecls — every block that declares settings, id → declaration.
//
// A snapshot, because the caller iterates it while blocks can still be installed: a map
// handed out under the lock would be read after the lock is gone.
func configDecls() map[string][]plugin.ConfigField {
	blockFactsMu.RLock()
	defer blockFactsMu.RUnlock()
	out := make(map[string][]plugin.ConfigField, len(blockConfig))
	maps.Copy(out, blockConfig)
	return out
}
