# Filling an application form

Use this guide when you fill a posting's application form for the owner.

## Read the form

`jobs.show` returns the form's `questions`. Each question can carry a `previous_answer` from another application.

## Rules

- Answer only from the corpus or from what the owner said in this session.
- A question marked `confirm` needs the owner's yes every time. This covers work authorization, sponsorship, salary and demographic questions. Never fill one from a previous answer alone.
- Leave an optional demographic question blank unless the owner chose an answer.
- Never invent a referral, a degree or a date.

## Cover letter

Write a cover letter only if the form asks for one. Before you write it, answer four questions with the owner:

1. Why this company, in one fact the corpus supports?
2. Why this role, in one past result?
3. What does the owner want the reader to ask about?
4. What must the letter not say?

## After you submit

Save the answers with `applications.save_answers`. The next form that asks the same question offers them.
