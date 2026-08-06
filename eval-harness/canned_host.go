// canned_host.go —— the outside world a mounted capability talks to, canned.
//
// P.13's invariant: backend carries ZERO fixtures. agentcore gives the bridge (a socket serving
// the host ops a manifest orders); the *answers* live here, next to EvalDriver.
//
// What is canned is only the world beyond the boundary — a calendar that answers, a table that
// keeps rows. The plugin, the host-op vocabulary, the ACL gate and the assembly are the real ones;
// canning any of those would make the eval pass against a product that does not exist.

package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// BusyWindow —— one busy interval, in the shape the calendar connector answers free_busy with.
type BusyWindow struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

// cannedCalendar —— a calendar connector that answers. Busy windows are configurable (empty = the
// week is free); an insert returns a fresh event id; a delete forgets it. `fail` makes ONE verb
// fail ("calendar.insert_event"), which is how the can't-book paths get driven.
type cannedCalendar struct {
	busy []BusyWindow
	fail map[string]string

	mu     sync.Mutex
	events map[string]bool
}

// call —— one "<category>.<verb>" from the plugin, answered.
func (c *cannedCalendar) call(verb string, args []byte) ([]byte, error) {
	if msg, bad := c.fail[verb]; bad {
		return nil, fmt.Errorf("%s: %s", verb, msg)
	}
	switch verb {
	case "calendar.free_busy":
		return json.Marshal(nonNilWindows(c.busy))
	case "calendar.insert_event":
		return c.insert()
	case "calendar.delete_event":
		return c.forget(args)
	case "mail.send":
		// the confirmation mail is a soft dependency: it must not decide whether a booking works.
		return []byte(`{"ok":true}`), nil
	default:
		return nil, fmt.Errorf("canned world has no %s", verb)
	}
}

func (c *cannedCalendar) insert() ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.events == nil {
		c.events = map[string]bool{}
	}
	id := fmt.Sprintf("evt-%d", len(c.events)+1)
	c.events[id] = true
	return json.Marshal(map[string]string{
		"event_id": id, "html_link": "https://calendar.example/" + id,
	})
}

func (c *cannedCalendar) forget(args []byte) ([]byte, error) {
	var in struct {
		EventID string `json:"event_id"`
	}
	_ = json.Unmarshal(args, &in)
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.events, in.EventID)
	return []byte(`{"ok":true}`), nil
}

func nonNilWindows(w []BusyWindow) []BusyWindow {
	if w == nil {
		return []BusyWindow{}
	}
	return w
}

// memStore —— a capability's isolated store, in memory.
//
// Matching follows postgres's `doc @> filter` (containment), not equality: the booking quota
// counts rows by code_id with a one-key filter, and equality would count zero — silently.
type memStore struct {
	mu   sync.Mutex
	docs map[string][]agentcore.StoredRecord
	seq  int
}

func newMemStore() *memStore {
	return &memStore{docs: map[string][]agentcore.StoredRecord{}}
}

func (m *memStore) Insert(collection string, doc []byte) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq++
	id := fmt.Sprintf("rec-%d", m.seq)
	m.docs[collection] = append(m.docs[collection], agentcore.StoredRecord{ID: id, Doc: doc})
	return id, nil
}

func (m *memStore) Query(collection string, filter []byte) ([]agentcore.StoredRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]agentcore.StoredRecord, 0, len(m.docs[collection]))
	for _, r := range m.docs[collection] {
		if jsonContains(r.Doc, filter) {
			out = append(out, r)
		}
	}
	return out, nil
}

func (m *memStore) DeleteByID(collection, recordID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.dropLocked(collection, func(r agentcore.StoredRecord) bool {
		return r.ID == recordID
	}) > 0, nil
}

func (m *memStore) DeleteMatching(collection string, filter []byte) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.dropLocked(collection, func(r agentcore.StoredRecord) bool {
		return jsonContains(r.Doc, filter)
	}), nil
}

func (m *memStore) dropLocked(collection string, gone func(agentcore.StoredRecord) bool) int {
	kept := make([]agentcore.StoredRecord, 0, len(m.docs[collection]))
	n := 0
	for _, r := range m.docs[collection] {
		if gone(r) {
			n++
			continue
		}
		kept = append(kept, r)
	}
	m.docs[collection] = kept
	return n
}

// rows —— every doc in a collection (assertions read this: a real booking leaves one).
func (m *memStore) rows(collection string) []agentcore.StoredRecord {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]agentcore.StoredRecord{}, m.docs[collection]...)
}

// jsonContains —— postgres's `doc @> filter` for the shapes these capabilities filter on: the
// top-level keys must be present and equal. An empty filter matches everything.
//
// Nested containment is not implemented: the booker filters on scalars (owner_id / code_id /
// conversation_id). If a capability ever filters on a nested object this under-matches, and the
// assertion that relies on it goes red — it does not quietly return extra rows.
func jsonContains(doc, filter []byte) bool {
	want := map[string]json.RawMessage{}
	if err := json.Unmarshal(filter, &want); err != nil || len(want) == 0 {
		return true
	}
	got := map[string]json.RawMessage{}
	if err := json.Unmarshal(doc, &got); err != nil {
		return false
	}
	for k, v := range want {
		if strings.TrimSpace(string(got[k])) != strings.TrimSpace(string(v)) {
			return false
		}
	}
	return true
}

// bookingWorld —— the canned world a booking-capable launch runs against: an owner in `tz` whose
// calendar is free unless `busy` says otherwise, plus its own record table.
//
// failMsg is what the calendar SAYS when it refuses. It is not decoration: "409, that time was
// just taken" and "the service is down" are different situations, and the agent is supposed to
// take a different path for each. A generic "refused" leaves it guessing.
func bookingWorld(ownerID, tz string, busy []BusyWindow, fail, failMsg string) (
	*agentcore.CapabilityHost, *memStore,
) {
	cal := &cannedCalendar{busy: busy}
	if fail != "" {
		if failMsg == "" {
			failMsg = "the calendar refused this call"
		}
		cal.fail = map[string]string{fail: failMsg}
	}
	store := newMemStore()
	return &agentcore.CapabilityHost{
		OwnerID: ownerID, Timezone: tz, Connector: cal.call, Store: store,
	}, store
}

// reportBox —— where a stored report lands in the mini-host. Prod puts the row in postgres and
// hands the id back; here it stays in memory. What matters is that report.store SUCCEEDS: the
// plugin returns the host-sanitised HTML to the tool result, which is what the eval judges.
type reportBox struct {
	mu    sync.Mutex
	seq   int
	saved []string
}

func newReportBox() *reportBox { return &reportBox{} }

func (b *reportBox) store(html string) (string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.seq++
	b.saved = append(b.saved, html)
	return fmt.Sprintf("rep-%d", b.seq), nil
}

// reports —— every report stored so far (assertions read this).
func (b *reportBox) reports() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string{}, b.saved...)
}

// bookableSlot —— a weekday inside the manifest's default working hours, past its minimum lead
// time. Derived, not hard-coded: a fixed date drifts into the past and the eval starts failing
// for a reason that has nothing to do with the product.
func bookableSlot(now time.Time) time.Time {
	day := now.UTC().AddDate(0, 0, 14)
	slot := time.Date(day.Year(), day.Month(), day.Day(), 14, 0, 0, 0, time.UTC)
	for slot.Weekday() == time.Saturday || slot.Weekday() == time.Sunday {
		slot = slot.AddDate(0, 0, 1)
	}
	return slot
}
