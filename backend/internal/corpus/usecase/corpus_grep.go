// corpus_grep.go —— 第二条检索路:字面 / 正则,never-miss。
//
// 隔壁 corpus_search 走 Meili:容错、前缀、瞬时,回答的是"关于 X 的笔记有哪些"。它有一件事
// 做不到,而且不是调参能解决的 —— 分词器切不出来的东西它就是找不到:词中间的一截、
// 紧贴标点的符号、跨过分词边界的中文双字。
//
// 这条路只回答一个问题:**这个模式出现在哪儿**。它不排序、不猜意图、不改写查询;它扫过每一条
// 有权看的语料,把匹配的行原样交出来。"在的一定能找到"在这里是算术,不是排名启发式 ——
// 也正因为如此,它不能有 LIMIT:一个上限会把这句话悄悄换成"通常能找到"。
//
// 两个工具都摆在 agent 面前,由它按问题挑。所以两句描述必须说出**不同的保证**;它们要是
// 互相靠拢,agent 就只能瞎选,never-miss 也就没人用得上了。

package usecase

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// ErrGrepPattern —— 模式编译不了。这是 owner/agent 写错了,不是故障:面上翻成一句人话,
// 而不是 500。
var ErrGrepPattern = errors.New("corpus: invalid search pattern")

// grepMaxLinesPerNote —— 一条笔记最多回几行。**这不是结果集的上限**:命中的笔记一条都不少,
// 少的只是同一条里重复的行。总匹配数照实报,agent 想看全就去 corpus_read。
const grepMaxLinesPerNote = 5

// grepLineWidth —— 一行最多回多少字符(超长行会把结果撑爆,而人和 agent 都只看得下一句)。
const grepLineWidth = 400

// GrepRequest —— 一次扫描的参数。
type GrepRequest struct {
	Pattern string
	// Fixed —— 把 Pattern 当字面量(内部 QuoteMeta)。找 "C++" / "a.b" 这种时用它。
	Fixed bool
	// CaseSensitive —— 默认不区分大小写(agent 拿到的多半是人说的词)。
	CaseSensitive bool
}

// GrepLine —— 一条命中行:行号(1 起)+ 行文。
type GrepLine struct {
	Text string
	No   int
}

// GrepHit —— 一条笔记里的全部命中。Total 是这条笔记里的匹配总数(Lines 可能被截断)。
type GrepHit struct {
	Path  string
	Title string
	Genre string
	Lines []GrepLine
	Total int
}

// CompileGrep —— 模式 → RE2。Fixed 时先 QuoteMeta,所以 "C++" 不会被当成正则。
func CompileGrep(req *GrepRequest) (*regexp.Regexp, error) {
	pat := req.Pattern
	if strings.TrimSpace(pat) == "" {
		return nil, fmt.Errorf("%w: the pattern is empty", ErrGrepPattern)
	}
	if req.Fixed {
		pat = regexp.QuoteMeta(pat)
	}
	if !req.CaseSensitive {
		pat = "(?i)" + pat
	}
	re, err := regexp.Compile(pat)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrGrepPattern, err.Error())
	}
	return re, nil
}

// GrepBody —— 一条正文里的命中行。纯函数:扫描面从哪来跟它无关,所以第二阶段换成索引
// 候选集之后,判定这一步一个字都不用改(那正是"索引只许更快"的意思)。
func GrepBody(re *regexp.Regexp, body string) ([]GrepLine, int) {
	lines := strings.Split(body, "\n")
	hits := make([]GrepLine, 0, grepMaxLinesPerNote)
	total := 0
	for i, line := range lines {
		// 数的是**出现次数**,不是命中的行数:一行里出现两次就是两次。字段叫 matches,
		// 那它就得是匹配的个数 —— 名字说一件事、值是另一件事,是这套代码里最难发现的一种错。
		n := len(re.FindAllStringIndex(line, -1))
		if n == 0 {
			continue
		}
		total += n
		if len(hits) < grepMaxLinesPerNote {
			hits = append(hits, GrepLine{No: i + 1, Text: clipLine(line)})
		}
	}
	return hits, total
}

