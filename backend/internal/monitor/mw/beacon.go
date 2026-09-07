// beacon.go —— POST /api/t, the browser's half of the instrumentation.
//
// The middleware next door sees every request, but a request is not everything that happens: it
// cannot see how far down a page someone read, whether they reached the end, how long they
// stayed, or which link inside a page they clicked. Only the browser knows those, so the
// browser reports them here.
//
// It is a public, unauthenticated write, and it is treated like one:
//
//   - The event NAME must be one this file already knows. An open name field is an open door to
//     writing whatever a stranger likes into the owner's panel.
//   - The client describes WHAT happened. It never describes WHO it is: the user agent, the
//     address, the bot verdict and the location all come off the request, exactly as they do
//     for an observed event, so a caller cannot claim to be someone else's browser.
//   - The entity is resolved from the URL server-side. If the client could name an entity id,
//     anyone could pile reads onto one entry.
//   - The body is small and bounded. Props are capped in count and length.
//
// It answers 204 whatever happens. A visitor must never see an error from instrumentation, and
// a caller learning nothing from the response is also what stops the endpoint being used as an
// oracle for which slugs exist.

package mw

import (
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/monitor/entity"
	"github.com/atmaxmoj/standmeet/internal/monitor/ops"
)

// maxBeaconBody —— a beacon is a few hundred bytes. Anything larger is not a beacon.
const maxBeaconBody = 4 << 10

const (
	maxProps        = 8
	maxPropKeyLen   = 32
	maxPropValueLen = 120
)

// browserEvents —— the events only a browser can witness, and the surfaces each may claim.
//
// A closed set, on purpose. This is the one place in the system where an anonymous stranger can
// write a row, so what they may write is enumerated rather than validated: a name not in this
// table is dropped, and a name in it can still only arrive on a surface that makes sense for it.
var browserEvents = map[string][]entity.Surface{
	// A view of the index. The server cannot record this: the page is rendered by the app, and
	// the only backend route involved is a liveness probe that fires whether or not a person is
	// there (see routes.go). Without this line, surface `index` has no signal at all.
	"": {entity.SurfaceIndex},

	entity.EventScrollDepth: {
		entity.SurfaceIndex, entity.SurfaceReader, entity.SurfaceWritings, entity.SurfaceMicrosite,
	},
	entity.EventReadComplete: {entity.SurfaceReader, entity.SurfaceWritings},
	entity.EventReadDwell:    {entity.SurfaceReader, entity.SurfaceWritings},

	// The front-page interactions. `microsite` is here beside `index` because the owner's
	// homepage IS a microsite — the reserved `home` page, served at `/` — so these four fire
	// from the microsite build's tracker (builder/template/src/track.ts) on a claimed instance,
	// and from the app's own fallback page in the window before a home build exists. One event
	// name for one interaction; the surface says which page it happened on.
	entity.EventPinClick:       {entity.SurfaceIndex, entity.SurfaceMicrosite},
	entity.EventHeroCTAClick:   {entity.SurfaceIndex, entity.SurfaceMicrosite},
	entity.EventContactClick:   {entity.SurfaceIndex, entity.SurfaceMicrosite},
	entity.EventChatInputFocus: {entity.SurfaceIndex, entity.SurfaceMicrosite},

	entity.EventRelatedClick: {entity.SurfaceReader},
	entity.EventCitedByClick: {entity.SurfaceReader},
	entity.EventSourceClick:  {entity.SurfaceChat},
	entity.EventLangSwitch:   {entity.SurfaceReader},
	entity.EventTreeExpand:   {entity.SurfaceReader},
}

// beaconBody —— what the browser sends. Deliberately small.
type beaconBody struct {
	Props    map[string]string `json:"props"`
	Surface  string            `json:"surface"`
	Name     string            `json:"name"`
	URL      string            `json:"url"`
	Referrer string            `json:"referrer"`
	Screen   string            `json:"screen"`
	Language string            `json:"language"`
	Title    string            `json:"title"`
	Kind     string            `json:"entity_kind"`
	Slug     string            `json:"entity_slug"`
}

// Beacon —— the handler. Mount it on the public router next to Record.
func Beacon(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Always 204, and always before any work that could fail. A visitor waiting on their
		// own analytics is a visitor waiting for nothing.
		defer w.WriteHeader(http.StatusNoContent)
		if cfg == nil || cfg.Deps == nil || r.UserAgent() == "" {
			return
		}
		body, ok := decodeBeacon(r.Body)
		if !ok {
			return
		}
		cfg.recordBeacon(r, &body)
	}
}

func decodeBeacon(r io.Reader) (beaconBody, bool) {
	var body beaconBody
	if err := json.NewDecoder(io.LimitReader(r, maxBeaconBody)).Decode(&body); err != nil {
		return beaconBody{}, false
	}
	return body, allowedBrowserEvent(body.Name, body.Surface)
}

// allowedBrowserEvent —— is this name one a browser may report, and on this surface.
func allowedBrowserEvent(name, surface string) bool {
	surfaces, known := browserEvents[name]
	return known && slices.Contains(surfaces, surface)
}

// recordBeacon —— the reported facts, plus the observed ones the client does not get to choose.
func (c *Config) recordBeacon(r *http.Request, body *beaconBody) {
	in := ops.Input{
		Surface:  body.Surface,
		Name:     body.Name,
		Props:    boundProps(body.Props),
		URL:      body.URL,
		Referrer: body.Referrer,
		Screen:   body.Screen,
		Language: body.Language,
		Title:    body.Title,
	}
	c.fillBeaconEntity(r, body, &in)
	c.fillCode(r, &in)
	ops.RecordRequest(r.Context(), c.Deps, r, &in)
}

// fillBeaconEntity —— the entity comes from the slug the page is on, resolved server-side.
// The client names a slug it could have navigated to; it never names an id.
func (c *Config) fillBeaconEntity(r *http.Request, body *beaconBody, in *ops.Input) {
	if c.Resolver == nil || body.Kind == "" || body.Slug == "" {
		return
	}
	found := c.Resolver.Entity(r.Context(), body.Kind, body.Slug)
	found.Kind = body.Kind
	in.Entity = found
}

// boundProps —— a capped, truncated copy. An unbounded map from an anonymous caller is a way to
// write arbitrary bytes into the owner's database one beacon at a time.
func boundProps(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		if len(out) >= maxProps || len(k) > maxPropKeyLen {
			continue
		}
		out[k] = truncate(v, maxPropValueLen)
	}
	return out
}

func truncate(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	// Cut on a rune boundary so a truncated value stays valid UTF-8 in the jsonb column.
	return strings.ToValidUTF8(s[:limit], "")
}
