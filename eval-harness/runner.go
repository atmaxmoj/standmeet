package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/cloudwego/eino/components/tool"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// runResult —— one scenario's outcome, for the batch summary table.
type runResult struct {
	name       string
	toolStarts int
	stop       string
	ok         bool
}

// runScenarios drives each scenario in order through the formatter (header +
// sink + transcript), returning per-scenario results. credBase carries the
// batch-wide provider/key/endpoint (model overridable per scenario).
func runScenarios(
	ctx context.Context, log *slog.Logger, w io.Writer,
	scenarios []*Scenario, credBase agentcore.Cred, fmtr formatter,
) []runResult {
	results := make([]runResult, 0, len(scenarios))
	for _, sc := range scenarios {
		fmtr.scenarioHeader(w, sc)
		results = append(results, runOne(ctx, log, w, sc, credBase, fmtr))
	}
	return results
}

func runOne(
	ctx context.Context, log *slog.Logger, w io.Writer,
	sc *Scenario, credBase agentcore.Cred, fmtr formatter,
) runResult {
	cred := credBase
	if sc.Model != "" {
		cred.Model = sc.Model
	}
	sink := fmtr.newSink(w)
	if err := scriptGateway(cred.Endpoint, sc.Script); err != nil {
		sink.fatal(fmt.Errorf("script gateway: %w", err))
		return runResult{name: sc.Name, ok: false}
	}
	if err := agentcore.RunAgentLoop(ctx, log, scenarioInput(sc, &cred), sink); err != nil {
		sink.fatal(err)
	}
	tools, ok, stop := sink.outcome()
	return runResult{name: sc.Name, toolStarts: tools, stop: stop, ok: ok}
}

// scenarioInput assembles the AgentTurnInput: request + history + canned tools
// + progress labels. Mode defaults to public when unset.
func scenarioInput(sc *Scenario, cred *agentcore.Cred) *agentcore.AgentTurnInput {
	mode := sc.Mode
	if mode == "" {
		mode = "public"
	}
	in := &agentcore.AgentTurnInput{
		Cred: cred,
		Req: &agentcore.AgentTurnRequest{
			System: sc.System, UserMessage: sc.User, Model: cred.Model,
			History: scenarioHistory(sc.History),
		},
		Mode: mode,
	}
	if len(sc.Tools) > 0 {
		in.Tools, in.ProgressLabels = scenarioTools(sc.Tools)
	}
	return in
}

func scenarioHistory(in []ScenarioMsg) []agentcore.ChatRequestMsg {
	if len(in) == 0 {
		return nil
	}
	out := make([]agentcore.ChatRequestMsg, 0, len(in))
	for _, m := range in {
		out = append(out, agentcore.ChatRequestMsg{Role: m.Role, Content: m.Content})
	}
	return out
}

func scenarioTools(in []ScenarioTool) ([]tool.BaseTool, map[string]string) {
	tools := make([]tool.BaseTool, 0, len(in))
	labels := map[string]string{}
	for _, t := range in {
		tools = append(tools, newCannedTool(t.Name, t.Description, json.RawMessage(t.Schema), t.Result))
		if t.Label != "" {
			labels[t.Name] = t.Label
		}
	}
	return tools, labels
}

// scriptGateway queues the scenario's deterministic tool + reply to the
// gateway's single-slot queues. No-op when the scenario has no script.
func scriptGateway(endpoint string, sc *ScenarioScript) error {
	if sc == nil {
		return nil
	}
	if sc.Tool != nil {
		args, err := json.Marshal(sc.Tool.Args)
		if err != nil {
			return fmt.Errorf("marshal tool args: %w", err)
		}
		body := map[string]any{"name": sc.Tool.Name, "args": json.RawMessage(args)}
		if perr := postJSON(endpoint+"/__mock/inference/next_tool", body); perr != nil {
			return perr
		}
	}
	if sc.Reply != "" {
		if perr := postJSON(endpoint+"/__mock/inference/next_reply", map[string]any{"text": sc.Reply}); perr != nil {
			return perr
		}
	}
	return nil
}

func postJSON(url string, body any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	resp, perr := http.Post(url, "application/json", bytes.NewReader(raw))
	if perr != nil {
		return fmt.Errorf("post %s: %w", url, perr)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("post %s: status %d", url, resp.StatusCode)
	}
	return nil
}

// printSummary renders the batch tally and returns whether every scenario
// finished clean (no error event, no fatal).
func printSummary(w io.Writer, results []runResult) bool {
	fmt.Fprintf(w, "\n═══ summary (%d scenarios) ═══\n", len(results))
	allOK := true
	for _, r := range results {
		mark := "✓"
		if !r.ok {
			mark = "✗"
			allOK = false
		}
		stop := r.stop
		if stop == "" {
			stop = "—"
		}
		fmt.Fprintf(w, "  %s %-32s tools=%d stop=%s\n", mark, r.name, r.toolStarts, stop)
	}
	return allOK
}
