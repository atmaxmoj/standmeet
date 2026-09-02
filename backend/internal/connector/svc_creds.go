// svc_creds.go — what "saving credentials once" actually means.
//
// Two rules live here, because they constrain each other and writing them apart would
// inevitably drift:
//
//   1. **Merge by key, not a whole-body replace** (F-C-35). The panel only sends the keys the
//      owner actually typed into (`use-connector-card.ts`'s `setField` only records changed
//      fields), while the card says, word for word, "leave blank to keep it". The request body
//      used to get written down as-is — the owner changes one port, and host/username/password
//      vanish together with no error at all; the next connection failure's "check the host,
//      port, and credentials" would then point them at the port, when what actually went
//      missing was the password.
//      "This key wasn't sent" and "this key was set to empty" are two different things; merging
//      keeps them separate.
//
//   2. **Reset connected only when it actually changed** (F-C-30). §3 D-5 requires
//      re-verification after an identity/credential change — and that rule's premise is that
//      **it changed**. The panel's very first action on clicking Connect is saving credentials
//      once; clearing this unconditionally would show a perfectly good connection as "not
//      connected" before authorization even starts, while the token is still alive. The owner,
//      seeing "not connected", redoes authorization, while the visitor side, still holding the
//      live token, might keep working as normal.
//
// Merging happens before comparing: what needs comparing is the value **after merge** against
// the original, not the request body against the original — the latter would forever count
// "only one key was sent" as "it changed".

package connector

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
)

// SaveCredentials — save credentials. category/kind are fixed by the built-in manifest;
// unknown id → ErrNotFound.
func (s *Service) SaveCredentials(ctx context.Context, ownerID, id string, body []byte) error {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return merr
	}
	merged, changed := mergeCredentials(s.storedCredentials(ctx, ownerID, id), body)
	if err := s.d.Repo.SaveCredentials(ctx, &SaveConnectorCredsInput{
		OwnerID: ownerID, ConnectorID: id,
		Category: m.Category, Kind: m.Kind, Credentials: merged,
		ResetConnected: changed,
	}); err != nil {
		return fmt.Errorf("save connector credentials: %w", err)
	}
	return nil
}

// storedCredentials — the plaintext credentials this connector currently has stored; none /
// unreadable → empty (treated as the first write).
func (s *Service) storedCredentials(ctx context.Context, ownerID, id string) []byte {
	conn, err := s.d.Repo.Get(ctx, ownerID, id)
	if err != nil {
		return []byte{}
	}
	return conn.Credentials
}

// credMap — the shape credentials take at this layer: key → **the JSON value as-is**.
//
// Uses RawMessage instead of decoding into a concrete type because every connector's fields
// differ (smtp has seven strings, oauth2 has two plus a scopes array). It also lets "did it
// change" reduce to a **byte comparison** — more accurate than comparing field-by-field per
// type, and it doesn't need to know what each field is.
type credMap = map[string]json.RawMessage

// mergeCredentials — incoming keys overwrite, keys not sent are kept. Returns the merged
// result + **whether it actually changed**.
//
// If either side isn't a JSON object (first write, or historically stored as something that
// isn't an object) → falls back to "whole-body replace + counted as changed": when a merge
// isn't possible, better to fall back to the old behavior than to guess.
func mergeCredentials(existing, incoming []byte) ([]byte, bool) {
	cur, curOK := decodeCredMap(existing)
	in, inOK := decodeCredMap(incoming)
	if !curOK || !inOK {
		return incoming, true
	}
	changed := applyCredKeys(cur, in)
	out, err := json.Marshal(cur)
	if err != nil {
		return incoming, true
	}
	return out, changed
}

// decodeCredMap — decodes into key → JSON as-is; empty or not an object → can't decode.
func decodeCredMap(raw []byte) (credMap, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var m credMap
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, false
	}
	return m, true
}

// applyCredKeys — writes the received keys into cur, and reports whether any key's value
// **actually** differs.
func applyCredKeys(cur, in credMap) bool {
	changed := false
	for k, v := range in {
		old, had := cur[k]
		if !had || !bytes.Equal(old, v) {
			changed = true
		}
		cur[k] = v
	}
	return changed
}
