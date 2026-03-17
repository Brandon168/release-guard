import { NextResponse } from 'next/server';
import {
  evaluatePullRequestRisk,
  type GitHubChangedFile,
} from '@/lib/github-risk';
import { hasRiskApiAccess } from '@/lib/request-auth';
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
  if (!hasRiskApiAccess(req)) {
    return NextResponse.json(
      { error: 'Unauthorized.' },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer realm="Release Guard PR Risk API"',
        },
      },
    );
  }

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
    commentBody: result.commentBody,
  });
}
