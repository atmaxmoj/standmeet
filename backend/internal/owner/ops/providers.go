// providers.go —— owner 的 provider 本子对外那一组操作。
//
// **建/改 key 那两条只在面板上**(fp.Only "carries a raw provider API key"),跟隔壁
// ai_provider.set 同一个理由:它们带原始密钥,MCP 是纯 JSON 工具面,不承载这个。
// 列表 / 标默认 / 删,不碰密钥,两个面都给。
//
// 出站结构里**没有 key 字段** —— 不是"记得别写",是压根没有,所以任何一个面都无从泄露。

package ops

import (
	"context"
	"encoding/json"
	"errors"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// ProvidersDeps —— 这一组要的依赖。
type ProvidersDeps struct {
	Providers usecase.ProvidersDeps
	// ModelLister —— 去问某条 provider 有哪些模型（F-R-11）。端口，不是仓储：key 在库里
	// 是密文而这一侧从不解封，实现落在组装根。nil = 这台实例没有这个能力，说出来而不是假装问过。
	ModelLister usecase.ProviderModelLister
}

// Providers —— providers.list / create / update / set_default / delete。
func Providers(d ProvidersDeps) []fp.Op {
	return append([]fp.Op{
		{
			ID: "providers.list",
			Description: "List the owner's inference providers (label, provider, endpoint, " +
				"model, whether a key is set, which one is the default, remaining gas).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listProviders(d),
		},
		{
			ID: "providers.set_default",
			Description: "Make one provider the default — the one used when neither the " +
				"access code nor the role names another.",
			InputSchema: providerIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setDefaultProvider(d),
		},
		{
			ID: "providers.list_models",
			Description: "Ask a configured provider which models it offers, using the key " +
				"already stored for it. Omit id for the default provider. Returns model " +
				"names only — never the key.",
			InputSchema: providerModelsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listProviderModels(d.ModelLister),
		},
		{
			ID: "providers.delete",
			Description: "Delete a provider. Codes and roles pointing at it fall back to the " +
				"default; the default itself cannot be deleted.",
			InputSchema: providerIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteProvider(d),
		},
	}, providerWriteOps(d)...)
}

// providerWriteOps —— 带明文 key 的那两条,只在面板上。
func providerWriteOps(d ProvidersDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "providers.create",
			Description: "Add a provider to the owner's book: label, provider preset, " +
				"endpoint, model, and the API key itself (encrypted at rest, never returned).",
			InputSchema: providerCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.Only("carries a raw provider API key", "admin"),
			Invoke:      createProvider(d),
		},
		{
			ID: "providers.update",
			Description: "Change a provider's label / preset / endpoint / model, or set its " +
				"gas tank (tokens; null = unmetered).",
			InputSchema: providerUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateProvider(d),
		},
	}
}

