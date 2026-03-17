# Project Profile

## Repository Shape

This repository contains two independent projects in one workspace:

- the product demo app in the repo root
- a separate Slidev presentation in `presentation/`

The primary product surface is the Next.js app in the repo root. The presentation
package is important for the demo, but it is not part of the runtime risk-analysis
path.

## What The App Does

Change Risk Copilot analyzes proposed software and infrastructure changes and
returns a conservative risk judgment with explicit missing evidence, rollback
guidance, and a recommended action.

## Important Runtime Paths

- `app/api/analyze/route.ts`: streamed workbench entrypoint
- `app/api/github/risk/route.ts`: GitHub and CI-facing JSON endpoint
- `lib/review.ts`: structured model review orchestration
- `lib/risk-engine.ts`: deterministic baseline and fallback logic
- `lib/risk-policy.ts`: pass, warn, fail policy mapping
- `lib/artifact-ingestion.ts`: normalization from raw artifacts into the request shape

## Review Priorities For This Repo

When judging changes in this repository, pay extra attention to:

- false confidence on ambiguous artifacts
- invented rollback or rollout details
- regressions in the deterministic fallback path
- policy drift between the workbench and the GitHub endpoint
- changes that make the demo look stronger than the evidence supports

## Non-Goals

This repo is intentionally a demo. It does not include persistence, auth, or a
full enterprise rules engine. Review quality should be judged on defensibility and
clarity, not on feature breadth.
