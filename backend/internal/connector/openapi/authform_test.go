// authform_test.go —— F-H-2: real vendor specs commonly ship `components.securitySchemes: {}`
// (Cal.com's published v2 spec does), yet the API needs `Authorization: Bearer …`. Hard-rejecting
// such a spec means the owner cannot assemble a working connector from the vendor's own spec.
// DeriveAuthForms must therefore offer a MANUAL-auth fallback (bearer / apiKey / basic) the owner
// can pick, instead of a dead-end note.

package openapi

import "testing"

const specNoSecuritySchemes = `
openapi: 3.1.0
info: { title: Cal.com-ish, version: "2" }
servers: [{ url: "https://api.example.com" }]
paths:
  /me:
    get:
      operationId: me.get
components:
  securitySchemes: {}
`

func TestDeriveAuthForms_NoSchemes_OffersManualFallback(t *testing.T) {
	spec, err := ParseSpec([]byte(specNoSecuritySchemes))
	if err != nil {
		t.Fatalf("parse spec: %v", err)
	}
	types := formTypes(DeriveAuthForms(spec))
	for _, typ := range []string{"bearer", "apikey", "basic"} {
		if !types[typ] {
			t.Errorf("F-H-2: manual fallback must offer %q (got %v)", typ, types)
		}
	}
}

func formTypes(f AuthForms) map[string]bool {
	out := map[string]bool{}
	for _, s := range f.Forms {
		out[s.Type] = true
	}
	return out
}

func TestManualScheme(t *testing.T) {
	want := map[string]SecurityScheme{
		"manual:bearer": {Type: "http", Scheme: "bearer"},
		"manual:basic":  {Type: "http", Scheme: "basic"},
		"manual:apikey": {Type: "apiKey", In: "header", Name: "Authorization"},
	}
	for name, exp := range want {
		got, ok := ManualScheme(name)
		if !ok || got != exp {
			t.Errorf("ManualScheme(%q) = %+v, ok=%v; want %+v", name, got, ok, exp)
		}
	}
	// Only the "manual:" namespace is recognised — a bare scheme name must NOT resolve.
	if _, ok := ManualScheme("bearer"); ok {
		t.Error("ManualScheme must not recognise bare 'bearer' (only 'manual:*')")
	}
}
