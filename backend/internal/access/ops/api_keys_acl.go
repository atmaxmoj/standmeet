// api_keys_acl.go —— 一把 key 的权限收窄 + 哪些能力开给了 API 面(声明在 api_keys.go)。
//
// 两件事:
//
//   - per-key 的拒绝清单(capability / skill),跟邀请码那半边同一个模型:在 role 授的范围上
//     再减一层。
//   - owner 级的"开给 API 面"(候选 → 开 / 关)。能开的是哪些能力由能力轴说,所以那张清单
//     是注入进来的,不是这个域写死的。
//
// 每个 per-key 的操作都先按 owner 核一遍 key_id:key_id 是调用方给的,不核就是 BOLA。

package ops

import (
	"context"
	"encoding/json"
	"slices"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// 拒绝的两种 kind —— key 上只有这两类(语料收窄在 role 上)。
const (
	keyDenialKindCapability = "capability"
	keyDenialKindSkill      = "skill"
)

func apiKeyACLOps(d APIKeysDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "api_keys.list_denials",
			Description: "List the capability and skill ids denied on an API key " +
				"(per-key ACL: subtracted from what the key's assumed role grants).",
			InputSchema: keyIDSchema,
			Kind:        fp.Read,
			Reach:       mcpOnly(),
			Invoke:      listKeyDenials(d),
		},
		{
			ID: "api_keys.add_denial",
			Description: "Deny a capability or skill on an API key (per-key ACL). " +
				"kind is 'capability' or 'skill'; target_id is the capability/skill id.",
			InputSchema: keyDenialSchema,
			Kind:        fp.Action,
			Reach:       mcpOnly(),
			Invoke:      writeKeyDenial(d, keyDenialAdders(d), keyDenialVerbDenied),
		},
		{
			ID: "api_keys.remove_denial",
			Description: "Remove a per-key capability or skill denial (re-grants it if the " +
				"key's assumed role allows). kind is 'capability' or 'skill'.",
			InputSchema: keyDenialSchema,
			Kind:        fp.Action,
			Reach:       mcpOnly(),
			Invoke:      writeKeyDenial(d, keyDenialRemovers(d), keyDenialVerbRemoved),
		},
		{
			ID: "api.open",
			Description: "Open a capability to the API facade (make it an API candidate). " +
				"Only non-Agentic outward capabilities may be opened.",
			InputSchema: apiCapabilityIDSchema,
			Kind:        fp.Action,
			Reach:       mcpOnly(),
			Invoke:      openAPICapability(d),
		},
		{
			ID: "api.close",
			Description: "Close a capability from the API facade (withdraw its candidacy). " +
				"Keys whose role granted it stop reaching it immediately.",
			InputSchema: apiCapabilityIDSchema,
			Kind:        fp.Action,
			Reach:       mcpOnly(),
			Invoke:      closeAPICapability(d),
		},
		{
			ID: "api.list_candidates",
			Description: "List the capabilities that may be opened to the API facade " +
				"(available) and the ones currently opened for the owner (opened).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       mcpOnly(),
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

// ownedKey —— owner 核对:不是这个 owner 的 key,一律当"找不到"(不泄露它存在)。
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
		[2]string{"target_id", in.TargetID}); err != nil {
		return in, err
	}
	if in.Kind != keyDenialKindCapability && in.Kind != keyDenialKindSkill {
		return in, fp.BadInput("kind must be 'capability' or 'skill'")
	}
	return in, nil
}

// keyDenialWrite —— 写一条拒绝。加和删各有一张表,所以往下传的是**要做的那件事**。
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

// keyDenialOut —— 回执说清"对哪把 key 的哪一条做完了什么"。加和删各自的动词在
// verb 里(denied / removed),形状同一份。
type keyDenialOut struct {
	KeyID    string `json:"key_id"`
	Kind     string `json:"kind"`
	TargetID string `json:"target_id"`
	Denied   bool   `json:"denied,omitempty"`
	Removed  bool   `json:"removed,omitempty"`
}

// 回执里的动词 —— 已经发出去的字段名就是这两个。
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
