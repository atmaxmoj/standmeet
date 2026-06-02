// Package public —— /api/v1/* routes. visitor session issuance + chat
// stream proxy + per-tool dispatch + dialog/summary commit. Bearer
// token from /sessions response carries through every other endpoint.
// CORS is wide open by design (D.2: SDK embeds run from any origin).
package public
