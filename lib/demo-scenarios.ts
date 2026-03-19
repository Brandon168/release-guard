import { getFixtureById } from '@/lib/fixtures';
import { type ArtifactType, type ChangeFixture } from '@/lib/types';

export type DemoScenario = {
  id: string;
  title: string;
  subtitle: string;
  sourceLabel: string;
  sourceKind: string;
  artifactType: ArtifactType;
  artifactText: string;
  fixture: ChangeFixture;
};

function requireFixture(id: string) {
  const fixture = getFixtureById(id);

  if (!fixture) {
    throw new Error(`Missing fixture: ${id}`);
  }

  return fixture;
}

export const demoScenarios: DemoScenario[] = [
  {
    id: 'github-billing-copy',
    title: 'PR diff: billing banner copy',
    subtitle: 'GitHub-style customer copy tweak with an existing flag.',
    sourceLabel: 'verse-cell/billing-web#1842',
    sourceKind: 'GitHub PR',
    artifactType: 'pr_diff',
    artifactText: [
      'PR #1842 · billing-web',
      'Title: tighten overdue banner copy before renewal campaign',
      '',
      'diff --git a/apps/billing-web/src/banner.tsx b/apps/billing-web/src/banner.tsx',
      '- "Your payment is overdue."',
      '+ "Payment overdue. Update billing details to avoid interruption."',
      'Note: existing feature flag `billing_banner_v2` remains in place.',
    ].join('\n'),
    fixture: requireFixture('billing-banner-copy'),
  },
  {
    id: 'ticket-auth-upgrade',
    title: 'Change ticket: auth SDK upgrade',
    subtitle: 'Critical sign-in path change with staged rollout and rollback.',
    sourceLabel: 'CHG-4827',
    sourceKind: 'Change Ticket',
    artifactType: 'change_ticket',
    artifactText: [
      'CHG-4827',
      'Upgrade the authentication SDK in customer-portal and admin-console to the latest major version.',
      'Systems: customer-portal, admin-console, auth-api',
      'Rollout: employees first, then 5% of prod customer traffic before broad rollout.',
      'Success metric: login success rate, token refresh failures, 401 spikes.',
      'Rollback: redeploy the previous application images and invalidate only sessions created under the new release if needed.',
    ].join('\n'),
    fixture: requireFixture('auth-sdk-upgrade'),
  },
  {
    id: 'config-ingress-rewrite',
    title: 'Config change: ingress rewrite',
    subtitle: 'High-risk path rewrite affecting auth callbacks and user entry points.',
    sourceLabel: 'k8s/customer-portal/ingress-prod.yaml',
    sourceKind: 'Config Change',
    artifactType: 'config_change',
    artifactText: [
      'customer-portal ingress rewrite',
      '',
      'apiVersion: networking.k8s.io/v1',
      'kind: Ingress',
      'metadata:',
      '  name: customer-portal',
      'spec:',
      '  rules:',
      '    - host: app.example.com',
      '      http:',
      '        paths:',
      '          - path: /app',
      '-           backend: customer-portal-service',
      '+           backend: shared-gateway-service',
      '          - path: /account',
      '+           backend: shared-gateway-service',
      'Notes: auth callback routes and several static asset paths now traverse the shared gateway.',
    ].join('\n'),
    fixture: requireFixture('ingress-rewrite'),
  },
  {
    id: 'release-cache-layer',
    title: 'Release draft: shared cache layer',
    subtitle: 'Ambiguous shared-service rollout that should stay unknown.',
    sourceLabel: 'Release 2026.04 draft',
    sourceKind: 'Release Note',
    artifactType: 'release_note',
    artifactText: [
      'Release note draft',
      '"Introduce new shared cache layer for core services next sprint to reduce latency."',
      'No service list, topology, TTL policy, tenancy model, or migration plan included.',
    ].join('\n'),
    fixture: requireFixture('new-cache-layer'),
  },
];

export function getDemoScenarioById(id: string) {
  return demoScenarios.find(scenario => scenario.id === id);
}
