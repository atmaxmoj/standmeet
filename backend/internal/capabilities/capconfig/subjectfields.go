// subjectfields.go —— 各能力在**某一个主体**(一张邀请码 / 一个 role)上占的字段,合成一个通用面。
//
// owner 眼里那就是"这张码"或"这个 role"上的几个设置:建的时候一起填,列表里一起看。access 域
// 不认识任何一个能力,所以它只留了一个口子(能力占哪些字段、怎么读、怎么写);这里把每个能力
// manifest 里的声明拼成那个口子的唯一实现。
//
// 这个文件原来叫 codefields.go,只会"码"这一种主体。role 也要同一件事的时候,唯一的区别是
// **挂载点**:CodeScope 换成 RoleScope。所以主体成了一个字段(scope 构造函数),不是两份代码 ——
// 再抄一份就是当初 booker 那三个手抄文件的老路。
//
// 更早之前这个实现是**per-capability 手写**的:booker 一个适配器 + 一个自己的存储 + 一个自己的
// schema 片段。第二个能力想在码上放东西,就得再抄一份。现在能力只写声明,一行都不用抄。

package capconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// SubjectCap —— 一个能力在某类主体上的声明 + 它自己的存储。
type SubjectCap struct {
	Store *Store
	CapID string
	Decl  []mcpplugin.ConfigField
}

// SubjectFields —— 合起来的那一面。实现 access 那个口子的三个方法(结构化满足,不 import access)。
//
// log 用来把写失败说出来。这一层没有错误通道(发码 / 建 role 本身不该因为一个能力的存储挂了
// 而失败),所以失败必须留下痕迹 —— 悄悄咽掉的话,owner 只会看到设置没生效,查不出为什么。
type SubjectFields struct {
	log   *slog.Logger
	byKey map[string]SubjectCap
	// scopeOf —— 主体 id → 挂载点。这就是"码"和"role"之间的**全部**差别。
	scopeOf func(id string) Scope
	// subject —— 日志里那个词("code" / "role"),只为让失败读得懂。
	subject string
	caps    []SubjectCap
}

// NewCodeFields —— 各能力在**一张邀请码**上占的字段。
func NewCodeFields(log *slog.Logger, caps []SubjectCap) (*SubjectFields, error) {
	return newSubjectFields(log, "code", CodeScope, caps)
}

// NewRoleFields —— 各能力在**一个 role**上占的字段。
func NewRoleFields(log *slog.Logger, caps []SubjectCap) (*SubjectFields, error) {
	return newSubjectFields(log, "role", RoleScope, caps)
}

// NewKeyFields —— 各能力在**一把对外 API key**上占的字段。
//
// 第三个主体。它跟前两个的区别仍然只有挂载点 —— 而它非存在不可的理由是 F-B-11:配额只认码时,
// 一把 key 订会一次都不数。**上限要能设**,否则「配额绑在 key 上」只是嘴上说说。
func NewKeyFields(log *slog.Logger, caps []SubjectCap) (*SubjectFields, error) {
	return newSubjectFields(log, "api_key", KeyScope, caps)
}

// newSubjectFields —— 把各能力的声明合起来。
//
// 两个能力占同一个字段名 → error(组装根据此在启动时炸)。两份声明抢一个键,写下去的值归谁、
// 读回来的是谁的,没有对的答案 —— 那不该等到 owner 发现设置没生效才暴露。
func newSubjectFields(
	log *slog.Logger, subject string, scopeOf func(string) Scope, caps []SubjectCap,
) (*SubjectFields, error) {
	byKey := map[string]SubjectCap{}
	for _, c := range caps {
		for i := range c.Decl {
			key := c.Decl[i].Key
			if prev, taken := byKey[key]; taken {
				return nil, fmt.Errorf(
					"%w: %q claimed by both %q and %q",
					ErrFieldTaken, key, prev.CapID, c.CapID)
			}
			byKey[key] = c
		}
	}
	return &SubjectFields{
		log: log, byKey: byKey, scopeOf: scopeOf, subject: subject, caps: caps,
	}, nil
}

