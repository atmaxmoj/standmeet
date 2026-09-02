// Package conversation is the external facade for the conversation domain (visitor-AI
// dialog + records). It is a thin layer that lifts the internal sub-packages'
// types/constructors/usecases up; other layers import only this facade package. The
// implementation lives in the sibling sub-packages internal/conversation/{entity,repo,usecase,db}
// (plus the inference sub-module); check-domain-facade-boundary blocks outside code from
// reaching into the guts directly.
//
// # External contract
//
//   - Entities: Chat / Dialog / Message / Citation / ChatReport / Ghost / ChatMode …
//   - Repos: ChatRepo / ChatReportRepo / GhostRepo / AppStateRepo + query/write types
//   - Usecases: visitor chat orchestration (visitor chat / history / turn-quota /
//     role-snapshot / prompt) + conversation view + dialog + ghost policy/ledger +
//     summarize report (#135 externalization leftover)
//
// LLM calls / the agent loop live in the inference sub-module (its own boundary),
// not routed through this facade.
package conversation
