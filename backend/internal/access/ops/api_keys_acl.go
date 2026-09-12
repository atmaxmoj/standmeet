// api_keys_acl.go — a key's permission narrowing + which blocks are opened to the API
// facade (declared in api_keys.go).
//
// Two things:
//
//   - The per-key denylist (block / skill), same model as the invitation-code half:
//     subtracting one more layer from what the role granted.
//   - The owner-level "open to the API facade" (candidate → open / close). Which blocks
//     may be opened is decided by the registry, so that list is injected in, not
//     hardcoded by this domain.
//
// Every per-key operation first checks key_id against the owner: key_id is caller-supplied,
// skipping that check is a BOLA.

package ops

import (
	"context"
	"encoding/json"
	"slices"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// The two denial kinds — a key only has these two (corpus narrowing lives on the role).
const (
	keyDenialKindBlock = "block"
	keyDenialKindSkill = "skill"
)

// denialsMCPOnly — this group grows only on MCP for now.
//
// **The reason is scope, not absence** (F-K-1 conflated the two once): the four CRUD ops
// already grow on both facades, because a leaked key must be revocable straight from the
// webpage. The per-key denylist and the api-open candidate toggle are **tuning**, not on the
// "how do we stop the bleeding" path, so they stay on MCP for now until the admin api section
// grows its own candidates block.
//
// The design does want them on admin too (`facade-directions.md:202-206` lists denials and
// open/close together), so this reason is **an IOU, not an argument** — don't read it as "this
// is how it should be".
func denialsMCPOnly() fp.Reach {
	return fp.Only(
		"tuning, not incident response: revocation is the admin path (F-K-1); "+
			"denials + api-open follow when the admin api section grows its candidates list",
		"mcp",
	)
}

func apiKeyACLOps(d APIKeysDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "api_keys.list_denials",
			Description: "List the block and skill ids denied on an API key " +
				"(per-key ACL: subtracted from what the key's assumed role grants).",
			InputSchema: keyIDSchema,
			Kind:        fp.Read,
			Reach:       denialsMCPOnly(),
			Invoke:      listKeyDenials(d),
		},
		{
			ID: "api_keys.add_denial",
			Description: "Deny a block or skill on an API key (per-key ACL). " +
				"kind is 'block' or 'skill'; target_id is the block/skill id.",
			InputSchema: keyDenialSchema,
			Kind:        fp.Action,
			Reach:       denialsMCPOnly(),
			Invoke:      writeKeyDenial(d, keyDenialAdders(d), keyDenialVerbDenied),
		},
		{
			ID: "api_keys.remove_denial",
			Description: "Remove a per-key block or skill denial (re-grants it if the " +
				"key's assumed role allows). kind is 'block' or 'skill'.",
			InputSchema: keyDenialSchema,
			Kind:        fp.Action,
			Reach:       denialsMCPOnly(),
			Invoke:      writeKeyDenial(d, keyDenialRemovers(d), keyDenialVerbRemoved),
		},
		{
			ID: "api.open",
			Description: "Open a block to the API facade (make it an API candidate). " +
				"Only non-Agentic outward blocks may be opened.",
			InputSchema: apiBlockIDSchema,
			Kind:        fp.Action,
			Reach:       denialsMCPOnly(),
			Invoke:      openAPIBlock(d),
		},
		{
			ID: "api.close",
			Description: "Close a block from the API facade (withdraw its candidacy). " +
				"Keys whose role granted it stop reaching it immediately.",
			InputSchema: apiBlockIDSchema,
			Kind:        fp.Action,
			Reach:       denialsMCPOnly(),
			Invoke:      closeAPIBlock(d),
		},
		{
			ID: "api.list_candidates",
			Description: "List the blocks that may be opened to the API facade " +
				"(available) and the ones currently opened for the owner (opened).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       denialsMCPOnly(),
			Invoke:      listAPICandidates(d),
		},
	}
}