var (
	providerIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"id":{"type":"string","description":"Provider id."}},
		"required":["id"]
	}`)

	providerCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"label":{"type":"string","description":"The owner's name for this entry."},
			"provider":{"type":"string","description":"Preset name, or 'custom' for self-hosted."},
			"endpoint":{"type":"string","description":"Base URL (preset default, or required)."},
			"model":{"type":"string","description":"Model id."},
			"key":{"type":"string","description":"The API key."},
			"is_default":{"type":"boolean","description":"Make this the default entry."}
		},
		"required":["label","provider"]
	}`)

	providerUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string"},
			"label":{"type":"string"},
			"provider":{"type":"string"},
			"endpoint":{"type":"string"},
			"model":{"type":"string"},
			"gas_tokens":{"type":["integer","null"],
				"description":"Remaining tokens on this tank; null = unmetered."}
		},
		"required":["id"]
	}`)
)

// providerOut —— 出站形状。**没有 key**。
//
// gas_tokens 是加了多少,gas_remaining 是还剩多少(读时派生)。两个都给:只报剩余,
// owner 看不出这箱油当初加了多大;只报加了多少,那句"还能聊多久"就得他自己算。
type providerOut struct {
	GasTokens     *int64 `json:"gas_tokens"`
	GasRemaining  *int64 `json:"gas_remaining"`
	ID            string `json:"id"`
	Label         string `json:"label"`
	Provider      string `json:"provider"`
	Endpoint      string `json:"endpoint"`
	Model         string `json:"model"`
	KeyConfigured bool   `json:"key_configured"`
	IsDefault     bool   `json:"is_default"`
}

func providerPayload(p *repo.ProviderRow, remaining *int64) providerOut {
	return providerOut{
		ID: p.ID, Label: p.Label, Provider: p.Provider, Endpoint: p.Endpoint,
		Model: p.Model, KeyConfigured: p.KeyConfigured, IsDefault: p.IsDefault,
		GasTokens: p.GasTokens, GasRemaining: remaining,
	}
}

func listProviders(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListProviders(ctx, d.Providers, ownerID)
		if err != nil {
			return nil, providerErr("list providers", err)
		}
		out := make([]providerOut, 0, len(rows))
		for i := range rows {
			out = append(out, providerPayload(&rows[i].Row, rows[i].Remaining))
		}
		return json.Marshal(out)
	}
}

type providerCreateArgs struct {
	Label     string `json:"label"`
	Provider  string `json:"provider"`
	Endpoint  string `json:"endpoint"`
	Model     string `json:"model"`
	Key       string `json:"key"`
	IsDefault bool   `json:"is_default"`
}

func createProvider(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in providerCreateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		row, cerr := usecase.CreateProvider(ctx, d.Providers, &usecase.CreateProviderInput{
			OwnerID: ownerID, Label: in.Label, Provider: in.Provider,
			Endpoint: in.Endpoint, Model: in.Model, Key: in.Key, IsDefault: in.IsDefault,
		})
		if cerr != nil {
			return nil, providerErr("create provider", cerr)
		}
		return marshalProvider(ctx, d, &row)
	}
}

// marshalProvider —— 一条 + 它的油表读数。写完立刻读一次表:owner 加完油看到的
// 就是那道闸看到的同一个数,而不是前端自己按加了多少猜一个。
func marshalProvider(
	ctx context.Context, d ProvidersDeps, row *repo.ProviderRow,
) (json.RawMessage, error) {
	left, err := usecase.ProviderRemaining(ctx, d.Providers.Spend, row)
	if err != nil {
		return nil, providerErr("read provider gas", err)
	}
	payload := providerPayload(row, left)
	return json.Marshal(payload)
}

// providerUpdateArgs —— 部分更新:字段用指针,没给 = 不动。GasTokens 三态:
// 没给 = 不动;null = 取消计量;数字 = 加到这个量。
type providerUpdateArgs struct {
	Label     *string `json:"label"`
	Provider  *string `json:"provider"`
	Endpoint  *string `json:"endpoint"`
	Model     *string `json:"model"`
	GasTokens *int64  `json:"gas_tokens"`
	ID        string  `json:"id"`
}

func updateProvider(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseProviderUpdate(raw)
		if perr != nil {
			return nil, perr
		}
		row, uerr := usecase.UpdateProvider(ctx, d.Providers, &repo.UpdateProviderInput{
			OwnerID: ownerID, ID: in.ID, Label: in.Label, Provider: in.Provider,
			Endpoint: in.Endpoint, Model: in.Model,
			SetGas: rawHasKey(raw, "gas_tokens"), GasTokens: in.GasTokens,
		})
		if uerr != nil {
			return nil, providerErr("update provider", uerr)
		}
		return marshalProvider(ctx, d, &row)
	}
}

func parseProviderUpdate(raw json.RawMessage) (providerUpdateArgs, error) {
	var in providerUpdateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs([2]string{"id", in.ID})
}

// rawHasKey —— 这个键**给没给**(而不是给的值是不是 null)。gas 那一项是三态的,
// 没给和给了 null 是两件事:前者不动,后者取消计量。
func rawHasKey(raw json.RawMessage, key string) bool {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return false
	}
	_, ok := probe[key]
	return ok
}

func setDefaultProvider(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseProviderID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.SetDefaultProvider(ctx, d.Providers, ownerID, id); err != nil {
			return nil, providerErr("set default provider", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

func deleteProvider(d ProvidersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseProviderID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeleteProvider(ctx, d.Providers, ownerID, id); err != nil {
			return nil, providerErr("delete provider", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

func parseProviderID(raw json.RawMessage) (string, error) {
	var in struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.ID, fp.RequireArgs([2]string{"id", in.ID})
}

// providerErr —— 域哨兵翻成收口认得的类别。删默认那条是**冲突**不是坏输入:
// owner 没写错什么,是这个动作跟"总得有一条可退的"冲突 —— 前端拿 409 就地提示。
func providerErr(what string, err error) error {
	switch {
	case errors.Is(err, entity.ErrProviderIsDefault):
		return fp.Coded(fp.Conflict(
			"this is the default provider — make another one the default first"),
			"provider_is_default")
	case errors.Is(err, entity.ErrProviderNotFound):
		return fp.NotFound("no such provider")
	default:
		return fp.OpErr(what, err)
	}
}
