// Package entity holds the traffic domain model: what one recorded event is, how a viewer and
// a visit are derived from a request, and how a raw URL, referrer and user agent become the
// columns an aggregate can group by.
//
// Nothing here touches storage or HTTP. Every function is pure, which is what makes the ported
// rules (docs/design/traffic.md §1.1) testable on their own rather than only through a request.
package entity
