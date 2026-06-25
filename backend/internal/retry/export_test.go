package retry

import (
	"context"
	"time"
)

// WithClock —— test-only seam：把假 sleep / now 注入一份 Policy（退避不真睡 + 时钟可控，
// 让重试测试确定性）。这两个字段对 prod 保持未导出，只经本 export_test.go 暴露给外部
// retry_test 包。
func WithClock(
	p Policy,
	sleep func(context.Context, time.Duration) error,
	now func() time.Time,
) Policy {
	p.sleep = sleep
	p.now = now
	return p
}
