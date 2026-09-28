package agentcore

import "github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"

// HiringPrompt —— the product's default job-application prompt: the body every owner's builtin
// "hiring" role gets on each startup. Exposed so an eval measures the text the product ships,
// not a fixture copy of it that stops matching the day the prompt changes.
func HiringPrompt() string { return jobsuc.HiringPromptBody }
