package corpus

const (
	sentimentThresholdEngaged = 8
	sentimentThresholdWarm    = 4
	sentimentThresholdCurious = 2
	sentimentPrivateProbing   = 2
)

// DeriveSentiment — heuristic conversation sentiment from turn count +
// private hits + tier. Design source: admin.js ConversationsSection.
func DeriveSentiment(turns, privHits int32, tier string) string {
	return deriveSentimentFromTier(turns, privHits, tier)
}

func deriveSentimentFromTier(turns, privHits int32, tier string) string {
	if tier == "byoai" {
		return "shopping"
	}
	return deriveSentimentFromTurns(turns, privHits)
}

func deriveSentimentFromTurns(turns, privHits int32) string {
	if privHits > sentimentPrivateProbing {
		return "probing"
	}
	return classifyByTurnCount(turns)
}

func classifyByTurnCount(turns int32) string {
	if turns >= sentimentThresholdEngaged {
		return "engaged"
	}
	if turns >= sentimentThresholdWarm {
		return "warm"
	}
	if turns >= sentimentThresholdCurious {
		return "curious"
	}
	return "short"
}
