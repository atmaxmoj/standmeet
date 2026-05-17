// factory.go —— 按 env 选 provider 实例。M6 只挂 mock；Anthropic / OpenAI
// 客户端在 M6 之后按需补（接口已定，实现替换就行）。

package inference

import (
	"fmt"
	"os"
)

// NewFromEnv 按 INFERENCE_PROVIDER 选 provider。
// 支持：mock（默认）。Anthropic / OpenAI 后续 milestone 添加。
// 返回 *MockProvider 具体类型让 ireturn 不抓；caller 持有时按 Provider 接口用即可
// （Go 鸭子类型，无需显式 cast）。
func NewFromEnv() (*MockProvider, error) {
	name := os.Getenv("INFERENCE_PROVIDER")
	if name == "" {
		name = "mock"
	}
	if name == "mock" {
		return NewMockProvider(), nil
	}
	return nil, fmt.Errorf("unsupported INFERENCE_PROVIDER=%q (mock|anthropic|openai)", name)
}
