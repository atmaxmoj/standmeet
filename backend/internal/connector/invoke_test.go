// invoke_test.go — unit tests for the reach-back verb dispatcher. Proves the one consumption
// path holds: "string category+verb → resolve the active connector by name → call the typed
// method → return JSON"; unknown category/verb → error (closed vocabulary). Reuses
// fakeCalConnector / fakeSlotStore from slots_test.go.

package connector_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
)

type fakeMailConnector struct {
	sent      *contract.MailMessage
	name      string
	connected bool
}

func (f *fakeMailConnector) Name() string { return f.name }
func (*fakeMailConnector) Kind() string   { return "protocol" }

func (f *fakeMailConnector) Connected(_ context.Context, _ string) (bool, error) {
	return f.connected, nil
}

func (f *fakeMailConnector) Send(_ context.Context, _ string, msg contract.MailMessage) error {
	f.sent = &msg
	return nil
}

func calendarSlots(t *testing.T) *connector.Slots {
	t.Helper()
	hub := connector.NewHub()
	hub.Register(fakeCalConnector{name: "google-calendar", connected: true})
	return connector.NewSlots(hub, fakeSlotStore{id: "google-calendar"})
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

func TestInvoke_MailSendReachesConnector(t *testing.T) {
	t.Parallel()
	fake := &fakeMailConnector{name: "smtp", connected: true}
	hub := connector.NewHub()
	hub.Register(fake)
	slots := connector.NewSlots(hub, fakeSlotStore{id: "smtp"})

	_, err := slots.Invoke(context.Background(), "owner-1", "mail", "send",
		json.RawMessage(`{"to":"a@b.c","subject":"hi","body":"x"}`))
	if err != nil {
		t.Fatalf("invoke send: %v", err)
	}
	if fake.sent == nil || fake.sent.To != "a@b.c" {
		t.Fatalf("send did not reach the active mail connector: %+v", fake.sent)
	}
}

func TestInvoke_UnknownCategoryAndVerb_Error(t *testing.T) {
	t.Parallel()
	s := calendarSlots(t)
	if _, err := s.Invoke(context.Background(), "o", "weather", "get", nil); err == nil {
		t.Fatal("unknown category must error (closed vocabulary)")
	}
	if _, err := s.Invoke(context.Background(), "o", "calendar", "teleport", nil); err == nil {
		t.Fatal("unknown verb must error (closed vocabulary)")
	}
}
