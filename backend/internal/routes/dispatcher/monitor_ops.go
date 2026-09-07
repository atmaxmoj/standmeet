// monitor_ops.go -- the visitor-traffic reads, assembled here rather than declared by the
// monitor domain.
//
// Every other domain declares its own ops and takes a dependency on the parity vocabulary to do
// it. Monitor does not, on purpose: it is the domain that watches the others, and the less it
// is entangled with, the less it can disturb.
//
// So the split is: the SHAPES belong to the domain (monitor.EventsInputSchema, EventsArgs,
// EventsOut -- plain encoding/json, no vocabulary needed), and this file only aggregates them
// into operations, which is the convergence point's actual job.
//
// This is the READ half. Recording is declared nowhere and converges nowhere: it is a
// middleware mounted once on the public router, which observes rather than being called
// (docs/design/monitor.md §0).

package dispatcher

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	monitor "github.com/atmaxmoj/standmeet/internal/monitor/facade"
)

// MonitorOps -- the traffic-reading group: the raw feed and the summary.
func MonitorOps(repo *monitor.Repo) []Op {
	if repo == nil {
		// An empty slice, never nil: a resource with no ops is a real state (the domain was
		// not wired), and a nil would read as "this collection is broken".
		return []Op{}
	}
	return []Op{
		{
			ID: "monitor.events",
			Description: "List recorded visitor events, newest first. " +
				"Bots are excluded unless include_bots is true.",
			InputSchema: monitor.EventsInputSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listMonitorEvents(repo),
		},
		{
			ID: "monitor.stats",
			Description: "Summarise visitor traffic: viewers, visits, views, events, bots. " +
				"Viewers, visits and views are three different counts.",
			InputSchema: monitor.EmptyInputSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      readMonitorStats(repo),
		},
	}
}

func listMonitorEvents(repo *monitor.Repo) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		query, derr := monitor.EventsQueryFrom(raw, ownerID)
		if derr != nil {
			return nil, BadInput(derr.Error())
		}
		rows, err := repo.Events(ctx, &query)
		if err != nil {
			return nil, fp.OpErr("list monitor events", err)
		}
		return json.Marshal(monitor.EventsOut{Events: rows})
	}
}

func readMonitorStats(repo *monitor.Repo) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		sum, err := repo.Stats(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("summarise monitor traffic", err)
		}
		return json.Marshal(sum)
	}
}
