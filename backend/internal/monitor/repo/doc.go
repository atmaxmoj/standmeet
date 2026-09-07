// Package repo persists visitor traffic.
//
// One rule governs the whole package: recording a traffic event may never fail the request that
// produced it. Callers log what comes back and carry on.
package repo
