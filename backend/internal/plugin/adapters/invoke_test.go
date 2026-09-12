// invoke_test.go — unit tests for the reach-back verb dispatcher. Proves the one consumption
// path holds: "string seam+verb → resolve the active supplier by name → call the typed
// method → return JSON"; unknown seam/verb → error (closed vocabulary).

// Dispatch internals are under test; the seam vocabulary is unexported-adjacent.

package adapters

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type fakeMailSupplier struct {
	sent      *MailMessage
	name      string
	connected bool
}

func (f *fakeMailSupplier) Name() string { return f.name }
func (*fakeMailSupplier) Kind() string   { return "protocol" }

func (f *fakeMailSupplier) Connected(_ context.Context, _ string) (bool, error) {
	return f.connected, nil
}

func (f *fakeMailSupplier) Send(
	_ context.Context, _ string, msg MailMessage,
) (MailReceipt, error) {
	f.sent = &msg
	return MailReceipt{}, nil
}

// fakeCalSupplier — a calendar supplier. The fake is unchanged from the Hub/Slots era
// because what it stands for did not change, only how a consumer finds it.
type fakeCalSupplier struct {
	name      string
	connected bool
}

func (f fakeCalSupplier) Name() string { return f.name }
func (fakeCalSupplier) Kind() string   { return "openapi" }

func (f fakeCalSupplier) Connected(_ context.Context, _ string) (bool, error) {
	return f.connected, nil
}

func (fakeCalSupplier) FreeBusy(
	_ context.Context, _ string, _ FreeBusyReq,
) ([]BusyInterval, error) {
	return nil, nil
}

func (f fakeCalSupplier) InsertEvent(
	_ context.Context, _ string, _ *InsertEventReq,
) (InsertedEvent, error) {
	return InsertedEvent{EventID: f.name, HTMLLink: "https://example.test/" + f.name}, nil
}

func (fakeCalSupplier) DeleteEvent(_ context.Context, _, _, _ string) error { return nil }

// supplying — a dispatcher whose seam resolves to one supplier.
//
// This is the whole of what `NewHub()` + `hub.Register(...)` + `NewSlots(hub, store)`
// used to build. Resolution is a function from a name; there is no registry object to
// stand up, which is the point of deleting Hub.
func supplying(seam string, sup Supplier) *Dispatcher {
	return NewDispatcher(func(_ context.Context, _, want string) (Supplier, error) {
		if want != seam {
			return nil, nil
		}
		return sup, nil
	})
}

func calendarSlots(t *testing.T) *Dispatcher {
	t.Helper()
	return supplying("calendar", fakeCalSupplier{name: "google-calendar", connected: true})
}

func TestInvoke_CalendarInsertEvent(t *testing.T) {
	t.Parallel()
	raw, err := calendarSlots(t).Invoke(
		context.Background(), "owner-1", "calendar", "insert_event", json.RawMessage(`{}`),
	)
	if err != nil {
		t.Fatalf("invoke insert_event: %v", err)
	}
	if !strings.Contains(string(raw), "google-calendar") {
		t.Fatalf("dispatch did not reach InsertEvent, got %s", raw)
	}
}

func TestInvoke_CalendarConnected(t *testing.T) {
	t.Parallel()
	raw, err := calendarSlots(t).Invoke(
		context.Background(), "owner-1", "calendar", "connected", nil,
	)
	if err != nil {
		t.Fatalf("invoke connected: %v", err)
	}
	if !strings.Contains(string(raw), `"connected":true`) {
		t.Fatalf("connected verb wrong result: %s", raw)
	}
}

func TestInvoke_MailSendReachesSupplier(t *testing.T) {
	t.Parallel()
	fake := &fakeMailSupplier{name: "smtp", connected: true}
	slots := supplying("mail", fake)

	_, err := slots.Invoke(context.Background(), "owner-1", "mail", "send",
		json.RawMessage(`{"to":"a@b.c","subject":"hi","body":"x"}`))
	if err != nil {
		t.Fatalf("invoke send: %v", err)
	}
	if fake.sent == nil || fake.sent.To != "a@b.c" {
		t.Fatalf("send did not reach the active mail supplier: %+v", fake.sent)
	}
}

func TestInvoke_UnknownSeamAndVerb_Error(t *testing.T) {
	t.Parallel()
	s := calendarSlots(t)
	if _, err := s.Invoke(context.Background(), "o", "weather", "get", nil); err == nil {
		t.Fatal("unknown seam must error (closed vocabulary)")
	}
	if _, err := s.Invoke(context.Background(), "o", "calendar", "teleport", nil); err == nil {
		t.Fatal("unknown verb must error (closed vocabulary)")
	}
}
