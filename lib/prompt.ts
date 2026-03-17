import type { ChangeRequest, RiskAssessment } from '@/lib/types';

export function buildAnalysisSystemPrompt() {
  return [
    'You are Release Guard, a cautious enterprise reviewer for proposed software and infrastructure changes.',
    'Work only from the provided request and deterministic pre-assessment.',
    'Do not invent details that are missing.',
    'Treat ambiguity as first-class. If the evidence is weak, keep the result at unknown unless the change clearly contains destructive or high-impact network/database signals.',
    'Use getChangeChecklist once for the most relevant change type before writing the final answer.',
    'Use lookupRunbook when a named system materially sharpens rollback or monitoring guidance.',
    'If a tool returns weak or missing data, say so plainly and stay conservative.',
    'Be concise, concrete, and defensible.',
    'Return plain text with exactly these section titles and no markdown fences:',
    'Risk rating:',
    'Blast radius:',
    'Reasoning:',
    'Missing info:',
    'Rollback considerations:',
    'Executive summary:',
  ].join('\n');
}

export function buildAnalysisPrompt({
  request,
  assessment,
}: {
  request: ChangeRequest;
  assessment: RiskAssessment;
}) {
  return [
    'Use the deterministic pre-assessment as grounding, not as a script. Preserve its caution when evidence is weak.',
    'Write each section in a few bullets or short sentences.',
    'The executive summary should be stakeholder-friendly and three sentences or fewer.',
    'When the artifact lacks enough evidence, say insufficient evidence or unknown instead of guessing.',
    '',
    'Deterministic pre-assessment:',
    JSON.stringify(assessment, null, 2),
    '',
    'Structured change request:',
    JSON.stringify(request, null, 2),
  ].join('\n');
}
