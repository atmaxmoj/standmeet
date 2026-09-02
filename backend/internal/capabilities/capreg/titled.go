// titled.go —— the pass-through interface for the #109/#110 dock button label.

package capreg

// Titled —— optional interface: a capability exposes a human-readable title
// (the MCP-standard title/annotations.title). A capability that implements it
// has the title passed through into CapabilityState.Title; not implementing it
// leaves that field empty (no id fallback).
type Titled interface {
	Title() string
}
