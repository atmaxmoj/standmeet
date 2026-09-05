// api_keys_acl.go — a key's permission narrowing + which capabilities are opened to the API
// facade (declared in api_keys.go).
//
// Two things:
//
//   - The per-key denylist (capability / skill), same model as the invitation-code half:
//     subtracting one more layer from what the role granted.
//   - The owner-level "open to the API facade" (candidate → open / close). Which capabilities
//     may be opened is decided by the capability axis, so that list is injected in, not
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
	keyDenialKindCapability = "capability"
	keyDenialKindSkill      = "skill"
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
			Description: "List the capability and skill ids denied on an API key " +
				"(per-key ACL: subtracted from what the key's assumed role grants).",
			InputSchema: keyIDSchema,
			Kind:        fp.Read,
			Reach:       denialsMCPOnly(),
			Invoke:      listKeyDenials(d),
		},
		{
			ID: "api_keys.add_denial",
			Description: "Deny a capability or skill on an API key (per-key ACL). " +
				"kind is 'capability' or 'skill'; target_id is the capability/skill id.",
			InputSchema: keyDenialSchema,
			Kind:        fp.Action,
			Reach:       denialsMCPOnly(),
			Invoke:      writeKeyDenial(d, keyDenialAdders(d), keyDenialVerbDenied),
		},
		{
			ID: "api_keys.remove_denial",
			Description: "Remove a per-key capability or skill denial (re-grants it if the " +
				"key's assumed role allows). kind is 'capability' or 'skill'.",
			InputSchema: keyDenialSchema,
			Kind:        fp.Action,
			Reach:       denialsMCPOnly(),
			Invoke:      writeKeyDenial(d, keyDenialRemovers(d), keyDenialVerbRemoved),
		},
		{
			ID: "api.open",
			Description: "Open a capability to the API facade (make it an API candidate). " +
				"Only non-Agentic outward capabilities may be opened.",
			InputSchema: apiCapabilityIDSchema,
			Kind:        fp.Action,
			Reach:       denialsMCPOnly(),
			Invoke:      openAPICapability(d),
		},
		{
			ID: "api.close",
			Description: "Close a capability from the API facade (withdraw its candidacy). " +
				"Keys whose role granted it stop reaching it immediately.",
			InputSchema: apiCapabilityIDSchema,
			Kind:        fp.Action,
			Reach:       denialsMCPOnly(),
			Invoke:      closeAPICapability(d),
		},
		{
			ID: "api.list_candidates",
			Description: "List the capabilities that may be opened to the API facade " +
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
			"kind":{"type":"string","description":"'capability' or 'skill'."},
			"target_id":{"type":"string","description":"Capability or skill id to deny."}
		},
		"required":["key_id","kind","target_id"]
	}`)

	apiCapabilityIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"capability_id":{"type":"string","description":"Capreg capability id."}
		},
		"required":["capability_id"]
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
	CapabilityIDs []string `json:"capability_ids"`
	SkillIDs      []string `json:"skill_ids"`
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
	caps, cerr := d.Keys.ListCapabilityDenials(ctx, keyID)
	if cerr != nil {
		return keyDenialsOut{}, apiKeyErr(cerr)
	}
	skills, serr := d.Keys.ListSkillDenials(ctx, keyID)
	if serr != nil {
		return keyDenialsOut{}, apiKeyErr(serr)
	}
	return keyDenialsOut{
		CapabilityIDs: nonNilStrings(caps), SkillIDs: nonNilStrings(skills),
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
	if in.Kind != keyDenialKindCapability && in.Kind != keyDenialKindSkill {
		return in, fp.BadInput("kind must be 'capability' or 'skill'")
	}
	return in, nil
}

// keyDenialWrite — writes one denial. Add and remove each have their own table, so what gets
// passed down is **the action to perform**.
type keyDenialWrite func(ctx context.Context, keyID, target string) error

func keyDenialAdders(d APIKeysDeps) map[string]keyDenialWrite {
	return map[string]keyDenialWrite{
		keyDenialKindCapability: d.Keys.AddCapabilityDenial,
		keyDenialKindSkill:      d.Keys.AddSkillDenial,
	}
}

func keyDenialRemovers(d APIKeysDeps) map[string]keyDenialWrite {
	return map[string]keyDenialWrite{
		keyDenialKindCapability: d.Keys.DeleteCapabilityDenial,
		keyDenialKindSkill:      d.Keys.DeleteSkillDenial,
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

type apiCapabilityIDArgs struct {
	CapabilityID string `json:"capability_id"`
}

func parseAPICapabilityID(raw json.RawMessage) (string, error) {
	var in apiCapabilityIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.CapabilityID, fp.RequireArgs([2]string{"capability_id", in.CapabilityID})
}

type apiCandidacyOut struct {
	CapabilityID string `json:"capability_id"`
	Opened       bool   `json:"opened,omitempty"`
	Closed       bool   `json:"closed,omitempty"`
}

func openAPICapability(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		capID, perr := parseAPICapabilityID(raw)
		if perr != nil {
			return nil, perr
		}
		if !slices.Contains(d.APICandidates(), capID) {
			return nil, fp.BadInput("capability is not an API candidate")
		}
		if err := d.Keys.OpenCapability(ctx, ownerID, capID); err != nil {
			return nil, apiKeyErr(err)
		}
		return json.Marshal(apiCandidacyOut{CapabilityID: capID, Opened: true})
	}
}

func closeAPICapability(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		capID, perr := parseAPICapabilityID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := d.Keys.CloseCapability(ctx, ownerID, capID); err != nil {
			return nil, apiKeyErr(err)
		}
		return json.Marshal(apiCandidacyOut{CapabilityID: capID, Closed: true})
	}
}

type apiCandidatesOut struct {
	Available []string `json:"available"`
	Opened    []string `json:"opened"`
}

func listAPICandidates(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		opened, err := d.Keys.ListOpenCapabilities(ctx, ownerID)
		if err != nil {
			return nil, apiKeyErr(err)
		}
		return json.Marshal(apiCandidatesOut{
			Available: nonNilStrings(d.APICandidates()), Opened: nonNilStrings(opened),
		})
	}
}
