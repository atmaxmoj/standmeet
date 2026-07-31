// validate.go —— 按**声明**校验 owner 填的值。
//
// 校验规则来自 ConfigField(类型、取值范围),不是每个能力自己手写一遍 ——
// booker 以前就是手写的:host 的 booking-policy handler 里有一句 min_lead_days ≥ 1,
// 沙箱那边没有。声明化之后,规则和默认值一样只有一处。

package capconfig

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// hhmmParts —— 'HH:MM' 的段数。
const hhmmParts = 2

// validate —— 逐个字段按声明校验。第一处不合法就返回(面板一次改一个字段,不需要收集全部)。
func validate(decl []mcpplugin.ConfigField, values map[string]json.RawMessage) error {
	byKey := map[string]*mcpplugin.ConfigField{}
	for i := range decl {
		byKey[decl[i].Key] = &decl[i]
	}
	for k, raw := range values {
		if err := validateOne(byKey[k], k, raw); err != nil {
			return err
		}
	}
	return nil
}

// validators —— 声明的类型 → 怎么校验。一类一行;表外的类型按字符串处理。
type fieldValidator func(*mcpplugin.ConfigField, string, json.RawMessage) error

var validators = map[string]fieldValidator{
	mcpplugin.ConfigTypeInt: validateInt,
	mcpplugin.ConfigTypeTime: func(_ *mcpplugin.ConfigField, k string, r json.RawMessage) error {
		return validateTime(k, r)
	},
	mcpplugin.ConfigTypeBool: func(_ *mcpplugin.ConfigField, k string, r json.RawMessage) error {
		return validateShape(k, r, new(bool), "a boolean")
	},
	mcpplugin.ConfigTypeStringList: func(
		_ *mcpplugin.ConfigField, k string, r json.RawMessage,
	) error {
		return validateShape(k, r, &[]string{}, "an array of strings")
	},
}

func validateOne(f *mcpplugin.ConfigField, key string, raw json.RawMessage) error {
	if v, ok := validators[f.Type]; ok {
		return v(f, key, raw)
	}
	return validateShape(key, raw, new(string), "a string")
}

func validateInt(f *mcpplugin.ConfigField, key string, raw json.RawMessage) error {
	var n int
	if err := json.Unmarshal(raw, &n); err != nil {
		return fmt.Errorf("%w: %q must be a whole number", ErrInvalidValue, key)
	}
	return checkBounds(f, key, n)
}

func checkBounds(f *mcpplugin.ConfigField, key string, n int) error {
	if f.Min != nil && n < *f.Min {
		return fmt.Errorf("%w: %q must be at least %d", ErrInvalidValue, key, *f.Min)
	}
	if f.Max != nil && n > *f.Max {
		return fmt.Errorf("%w: %q must be at most %d", ErrInvalidValue, key, *f.Max)
	}
	return nil
}

// validateTime —— 'HH:MM'。只认这一种写法:两个面和沙箱都按它解析。
func validateTime(key string, raw json.RawMessage) error {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return fmt.Errorf("%w: %q must be a 'HH:MM' string", ErrInvalidValue, key)
	}
	if !validHHMM(s) {
		return fmt.Errorf("%w: %q must look like 'HH:MM'", ErrInvalidValue, key)
	}
	return nil
}

func validHHMM(s string) bool {
	parts := strings.Split(s, ":")
	if len(parts) != hhmmParts {
		return false
	}
	return isTwoDigits(parts[0]) && isTwoDigits(parts[1])
}

func isTwoDigits(s string) bool {
	if len(s) != hhmmParts {
		return false
	}
	return s[0] >= '0' && s[0] <= '9' && s[1] >= '0' && s[1] <= '9'
}

// validateShape —— 值能不能解成声明的类型。into 只用来试解,不取值。
//
//nolint:forbidigo // into 要能是任何一种声明类型,这里只拿它试解
func validateShape(key string, raw json.RawMessage, into any, want string) error {
	if err := json.Unmarshal(raw, into); err != nil {
		return fmt.Errorf("%w: %q must be %s", ErrInvalidValue, key, want)
	}
	return nil
}
