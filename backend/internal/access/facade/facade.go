// Package access —— the outward facade for the visitor-access domain. A thin layer that only
// lifts internal subpackages' types/constructors/use cases up so the whole protocol is visible
// at a glance; every other layer imports only this facade package and uses only these symbols.
// The implementation lives in sibling subpackages internal/access/{entity,repo,usecase,db},
// and check-domain-facade-boundary blocks external code from importing them directly.
//
// # Public protocol
//
// Entities / value objects (impl: entity) ——
//   - Code (access code = invitation) · CodeMember (one code, multiple members) ·
//     CreateAccessCodeInput
//   - Request (codeless request) · CreateAccessRequestInput · APIKey (BYOAI key) +
//     Create/UpdateAPIKeyInput
//   - Role + RoleSnapshot (ACL snapshot) · CorpusScope (article-read grant) · DockButtonConfig ·
//     Waypoint
//   - AllowsCorpusScope / MergeWaypoints / ValidateWaypoints / ValidateDockButtons and other
//     pure functions
//   - Public* built-in role constants · Err* (domain error sentinels)
//
// Repositories (impl: repo) ——
//   - RoleRepo / CodeRepo / APIKeyRepo / CapabilityRepo / CodeDenialRepo / RequestRepo + their
//     New* constructors
//   - CreateCodeInput / CreateRoleInput / UpdateRoleInput / UpsertBuiltinInput (write inputs)
//
// Use cases / orchestration (impl: usecase) ——
//   - role: Create/Update/Delete/Get/ListRoles + SetRoleDockButtons (over RolesDeps)
//   - request: SubmitForOwner / ListForOwner / UpdateAccessRequestStatus (over RequestsDeps)
//   - api key: IssueAPIKey / ResolveAPIKey (over a narrow store port)
//   - visitor session: NewVisitorSessionStore / VisitorSessionStore / VisitorSessionData
//   - RefValidator / SoleOwnerLookup and other narrow consumer ports used when writing a role
//
// New capability: implement it in the matching subpackage, then add one forwarding line here.
package access
