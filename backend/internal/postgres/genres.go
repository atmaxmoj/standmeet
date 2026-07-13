// genres.go —— corpus_notes.genre 的四个判别值的**唯一定义处**。四 genre 平级(raw /
// wiki / output / writing),放一起只是同一个枚举的一处来源,彼此没有特别的分组/配对关系。
// (之前散在 wiki.go / output.go / corpus_tree.go 三处,还误导性地把 raw+writing 凑一块。)

package postgres

const (
	genreRaw     = "raw"
	genreWiki    = "wiki"
	genreOutput  = "output"
	genreWriting = "writing"
)
