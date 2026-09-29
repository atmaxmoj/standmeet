// recorder.go — the outbox writer.

package events

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Recorder — writes domain events into the outbox. With(tx) joins the caller's transaction.
type Recorder interface {
	With(tx pgstore.Tx) Recorder
	Record(ctx context.Context, ownerID, typ, subject string, data pgstore.JSONB) error
}

type recorder struct {
	b *Bus
	q pgstore.DBTX
}

// Recorder — the outbox writer. Without With, each Record is its own transaction.
func (b *Bus) Recorder() Recorder { return &recorder{b: b, q: b.pool} }

func (r *recorder) With(tx pgstore.Tx) Recorder { return &recorder{b: r.b, q: tx} }

func (r *recorder) Record(
	ctx context.Context,
	ownerID, typ, subject string,
	data pgstore.JSONB,
) error {
	if _, ok := r.b.types[typ]; !ok {
		return fmt.Errorf("%w: %s", ErrUndeclaredType, typ)
	}
	raw, err := encodeData(data)
	if err != nil {
		return err
	}
	if _, err = r.q.Exec(ctx,
		`INSERT INTO events (owner_id, type, subject, data) VALUES ($1, $2, $3, $4);`,
		nullable(ownerID), typ, subject, raw); err != nil {
		return fmt.Errorf("record %s: %w", typ, err)
	}
	if _, err = r.q.Exec(ctx, `SELECT pg_notify($1, '')`, Channel); err != nil {
		return fmt.Errorf("notify relay: %w", err)
	}
	return nil
}

// encodeData — data as JSON; nil is the empty object.
func encodeData(data pgstore.JSONB) ([]byte, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshal event data: %w", err)
	}
	if data == nil {
		raw = []byte("{}")
	}
	return raw, nil
}

// nullable — nil for "", so the column stores NULL.
func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