var (
	keyIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"key_id":{"type":"string","description":"API key UUID."}},
		"required":["key_id"]
	}`)

	keyDenialSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"key_id":{"type":"string","description":"API key UUID."},
			"kind":{"type":"string","description":"'block' or 'skill'."},
			"target_id":{"type":"string","description":"Block or skill id to deny."}
		},
		"required":["key_id","kind","target_id"]
	}`)

	apiBlockIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"block_id":{"type":"string","description":"Registry block id."}
		},
		"required":["block_id"]
	}`)
)

// ownedKey — owner check: a key that isn't this owner's is always treated as "not found"
// (never leaks that it exists).
func ownedKey(ctx context.Context, d APIKeysDeps, ownerID, keyID string) error {
	if _, err := d.Keys.GetByID(ctx, keyID, ownerID); err != nil {
		return fp.NotFound("api key not found")
	}
	return nil
}

type keyIDArgs struct {
	KeyID string `json:"key_id"`
}

func parseKeyID(raw json.RawMessage) (string, error) {
	var in keyIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.KeyID, fp.RequireArgs([2]string{"key_id", in.KeyID})
}

type keyDenialsOut struct {
	BlockIDs []string `json:"block_ids"`
	SkillIDs []string `json:"skill_ids"`
}

func listKeyDenials(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		keyID, perr := parseKeyID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := ownedKey(ctx, d, ownerID, keyID); err != nil {
			return nil, err
		}
		out, err := loadKeyDenials(ctx, d, keyID)
		if err != nil {
			return nil, err
		}
		return json.Marshal(out)
	}
}

func loadKeyDenials(
	ctx context.Context, d APIKeysDeps, keyID string,
) (keyDenialsOut, error) {
	blocks, cerr := d.Keys.ListBlockDenials(ctx, keyID)
	if cerr != nil {
		return keyDenialsOut{}, apiKeyErr(cerr)
	}
	skills, serr := d.Keys.ListSkillDenials(ctx, keyID)
	if serr != nil {
		return keyDenialsOut{}, apiKeyErr(serr)
	}
	return keyDenialsOut{
		BlockIDs: nonNilStrings(blocks), SkillIDs: nonNilStrings(skills),
	}, nil
}

type keyDenialArgs struct {
	KeyID    string `json:"key_id"`
	Kind     string `json:"kind"`
	TargetID string `json:"target_id"`
}

func parseKeyDenial(raw json.RawMessage) (keyDenialArgs, error) {
	var in keyDenialArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"key_id", in.KeyID}, [2]string{"kind", in.Kind},
		[2]string{"target_id", in.TargetID},
	); err != nil {
		return in, err
	}
	if in.Kind != keyDenialKindBlock && in.Kind != keyDenialKindSkill {
		return in, fp.BadInput("kind must be 'block' or 'skill'")
	}
	return in, nil
}

// keyDenialWrite — writes one denial. Add and remove each have their own table, so what gets
// passed down is **the action to perform**.
type keyDenialWrite func(ctx context.Context, keyID, target string) error

func keyDenialAdders(d APIKeysDeps) map[string]keyDenialWrite {
	return map[string]keyDenialWrite{
		keyDenialKindBlock: d.Keys.AddBlockDenial,
		keyDenialKindSkill: d.Keys.AddSkillDenial,
	}
}

func keyDenialRemovers(d APIKeysDeps) map[string]keyDenialWrite {
	return map[string]keyDenialWrite{
		keyDenialKindBlock: d.Keys.DeleteBlockDenial,
		keyDenialKindSkill: d.Keys.DeleteSkillDenial,
	}
}

// keyDenialOut — the receipt states plainly "what was done, to which entry, on which key".
// Add and remove each have their own verb in verb (denied / removed); the shape is identical.
type keyDenialOut struct {
	KeyID    string `json:"key_id"`
	Kind     string `json:"kind"`
	TargetID string `json:"target_id"`
	Denied   bool   `json:"denied,omitempty"`
	Removed  bool   `json:"removed,omitempty"`
}

// The verbs in the receipt — these are the field names already shipped.
const (
	keyDenialVerbDenied  = "denied"
	keyDenialVerbRemoved = "removed"
)

func writeKeyDenial(d APIKeysDeps, writes map[string]keyDenialWrite, verb string) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseKeyDenial(raw)
		if perr != nil {
			return nil, perr
		}
		if err := ownedKey(ctx, d, ownerID, in.KeyID); err != nil {
			return nil, err
		}
		if err := writes[in.Kind](ctx, in.KeyID, in.TargetID); err != nil {
			return nil, fp.OpErr("write key denial", err)
		}
		return json.Marshal(keyDenialOut{
			KeyID: in.KeyID, Kind: in.Kind, TargetID: in.TargetID,
			Denied: verb == keyDenialVerbDenied, Removed: verb == keyDenialVerbRemoved,
		})
	}
}

type apiBlockIDArgs struct {
	BlockID string `json:"block_id"`
}

func parseAPIBlockID(raw json.RawMessage) (string, error) {
	var in apiBlockIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.BlockID, fp.RequireArgs([2]string{"block_id", in.BlockID})
}

type apiCandidacyOut struct {
	BlockID string `json:"block_id"`
	Opened  bool   `json:"opened,omitempty"`
	Closed  bool   `json:"closed,omitempty"`
}

func openAPIBlock(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		blockID, perr := parseAPIBlockID(raw)
		if perr != nil {
			return nil, perr
		}
		if !slices.Contains(d.APICandidates(), blockID) {
			return nil, fp.BadInput("block is not an API candidate")
		}
		if err := d.Keys.OpenBlock(ctx, ownerID, blockID); err != nil {
			return nil, apiKeyErr(err)
		}
		return json.Marshal(apiCandidacyOut{BlockID: blockID, Opened: true})
	}
}

func closeAPIBlock(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		blockID, perr := parseAPIBlockID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := d.Keys.CloseBlock(ctx, ownerID, blockID); err != nil {
			return nil, apiKeyErr(err)
		}
		return json.Marshal(apiCandidacyOut{BlockID: blockID, Closed: true})
	}
}

type apiCandidatesOut struct {
	Available []string `json:"available"`
	Opened    []string `json:"opened"`
}

func listAPICandidates(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		opened, err := d.Keys.ListOpenBlocks(ctx, ownerID)
		if err != nil {
			return nil, apiKeyErr(err)
		}
		return json.Marshal(apiCandidatesOut{
			Available: nonNilStrings(d.APICandidates()), Opened: nonNilStrings(opened),
		})
	}
}
