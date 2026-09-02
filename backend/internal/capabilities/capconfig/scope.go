// scope.go — which subject a piece of config is attached to.
//
// This package originally did one thing: per-**owner** config. So when a
// capability wanted a per-**code** setting (booker's "how many times this code
// can book"), there was no path — it had to be hand-written in the assembly
// root: its own collection, its own read/write, and an adapter wiring it into
// the code-issuing args — three files, 200+ lines, all a hand copy of the same
// mechanism.
//
// Which subject config attaches to is a **parameter**, not two code paths. The
// two scopes' values are stored separately (different collections), so a
// capability's owner config and code config never overwrite each other.

package capconfig

// Scope — a config attachment point: which one of which kind of subject
// (owner / code).
type Scope struct {
	// key — the field name that identifies the subject in the document
	// ("owner_id" / "code_id").
	key string
	// collection — which collection this scope kind's values are stored in.
	// Stored separately so the two kinds' values never overwrite each other.
	collection string
	// id — specifically which owner / which code.
	id string
}

const (
	ownerCollection = "capconfig"
	codeCollection  = "capconfig_code"
	roleCollection  = "capconfig_role"
	keyCollection   = "capconfig_key"
)

// OwnerScope — an owner's config for this capability (what's filled in on the
// panel).
func OwnerScope(ownerID string) Scope {
	return Scope{key: "owner_id", collection: ownerCollection, id: ownerID}
}

// CodeScope — the fields this capability occupies on one invitation code
// (filled in together when the code is issued).
func CodeScope(codeID string) Scope {
	return Scope{key: "code_id", collection: codeCollection, id: codeID}
}

// RoleScope — the fields this capability occupies on one role (filled in
// together when the role is created).
//
// The third attachment point. Adding it only cost this one constructor — that
// only proves the earlier claim, "which subject config attaches to is a
// parameter": the first two scopes grew in together, so only a third one
// proves the shape actually extends.
//
// It differs from the first two in one way: config on a role gets **frozen**
// with the session (see RoleSnapshot's capability_config). capconfig itself is
// live storage; the freeze step reads it once when a code is issued / a
// session starts and snapshots it — a visitor's whole session follows the
// config as it was when they came in. An owner changing the role mid-session
// doesn't affect people already chatting.
func RoleScope(roleID string) Scope {
	return Scope{key: "role_id", collection: roleCollection, id: roleID}
}

// KeyScope — the fields this capability occupies on one **external API key**
// (filled in together when the key is minted).
//
// The fourth attachment point. It's not added for symmetry — it's F-B-11:
// quota used to recognize only "code", and there's no code on the API-key
// path — so bookings via an external key went **completely uncounted**, able
// to fill the real calendar without limit. The subject that actually exists on
// this surface is the key, so the cap attaches to the key.
func KeyScope(keyID string) Scope {
	return Scope{key: "api_key_id", collection: keyCollection, id: keyID}
}

// ID — the subject id at this attachment point. The quota side needs it to
// count usage (the capability's own storage records the same id), so "who the
// cap is attached to" and "who usage is counted against" use the **same
// value** — passed as two separate params, one of them would eventually pass a
// code while the other passed something else.
func (s Scope) ID() string { return s.id }

// ok — config only makes sense with a subject. An empty id (a session with no
// subject) → reads as empty, not an error.
func (s Scope) ok() bool { return s.id != "" }
