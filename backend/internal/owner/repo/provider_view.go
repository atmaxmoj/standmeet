// provider_view.go —— "owner 的 AI provider"这句话的落点,以及 resolver 那一侧要的 view。
//
// 跟 providers.go 的分工:那边是**本子的存取**(增删改查、谁是默认),这边是**那句话指向谁**
// —— setup 向导 / claim / admin 那张老表单说的"owner 的 provider",指的是默认那一条;
// 一场会话说的"用哪条",是发会话时定好冻进去的那个 id。
//
// 封 key 在这里(sealProviderKey),开封在组装那一侧(cmd/server/unseal.go)。只封不解(§1.5)。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// UpdateAIProviderInput —— admin "AI provider" 表单的 commit 入参。说的是**默认那一条**。
// KeyPlaintext == nil 表示不动 key（只改 provider / endpoint / model）；
// 空 string 显式清掉 key。Endpoint 仅 provider='custom' 必填；Model 留空
// 时 inference resolver 走 preset 默认。
type UpdateAIProviderInput struct {
	KeyPlaintext *string
	OwnerID      string
	Provider     string
	Endpoint     string
	Model        string
}

// AIProviderView —— inference resolver 需要的最小信息。KeyEnc 是密文,**本域不开封**:
// owner 域只封(写路径 cryptobox.Encrypt)不解,开封在组装那一侧
// (cmd/server 的 openAIProviderKey)。Endpoint + Model 仅 custom 或 owner 显式覆盖
// preset 默认时非空。
type AIProviderView struct {
	// GasTokens —— 这箱油还剩多少 token。nil = 不计量(#7 的默认路径)。
	GasTokens  *int64
	Provider   string
	Endpoint   string
	Model      string
	ProviderID string // 记用量时要写回哪一箱
	KeyEnc     []byte
}

func providerViewOf(p *ProviderRow) AIProviderView {
	return AIProviderView{
		Provider: p.Provider, Endpoint: p.Endpoint, Model: p.Model, KeyEnc: p.KeyEnc,
		ProviderID: p.ID, GasTokens: p.GasTokens,
	}
}

// GetAIProviderView —— **默认那条** provider 的最小信息。
// resolver 不该 import postgres，所以这个方法返一个独立的 view 类型；
// cmd/server 用 adapter 把它包成 inference.OwnerKeyView。
//
// 按 code / role 覆盖解析的那条路在 ResolveProviderView —— 这个方法是它的地板。
func (r *Repo) GetAIProviderView(
	ctx context.Context, ownerID string,
) (AIProviderView, error) {
	def, err := r.DefaultProvider(ctx, ownerID)
	if err != nil {
		if errors.Is(err, entity.ErrProviderNotFound) {
			// 没有默认 = 还没配。resolver 那边把"没 key"翻成 ErrOwnerProviderUnconfigured,
			// 跟以前四列全空是同一种状态。
			return AIProviderView{}, nil
		}
		return AIProviderView{}, err
	}
	return providerViewOf(&def), nil
}

// ProviderViewByID —— 指名要哪一条;空 id 或那条已经不在了 → 退默认。
//
// **谁压过谁不在这一层。** `code > role` 那一步在发会话时就评估完、冻进 session 了
// (跟 RoleSnapshot 同一个模型),所以这里收到的已经是"这一场会话该用哪条"。
// 指着的那条被删了 → 退默认,不是报错:owner 删掉一条地址,订单还是要发出去的。
func (r *Repo) ProviderViewByID(
	ctx context.Context, ownerID, providerID string,
) (AIProviderView, error) {
	if providerID == "" {
		return r.GetAIProviderView(ctx, ownerID)
	}
	row, err := r.GetProvider(ctx, ownerID, providerID)
	if err == nil {
		return providerViewOf(&row), nil
	}
	if !errors.Is(err, entity.ErrProviderNotFound) {
		return AIProviderView{}, err
	}
	return r.GetAIProviderView(ctx, ownerID)
}

