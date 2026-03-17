# Risk Taxonomy

Use these repo-specific definitions to calibrate the final grade.

## Low

Choose `low` when the change is clearly scoped, reversible, and backed by enough
evidence to defend limited blast radius.

Typical examples in this repo:

- copy-only or presentation-only updates
- internal or async tuning with a narrow operational surface
- changes behind an existing feature flag with a direct rollback

## Medium

Choose `medium` when the change is still manageable but touches meaningful runtime
behavior, shared components, or operational safety controls.

Typical examples in this repo:

- cache behavior changes
- dependency upgrades that touch auth or session flows
- database changes with mitigations but real write-path sensitivity
- observability rollouts that cover broad infrastructure

## High

Choose `high` when the change can quickly disrupt traffic, state, or critical user
flows and the blast radius is broad or hard to arrest.

Typical examples in this repo:

- ingress, route, or security-group changes
- destructive schema operations
- shared-network reconfiguration
- logic changes that could break the GitHub blocking path or deterministic fallback

## Unknown

Choose `unknown` when the artifact does not provide enough repo-specific evidence
to defend a confident grade.

Common triggers:

- affected services are not named
- production scope is implied but rollout is not described
- rollback or observability plans are missing
- the artifact is too vague to bound blast radius

Unknown is the correct answer when evidence is weak. Do not convert uncertainty
into a confident low or medium judgment.
