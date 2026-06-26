package main

import (
	"context"
	"strings"
	"testing"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

// the tool echoes its args back as a JSON object (frontend dispatches by kind).
func TestAskVisitorHandler_EchoesArgs(t *testing.T) {
	req := mcpgo.CallToolRequest{}
	req.Params.Arguments = map[string]any{"question": "Which path?", "kind": "radio"}
	res, err := askVisitorHandler(context.Background(), req)
	if err != nil {
		t.Fatalf("handler err: %v", err)
	}
	txt := res.Content[0].(mcpgo.TextContent).Text
	if !strings.Contains(txt, `"question":"Which path?"`) ||
		!strings.Contains(txt, `"kind":"radio"`) {
		t.Fatalf("args not echoed: %s", txt)
	}
}

// the tool declares ReturnDirectly via _meta.
func TestAskVisitorTool_ReturnDirectlyMeta(t *testing.T) {
	tl := askVisitorTool()
	if tl.Meta == nil || tl.Meta.AdditionalFields["return_directly"] != true {
		t.Fatalf("expected _meta.return_directly=true, got %#v", tl.Meta)
	}
	if tl.Name != "ask_visitor" {
		t.Fatalf("tool name = %q, want ask_visitor", tl.Name)
	}
}

// the server owns its prompt fragment (instructions).
func TestInstructions_CarryPrompt(t *testing.T) {
	if !strings.Contains(instructions, "ask_visitor") ||
		!strings.Contains(instructions, "radio") {
		t.Fatal("instructions missing ask_visitor prompt content")
	}
}

// the ui:// card resource is self-contained HTML with the widget test hooks.
func TestUICardHandler_ServesWidget(t *testing.T) {
	contents, err := uiCardHandler(context.Background(), mcpgo.ReadResourceRequest{})
	if err != nil {
		t.Fatalf("card err: %v", err)
	}
	html := contents[0].(mcpgo.TextResourceContents).Text
	for _, want := range []string{
		"ask-visitor-card", "ask-visitor-question", "mcp-ui:submit", "mcp-ui:data",
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("card html missing %q", want)
		}
	}
}
