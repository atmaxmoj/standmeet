// Package owner —— the owner (instance owner) domain's outward-facing facade. A thin layer
// that lifts the types/constructors/usecases from internal sub-packages up to this level;
// other layers only import this facade package. Implementation lives in sibling sub-packages
// internal/owner/{entity,repo,usecase,db} (plus the jobs sub-domain); check-domain-facade-boundary
// blocks external code from reaching the guts directly.
//
// # Outward protocol
//
//   - Entities (entity): Owner / InstanceSettings / Microsite / PageContent / Prompt / Keypair /
//     Err* domain errors + prompt fragment loading
//   - Repos (repo): Repo / InstanceRepo / MicrositeRepo / KeypairRepo / PromptRepo + write inputs
//   - Usecases (usecase): account / login / claim / handle / domains / recovery / outbound notify /
//     ai-provider / byoai / prompts / microsite / page(+pins) / seo / css / wiki-tree app flows
package owner
