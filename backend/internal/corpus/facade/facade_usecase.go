package corpus

import (
	"github.com/atmaxmoj/standmeet/internal/corpus/i18n"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
)

// 类型（实现:usecase）.
type (
	AssetsDeps                      = usecase.AssetsDeps
	NoteAssetsDeps                  = usecase.NoteAssetsDeps
	NoteMediaView                   = usecase.NoteMediaView
	AssetView                       = usecase.AssetView
	CreateOutputReq                 = usecase.CreateOutputReq
	CreateWikiReq                   = usecase.CreateWikiReq
	CrossLinkQueryDeps              = usecase.CrossLinkQueryDeps
	Deps                            = usecase.Deps
	Entry                           = usecase.Entry
	FileInput                       = usecase.FileInput
	GrepHit                         = usecase.GrepHit
	GrepLine                        = usecase.GrepLine
	GrepRequest                     = usecase.GrepRequest
	I18nView                        = usecase.I18nView
	IndexDeps                       = usecase.IndexDeps
	Indexer                         = usecase.Indexer
	Links                           = usecase.Links
	SoleOwnerID                     = usecase.SoleOwnerID
	ListPublishedWritingsPageInput  = usecase.ListPublishedWritingsPageInput
	ListPublishedWritingsPageResult = usecase.ListPublishedWritingsPageResult
	MapEntry                        = usecase.MapEntry
	Meta                            = usecase.Meta
	OptionalFlag                    = usecase.OptionalFlag
	OptionalText                    = usecase.OptionalText
	OptionalTextList                = usecase.OptionalTextList
	OutputLister                    = usecase.OutputLister
	PromoteInput                    = usecase.PromoteInput
	PromoteToOutputInput            = usecase.PromoteToOutputInput
	RawDumpInput                    = usecase.RawDumpInput
	RefResolver                     = usecase.RefResolver
	SEOSettingsPatch                = usecase.SEOSettingsPatch
	SaveWritingInput                = usecase.SaveWritingInput
	SubjectivityCiteLookup          = usecase.SubjectivityCiteLookup
	UpdateOutputReq                 = usecase.UpdateOutputReq
	UpdateRawReq                    = usecase.UpdateRawReq
	UpdateWikiReq                   = usecase.UpdateWikiReq
	WikiLister                      = usecase.WikiLister
	WikiPathTitle                   = usecase.WikiPathTitle
	WriteSubjectivityInput          = usecase.WriteSubjectivityInput
	WritingContext                  = usecase.WritingContext
	WritingLister                   = usecase.WritingLister
	WritingTreeNode                 = usecase.WritingTreeNode
	WritingsDeps                    = usecase.WritingsDeps
	WritingsTxDeps                  = usecase.WritingsTxDeps
)

// 构造/函数（实现:usecase）.
var (
	LoadNoteMedia               = usecase.LoadNoteMedia
	DeleteRaw                   = usecase.DeleteRaw
	CreateOutput                = usecase.CreateOutput
	CreateWiki                  = usecase.CreateWiki
	DBParentOf                  = usecase.DBParentOf
	DeleteOutput                = usecase.DeleteOutput
	DeleteSubjectivity          = usecase.DeleteSubjectivity
	DeleteWiki                  = usecase.DeleteWiki
	DeleteWritingWithAssets     = usecase.DeleteWritingWithAssets
	DeriveSentiment             = usecase.DeriveSentiment
	ExtractCrossLinks           = usecase.ExtractCrossLinks
	GetWritingBySlug            = usecase.GetWritingBySlug
	HasCrossLinks               = usecase.HasCrossLinks
	LeadLine                    = usecase.LeadLine
	ListAllWritings             = usecase.ListAllWritings
	ListBacklinks               = usecase.ListBacklinks
	ListPublishedWritings       = usecase.ListPublishedWritings
	ListPublishedWritingsPage   = usecase.ListPublishedWritingsPage
	LoadCrossLinkIndex          = usecase.LoadCrossLinkIndex
	NewCorpusIndexer            = usecase.NewCorpusIndexer
	NewSubjectivityCiteResolver = usecase.NewSubjectivityCiteResolver
	OutputEntryPath             = usecase.OutputEntryPath
	OutputMetaTreePaths         = usecase.OutputMetaTreePaths
	OutputPathByID              = usecase.OutputPathByID
	OutputTreePaths             = usecase.OutputTreePaths
	PatchSEOSettings            = usecase.PatchSEOSettings
	PathSegment                 = usecase.PathSegment
	PromoteToWiki               = usecase.PromoteToWiki
	PromoteWikiToOutput         = usecase.PromoteWikiToOutput
	PublishWriting              = usecase.PublishWriting
	PublishedAtRFC3339          = usecase.PublishedAtRFC3339
	RawDump                     = usecase.RawDump
	RawTreePaths                = usecase.RawTreePaths
	RebuildNoteRefs             = usecase.RebuildNoteRefs
	CorpusHostOps               = usecase.CorpusHostOps
	CorpusHostOpsFor            = usecase.CorpusHostOpsFor
	NewRefResolver              = usecase.NewRefResolver
	IndexPeriodicJobs           = usecase.IndexPeriodicJobs
	ReindexCorpusNote           = usecase.ReindexCorpusNote
	ReindexCorpusOwner          = usecase.ReindexCorpusOwner
	ResolveAssetURLs            = usecase.ResolveAssetURLs
	CompileGrep                 = usecase.CompileGrep
	I18nViewFor                 = usecase.ViewFor
	// I18nLabel —— 切换器上一个语言码显示成什么(owner 的 lang-labels 优先)。
	I18nLabel                      = i18n.Label
	GrepBody                       = usecase.GrepBody
	ResolveByName                  = usecase.ResolveByName
	ResolveWikiNodeID              = usecase.ResolveWikiNodeID
	RewriteCrossLinksForRender     = usecase.RewriteCrossLinksForRender
	RewriteWikiCrossLinksForRender = usecase.RewriteWikiCrossLinksForRender
	SaveWriting                    = usecase.SaveWriting
	SlugifyTitle                   = usecase.SlugifyTitle
	SyncNotePath                   = usecase.SyncNotePath
	UnpublishWriting               = usecase.UnpublishWriting
	UpdateOutput                   = usecase.UpdateOutput
	UpdateRaw                      = usecase.UpdateRaw
	UpdateWiki                     = usecase.UpdateWiki
	WikiEntryPath                  = usecase.WikiEntryPath
	WikiMetaPathTitleIndex         = usecase.WikiMetaPathTitleIndex
	WikiMetaTreePaths              = usecase.WikiMetaTreePaths
	WikiPathByID                   = usecase.WikiPathByID
	WikiTreePaths                  = usecase.WikiTreePaths
	WriteSubjectivity              = usecase.WriteSubjectivity
	WritingAssetIDs                = usecase.WritingAssetIDs
	WritingNodeContext             = usecase.WritingNodeContext
	WritingTreeChildren            = usecase.WritingTreeChildren
)

// 常量（实现:usecase）.
const TreeMaxDepth = usecase.TreeMaxDepth

// 错误/变量（实现:usecase）.
var (
	ErrCorpusDenied   = usecase.ErrCorpusDenied
	ErrCorpusNotFound = usecase.ErrCorpusNotFound
)
