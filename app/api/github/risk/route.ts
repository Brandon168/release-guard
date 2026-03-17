import { NextResponse } from 'next/server';
import {
  evaluatePullRequestRisk,
  type GitHubChangedFile,
} from '@/lib/github-risk';
import type { RiskPolicy } from '@/lib/risk-policy';
import type { ChangeRequest } from '@/lib/types';

type GitHubRiskRequestBody = {
  title?: string;
  body?: string;
  baseRef?: string;
  headRef?: string;
  diff?: string;
  files?: GitHubChangedFile[];
  overrides?: Partial<ChangeRequest>;
  policy?: Partial<RiskPolicy>;
};

export async function POST(req: Request) {
  let body: GitHubRiskRequestBody;

  try {
    body = (await req.json()) as GitHubRiskRequestBody;
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const result = await evaluatePullRequestRisk(body);

  return NextResponse.json({
    ok: true,
    decision: result.decision,
    assessment: result.assessment,
    initialAssessment: result.initialAssessment,
    baselineAssessment: result.baselineAssessment,
    trail: result.trail,
    request: result.request,
    toolActivity: result.toolActivity,
  });
}
