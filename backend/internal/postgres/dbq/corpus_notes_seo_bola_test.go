// corpus_notes_seo_bola_test.go —— RED repro (bug hunt #11). UpdateNoteSEO is the only corpus_notes
// mutation whose WHERE clause omits owner_id (`WHERE id = $1 AND genre = $4`); every sibling
// mutation filters owner_id. On a multi-tenant instance that is a BOLA: owner A can flip another
// owner's note excerpt/published by id. The single-owner v1 instance can't reach it end-to-end
// (ErrInstanceAlreadyClaimed — one owner exists), so the deterministic reproduction is at the query
// level: the tenant filter is missing. GREEN once UpdateNoteSEO filters owner_id; currently RED.

package dbq

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUpdateNoteSEOFiltersOwnerID(t *testing.T) {
	t.Parallel()
	require.Contains(t, updateNoteSEO, "owner_id = ",
		"UpdateNoteSEO must scope its UPDATE by owner_id (tenant isolation), like siblings")
}
