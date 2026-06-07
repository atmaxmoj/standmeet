package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Scenario —— one eval case, data-driven (YAML). The runner builds a Cred +
// AgentTurnInput from it, optionally scripts the deterministic llm-gateway,
// and drives the same agentic loop prod runs.
//
// cred provider/key/endpoint come from CLI flags (one provider per batch);
// Model overrides per-scenario. Script is only meaningful against the
// gateway (deterministic); omit it to run a real provider and audit真实行为.
type Scenario struct {
	Name        string          `yaml:"name"`
	Description string          `yaml:"description"`
	System      string          `yaml:"system"`
	User        string          `yaml:"user"`
	Mode        string          `yaml:"mode"`
	Model       string          `yaml:"model"`
	History     []ScenarioMsg   `yaml:"history"`
	Tools       []ScenarioTool  `yaml:"tools"`
	Script      *ScenarioScript `yaml:"script"`

	path string // source file, for error context
}

// ScenarioMsg —— a prior-turn message injected as AgentTurnRequest.History.
type ScenarioMsg struct {
	Role    string `yaml:"role"`
	Content string `yaml:"content"`
}

// ScenarioTool —— a canned tool to register: name/desc/schema for the model,
// result is the fixed string InvokableRun returns. label → progress_label.
type ScenarioTool struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	Schema      string `yaml:"schema"`
	Result      string `yaml:"result"`
	Label       string `yaml:"label"`
}

// ScenarioScript —— deterministic gateway scripting for one turn: emit Tool
// (a tool_use) on the first model call, then Reply (final text) on the next.
// Maps 1:1 to the gateway's two single-slot queues. Both optional.
type ScenarioScript struct {
	Tool  *ScriptTool `yaml:"tool"`
	Reply string      `yaml:"reply"`
}

// ScriptTool —— a tool_use the gateway should emit. Args is free-form;
// re-marshalled to JSON for the /__mock/inference/next_tool body.
type ScriptTool struct {
	Name string         `yaml:"name"`
	Args map[string]any `yaml:"args"`
}

// loadScenarios reads a single .yml/.yaml file or every one under a dir
// (sorted by path for stable batch order), then filters by grep (substring
// of scenario name; empty grep keeps all).
func loadScenarios(path, grep string) ([]*Scenario, error) {
	files, err := scenarioFiles(path)
	if err != nil {
		return nil, err
	}
	out := make([]*Scenario, 0, len(files))
	for _, f := range files {
		sc, perr := parseScenario(f)
		if perr != nil {
			return nil, perr
		}
		if grep != "" && !strings.Contains(sc.Name, grep) {
			continue
		}
		out = append(out, sc)
	}
	return out, nil
}

func scenarioFiles(path string) ([]string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("scenarios path: %w", err)
	}
	if !info.IsDir() {
		return []string{path}, nil
	}
	var files []string
	walk := func(p string, d os.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		if d.IsDir() {
			return nil
		}
		if ext := filepath.Ext(p); ext == ".yml" || ext == ".yaml" {
			files = append(files, p)
		}
		return nil
	}
	if werr := filepath.WalkDir(path, walk); werr != nil {
		return nil, fmt.Errorf("walk scenarios: %w", werr)
	}
	sort.Strings(files)
	return files, nil
}

func parseScenario(file string) (*Scenario, error) {
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", file, err)
	}
	var sc Scenario
	if uerr := yaml.Unmarshal(raw, &sc); uerr != nil {
		return nil, fmt.Errorf("parse %s: %w", file, uerr)
	}
	if sc.Name == "" {
		sc.Name = strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	}
	sc.path = file
	return &sc, nil
}