// Fields —— 字段名 → JSON Schema 片段。入参的 schema 按它长出来。
func (f *SubjectFields) Fields() map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(f.byKey))
	for _, c := range f.caps {
		for i := range c.Decl {
			out[c.Decl[i].Key] = schemaOf(&c.Decl[i])
		}
	}
	return out
}

// Read —— 这个主体上各能力的值。某个能力读不出来就少几个键 —— 一个能力的存储出问题,
// 不该让整张码 / 整个 role 打不开。
func (f *SubjectFields) Read(ctx context.Context, id string) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, c := range f.caps {
		values, err := c.Store.ValuesScoped(ctx, f.scopeOf(id), c.Decl)
		if err != nil {
			f.log.Warn("subject field read", "subject", f.subject,
				"cap", c.CapID, "id", id, "err", err)
			continue
		}
		maps.Copy(out, values)
	}
	return out
}

// ReadByCapability —— 这个主体上**按能力分组**的值:能力 id → 它那几个键(一份 JSON 对象)。
//
// 跟 Read 只差一个形状,但那个形状是要紧的:冻进 role snapshot 的东西按能力分组,host 递给
// 沙箱时说的才是"这是你那份配置";一张所有能力混在一起的平表意味着 host 得知道哪个键归谁 ——
// 那正是这次要拆掉的东西。
//
// **名字必须跟 Read 分得开**:两者的 Go 类型一模一样(map[string]json.RawMessage),
// 只是键的含义不同(一个是字段名,一个是能力 id)。同名的话拿错了编译器一句话都不会说。
func (f *SubjectFields) ReadByCapability(
	ctx context.Context, id string,
) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, c := range f.caps {
		encoded, ok := f.capValues(ctx, &c, id)
		if !ok {
			continue
		}
		out[c.CapID] = encoded
	}
	return out
}

// Write —— 从原始入参里挑各能力自己的字段写下去。没提到的键不动。
//
// 写不进不挡住主体本身的创建:码 / role 已经建好了,设置可以再改。但失败要**说出来** ——
// 这一层没有错误通道,咽掉的话 owner 只看到设置没生效,查不出为什么。
func (f *SubjectFields) Write(ctx context.Context, id string, args json.RawMessage) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(args, &raw); err != nil {
		f.log.Warn("subject field write: decode args",
			"subject", f.subject, "id", id, "err", err)
		return
	}
	for _, c := range f.caps {
		mine := pick(&c, raw)
		if len(mine) == 0 {
			continue
		}
		if err := c.Store.SetScoped(ctx, f.scopeOf(id), c.Decl, mine); err != nil {
			f.log.Warn("subject field write", "subject", f.subject,
				"cap", c.CapID, "id", id, "err", err)
		}
	}
}

// pick —— 入参里属于这个能力的那几个键。
func pick(c *SubjectCap, raw map[string]json.RawMessage) map[string]json.RawMessage {
	mine := map[string]json.RawMessage{}
	for i := range c.Decl {
		if v, ok := raw[c.Decl[i].Key]; ok {
			mine[c.Decl[i].Key] = v
		}
	}
	return mine
}

// capValues —— 一个能力在这个主体上的值,编成一份 JSON 对象。读不出来 / 编不回去 → 跳过它,
// 不是让整份配置失败:另一个能力的存储出问题,不该让这个 role 的会话开不起来。
func (f *SubjectFields) capValues(
	ctx context.Context, c *SubjectCap, id string,
) (json.RawMessage, bool) {
	values, err := c.Store.ValuesScoped(ctx, f.scopeOf(id), c.Decl)
	if err != nil {
		f.log.Warn("subject config read", "subject", f.subject,
			"cap", c.CapID, "id", id, "err", err)
		return nil, false
	}
	encoded, merr := json.Marshal(values)
	if merr != nil {
		f.log.Warn("subject config encode", "cap", c.CapID, "id", id, "err", merr)
		return nil, false
	}
	return encoded, true
}
