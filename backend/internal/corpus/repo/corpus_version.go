// corpus_version.go —— a value that changes whenever any of the owner's notes does, so a
// reader holding a derived copy (the screen assistant's per-role index) knows to rebuild it.

package repo

import (
	"context"
	"fmt"
	"strconv"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Version —— "<note count>:<newest updated_at in µs>" over every genre.
func (c *Corpus) Version(ctx context.Context, ownerID string) (string, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return "", fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, err := db.New(c.wiki.pool).CorpusVersion(ctx, owner)
	if err != nil {
		return "", fmt.Errorf("corpus version: %w", err)
	}
	return strconv.FormatInt(row.Notes, decimal) + ":" +
		strconv.FormatInt(row.Newest.Time.UnixMicro(), decimal), nil
}

const decimal = 10
