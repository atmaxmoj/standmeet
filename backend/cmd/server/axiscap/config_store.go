// config_store.go —— 任意能力的可设置项怎么读写(声明在 config.go)。
//
// 这儿把两样东西对上:能力的**声明**(manifest 的 Config)和它**自己的隔离存储**。
// 除此之外它什么都不知道 —— 没有一个字段名是写死的,加一个可配置项只需要在 manifest 里加一行。

package axiscap

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capconfig"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// configField —— 一个配置项的声明 + 当前值。Value / Default 是 JSON 字面量;
// Overridden=false 时两者相同。
type configField struct {
	Key         string
	Label       string
	Type        string
	Description string
	Value       string
	Default     string
	Overridden  bool
}

type capConfigOps struct {
	store *capstore.Store
	decls map[string][]mcpplugin.ConfigField
}

// newCapConfigOps —— 从内建能力的 manifest 里收集所有 Config 声明。
// 没声明 Config 的能力不进这张表 —— 面板上也就不会出现一个空的设置页。
func newCapConfigOps(d *deps.Runtime) capConfigOps {
	decls := map[string][]mcpplugin.ConfigField{}
	manifests := BuiltinManifests()
	for i := range manifests {
		if len(manifests[i].Config) > 0 {
			decls[manifests[i].ID] = manifests[i].Config
		}
	}
	return capConfigOps{store: capstore.New(d.DB), decls: decls}
}

func (a capConfigOps) Configurable(_ context.Context) []string {
	out := make([]string, 0, len(a.decls))
	for id := range a.decls {
		out = append(out, id)
	}
	slices.Sort(out) // 稳定顺序:面板和 golden 都不该看运行时 map 的脸色
	return out
}

func (a capConfigOps) Get(ctx context.Context, ownerID, capID string) ([]configField, error) {
	b, err := a.bind(capID)
	if err != nil {
		return nil, err
	}
	fields, gerr := b.store.Get(ctx, ownerID, b.decl)
	if gerr != nil {
		return nil, fmt.Errorf("capability config get: %w", gerr)
	}
	out := make([]configField, 0, len(fields))
	for i := range fields {
		out = append(out, configField{
			Key: fields[i].Key, Label: fields[i].Label, Type: fields[i].Type,
			Description: fields[i].Description, Value: fields[i].Value,
			Default: fields[i].Default, Overridden: fields[i].Overridden,
		})
	}
	return out, nil
}

func (a capConfigOps) Set(
	ctx context.Context, ownerID, capID string, values map[string]json.RawMessage,
) error {
	b, err := a.bind(capID)
	if err != nil {
		return err
	}
	if serr := b.store.Set(ctx, ownerID, b.decl, values); serr != nil {
		if isCapConfigCallerErr(serr) {
			return fp.BadInput(serr.Error())
		}
		return fmt.Errorf("capability config set: %w", serr)
	}
	return nil
}

// isCapConfigCallerErr —— 这两类都是"面板发来的东西不对",不是这台机器的问题。
func isCapConfigCallerErr(err error) bool {
	return errors.Is(err, capconfig.ErrUnknownField) || errors.Is(err, capconfig.ErrInvalidValue)
}

// boundConfig —— 一个能力的声明 + 绑死到它自己命名空间的存储。
type boundConfig struct {
	store *capconfig.Store
	decl  []mcpplugin.ConfigField
}

// bind —— 把 capID 解成它的声明 + 存储。
// 没声明过配置的 id 直接当"找不到" —— 不是"配置为空"。
func (a capConfigOps) bind(capID string) (boundConfig, error) {
	decl, ok := a.decls[capID]
	if !ok {
		return boundConfig{}, fp.NotFound("no such configurable capability: " + capID)
	}
	return boundConfig{decl: decl, store: capconfig.New(a.store, capstore.KindMCP, capID)}, nil
}
