// record.go —— the one path every traffic event takes.
//
// Both mechanisms in docs/design/traffic.md §4 land here: the browser beacon (POST /api/t) and
// the server-side emits from chat, code redemption and the corpus reader. They share this
// function so that the viewer hash, the visit boundary, the bot check and the owner exclusion
// are applied once, in one order, and cannot drift apart between the two.
//
// Order is load-bearing:
//
//	owner exclusion → collection switch → identity → bot classification → write
//
// The exclusion runs FIRST. A gate placed after an early return is a gate someone can walk
// around by using a different entry point, and the owner reading their own page is the single
// most common way an instance's numbers get inflated.

package ops

import (
	"context"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/monitor/entity"
	"github.com/atmaxmoj/standmeet/internal/monitor/repo"
)

// recordOwnerEnv —— the one override for the owner exclusion. Named so that reading it aloud
// says what it is for: nothing but a test should ever set it.
const recordOwnerEnv = "STANDMEET_TRAFFIC_RECORD_OWNER_FOR_TESTS"

// Deps —— what recording needs. Every field is required; a nil Repo disables recording rather
// than panicking, because instrumentation must never be the thing that takes an instance down.
type Deps struct {
	Repo *repo.Repo
	Log  *slog.Logger

	// OwnerID —— which owner this instance serves. v1 is single-owner; the signature carries a
	// context so multi-tenant costs nothing later.
	OwnerID func(ctx context.Context) (string, error)

	// Enabled —— the owner's collection switch. False means record nothing at all.
	Enabled func(ctx context.Context) bool

	// IsOwnerRequest —— does this request carry a signed-in owner session. Supplied by the
	// composition root, which is the only layer that knows about admin auth. Keeping it a
	// function is what lets this module enforce "check before write" without importing the
	// session store.
	IsOwnerRequest func(r *http.Request) bool

	// Secret —— the instance secret that salts the viewer hash. Without it, anyone knowing a
	// visitor's IP and user agent could confirm from a public number that they visited.
	Secret []byte
}

// Input —— what a caller says about the event. Everything a request can answer for itself
// (address, user agent, referrer, geo headers) is read off the request, never passed in, so
// that no caller can report a client other than the one that made the call.
type Input struct {
	// Props —— free labels for this event, stored as jsonb. Strings only: this module does no
	// numeric aggregation, and our numeric telemetry already lives in stats.inference_usage.
	// ponytail: string props, no avg/sum over a custom property. Port umami's typed-column
	// event_data table (prisma/schema.prisma:169-189) if an owner ever needs one.
	Props map[string]string

	Surface entity.Surface
	Name    string

	Entity entity.Entity

	CodeID        string
	CodeLabel     string
	RoleID        string
	ChatSessionID string
	EmbedID       string
	MicrositeSlug string

	// URL / Referrer / Screen / Language —— only a browser knows these, so a beacon supplies
	// them and a server emit leaves them empty. An emit still records the request's own path.
	URL      string
	Referrer string
	Screen   string
	Language string
	Title    string
}

// RecordRequest —— record one event that arose from an HTTP request.
//
// It returns nothing. There is no error for a caller to handle: every failure is logged here,
// and no failure may change what the visitor sees. A caller that could react to an error would
// eventually be written to react to it.
func RecordRequest(ctx context.Context, d *Deps, r *http.Request, in *Input) {
	if d == nil || !d.shouldRecord(ctx, r) {
		return
	}
	ownerID, err := d.OwnerID(ctx)
	if err != nil || ownerID == "" {
		// An unclaimed instance has no owner to attribute traffic to. Not an error.
		return
	}
	now := time.Now().UTC()
	ev := buildEvent(r, in)
	d.persist(ctx, ownerID, r, &ev, now)
}

// View —— the common case: an event with no name, recording that something was displayed.
func View(ctx context.Context, d *Deps, r *http.Request, surface string, e entity.Entity) {
	RecordRequest(ctx, d, r, &Input{Surface: surface, Entity: e})
}

// shouldRecord —— the two gates, in the order §4.11 requires: the owner exclusion first, then
// the collection switch.
func (d *Deps) shouldRecord(ctx context.Context, r *http.Request) bool {
	if d.Repo == nil || d.isExcludedOwner(r) {
		return false
	}
	return d.Enabled == nil || d.Enabled(ctx)
}

// isExcludedOwner —— the owner reading their own page records nothing. This is the single most
// common way an instance's numbers get inflated, and the check runs before every write rather
// than inside any one surface, so a new entry point cannot walk around it.
func (d *Deps) isExcludedOwner(r *http.Request) bool {
	if d.IsOwnerRequest == nil || !d.IsOwnerRequest(r) {
		return false
	}
	return !recordOwnerOverride()
}

// recordOwnerOverride —— true only when a test has asked for the owner's own traffic to be
// recorded. Read per call rather than cached, so a test can set it without a restart.
func recordOwnerOverride() bool {
	v := strings.TrimSpace(os.Getenv(recordOwnerEnv))
	return v == "1" || strings.EqualFold(v, "true")
}

