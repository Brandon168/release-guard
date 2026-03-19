// Policy engine: converts a structured review assessment into a pass/warn/fail
// gate decision. Policy is intentionally separate from the review so that teams
// can tune thresholds (e.g. failOnUnknown, warnOnFallback) per repo without
// changing the review logic itself. The default policy fails closed on both
// high-risk and unknown grades — treating uncertainty as a reason to block, not
// a reason to proceed.
import type { ReviewAssessment, ReviewTrail } from '@/lib/types';

export type RiskGateStatus = 'pass' | 'warn' | 'fail';

export type RiskPolicy = {
  failOnHighRisk: boolean;
  failOnUnknown: boolean;
  warnOnMediumRisk: boolean;
  warnOnWeakConfidence: boolean;
  warnOnFallback: boolean;
};

export type RiskDecision = {
  status: RiskGateStatus;
  summary: string;
  reasons: string[];
  shouldBlock: boolean;
  shouldNotify: boolean;
  policy: RiskPolicy;
};

export const defaultRiskPolicy: RiskPolicy = {
  failOnHighRisk: true,
  failOnUnknown: true,
  warnOnMediumRisk: true,
  warnOnWeakConfidence: true,
  warnOnFallback: true,
};

export function normalizeRiskPolicy(
  overrides: Partial<RiskPolicy> = {},
): RiskPolicy {
  return {
    failOnHighRisk:
      overrides.failOnHighRisk ?? defaultRiskPolicy.failOnHighRisk,
    failOnUnknown: overrides.failOnUnknown ?? defaultRiskPolicy.failOnUnknown,
    warnOnMediumRisk:
      overrides.warnOnMediumRisk ?? defaultRiskPolicy.warnOnMediumRisk,
    warnOnWeakConfidence:
      overrides.warnOnWeakConfidence ?? defaultRiskPolicy.warnOnWeakConfidence,
    warnOnFallback: overrides.warnOnFallback ?? defaultRiskPolicy.warnOnFallback,
  };
}

export function evaluateRiskPolicy({
  assessment,
  trail,
  policy: policyOverrides,
}: {
  assessment: ReviewAssessment;
  trail: ReviewTrail;
  policy?: Partial<RiskPolicy>;
}): RiskDecision {
  // Keep enforcement separate from assessment so teams can tune gate behavior.
  const policy = normalizeRiskPolicy(policyOverrides);
  const failReasons: string[] = [];
  const warnReasons: string[] = [];

  if (policy.failOnUnknown && assessment.riskLevel === 'unknown') {
    failReasons.push('Risk grade is unknown, so the gate fails closed.');
  }

  if (policy.failOnHighRisk && assessment.riskLevel === 'high') {
    failReasons.push('Risk grade is high.');
  }

  if (policy.warnOnMediumRisk && assessment.riskLevel === 'medium') {
    warnReasons.push('Risk grade is medium.');
  }

  if (policy.warnOnWeakConfidence && assessment.confidence === 'weak') {
    warnReasons.push('Review confidence is weak.');
  }

  if (policy.warnOnFallback && trail.fallbackUsed) {
    warnReasons.push('The review fell back to the deterministic baseline.');
  }

  const status: RiskGateStatus = failReasons.length
    ? 'fail'
    : warnReasons.length
      ? 'warn'
      : 'pass';
  const reasons = status === 'fail' ? failReasons : warnReasons;

  return {
    status,
    summary:
      status === 'fail'
        ? 'PR should be blocked pending review.'
        : status === 'warn'
          ? 'PR should be reviewed carefully before merge.'
          : 'PR is within the configured risk policy.',
    reasons,
    shouldBlock: status === 'fail',
    shouldNotify: status !== 'pass',
    policy,
  };
}
