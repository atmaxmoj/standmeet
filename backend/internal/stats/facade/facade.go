// Package stats -- the external facade for the observation/stats domain (activity / growth /
// inference-usage / jobs metering on the Monitor surface). A thin layer that lifts the internal
// sub-packages' types/constructors up; other layers only import this facade package. The
// implementation lives in sibling sub-packages internal/stats/{entity,repo,db}, and
// check-domain-facade-boundary blocks direct external import of those.
//
// # External contract
//
//   - entity: Activity / Growth / InferenceUsage / SystemInfo / job-source registry, etc. --
//     read-model value objects
//   - repo: PG query repos for activity / growth / inference-usage
package stats
