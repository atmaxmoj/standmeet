// genres.go —— corpus_notes.genre 的五个判别值的**唯一定义处**。五 genre 平级(raw / wiki /
// output / writing / subjectivity),放一起只是同一个枚举的一处来源,彼此没有特别的分组/配对关系。
// (之前散在 wiki.go / output.go / corpus_tree.go 三处,还误导性地把 raw+writing 凑一块。)
//
// 与 corpus.DocumentGenre 逐字对齐。subjectivity 之前不在这里 —— 这层就"少了一个 genre",
// 于是它没有 tree、没有 admin 列表,owner 连自己的 CV 在哪都看不见(F-A-15)。

package postgres

const (
	genreRaw          = "raw"
	genreWiki         = "wiki"
	genreOutput       = "output"
	genreWriting      = "writing"
	genreSubjectivity = "subjectivity"
)
