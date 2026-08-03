// genres.go —— 这个域有哪几个 genre。**只有一处回答。**
//
// 拆出来是因为这件事被答错过:subjectivity 曾经在三处白名单里各自缺席 —— corpus.get
// 拒绝它(错误信息还写着 "genre must be 'raw', 'wiki' or 'output'",一句否认它存在的话)、
// assets.upload 拒绝它、corpus.delete 那边则手写了一个 `if genre != subjectivity` 绕开检查。
// 三处各自回答"哪些 genre 算数",于是同一个 genre 在写口、读口、删口上是三个不同的答案。
//
// 后来还剩最后一处不一致:写口只认三个,理由是"自我模型是边想边写出来的,不是填出来的"。
// 那是一句被写进代码的偏好,不是产品决定 —— owner 说了它要跟别的 genre 一样。于是
// **读、写、删、挂素材现在是同一份名单**,这个文件只需要一个函数。
//
// 加一个 genre:改这里。某条口真要收得更窄,在这里写清楚为什么 —— 而不是在那条口自己
// 的 switch 里悄悄少写一个 case。

package ops

import (
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// 四个 genre —— 每个面、每条口用同一套词。
const (
	genreRaw          = "raw"
	genreWiki         = "wiki"
	genreOutput       = "output"
	genreSubjectivity = "subjectivity"
)

// requireGenre —— 这个域认哪几个 genre。读 / 写 / 删 / 挂素材共用。
func requireGenre(genre string) error {
	switch genre {
	case genreRaw, genreWiki, genreOutput, genreSubjectivity:
		return nil
	default:
		return fp.Coded(
			fp.NotFound("genre must be 'raw', 'wiki', 'output' or 'subjectivity'"),
			"unknown_genre")
	}
}
