import type { RiskDecision } from '@/lib/risk-policy';
import { getModelLabel } from '@/lib/model';
import type { ReviewAssessment, ReviewTrail } from '@/lib/types';

export type GitHubPreviewData = {
  decision: RiskDecision;
  commentBody: string;
};

export function buildGitHubCommentBody({
  decision,
  assessment,
  trail,
}: {
  decision: RiskDecision;
  assessment: ReviewAssessment;
  trail: ReviewTrail;
}) {
  return [
    '<!-- release-guard -->',
    '## Release Guard',
    '',
    `- Status: \`${decision.status}\``,
    `- Risk grade: \`${assessment.riskLevel}\``,
    `- Confidence: \`${assessment.confidence}\``,
    `- Expected scope: \`${assessment.expectedScope}\``,
    `- Recommended action: \`${assessment.recommendedAction}\``,
    '',
    '### Review Path',
    `- Path: \`${trail.reviewPath}\``,
    `- Primary model: \`${getModelLabel(trail.primaryModelId)}\``,
    trail.escalationTriggered
      ? `- Escalation: \`${getModelLabel(trail.escalationModelId)}\` because ${trail.escalationReason ?? 'the initial review was uncertain'}`
      : '- Escalation: not needed',
    `- Final source: \`${getModelLabel(trail.finalModelId)}\``,
    '',
    '### Gate Reasons',
    ...(decision.reasons.length
      ? decision.reasons.map(reason => `- ${reason}`)
      : ['- No policy issues detected.']),
    '',
    '### Missing Evidence',
    ...(assessment.missingInfo.length
      ? assessment.missingInfo.map(item => `- ${item}`)
      : ['- None.']),
    '',
    '### Executive Summary',
    assessment.executiveSummary,
  ].join('\n');
}
