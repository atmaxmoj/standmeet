package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
	"github.com/eino-contrib/jsonschema"
)

// cannedTool —— a minimal tool.InvokableTool whose execution returns a fixed
// canned string, mirroring backend agentskills.funcTool. The eval-harness
// registers these so the agentic loop can run a full tool round-trip
// (tool_started → InvokableRun → tool_completed → follow-up turn) without
// the real capability bindings + DB the prod route assembles.
//
// The LLM (here the scripted llm-gateway) decides WHEN to call and with what
// args; the canned tool just echoes a fixture result, so the transcript shows
// the loop's tool-cascade behaviour deterministically.
type cannedTool struct {
	info   *schema.ToolInfo
	result string
}

func (t *cannedTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return t.info, nil
}

func (t *cannedTool) InvokableRun(
	_ context.Context, _ string, _ ...tool.Option,
) (string, error) {
	return t.result, nil
}

// newCannedTool builds a canned tool. schemaRaw is a raw JSON Schema (object
// with type/properties); empty or typeless → a no-params tool (nil
// ParamsOneOf), the same sentinel semantics backend's NewTool uses.
func newCannedTool(
	name, description string, schemaRaw json.RawMessage, result string,
) tool.BaseTool {
	info := &schema.ToolInfo{Name: name, Desc: description}
	if params, err := paramsFromRaw(schemaRaw); err == nil {
		info.ParamsOneOf = params
	}
	return &cannedTool{info: info, result: result}
}

var errEmptySchema = errors.New("empty schema")

func paramsFromRaw(raw json.RawMessage) (*schema.ParamsOneOf, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, errEmptySchema
	}
	var js jsonschema.Schema
	if uerr := json.Unmarshal(raw, &js); uerr != nil {
		return nil, fmt.Errorf("schema decode: %w", uerr)
	}
	if js.Type == "" {
		return nil, errEmptySchema
	}
	return schema.NewParamsOneOfByJSONSchema(&js), nil
}

// cannedToolset —— the default fixture toolset the smoke registers: a
// corpus_search → corpus_read pair so a scripted tool-cascade completes.
// Returns the eino tools plus the name → progress_label map (transcript
// shows the label on tool_started, mirroring the prod throbber text).
func cannedToolset() ([]tool.BaseTool, map[string]string) {
	searchSchema := json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}`)
	readSchema := json.RawMessage(`{"type":"object","properties":{"uri":{"type":"string"}},"required":["uri"]}`)
	tools := []tool.BaseTool{
		newCannedTool("corpus_search", "Search the owner's curated corpus.", searchSchema,
			`[{"uri":"wiki://projects/lucerna","title":"Lucerna","snippet":"a local-first thinking tool"}]`),
		newCannedTool("corpus_read", "Read one corpus entry by uri.", readSchema,
			`{"uri":"wiki://projects/lucerna","body":"Lucerna is my local-first note system."}`),
	}
	labels := map[string]string{
		"corpus_search": "searching the corpus",
		"corpus_read":   "reading an entry",
	}
	return tools, labels
}
