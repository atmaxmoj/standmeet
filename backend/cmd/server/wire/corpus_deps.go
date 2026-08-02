// corpus_deps.go —— corpus 域的依赖包,组装根这边只建一次。
//
// 它以前在三处各拼一份(owner-MCP 的 deps、admin 的 deps、收口的适配器),字段一多就会
// 出现"这份少接了一个 repo"的差别 —— 那种差别编译不报,只在运行时表现成某个功能悄悄不工作。

package wire

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

func corpusDepsOf(d *deps.Runtime) corpus.Deps {
	return corpus.Deps{
		Raw: d.RawRepo, Wiki: d.WikiRepo, Output: d.OutputRepo, NoteRefs: d.NoteRefRepo,
		Subjectivity: d.SubjectivityRepo, Index: d.CorpusIndexer,
	}
}
