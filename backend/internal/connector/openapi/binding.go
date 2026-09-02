// binding.go — connector binding: maps a category contract method (list_busy/create_event/
// send…) to a spec operationId, and uses **JSONata** (the one and only mapping language) to
// declare the shape transform in both directions: request (contract input → SaaS request
// body), response (SaaS response → contract output). JSONata gets compiled at assembly time
// (a syntax error is rejected on the spot), and we validate that every op exists in the spec,
// the category is known, and every required contract method is mapped.

package openapi

import (
	"encoding/json"
	"fmt"

	jsonata "github.com/blues/jsonata-go"
	yaml "go.yaml.in/yaml/v3"
)

// jsonataSrc — the JSONata source for request/response. The owner can write it as a JSONata
// string (a scalar), or as structured YAML (map/seq, the shape the admin UI pastes in) — the
// latter gets JSON-serialized into an equivalent JSONata object-constructor source.
type jsonataSrc string

func (j *jsonataSrc) UnmarshalYAML(value *yaml.Node) error {
	if value.Kind == yaml.ScalarNode {
		*j = jsonataSrc(value.Value)
		return nil
	}
	var v any
	if err := value.Decode(&v); err != nil {
		return fmt.Errorf("decode binding expr: %w", err)
	}
	raw, merr := json.Marshal(v)
	if merr != nil {
		return fmt.Errorf("marshal binding expr: %w", merr)
	}
	*j = jsonataSrc(raw)
	return nil
}

// CategoryContractOps — the method names each category's contract "must map in full". Assembly
// time uses this to judge whether a binding is missing a mapping. calendar must be able to
// query busy times + create an event (booking); cancel_event is optional (a connector may not
// support cancellation, and mapping it anyway is tolerated).
var CategoryContractOps = map[string][]string{
	"calendar": {"list_busy", "create_event"},
	"mail":     {"send"},
}

// opBinding — one mapping from a contract method to a SaaS operation, plus three (compiled)
// JSONata segments.
//
// Why Query exists: **some SaaS APIs put half of the action in query parameters, not in the
// request body.** Google Calendar's "notify attendees" is exactly `?sendUpdates=all` — both
// creating and cancelling an event depend on it. This slot didn't used to exist: opBinding
// only had op/request/response, and the path did nothing but {param} substitution, so when
// the connector was externalized (#155) that switch had nowhere to live and was silently
// dropped, even though the contract's own comment still said it notified attendees. Whatever
// the binding language cannot express doesn't error out on migration — it just vanishes
// (F-B-7 / [[externalize-is-not-relocate]]).
type opBinding struct {
	reqExpr   *jsonata.Expr
	respExpr  *jsonata.Expr
	queryExpr *jsonata.Expr
	Op        string     `yaml:"op"`
	Request   jsonataSrc `yaml:"request"`
	Response  jsonataSrc `yaml:"response"`
	// Query — evaluates to an object: keys are query parameter names, values are scalars.
	// Keys whose value is null / an empty string are dropped, so "include this parameter
	// only conditionally" can just be written as a JSONata ternary.
	Query jsonataSrc `yaml:"query"`
}

// Binding — a complete binding: declares the category + the mapping for each contract method.
type Binding struct {
	Operations map[string]opBinding `yaml:"operations"`
	Category   string               `yaml:"category"`
	Kind       string               `yaml:"kind"`
}

// ParseBinding — parses the binding source (YAML) + compiles all JSONata on the spot (a
// syntax error is rejected immediately).
func ParseBinding(raw []byte) (*Binding, error) {
	var b Binding
	if err := yaml.Unmarshal(raw, &b); err != nil {
		return nil, fmt.Errorf("parse binding: %w", err)
	}
	for name, ob := range b.Operations {
		if err := compileOpBinding(&ob); err != nil {
			return nil, fmt.Errorf("%w: operation %q: %s", ErrBindingBadJSONata, name, err.Error())
		}
		b.Operations[name] = ob
	}
	return &b, nil
}

func compileOpBinding(ob *opBinding) error {
	slots := []struct {
		dst  **jsonata.Expr
		name string
		src  jsonataSrc
	}{
		{&ob.reqExpr, "request", ob.Request},
		{&ob.respExpr, "response", ob.Response},
		{&ob.queryExpr, "query", ob.Query},
	}
	for _, s := range slots {
		if s.src == "" {
			continue
		}
		e, err := jsonata.Compile(string(s.src))
		if err != nil {
			return fmt.Errorf("%s: %w", s.name, err)
		}
		*s.dst = e
	}
	return nil
}

// ValidateAgainst — checks the binding is self-consistent with the spec: category is known,
// every op exists in the spec, and every required contract method is mapped.
func (b *Binding) ValidateAgainst(spec *Spec) error {
	required, known := CategoryContractOps[b.Category]
	if !known {
		return fmt.Errorf("%w: %q", ErrBindingUnknownCategory, b.Category)
	}
	if err := b.checkOpsInSpec(spec); err != nil {
		return err
	}
	return b.checkComplete(required)
}

func (b *Binding) checkOpsInSpec(spec *Spec) error {
	specOps := spec.operationIDs()
	for name, ob := range b.Operations {
		if _, ok := specOps[ob.Op]; !ok {
			return fmt.Errorf("%w: %q → %q", ErrBindingUnknownOp, name, ob.Op)
		}
	}
	return nil
}

func (b *Binding) checkComplete(required []string) error {
	for _, req := range required {
		if _, ok := b.Operations[req]; !ok {
			return fmt.Errorf("%w: %q missing %q", ErrBindingIncomplete, b.Category, req)
		}
	}
	return nil
}

// evalRequest — renders the request body from contract input (already in JSON shape).
// No request JSONata → nil (no body).
func (ob *opBinding) evalRequest(input any) (any, error) {
	if ob.reqExpr == nil {
		return nil, nil
	}
	out, err := ob.reqExpr.Eval(input)
	if err != nil {
		return nil, fmt.Errorf("eval request jsonata: %w", err)
	}
	return out, nil
}

// evalQuery — renders query parameters from contract input. No query JSONata → empty
// (no parameters attached).
func (ob *opBinding) evalQuery(input any) (map[string]any, error) {
	if ob.queryExpr == nil {
		return map[string]any{}, nil
	}
	out, err := ob.queryExpr.Eval(input)
	if err != nil {
		return nil, fmt.Errorf("eval query jsonata: %w", err)
	}
	m, ok := out.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: query must evaluate to an object", ErrBindingBadJSONata)
	}
	return m, nil
}

// evalResponse — extracts contract output from the SaaS response. No response JSONata →
// unchanged.
func (ob *opBinding) evalResponse(resp any) (any, error) {
	if ob.respExpr == nil {
		return resp, nil
	}
	out, err := ob.respExpr.Eval(resp)
	if err != nil {
		return nil, fmt.Errorf("eval response jsonata: %w", err)
	}
	return out, nil
}
