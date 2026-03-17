import { tool } from 'ai';
import { z } from 'zod';
import type { ArtifactType, ChangeCategory } from '@/lib/types';

type ChecklistEntry = {
  canonicalType: string;
  checks: string[];
  caution: string;
};

type RunbookEntry = {
  canonicalSystem: string;
  owner: string;
  watch: string[];
  rollback: string;
  notes: string;
};

const checklistCatalog: Record<string, ChecklistEntry> = {
  pr_diff: {
    canonicalType: 'pr_diff',
    checks: [
      'Confirm the diff scope is limited to the named service or user journey.',
      'Verify rollout control such as a flag, canary, or staged deploy exists.',
      'Identify the one metric that would force a stop or rollback.',
    ],
    caution: 'Diffs can look small while still touching high-impact paths like auth or payments.',
  },
  terraform_plan: {
    canonicalType: 'terraform_plan',
    checks: [
      'Confirm the plan targets the intended workspace, account, and environment.',
      'Validate blast radius for networking, IAM, and shared infrastructure changes.',
      'Keep the last known-good plan or state-backed revert path ready before apply.',
    ],
    caution: 'Infrastructure plans can widen impact quickly when shared resources are in scope.',
  },
  change_ticket: {
    canonicalType: 'change_ticket',
    checks: [
      'Verify the ticket names affected systems, rollout sequencing, and live owners.',
      'Confirm rollback triggers and time-to-restore expectations are explicit.',
      'Check that validation metrics are tied to customer or operator outcomes.',
    ],
    caution: 'Tickets often sound complete while still omitting the real execution details.',
  },
  release_note: {
    canonicalType: 'release_note',
    checks: [
      'Require the actual systems, regions, and traffic paths in scope.',
      'Ask for the migration or rollout sequence before assigning confidence.',
      'Refuse to treat vague release prose as sufficient implementation evidence.',
    ],
    caution: 'Release notes are useful intent signals but poor evidence on their own.',
  },
  config_change: {
    canonicalType: 'config_change',
    checks: [
      'Identify which services consume the config and how fast it propagates.',
      'Verify whether the previous value remains available for rapid restore.',
      'Confirm monitoring covers both correctness and dependency health after the switch.',
    ],
    caution: 'Config-only changes can reroute live traffic without any code diff safety net.',
  },
  database: {
    canonicalType: 'database',
    checks: [
      'Confirm compatibility for reads, writes, replicas, and downstream jobs.',
      'Validate restore speed and the fastest safe undo path for data-impacting work.',
      'Run in a known low-write window with lag and lock monitoring in place.',
    ],
    caution: 'Database work is often easy to start and slow to unwind.',
  },
  network: {
    canonicalType: 'network',
    checks: [
      'Verify allowlists, dependencies, and path coverage before any cutover.',
      'Keep a last known-good artifact ready to reapply without manual reconstruction.',
      'Use synthetic checks and live connection health as immediate abort signals.',
    ],
    caution: 'Routing and access controls can fail fast with wide blast radius.',
  },
  security: {
    canonicalType: 'security',
    checks: [
      'Validate the impacted auth, identity, or permissions path end to end.',
      'Stage rollout to internal users or a controlled cohort first.',
      'Confirm rollback does not reopen a known exposure without explicit acceptance.',
    ],
    caution: 'Security changes can reduce exposure while still breaking critical flows.',
  },
};

