package main

import (
	"fmt"
	"io"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// evalSink —— an AgentSink the runner can also read back for the summary
// tally and a pre-stream fatal. Both transcriptSink (human) and jsonlSink
// (machine) implement it.
type evalSink interface {
	agentcore.AgentSink
	fatal(err error) // pre-stream failure (build / gateway script)
	outcome() (tools int, ok bool, stop string)
}

// formatter —— owns the per-scenario header, sink construction, and the
// batch summary for one output mode. Selected by --json.
type formatter interface {
	scenarioHeader(w io.Writer, sc *Scenario)
	newSink(w io.Writer) evalSink
	summary(w io.Writer, results []runResult) bool
}

// textFormatter —— human transcript: ═══ headers + transcriptSink + a tally.
type textFormatter struct{}

func (textFormatter) scenarioHeader(w io.Writer, sc *Scenario) {
	fmt.Fprintf(w, "\n═══ %s ═══\n", sc.Name)
	if sc.Description != "" {
		fmt.Fprintf(w, "    %s\n", sc.Description)
	}
}

func (textFormatter) newSink(w io.Writer) evalSink { return newTranscriptSink(w) }

func (textFormatter) summary(w io.Writer, results []runResult) bool {
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

// jsonFormatter —— JSONL: one JSON object per line (scenario header, each
// loop event, then a summary object). grep/jq friendly; feed to another
// agent for post-processing.
type jsonFormatter struct{}

func (jsonFormatter) scenarioHeader(w io.Writer, sc *Scenario) {
	writeJSONLine(w, jsonEvent{
		Type: "scenario", Name: sc.Name, Description: sc.Description,
		System: sc.System, User: sc.User,
	})
}

func (jsonFormatter) newSink(w io.Writer) evalSink { return newJSONLSink(w) }

func (jsonFormatter) summary(w io.Writer, results []runResult) bool {
	allOK := true
	rows := make([]summaryRow, 0, len(results))
	for _, r := range results {
		if !r.ok {
			allOK = false
		}
		rows = append(rows, summaryRow{Name: r.name, Tools: r.toolStarts, Stop: r.stop, OK: r.ok})
	}
	writeJSONLine(w, jsonEvent{Type: "summary", Scenarios: rows, OK: allOK})
	return allOK
}

// pickFormatter selects the output mode.
func pickFormatter(asJSON bool) formatter {
	if asJSON {
		return jsonFormatter{}
	}
	return textFormatter{}
}
