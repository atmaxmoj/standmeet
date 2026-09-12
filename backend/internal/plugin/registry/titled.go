// titled.go —— the pass-through interface for the #109/#110 dock button label.

package registry

// Titled —— optional interface: a block exposes a human-readable title
// (the MCP-standard title/annotations.title). A block that implements it
// has the title passed through into FiberState.Title; not implementing it
// leaves that field empty (no id fallback).
type Titled interface {
	Title() string
}
