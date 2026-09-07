// identity.go —— who the viewer is, and which sitting this event belongs to.
//
// Ported from umami's collector (src/app/api/send/route.ts:154-194). The design worth taking
// is that there are TWO levels, not one:
//
//   - viewer —— a person, as far as we can tell without a cookie.
//   - visit  —— one sitting by that person, ending after 30 idle minutes.
//
// Bounce rate and dwell time have no definition with only one level. "Views per person" cannot
// tell a reader who came back six times from one who scrolled six pages once.
//
// The identity is derived, never stored as an input: the IP goes into the hash and is thrown
// away in the same function. Nothing in this package ever returns an IP to a caller.

package entity

import (
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// VisitIdleWindow —— how long a visit survives with no events. Umami's value, and the reason
// it is a constant rather than a column: the number has to be identical in the ingest path and
// in every aggregate, or the same data produces two different visit counts.
const VisitIdleWindow = 30 * time.Minute

// idHexLen —— how much of the SHA-256 a viewer or visit id keeps. 32 hex characters is 128
// bits: far past collision range for one instance's visitors, and short enough to read in a
// debug dump without wrapping.
const idHexLen = 32

// saltPeriod —— the viewer hash is salted per calendar month, so a viewer id cannot be linked
// across months. The cost is real and accepted: a visitor returning after a month boundary
// looks new. We take that over storing anything that could re-identify them.
func saltPeriod(at time.Time) string { return at.UTC().Format("2006-01") }

// ViewerID —— the anonymous, non-reversible identity of one visitor.
//
// The inputs are the instance secret, the month, the owner, the IP and the user agent. Two
// requests from the same client within one month collapse onto one id; a different browser on
// the same machine does not. That is the whole resolution this method has, and it is the same
// resolution Plausible and umami offer.
//
// The secret matters: without it, anyone who knows a visitor's IP and user agent could compute
// their id from a public leaderboard and confirm they visited.
func ViewerID(secret []byte, ownerID, ip, userAgent string, at time.Time) string {
	h := sha256.New()
	h.Write(secret)
	h.Write([]byte(saltPeriod(at)))
	h.Write([]byte(ownerID))
	h.Write([]byte(ip))
	h.Write([]byte(userAgent))
	return hex.EncodeToString(h.Sum(nil))[:idHexLen]
}

// VisitID —— a fresh sitting for a viewer.
//
// Derived rather than random so that two concurrent requests from the same viewer, arriving in
// the same second with no visit yet open, agree on one id instead of opening two visits. The
// second-level bucket is what makes them agree; a visit opened a second later is a different
// id, which is harmless because the caller only mints one when the lookup found nothing.
func VisitID(secret []byte, viewerID string, at time.Time) string {
	h := sha256.New()
	h.Write(secret)
	h.Write([]byte(viewerID))
	h.Write([]byte(at.UTC().Format(time.RFC3339)))
	return hex.EncodeToString(h.Sum(nil))[:idHexLen]
}

// VisitExpired —— whether a visit last seen at `last` is over by `now`.
//
// ponytail: the visit is resolved with one indexed lookup per event rather than umami's signed
// cache token (route.ts:112-120). The token exists to spare a cloud service a database read per
// hit; a self-hosted single-owner instance has no such pressure. Add the token if an instance
// ever serves enough traffic for that read to show up.
func VisitExpired(last, now time.Time) bool { return now.Sub(last) > VisitIdleWindow }
