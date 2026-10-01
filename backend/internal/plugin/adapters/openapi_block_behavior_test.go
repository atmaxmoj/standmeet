package adapters

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/egress"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// connStore — one stored connection, read back as is.
type connStore struct{ conn *credentials.Connection }

func (s connStore) Get(context.Context, string, string) (credentials.Connection, error) {
	return *s.conn, nil
}

func (connStore) SaveTokens(context.Context, string, string, *TokenRefresh) error { return nil }

func (connStore) MarkDisconnected(context.Context, string, string) error { return nil }

const authSpec = `
openapi: 3.0.3
servers: [{ url: "https://api.saas.test/v1" }]
paths: { /x: { get: { operationId: x.get } } }
components:
  securitySchemes:
    qkey: { type: apiKey, in: query, name: api_key }
    hkey: { type: apiKey, in: header, name: X-Api-Key }
    basic: { type: http, scheme: basic }
`

type authCase struct {
	header map[string]string
	query  map[string]string
	scheme string
	creds  string
}

// TestAuthFor — the block applies whatever the host resolved, so every scheme must come out as
// the right header or query parameter, with the spec's server as the base URL.
func TestAuthFor(t *testing.T) {
	t.Parallel()
	none := map[string]string{}
	cases := []authCase{
		{
			scheme: "qkey", creds: `{"key":"k1"}`,
			header: none, query: map[string]string{"api_key": "k1"},
		},
		{
			scheme: "hkey", creds: `{"key":"k2"}`,
			header: map[string]string{"X-Api-Key": "k2"}, query: none,
		},
		{
			scheme: "basic", creds: `{"username":"u","password":"p"}`,
			header: map[string]string{"Authorization": "Basic dTpw"}, query: none,
		},
		{
			scheme: "manual:bearer", creds: `{"token":"t"}`,
			header: map[string]string{"Authorization": "Bearer t"}, query: none,
		},
	}
	for i := range cases {
		c := cases[i]
		t.Run(c.scheme, func(t *testing.T) {
			t.Parallel()
			store := connStore{conn: &credentials.Connection{Credentials: []byte(c.creds)}}
			beh, err := AssembleOpenAPIBehavior(&Manifest{
				ID: "saas", Kind: "openapi", AuthScheme: c.scheme, Spec: []byte(authSpec),
			}, nil, store, egress.NewAllow(nil))
			require.NoError(t, err)
			a, aerr := beh.AuthFor(context.Background(), "owner")
			require.NoError(t, aerr)
			require.Equal(t, c.header, a.Headers)
			require.Equal(t, c.query, a.Query)
			require.Equal(t, "https://api.saas.test/v1", a.BaseURL)
			require.Empty(t, beh.Seam(), "no binding → agent-only")
		})
	}
}

// TestAssembleRefusesSpecWithoutServer — the block needs a base URL; a spec with none is
// refused at upload, not at the first call.
func TestAssembleRefusesSpecWithoutServer(t *testing.T) {
	t.Parallel()
	_, err := AssembleOpenAPIBehavior(&Manifest{
		ID: "s", Kind: "openapi", AuthScheme: "hkey",
		Spec: []byte("openapi: 3.0.3\npaths: { /x: { get: { operationId: x } } }\n" +
			"components: { securitySchemes: { hkey: { type: apiKey, in: header, name: K } } }\n"),
	}, nil, connStore{conn: &credentials.Connection{}}, egress.NewAllow(nil))
	require.ErrorContains(t, err, "no server url")
}
