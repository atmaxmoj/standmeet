// Package openapi — the host's side of the generic openapi supplier: spec parsing, binding
// validation, credential-form derivation and ingest. The calls themselves run in the openapi
// block (infra/plugins/openapi/engine.js), never in this process.
//
// This package is a schemaless-JSON boundary (a binding's JSONata segments are arbitrary
// JSON), so here — and only here — `any` is legitimate (golangci exempts forbidigo on this
// path, the same boundary as MCP/postgres).
package openapi

import (
	"errors"
	"fmt"
	"net/http"
)

// Assembly-time (POST /suppliers validation) sentinels: returned to admin as a friendly
// 4xx message.
var (
	ErrSpecNoOperations   = errors.New("openapi spec has no operations (paths)")
	ErrSpecNoServer       = errors.New("openapi spec has no server url")
	ErrBindingUnknownOp   = errors.New("binding references an operationId not in the spec")
	ErrBindingUnknownSeam = errors.New("binding declares an unknown seam")
	ErrBindingIncomplete  = errors.New("binding does not map all required contract operations")
	ErrBindingBadJSONata  = errors.New("binding has an invalid JSONata expression")
)

// Doer — the HTTP hand the host still uses for itself: the OAuth token exchange and refresh.
type Doer interface {
	Do(req *http.Request) (*http.Response, error)
}

// AuthInjector — puts one connection's credentials onto a request. The host runs it against a
// probe request and hands the resulting headers and query to the openapi block.
type AuthInjector func(req *http.Request) error

// StatusError — an upstream HTTP error status from a host-side call (the token endpoint).
type StatusError struct {
	Code      int
	Transient bool
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("supplier upstream returned status %d", e.Code)
}
