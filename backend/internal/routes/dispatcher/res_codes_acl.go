// res_codes_acl.go —— codes 资源的 ACL 面:per-code 的拒绝清单 + 引导目的地。
//
// 拒绝有**三种**(capability / skill / corpus URI),它们是同一件事的三个维度:
// 这张码在 role 给的范围上再收窄一层。
//
// 迁移前它们被拆在两处:MCP 的 codes.list_denials 只给前两种,corpus 那一种由一条单独的
// admin 路由(`/codes/{id}/corpus`)伺候,而且那条路由**在台账里没有一行**。
// 于是 owner 从 Claude Code 看一张码的 ACL,看到的是**不完整的**那份 —— 少的正好是
// "这张码看不到哪些语料"。现在三种在同一个载荷里。

package dispatcher

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// CodeDenials —— 一张码的三类拒绝,外加 role 在语料上**授**了什么。
//
// 带上 CorpusGranted 是因为收回只有对着正列表看才有意义:owner 要判断"这张码还能看什么",
// 光看收回列表看不出来。以前这半边只长在面板那条独立路由上,MCP 的 list_denials 看不到。
type CodeDenials struct {
	CapabilityIDs []string
	SkillIDs      []string
	CorpusURIs    []string
	CorpusGranted []string
}

// CodeDenialRef —— 加/删一条拒绝。Kind 取 capability / skill / corpus。
type CodeDenialRef struct {
	OwnerID  string
	CodeID   string
	Kind     string
	TargetID string
}

// CodeWaypoints —— 引导目的地的三层:role 继承的、这张码覆盖的、合并后实际生效的。
// 原样透传 JSON:结构属于 access 域,收口不需要看懂。
type CodeWaypoints struct {
	Inherited json.RawMessage
	Overrides json.RawMessage
	Effective json.RawMessage
}

// 拒绝的三种 kind —— 面板和 MCP 用同一套词。
const (
	DenialKindCapability = "capability"
	DenialKindSkill      = "skill"
	DenialKindCorpus     = "corpus"
)

// CodeACLStore —— 一张码的权限收窄面:三类拒绝 + 引导目的地。
type CodeACLStore interface {
	Denials(ctx context.Context, ownerID, codeID string) (CodeDenials, error)
	AddDenial(ctx context.Context, in *CodeDenialRef) (CodeDenials, error)
	RemoveDenial(ctx context.Context, in *CodeDenialRef) (CodeDenials, error)
	SetCorpusDenials(
		ctx context.Context, ownerID, codeID string, uris []string,
	) (CodeDenials, error)
	Waypoints(ctx context.Context, ownerID, codeID string) (CodeWaypoints, error)
	SetWaypoints(
		ctx context.Context, ownerID, codeID string, w json.RawMessage,
	) (CodeWaypoints, error)
}

func codeACLOps(store CodeACLStore) []Op {
	return []Op{
		{
			ID: "codes.list_denials",
			Description: "List everything this code is denied: capabilities, skills, and " +
				"corpus URI globs. All three narrow whatever the role granted.",
			InputSchema: codeIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      codesDenials(store),
		},
		{
			ID: "codes.add_denial",
			Description: "Deny this code one capability, skill, or corpus URI glob. " +
				"Idempotent.",
			InputSchema: codeDenialSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      codesAddDenial(store),
		},
		{
			ID:          "codes.remove_denial",
			Description: "Lift one denial from this code. Idempotent.",
			InputSchema: codeDenialSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      codesRemoveDenial(store),
		},
		{
			ID: "codes.set_corpus_denials",
			Description: "Replace the whole list of corpus URI globs this code takes back " +
				"from its role's grant. Pure subtraction: it can never open what the role " +
				"never granted.",
			InputSchema: codeCorpusSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      codesSetCorpusDenials(store),
		},
		{
			ID: "codes.waypoints",
			Description: "Read this code's ghost-steering waypoints: what it inherits from " +
				"the role, what it overrides, and the effective merge.",
			InputSchema: codeIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      codesWaypoints(store),
		},
		{
			ID: "codes.set_waypoints",
			Description: "Set this code's waypoint overrides. An empty list clears the " +
				"override and goes back to inheriting the role's.",
			InputSchema: codeWaypointsSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      codesSetWaypoints(store),
		},
	}
}

var codeDenialSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code_id":{"type":"string","description":"Access code id."},
		"kind":{"type":"string","description":"capability | skill | corpus."},
		"target_id":{"type":"string",
			"description":"Capability id, skill id, or corpus URI glob."}
	},
	"required":["code_id","kind","target_id"]
}`)

var codeCorpusSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code_id":{"type":"string","description":"Access code id."},
		"uris":{"type":"array","items":{"type":"string"},
			"description":"Corpus URI globs this code takes back; empty inherits the role."}
	},
	"required":["code_id","uris"]
}`)

var codeWaypointsSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code_id":{"type":"string","description":"Access code id."},
		"waypoints":{"type":"array","items":{"type":"object"},
			"description":"Override list; empty clears the override."}
	},
	"required":["code_id","waypoints"]
}`)

// codeDenialsOut / codeWaypointsOut —— 出站载荷(两个面同一份)。
type codeDenialsOut struct {
	CapabilityIDs []string `json:"capability_ids"`
	SkillIDs      []string `json:"skill_ids"`
	CorpusURIs    []string `json:"corpus_uris"`
	CorpusGranted []string `json:"corpus_granted"`
}

type codeWaypointsOut struct {
	Inherited json.RawMessage `json:"inherited"`
	Overrides json.RawMessage `json:"overrides"`
	Effective json.RawMessage `json:"effective"`
}

func toCodeDenialsOut(d *CodeDenials) codeDenialsOut {
	return codeDenialsOut{
		CapabilityIDs: nonNilStrings(d.CapabilityIDs),
		SkillIDs:      nonNilStrings(d.SkillIDs),
		CorpusURIs:    nonNilStrings(d.CorpusURIs),
		CorpusGranted: nonNilStrings(d.CorpusGranted),
	}
}

func toCodeWaypointsOut(w *CodeWaypoints) codeWaypointsOut {
	return codeWaypointsOut{
		Inherited: emptyJSONArray(w.Inherited),
		Overrides: emptyJSONArray(w.Overrides),
		Effective: emptyJSONArray(w.Effective),
	}
}

func codesDenials(store CodeACLStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		d, err := store.Denials(ctx, ownerID, id)
		if err != nil {
			return nil, wrapCodeErr("list denials", err)
		}
		return marshalOut(toCodeDenialsOut(&d))
	}
}

func codesAddDenial(store CodeACLStore) Invoke {
	return codesDenialWrite(store.AddDenial, "add denial")
}

func codesRemoveDenial(store CodeACLStore) Invoke {
	return codesDenialWrite(store.RemoveDenial, "remove denial")
}

// codesDenialWrite —— 加和删只差调哪个函数;入参、校验、回包形状同一份。
func codesDenialWrite(
	apply func(ctx context.Context, in *CodeDenialRef) (CodeDenials, error), what string,
) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseCodeDenial(raw)
		if perr != nil {
			return nil, perr
		}
		in.OwnerID = ownerID
		d, err := apply(ctx, in)
		if err != nil {
			return nil, wrapCodeErr(what, err)
		}
		return marshalOut(toCodeDenialsOut(&d))
	}
}

type codeCorpusArgs struct {
	CodeID string   `json:"code_id"`
	URIs   []string `json:"uris"`
}

// codesSetCorpusDenials —— 整份替换。语料收回是 owner 在一个文本框里编辑的一张清单,
// 逐条加/删表达不了"存这一版"。
func codesSetCorpusDenials(store CodeACLStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeCorpusArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.CodeID == "" {
			return nil, BadInput("code_id is required")
		}
		d, err := store.SetCorpusDenials(ctx, ownerID, in.CodeID, nonNilStrings(in.URIs))
		if err != nil {
			return nil, wrapCodeErr("set corpus denials", err)
		}
		return marshalOut(toCodeDenialsOut(&d))
	}
}

func codesWaypoints(store CodeACLStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		w, err := store.Waypoints(ctx, ownerID, id)
		if err != nil {
			return nil, wrapCodeErr("read waypoints", err)
		}
		return marshalOut(toCodeWaypointsOut(&w))
	}
}

type codeWaypointsArgs struct {
	CodeID    string          `json:"code_id"`
	Waypoints json.RawMessage `json:"waypoints"`
}

func codesSetWaypoints(store CodeACLStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeWaypointsArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.CodeID == "" {
			return nil, BadInput("code_id is required")
		}
		w, err := store.SetWaypoints(ctx, ownerID, in.CodeID, in.Waypoints)
		if err != nil {
			return nil, wrapCodeErr("set waypoints", err)
		}
		return marshalOut(toCodeWaypointsOut(&w))
	}
}
