package inference

import "github.com/cloudwego/eino/schema"

// stripReasoningContent —— removes ReasoningContent (serialized as `reasoning_content`) from
// OUTBOUND messages. Reasoning models (e.g. Groq gpt-oss-*) RETURN reasoning_content; echoing it
// back on a later turn's assistant message makes strict OpenAI-compatible endpoints reject the
// request — Groq: `400 property 'reasoning_content' is unsupported`. Like ensureMessageContent,
// this belongs at the wire boundary, once (both Generate and Stream). Copy-on-write.
func stripReasoningContent(input []*schema.Message) []*schema.Message {
	out := input
	copied := false
	for i, msg := range input {
		if msg == nil || msg.ReasoningContent == "" {
			continue
		}
		if !copied {
			out = make([]*schema.Message, len(input))
			copy(out, input)
			copied = true
		}
		clone := *msg
		clone.ReasoningContent = ""
		out[i] = &clone
	}
	return out
}
