'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { startTransition, useState } from 'react';
import type { AnalysisUIMessage } from '@/lib/analysis-ui-message';
import { buildChangeRequestFromDraft } from '@/lib/artifact-ingestion';
import {
  demoScenarios,
  getDemoScenarioById,
  type DemoScenario,
} from '@/lib/demo-scenarios';
import {
  DEFAULT_ESCALATION_MODEL,
  DEFAULT_PRIMARY_MODEL,
  getModelLabel,
} from '@/lib/model';
import { evaluateRiskPolicy } from '@/lib/risk-policy';
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
    copy: 'The artifact needs sharper evidence before the gate should proceed.',
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

export function ChangeRiskWorkbench() {
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
  const [showReviewComparison, setShowReviewComparison] = useState(false);
  const [activeResultsView, setActiveResultsView] = useState<
    'workbench' | 'github'
  >('workbench');
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
    },
  });

  const submitRequest = formToRequest(form);
  const activeScenario = activeScenarioId
    ? getDemoScenarioById(activeScenarioId)
    : undefined;
  const latestAssistantMessage = [...messages]
    .reverse()
    .find(message => message.role === 'assistant');
  const report = extractText(latestAssistantMessage);
  const showAnalysisPanels =
    status === 'submitted' ||
    status === 'streaming' ||
    Boolean(reviewResult) ||
    Boolean(report) ||
    Boolean(error);
  const statusClass = `report-status status-${status}`;
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
  const decision = reviewResult
    ? evaluateRiskPolicy({
        assessment: reviewResult.assessment,
        trail: reviewResult.trail,
      })
    : null;
  const gateStatusDisplay = decision
    ? getGateStatusDisplay(decision.status)
    : null;

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
    setReviewProgress(null);
    setShowReviewComparison(false);
    setActiveResultsView('workbench');
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
    setReviewProgress(null);
    setShowReviewComparison(false);
    setActiveResultsView('workbench');
    setMessages([]);

    await sendMessage({
      text:
        submitRequest.title ||
        submitRequest.summary ||
        submitRequest.artifactText ||
        'Assess the release risk for this artifact.',
    }, {
      body: {
        request: submitRequest,
      },
    });
  }

  return (
    <main className="shell">
      <section className="hero-band">
        <div className="hero hero-primary hero-full">
          <span className="eyebrow">Sr Solutions Architect Take-Home</span>
          <div>
            <h1>Release Guard</h1>
            <p>
              Paste a proposed change artifact to run a cheap first-pass review,
              auto-escalate when the judgment is uncertain, and fall back safely
              when the model path breaks.
            </p>
          </div>
          <div className="hero-inline-meta">
            <span className="source-pill">GitHub-first workflow</span>
            <span className="hero-inline-copy">
              Use the GitHub preview tab to show the PR automation experience
              without leaving the workbench.
            </span>
          </div>
        </div>
      </section>

      <section className="workspace">
        <div className="panel">
          <div className="panel-inner">
            <h2>Change Artifact</h2>
            <p className="panel-subtitle">
              One primary input, four curated demos, and an optional refinement
              panel when you want to add explicit rollout or rollback detail.
            </p>

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

            <form className="form" onSubmit={handleSubmit}>
              <div className="field-grid">
                <div className="field">
                  <label htmlFor="artifact-type">Artifact type</label>
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
                Low-cost first pass, automatic escalation on uncertainty, and a
                deterministic fallback underneath both the workbench and the PR
                gate.
              </span>

              <div className="field">
                <label htmlFor="artifact-text">Artifact</label>
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
                  The model is expected to judge the risk directly. The
                  deterministic engine only acts as a guardrail and fallback.
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

              <div className="actions">
                <button
                  className="action-button"
                  type="submit"
                  disabled={status === 'submitted' || status === 'streaming'}
                >
                  {status === 'submitted' || status === 'streaming'
                    ? 'Analyzing...'
                    : 'Analyze Change'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={resetWorkspace}
                >
                  Reset
                </button>
                {(status === 'submitted' || status === 'streaming') && (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => stop()}
                  >
                    Stop Stream
                  </button>
                )}
              </div>

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
                        {getModelLabel(DEFAULT_PRIMARY_MODEL)}
                      </span>
                      <div className="signal-copy">
                        Cheap classifier for easy, low-ambiguity changes.
                      </div>
                    </div>

                    <div className="pipeline-summary-card">
                      <div className="signal-label">Escalation</div>
                      <span className="mode-pill mode-pill-warning">
                        {getModelLabel(DEFAULT_ESCALATION_MODEL)}
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

                  <div className="source-note">
                    Swap models in code or through `RISK_PRIMARY_MODEL` and
                    `RISK_ESCALATION_MODEL` without changing the app flow.
                  </div>
                </div>
              ) : null}
            </form>
          </div>
        </div>

        <div className="right-column">
          {showAnalysisPanels ? (
            <>
              <div className="results-view-toggle">
                <button
                  type="button"
                  className={`results-view-button ${
                    activeResultsView === 'workbench' ? 'active' : ''
                  }`}
                  onClick={() => setActiveResultsView('workbench')}
                >
                  Workbench View
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
                <div
                  className={`results-view-pane ${
                    activeResultsView === 'workbench'
                      ? 'results-view-pane-active'
                      : 'results-view-pane-hidden'
                  }`}
                  aria-hidden={activeResultsView !== 'workbench'}
                  inert={activeResultsView !== 'workbench'}
                >
                  <div className="panel">
                    <div className="panel-inner">
                      <div className="section-header">
                        <div>
                          <h2>Risk Grade</h2>
                          <p className="panel-subtitle">
                            This is the model-generated judgment. The deterministic
                            baseline is still available below as a guardrail, but it
                            is no longer the primary visible grade.
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

                          <div className="signal-grid mode-grid-inline">
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

                          <div className="preview-columns">
                            <div className="preview-block">
                              <div className="signal-label">Why This Grade</div>
                              <ul className="list">
                                {assessment.reasoning.map(reason => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            </div>

                            <div className="preview-block">
                              <div className="signal-label">Questions Before Approval</div>
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
                        </>
                      ) : (
                        <div className="report-empty">
                          <h3>{reviewProgress?.label ?? 'Waiting to start.'}</h3>
                          <p>
                            {reviewProgress?.detail ??
                              'Submit an artifact to watch the primary model run, escalate when needed, and return a final judgment.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="panel report-panel">
                    <div className="panel-inner">
                      <div className="report-header">
                        <div>
                          <h2>Final Report</h2>
                          <p className="panel-subtitle">
                            A readable narrative generated from the structured
                            review. It supports the grade above instead of replacing
                            it.
                          </p>
                        </div>
                        <span className={statusClass}>{status}</span>
                      </div>

                      {error ? (
                        <div className="error-banner">
                          Something went wrong while requesting the analysis. The
                          workbench will fall back when the server can, but a client
                          transport error can still interrupt the run.
                        </div>
                      ) : null}

                      {reviewProgress ? (
                        <div className="source-note">
                          <span className={getProgressPillClass(reviewProgress)}>
                            {reviewProgress.label}
                          </span>{' '}
                          {reviewProgress.detail}
                        </div>
                      ) : null}

                      <div className="report-frame">
                        {report ? (
                          <pre className="report-copy">{report}</pre>
                        ) : (
                          <div className="report-empty">
                            <h3>Ready for a real artifact.</h3>
                            <p>
                              Submit one change artifact and the workbench will show
                              the review path, the final AI judgment, and the
                              deterministic backup signal side by side.
                            </p>
                          </div>
                        )}
                      </div>

                      {reviewResult?.toolActivity.length ? (
                        <div className="tool-panel">
                          <div className="section-header">
                            <div>
                              <h3>Tool Activity</h3>
                              <p className="panel-subtitle">
                                Lightweight traces from checklist and runbook
                                lookups.
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
                      ) : null}
                    </div>
                  </div>

                  <div className="analysis-secondary-grid">
                    <div className="panel">
                      <div className="panel-inner">
                        <h3>Review Trail</h3>
                        <p className="panel-subtitle">
                          How the run moved through the cheap-first path, escalation,
                          and fallback behavior.
                        </p>

                        {reviewResult ? (
                          <>
                            <div className="mode-grid">
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
                                  First pass verdict: {formatVerdict(reviewResult.initialAssessment)}
                                </div>
                              </div>

                              <div className="mode-card">
                                <div className="signal-label">Escalation</div>
                                <span className="mode-pill mode-pill-quiet">
                                  {reviewResult.trail.escalationTriggered
                                    ? getModelLabel(reviewResult.trail.escalationModelId)
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
                                  Final verdict: {formatVerdict(reviewResult.assessment)}
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
                                  <span className="disclosure-meta">Model diff</span>
                                </button>

                                {showReviewComparison ? (
                                  <div className="comparison-grid">
                                    <div className="comparison-card">
                                      <div className="signal-label">First Pass</div>
                                      <span className="mode-pill mode-pill-quiet">
                                        {getModelLabel(reviewResult.trail.primaryModelId)}
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
                                        {getModelLabel(reviewResult.trail.finalModelId)}
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
                              The app surfaces the same review path that GitHub
                              Actions uses for automated PR gating.
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
                              The fallback and eval layer. Useful for provenance and
                              reliability, but intentionally secondary to the AI
                              judgment above.
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
                                    {reviewResult.baselineAssessment.evidenceStrength} evidence
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
                              Run an artifact to compare the AI verdict to the
                              deterministic safety net.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className={`results-view-pane ${
                    activeResultsView === 'github'
                      ? 'results-view-pane-active'
                      : 'results-view-pane-hidden'
                  }`}
                  aria-hidden={activeResultsView !== 'github'}
                  inert={activeResultsView !== 'github'}
                >
                  <div className="panel github-preview-panel">
                    <div className="panel-inner">
                      <div className="section-header">
                        <div>
                          <h2>GitHub Preview</h2>
                          <p className="panel-subtitle">
                            A simulated PR comment so you can demo the automation
                            workflow without leaving the app.
                          </p>
                        </div>
                        {gateStatusDisplay ? (
                          <span className={gateStatusDisplay.className}>
                            {gateStatusDisplay.label}
                          </span>
                        ) : null}
                      </div>

                      {reviewResult && decision ? (
                        <div className="github-comment-shell">
                          <div className="github-comment-header">
                            <div className="github-avatar">CR</div>
                            <div className="github-comment-meta">
                              <strong>release-guard[bot]</strong> commented
                              just now
                            </div>
                          </div>

                          <div className="github-comment-body">
                            <h3>Release Guard</h3>

                            <div className="github-comment-section">
                              <ul className="github-bullet-list">
                                <li>Status: {decision.status}</li>
                                <li>Risk grade: {reviewResult.assessment.riskLevel}</li>
                                <li>Confidence: {reviewResult.assessment.confidence}</li>
                                <li>Expected scope: {reviewResult.assessment.expectedScope}</li>
                                <li>
                                  Recommended action:{' '}
                                  {reviewResult.assessment.recommendedAction}
                                </li>
                              </ul>
                            </div>

                            <div className="github-comment-section">
                              <h4>Review Path</h4>
                              <ul className="github-bullet-list">
                                <li>Path: {reviewResult.trail.reviewPath}</li>
                                <li>
                                  Primary model:{' '}
                                  {getModelLabel(reviewResult.trail.primaryModelId)}
                                </li>
                                <li>
                                  Escalation:{' '}
                                  {reviewResult.trail.escalationTriggered
                                    ? `${getModelLabel(reviewResult.trail.escalationModelId)} because ${reviewResult.trail.escalationReason}`
                                    : 'not needed'}
                                </li>
                                <li>
                                  Final source:{' '}
                                  {getModelLabel(reviewResult.trail.finalModelId)}
                                </li>
                              </ul>
                            </div>

                            <div className="github-comment-section">
                              <h4>Gate Reasons</h4>
                              <ul className="github-bullet-list">
                                {decision.reasons.length > 0 ? (
                                  decision.reasons.map(reason => (
                                    <li key={reason}>{reason}</li>
                                  ))
                                ) : (
                                  <li>No policy issues detected.</li>
                                )}
                              </ul>
                            </div>

                            <div className="github-comment-section">
                              <h4>Missing Evidence</h4>
                              <ul className="github-bullet-list">
                                {reviewResult.assessment.missingInfo.length > 0 ? (
                                  reviewResult.assessment.missingInfo.map(item => (
                                    <li key={item}>{item}</li>
                                  ))
                                ) : (
                                  <li>None.</li>
                                )}
                              </ul>
                            </div>

                            <div className="github-comment-section">
                              <h4>Executive Summary</h4>
                              <p>{reviewResult.assessment.executiveSummary}</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="report-empty">
                          <h3>{reviewProgress?.label ?? 'No PR comment yet.'}</h3>
                          <p>
                            {reviewProgress?.detail ??
                              'Run an artifact to generate the simulated PR comment preview.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="panel empty-results-panel">
              <div className="panel-inner">
                <div className="section-header">
                  <div>
                    <h2>Results Workspace</h2>
                    <p className="panel-subtitle">
                      The right side stays quiet until you explicitly run an
                      analysis.
                    </p>
                  </div>
                  <span className="mode-pill mode-pill-quiet">Idle</span>
                </div>

                <div className="empty-results-body">
                  <div>
                    <h3>Start from the left.</h3>
                    <p>
                      Choose a demo scenario or paste a real artifact, then hit
                      Analyze to see the review path, final grade, and fallback
                      guardrail.
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
