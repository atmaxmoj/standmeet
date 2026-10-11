// reach.go —— what one owner key may call: its danger classes and, when it names them, its tools
// (job-loop roadmap 8.5.a). The MCP face asks; the answer lives here, next to the classes.

package facadeparity

import "slices"

// KeyReach —— a verified key's limits. Tools empty = every tool its scopes cover.
type KeyReach struct {
	Scopes []string
	Tools  []string
}

// Allows —— whether the key may call a tool of this danger class ("" = the tool declares none,
// reachable by a key with every class only).
func (k KeyReach) Allows(tool, danger string) bool {
	return k.Refusal(tool, danger) == ""
}

// Refusal —— the error a call out of the key's reach gets, or "" when the call may run.
func (k KeyReach) Refusal(tool, danger string) string {
	if len(k.Tools) > 0 && !slices.Contains(k.Tools, tool) {
		return "not allowed: " + tool + " is not on this key's tool list. Create a key that " +
			"names it, or one without a tool list, on /admin (API · MCP)."
	}
	if k.classAllowed(danger) {
		return ""
	}
	if danger == "" {
		danger = "every class"
	}
	return "not allowed: " + tool + " needs the \"" + danger + "\" scope, which this key " +
		"does not have. Create a key with that scope on /admin (API · MCP)."
}

func (k KeyReach) classAllowed(danger string) bool {
	if danger == "" {
		return len(k.Scopes) == len(AllDangers())
	}
	return slices.Contains(k.Scopes, danger)
}
