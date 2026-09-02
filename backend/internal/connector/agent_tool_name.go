// agent_tool_name.go — operationId → LLM tool name.
//
// The provider's constraint on `tools[].name` is `^[a-zA-Z0-9_-]{1,64}$`, and it
// **rejects the whole array together**: one bad name and none of this turn's tools
// (booking, retrieval, sending mail) reach the model. So names must be normalized to
// the target side's **character set**, not patched character-by-character — this used
// to only replace dots (`ReplaceAll(id, ".", "_")`), but GitHub's whole REST API uses
// operationIds shaped like `gists/list`, with slashes in them (F-C-58).
//
// Normalizing can collapse different operationIds onto the same name (`gists/list`
// and `gists.list`), and `Spec.Operations()` iterates a map, so its order changes on
// every call. So disambiguation **cannot depend on arrival order**: that would make
// the same op get called `op_x` one time and `op_x_2` the next, and it's this exact
// name the owner grants authorization to. The suffix used on a collision is computed
// from the operationId itself, independent of iteration order.

package connector

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

const (
	// agentToolNameMax — the provider's max name length.
	agentToolNameMax = 64
	// agentToolHashLen — the length of the digest suffix used on a name collision.
	agentToolHashLen = 6
)

var agentToolIllegal = regexp.MustCompile(`[^A-Za-z0-9_-]`)

// agentToolNames — a set of operations → their tool names (index-aligned with ops).
func agentToolNames(ops []openapi.OpInfo) []string {
	shared := collidingBases(ops)
	out := make([]string, len(ops))
	for i := range ops {
		base := agentToolBase(ops[i].ID)
		if !shared[base] {
			out[i] = base
			continue
		}
		out[i] = clampToolName(base, agentToolNameMax-agentToolHashLen-1) +
			"_" + opIDDigest(ops[i].ID)
	}
	return out
}

// agentToolBase — the normalized name (not yet disambiguated).
func agentToolBase(opID string) string {
	return clampToolName("op_"+agentToolIllegal.ReplaceAllString(opID, "_"), agentToolNameMax)
}

// clampToolName — truncate to the limit. Truncation itself can also create
// collisions, so it runs before disambiguation.
func clampToolName(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	return s[:limit]
}

// collidingBases — bases shared by more than one operationId.
func collidingBases(ops []openapi.OpInfo) map[string]bool {
	owner := make(map[string]string, len(ops))
	shared := map[string]bool{}
	for i := range ops {
		base := agentToolBase(ops[i].ID)
		prev, seen := owner[base]
		if seen && prev != ops[i].ID {
			shared[base] = true
			continue
		}
		owner[base] = ops[i].ID
	}
	return shared
}

// opIDDigest — the operationId's own digest. Independent of iteration order, so the
// same spec computes the same name every time.
func opIDDigest(opID string) string {
	sum := sha256.Sum256([]byte(opID))
	return hex.EncodeToString(sum[:])[:agentToolHashLen]
}
