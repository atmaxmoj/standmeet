// vendor_openapi.go —— a stand-in for a vendor's published OpenAPI document.
//
// Why it exists: the "fetch a spec from a URL" path has **not a single e2e covering its
// happy path**. The two existing test cases that use fetching both go through failure
// scenarios (unreachable / blocked by egress policy), so "can the fetched document
// actually assemble into a connector" has never been walked by anyone — F-C-25 lives
// exactly in that gap (a candidate can be fetched, but assembly sends out an empty spec).
//
// The document **deliberately doesn't declare servers**: real vendor documents often do
// this too (Cal.com v2's own doc has `"servers": []`), and the owner has to fill in the
// base URL on the panel. This one gate therefore covers the whole real journey: fetch →
// rejected and called out → base URL filled in → candidate produced → assembled.
//
// It also **deliberately doesn't declare securitySchemes**: following the shape of a
// real document again, so the panel falls back to the manual path.

package main

import "net/http"

// vendorSpecNoServers —— minimal but complete OpenAPI 3.0: an explicit empty servers,
// two operations with operationId, no securitySchemes. Enough for the ingestion gate to
// judge it, and enough to assemble into agent tools.
const vendorSpecNoServers = `{
  "openapi": "3.0.0",
  "info": { "title": "Vendor Scheduling API", "version": "2.0.0" },
  "servers": [],
  "paths": {
    "/v2/bookings": {
      "get": {
        "operationId": "bookings.list",
        "summary": "List bookings",
        "responses": { "200": { "description": "ok" } }
      },
      "post": {
        "operationId": "bookings.create",
        "summary": "Create a booking",
        "responses": { "201": { "description": "created" } }
      }
    }
  }
}`

func (s *server) serveVendorSpecNoServers(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if _, err := w.Write([]byte(vendorSpecNoServers)); err != nil {
		s.log.Warn("write vendor spec", "err", err)
	}
}

// serveVendorSpecTooBig —— **a legitimate but oversized vendor document** (F-C-52).
//
// In the real world this is the norm: GitHub's own published `api.github.com.json` is
// **12 MB**, while this product caps ingestion at 2 MiB. The paste path used to say
// "too big", but the fetch-URL path used to only say "invalid JSON" — because the
// length-limited reader stopped exactly at the cap, and the half-JSON left at the
// truncation point failed to parse. The owner would then go hunting for a syntax error
// that didn't exist.
//
// What's served here is **legitimate JSON**: one giant description pads the size past
// the cap, everything else is correct. "Too big" and "malformed" must be distinguishable,
// and being able to distinguish them requires a stand-in that can produce the former.
func (s *server) serveVendorSpecTooBig(w http.ResponseWriter, _ *http.Request) {
	const padBytes = 3 << 20 // 3 MiB > the backend's 2 MiB cap
	pad := make([]byte, padBytes)
	for i := range pad {
		pad[i] = 'x'
	}
	w.Header().Set("Content-Type", "application/json")
	head := `{"openapi":"3.0.3","info":{"title":"Enormous Vendor","version":"1.0.0",` +
		`"description":"`
	tail := `"},"paths":{"/ping":{"get":{"operationId":"ping","responses":{"200":{` +
		`"description":"ok"}}}}}}`
	for _, part := range [][]byte{[]byte(head), pad, []byte(tail)} {
		if _, err := w.Write(part); err != nil {
			s.log.Warn("write oversized vendor spec", "err", err)
			return
		}
	}
}
