import { generateText, Output, stepCountIs } from 'ai';
import { analysisTools } from '@/lib/change-tools';
import {
  getConfiguredReviewModels,
  getGatewayModel,
  getModelLabel,
  hasGatewayAccess,
  type GatewayModelId,
} from '@/lib/model';
import { loadRepoGrounding } from '@/lib/repo-grounding';
import { assessChangeRisk } from '@/lib/risk-engine';
import {
  normalizeChangeRequest,
  type ChangeRequest,
  type ChangeReviewResult,
  type ExpectedScope,
  type ReviewAssessment,
  type ReviewToolActivity,
  type RiskAssessment,
  reviewAssessmentSchema,
} from '@/lib/types';

export type ReviewProgressData = {
  stage: 'primary' | 'escalation' | 'fallback' | 'done';
  label: string;
  detail: string;
  modelId: string | null;
};

type RunModelReviewResult = {
  assessment: ReviewAssessment;
  toolActivity: ReviewToolActivity[];
};

function summarizeToolPayload(value: unknown) {
  if (!value) {
    return 'No payload available.';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  const payload = value as Record<string, unknown>;

  if (Array.isArray(payload.checks)) {
    return payload.checks.slice(0, 2).join(' ');
  }

  if (Array.isArray(payload.watch)) {
    return payload.watch.slice(0, 2).join(' ');
  }

  if (typeof payload.guidance === 'string') {
    return payload.guidance;
  }

  if (typeof payload.notes === 'string') {
    return payload.notes;
  }

  if (typeof payload.caution === 'string') {
    return payload.caution;
  }

  return Object.entries(payload)
    .slice(0, 3)
    .map(([key, fieldValue]) => `${key}: ${String(fieldValue)}`)
    .join(' | ');
}

function mapBlastRadiusToExpectedScope(blastRadius: string[]): ExpectedScope {
  const primary = blastRadius[0]?.toLowerCase() ?? '';

  if (primary.includes('scope is still unclear')) {
    return 'unclear';
  }

  if (blastRadius.length >= 3) {
    return 'broad';
  }

  if (blastRadius.length === 2) {
    return 'moderate';
  }

  return 'narrow';
}

function mapRiskToAction(
  riskLevel: ReviewAssessment['riskLevel'],
): ReviewAssessment['recommendedAction'] {
  if (riskLevel === 'high') {
    return 'block';
  }

  if (riskLevel === 'medium') {
    return 'review';
  }

  if (riskLevel === 'low') {
    return 'approve';
  }

  return 'need-more-info';
}

function mapDeterministicAssessment(
  assessment: RiskAssessment,
): ReviewAssessment {
  return {
    riskLevel: assessment.riskLevel,
    confidence: assessment.evidenceStrength,
    expectedScope: mapBlastRadiusToExpectedScope(assessment.blastRadius),
    scopeSummary: assessment.blastRadius[0] ?? 'Scope is still unclear.',
    reasoning: assessment.reasons.slice(0, 4),
    missingInfo:
      assessment.clarifyingQuestions.slice(0, 4).length > 0
        ? assessment.clarifyingQuestions.slice(0, 4)
        : assessment.missingEvidence.slice(0, 4),
    rollbackConsiderations: assessment.rollbackConsiderations.slice(0, 4),
    recommendedAction: mapRiskToAction(assessment.riskLevel),
    executiveSummary: assessment.executiveSummary,
  };
}

function buildReviewSystemPrompt() {
  return [
    'You are Release Guard, an enterprise reviewer for software and infrastructure changes.',
    'Your job is to judge risk, confidence, scope, and missing information, not to merely summarize.',
    'Use only the provided change request, repository grounding, deterministic baseline, and tool results.',
    'Do not invent systems, rollout details, or rollback plans that are not in evidence.',
    'When evidence is insufficient, keep the grade conservative and use unknown or lower confidence.',
    'Repository grounding may define repo-specific severity expectations. Use it to calibrate the grade, but do not pretend the artifact included facts that only appear in the grounding pack.',
    'Use getChangeChecklist once for the most relevant change type.',
    'Use lookupRunbook only when a named service or system would materially improve rollback or monitoring guidance.',
    'Keep reasoning short, concrete, and defensible.',
    'Return structured output only.',
  ].join('\n');
}

function buildReviewPrompt({
  request,
  baselineAssessment,
  repoGrounding,
  priorAssessment,
  escalationReason,
}: {
  request: ChangeRequest;
  baselineAssessment: RiskAssessment;
  repoGrounding?: string | null;
  priorAssessment?: ReviewAssessment;
  escalationReason?: string;
}) {
  const sections = [
    'Assess the change and produce a structured judgment.',
    'The deterministic baseline is a safety signal, not the final answer. Use it as a cross-check, not a script.',
    'If the artifact is ambiguous, say so in missingInfo and keep the confidence limited.',
    'Scope should be one of: narrow, moderate, broad, unclear.',
    'Recommended action should match the risk: low->approve, medium->review, high->block, unknown->need-more-info.',
    '',
    'Structured change request:',
    JSON.stringify(request, null, 2),
    '',
    'Deterministic baseline:',
    JSON.stringify(baselineAssessment, null, 2),
  ];

  if (repoGrounding) {
    sections.push('', repoGrounding);
  }

  if (priorAssessment && escalationReason) {
    sections.push(
      '',
      'This is an escalation review.',
      `Escalation reason: ${escalationReason}.`,
      'Take a fresh second look. You may agree or disagree with the first model, but explain the final stance clearly in the structured fields.',
      '',
      'Initial model assessment:',
      JSON.stringify(priorAssessment, null, 2),
    );
  }

  return sections.join('\n');
}

function getEscalationReason(assessment: ReviewAssessment) {
  if (assessment.riskLevel === 'unknown') {
    return 'the initial model kept the grade unknown';
  }

  if (
    assessment.riskLevel === 'medium' &&
    assessment.confidence !== 'strong'
  ) {
    return 'the initial model called this medium risk without strong confidence';
  }

  if (assessment.expectedScope === 'unclear') {
    return 'the initial model could not clearly bound the expected scope';
  }

  if (assessment.confidence === 'weak') {
    return 'the initial model returned weak confidence';
  }

  if (assessment.recommendedAction === 'need-more-info') {
    return 'the initial review still needed more information';
  }

  return null;
}

async function runModelReview({
  request,
  baselineAssessment,
  modelId,
  stage,
  repoGrounding,
  priorAssessment,
  escalationReason,
}: {
  request: ChangeRequest;
  baselineAssessment: RiskAssessment;
  modelId: GatewayModelId;
  stage: ReviewToolActivity['stage'];
  repoGrounding?: string | null;
  priorAssessment?: ReviewAssessment;
  escalationReason?: string;
}): Promise<RunModelReviewResult> {
  const result = await generateText({
    model: getGatewayModel(modelId),
    system: buildReviewSystemPrompt(),
    prompt: buildReviewPrompt({
      request,
      baselineAssessment,
      repoGrounding,
      priorAssessment,
      escalationReason,
    }),
    tools: analysisTools,
    output: Output.object({
      schema: reviewAssessmentSchema,
      name: 'change_risk_assessment',
      description: 'Structured enterprise change-risk judgment.',
    }),
    stopWhen: stepCountIs(6),
  });

  const toolActivity = result.steps.flatMap(step =>
    step.toolResults.map(toolResult => ({
      stage,
      toolName: toolResult.toolName,
      summary: summarizeToolPayload(toolResult.output),
    })),
  );

  return {
    assessment: result.output,
    toolActivity,
  };
}

export function buildDeterministicFallbackReview({
  request,
  baselineAssessment = assessChangeRisk(request),
  gatewayAvailable = hasGatewayAccess(),
  initialAssessment = null,
  primaryModelId = null,
  escalationModelId = null,
  escalationTriggered = false,
  escalationCompleted = false,
  escalationReason = null,
  fallbackReason,
}: {
  request: ChangeRequest;
  baselineAssessment?: RiskAssessment;
  gatewayAvailable?: boolean;
  initialAssessment?: ReviewAssessment | null;
  primaryModelId?: string | null;
  escalationModelId?: string | null;
  escalationTriggered?: boolean;
  escalationCompleted?: boolean;
  escalationReason?: string | null;
  fallbackReason: string;
}): ChangeReviewResult {
  return {
    baselineAssessment,
    initialAssessment,
    assessment: mapDeterministicAssessment(baselineAssessment),
    trail: {
      reviewPath: 'deterministic-fallback',
      gatewayAvailable,
      primaryModelId,
      escalationModelId,
      finalModelId: null,
      escalationTriggered,
      escalationCompleted,
      escalationReason,
      fallbackUsed: true,
      fallbackReason,
    },
    toolActivity: [],
  };
}

export async function reviewChangeRisk(
  input: ChangeRequest,
  options: {
    onProgress?: (event: ReviewProgressData) => void;
    simulateModelFallback?: boolean;
  } = {},
): Promise<ChangeReviewResult> {
  const request = normalizeChangeRequest(input);
  const baselineAssessment = assessChangeRisk(request);
  const gatewayAvailable = hasGatewayAccess();
  const { primaryModelId, escalationModelId } = getConfiguredReviewModels();
  const simulateModelFallback = options.simulateModelFallback === true;

  if (simulateModelFallback) {
    options.onProgress?.({
      stage: 'fallback',
      label: 'Deterministic fallback',
      detail: 'Simulated fallback is enabled, so the deterministic baseline became the final review.',
      modelId: null,
    });

    return buildDeterministicFallbackReview({
      request,
      baselineAssessment,
      gatewayAvailable,
      primaryModelId,
      escalationModelId,
      fallbackReason: 'Simulated model fallback is enabled for this run.',
    });
  }

  if (!gatewayAvailable) {
    options.onProgress?.({
      stage: 'fallback',
      label: 'Deterministic fallback',
      detail: 'AI Gateway is unavailable, so the deterministic baseline became the final review.',
      modelId: null,
    });

    return buildDeterministicFallbackReview({
      request,
      baselineAssessment,
      gatewayAvailable,
      primaryModelId,
      escalationModelId,
      fallbackReason: 'AI Gateway credentials are not configured.',
    });
  }

  const repoGrounding = await loadRepoGrounding();

  options.onProgress?.({
    stage: 'primary',
    label: 'Primary review',
    detail: `Running ${getModelLabel(primaryModelId)} as the low-cost first pass.`,
    modelId: primaryModelId,
  });

  let primaryReview: RunModelReviewResult;

  try {
    primaryReview = await runModelReview({
      request,
      baselineAssessment,
      modelId: primaryModelId,
      stage: 'primary',
      repoGrounding: repoGrounding.promptBlock,
    });
  } catch {
    options.onProgress?.({
      stage: 'fallback',
      label: 'Deterministic fallback',
      detail: `${getModelLabel(primaryModelId)} did not return a usable structured review.`,
      modelId: null,
    });

    return buildDeterministicFallbackReview({
      request,
      baselineAssessment,
      gatewayAvailable,
      primaryModelId,
      escalationModelId,
      fallbackReason: `${getModelLabel(primaryModelId)} did not return a usable structured review.`,
    });
  }

  const escalationReason = getEscalationReason(primaryReview.assessment);

  if (!escalationReason) {
    options.onProgress?.({
      stage: 'done',
      label: 'Primary review complete',
      detail: `${getModelLabel(primaryModelId)} resolved the review without escalation.`,
      modelId: primaryModelId,
    });

    return {
      baselineAssessment,
      initialAssessment: primaryReview.assessment,
      assessment: primaryReview.assessment,
      trail: {
        reviewPath: 'primary',
        gatewayAvailable,
        primaryModelId,
        escalationModelId,
        finalModelId: primaryModelId,
        escalationTriggered: false,
        escalationCompleted: false,
        escalationReason: null,
        fallbackUsed: false,
        fallbackReason: null,
      },
      toolActivity: primaryReview.toolActivity,
    };
  }

  options.onProgress?.({
    stage: 'escalation',
    label: 'Escalated review',
    detail: `Escalating to ${getModelLabel(escalationModelId)} because ${escalationReason}.`,
    modelId: escalationModelId,
  });

  try {
    const escalatedReview = await runModelReview({
      request,
      baselineAssessment,
      modelId: escalationModelId,
      stage: 'escalation',
      repoGrounding: repoGrounding.promptBlock,
      priorAssessment: primaryReview.assessment,
      escalationReason,
    });

    options.onProgress?.({
      stage: 'done',
      label: 'Escalated review complete',
      detail: `${getModelLabel(escalationModelId)} produced the final judgment after escalation.`,
      modelId: escalationModelId,
    });

    return {
      baselineAssessment,
      initialAssessment: primaryReview.assessment,
      assessment: escalatedReview.assessment,
      trail: {
        reviewPath: 'escalated',
        gatewayAvailable,
        primaryModelId,
        escalationModelId,
        finalModelId: escalationModelId,
        escalationTriggered: true,
        escalationCompleted: true,
        escalationReason,
        fallbackUsed: false,
        fallbackReason: null,
      },
      toolActivity: [
        ...primaryReview.toolActivity,
        ...escalatedReview.toolActivity,
      ],
    };
  } catch {
    options.onProgress?.({
      stage: 'fallback',
      label: 'Deterministic fallback',
      detail: `${getModelLabel(escalationModelId)} was requested after an uncertain first pass, but the fallback had to take over.`,
      modelId: null,
    });

    return buildDeterministicFallbackReview({
      request,
      baselineAssessment,
      gatewayAvailable,
      initialAssessment: primaryReview.assessment,
      primaryModelId,
      escalationModelId,
      escalationTriggered: true,
      escalationCompleted: false,
      escalationReason,
      fallbackReason: `${getModelLabel(escalationModelId)} was requested after an uncertain first pass, but the fallback had to take over.`,
    });
  }
}

export function buildReviewReport(result: ChangeReviewResult) {
  const lines = [
    'Risk rating:',
    `- ${result.assessment.riskLevel}`,
    `- Confidence: ${result.assessment.confidence}`,
    `- Recommended action: ${result.assessment.recommendedAction}`,
  ];

  if (result.trail.reviewPath === 'primary' && result.trail.primaryModelId) {
    lines.push(`- Review path: ${getModelLabel(result.trail.primaryModelId)} only`);
  } else if (
    result.trail.reviewPath === 'escalated' &&
    result.trail.primaryModelId &&
    result.trail.finalModelId
  ) {
    lines.push(
      `- Review path: escalated from ${getModelLabel(result.trail.primaryModelId)} to ${getModelLabel(result.trail.finalModelId)}`,
    );
  } else if (result.trail.fallbackReason) {
    lines.push(`- Review path: deterministic fallback (${result.trail.fallbackReason})`);
  }

  lines.push(
    '',
    'Blast radius:',
    `- ${result.assessment.expectedScope}`,
    `- ${result.assessment.scopeSummary}`,
    '',
    'Reasoning:',
    ...result.assessment.reasoning.map(item => `- ${item}`),
    '',
    'Missing info:',
    ...(result.assessment.missingInfo.length
      ? result.assessment.missingInfo.map(item => `- ${item}`)
      : ['- No major missing information was called out.']),
    '',
    'Rollback considerations:',
    ...(result.assessment.rollbackConsiderations.length
      ? result.assessment.rollbackConsiderations.map(item => `- ${item}`)
      : ['- No rollback-specific guidance was provided.']),
    '',
    'Executive summary:',
    result.assessment.executiveSummary,
  );

  return lines.join('\n');
}
