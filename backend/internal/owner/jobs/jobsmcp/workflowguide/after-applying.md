# After applying

Use this guide when an application went out: follow-ups, replies, offers and corrections.

## Follow-ups

1. Read `applications.followups_due` once a day.
2. For an application nobody opened, draft a short nudge. Two nudges at most.
3. For an opened application, never nudge blind. Read `applications.engagement` and answer what they asked.
4. Show each draft to the owner. Send nothing without the owner's yes.

## Replies in the owner's mailbox

1. Read the recruiter's reply with the owner's mail tools, if the owner connected them.
2. Propose the outcome it means: responded, interview, offer or rejected.
3. Put every proposal from one mailbox read in one list. The owner confirms the list once.
4. Record each confirmed one with `applications.update_outcome`.
5. Never propose "hired", "withdrawn" or a declined offer. The owner says those.

## A stuck process

- Wait two weeks after the last contact before you write.
- Write one short message to the person the owner last spoke to.
- Never write to an accessibility, benefits or ethics address about a process.

## An offer

- Describe the offer. Quote its numbers and terms exactly.
- Never judge it for the owner.
- Never store the contract on the instance.

## A claim that turned out wrong

1. Correct it at its source: the corpus entry with `corpus.update`, then the master with `resume.master_update`.
2. "Cannot confirm" never becomes "confirmed" in a later draft.

## Warm introductions

The owner's contacts export stays on the owner's machine. Read it there. Never upload it.

## The funnel

`applications.funnel` shows how far applications got. Medians appear only from 20 samples.
