// mock.go —— MockProvider 给 e2e / dev 用，按 env 变量回放脚本。
// 启用：env INFERENCE_PROVIDER=mock + 可选 INFERENCE_MOCK_REPLY="..."（默认
// 回一段固定文本）。流式时按字符发 chunk，再发 Done。

package inference

import (
	"context"
	"os"
	"strings"
	"time"
)

const (
	defaultMockReply  = "Hello, this is sijie's AI. I'm running in mock mode for tests."
	mockChunkInterval = 5 * time.Millisecond
)

// MockProvider —— 不调外部 API 的回放 provider。
type MockProvider struct {
	reply string
}

// NewMockProvider 构造一个 MockProvider；reply 取 INFERENCE_MOCK_REPLY，
// 空则 defaultMockReply。
func NewMockProvider() *MockProvider {
	reply := os.Getenv("INFERENCE_MOCK_REPLY")
	if reply == "" {
		reply = defaultMockReply
	}
	return &MockProvider{reply: reply}
}

// Name —— provider 名字。
func (*MockProvider) Name() string { return "mock" }

// Stream —— 按字符（按 word 也可）发 chunk，模拟流式。
func (m *MockProvider) Stream(ctx context.Context, _ *ChatRequest) (<-chan Chunk, error) {
	ch := make(chan Chunk, len(m.reply)+1)
	go m.streamReply(ctx, ch)
	return ch, nil
}

func (m *MockProvider) streamReply(ctx context.Context, ch chan<- Chunk) {
	defer close(ch)
	words := strings.SplitAfter(m.reply, " ")
	for _, w := range words {
		select {
		case <-ctx.Done():
			return
		case <-time.After(mockChunkInterval):
		}
		ch <- Chunk{Text: w}
	}
	ch <- Chunk{Done: true}
}
