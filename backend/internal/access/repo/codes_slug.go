package repo

import "github.com/atmaxmoj/standmeet/internal/infra/snowflake"

// defaultSlugNode — this process's snowflake node id for default code slugs. 0 for a single
// instance; a multi-node cloud deploy gives each node its own id (snowflakes never collide).
const defaultSlugNode = 0

// slugGen — the process snowflake node that supplies a default landing slug for a code whose owner
// didn't choose one. Used at the single code-creation convergence point (createCodeOn).
var slugGen = mustSlugGen()

// mustSlugGen — defaultSlugNode is a valid constant, so New never errors here; a failure would be a
// build-time programming error.
func mustSlugGen() *snowflake.Node {
	n, err := snowflake.New(defaultSlugNode)
	if err != nil {
		panic(err)
	}
	return n
}
