// env.go —— `${VAR:-default}` placeholders in a block's named files expand against the
// environment at load time.
//
// Built-in blocks default their endpoints to the real service, so a production image
// needs no configuration; e2e points GOOGLE_OAUTH_AUTH_URL / _TOKEN_URL /
// GOOGLE_CALENDAR_BASE_URL at the mock stack instead, and the same manifest serves
// both. Syntax is deliberately just `${NAME}` and `${NAME:-default}` — a declaration
// that could run arbitrary substitution would be a program, and the whole point of a
// manifest is that it is not one.
//
// This lived in the supplying axis's loader and was lost when the two loaders merged
// into one. What it cost: `bearer-api` shipped its spec with
// `${BEARER_API_BASE:-https://api.example.com}` as the server URL, and unexpanded that
// is not a URL at all — the egress guard rejected it as "an internal/private address",
// which is a true statement about an unparseable string and a completely misleading
// thing to read. The block simply failed to assemble at boot.

package plugin

import (
	"os"
	"regexp"
)

// envRE —— matches ${NAME} or ${NAME:-default}.
var envRE = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}`)

// expandEnv —— expand ${VAR:-default} against the environment (env value when set,
// otherwise the default).
func expandEnv(raw []byte) []byte {
	return envRE.ReplaceAllFunc(raw, func(match []byte) []byte {
		sub := envRE.FindSubmatch(match)
		if v := os.Getenv(string(sub[1])); v != "" {
			return []byte(v)
		}
		return sub[2] // default value (nil when there is no :- → empty)
	})
}
