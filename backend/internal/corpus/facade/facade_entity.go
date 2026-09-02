package corpus

import "github.com/atmaxmoj/standmeet/internal/corpus/entity"

// Types (implemented in: entity).
type (
	Asset         = entity.Asset
	NoteHero      = entity.NoteHero
	Document      = entity.Document
	DocumentGenre = entity.DocumentGenre
	Output        = entity.Output
	Raw           = entity.Raw
	SEOSettings   = entity.SEOSettings
	Wiki          = entity.Wiki
	Writing       = entity.Writing
)

// Constructors/functions (implemented in: entity).
var FormatURI = entity.FormatURI

// Constants (implemented in: entity).
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

// Errors/variables (implemented in: entity).
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
