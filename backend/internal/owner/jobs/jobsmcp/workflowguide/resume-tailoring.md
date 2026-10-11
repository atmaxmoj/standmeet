# Tailoring a résumé to one posting

Use this guide when the owner asks you to write, tailor or improve a résumé for a job.

## What the instance gives you

- `resume_content` is the résumé as JSON. One renderer draws it into the PDF the recruiter gets.
- Masters are the owner's lasting résumés. Read them with `resume.master_list` and `resume.master_get`.
- A draft is one résumé for one posting. It lives for 24 hours.
- The corpus is the only source of facts. Search it with `corpus.search`. Read an entry with `corpus.get`.
- `applications.commit` freezes the draft, issues the access code and renders the final PDF. It cannot be undone.

## Hard rules

- Copy titles, company names and dates from the master. Never upgrade a title.
- Never state or hint at immigration or work-authorization status.
- Round durations to the nearest year. Never shade a duration down.
- Add no number that the corpus does not state.
- Use "built", "led" or "designed" only for work the corpus says the owner did.

The server checks some of these rules. `resume.update_draft` returns `check.findings` and `numbers.unsupported`. Fix each finding, or ask the owner about it.

## Steps

1. Read the posting with `jobs.show`. Then read it with the job-description-reading guide.
2. Pick the master that fits best. The default master is the usual choice.
3. Sort each requirement into one of three buckets: in the master, in the corpus only, or not in the corpus.
4. Treat "not in the corpus" as a question for the owner. Never write it as a lack.
5. Show the owner a plan before you write. Name the summary's angle, the bullets per role, and what you leave out.
6. Write the draft with `resume.draft` and a `master_id`. Rewrite and reorder. Add no fact.
7. Check every bullet against the corpus entry it rests on. Ask: "Can the owner explain this in an interview without backtracking?"
8. Read the receipt's `check` and `numbers`. Resolve each item with the owner.
9. Commit with `applications.commit` only after the owner says yes. Pass `accept` with each finding key the owner approved.
10. Ask the owner if a new fact from this round belongs in the corpus or the master. Save it with `corpus.create` or `resume.master_update`.

## Myths not to act on

- "ATS software auto-rejects most résumés." Form questions reject applicants. The résumé text rarely does.
- "One page only." This is a convention. The owner decides the length.
