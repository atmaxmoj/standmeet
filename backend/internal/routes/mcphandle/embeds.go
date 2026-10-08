// embeds.go —— an op result's `_embeds` (facadeparity.Invoke) go out as embedded resources after
// the text block; the text no longer carries them.

package mcphandle

import (
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// successOf —— an op's result as the MCP success. A result without `_embeds` is untouched.
func successOf(out json.RawMessage) registry.MCPResult {
	split, err := fp.SplitEmbeds(out)
	if err != nil {
		return registry.MCPError(err.Error())
	}
	embeds := make([]registry.MCPEmbedded, 0, len(split.Embeds))
	for _, e := range split.Embeds {
		embeds = append(embeds,
			registry.MCPEmbedded{URI: e.URI, MIMEType: e.MIMEType, Blob: e.Blob})
	}
	return registry.MCPSuccessWithEmbeddings(split.Text, embeds)
}
