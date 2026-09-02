// Package openapi — the execution core of the generic openapi connector (spec parsing +
// JSONata binding + HTTP relay).
//
// This is the heart of "connector normalization": any openapi connector — the built-in gcal,
// an uploaded SendGrid — is "one OpenAPI 3.0/3.1 spec + one JSONata binding" run through this
// same Runtime. This package is the schemaless-JSON boundary (any SaaS's request/response is
// arbitrary JSON), so here — and only here — `any` is legitimate (golangci exempts forbidigo
// on this path, the same boundary as MCP/postgres). Contract adapters outside this package
// use **typed** input/output throughout (Call does the JSON round-trip internally); `any`
// never leaks out.
package openapi

import "errors"

// Assembly-time (POST /connectors validation) sentinels: returned to admin as a friendly
// 4xx message.
var (
	ErrSpecNoOperations       = errors.New("openapi spec has no operations (paths)")
	ErrSpecNoServer           = errors.New("openapi spec has no server url")
	ErrBindingUnknownOp       = errors.New("binding references an operationId not in the spec")
	ErrBindingUnknownCategory = errors.New("binding declares an unknown category")
	ErrBindingIncomplete      = errors.New("binding does not map all required contract operations")
	ErrBindingBadJSONata      = errors.New("binding has an invalid JSONata expression")
	// ErrMissingRequired — runtime pre-flight: the body the request JSONata evaluated to is
	// missing a field the spec declares required (e.g. events.insert missing summary) →
	// reject, never send a malformed request.
	ErrMissingRequired = errors.New("required request field missing")
)
