'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { startTransition, useState } from 'react';
import type { AnalysisUIMessage } from '@/lib/analysis-ui-message';
import { buildChangeRequestFromDraft } from '@/lib/artifact-ingestion';
import type { GitHubPreviewData } from '@/lib/github-comment';
import {
  demoScenarios,
  getDemoScenarioById,
  type DemoScenario,
} from '@/lib/demo-scenarios';
import { getModelLabel, type GatewayModelId } from '@/lib/model';
import type { ReviewProgressData } from '@/lib/review';
import {
  artifactTypeLabels,
  changeCategoryLabels,
  type ArtifactType,
  type ChangeCategory,
  type ChangeReviewResult,
  type Environment,
  environmentLabels,
  type EvidenceStrength,
  type ExpectedScope,
  type ReviewAssessment,
  type ReviewTrail,
  type ReviewToolActivity,
  type RiskLevel,
} from '@/lib/types';

type ChangeFormState = {
  title: string;
  artifactType: ArtifactType;
  artifactText: string;
  category: ChangeCategory;
  environment: Environment;
  services: string;
  infrastructureAreas: string;
  rolloutPlan: string;
  rollbackPlan: string;
  observabilityPlan: string;
  safeguards: string;
  changeWindow: string;
  knownUnknowns: string;
};

type ChangeRiskWorkbenchProps = {
  primaryModelId: GatewayModelId;
  escalationModelId: GatewayModelId;
};

const emptyFormState: ChangeFormState = {
  title: '',
  artifactType: 'pr_diff',
  artifactText: '',
  category: 'unknown',
  environment: 'production',
  services: '',
  infrastructureAreas: '',
  rolloutPlan: '',
  rollbackPlan: '',
  observabilityPlan: '',
  safeguards: '',
  changeWindow: '',
  knownUnknowns: '',
};

const categoryOptions: ChangeCategory[] = [
  'application',
  'database',
  'infrastructure',
  'network',
  'security',
  'delivery',
  'observability',
  'platform',
  'unknown',
];

const environmentOptions: Environment[] = [
  'production',
  'staging',
  'development',
  'unknown',
];

const artifactTypeOptions: ArtifactType[] = [
  'pr_diff',
  'terraform_plan',
  'change_ticket',
  'release_note',
  'config_change',
  'unknown',
];