// buildEvent —— an Input plus a request becomes an Event. Everything derivable is derived here,
// so a caller cannot report a browser, a country or a bot flag of its own choosing.
func buildEvent(r *http.Request, in *Input) entity.Event {
	page := entity.NormalizeURL(effectiveURL(r, in.URL), hostOf(r))
	page.Title = in.Title
	entity.ApplyReferrer(&page, effectiveReferrer(r, in.Referrer))

	client := clientOf(r, in)
	return entity.Event{
		Props:         propsWithBot(in.Props, &client),
		Page:          page,
		Client:        client,
		Entity:        in.Entity,
		Surface:       in.Surface,
		Name:          in.Name,
		CodeLabel:     in.CodeLabel,
		MicrositeSlug: in.MicrositeSlug,
		CodeID:        in.CodeID,
		RoleID:        in.RoleID,
		ChatSessionID: in.ChatSessionID,
		EmbedID:       in.EmbedID,
	}
}

// propsWithBot —— carries the crawler's NAME onto the row.
//
// is_bot alone says a bot came; it does not say which, and which is the whole point. "Your link
// was pasted into Slack" and "ClaudeBot read your corpus" are two different pieces of product
// information, and both arrive as is_bot=true.
//
// The caller's map is copied rather than written into: an Input may be built once and reused,
// and a recorder that mutates its argument would leak one request's bot name onto the next.
func propsWithBot(in map[string]string, c *entity.Client) map[string]string {
	if !c.IsBot || c.BotName == "" {
		return in
	}
	out := make(map[string]string, len(in)+1)
	maps.Copy(out, in)
	out["bot"] = c.BotName
	return out
}

// clientOf —— browser, OS, device, language and location, all read off the request.
func clientOf(r *http.Request, in *Input) entity.Client {
	c := entity.DetectClient(r.UserAgent(), in.Screen)
	c.Language = firstLanguage(in.Language, r.Header.Get("Accept-Language"))
	loc := entity.DetectLocation(r.Header.Get)
	c.Country, c.Region, c.City = loc.Country, loc.Region, loc.City
	return c
}

// persist —— identity, then the write. Both failures are logged and swallowed.
func (d *Deps) persist(
	ctx context.Context, ownerID string, r *http.Request, ev *entity.Event, now time.Time,
) {
	viewerID := d.viewerFor(ownerID, r, now)
	if _, err := d.Repo.TouchViewer(ctx, ownerID, viewerID); err != nil {
		d.log().Warn("traffic: touch viewer", "err", err)
	}
	visitID, verr := d.Repo.ResolveVisit(ctx, d.Secret, ownerID, viewerID, now)
	if verr != nil {
		d.log().Warn("traffic: resolve visit", "err", verr)
		return
	}
	rec := repo.Recording{
		Event: ev, OwnerID: ownerID, ViewerID: viewerID, VisitID: visitID, At: now,
	}
	if rerr := d.Repo.Record(ctx, &rec); rerr != nil {
		d.log().Warn("traffic: record", "err", rerr)
	}
}

// viewerFor —— the anonymous identity, or empty for a surface with no browser.
//
// The IP reaches this function and no further: it is an input to the hash and is never
// returned, stored, or logged.
func (d *Deps) viewerFor(ownerID string, r *http.Request, now time.Time) string {
	ip, ua := clientIP(r), r.UserAgent()
	if ip == "" || ua == "" {
		return ""
	}
	return entity.ViewerID(d.Secret, ownerID, ip, ua, now)
}

func (d *Deps) log() *slog.Logger {
	if d.Log != nil {
		return d.Log
	}
	return slog.Default()
}

// effectiveURL —— what the browser reported, or the request's own path for a server emit.
func effectiveURL(r *http.Request, reported string) string {
	if strings.TrimSpace(reported) != "" {
		return reported
	}
	if r.URL == nil {
		return ""
	}
	return r.URL.RequestURI()
}

func effectiveReferrer(r *http.Request, reported string) string {
	if strings.TrimSpace(reported) != "" {
		return reported
	}
	return r.Referer()
}

// hostOf —— the host the visitor was actually on. A forwarded host wins, because behind a
// reverse proxy r.Host is the internal service name and would land in the hostname column.
func hostOf(r *http.Request) string {
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		return strings.TrimSpace(strings.Split(h, ",")[0])
	}
	return r.Host
}

// firstLanguage —— one language tag, from the beacon or from Accept-Language. The header is a
// weighted list; only its first entry is worth a column.
func firstLanguage(reported, header string) string {
	if l := strings.TrimSpace(reported); l != "" {
		return l
	}
	first, _, _ := strings.Cut(header, ",")
	tag, _, _ := strings.Cut(first, ";")
	return strings.TrimSpace(tag)
}

// clientIP —— the caller's address, preferring the proxy headers a self-hosted instance sits
// behind. Used only as hash input.
func clientIP(r *http.Request) string {
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return strings.TrimSpace(ip)
	}
	host, _, found := strings.Cut(r.RemoteAddr, ":")
	if !found {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return strings.TrimSpace(host)
}
