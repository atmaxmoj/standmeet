// Package port — the composition root **implements the narrow ports a domain declares**.
//
// A domain says "I need this one thing" (an interface); this package satisfies it with
// whatever concrete thing is on hand. The domain therefore never needs to know about
// owner / inference / redis in return — that reverse dependency would break the notion
// of "who is the foundation".
//
// There's no business logic here: every file is "wrap A as B", and both A and B are
// defined elsewhere.
package port
