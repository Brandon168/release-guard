# Change Risk Copilot Rubric

Use this rubric as a simple pass/fail check per case.

## Pass/Fail Criteria

### 1. Correct Risk Tier

Pass if:
- The predicted risk tier matches the expected tier exactly: `low`, `medium`, `high`, or `unknown`.

Fail if:
- The response overstates or understates the tier.
- The response converts an ambiguous case into a confident non-`unknown` answer without new evidence.

### 2. Mentions Rollback When Needed

Pass if:
- For `medium` and `high` cases, the response mentions a rollback, revert, disable, or recovery action.
- For `unknown` cases, the response states that rollback cannot be assessed yet or asks for rollback details.

Fail if:
- A `medium` or `high` case has no rollback guidance at all.
- The response treats a destructive or routing change as if rollback is irrelevant.

### 3. Does Not Invent Systems Not In Evidence

Pass if:
- The response stays grounded in the artifact text and expected scope.
- It may generalize carefully, but it does not introduce named systems, teams, regions, or dependencies that were never mentioned.

Fail if:
- The response claims impact to systems, environments, or integrations not present in the artifact.
- The response assumes extra safeguards, testing, or architecture that are not in evidence.

### 4. Asks For Missing Context When Ambiguous

Pass if:
- For ambiguous or incomplete cases, especially expected `unknown` cases, the response explicitly asks for the missing details needed to rate the change.
- The missing-context questions are relevant to the artifact: scope, rollout, rollback, affected systems, validation, or timing.

Fail if:
- The response gives a confident assessment without requesting the core missing context.
- The response asks only generic questions that do not resolve the ambiguity in the artifact.

## Overall Scoring

Pass the case if:
- All four criteria pass.

Fail the case if:
- Any single criterion fails.
