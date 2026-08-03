// genres.go —— 这个域有哪几个 genre,以及每条口收哪几个。
//
// 拆出来是因为**这件事被答错过**:subjectivity 曾经在三处白名单里各自缺席 —— corpus.get
// 拒绝它(错误信息还写着 "genre must be 'raw', 'wiki' or 'output'",一句否认它存在的话)、
// assets.upload 拒绝它、corpus.delete 那边则手写了一个 `if genre != subjectivity` 绕开检查。
// 三处各自回答"哪些 genre 算数",于是同一个 genre 在写口、读口、删口上是三个不同的答案。
//
// 现在只有这一处回答。加一个 genre,改这里;某条口要收得更窄,在这里写清楚为什么。

package ops

import (
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// 四个 genre —— 每个面用同一套词。
const (
	genreRaw    = "raw"
	genreWiki   = "wiki"
	genreOutput = "output"
	// genreSubjectivity —— 自我模型。**写口是另一条**(subjectivity.go:那是 owner 跟自己的
	// AI 边想边写的,不填表单),所以它不在 requireGenre 里;读 / 删 / 挂素材跟其余三个同路。
	genreSubjectivity = "subjectivity"
)

// requireGenre —— corpus.create / corpus.update 收哪几个。subjectivity 不在其中:
// 它有自己的写口,不是"漏了"。
func requireGenre(genre string) error {
	switch genre {
	case genreRaw, genreWiki, genreOutput:
		return nil
	default:
		return unknownGenre("genre must be 'raw', 'wiki' or 'output'")
	}
}

// requireReadableGenre —— 读得到、删得掉的 genre:**四个都算**。
// corpus.get / corpus.delete / assets.* 用它。
func requireReadableGenre(genre string) error {
	switch genre {
	case genreRaw, genreWiki, genreOutput, genreSubjectivity:
		return nil
	default:
		return unknownGenre("genre must be 'raw', 'wiki', 'output' or 'subjectivity'")
	}
}

func unknownGenre(msg string) error {
	return fp.Coded(fp.NotFound(msg), "unknown_genre")
}
