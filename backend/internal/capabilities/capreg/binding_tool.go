// binding_tool.go — the "one LLM tool" a Capability exposes to the visitor agent loop.
//
// After H.8, BindingTool holds an eino tool.InvokableTool directly — the backend
// agent loop (H.9 runs eino ADK / ToolsNode) can plug BindingTool.Tool straight
// into an eino tool node; there's no more standmeet-maintained parallel
// ToolExecutor abstraction.
//
// Three layers:
//
//	Tool          — eino canonical (Info / InvokableRun); used by the agent loop
//	ProgressLabel — standmeet addition: throbber text, sent from a single backend
//	                source since G-8; not part of eino schema.ToolInfo
//	InputSchema   — the raw JSON Schema text (as given at registration).
//	                VisitorToolSpec (HTTP wire to browser pi-agent-core) forwards
//	                it as-is, bypassing the eino ParamsOneOf deserialize path, so
//	                the schema string stays exactly what the caller wrote at
//	                registration.

package capreg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
	"github.com/eino-contrib/jsonschema"
)

var (
	errEmptySchema  = errors.New("capreg: empty schema")
	errSchemaNoType = errors.New("capreg: schema missing type")
)

// BindingTool — one LLM tool exposed by one Capability.
//
// Construct it via NewTool(...) or NewReturnDirectlyTool(...); never build it as
// a bare struct literal — that risks the caller forgetting InputSchema or letting
// Tool.Info() drift out of sync with the sidecar fields.
//
// Name is a snapshot of Tool.Info().Name, stashed at NewTool registration time —
// so the dispatcher (routes/public/tools.go findToolInBinding, and the
// appendBinding ToolSpecs in sys/diag_session) can look a tool up by name
// without running ctx + Info() and its failure fallback on every lookup.
//
// ReturnDirectly — I.1: a tool like ask_visitor shouldn't keep the LLM looping
// after it returns; instead the result goes straight to the browser as final,
// implemented via eino ADK's ToolsConfig.ReturnDirectly map.
// NewReturnDirectlyTool sets it true at construction; the older NewTool
// defaults it false.
type BindingTool struct {
	Tool           tool.InvokableTool
	Name           string
	ProgressLabel  string
	UIHTML         string
	InputSchema    json.RawMessage
	ReturnDirectly bool
	// ReadOnly — the tool declares MCP `annotations.readOnlyHint` (a safe/idempotent
	// read). dispatch uses this to allow HTTP QUERY: only read-only tools may be
	// QUERY'd; a state-changing tool answers QUERY with 405.
	ReadOnly bool
}

// RunFn — the tool execution closure a capability writes. args is the JSON
// arguments the LLM fed in (raw string). Returns string text for tool_result.
//
// Same shape as eino tool.InvokableRun (s, error); saves a wrapper layer.
type RunFn func(ctx context.Context, argsJSON string) (string, error)

// NewTool — the standard constructor a capability uses to register an LLM tool.
// schemaRaw is raw JSON Schema bytes (a valid JSON object with
// type/properties/required); internally it's parsed into a *schema.ParamsOneOf
// for eino, while the same bytes are stashed as-is into InputSchema so the
// visitor wire can forward them directly.
//
// schemaRaw empty / missing type → treated as "no parameters", eino gets a nil
// ParamsOneOf (same sentinel semantics as proxy_wire.toEinoToolInfos).
func NewTool(
	name, description, progressLabel string,
	schemaRaw json.RawMessage, run RunFn,
) BindingTool {
	info := &schema.ToolInfo{
		Name: name,
		Desc: description,
	}
	if params, err := paramsFromRaw(schemaRaw); err == nil {
		info.ParamsOneOf = params
	}
	return BindingTool{
		Tool:          &funcTool{info: info, run: run},
		Name:          name,
		ProgressLabel: progressLabel,
		InputSchema:   schemaRaw,
	}
}

// NewReturnDirectlyTool — same as NewTool but sets ReturnDirectly=true.
// The agent loop returns immediately after calling it, no extra LLM round
// trip; the run fn should echo (or compute) a result string that can be
// rendered as-is.
func NewReturnDirectlyTool(
	name, description, progressLabel string,
	schemaRaw json.RawMessage, run RunFn,
) BindingTool {
	b := NewTool(name, description, progressLabel, schemaRaw, run)
	b.ReturnDirectly = true
	return b
}

// paramsFromRaw — the same parsing logic as inference.proxy_wire: empty schema
// → nil, parse failure → the caller gets an error and decides (NewTool
// currently swallows it, so a "no-parameter tool" can still register).
func paramsFromRaw(raw json.RawMessage) (*schema.ParamsOneOf, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, errEmptySchema
	}
	var js jsonschema.Schema
	if err := json.Unmarshal(raw, &js); err != nil {
		return nil, fmt.Errorf("capreg: schema decode: %w", err)
	}
	if js.Type == "" {
		return nil, errSchemaNoType
	}
	return schema.NewParamsOneOfByJSONSchema(&js), nil
}

// funcTool — a minimal tool.InvokableTool implementation that mixes the
// caller-supplied RunFn into the eino interface. eino-ext's utils.InferTool
// uses reflection to auto-bind a typed arg function; our capabilities take
// raw JSON args directly (same shape as the LLM tool_use API), so reflection
// buys nothing — hand-writing it is lighter.
type funcTool struct {
	info *schema.ToolInfo
	run  RunFn
}

func (t *funcTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return t.info, nil
}

func (t *funcTool) InvokableRun(
	ctx context.Context, argumentsInJSON string, _ ...tool.Option,
) (string, error) {
	return t.run(ctx, argumentsInJSON)
}

// FlattenResult is the return of FlattenBindings: one eino tool collection +
// one name → progress_label table + the I.1 ReturnDirectly name set. It's a
// struct return to satisfy the mutually exclusive gocritic unnamedResult /
// nonamedreturns lints at once. Field order follows fieldalignment: maps
// (8 pointer bytes) first, slices after.
type FlattenResult struct {
	Labels         map[string]string
	ReturnDirectly map[string]bool
	Tools          []tool.BaseTool
	// ClaimGates — among the capabilities assembled this session, the ones that
	// declared "say it, then do it" conditions (F-A-37).
	ClaimGates []ClaimGate
}

// FlattenBindings walks each Binding's BindingTool list, pulls out Tool to
// build a []tool.BaseTool for eino, and along the way collects the
// ProgressLabel + ReturnDirectly name tables (used by the SSE tool_started
// frame and eino ADK ToolsConfig).
func FlattenBindings(bindings []*Binding) FlattenResult {
	out := FlattenResult{
		Labels:         map[string]string{},
		ReturnDirectly: map[string]bool{},
		Tools:          make([]tool.BaseTool, 0),
		ClaimGates:     make([]ClaimGate, 0),
	}
	for _, b := range bindings {
		for i := range b.Tools {
			absorbTool(&out, &b.Tools[i])
		}
		if b.ClaimGate != nil {
			out.ClaimGates = append(out.ClaimGates, *b.ClaimGate)
		}
	}
	return out
}

func absorbTool(out *FlattenResult, t *BindingTool) {
	out.Tools = append(out.Tools, t.Tool)
	if t.ProgressLabel != "" {
		out.Labels[t.Name] = t.ProgressLabel
	}
	if t.ReturnDirectly {
		out.ReturnDirectly[t.Name] = true
	}
}
