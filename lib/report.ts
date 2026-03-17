import type { ChangeRequest, RiskAssessment } from '@/lib/types';

export function buildFallbackReport({
  request,
  assessment,
  mode,
  fallbackReason,
}: {
  request: ChangeRequest;
  assessment: RiskAssessment;
  mode: string;
  fallbackReason?: string;
}) {
  const lines = [
    'Risk rating:',
    `- ${assessment.riskLevel}`,
    `- Evidence strength: ${assessment.evidenceStrength}`,
  ];

  if (fallbackReason) {
    lines.push(`- Fallback mode: ${mode} (${fallbackReason})`);
  } else {
    lines.push(`- Fallback mode: ${mode}`);
  }

  lines.push(
    '',
    'Blast radius:',
    ...assessment.blastRadius.map(item => `- ${item}`),
    '',
    'Reasoning:',
    ...assessment.reasons.map(item => `- ${item}`),
    '',
    'Missing info:',
    ...assessment.clarifyingQuestions.map(item => `- ${item}`),
    '',
    'Rollback considerations:',
    ...assessment.rollbackConsiderations.map(item => `- ${item}`),
    '',
    'Executive summary:',
    assessment.executiveSummary,
  );

  if (!request.summary) {
    lines.push(
      '',
      'Note:',
      '- No concrete change summary was provided, so the result stays conservative by design.',
    );
  }

  return lines.join('\n');
}
