package credentials

import "time"

// Connection — a supplier's **decrypted** connection state for some owner (#155
// unified supplier layer). Decrypted at the repo boundary before it comes out; the
// plaintext credentials live only inside the supplier layer's memory, never reach
// usecases. Credentials is the decrypted credential JSON, parsed by kind (openapi
// oauth2 {client_id,client_secret} / apiKey {key} / smtp config).
type Connection struct {
	TokenExpiresAt *time.Time
	BlockID        string
	Seam           string
	Kind           string
	// Title — the name the vendor gave this API themselves (the info.title picked up
	// when the openapi supplier was ingested). Left blank for built-ins — their name
	// IS the seam. **An uploaded supplier with no seam contract bound has an
	// empty-string Seam**, so this is its only name in the UI (F-C-56).
	Title        string
	AccessToken  string
	RefreshToken string
	Credentials  []byte
	Scopes       []string
	Connected    bool
	Active       bool
	// Unreadable — this row's ciphertext can no longer be decrypted on this instance
	// (INSTANCE_SECRET was rotated, or the ciphertext was tampered with).
	//
	// **Why a status flag and not an error** (F-C-41): after a key rotation,
	// `suppliers.list` used to 500 outright, and the UI read that as "the list is
	// empty" — so **every card** rendered as "you've never connected this", while the
	// ciphertext and connected_at were still sitting in the database. The owner would
	// then act on a configuration they never actually got to read.
	//
	// A row's **identity** is its plaintext columns (block_id / seam / kind);
	// only the secrets fail to decode. So this row should still come back normally,
	// still say who it is, just carrying the message "reconnect this".
	//
	// Warning: don't expect to distinguish "tampered with" from "key was rotated" —
	// AES-GCM auth failure is cryptographically the same event either way. This one
	// flag has to cover both worlds, and the message shown has to make sense for both.
	Unreadable bool
}
