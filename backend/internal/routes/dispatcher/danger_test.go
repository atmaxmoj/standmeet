package dispatcher_test

// danger_test.go —— an action op that does not say how much it can hurt does not boot (R8).

import (
	"testing"

	"github.com/stretchr/testify/require"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

func TestAnActionWithoutADangerClassIsRed(t *testing.T) {
	t.Parallel()
	d := dispatcher.New(dispatcher.Resource{Name: "things", Ops: []dispatcher.Op{
		{ID: "things.list", Kind: fp.Read, Reach: fp.OwnerRead(), Invoke: noop},
		{ID: "things.wipe", Kind: fp.Action, Reach: fp.OwnerAction(), Invoke: noop},
		{
			ID: "things.nuke", Kind: fp.Action, Danger: "nuclear",
			Reach: fp.OwnerAction(), Invoke: noop,
		},
	}})
	d.Attach(face("mcp")).Ops()

	vs := d.Conform()
	require.Len(t, vs, 2, "the read needs no class; both actions are red")
	require.ElementsMatch(t, []string{"things.wipe", "things.nuke"},
		[]string{vs[0].OpID, vs[1].OpID})
	require.Equal(t, "unclassified", vs[0].Kind)
}

func TestAReadIsReadAndADeclaredActionIsItsClass(t *testing.T) {
	t.Parallel()
	read := fp.Op{ID: "x.list", Kind: fp.Read}
	act := fp.Op{ID: "x.delete", Kind: fp.Action, Danger: fp.DangerDestructive}
	require.Equal(t, fp.DangerRead, read.DangerOf())
	require.Equal(t, fp.DangerDestructive, act.DangerOf())
}
