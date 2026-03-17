# High-Risk Example

Change:
Modify `lib/review.ts` so the primary model can auto-approve medium-risk changes
without escalation, and loosen `lib/risk-policy.ts` so unknown results no longer
block when the policy expects caution.

Why it calibrates as high:

- directly changes grading behavior
- can hide uncertainty instead of surfacing it
- affects the CI enforcement story, not just presentation
