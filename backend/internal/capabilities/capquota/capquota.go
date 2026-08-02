// Package capquota —— 按声明执行的 per-code 用量上限。宿主这一侧没有一个业务词。
//
// 一个能力在自己的 manifest 里说清三件事(mcpplugin.QuotaDecl):上限取码上的哪个配置键、
// 用量数自己存储里的哪个 collection、那些文档里哪个字段记着码。这个包照着数,给出两个答案:
//
//	Allow     —— 这次会话还能不能用(达上限 → 隐藏工具,而不是点了再报错)
//	Remaining —— 还剩几次(填进 capability_state,前端照着显示)
//
// **两个答案共用同一条计数**。它们曾经是组装根里两段各自写的代码,而且写坏过:#135 把
// booker 外置时两个钩子一起被摘掉,后来只补回了闸,余量从此永远是 nil —— 前端契约还在,
// 供给没了。一份计数两个出口,就不会再补回一半。
package capquota

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capconfig"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// Counter —— 数这个能力自己存储里的用量(构造期绑死到它的命名空间)。
type Counter struct {
	store      *capstore.Store
	cfg        *capconfig.Store
	decl       *mcpplugin.QuotaDecl
	capID      string
	kind       capstore.Kind
	codeFields []mcpplugin.ConfigField
}

// Bind —— 一次绑定要的全部东西。打包成 struct 而不是六个位置参数:调用点数逗号数不清
// 哪个是 kind 哪个是 capID,而这两个正是"填不了别人的表"所依赖的那两个。
type Bind struct {
	Store      *capstore.Store
	Config     *capconfig.Store
	Decl       *mcpplugin.QuotaDecl
	CapID      string
	Kind       capstore.Kind
	CodeFields []mcpplugin.ConfigField
}

// New —— 把一份声明绑到某个能力的存储上。声明不完整 / 无声明 → nil(这个能力不闸用量)。
func New(b *Bind) *Counter {
	if !b.Decl.Usable() {
		return nil
	}
	return &Counter{
		store: b.Store, cfg: b.Config, decl: b.Decl, codeFields: b.CodeFields,
		kind: b.Kind, capID: b.CapID,
	}
}

// Allow —— 这张码还能不能再用一次。无 code / 无上限 → 放行。读失败 → 报错(调用方决定)。
func (c *Counter) Allow(ctx context.Context, codeID string) (bool, error) {
	left, err := c.Remaining(ctx, codeID)
	if err != nil {
		return false, err
	}
	if left == nil {
		return true, nil // nil = 不限
	}
	return *left > 0, nil
}

// Remaining —— 还剩几次。nil = 不限(或无 code)—— **不是 0**:0 会被读成"已用尽"。
func (c *Counter) Remaining(ctx context.Context, codeID string) (*int32, error) {
	limit, err := c.limitOf(ctx, codeID)
	if err != nil || limit == nil {
		return nil, err
	}
	used, cerr := c.used(ctx, codeID)
	if cerr != nil {
		return nil, cerr
	}
	// 夹到 0:超额时报负数会被前端读成一个奇怪的余额。
	left := max(*limit-int32(used), 0)
	return &left, nil
}

// limitOf —— 这张码上的上限。没设 / null / ≤ 0 → nil(不限)。
func (c *Counter) limitOf(ctx context.Context, codeID string) (*int32, error) {
	if codeID == "" {
		return nil, nil //nolint:nilnil // 无 code = 不限,不是错误
	}
	values, err := c.cfg.ValuesScoped(ctx, capconfig.CodeScope(codeID), c.codeFields)
	if err != nil {
		return nil, fmt.Errorf("capquota limit: %w", err)
	}
	raw, ok := values[c.decl.ConfigKey]
	if !ok {
		return nil, nil //nolint:nilnil // 没这个键 = 不限
	}
	return decodeLimit(raw)
}

func decodeLimit(raw json.RawMessage) (*int32, error) {
	var limit *int32
	if err := json.Unmarshal(raw, &limit); err != nil {
		return nil, fmt.Errorf("capquota limit decode: %w", err)
	}
	if limit == nil || *limit <= 0 {
		return nil, nil //nolint:nilnil // null / ≤0 = 不限
	}
	return limit, nil
}

// used —— 这张码已经用掉多少(数能力自己存储里的行)。
func (c *Counter) used(ctx context.Context, codeID string) (int64, error) {
	filter, merr := json.Marshal(map[string]string{c.decl.CodeField: codeID})
	if merr != nil {
		return 0, fmt.Errorf("capquota filter: %w", merr)
	}
	n, cerr := c.store.Count(ctx, c.kind, c.capID, c.decl.Collection, filter)
	if cerr != nil {
		return 0, fmt.Errorf("capquota count: %w", cerr)
	}
	return n, nil
}
