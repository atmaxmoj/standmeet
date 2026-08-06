// corpus_i18n.go —— 多语结构在写入口的那道门,以及不写只看的那件工具。
//
// 两个入口两种脾气(设计里定的):
//   - **MCP 写入拒绝**。agent 拿到错误可以改了重来,而一条坏掉的多语笔记会在读者面前
//     少半篇内容 —— 那半篇没有任何提示。
//   - **vault 同步照收**(见 obsidian 那侧)。它是镜像:拒收等于 owner 丢内容。
//
// 怎么改这件事写在**错误里**,不写在工具描述里:描述每次调用都要付钱,而且经常被略过;
// 错误只在出事时出现,而且出现在最需要它的那一刻。

package ops

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/i18n"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// i18nMinimalExample —— 错误里附的那份可抄的最小形式。frontmatter 一个字都不需要。
//
//nolint:gosmopolitan // 示例里的中文那一面是这份契约的一半
const i18nMinimalExample = "> [!i18n]\n" +
	"> > [!lang] en\n" +
	"> > # Title\n" +
	"> > English body.\n" +
	">\n" +
	"> > [!lang] zh\n" +
	"> > # 标题\n" +
	"> > 中文正文。"

// guardI18n —— 正文的多语结构过一遍。有 error 级诊断 → 拒绝,并把每一条 + 一份最小示例
// 交给调用方。warning 不拦(翻译质量的事不该挡住一次写入)。
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

// I18nOps —— 只看不写:agent 在写之前先问一次,拿到的诊断跟写入口是同一份。
//
// 两处各写一套判断的话,"检查通过了但写不进去"这种事迟早出现,而那时候 agent 只会重试。
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

// i18nCheckOut —— 出站:能不能写、有哪些诊断、解析出了哪些语言。
// languages 是**解析出来的**那些,不是声明的 —— agent 想知道"我写的这几面到底认出来没有"。
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
