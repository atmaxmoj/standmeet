// policy.go —— booking policy 结构 + 评估算法,港自旧核心 usecases/calendar_policy.go +
// domain.BookingPolicy。#135:booker 是 self-contained cap,自带这份结构与算法;核心不再认识
// "booking policy"。policy 存在 booker 自己的 capstore("policy" collection,单 doc);没设过
// → DefaultBookingPolicy。评估纯 Go(time/strings),不碰任何外部。

package main

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	defaultMinLeadDays = 2
	maxHour            = 23
	maxMinute          = 59
	minutesInHr        = 60
	hhmmSegments       = 2
)

// 冲突原因(空 = 通过)。**字符串值必须跟旧 domain.BookConflict* 字节一致** —— 前端卡片
// 按这些解 book-fail 的 "conflict" 字段。
const (
	conflictAllBusy  = "all_busy"
	conflictLeadTime = "lead_time"
	conflictWeekday  = "weekday_not_allowed"
	conflictHours    = "outside_hours"
)

// errMissingHours —— policy 的 working_hours 没配/配坏(区别于"落在营业时间外")。
var errMissingHours = errors.New("policy: working hours missing")

var errOutsideHours = errors.New("policy: outside hours")

// bookingPolicy —— owner 的预约政策(capstore JSONB 文档)。
type bookingPolicy struct {
	OwnerID           string   `json:"owner_id"`
	WorkingHoursStart string   `json:"working_hours_start"` // 'HH:MM'
	WorkingHoursEnd   string   `json:"working_hours_end"`   // 'HH:MM'
	AllowedWeekdays   []string `json:"allowed_weekdays"`
	MinLeadDays       int32    `json:"min_lead_days"`
	BufferMin         int32    `json:"buffer_min"`
}

// defaultBookingPolicy —— owner 没显式设过时的兜底。
func defaultBookingPolicy(ownerID string) bookingPolicy {
	return bookingPolicy{
		OwnerID:           ownerID,
		MinLeadDays:       defaultMinLeadDays,
		AllowedWeekdays:   []string{"mon", "tue", "wed", "thu", "fri"},
		WorkingHoursStart: "09:00",
		WorkingHoursEnd:   "17:00",
	}
}

// weekday3 —— Go time.Weekday → 3-letter 小写(mon..sun)。
var weekday3 = [...]string{
	time.Sunday:    "sun",
	time.Monday:    "mon",
	time.Tuesday:   "tue",
	time.Wednesday: "wed",
	time.Thursday:  "thu",
	time.Friday:    "fri",
	time.Saturday:  "sat",
}

// evaluatePolicy —— 判一个 (start, duration) 是否符合 policy。返回冲突原因(空=通过)。
// 顺序:lead time → weekday → working hours。
func evaluatePolicy(
	policy *bookingPolicy, ownerTZ string, start time.Time, durationMin int,
) (string, error) {
	if !leadTimeOK(start, policy.MinLeadDays) {
		return conflictLeadTime, nil
	}
	loc, lerr := loadTimezone(ownerTZ)
	if lerr != nil {
		return "", lerr
	}
	local := start.In(loc)
	end := start.Add(time.Duration(durationMin) * time.Minute).In(loc)
	if !weekdayAllowed(local.Weekday(), policy.AllowedWeekdays) {
		return conflictWeekday, nil
	}
	return finishHoursCheck(policy, local, end)
}

func finishHoursCheck(policy *bookingPolicy, local, end time.Time) (string, error) {
	hErr := checkWorkingHours(policy, local, end)
	if hErr == nil {
		return "", nil
	}
	if errors.Is(hErr, errMissingHours) {
		return "", hErr
	}
	return conflictHours, nil
}

// leadTimeOK —— start 必须在 now + minLeadDays 天之后(天然挡掉过去/太近的时段)。
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

func checkWorkingHours(policy *bookingPolicy, localStart, localEnd time.Time) error {
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

func parseHoursBounds(policy *bookingPolicy) (hoursBounds, error) {
	s, err := parseHHMM(policy.WorkingHoursStart)
	if err != nil {
		return hoursBounds{}, fmt.Errorf("parse working_hours_start: %w", errMissingHours)
	}
	e, err := parseHHMM(policy.WorkingHoursEnd)
	if err != nil {
		return hoursBounds{}, fmt.Errorf("parse working_hours_end: %w", errMissingHours)
	}
	return hoursBounds{startMin: s, endMin: e}, nil
}

func parseHHMM(s string) (int, error) {
	parts := strings.Split(s, ":")
	if len(parts) != hhmmSegments {
		return 0, fmt.Errorf("bad HH:MM %q", s)
	}
	var h, m int
	if _, err := fmt.Sscanf(parts[0]+" "+parts[1], "%d %d", &h, &m); err != nil {
		return 0, fmt.Errorf("scan HH:MM %q: %w", s, err)
	}
	if h < 0 || h > maxHour || m < 0 || m > maxMinute {
		return 0, fmt.Errorf("HH:MM out of range %q", s)
	}
	return h*minutesInHr + m, nil
}

func minuteOfDay(t time.Time) int {
	return t.Hour()*minutesInHr + t.Minute()
}

// policyHint —— book 失败时给 agent 的人读提示,如 "MON,TUE 09:00–17:00 Asia/Shanghai"。
func policyHint(p *bookingPolicy, ownerTZ string) string {
	tz := ownerTZ
	if tz == "" {
		tz = "UTC"
	}
	return fmt.Sprintf("%s %s–%s %s",
		strings.ToUpper(strings.Join(p.AllowedWeekdays, ",")),
		p.WorkingHoursStart, p.WorkingHoursEnd, tz)
}
