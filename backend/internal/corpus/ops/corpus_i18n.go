// corpus_i18n.go — the gate on multilingual structure at the write entry point, plus the
// read-only check-without-writing tool.
//
// Two entry points, two different temperaments (by design):
//   - **MCP writes reject**. An agent that gets an error back can fix it and retry, while a
//     broken multilingual note leaves readers missing half the content — with no hint that
//     half is missing.
//   - **vault sync accepts as-is** (see the obsidian side). It's a mirror: refusing to
//     accept means the owner loses content.
//
// How to fix it is written **into the error**, not into the tool description: the
// description gets paid for on every call and is often skipped over anyway; the error only
// shows up when something's actually wrong, right when it's most needed.

package ops

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/i18n"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// i18nMinimalExample — the copy-pasteable minimal form attached to the error. No
// frontmatter needed at all.
//
//nolint:gosmopolitan // the Chinese side of the example is half of this contract
const i18nMinimalExample = "> [!i18n]\n" +
	"> > [!lang] en\n" +
	"> > # Title\n" +
	"> > English body.\n" +
	">\n" +
	"> > [!lang] zh\n" +
	"> > # 标题\n" +
	"> > 中文正文。"

// guardI18n — runs a body's multilingual structure through validation. Any error-level
// diagnostic → reject, handing every one of them plus a minimal example back to the
// caller. Warnings don't block (translation quality shouldn't hold up a write).
func guardI18n(body string) error {
	ds := i18n.Validate(nil, body)
	if !i18n.HasError(ds) {
		return nil
	}
	return fp.Coded(fp.BadInput(i18nRejection(ds)), "i18n_invalid")
}

func i18nRejection(ds []i18n.Diagnostic) string {
	lines := make([]string, 0, len(ds)+2)
	lines = append(lines, "this note's multilingual structure is not usable:")
	for i := range ds {
		if ds[i].Severity == i18n.SeverityError {
			lines = append(lines, "  · "+ds[i].Message)
		}
	}
	lines = append(lines, "the minimum form is:\n"+i18nMinimalExample)
	return strings.Join(lines, "\n")
}

// I18nOps — read-only, no write: an agent can ask before writing and gets back the exact
// same diagnostics the write entry point would produce.
//
// If the two places each had their own validation logic, "the check passed but the write
// still failed" would show up sooner or later, and at that point the agent can only retry
// blindly.
func I18nOps() []fp.Op {
	return []fp.Op{{
		ID: "corpus.check_i18n",
		Description: "Check a multilingual body WITHOUT writing anything: returns the same " +
			"diagnostics corpus.create / corpus.update would reject on, plus warnings they " +
			"tolerate. Call it before writing a note that has `> [!i18n]` panes.",
		InputSchema: i18nCheckSchema,
		Kind:        fp.Read,
		Reach:       fp.OwnerRead(),
		Invoke:      checkI18n(),
	}}
}

var i18nCheckSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"body":{"type":"string","description":"The markdown body to check."}},
	"required":["body"]
}`)

// i18nCheckOut — the outbound shape: whether it's writable, what diagnostics came up,
// and which languages parsed out. languages is what was **actually parsed**, not what was
// declared — the agent wants to know "did the panes I wrote actually get recognized".
type i18nCheckOut struct {
	Example     string            `json:"minimal_example,omitempty"`
	Diagnostics []i18n.Diagnostic `json:"diagnostics"`
	Languages   []string          `json:"languages"`
	Acceptable  bool              `json:"acceptable"`
}

func checkI18n() fp.Invoke {
	return func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var args struct {
			Body string `json:"body"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		ds := i18n.Validate(nil, args.Body)
		doc := i18n.Parse(args.Body)
		out := i18nCheckOut{
			Acceptable: !i18n.HasError(ds), Diagnostics: nonNilDiagnostics(ds),
			Languages: nonNilStrings(doc.Langs),
		}
		if !out.Acceptable {
			out.Example = i18nMinimalExample
		}
		return json.Marshal(out)
	}
}

func nonNilDiagnostics(ds []i18n.Diagnostic) []i18n.Diagnostic {
	if ds == nil {
		return []i18n.Diagnostic{}
	}
	return ds
}
