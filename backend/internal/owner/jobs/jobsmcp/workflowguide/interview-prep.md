# Preparing for an interview

Use this guide when a recruiter engaged with an application, or before an interview.

## Build the prep pack

1. Read what the recruiter asked with `applications.engagement`.
2. Group the questions by theme.
3. For each question, find one story in the corpus. Use `corpus.search` and `corpus.get`.
4. List each gap: a question the answer could not ground (`grounded: false`).
5. Quote each answer that touched pay, start date, availability or work authorization. The owner must know what the agent already said.
6. Show the pack to the owner.

## Fill the gaps

1. Ask the owner each gap question.
2. Write the answer in the owner's vault first.
3. Save it to the corpus with `corpus.create`.
4. Set the code's waypoints with `codes.set_waypoints` so the next visit steers to the strong stories.

`applications.gaps` lists the gaps across all applications, counted. Write the most frequent ones first.

## Rehearse

1. Create a code for the owner's own test with `codes.create`. Label it "selftest".
2. Ask the posting's likely questions on that code, as a recruiter would.
3. Read which answers did not ground. Fix them as gaps.
4. A strong spoken answer from the owner becomes a raw corpus entry. Save it with `corpus.create`.

## After the interview

1. Ask the owner what was asked and how it went.
2. Save the debrief as a raw entry with `corpus.create`. Name the application in it.
3. Record the outcome with `applications.update_outcome`.
