// Package corpus — the outward-facing facade for the corpus domain. A thin layer that
// re-exports internal sub-package types/constructors/usecases so the whole protocol is
// visible at a glance; every other layer imports only this facade package. Implementation
// lives in the sibling sub-packages internal/corpus/{entity,repo,usecase,db,search}, and
// check-domain-facade-boundary blocks outside code from importing them directly.
//
// # Outward-facing protocol
//
// Entities / value objects (implemented in: entity) —
//   - Raw / Wiki / Writing / Output / Asset / Content / Cover (each genre's aggregate + Init input)
//   - Document (the heterogeneous element dispatched by URI) · Visibility / URIRef / TreeNode /
//     Timestamps / SEOSettings
//   - Genre* constants · Visibility*/CoverHue* enums · Err* (domain error sentinels) ·
//     ParseURI / FormatURI
//
// Repositories (implemented in: repo) —
//   - Per-genre Repo (Wiki/Output/Writing/Raw/Asset/Note …) + tree / ref / vault-sync / seo
//     queries
//   - TreeChild[T], Note, and their Create/Update input types, plus other persistence-layer
//     types
//
// Usecases / orchestration (implemented in: usecase) —
//   - CorpusLister + read ports (WikiLister/OutputLister/WritingLister, satisfied structurally
//     by repo)
//   - corpus map / tree / crosslink / index (Meili) / writings CRUD / assets / note nav and
//     other application flows
//   - sentiment / subjectivity (#135 leftover capability still awaiting externalization,
//     kept in usecase for now)
//
// New capability: implement it in the matching sub-package, then add one forwarding line here.
package corpus
