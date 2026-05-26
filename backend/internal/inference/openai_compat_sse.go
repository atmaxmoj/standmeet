// openai_compat_sse.go —— OpenAI Chat Completions streaming SSE 解析。
//
// Wire 形态：
//   data: {"id":"...","choices":[{"delta":{"content":"hi"},"finish_reason":null}]}
//   data: {"id":"...","choices":[{"delta":{"content":" world"},"finish_reason":null}]}
//   ...
//   data: {"id":"...","choices":[{"delta":{},"finish_reason":"stop"}]}
//   data: [DONE]
//
// 我们只关心 choices[0].delta.content（流式文本）。tool_calls 走 non-stream
// path（runToolLoop），不在这里解析。

package inference

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type oaSSEChunk struct {
	ID      string        `json:"id"`
	Object  string        `json:"object"`
	Choices []oaSSEChoice `json:"choices"`
}

type oaSSEChoice struct {
	Delta        oaSSEDelta `json:"delta"`
	FinishReason string     `json:"finish_reason"`
	Index        int        `json:"index"`
}

type oaSSEDelta struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// parseOpenAISSE —— 读 SSE 流到 [DONE] 或 EOF；text deltas 实时 emit。
// emit Done 后关闭 channel。
func parseOpenAISSE(body io.ReadCloser, out chan<- Chunk) {
	defer closeBody(body)
	defer close(out)
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, openAIStreamBufBytes), openAIStreamBufBytes)
	for sc.Scan() {
		if stopped := handleSSELine(sc.Text(), out); stopped {
			return
		}
	}
	if serr := sc.Err(); serr != nil {
		out <- Chunk{Error: fmt.Errorf("openai sse scan: %w", serr)}
	}
}

// handleSSELine —— 一行 SSE：非 data 行 / 空 data 跳过；data 解析后路由
// 到 emitOpenAIEvent。返 true 表流终止。
func handleSSELine(line string, out chan<- Chunk) bool {
	if !strings.HasPrefix(line, sseDataPrefix) {
		return false
	}
	data := strings.TrimSpace(strings.TrimPrefix(line, sseDataPrefix))
	if data == "" {
		return false
	}
	return !emitOpenAIEvent(data, out)
}

// emitOpenAIEvent —— 一行 data 解码 + 翻译。返 false 表流终止。
// [DONE] 终结符 → emit Done 退出。
func emitOpenAIEvent(data string, out chan<- Chunk) bool {
	if data == openAIDoneSentinel {
		out <- Chunk{Done: true}
		return false
	}
	var ev oaSSEChunk
	if err := json.Unmarshal([]byte(data), &ev); err != nil {
		return true // schema 不识别跳过；OpenAI 偶发 ping / keepalive
	}
	if len(ev.Choices) == 0 {
		return true
	}
	if text := ev.Choices[0].Delta.Content; text != "" {
		out <- Chunk{Text: text}
	}
	return true
}
