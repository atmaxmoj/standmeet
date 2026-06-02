// gcal_delete.go —— Events.delete handler + /__mock/gcal/deleted_events
// inspect endpoint. 拆出 gcal.go 守 max-lines 350。

package main

import (
	"net/http"
)

// serveCalendarEventsDelete —— mock for Events.delete. Removes the matching
// event from in-state events list; returns 204 (idempotent — 204 even if
// the event id isn't tracked, matching Google's "already gone" behavior
// being treated as success at the client). Records the delete so e2e can
// inspect via /__mock/gcal/deleted_events.
func (s *server) serveCalendarEventsDelete(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("eventId")
	s.withState(func(st *gcalState) {
		filtered := make([]mockEvent, 0, len(st.events))
		for i := range st.events {
			if st.events[i].EventID == eventID {
				st.deletedEvents = append(st.deletedEvents, st.events[i])
				continue
			}
			filtered = append(filtered, st.events[i])
		}
		st.events = filtered
	})
	w.WriteHeader(http.StatusNoContent)
}

// serveMockGCalDeletedEvents —— let e2e verify which events Events.delete
// actually targeted. Pairs with /__mock/gcal/events.
func (s *server) serveMockGCalDeletedEvents(w http.ResponseWriter, _ *http.Request) {
	out := []mockEvent{}
	s.withState(func(st *gcalState) { out = append(out, st.deletedEvents...) })
	writeEventsList(s.log, w, eventsResponse{Events: out})
}