// UpdateAIProvider —— commit owner 的**默认** provider。KeyPlaintext 非 nil 时同步换 key；
// 为 nil 时保留原 key（仅切 provider）。返回新 OwnerSettings（聚合的独立切面）。
//
// provider 变成一本之后这个入口没有消失:setup 向导、claim、admin 那张表单说的都是
// "owner 的 AI provider",而那句话现在指的是默认那一条。没有默认就建一条并标默认。
func (r *Repo) UpdateAIProvider(
	ctx context.Context, in *UpdateAIProviderInput,
) (entity.Settings, error) {
	def, derr := r.DefaultProvider(ctx, in.OwnerID)
	if errors.Is(derr, entity.ErrProviderNotFound) {
		return r.createDefaultProvider(ctx, in)
	}
	if derr != nil {
		return entity.Settings{}, derr
	}
	return r.updateDefaultProvider(ctx, &def, in)
}

// createDefaultProvider —— 这个 owner 还没有任何 provider:建一条,标默认。
func (r *Repo) createDefaultProvider(
	ctx context.Context, in *UpdateAIProviderInput,
) (entity.Settings, error) {
	enc, eerr := sealProviderKey(in.OwnerID, in.KeyPlaintext)
	if eerr != nil {
		return entity.Settings{}, eerr
	}
	if _, cerr := r.CreateProvider(ctx, &CreateProviderInput{
		OwnerID: in.OwnerID, Label: defaultProviderLabel, Provider: in.Provider,
		Endpoint: in.Endpoint, Model: in.Model, KeyEnc: enc, IsDefault: true,
	}); cerr != nil {
		return entity.Settings{}, cerr
	}
	return r.GetSettings(ctx, in.OwnerID)
}

// updateDefaultProvider —— 改默认那条。KeyPlaintext 为 nil = 不动 key。
func (r *Repo) updateDefaultProvider(
	ctx context.Context, def *ProviderRow, in *UpdateAIProviderInput,
) (entity.Settings, error) {
	if _, uerr := r.UpdateProvider(ctx, &UpdateProviderInput{
		OwnerID: in.OwnerID, ID: def.ID,
		Provider: &in.Provider, Endpoint: &in.Endpoint, Model: &in.Model,
	}); uerr != nil {
		return entity.Settings{}, uerr
	}
	if in.KeyPlaintext == nil {
		return r.GetSettings(ctx, in.OwnerID)
	}
	enc, eerr := sealProviderKey(in.OwnerID, in.KeyPlaintext)
	if eerr != nil {
		return entity.Settings{}, eerr
	}
	if serr := r.SetProviderKey(ctx, in.OwnerID, def.ID, enc); serr != nil {
		return entity.Settings{}, serr
	}
	return r.GetSettings(ctx, in.OwnerID)
}

// defaultProviderLabel —— setup 向导/claim 建的那条默认项的名字。owner 之后可以改。
const defaultProviderLabel = "default"

// sealProviderKey —— nil / 空 = 空密文(没配 key);非空 → 封上。
//
// **AAD = owner_id**,跟开封那侧(cmd/server/unseal.go 的 openAIProviderKey)一致:
// 密文绑到这个 owner,被搬到别的 owner 行时开封 tamper-fail。这一对必须一起改 ——
// 封的时候不给 AAD、解的时候给,是解不开的,而症状会是"key 突然失效"。
// **只封不解**:这一侧永远不开封(§1.5)。
func sealProviderKey(ownerID string, key *string) ([]byte, error) {
	if key == nil || *key == "" {
		return []byte{}, nil
	}
	enc, err := cryptobox.Encrypt([]byte(*key), []byte(ownerID))
	if err != nil {
		return nil, fmt.Errorf("encrypt provider key: %w", err)
	}
	return enc, nil
}
