// calendar_policy.go —— BookingPolicy evaluation.

package entity

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	maxHour      = 23
	maxMinute    = 59
	minutesInHr  = 60
	hhmmSegments = 2
)

// weekday3 —— Go time.Weekday → schema 用的 3-letter 小写 (mon..sun)。
var weekday3 = [...]string{
	time.Sunday:    "sun",
	time.Monday:    "mon",
	time.Tuesday:   "tue",
	time.Wednesday: "wed",
	time.Thursday:  "thu",
	time.Friday:    "fri",
	time.Saturday:  "sat",
}

// PolicyResult —— EvaluatePolicy 的判定结果:Reason 空 = 通过。
type PolicyResult struct {
	Reason BookConflictReason // 空 = pass
}

// EvaluatePolicy —— 判一个 (start, duration) 是否符合 owner policy。
// 评估顺序：lead time → weekday → working hours。
func EvaluatePolicy(
	policy *BookingPolicy, ownerTZ string,
	start time.Time, durationMin int,
) (PolicyResult, error) {
	if !leadTimeOK(start, policy.MinLeadDays) {
		return PolicyResult{Reason: BookConflictLeadTime}, nil
	}
	loc, lerr := loadTimezone(ownerTZ)
	if lerr != nil {
		return PolicyResult{}, lerr
	}
	local := start.In(loc)
	end := start.Add(time.Duration(durationMin) * time.Minute).In(loc)
	if !weekdayAllowed(local.Weekday(), policy.AllowedWeekdays) {
		return PolicyResult{Reason: BookConflictWeekday}, nil
	}
	return finishHoursCheck(policy, local, end)
}

func finishHoursCheck(
	policy *BookingPolicy, local, end time.Time,
) (PolicyResult, error) {
	hErr := checkWorkingHours(policy, local, end)
	if hErr == nil {
		return PolicyResult{}, nil
	}
	if errors.Is(hErr, ErrBookingPolicyMissingHours) {
		return PolicyResult{}, hErr
	}
	return PolicyResult{Reason: BookConflictHours}, nil
}

// leadTimeOK —— start 必须在 now + minLeadDays 天之后。minLeadDays 恒为正
// (owner UI/后端强制 ≥1)，所以这条天然挡掉所有过去 / 太近的时段。<=0 兜底
// 视为无限制 (理论上不该出现)，仍要求不早于 now。
func leadTimeOK(start time.Time, minLeadDays int32) bool {
	threshold := time.Now()
	if minLeadDays > 0 {
		threshold = threshold.Add(time.Duration(minLeadDays) * 24 * time.Hour)
	}
	return !start.Before(threshold)
}

func loadTimezone(name string) (*time.Location, error) {
	if strings.TrimSpace(name) == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("load timezone %q: %w", name, err)
	}
	return loc, nil
}

func weekdayAllowed(wd time.Weekday, allowed []string) bool {
	want := weekday3[wd]
	for _, w := range allowed {
		if strings.EqualFold(w, want) {
			return true
		}
	}
	return false
}

func checkWorkingHours(
	policy *BookingPolicy, localStart, localEnd time.Time,
) error {
	bounds, err := parseHoursBounds(policy)
	if err != nil {
		return err
	}
	if minuteOfDay(localStart) < bounds.startMin ||
		minuteOfDay(localEnd) > bounds.endMin ||
		localEnd.Day() != localStart.Day() {
		return errOutsideHours
	}
	return nil
}

type hoursBounds struct {
	startMin, endMin int
}

func parseHoursBounds(policy *BookingPolicy) (hoursBounds, error) {
	s, err := parseHHMM(policy.WorkingHoursStart)
	if err != nil {
		return hoursBounds{},
			fmt.Errorf("parse working_hours_start: %w", ErrBookingPolicyMissingHours)
	}
	e, err := parseHHMM(policy.WorkingHoursEnd)
	if err != nil {
		return hoursBounds{},
			fmt.Errorf("parse working_hours_end: %w", ErrBookingPolicyMissingHours)
	}
	return hoursBounds{startMin: s, endMin: e}, nil
}

var errOutsideHours = errors.New("policy: outside hours")

func parseHHMM(s string) (int, error) {
	parts := strings.Split(s, ":")
	if len(parts) != hhmmSegments {
		return 0, fmt.Errorf("bad HH:MM %q", s)
	}
	pair, perr := scanHHMM(parts)
	if perr != nil {
		return 0, perr
	}
	if !hhmmValid(pair) {
		return 0, fmt.Errorf("HH:MM out of range %q", s)
	}
	return pair.h*minutesInHr + pair.m, nil
}

type hhmmPair struct{ h, m int }

func scanHHMM(parts []string) (hhmmPair, error) {
	var p hhmmPair
	if _, err := fmt.Sscanf(parts[0]+" "+parts[1], "%d %d", &p.h, &p.m); err != nil {
		return p, fmt.Errorf("scan HH:MM: %w", err)
	}
	return p, nil
}

func hhmmValid(p hhmmPair) bool {
	return p.h >= 0 && p.h <= maxHour && p.m >= 0 && p.m <= maxMinute
}

func minuteOfDay(t time.Time) int {
	return t.Hour()*minutesInHr + t.Minute()
}
