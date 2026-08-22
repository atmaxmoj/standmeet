// ingest.go —— #155 区 A：spec 摄入校验。owner 在 admin UI 贴/传一份 OpenAPI spec，这里给出
// 人类可读的接受/拒绝判定（再走绑定/装配）。复用 ParseSpec（同一个 3.0/3.1 parser，JSON+YAML），
// 叠加摄入特有的闸：尺寸上限、servers 必填、每个 operation 要有唯一 operationId、$ref 不得外部。
// 错误文案直接给 owner 看（不漏栈），故用普通 error 文本而非 sentinel。

package openapi

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strconv"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

// defaultMaxSpecBytes —— 摄入 spec 的尺寸上限的默认值（防超大/失控 spec）。
const defaultMaxSpecBytes = 2 << 20 // 2 MiB

// MaxSpecBytes —— 这台实例实际收多大的 spec。**owner 配得动**（`CONNECTOR_SPEC_MAX_BYTES`）。
//
// 为什么它不能是常量：这一节的导语邀请 owner「upload your own OpenAPI connector」，而真世界里
// 的厂商文档常常远超 2 MiB —— GitHub 自己发布的 `api.github.com.json` 是 **12 MB**，于是这个
// 产品对它最常见的一个 API 直接说「装不了」，而 owner 没有任何旋钮可拧（F-C-53）。
// 上限本身是对的（一份失控的文档不该拖垮实例），**「多大」是部署的事，不是编译期的事**。
// **名字必须以字面量出现在 `os.Getenv("…")` 里**：`check-knobs-reachable` 就是这么找旋钮的。
// 第一版写成 `envBytesOr("CONNECTOR_SPEC_MAX_BYTES", …)`（名字进了 helper 的参数），闸门当场
// 看不见它 —— 而那道闸今早才刚从「只扫 config.go」放宽。**加固过的闸门被下一个新写法绕开**，
// 所以取值的辅助函数只收**值**，不收 key。
var MaxSpecBytes = bytesOr(os.Getenv("CONNECTOR_SPEC_MAX_BYTES"), defaultMaxSpecBytes)

// bytesOr —— 把一个字节数环境变量的值读成正整数；空/非法/非正 → 用默认值。
// 非法值不静默吞：日志说一句再走默认（一个打错的旋钮不该把实例锁死在 0 上）。
func bytesOr(raw string, def int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		slog.Default().Warn("ignoring unusable CONNECTOR_SPEC_MAX_BYTES, using the default",
			"value", raw, "default", def)
		return def
	}
	return n
}

// ValidateIngest —— 校验一份待摄入的 spec，OK → 返回候选标题（info.title）；否则 → 人类可读 error。
func ValidateIngest(raw []byte) (string, error) {
	if len(raw) > MaxSpecBytes {
		return "", fmt.Errorf("spec is too large (over the %d MiB size limit)", MaxSpecBytes>>20)
	}
	spec, err := ParseSpec(raw)
	if err != nil {
		return "", ingestParseError(err)
	}
	if cerr := checkIngestSemantics(spec, raw); cerr != nil {
		return "", cerr
	}
	return spec.Title(), nil
}

// SpecTitle —— 厂商自己给这份 API 起的名字（info.title）。读不出来 → 空串。
//
// 这正是摄入那一刻显示在 `CONNECTOR CANDIDATE` 上的那个串。装配时再取一次存下来，
// 列表就不必为了一个名字去重解析一份 12.9 MB 的文档（F-C-56）。
func SpecTitle(raw []byte) string {
	spec, err := ParseSpec(raw)
	if err != nil {
		return ""
	}
	return spec.Title()
}

// checkIngestSemantics —— parse 后的摄入语义闸：servers 必填、operationId 齐且唯一、$ref 不外部。
func checkIngestSemantics(spec *Spec, raw []byte) error {
	if len(spec.ServerURLs()) == 0 {
		return errors.New("the spec defines no servers (a base URL is required)")
	}
	if oerr := checkOperationIDs(spec); oerr != nil {
		return oerr
	}
	return checkNoExternalRefs(raw)
}

// ingestParseError —— 把 ParseSpec 的错映成摄入文案：版本不符 → 点出只收 3.0/3.1；空 paths → 点出
// 无 operation；其余 → 无法解析。
func ingestParseError(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "unsupported openapi version"), strings.Contains(msg, "only 3.0"):
		return errors.New("only OpenAPI 3.0.x / 3.1.x is supported (not Swagger 2.0)")
	case errors.Is(err, ErrSpecNoOperations):
		return errors.New("the spec defines no operations (paths are empty)")
	default:
		return errors.New("could not parse the spec (invalid JSON or YAML)")
	}
}

// checkOperationIDs —— 每个 operation 必须有 operationId 且全局唯一（绑定靠它唯一指向）。
func checkOperationIDs(spec *Spec) error {
	seen := map[string]struct{}{}
	for _, methods := range spec.Paths {
		for _, op := range methods {
			if err := registerOpID(seen, op.OperationID); err != nil {
				return err
			}
		}
	}
	return nil
}

func registerOpID(seen map[string]struct{}, id string) error {
	if id == "" {
		return errors.New("an operation is missing its operationId (every operation needs one)")
	}
	if _, dup := seen[id]; dup {
		return fmt.Errorf("duplicate operationId %q (each operation must be unique)", id)
	}
	seen[id] = struct{}{}
	return nil
}

// checkNoExternalRefs —— 走整份文档找 $ref，凡是不以 "#" 开头（外部文件/URL）→ 拒，无法解析。
func checkNoExternalRefs(raw []byte) error {
	var doc any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("scan spec refs: %w", err) // 实际不会到（ParseSpec 已校过可解析性）
	}
	if externalRefIn(doc) {
		return errors.New("the spec has an external $ref that cannot be resolved " +
			"(use only internal #/… references)")
	}
	return nil
}

// externalRefIn —— 递归找任意 "$ref" 值不以 "#" 开头。
func externalRefIn(node any) bool {
	switch v := node.(type) {
	case map[string]any:
		return externalRefInMap(v)
	case []any:
		return slices.ContainsFunc(v, externalRefIn)
	}
	return false
}

func externalRefInMap(m map[string]any) bool {
	for key, val := range m {
		if key == "$ref" && isExternalRef(val) {
			return true
		}
		if externalRefIn(val) {
			return true
		}
	}
	return false
}

// isExternalRef —— $ref 值是字符串且不以 "#"（同文档）开头 → 外部引用。
func isExternalRef(val any) bool {
	ref, ok := val.(string)
	return ok && !strings.HasPrefix(ref, "#")
}
