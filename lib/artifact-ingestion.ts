import {
  normalizeChangeRequest,
  type ArtifactType,
  type ChangeCategory,
  type ChangeRequest,
  type Environment,
} from '@/lib/types';

type ArtifactDraft = {
  title?: string;
  artifactType?: ArtifactType;
  artifactText?: string;
};

const artifactCategoryFallbacks: Record<ArtifactType, ChangeCategory> = {
  pr_diff: 'application',
  terraform_plan: 'infrastructure',
  change_ticket: 'delivery',
  release_note: 'delivery',
  config_change: 'infrastructure',
  unknown: 'unknown',
};

const serviceSuffixes = [
  'api',
  'web',
  'worker',
  'portal',
  'console',
  'gateway',
  'cluster',
  'assets',
  'postgres',
  'redis',
] as const;

const infrastructureMatchers = [
  { label: 'terraform', patterns: ['terraform', 'plan:', 'aws_', 'module.'] },
  { label: 'database', patterns: ['database', 'schema', 'migration', 'postgres', '.sql', 'index concurrently'] },
  { label: 'network', patterns: ['security group', 'route table', 'ingress', 'vpc', 'subnet', 'load balancer', 'cidr'] },
  { label: 'auth', patterns: ['auth', 'login', 'jwt', 'session', 'oauth', 'sso'] },
  { label: 'kubernetes', patterns: ['kubernetes', 'k8s', 'daemonset', 'deployment', 'replica', 'pod'] },
  { label: 'config', patterns: ['env', 'config', 'flag', 'yaml', 'toml'] },
  { label: 'observability', patterns: ['monitor', 'metric', 'latency', '5xx', 'dashboard', 'alert', 'health check'] },
  { label: 'cache', patterns: ['cache', 'redis', 'ttl'] },
];

