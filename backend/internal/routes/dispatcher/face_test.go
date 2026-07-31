package dispatcher_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

func noop(context.Context, string, json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func ownerOps() dispatcher.Resource {
	return dispatcher.Resource{Name: "things", Ops: []dispatcher.Op{
		{ID: "things.list", Kind: fp.Read, Reach: fp.OwnerRead(), Invoke: noop},
		{ID: "things.create", Kind: fp.Action, Reach: fp.OwnerAction(), Invoke: noop},
	}}
}

func face(name string) fp.Facade {
	return fp.Facade{Name: name, Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true}
}

// TestGeneratedFaceIsCompleteByConstruction —— 生成型的面(MCP 就是这么接的)一次取走全部 op,
// 取用即登记,所以它不可能欠账。这是"没有手写步骤可忘"的那半边。
func TestGeneratedFaceIsCompleteByConstruction(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	d.Attach(face("mcp")).Ops()

	require.Empty(t, d.Conform())
}

// TestVerifiedFaceMissingAnOpIsCaught —— 核对型的面(admin HTTP)逐条取能力。少 wire 一条,
// 它就没在收口登记过 → Conform 报 missing。
//
// 这正是那张手写台账原本要抓的东西 —— 现在由结构抓,不需要有人去表里加一行。
func TestVerifiedFaceMissingAnOpIsCaught(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	d.Attach(face("mcp")).Ops()
	admin := d.Attach(face("admin"))
	admin.MustOp("things.list") // 只 wire 了 list,漏了 create

	vs := d.Conform()
	require.Len(t, vs, 1)
	require.Equal(t, "admin", vs[0].Facade)
	require.Equal(t, "things.create", vs[0].OpID)
	require.Equal(t, "missing", vs[0].Kind)
}

// TestNewFaceInheritsTheWholeDebt —— 新加一个面时,它欠的每一个 op 立刻被列出来。
// 不需要谁记得去更新什么:Reach 是意图,面一注册就自动结算。
func TestNewFaceInheritsTheWholeDebt(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	d.Attach(face("mcp")).Ops()
	d.Attach(face("im")) // 刚接上,一条都还没 wire

	vs := d.Conform()
	require.Len(t, vs, 2)
	for _, v := range vs {
		require.Equal(t, "im", v.Facade)
		require.Equal(t, "missing", v.Kind)
	}
}

// TestFaceAttachIsIdempotent —— 一个面的路由分散在几个文件里 wire 很正常;同名 Attach 必须拿到
// 同一个 Face,否则登记会被拆成两半,凭空报出 missing。
func TestFaceAttachIsIdempotent(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	d.Attach(face("mcp")).Ops()
	d.Attach(face("admin")).MustOp("things.list")
	d.Attach(face("admin")).MustOp("things.create")

	require.Empty(t, d.Conform())
}

// TestUnknownOpPanicsAtWireTime —— id 拼错要在挂路由时炸,而不是运行时静悄悄少一条路由。
func TestUnknownOpPanicsAtWireTime(t *testing.T) {
	t.Parallel()

	d := dispatcher.New(ownerOps())
	admin := d.Attach(face("admin"))
	require.Panics(t, func() { admin.MustOp("things.nope") })
}

// TestDuplicateOpIDPanics —— 两个 op 同名意味着有一个永远取不到。这种事只能在启动时炸。
func TestDuplicateOpIDPanics(t *testing.T) {
	t.Parallel()

	require.Panics(t, func() { dispatcher.New(ownerOps(), ownerOps()) })
}

// TestDecoratorWrapsEveryFaceAlike —— 装饰器挂在收口上,所以每个面拿到的能力都已经过完同一条链。
// 想绕过就得绕过收口 —— 而那条路被结构闸门挡死。
func TestDecoratorWrapsEveryFaceAlike(t *testing.T) {
	t.Parallel()

	seen := []string{}
	d := dispatcher.New(ownerOps()).With(
		func(op *dispatcher.Op, next dispatcher.Invoke) dispatcher.Invoke {
			id := op.ID
			return func(
				ctx context.Context, ownerID string, in json.RawMessage,
			) (json.RawMessage, error) {
				seen = append(seen, id)
				return next(ctx, ownerID, in)
			}
		})

	mcpOps := d.Attach(face("mcp")).Ops()
	_, err := mcpOps[0].Invoke(context.Background(), "o1", nil)
	require.NoError(t, err)

	adminOp := d.Attach(face("admin")).MustOp("things.list")
	_, err = adminOp.Invoke(context.Background(), "o1", nil)
	require.NoError(t, err)

	require.Equal(t, []string{"things.list", "things.list"}, seen)
}
