package corpus

import "github.com/atmaxmoj/standmeet/internal/corpus/entity"

// 类型（实现:entity）.
type (
	Asset         = entity.Asset
	Document      = entity.Document
	DocumentGenre = entity.DocumentGenre
	Output        = entity.Output
	Raw           = entity.Raw
	SEOSettings   = entity.SEOSettings
	Wiki          = entity.Wiki
	Writing       = entity.Writing
)

// 构造/函数（实现:entity）.
var FormatURI = entity.FormatURI

// 常量（实现:entity）.
const (
	GenreOutput              = entity.GenreOutput
	GenreSubjectivity        = entity.GenreSubjectivity
	GenreWiki                = entity.GenreWiki
	GenreWriting             = entity.GenreWriting
	WritingCoverHueAcid      = entity.WritingCoverHueAcid
	WritingCoverHueAmber     = entity.WritingCoverHueAmber
	WritingCoverHueViolet    = entity.WritingCoverHueViolet
	WritingVisibilityPrivate = entity.WritingVisibilityPrivate
	WritingVisibilityPublic  = entity.WritingVisibilityPublic
)

// 错误/变量（实现:entity）.
var (
	ErrOutputNotFound       = entity.ErrOutputNotFound
	ErrParentCycle          = entity.ErrParentCycle
	ErrParentNotFound       = entity.ErrParentNotFound
	ErrRawNotFound          = entity.ErrRawNotFound
	ErrSiblingSlugTaken     = entity.ErrSiblingSlugTaken
	ErrSubjectivityNotFound = entity.ErrSubjectivityNotFound
	ErrWikiNotFound         = entity.ErrWikiNotFound
	ErrWritingNotFound      = entity.ErrWritingNotFound
	ErrWritingSlugTaken     = entity.ErrWritingSlugTaken
)
