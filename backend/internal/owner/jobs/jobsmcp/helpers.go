// helpers.go —— J.3: small MCP helpers for the jobs plugin. JSON response
// wrapping now uses the shared capreg.MarshalResult (no more duplicating
// those 8 lines); only the jobs-specific time format constant lives here.

package jobsmcp

// mcpTimeFmt —— ISO-8601 UTC time format (Go reference layout).
const mcpTimeFmt = "2006-01-02T15:04:05Z"