// Request-shaping helpers keep form input and demo fixtures on one normalized path.
function splitList(value: string) {
  return value
    .split(/[,\n]/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function formToRequest(form: ChangeFormState) {
  return buildChangeRequestFromDraft({
    artifact: {
      title: form.title,
      artifactType: form.artifactType,
      artifactText: form.artifactText,
    },
    overrides: {
      category: form.category,
      environment: form.environment,
      services: splitList(form.services),
      infrastructureAreas: splitList(form.infrastructureAreas),
      rolloutPlan: form.rolloutPlan.trim(),
      rollbackPlan: form.rollbackPlan.trim(),
      observabilityPlan: form.observabilityPlan.trim(),
      safeguards: form.safeguards.trim(),
      changeWindow: form.changeWindow.trim(),
      knownUnknowns: form.knownUnknowns.trim(),
    },
  });
}

function scenarioToFormState(scenario: DemoScenario): ChangeFormState {
  const request = scenario.fixture.request;

  return {
    title: request.title,
    artifactType: scenario.artifactType,
    artifactText: scenario.artifactText,
    category: request.category,
    environment: request.environment,
    services: request.services.join(', '),
    infrastructureAreas: request.infrastructureAreas.join(', '),
    rolloutPlan: request.rolloutPlan,
    rollbackPlan: request.rollbackPlan,
    observabilityPlan: request.observabilityPlan,
    safeguards: request.safeguards,
    changeWindow: request.changeWindow,
    knownUnknowns: request.knownUnknowns,
  };
}

function extractText(message?: UIMessage) {
  if (!message) {
    return '';
  }

  return message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('');
}

// UI display mappers keep the render tree focused on structure rather than branching.
function getRiskBadgeClass(riskLevel: RiskLevel) {
  if (riskLevel === 'high') {
    return 'badge badge-high';
  }

  if (riskLevel === 'medium') {
    return 'badge badge-medium';
  }

  if (riskLevel === 'low') {
    return 'badge badge-low';
  }

  return 'badge badge-unknown';
}

function getConfidenceDisplay(confidence: EvidenceStrength) {
  if (confidence === 'strong') {
    return {
      label: 'Strong',
      className: 'badge badge-low',
      copy: 'The model had enough evidence to make a clear call.',
    };
  }

  if (confidence === 'moderate') {
    return {
      label: 'Moderate',
      className: 'badge badge-medium',
      copy: 'The judgment is usable, but a few assumptions are still in play.',
    };
  }

  return {
    label: 'Weak',
    className: 'badge badge-high',
    copy: 'Important details were missing, so the model stayed cautious.',
  };
}

function getExpectedScopeDisplay(
  expectedScope: ExpectedScope,
  scopeSummary: string,
) {
  if (expectedScope === 'broad') {
    return {
      label: 'Broad',
      className: 'badge badge-high',
      copy: scopeSummary,
    };
  }

  if (expectedScope === 'moderate') {
    return {
      label: 'Moderate',
      className: 'badge badge-medium',
      copy: scopeSummary,
    };
  }

  if (expectedScope === 'narrow') {
    return {
      label: 'Narrow',
      className: 'badge badge-low',
      copy: scopeSummary,
    };
  }

  return {
    label: 'Unclear',
    className: 'badge badge-unknown',
    copy: scopeSummary,
  };
}

function getMissingInfoDisplay(missingInfo: string[]) {
  if (missingInfo.length === 0) {
    return {
      label: 'Covered',
      className: 'badge badge-low',
      copy: 'No major gaps were called out in the final review.',
    };
  }

  if (missingInfo.length <= 2) {
    return {
      label: 'Some Gaps',
      className: 'badge badge-medium',
      copy: missingInfo[0],
    };
  }

  return {
    label: 'Major Gaps',
    className: 'badge badge-high',
    copy: missingInfo[0],
  };
}

function getRecommendedActionDisplay(
  action: ReviewAssessment['recommendedAction'],
) {
  if (action === 'approve') {
    return {
      label: 'Approve',
      className: 'badge badge-low',
      copy: 'Normal controls should be sufficient.',
    };
  }

  if (action === 'review') {
    return {
      label: 'Review',
      className: 'badge badge-medium',
      copy: 'A human should take a closer look before merge or apply.',
    };
  }

  if (action === 'block') {
    return {
      label: 'Block',
      className: 'badge badge-high',
      copy: 'Do not proceed until the risks are explicitly addressed.',
    };
  }

  return {
    label: 'Need More Info',
    className: 'badge badge-unknown',
    copy: 'The change needs sharper evidence before the gate should proceed.',
  };
}

function getProgressPillClass(progress: ReviewProgressData | null) {
  if (progress?.stage === 'fallback') {
    return 'mode-pill mode-pill-warning';
  }

  if (progress?.stage === 'done') {
    return 'mode-pill mode-pill-active';
  }

  return 'mode-pill mode-pill-quiet';
}

function getReviewPathDisplay(trail: ReviewTrail) {
  if (trail.reviewPath === 'policy-exempt') {
    return {
      label: 'Policy exempt',
      className: 'mode-pill mode-pill-active',
      copy:
        trail.fallbackReason ??
        'Repo policy exempted this change from operational review because only non-runtime files were touched.',
    };
  }

  if (trail.reviewPath === 'escalated') {
    return {
      label: 'Escalated',
      className: 'mode-pill mode-pill-warning',
      copy: trail.escalationReason
        ? `The first pass was uncertain, so a stronger model took the final review because ${trail.escalationReason}.`
        : 'The first pass was uncertain, so a stronger model took the final review.',
    };
  }

  if (trail.reviewPath === 'primary') {
    return {
      label: 'Primary only',
      className: 'mode-pill mode-pill-active',
      copy: 'The first-pass model was confident enough to keep the run on the low-cost path.',
    };
  }

  return {
    label: 'Fallback',
    className: 'mode-pill mode-pill-danger',
    copy:
      trail.fallbackReason ??
      'The model path failed, so the deterministic baseline took over.',
  };
}

function formatVerdict(assessment: ReviewAssessment | null) {
  if (!assessment) {
    return 'Not available';
  }

  return `${assessment.riskLevel} / ${assessment.confidence} confidence / ${assessment.expectedScope} scope`;
}

function renderToolStage(stage: ReviewToolActivity['stage']) {
  return stage === 'escalation' ? 'Escalation' : 'Primary';
}

function getGateStatusDisplay(status: 'pass' | 'warn' | 'fail') {
  if (status === 'fail') {
    return {
      label: 'Fail',
      className: 'mode-pill mode-pill-danger',
    };
  }

  if (status === 'warn') {
    return {
      label: 'Warn',
      className: 'mode-pill mode-pill-warning',
    };
  }

  return {
    label: 'Pass',
    className: 'mode-pill mode-pill-active',
  };
}

// Walkthrough order: local state -> transport -> derived view model -> handlers -> render panes.
export function ChangeRiskWorkbench({
  primaryModelId,
  escalationModelId,
}: ChangeRiskWorkbenchProps) {
  // 1) Local form state, workflow toggles, and result objects.
  const [form, setForm] = useState<ChangeFormState>(emptyFormState);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [reviewResult, setReviewResult] = useState<ChangeReviewResult | null>(
    null,
  );
  const [reviewProgress, setReviewProgress] = useState<ReviewProgressData | null>(
    null,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPipelineSetup, setShowPipelineSetup] = useState(false);
  const [simulateModelFallback, setSimulateModelFallback] = useState(false);
  const [showReviewComparison, setShowReviewComparison] = useState(false);
  const [githubPreview, setGitHubPreview] = useState<GitHubPreviewData | null>(
    null,
  );
  const [activeResultsView, setActiveResultsView] = useState<
    'summary' | 'trace' | 'github'
  >('summary');
  // 2) Single streaming transport for analysis progress, result payloads, and report text.
  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    error,
    clearError,
  } = useChat<AnalysisUIMessage>({
    transport: new DefaultChatTransport({
      api: '/api/analyze',
    }),
    onData: dataPart => {
      if (dataPart.type === 'data-review-progress') {
        setReviewProgress(dataPart.data);
      }

      if (dataPart.type === 'data-review-result') {
        setReviewResult(dataPart.data);
      }

      if (dataPart.type === 'data-github-preview') {
        setGitHubPreview(dataPart.data);
      }
    },
  });

  // 3) Derived view model for button state, empty-state copy, badges, and active panes.
  const submitRequest = formToRequest(form);
  const activeScenario = activeScenarioId
    ? getDemoScenarioById(activeScenarioId)
    : undefined;
  const hasReviewInput = Boolean(activeScenarioId || form.artifactText.trim());
  const isAnalyzing = status === 'submitted' || status === 'streaming';
  const latestAssistantMessage = [...messages]
    .reverse()
    .find(message => message.role === 'assistant');
  const report = extractText(latestAssistantMessage);
  const hasStartedAnalysis =
    isAnalyzing || Boolean(reviewResult) || Boolean(report) || Boolean(error);
  const showAnalysisPanels = hasStartedAnalysis;
  const statusClass = `report-status status-${status}`;
  const workbenchEmptyTitle = isAnalyzing
    ? 'Review in progress.'
    : reviewProgress?.label ?? 'Waiting to start.';
  const workbenchEmptyCopy = isAnalyzing
    ? 'The review output will populate here.'
    : reviewProgress?.detail ??
      'Run a demo scenario or paste a change to see the verdict, action, and delivery output.';
  const reportEmptyTitle = isAnalyzing
    ? 'Review in progress.'
    : 'Ready for a real change.';
  const reportEmptyCopy = isAnalyzing
    ? 'The report will appear when the current review step completes.'
    : 'Run a demo scenario or paste a change to generate the shared review narrative.';
  const githubEmptyTitle = isAnalyzing
    ? 'Review in progress.'
    : reviewProgress?.label ?? 'No PR comment yet.';
  const githubEmptyCopy = isAnalyzing
    ? 'The GitHub comment is generated after the artifact review finishes.'
    : reviewProgress?.detail ??
      'Run a review to generate the simulated PR comment preview.';
  const assessment = reviewResult?.assessment ?? null;
  const confidenceDisplay = assessment
    ? getConfidenceDisplay(assessment.confidence)
    : null;
  const expectedScopeDisplay = assessment
    ? getExpectedScopeDisplay(assessment.expectedScope, assessment.scopeSummary)
    : null;
  const missingInfoDisplay = assessment
    ? getMissingInfoDisplay(assessment.missingInfo)
    : null;
  const actionDisplay = assessment
    ? getRecommendedActionDisplay(assessment.recommendedAction)
    : null;
  const reviewPathDisplay = reviewResult
    ? getReviewPathDisplay(reviewResult.trail)
    : null;
  const decision = githubPreview?.decision ?? null;
  const gateStatusDisplay = decision
    ? getGateStatusDisplay(decision.status)
    : null;

  // 4) Request payload builder and user actions that reset or submit the workspace.
  function buildGitHubRequestBody() {
    const title = submitRequest.title || 'Release Guard preview';
    const bodySections = [
      submitRequest.summary ? `Summary: ${submitRequest.summary}` : '',
      submitRequest.services.length
        ? `Services: ${submitRequest.services.join(', ')}`
        : '',
      submitRequest.environment !== 'unknown'
        ? `Environment: ${submitRequest.environment}`
        : '',
    ].filter(Boolean);

    return {
      title,
      body: bodySections.join('\n'),
      diff: submitRequest.artifactText,
      overrides: submitRequest,
    };
  }

  function updateField<K extends keyof ChangeFormState>(
    key: K,
    value: ChangeFormState[K],
  ) {
    setActiveScenarioId(null);
    clearError();
    setForm(current => ({ ...current, [key]: value }));
  }

  function applyScenario(scenarioId: string) {
    const scenario = getDemoScenarioById(scenarioId);

    if (!scenario) {
      return;
    }

    clearError();
    setReviewResult(null);
    setGitHubPreview(null);
    setReviewProgress(null);
    setShowReviewComparison(false);
    setMessages([]);
    startTransition(() => {
      setActiveScenarioId(scenarioId);
      setShowAdvanced(false);
      setForm(scenarioToFormState(scenario));
    });
  }

  function resetWorkspace() {
    clearError();
    setReviewResult(null);
    setGitHubPreview(null);
    setReviewProgress(null);
    setSimulateModelFallback(false);
    setShowReviewComparison(false);
    setActiveResultsView('summary');
    setMessages([]);
    startTransition(() => {
      setActiveScenarioId(null);
      setShowAdvanced(false);
      setForm(emptyFormState);
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();
    setReviewResult(null);
    setGitHubPreview(null);
    setReviewProgress(null);
    setShowReviewComparison(false);
    setActiveResultsView('summary');
    setMessages([]);

    await sendMessage({
      text:
        submitRequest.title ||
        submitRequest.summary ||
        submitRequest.artifactText ||
        'Assess the release risk for this change.',
    }, {
      body: {
        github: buildGitHubRequestBody(),
        pipeline: {
          simulateModelFallback,
        },
        request: submitRequest,
      },
    });
  }

  // 5) Render layout: left pane collects evidence, right pane explains and exports decisions.
  return (
    <main className="shell">
      <section className="workspace">
        {/* Left pane: change artifact input plus optional context refinements. */}
        <div className="panel">
          <div className="panel-inner">
            <form className="form" onSubmit={handleSubmit}>
              <div className="form-actions-bar">
                <div>
                  <h2>Change Review</h2>
                  <p className="panel-subtitle">
                    Pick a demo PR or paste a change, then inspect the review.
                  </p>
                </div>
                <div className="actions actions-top">
                  <button
                    className="action-button"
                    type="submit"
                    disabled={!hasReviewInput || isAnalyzing}
                  >
                    {isAnalyzing ? 'Analyzing...' : 'Analyze Change'}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={resetWorkspace}
                  >
                    Reset
                  </button>
                  {isAnalyzing && (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => stop()}
                    >
                      Stop Stream
                    </button>
                  )}
                </div>
              </div>

              <div className="examples-header">
                <h3>Demo Scenarios</h3>
                <span className="examples-caption">4 curated examples</span>
              </div>

              <div className="example-grid">
                {demoScenarios.map(scenario => (
                  <button
                    key={scenario.id}
                    type="button"
                    className={`example-card ${
                      activeScenarioId === scenario.id ? 'active' : ''
                    }`}
                    onClick={() => applyScenario(scenario.id)}
                  >
                    <div className="sample-meta-row">
                      <span className="source-pill">{scenario.sourceKind}</span>
                      <span
                        className={getRiskBadgeClass(
                          scenario.fixture.expected.riskLevel,
                        )}
                      >
                        {scenario.fixture.expected.riskLevel}
                      </span>
                    </div>
                    <span className="sample-title">{scenario.title}</span>
                    <span className="sample-description">{scenario.subtitle}</span>
                    <span className="sample-source">{scenario.sourceLabel}</span>
                  </button>
                ))}
              </div>

              {activeScenario ? (
                <div className="source-note">
                  Loaded {activeScenario.sourceKind}: {activeScenario.sourceLabel}
                </div>
              ) : null}

              <div className="field-grid">
                <div className="field">
                  <label htmlFor="artifact-type">Change source</label>
                  <select
                    id="artifact-type"
                    value={form.artifactType}
                    onChange={event =>
                      updateField(
                        'artifactType',
                        event.target.value as ArtifactType,
                      )
                    }
                  >
                    {artifactTypeOptions.map(option => (
                      <option key={option} value={option}>
                        {artifactTypeLabels[option]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="title">Change title</label>
                  <input
                    id="title"
                    value={form.title}
                    onChange={event => updateField('title', event.target.value)}
                    placeholder="Optional override for a clearer review title"
                  />
                </div>
              </div>

              <span className="helper">
                Cheap first pass, escalation only when needed, and a shared
                fallback path.
              </span>

              <div className="field">
                <label htmlFor="artifact-text">Change details</label>
                <textarea
                  id="artifact-text"
                  rows={16}
                  className="artifact-textarea"
                  value={form.artifactText}
                  onChange={event =>
                    updateField('artifactText', event.target.value)
                  }
                  placeholder="Paste a PR diff, Terraform plan, change ticket, release note, or config change."
                />
                <span className="helper">
                  Paste the artifact you want the review engine to judge.
                </span>
              </div>

              <button
                type="button"
                className="disclosure-button"
                onClick={() => setShowAdvanced(current => !current)}
              >
                <span>
                  {showAdvanced
                    ? 'Hide advanced details'
                    : 'Refine extracted context'}
                </span>
                <span className="disclosure-meta">Optional</span>
              </button>

              {showAdvanced ? (
                <div className="advanced-panel">
                  <div className="field-grid">
                    <div className="field">
                      <label htmlFor="category">Category override</label>
                      <select
                        id="category"
                        value={form.category}
                        onChange={event =>
                          updateField(
                            'category',
                            event.target.value as ChangeCategory,
                          )
                        }
                      >
                        {categoryOptions.map(option => (
                          <option key={option} value={option}>
                            {changeCategoryLabels[option]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="environment">Environment override</label>
                      <select
                        id="environment"
                        value={form.environment}
                        onChange={event =>
                          updateField(
                            'environment',
                            event.target.value as Environment,
                          )
                        }
                      >
                        {environmentOptions.map(option => (
                          <option key={option} value={option}>
                            {environmentLabels[option]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="field-grid">
                    <div className="field">
                      <label htmlFor="services">Services touched</label>
                      <input
                        id="services"
                        value={form.services}
                        onChange={event =>
                          updateField('services', event.target.value)
                        }
                        placeholder="checkout-api, auth-api, customer-portal"
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="areas">Infrastructure areas</label>
                      <input
                        id="areas"
                        value={form.infrastructureAreas}
                        onChange={event =>
                          updateField('infrastructureAreas', event.target.value)
                        }
                        placeholder="terraform, database, network, kubernetes"
                      />
                    </div>
                  </div>

                  <div className="field-grid">
                    <div className="field">
                      <label htmlFor="rollout">Rollout plan</label>
                      <textarea
                        id="rollout"
                        rows={3}
                        value={form.rolloutPlan}
                        onChange={event =>
                          updateField('rolloutPlan', event.target.value)
                        }
                        placeholder="Canary, phased rollout, maintenance window, owner on point."
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="rollback">Rollback plan</label>
                      <textarea
                        id="rollback"
                        rows={3}
                        value={form.rollbackPlan}
                        onChange={event =>
                          updateField('rollbackPlan', event.target.value)
                        }
                        placeholder="Fastest safe way back, explicit trigger, and recovery path."
                      />
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="observability">Observability plan</label>
                    <textarea
                      id="observability"
                      rows={3}
                      value={form.observabilityPlan}
                      onChange={event =>
                        updateField('observabilityPlan', event.target.value)
                      }
                      placeholder="Dashboards, alerts, synthetic checks, and abort thresholds."
                    />
                  </div>

                  <div className="field-grid">
                    <div className="field">
                      <label htmlFor="safeguards">Safeguards</label>
                      <input
                        id="safeguards"
                        value={form.safeguards}
                        onChange={event =>
                          updateField('safeguards', event.target.value)
                        }
                        placeholder="Feature flag, read-only mode, replica rehearsal"
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="window">Change window</label>
                      <input
                        id="window"
                        value={form.changeWindow}
                        onChange={event =>
                          updateField('changeWindow', event.target.value)
                        }
                        placeholder="Business hours, overnight, weekend window"
                      />
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="unknowns">Known unknowns</label>
                    <textarea
                      id="unknowns"
                      rows={2}
                      value={form.knownUnknowns}
                      onChange={event =>
                        updateField('knownUnknowns', event.target.value)
                      }
                      placeholder="Anything unresolved that should keep the assessment conservative."
                    />
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className="disclosure-button"
                onClick={() => setShowPipelineSetup(current => !current)}
              >
                <span>
                  {showPipelineSetup
                    ? 'Hide pipeline setup'
                    : 'Show pipeline setup'}
                </span>
                <span className="disclosure-meta">Architecture</span>
              </button>

              {showPipelineSetup ? (
                <div className="advanced-panel pipeline-panel">
                  <div className="section-header">
                    <div>
                      <h3>Pipeline Setup</h3>
                      <p className="panel-subtitle">
                        This is intentionally secondary in the UI. It exists so
                        you can explain the architecture once, then get it out of
                        the way.
                      </p>
                    </div>
                  </div>

                  <div className="pipeline-summary-grid">
                    <div className="pipeline-summary-card">
                      <div className="signal-label">First Pass</div>
                      <span className="mode-pill mode-pill-quiet">
                        {getModelLabel(primaryModelId)}
                      </span>
                      <div className="signal-copy">
                        Cheap classifier for easy, low-ambiguity changes.
                      </div>
                    </div>

                    <div className="pipeline-summary-card">
                      <div className="signal-label">Escalation</div>
                      <span className="mode-pill mode-pill-warning">
                        {getModelLabel(escalationModelId)}
                      </span>
                      <div className="signal-copy">
                        Runs only when the first pass stays medium, weak, or
                        unclear.
                      </div>
                    </div>

                    <div className="pipeline-summary-card">
                      <div className="signal-label">Fallback</div>
                      <span className="mode-pill mode-pill-danger">
                        Deterministic
                      </span>
                      <div className="signal-copy">
                        Safety net for evals, gating, and model failure.
                      </div>
                    </div>
                  </div>

                  <div className="pipeline-option">
                    <label
                      className="pipeline-option-toggle"
                      htmlFor="simulate-model-fallback"
                    >
                      <input
                        id="simulate-model-fallback"
                        type="checkbox"
                        checked={simulateModelFallback}
                        onChange={event =>
                          setSimulateModelFallback(event.target.checked)
                        }
                      />
                      <span>Simulate model fallback</span>
                    </label>
                    <p className="helper">
                      Skip AI model calls and force the deterministic fallback
                      path for testing.
                    </p>
                  </div>

                  <div className="source-note">
                    Swap models in code or through `RISK_PRIMARY_MODEL` and
                    `RISK_ESCALATION_MODEL` without changing the app flow.
                  </div>
                </div>
              ) : null}
            </form>
          </div>
        </div>

        {/* Right pane: live status plus summary, trace, and GitHub output views. */}
        <div className="right-column">
          {showAnalysisPanels ? (
            <>
              {isAnalyzing ? (
                <div className="active-review-banner" aria-live="polite">
                  <div className="active-review-banner-row">
                    <div className="active-review-copy">
                      <div className="signal-label">Active Review</div>
                      <h2>Review in progress.</h2>
                      <p>Analyzing change. This can take a few seconds.</p>
                    </div>

                    <div className="active-review-stage">
                      <span className="active-review-dot" aria-hidden="true" />
                      <div>
                        <span className={getProgressPillClass(reviewProgress)}>
                          {reviewProgress?.label ?? 'Starting'}
                        </span>
                        <p>
                          {reviewProgress?.detail ??
                            'Grading the change artifact before generating the delivery output.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="results-view-toggle">
                <button
                  type="button"
                  className={`results-view-button ${
                    activeResultsView === 'summary' ? 'active' : ''
                  }`}
                  onClick={() => setActiveResultsView('summary')}
                >
                  Summary
                </button>
                <button
                  type="button"
                  className={`results-view-button ${
                    activeResultsView === 'trace' ? 'active' : ''
                  }`}
                  onClick={() => setActiveResultsView('trace')}
                >
                  Trace
                </button>
                <button
                  type="button"
                  className={`results-view-button ${
                    activeResultsView === 'github' ? 'active' : ''
                  }`}
                  onClick={() => setActiveResultsView('github')}
                >
                  GitHub Preview
                </button>
              </div>

              <div className="results-view-stage">
                {/* Summary view: final judgment, confidence, action, and operator report. */}
                {activeResultsView === 'summary' ? (
                  <div className="results-view-pane">
                    <div className="panel">
                      <div className="panel-inner">
                        <div className="section-header">
                          <div>
                            <h2>Risk Grade</h2>
                            <p className="panel-subtitle">
                              The primary judgment, the action to take, and the
                              supporting rationale.
                            </p>
                          </div>
                          <span
                            className={
                              assessment
                                ? getRiskBadgeClass(assessment.riskLevel)
                                : 'badge badge-unknown'
                            }
                          >
                            {assessment?.riskLevel ?? 'pending'}
                          </span>
                        </div>

                        {assessment ? (
                          <>
                            <div className="preview-block">
                              <div className="signal-label">Executive Summary</div>
                              <div className="signal-copy">
                                {assessment.executiveSummary}
                              </div>
                            </div>

                            <div className="signal-grid summary-kpi-grid mode-grid-inline">
                              <div className="signal-card">
                                <div className="signal-label">Confidence</div>
                                <span className={confidenceDisplay?.className}>
                                  {confidenceDisplay?.label}
                                </span>
                                <div className="signal-copy">
                                  {confidenceDisplay?.copy}
                                </div>
                              </div>

                              <div className="signal-card">
                                <div className="signal-label">Expected Scope</div>
                                <span className={expectedScopeDisplay?.className}>
                                  {expectedScopeDisplay?.label}
                                </span>
                                <div className="signal-copy">
                                  {expectedScopeDisplay?.copy}
                                </div>
                              </div>

                              <div className="signal-card">
                                <div className="signal-label">Missing Info</div>
                                <span className={missingInfoDisplay?.className}>
                                  {missingInfoDisplay?.label}
                                </span>
                                <div className="signal-copy">
                                  {missingInfoDisplay?.copy}
                                </div>
                              </div>

                              <div className="signal-card">
                                <div className="signal-label">Recommended Action</div>
                                <span className={actionDisplay?.className}>
                                  {actionDisplay?.label}
                                </span>
                                <div className="signal-copy">
                                  {actionDisplay?.copy}
                                </div>
                              </div>
                            </div>

                            <div className="preview-columns summary-context-grid">
                              <div className="preview-block">
                                <div className="signal-label">Why This Grade</div>
                                <ul className="list">
                                  {assessment.reasoning.map(reason => (
                                    <li key={reason}>{reason}</li>
                                  ))}
                                </ul>
                              </div>

                              <div className="preview-block">
                                <div className="signal-label">
                                  Questions Before Approval
                                </div>
                                <ul className="list">
                                  {assessment.missingInfo.length > 0 ? (
                                    assessment.missingInfo.map(item => (
                                      <li key={item}>{item}</li>
                                    ))
                                  ) : (
                                    <li>No major information gaps were flagged.</li>
                                  )}
                                </ul>
                              </div>
                            </div>

                            <div className="delivery-panel">
                              <div className="section-header">
                                <div>
                                  <h3>Delivery Output</h3>
                                  <p className="panel-subtitle">
                                    Shared review output for the PR gate and the
                                    operator-facing narrative.
                                  </p>
                                </div>
                                <span
                                  className={
                                    gateStatusDisplay?.className ??
                                    'mode-pill mode-pill-quiet'
                                  }
                                >
                                  {gateStatusDisplay?.label ?? 'Pending'}
                                </span>
                              </div>

                              {error ? (
                                <div className="error-banner">
                                  Something went wrong while requesting the
                                  analysis. The server can still fall back, but a
                                  client transport error can interrupt the run.
                                </div>
                              ) : null}

                              {reviewProgress ? (
                                <div className="source-note">
                                  <span
                                    className={getProgressPillClass(reviewProgress)}
                                  >
                                    {reviewProgress.label}
                                  </span>{' '}
                                  {reviewProgress.detail}
                                </div>
                              ) : null}

                              <div className="report-header report-header-inline">
                                <div>
                                  <div className="signal-label">Final Report</div>
                                </div>
                                <span className={statusClass}>{status}</span>
                              </div>

                              <div className="report-frame report-frame-compact">
                                {report ? (
                                  <pre className="report-copy">{report}</pre>
                                ) : (
                                  <div
                                    className={`report-empty report-empty-compact${
                                      isAnalyzing ? ' report-empty-passive' : ''
                                    }`}
                                  >
                                    <h3>{reportEmptyTitle}</h3>
                                    <p>{reportEmptyCopy}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div
                            className={`report-empty${
                              isAnalyzing ? ' report-empty-passive' : ''
                            }`}
                          >
                            <h3>{workbenchEmptyTitle}</h3>
                            <p>{workbenchEmptyCopy}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Trace view: model path provenance and deterministic guardrail context. */}
                {activeResultsView === 'trace' ? (
                  <div className="results-view-pane trace-pane">
                    <div className="panel">
                      <div className="panel-inner">
                        <h3>Review Trail</h3>
                        <p className="panel-subtitle">
                          How the run moved through the cheap-first path,
                          escalation, and fallback.
                        </p>

                        {reviewResult ? (
                          <>
                            <div className="mode-grid trace-mode-grid">
                              <div className="mode-card">
                                <div className="signal-label">Path</div>
                                <span className={reviewPathDisplay?.className}>
                                  {reviewPathDisplay?.label}
                                </span>
                                <div className="signal-copy">
                                  {reviewPathDisplay?.copy}
                                </div>
                              </div>

                              <div className="mode-card">
                                <div className="signal-label">Primary Model</div>
                                <span className="mode-pill mode-pill-quiet">
                                  {getModelLabel(reviewResult.trail.primaryModelId)}
                                </span>
                                <div className="signal-copy">
                                  First pass verdict:{' '}
                                  {formatVerdict(reviewResult.initialAssessment)}
                                </div>
                              </div>

                              <div className="mode-card">
                                <div className="signal-label">Escalation</div>
                                <span className="mode-pill mode-pill-quiet">
                                  {reviewResult.trail.escalationTriggered
                                    ? getModelLabel(
                                        reviewResult.trail.escalationModelId,
                                      )
                                    : 'Not needed'}
                                </span>
                                <div className="signal-copy">
                                  {reviewResult.trail.escalationTriggered
                                    ? reviewResult.trail.escalationReason
                                    : 'The first pass was decisive enough to stop there.'}
                                </div>
                              </div>

                              <div className="mode-card">
                                <div className="signal-label">Final Source</div>
                                <span className="mode-pill mode-pill-active">
                                  {getModelLabel(reviewResult.trail.finalModelId)}
                                </span>
                                <div className="signal-copy">
                                  Final verdict:{' '}
                                  {formatVerdict(reviewResult.assessment)}
                                </div>
                              </div>
                            </div>

                            {reviewResult.trail.escalationTriggered &&
                            reviewResult.initialAssessment &&
                            !reviewResult.trail.fallbackUsed ? (
                              <div className="review-comparison">
                                <button
                                  type="button"
                                  className="disclosure-button"
                                  onClick={() =>
                                    setShowReviewComparison(current => !current)
                                  }
                                >
                                  <span>
                                    {showReviewComparison
                                      ? 'Hide review comparison'
                                      : 'Compare first pass and escalated review'}
                                  </span>
                                  <span className="disclosure-meta">Review delta</span>
                                </button>

                                {showReviewComparison ? (
                                  <div className="comparison-grid">
                                    <div className="comparison-card">
                                      <div className="signal-label">First Pass</div>
                                      <span className="mode-pill mode-pill-quiet">
                                        {getModelLabel(
                                          reviewResult.trail.primaryModelId,
                                        )}
                                      </span>
                                      <div className="comparison-metric">
                                        {formatVerdict(reviewResult.initialAssessment)}
                                      </div>
                                      <div className="signal-copy">
                                        {
                                          reviewResult.initialAssessment
                                            .executiveSummary
                                        }
                                      </div>
                                    </div>

                                    <div className="comparison-card">
                                      <div className="signal-label">Final Review</div>
                                      <span className="mode-pill mode-pill-active">
                                        {getModelLabel(
                                          reviewResult.trail.finalModelId,
                                        )}
                                      </span>
                                      <div className="comparison-metric">
                                        {formatVerdict(reviewResult.assessment)}
                                      </div>
                                      <div className="signal-copy">
                                        {reviewResult.assessment.executiveSummary}
                                      </div>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="report-empty">
                            <h3>Trail will appear after analysis.</h3>
                            <p>
                              Run a review to inspect the same path used for the
                              gate decision.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="panel">
                      <div className="panel-inner">
                        <div className="section-header">
                          <div>
                            <h3>Deterministic Guardrail</h3>
                            <p className="panel-subtitle">
                              Provenance and fallback context behind the primary
                              AI judgment.
                            </p>
                          </div>
                        </div>

                        {reviewResult ? (
                          <>
                            <div className="provenance-grid">
                              <div className="provenance-block">
                                <div className="signal-label">Baseline Grade</div>
                                <div className="chip-list">
                                  <span
                                    className={getRiskBadgeClass(
                                      reviewResult.baselineAssessment.riskLevel,
                                    )}
                                  >
                                    {reviewResult.baselineAssessment.riskLevel}
                                  </span>
                                  <span className="chip chip-neutral">
                                    {
                                      reviewResult.baselineAssessment
                                        .evidenceStrength
                                    }{' '}
                                    evidence
                                  </span>
                                </div>
                              </div>

                              <div className="provenance-block">
                                <div className="signal-label">Signals Used</div>
                                <div className="chip-list">
                                  {reviewResult.baselineAssessment.signalsUsed.map(
                                    signal => (
                                      <span
                                        key={signal}
                                        className="chip chip-positive"
                                      >
                                        {signal}
                                      </span>
                                    ),
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="reason-block">
                              <div className="signal-label">Missing Evidence</div>
                              <div className="chip-list">
                                {reviewResult.baselineAssessment.missingEvidence
                                  .length > 0 ? (
                                  reviewResult.baselineAssessment.missingEvidence.map(
                                    signal => (
                                      <span
                                        key={signal}
                                        className="chip chip-warning"
                                      >
                                        {signal}
                                      </span>
                                    ),
                                  )
                                ) : (
                                  <span className="chip chip-neutral">
                                    No major gaps flagged
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="reason-block">
                              <div className="signal-label">Rollback Lens</div>
                              <ul className="list">
                                {reviewResult.baselineAssessment.rollbackConsiderations
                                  .slice(0, 3)
                                  .map(item => (
                                    <li key={item}>{item}</li>
                                  ))}
                              </ul>
                            </div>
                          </>
                        ) : (
                          <div className="report-empty">
                            <h3>No guardrail output yet.</h3>
                            <p>
                              Run a change review to compare the AI verdict to the
                              deterministic safety net.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {reviewResult?.toolActivity.length ? (
                      <div className="panel">
                        <div className="panel-inner">
                          <div className="section-header">
                            <div>
                              <h3>Tool Activity</h3>
                              <p className="panel-subtitle">
                                Checklist and runbook lookups used during the
                                review.
                              </p>
                            </div>
                          </div>

                          <div className="tool-grid">
                            {reviewResult.toolActivity.map((activity, index) => (
                              <div
                                key={`${activity.stage}-${activity.toolName}-${index}`}
                                className="tool-card"
                              >
                                <div className="sample-title-row">
                                  <span className="sample-title">
                                    {activity.toolName}
                                  </span>
                                  <span className="source-pill">
                                    {renderToolStage(activity.stage)}
                                  </span>
                                </div>
                                <div className="tool-copy">{activity.summary}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* GitHub view: the exact PR comment payload this run would post. */}
                {activeResultsView === 'github' ? (
                  <div className="results-view-pane">
                    <div className="panel github-preview-panel">
                      <div className="panel-inner">
                        <div className="section-header">
                          <div>
                            <h2>GitHub Preview</h2>
                            <p className="panel-subtitle">
                              The exact comment payload produced after the shared
                              review engine grades the artifact.
                            </p>
                          </div>
                          {gateStatusDisplay ? (
                            <span className={gateStatusDisplay.className}>
                              {gateStatusDisplay.label}
                            </span>
                          ) : null}
                        </div>

                        {reviewResult && decision && githubPreview ? (
                          <div className="github-comment-shell">
                            <div className="github-comment-header">
                              <div className="github-avatar">CR</div>
                              <div className="github-comment-meta">
                                <strong>release-guard[bot]</strong> commented
                                just now
                              </div>
                            </div>

                            <div className="github-comment-body">
                              <pre className="report-copy">
                                {githubPreview.commentBody}
                              </pre>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`report-empty${
                              isAnalyzing ? ' report-empty-passive' : ''
                            }`}
                          >
                            <h3>{githubEmptyTitle}</h3>
                            <p>{githubEmptyCopy}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="panel empty-results-panel">
              <div className="panel-inner">
                <div className="section-header">
                  <div>
                    <h2>Results Workspace</h2>
                    <p className="panel-subtitle">
                      The summary, trace, and GitHub preview appear after you run
                      an analysis.
                    </p>
                  </div>
                  <span className="mode-pill mode-pill-quiet">Idle</span>
                </div>

                <div className="empty-results-body">
                  <div>
                    <h3>Start from the left.</h3>
                    <p>
                      Choose a demo scenario or paste a real change, then hit
                      Analyze to see the verdict, the delivery output, and the
                      supporting trace.
                    </p>
                  </div>

                  <div className="empty-results-grid">
                    <div className="preview-block">
                      <div className="signal-label">Primary Review</div>
                      <p className="signal-copy">
                        Cheap first pass for easy cases.
                      </p>
                    </div>

                    <div className="preview-block">
                      <div className="signal-label">Auto Escalation</div>
                      <p className="signal-copy">
                        Stronger model takes over when the first call is not
                        confident enough.
                      </p>
                    </div>

                    <div className="preview-block">
                      <div className="signal-label">Fallback Guardrail</div>
                      <p className="signal-copy">
                        Deterministic safety net for reliable enterprise gating.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
