package corpus

import "github.com/atmaxmoj/standmeet/internal/corpus/repo"

// Types (implemented in: repo).
type (
	AssetRepo           = repo.AssetRepo
	NoteHeroRepo        = repo.NoteHeroRepo
	Corpus              = repo.Corpus
	CreateSyncNoteInput = repo.CreateSyncNoteInput
	Note                = repo.Note
	NoteRef             = repo.NoteRef
	NoteRefRepo         = repo.NoteRefRepo
	NoteRepo            = repo.NoteRepo
	OutputMeta          = repo.OutputMeta
	OutputRepo          = repo.OutputRepo
	PageCursor          = repo.PageCursor
	PublishedCounts     = repo.PublishedCounts
	RawRepo             = repo.RawRepo
	SEORepo             = repo.SEORepo
	SlugTitle           = repo.SlugTitle
	SyncNote            = repo.SyncNote
	TreeChild[T any]    = repo.TreeChild[T]
	UpdateSyncNoteInput = repo.UpdateSyncNoteInput
	VaultSyncRepo       = repo.VaultSyncRepo
	WikiCard            = repo.WikiCard
	WikiMeta            = repo.WikiMeta
	WikiRepo            = repo.WikiRepo
	WikiStats           = repo.WikiStats
	WritingRefRepo      = repo.WritingRefRepo
	WritingRepo         = repo.WritingRepo
)

// Constructors/functions (implemented in: repo).
var (
	NewAssetRepo      = repo.NewAssetRepo
	NewNoteHeroRepo   = repo.NewNoteHeroRepo
	NewCorpus         = repo.NewCorpus
	NewNoteRefRepo    = repo.NewNoteRefRepo
	NewNoteRepo       = repo.NewNoteRepo
	NewOutputRepo     = repo.NewOutputRepo
	NewRawRepo        = repo.NewRawRepo
	NewSEORepo        = repo.NewSEORepo
	NewVaultSyncRepo  = repo.NewVaultSyncRepo
	NewWikiRepo       = repo.NewWikiRepo
	NewWritingRefRepo = repo.NewWritingRefRepo
	NewWritingRepo    = repo.NewWritingRepo
)

// Errors/variables (implemented in: repo).
var ErrSyncNoteNotFound = repo.ErrSyncNoteNotFound
