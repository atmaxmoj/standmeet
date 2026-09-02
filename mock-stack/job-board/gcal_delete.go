// gcal_delete.go —— Events.delete handler + /__mock/gcal/deleted_events
// inspect endpoint. Split out of gcal.go to keep it under the max-lines 350 limit.

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
	// Whether **this** cancellation notifies attendees is decided by the
	// delete request's own sendUpdates — not the value the event was created
	// with. Record the one the delete request carries, so e2e can assert
	// "the cancellation actually notified people" (F-B-7).
	sendUpdates := r.URL.Query().Get("sendUpdates")
	s.withState(func(st *gcalState) {
		filtered := make([]mockEvent, 0, len(st.events))
		for i := range st.events {
			if st.events[i].EventID == eventID {
				gone := st.events[i]
				gone.SendUpdates = sendUpdates
				st.deletedEvents = append(st.deletedEvents, gone)
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
