// spec_version_test.go —— F-H-1: the version gate accepts OpenAPI 3.1.x, not only 3.0.x. A real
// vendor spec (api.cal.com/v2) is 3.1, and its 3.1-only JSON-Schema-2020-12 constructs (array
// `type`) must not break the subset the runtime actually reads.

package openapi

import (
	"strings"
	"testing"
)

// spec31 —— minimal 3.1 spec exercising the 3.1-only bits the parser must tolerate: array `type`
// (`[string, "null"]`) on a property, plus the requestBody.required list the runtime does read.
const spec31 = `
openapi: 3.1.0
info: { title: Booker, version: "2" }
servers: [{ url: "https://api.example.com" }]
paths:
  /book:
    post:
      operationId: booking.create
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [start, attendee]
              properties:
                start: { type: [string, "null"] }
                attendee: { type: string }
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
`

const specSwagger2 = `
swagger: "2.0"
info: { title: Old, version: "1" }
paths:
  /x: { get: { operationId: x.get } }
`

func mustParse31(t *testing.T) *Spec {
	t.Helper()
	s, err := ParseSpec([]byte(spec31))
	if err != nil {
		t.Fatalf("3.1 spec must be accepted, got: %v", err)
	}
	return s
}

func TestParseSpec_Accepts31Operations(t *testing.T) {
	t.Parallel()
	got := mustParse31(t).Operations()
	if len(got) != 1 || got[0].ID != "booking.create" {
		t.Fatalf("operations not extracted from 3.1 spec: %+v", got)
	}
}

// TestParseSpec_31ExtractsSubset —— the requestBody.required list and securitySchemes the runtime
// reads survive a 3.1 spec (the array `type` on `start` must not derail required-name extraction).
func TestParseSpec_31ExtractsSubset(t *testing.T) {
	t.Parallel()
	s := mustParse31(t)
	op, ok := s.lookup("booking.create")
	if !ok {
		t.Fatal("booking.create not resolvable in 3.1 spec")
	}
	if strings.Join(op.Required, ",") != "start,attendee" {
		t.Fatalf("requestBody.required not extracted from 3.1 spec: %v", op.Required)
	}
	if _, has := s.SecuritySchemes()["bearer"]; !has {
		t.Fatalf("securitySchemes not extracted from 3.1 spec: %v", s.SecuritySchemes())
	}
}

func TestParseSpec_RejectsSwagger2(t *testing.T) {
	t.Parallel()
	if _, err := ParseSpec([]byte(specSwagger2)); err == nil {
		t.Fatal("Swagger 2.0 must still be rejected")
	}
}

// TestValidateIngest_31Message —— the human-facing ingest still rejects 2.0 but no longer claims
// 3.1 is unsupported (owner-facing copy must not lie now that 3.1 is accepted).
func TestValidateIngest_31Message(t *testing.T) {
	t.Parallel()
	if _, err := ValidateIngest([]byte(spec31)); err != nil {
		t.Fatalf("3.1 spec must ingest, got: %v", err)
	}
	_, err := ValidateIngest([]byte(specSwagger2))
	if err == nil {
		t.Fatal("Swagger 2.0 must be rejected at ingest")
	}
	if strings.Contains(err.Error(), "not 2.0 / 3.1") {
		t.Fatalf("ingest message still claims 3.1 unsupported: %q", err.Error())
	}
}
