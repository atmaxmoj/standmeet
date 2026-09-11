// monitor.go — /api/admin/monitor/* — the owner's view of their own visitor traffic
// (docs/design/monitor.md §5).
//
// Wired from the outbound convergence point, like ip_bans.go: the handler holds no repository,
// it takes an Op from the dispatcher's admin Face. The business logic exists in one copy, and
// owner MCP gets the same declarations without a second implementation to keep in step.
//
// This is the READ half of the monitor domain. The recording half is not here and is not
// anywhere in routes/: it is a middleware mounted once on the public router, which observes
// rather than being called (monitor.md §0). Nothing in this package records anything.

package admin

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// MonitorAdminDeps — capability source for the traffic reads: the convergence point's admin
// Face. No repository here, on purpose.
type MonitorAdminDeps struct {
	Face *dispatcher.Face
}

// MountMonitor mounts the /monitor/* subrouter.
func (h *Handlers) MountMonitor(r chi.Router) {
	face := h.MonitorAdmin.Face
	r.Route("/monitor", func(r chi.Router) {
		// The filters are query parameters because this is a read a person shares by copying
		// the address bar: a filtered view has to survive being pasted into a message.
		r.Get("/events", h.dispatchOp(face, "monitor.events", monitorEventsArgs, jsonOK))
		r.Get("/stats", h.dispatchOp(face, "monitor.stats", monitorWindowArgs, jsonOK))
		// The per-viewer breakdown behind the summary numbers: who came, and what each did.
		r.Get("/sessions", h.dispatchOp(face, "monitor.sessions", monitorWindowArgs, jsonOK))
	})
	// The collection master switch (monitor.md §8): the owner turns their own monitoring off.
	// It is an owner setting (monitoring.set → the owners row), not a monitor-domain op, but its
	// natural home is the monitor panel, so it mounts alongside the reads on the same admin Face.
	// The response is the whole settings envelope, so the frontend swaps it into its /me cache.
	r.Put("/monitoring", h.dispatchOp(face, "monitoring.set", bodyArgs, jsonOK))
}

// monitorEventsArgs — the REST query string as the op's arguments.
//
// This route builds its own rather than using queryArgsRenamed, because that helper quotes
// every value as a JSON string (dispatch.go: strconv.Quote). `include_bots` is a real boolean
// on the op's side, and `"true"` does not unmarshal into a bool — the filter would silently
// never apply, and the panel would show a bot-free list while claiming to include them.
func monitorEventsArgs(r *http.Request) (json.RawMessage, error) {
	q := r.URL.Query()
	fields := map[string]json.RawMessage{
		"surface":   quotedQuery(q, "surface"),
		"event":     quotedQuery(q, "event"),
		"entity_id": quotedQuery(q, "entity_id"),
		"window":    quotedQuery(q, "window"),
	}
	addNumericQuery(fields, q, []string{"limit"})
	addBoolQuery(fields, q, "include_bots")
	out, err := json.Marshal(fields)
	if err != nil {
		return nil, dispatcher.BadInput("invalid query parameters")
	}
	return out, nil
}

// monitorWindowArgs — the summary takes only the window, and takes it the same way the feed
// does. Both panels must be counted over the same span, and two decoders is how they stop being.
func monitorWindowArgs(r *http.Request) (json.RawMessage, error) {
	out, err := json.Marshal(map[string]json.RawMessage{
		"window": quotedQuery(r.URL.Query(), "window"),
	})
	if err != nil {
		return nil, dispatcher.BadInput("invalid query parameters")
	}
	return out, nil
}

func quotedQuery(q url.Values, name string) json.RawMessage {
	return json.RawMessage(strconv.Quote(q.Get(name)))
}

// addBoolQuery — only "true" turns a flag on. An absent or unparseable value leaves the field
// out entirely, so the op applies its own default rather than being told "false" by a typo.
func addBoolQuery(fields map[string]json.RawMessage, q url.Values, name string) {
	if q.Get(name) == "true" {
		fields[name] = json.RawMessage("true")
	}
}
