package deps

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Recorder —— the outbox writer, resolved at call time: a use case wired before the bus is built
// (BuildBackground) records through this and reaches the bus once it exists.
func (d *Runtime) Recorder() events.Recorder { return lazyRecorder{d: d} }

type lazyRecorder struct{ d *Runtime }

func (l lazyRecorder) With(tx pgstore.Tx) events.Recorder {
	return l.d.Events.Recorder().With(tx)
}

func (l lazyRecorder) Record(
	ctx context.Context, ownerID, typ, subject string,
	data pgstore.JSONB,
) error {
	return l.d.Events.Recorder().Record(ctx, ownerID, typ, subject, data)
}