const runbookCatalog: Record<string, RunbookEntry> = {
  'billing-web': {
    canonicalSystem: 'billing-web',
    owner: 'Revenue engineering',
    watch: ['frontend error rate', 'billing CTA click-through', 'support ticket volume'],
    rollback: 'Disable the active feature flag or redeploy the prior web bundle.',
    notes: 'Customer-facing copy and payment guidance should stay reversible within minutes.',
  },
  'auth-api': {
    canonicalSystem: 'auth-api',
    owner: 'Identity platform',
    watch: ['login success rate', 'token refresh failures', '401 spike rate'],
    rollback: 'Redeploy the previous auth image and isolate sessions created under the new release if needed.',
    notes: 'Protect admin and customer login separately if blast radius differs by audience.',
  },
  'customer-portal': {
    canonicalSystem: 'customer-portal',
    owner: 'Customer platform',
    watch: ['login completion', 'session refresh success', 'support contacts for access issues'],
    rollback: 'Shift traffic back to the previous build and clear only the bad cohort if a staged rollout exists.',
    notes: 'Portal issues often surface through auth callbacks and cached session state.',
  },
  'payments-api': {
    canonicalSystem: 'payments-api',
    owner: 'Payments platform',
    watch: ['payment authorization success', '5xx rate', 'latency on checkout submit'],
    rollback: 'Reapply the last known-good config or route definition and validate downstream gateway health.',
    notes: 'Treat any customer-facing payment degradation as a fast rollback signal.',
  },
  'orders-api': {
    canonicalSystem: 'orders-api',
    owner: 'Orders platform',
    watch: ['order submit success', 'replication lag', 'write latency'],
    rollback: 'Use the prior migration or release artifact, and keep replica lag under active watch during recovery.',
    notes: 'Database-adjacent changes often surface first in write latency and downstream job delays.',
  },
  postgres: {
    canonicalSystem: 'postgres',
    owner: 'Database engineering',
    watch: ['replication lag', 'lock wait time', 'write latency'],
    rollback: 'Use the fastest practical restore path or a backward-compatible revert migration, not an improvised fix.',
    notes: 'Snapshot freshness and tested restore steps matter more than optimistic rollback prose.',
  },
};

function normalizeCatalogKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[`"]/g, '')
    .replace(/\s+/g, '_');
}

function mapChangeType(value: string) {
  const normalized = normalizeCatalogKey(value);

  if (normalized in checklistCatalog) {
    return normalized;
  }

  if (normalized.includes('terraform')) {
    return 'terraform_plan';
  }

  if (normalized.includes('config')) {
    return 'config_change';
  }

  if (normalized.includes('ticket')) {
    return 'change_ticket';
  }

  if (normalized.includes('release')) {
    return 'release_note';
  }

  if (normalized.includes('diff') || normalized.includes('pr')) {
    return 'pr_diff';
  }

  if (normalized.includes('database') || normalized.includes('schema')) {
    return 'database';
  }

  if (normalized.includes('network') || normalized.includes('security_group')) {
    return 'network';
  }

  if (normalized.includes('auth') || normalized.includes('security')) {
    return 'security';
  }

  return 'change_ticket';
}

function mapSystemName(value: string) {
  const normalized = normalizeCatalogKey(value).replace(/[_-](blue|green)$/, '');

  if (normalized in runbookCatalog) {
    return normalized;
  }

  if (normalized.includes('auth')) {
    return 'auth-api';
  }

  if (normalized.includes('payment')) {
    return 'payments-api';
  }

  if (normalized.includes('order')) {
    return 'orders-api';
  }

  if (normalized.includes('portal')) {
    return 'customer-portal';
  }

  if (normalized.includes('postgres') || normalized.includes('database')) {
    return 'postgres';
  }

  return '';
}

export const analysisTools = {
  getChangeChecklist: tool({
    description:
      'Return a concise reviewer checklist for a change type such as pr_diff, terraform_plan, change_ticket, release_note, config_change, database, network, or security.',
    inputSchema: z.object({
      changeType: z.string().min(1),
    }),
    execute: async ({ changeType }) => {
      const key = mapChangeType(changeType);
      const checklist = checklistCatalog[key];

      return {
        requestedType: changeType,
        canonicalType: checklist.canonicalType as ArtifactType | ChangeCategory | string,
        checks: checklist.checks,
        caution: checklist.caution,
      };
    },
  }),
  lookupRunbook: tool({
    description:
      'Look up a lightweight operational runbook for a named system or service. Use this only when the artifact names a real system.',
    inputSchema: z.object({
      systemName: z.string().min(1),
    }),
    execute: async ({ systemName }) => {
      const key = mapSystemName(systemName);

      if (!key) {
        return {
          found: false,
          requestedSystem: systemName,
          guidance:
            'No runbook entry was found. Keep the assessment conservative and state that system-specific evidence is missing.',
        };
      }

      const runbook = runbookCatalog[key];

      return {
        found: true,
        requestedSystem: systemName,
        ...runbook,
      };
    },
  }),
};

export type AnalysisToolSet = typeof analysisTools;
