// ghost.go —— ghost-steering facade alias。eval-harness 只 import agentcore(never internal/),
// 所以它引用的 ghost 帧类型要从这里过一手。

package agentcore

import "github.com/atmaxmoj/standmeet/internal/inference"

// GhostFrame is the single ghost-steering suggestion the loop emits after `done`.
// A driver's AgentSink.Ghost(*GhostFrame) receives it (eval captures it for gold).
type GhostFrame = inference.GhostFrame