function cleanSentence(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function dedupe(list: string[]) {
  return [...new Set(list)];
}

function splitLines(text: string) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function findLineByPrefix(lines: string[], prefixes: string[]) {
  return lines.find(line =>
    prefixes.some(prefix => line.toLowerCase().startsWith(prefix.toLowerCase())),
  );
}

function findLinesByPattern(lines: string[], patterns: string[]) {
  return lines.filter(line =>
    patterns.some(pattern => line.toLowerCase().includes(pattern.toLowerCase())),
  );
}

function extractListFromTaggedLine(lines: string[], labels: string[]) {
  const taggedLine = findLineByPrefix(
    lines,
    labels.map(label => `${label.toLowerCase()}:`),
  );

  if (!taggedLine) {
    return [];
  }

  const [, rawValue = ''] = taggedLine.split(':', 2);

  return rawValue
    .split(/[,]/)
    .map(item => item.replace(/[`"]/g, '').trim())
    .filter(Boolean);
}

function looksLikeService(value: string) {
  const normalized = value.toLowerCase().replace(/[`"]/g, '').trim();

  if (
    !normalized ||
    normalized.includes('/') ||
    normalized.includes('.') ||
    normalized.includes('_') ||
    normalized.startsWith('sg-') ||
    normalized.startsWith('vpc-') ||
    normalized.startsWith('subnet-') ||
    normalized === 'prod' ||
    normalized === 'production'
  ) {
    return false;
  }

  if (serviceSuffixes.some(suffix => normalized.endsWith(`-${suffix}`))) {
    return true;
  }

  return normalized === 'postgres' || normalized === 'redis';
}

function extractServices(text: string) {
  const lines = splitLines(text);
  const fromTaggedLines = [
    ...extractListFromTaggedLine(lines, ['services', 'systems']),
    ...extractListFromTaggedLine(lines, ['scope']),
  ];

  const backticked = [...text.matchAll(/`([^`\n]+)`/g)]
    .map(match => match[1]?.trim() ?? '')
    .filter(looksLikeService);

  const hyphenatedTokens = [...text.matchAll(/\b[a-z0-9]+(?:-[a-z0-9]+){1,5}\b/gi)]
    .map(match => match[0]?.trim() ?? '')
    .filter(looksLikeService);

  return dedupe([...fromTaggedLines, ...backticked, ...hyphenatedTokens]).slice(0, 6);
}

function extractInfrastructureAreas(text: string) {
  const areas = infrastructureMatchers
    .filter(({ patterns }) =>
      patterns.some(pattern => text.toLowerCase().includes(pattern.toLowerCase())),
    )
    .map(({ label }) => label);

  return dedupe(areas);
}

function detectEnvironment(text: string): Environment {
  const normalized = text.toLowerCase();

  if (/\bprod(uction)?\b/.test(normalized)) {
    return 'production';
  }

  if (/\bstag(e|ing)\b/.test(normalized)) {
    return 'staging';
  }

  if (/\bdev(elopment)?\b/.test(normalized)) {
    return 'development';
  }

  return 'unknown';
}

function inferCategory(artifactType: ArtifactType, text: string): ChangeCategory {
  const normalized = text.toLowerCase();

  if (
    normalized.includes('database') ||
    normalized.includes('schema') ||
    normalized.includes('postgres') ||
    normalized.includes('create index') ||
    normalized.includes('alter table')
  ) {
    return 'database';
  }

  if (
    normalized.includes('security group') ||
    normalized.includes('route table') ||
    normalized.includes('ingress') ||
    normalized.includes('vpc') ||
    normalized.includes('load balancer') ||
    normalized.includes('cidr')
  ) {
    return 'network';
  }

  if (
    normalized.includes('auth') ||
    normalized.includes('login') ||
    normalized.includes('session') ||
    normalized.includes('jwt')
  ) {
    return 'security';
  }

  if (
    normalized.includes('monitor') ||
    normalized.includes('logging') ||
    normalized.includes('alert') ||
    normalized.includes('dashboard')
  ) {
    return 'observability';
  }

  if (
    normalized.includes('terraform') ||
    normalized.includes('kubernetes') ||
    normalized.includes('deployment') ||
    normalized.includes('memory') ||
    normalized.includes('replica') ||
    normalized.includes('env')
  ) {
    return 'infrastructure';
  }

  return artifactCategoryFallbacks[artifactType];
}

function extractField(lines: string[], labels: string[], patterns: string[]) {
  const explicitLine = findLineByPrefix(
    lines,
    labels.map(label => `${label.toLowerCase()}:`),
  );

  if (explicitLine) {
    return cleanSentence(explicitLine.split(':').slice(1).join(':'));
  }

  const matchingLines = findLinesByPattern(lines, patterns);

  if (!matchingLines.length) {
    return '';
  }

  return cleanSentence(matchingLines.slice(0, 2).join(' '));
}

function extractKnownUnknowns(lines: string[]) {
  const matches = lines.filter(line =>
    /(tbd|unknown|not included|not specified|no code diff|no service list|still being discussed|unclear)/i.test(
      line,
    ),
  );

  return cleanSentence(matches.slice(0, 2).join(' '));
}

function inferSafeguards(text: string, lines: string[]) {
  const explicit = extractField(lines, ['safeguards'], ['feature flag', 'canary']);

  if (explicit) {
    return explicit;
  }

  const normalized = text.toLowerCase();

  if (normalized.includes('feature flag')) {
    return 'Feature flag remains available for rapid disable.';
  }

  if (normalized.includes('concurrently')) {
    return 'Concurrent execution strategy reduces blocking risk.';
  }

  if (
    normalized.includes('one region') ||
    normalized.includes('5%') ||
    normalized.includes('10%') ||
    normalized.includes('50%')
  ) {
    return 'A staged rollout is already described in the artifact.';
  }

  return '';
}

function summarizeArtifact(artifactType: ArtifactType, lines: string[]) {
  if (!lines.length) {
    return '';
  }

  const summaryLines = lines.slice(0, 4);
  const summary = cleanSentence(summaryLines.join(' '));

  if (artifactType === 'pr_diff' && summary.length > 320) {
    return `${summary.slice(0, 317)}...`;
  }

  return summary;
}

function inferTitle({
  artifactType,
  artifactText,
  title,
}: {
  artifactType: ArtifactType;
  artifactText: string;
  title: string;
}) {
  if (title) {
    return title.trim();
  }

  const lines = splitLines(artifactText);
  const firstLine = lines[0];

  if (!firstLine) {
    return '';
  }

  if (artifactType === 'pr_diff') {
    const fileMatch = artifactText.match(/diff --git a\/([^\s]+) b\//);
    if (fileMatch?.[1]) {
      return `PR diff touching ${fileMatch[1]}`;
    }
  }

  if (artifactType === 'terraform_plan') {
    return 'Terraform plan review';
  }

  if (artifactType === 'config_change') {
    return 'Configuration change review';
  }

  return firstLine.replace(/^#+\s*/, '').trim();
}

export function deriveChangeRequestFromArtifact(draft: ArtifactDraft) {
  const artifactText = draft.artifactText?.trim() ?? '';
  const artifactType = draft.artifactType ?? 'unknown';
  const lines = splitLines(artifactText);

  if (!artifactText) {
    return normalizeChangeRequest({
      title: draft.title,
      artifactType,
      artifactText,
    });
  }

    return normalizeChangeRequest({
      title: inferTitle({
        artifactType,
        artifactText,
        title: draft.title?.trim() ?? '',
      }),
    summary: summarizeArtifact(artifactType, lines),
    artifactType,
    artifactText,
    category: inferCategory(artifactType, artifactText),
    environment: detectEnvironment(artifactText),
    services: extractServices(artifactText),
    infrastructureAreas: extractInfrastructureAreas(artifactText),
    rolloutPlan: extractField(
      lines,
      ['rollout', 'plan'],
      ['canary', 'one region', 'one replica', '%', 'phase', 'cluster by cluster', 'region by region'],
    ),
    rollbackPlan: extractField(
      lines,
      ['rollback', 'revert'],
      ['rollback', 'revert', 'restore', 'disable', 'set flag to 0'],
    ),
    observabilityPlan: extractField(
      lines,
      ['health checks', 'success metric', 'monitoring', 'observability'],
      ['latency', '5xx', 'error rate', 'health check', 'dashboard', 'metric', 'alert'],
    ),
    safeguards: inferSafeguards(artifactText, lines),
    changeWindow: extractField(
      lines,
      ['change window', 'execution window'],
      ['maintenance window', 'weekday', 'weekend', 'overnight', 'ct', 'et', 'pt', 'utc'],
    ),
    knownUnknowns: extractKnownUnknowns(lines),
  });
}

function mergeList(base: string[], override: string[]) {
  return override.length > 0 ? override : base;
}

function mergeText(base: string, override: string) {
  return override.trim() ? override.trim() : base;
}

function mergeEnum<T extends string>(base: T, override: T, emptyValue: T) {
  return override !== emptyValue ? override : base;
}

// Keep artifact parsing centralized so preview, fallback, and AI all share one
// normalized request shape instead of each layer re-implementing its own guesses.
export function buildChangeRequestFromDraft({
  artifact,
  overrides,
}: {
  artifact: ArtifactDraft;
  overrides?: Partial<ChangeRequest>;
}) {
  const derived = deriveChangeRequestFromArtifact(artifact);
  const requestOverrides = {
    title: overrides?.title?.trim() ?? '',
    summary: overrides?.summary?.trim() ?? '',
    artifactType: overrides?.artifactType ?? 'unknown',
    artifactText: overrides?.artifactText?.trim() ?? '',
    category: overrides?.category ?? 'unknown',
    environment: overrides?.environment ?? 'unknown',
    services: (overrides?.services ?? [])
      .map(item => item.trim())
      .filter(Boolean),
    infrastructureAreas: (overrides?.infrastructureAreas ?? [])
      .map(item => item.trim())
      .filter(Boolean),
    rolloutPlan: overrides?.rolloutPlan?.trim() ?? '',
    rollbackPlan: overrides?.rollbackPlan?.trim() ?? '',
    observabilityPlan: overrides?.observabilityPlan?.trim() ?? '',
    safeguards: overrides?.safeguards?.trim() ?? '',
    changeWindow: overrides?.changeWindow?.trim() ?? '',
    knownUnknowns: overrides?.knownUnknowns?.trim() ?? '',
  };

  return normalizeChangeRequest({
    ...derived,
    title: mergeText(derived.title, requestOverrides.title),
    summary: mergeText(derived.summary, requestOverrides.summary),
    artifactType: mergeEnum(derived.artifactType, requestOverrides.artifactType, 'unknown'),
    artifactText: mergeText(derived.artifactText, requestOverrides.artifactText),
    category: mergeEnum(derived.category, requestOverrides.category, 'unknown'),
    environment: mergeEnum(derived.environment, requestOverrides.environment, 'unknown'),
    services: mergeList(derived.services, requestOverrides.services),
    infrastructureAreas: mergeList(
      derived.infrastructureAreas,
      requestOverrides.infrastructureAreas,
    ),
    rolloutPlan: mergeText(derived.rolloutPlan, requestOverrides.rolloutPlan),
    rollbackPlan: mergeText(derived.rollbackPlan, requestOverrides.rollbackPlan),
    observabilityPlan: mergeText(
      derived.observabilityPlan,
      requestOverrides.observabilityPlan,
    ),
    safeguards: mergeText(derived.safeguards, requestOverrides.safeguards),
    changeWindow: mergeText(derived.changeWindow, requestOverrides.changeWindow),
    knownUnknowns: mergeText(derived.knownUnknowns, requestOverrides.knownUnknowns),
  });
}
