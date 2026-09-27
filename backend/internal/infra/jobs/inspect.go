// inspect.go — job rows as the Tasks panel reads and acts on them.

package jobs

import (
	"encoding/json"
	"time"
)

// AttemptError — the error of one failed attempt.
type AttemptError struct {
	At      time.Time `json:"at"`
	Error   string    `json:"error"`
	Attempt int       `json:"attempt"`
}

// Job — one job as the panel shows it.
type Job struct {
	CreatedAt   time.Time       `json:"created_at"`
	ScheduledAt time.Time       `json:"scheduled_at"` // next run for pending / retryable
	FinalizedAt *time.Time      `json:"finalized_at,omitempty"`
	Kind        string          `json:"kind"`
	Queue       string          `json:"queue"`
	State       State           `json:"state"`
	Args        json.RawMessage `json:"args"`
	Errors      []AttemptError  `json:"errors"`
	ID          JobID           `json:"id"`
	Attempt     int             `json:"attempt"`
	MaxAttempts int             `json:"max_attempts"`
}

// Filter — for List. Empty fields match everything.
type Filter struct {
	Kind  string
	State State
	Args  json.RawMessage // a JSON object the job's args must contain (jsonb @>); nil = any
	Limit int             // 0 means 50
}

// Overview — the panel's headline numbers.
type Overview struct {
	Counts           map[State]int `json:"counts"`
	Kinds            []string      `json:"kinds"` // every kind that has rows, for the filter
	OldestPendingAge time.Duration `json:"oldest_pending_age_ns"`
	TableBytes       int64         `json:"table_bytes"`
}

// PeriodicState — one periodic job's durable record.
type PeriodicState struct {
	LastRunAt  *time.Time    `json:"last_run_at,omitempty"`
	NextRunAt  *time.Time    `json:"next_run_at,omitempty"`
	Name       string        `json:"name"`
	LastResult State         `json:"last_result,omitempty"`
	LastError  string        `json:"last_error,omitempty"`
	Recent     []time.Time   `json:"recent"` // start times of the last runs, newest first
	Every      time.Duration `json:"every_ns"`
}
