package usecase

import "context"

// HomeworkSource —— the owner's homework on "this" application's job (what they learned about
// the company and team, why they fit), by the session's access code, read live. err != nil = none
// to show (an ordinary code, no homework, or a failure); the block hides itself either way.
type HomeworkSource interface {
	HomeworkForCode(ctx context.Context, ownerID, codeID string) (string, error)
}