func clipLine(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= grepLineWidth {
		return string(r)
	}
	return string(r[:grepLineWidth]) + "…"
}

// grepHitsHint —— 结果切片的初始容量。命中通常是个位数;猜大了浪费,猜小了多一次扩容,
// 两者都无所谓 —— 它跟"能找到多少条"没有任何关系(那个数没有上限)。
const grepHitsHint = 8

// Grep —— 扫描面 + 判定。pgCorpusLister 那份走 DB 一次取全,driver 那份走它自己的枚举。
func (l *pgCorpusLister) Grep(
	ctx context.Context, ownerID string, scope access.CorpusScope, req *GrepRequest,
) ([]GrepHit, error) {
	re, cerr := CompileGrep(req)
	if cerr != nil {
		return nil, cerr
	}
	notes, nerr := l.grepNotes(ctx, ownerID, scope, re)
	if nerr != nil {
		return nil, nerr
	}
	return append(notes, l.grepWritings(ctx, ownerID, scope, re)...), nil
}

// grepNotes —— vault 那三个 genre(wiki / output / subjectivity)一次取全再判。
func (l *pgCorpusLister) grepNotes(
	ctx context.Context, ownerID string, scope access.CorpusScope, re *regexp.Regexp,
) ([]GrepHit, error) {
	if l.queryRepo == nil {
		return []GrepHit{}, nil
	}
	rows, err := l.queryRepo.NotesWithBodies(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("grep corpus: %w", err)
	}
	out := make([]GrepHit, 0, grepHitsHint)
	for i := range rows {
		if hit, ok := grepNoteRow(&rows[i], scope, re); ok {
			out = append(out, hit)
		}
	}
	return out, nil
}

// grepNoteRow —— 一条 note 过 ACL + 判定。path 从 root→leaf 的标题段拼出来(跟别的读路一致)。
func grepNoteRow(
	row *repo.GrepNoteRow, scope access.CorpusScope, re *regexp.Regexp,
) (GrepHit, bool) {
	if len(row.PathTitles) == 0 {
		return GrepHit{}, false
	}
	path := strings.Join(row.PathTitles, "/")
	if !allowsCorpusURI(scope, row.Genre, path) {
		return GrepHit{}, false
	}
	lines, total := GrepBody(re, row.Body)
	if total == 0 {
		return GrepHit{}, false
	}
	return GrepHit{
		Path: path, Genre: row.Genre, Total: total, Lines: lines,
		Title: row.PathTitles[len(row.PathTitles)-1],
	}, true
}

// grepWritings —— writings 自成一 genre(不在 corpus_notes 里),所以单独扫一遍:
// 少扫这一张表,"每一条有权看的语料"就是句空话。
func (l *pgCorpusLister) grepWritings(
	ctx context.Context, ownerID string, scope access.CorpusScope, re *regexp.Regexp,
) []GrepHit {
	if l.writing == nil {
		return []GrepHit{}
	}
	rows, err := l.writing.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return []GrepHit{}
	}
	out := make([]GrepHit, 0, grepHitsHint)
	for i := range rows {
		if hit, ok := grepWritingRow(&rows[i], scope, re); ok {
			out = append(out, hit)
		}
	}
	return out
}

func grepWritingRow(
	row *entity.Writing, scope access.CorpusScope, re *regexp.Regexp,
) (GrepHit, bool) {
	p := row.Path()
	if !allowsCorpusURI(scope, "writing", p) {
		return GrepHit{}, false
	}
	lines, total := GrepBody(re, row.Body())
	if total == 0 {
		return GrepHit{}, false
	}
	return GrepHit{
		Path: p, Title: row.Title(), Genre: "writing", Total: total, Lines: lines,
	}, true
}
