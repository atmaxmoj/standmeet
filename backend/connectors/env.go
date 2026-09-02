// env.go —— `${VAR:-default}` placeholders in builtin-connector spec/binding files expand
// against the environment at Load time. Builtin connectors (e.g. gcal) default their
// endpoints to the real service in prod; e2e points GOOGLE_OAUTH_AUTH_URL / _TOKEN_URL /
// GOOGLE_CALENDAR_BASE_URL at the mock-stack instead. Placeholder syntax supports only
// `${NAME}` and `${NAME:-default}`.

package connectors

import (
	"os"
	"regexp"
)

// envRE —— matches ${NAME} or ${NAME:-default}.
var envRE = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}`)

// expandEnv —— expands ${VAR:-default} placeholders in raw against the environment
// (uses the env value if set, otherwise the default).
func expandEnv(raw []byte) []byte {
	return envRE.ReplaceAllFunc(raw, func(match []byte) []byte {
		sub := envRE.FindSubmatch(match)
		if v := os.Getenv(string(sub[1])); v != "" {
			return []byte(v)
		}
		return sub[2] // default value (nil when there's no :- → empty)
	})
}
