// slots_test.go — backend-internal unit test: category-slot dispatch. Hub holds connectors,
// SlotStore resolves the active one, and category-contract calls get dispatched to the active
// connector; no active → not connected (gated, no error). Proves consumers are
// provider-agnostic.

package connector_test

import (
	"context"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
)

type fakeCalConnector struct {
	name      string
	busy      []contract.BusyInterval
	connected bool
}

func (f fakeCalConnector) Name() string { return f.name }
func (fakeCalConnector) Kind() string   { return "openapi" }

func (f fakeCalConnector) Connected(_ context.Context, _ string) (bool, error) {
	return f.connected, nil
}

func (f fakeCalConnector) FreeBusy(
	_ context.Context, _ string, _ contract.FreeBusyReq,
) ([]contract.BusyInterval, error) {
	return f.busy, nil
}

func (f fakeCalConnector) InsertEvent(
	_ context.Context, _ string, _ *contract.InsertEventReq,
) (contract.InsertedEvent, error) {
	return contract.InsertedEvent{EventID: f.name}, nil
}

func (fakeCalConnector) DeleteEvent(_ context.Context, _, _, _ string) error { return nil }

type fakeSlotStore struct {
	id string // empty = no active
}

func (f fakeSlotStore) ActiveConnectorID(_ context.Context, _, _ string) (string, error) {
	return f.id, nil
}

func TestSlots_CalendarDispatchesToActive(t *testing.T) {
	t.Parallel()
	hub := connector.NewHub()
	hub.Register(fakeCalConnector{
		name: "google-calendar", connected: true,
		busy: []contract.BusyInterval{{}},
	})
	slots := connector.NewSlots(hub, fakeSlotStore{id: "google-calendar"})

	busy, err := slots.Calendar().FreeBusy(context.Background(), "owner-1", contract.FreeBusyReq{})
	if err != nil {
		t.Fatalf("FreeBusy: %v", err)
	}
	if len(busy) != 1 {
		t.Fatalf("dispatch lost the busy interval: %+v", busy)
	}
	ok, cerr := slots.Calendar().Connected(context.Background(), "owner-1")
	if cerr != nil || !ok {
		t.Fatalf("active+connected → Connected true, got ok=%v err=%v", ok, cerr)
	}
}

func TestSlots_NoActiveCalendar_NotConnected(t *testing.T) {
	t.Parallel()
	hub := connector.NewHub()
	slots := connector.NewSlots(hub, fakeSlotStore{})

	ok, err := slots.Calendar().Connected(context.Background(), "owner-1")
	if err != nil || ok {
		t.Fatalf("no active → (false, nil), got ok=%v err=%v", ok, err)
	}
}
