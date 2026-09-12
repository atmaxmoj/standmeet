// Package credform derives the credential form an owner fills in to connect a supplier,
// from that supplier's own openapi spec.
//
// It owns no auth knowledge of its own: fields, types and scopes all come from
// openapi.DeriveAuthForms, and this package only narrows the richer AuthSchemeForm down to
// what the configure form needs. That collapse is the point — the preview and the configure
// form each used to enumerate their own copy and drift apart.
package credform
