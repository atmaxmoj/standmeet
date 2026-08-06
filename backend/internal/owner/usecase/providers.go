// providers.go —— owner 的 provider 本子:增删改、标默认。
//
// "owner 的 AI provider"那一条(ai_provider.set / setup 向导 / claim)说的是**默认那一条**,
// 它在 ai_provider.go 没变。这个文件管的是本子本身:多出来的那些条目、谁是默认、删哪条。
//
// 两条规矩:
//   · 删掉一条被引用的 → code/role 上的引用置空(schema 的 ON DELETE SET NULL),读时退默认。
//     所以删之前**不需要**先解绑,owner 也不需要知道谁引用了它。
//   · **默认那条删不掉** —— 删了就没有可退的了。owner 要么先把默认挪到别条,要么留着。

package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// ProvidersDeps —— 这一组要的依赖。Validator 跟 AIProviderDeps 同一个窄口
// (owner 不反依赖 inference,组装根适配)。
type ProvidersDeps struct {
	Owners    *repo.Repo
	Providers ProviderValidator
	// Spend —— 用量求和(stats 域实现,组装根接上)。nil = 这个实例不记用量,
	// 于是每箱油都读作"没挂表" —— 而不是读作"满的"。
	Spend SpendReader
}

// CreateProviderInput —— 新建一条。Key 是**明文**,repo 那层封上;出站永远只有 KeyConfigured。
type CreateProviderInput struct {
	OwnerID   string
	Label     string
	Provider  string
	Endpoint  string
	Model     string
	Key       string
	IsDefault bool
}

// ProviderWithGas —— 本子里的一条 + 这箱油还剩多少(nil = 没挂表)。
// 剩余不在行上,所以它跟着行一起出去,而不是让每个调用方各自再算一遍。
type ProviderWithGas struct {
	Remaining *int64
	Row       repo.ProviderRow
}

// ListProviders —— owner 的本子(默认那条在最前),每条带上油表读数。
func ListProviders(
	ctx context.Context, d ProvidersDeps, ownerID string,
) ([]ProviderWithGas, error) {
	rows, err := d.Owners.ListProviders(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list providers: %w", err)
	}
	out := make([]ProviderWithGas, 0, len(rows))
	for i := range rows {
		left, rerr := ProviderRemaining(ctx, d.Spend, &rows[i])
		if rerr != nil {
			return nil, rerr
		}
		out = append(out, ProviderWithGas{Row: rows[i], Remaining: left})
	}
	return out, nil
}

// GasRemaining —— 某一条 provider 还剩多少(nil = 没挂表)。挡住访客的那道闸走这条。
func GasRemaining(
	ctx context.Context, d ProvidersDeps, ownerID, providerID string,
) (*int64, error) {
	row, err := d.Owners.GetProvider(ctx, ownerID, providerID)
	if err != nil {
		return nil, fmt.Errorf("load provider for gas: %w", err)
	}
	return ProviderRemaining(ctx, d.Spend, &row)
}

// CreateProvider —— 建一条。provider 名要在 preset 表里(跟改默认那条同一把尺子);
// label 是 owner 自己起的名,同一 owner 内唯一(DB 那条 UNIQUE 兜底)。
//
// IsDefault=true 时**先清再设**:那条 partial unique index 让"两个默认"根本存在不了,
// 所以顺序错了会撞索引 —— 这正是它该干的事。
func CreateProvider(
	ctx context.Context, d ProvidersDeps, in *CreateProviderInput,
) (repo.ProviderRow, error) {
	if verr := validateProviderInput(d, in); verr != nil {
		return repo.ProviderRow{}, verr
	}
	// 本子里第一条一定是默认:否则这个 owner 有 provider 却没有可退的那一条。
	makeDefault, ferr := shouldBeDefault(ctx, d, in)
	if ferr != nil {
		return repo.ProviderRow{}, ferr
	}
	row, cerr := d.Owners.CreateProviderPlain(ctx, &repo.CreateProviderPlainInput{
		OwnerID: in.OwnerID, Label: in.Label, Provider: in.Provider,
		Endpoint: in.Endpoint, Model: in.Model, KeyPlaintext: in.Key,
		IsDefault: false, // 先建成非默认,再走 SetDefault 那条"先清后设"
	})
	if cerr != nil {
		return repo.ProviderRow{}, fmt.Errorf("create provider: %w", cerr)
	}
	if !makeDefault {
		return row, nil
	}
	return markDefault(ctx, d, &row)
}

// shouldBeDefault —— owner 要它当默认,或者这是本子里的第一条。
func shouldBeDefault(
	ctx context.Context, d ProvidersDeps, in *CreateProviderInput,
) (bool, error) {
	if in.IsDefault {
		return true, nil
	}
	return firstProviderForOwner(ctx, d, in.OwnerID)
}

// markDefault —— 把刚建的这条设成默认(走"先清后设"那一步),回带上标记的行。
func markDefault(
	ctx context.Context, d ProvidersDeps, row *repo.ProviderRow,
) (repo.ProviderRow, error) {
	if serr := d.Owners.SetDefaultProvider(ctx, row.OwnerID, row.ID); serr != nil {
		return repo.ProviderRow{}, fmt.Errorf("mark new provider default: %w", serr)
	}
	out := *row
	out.IsDefault = true
	return out, nil
}

func firstProviderForOwner(
	ctx context.Context, d ProvidersDeps, ownerID string,
) (bool, error) {
	rows, err := d.Owners.ListProviders(ctx, ownerID)
	if err != nil {
		return false, fmt.Errorf("list providers: %w", err)
	}
	return len(rows) == 0, nil
}

func validateProviderInput(d ProvidersDeps, in *CreateProviderInput) error {
	if strings.TrimSpace(in.Label) == "" {
		return apierr.ErrEmptyField
	}
	if d.Providers != nil && !d.Providers.Known(in.Provider) {
		// 跟改默认那条同一种报法(apierr.ErrEmptyField 是这个域"入参不对"的统一码),
		// 免得同一件错事在两条路上翻成两种回应。
		return fmt.Errorf("%w: unknown provider %q", apierr.ErrEmptyField, in.Provider)
	}
	return nil
}

// SetDefaultProvider —— 把默认挪到这一条。
func SetDefaultProvider(ctx context.Context, d ProvidersDeps, ownerID, id string) error {
	if err := d.Owners.SetDefaultProvider(ctx, ownerID, id); err != nil {
		return fmt.Errorf("set default provider: %w", err)
	}
	return nil
}

// UpdateProvider —— 部分更新(含加油:SetGas)。
func UpdateProvider(
	ctx context.Context, d ProvidersDeps, in *repo.UpdateProviderInput,
) (repo.ProviderRow, error) {
	row, err := d.Owners.UpdateProvider(ctx, in)
	if err != nil {
		return repo.ProviderRow{}, fmt.Errorf("update provider: %w", err)
	}
	return row, nil
}

// DeleteProvider —— 删一条。默认那条拦住(ErrProviderIsDefault),让面回 409 + 一句人话;
// 其余照删,引用它的 code/role 自然退默认。
func DeleteProvider(ctx context.Context, d ProvidersDeps, ownerID, id string) error {
	row, gerr := d.Owners.GetProvider(ctx, ownerID, id)
	if gerr != nil {
		return fmt.Errorf("load provider before delete: %w", gerr)
	}
	if row.IsDefault {
		return entity.ErrProviderIsDefault
	}
	if err := d.Owners.DeleteProvider(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete provider: %w", err)
	}
	return nil
}
