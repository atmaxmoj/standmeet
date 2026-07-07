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
	if err := scriptGhost(cred.Endpoint, sc); err != nil {
		sink.fatal(fmt.Errorf("script ghost: %w", err))
		return runResult{name: sc.Name, ok: false}
	}
	if err := agentcore.RunAgentLoop(ctx, log, scenarioInput(sc, &cred), sink); err != nil {
		sink.fatal(err)
	}
	tools, ok, stop := sink.outcome()
	if sc.ExpectGhost != nil {
		ok = checkGhostGold(w, sc, sink.capturedGhost()) && ok
	}
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
	// doc_context(#36):访客当前 doc → backend 注进 instruction 解析指代。字段类型
	// 在 internal/,eval 不能 naming;直接赋构造函数结果(类型由字段推断)。
	if d := sc.DocContext; d != nil {
		in.Req.DocContext = agentcore.NewAgentDocContext(d.Title, d.Path, d.Genre)
	}
	if len(sc.Tools) > 0 {
		in.Tools, in.ProgressLabels = scenarioTools(sc.Tools)
	}
	// Ghost steering: inject the scenario's waypoints + visited into a DB-free policy closure so the
	// loop emits the `ghost` frame after done (mock scripts the phrasing; unvisited-gate handles silence).
	if len(sc.Waypoints) > 0 {
		wps, visited := scenarioWaypoints(sc.Waypoints)
		in.BuildGhost = func(ctx context.Context, lastMsg string) *agentcore.GhostFrame {
			return agentcore.BuildGhostPolicy(ctx, cred, wps, visited, lastMsg)
		}
	}
	return in
}

// scenarioWaypoints —— ScenarioWaypoint → BuildGhostPolicy 入参(waypoints + visited id 列表)。
func scenarioWaypoints(in []ScenarioWaypoint) ([]agentcore.Waypoint, []string) {
	wps := make([]agentcore.Waypoint, 0, len(in))
	visited := make([]string, 0, len(in))
	for _, w := range in {
		wps = append(wps, agentcore.Waypoint{
			WaypointID: w.WaypointID, Description: w.Description,
			EvidenceRefs: w.EvidenceRefs, Weight: w.Weight, IsTerminal: w.IsTerminal,
		})
		if w.Visited {
			visited = append(visited, w.WaypointID)
		}
	}
	return wps, visited
}

// scriptGhost —— 给 mock 排一条 ghost-policy 回复(mock 认 prompt 里的 "ONE GHOST MESSAGE" → 回这条)。
// 只在 expect emitted 时排;silence 场景靠 unvisited-gate 短路(全 visited → 不调 LLM),无需排。
func scriptGhost(endpoint string, sc *Scenario) error {
	if sc.ExpectGhost == nil || !sc.ExpectGhost.Emitted {
		return nil
	}
	ghost := map[string]any{
		"text":            "let's get into " + sc.ExpectGhost.TargetWaypoint,
		"target_waypoint": sc.ExpectGhost.TargetWaypoint,
	}
	return postJSON(endpoint+"/__mock/inference/next_ghost", map[string]any{"body": ghost})
}

// checkGhostGold —— deterministic gold on the emitted ghost vs expect_ghost. Prints a readable GOLD
// line + returns pass/fail. emitted=false ⇒ require silence (nil); else require the matching target.
func checkGhostGold(w io.Writer, sc *Scenario, got *agentcore.GhostFrame) bool {
	want := sc.ExpectGhost
	pass := (want.Emitted && got != nil && got.TargetWaypoint == want.TargetWaypoint) ||
		(!want.Emitted && got == nil)
	mark := "✗"
	if pass {
		mark = "✓"
	}
	fmt.Fprintf(w, "GOLD ghost │ %s → want %s, got %s %s\n",
		sc.Name, ghostWant(want), ghostTargetOr(got), mark)
	return pass
}

func ghostWant(e *ExpectGhost) string {
	if !e.Emitted {
		return "silence"
	}
	return e.TargetWaypoint
}

func ghostTargetOr(g *agentcore.GhostFrame) string {
	if g == nil {
		return "silence"
	}
	return g.TargetWaypoint
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
