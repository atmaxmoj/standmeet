package paritymanifest

// apiKeyEntries —— the API-key facade's owner-side management (issue / list / revoke / edit +
// per-key narrowing + the candidate switch for opening to the api facade) has moved into the
// access domain's own declaration (internal/access/ops), and the facade reads it from the
// convergence point.
//
// So this table no longer needs a row for them: the decision "MCP-only", along with its
// rationale, lives in that declaration's Reach, reconciled at boot by dispatcher.Conform() —
// this is exactly how this package is meant to eventually disappear.
func apiKeyEntries() []Entry {
	return []Entry{}
}
