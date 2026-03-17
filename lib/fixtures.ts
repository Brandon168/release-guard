import type { ChangeFixture, ChangeRequest } from '@/lib/types';

type LegacyFixtureRequest = Omit<ChangeRequest, 'artifactType' | 'artifactText'>;
type LegacyFixture = Omit<ChangeFixture, 'request'> & {
  request: LegacyFixtureRequest;
};

const rawSampleFixtures: LegacyFixture[] = [
  {
    id: 'billing-banner-copy',
    title: 'Billing banner copy behind existing flag',
    description: 'Low-risk content change scoped to one web surface with instant rollback.',
    request: {
      title: 'Update overdue billing banner copy',
      summary:
        'Update the overdue billing banner text in billing-web. The change only affects wording and uses an existing feature flag, with no logic, API, or schema changes.',
      category: 'application',
      environment: 'production',
      services: ['billing-web'],
      infrastructureAreas: ['frontend'],
      rolloutPlan:
        'Enable for internal users first, then 10% of traffic, then 100% if JS error rate and support tickets remain flat.',
      rollbackPlan:
        'Disable the existing feature flag to restore the prior copy immediately.',
      observabilityPlan:
        'Watch frontend error rate, CTA click-through, and support tickets tagged billing-banner.',
      safeguards: 'Existing feature flag and cohort-based rollout.',
      changeWindow: 'Weekday business hours.',
      knownUnknowns: 'None.',
    },
    expected: {
      riskLevel: 'low',
      blastRadiusKeywords: ['billing-web', 'banner'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
  {
    id: 'pdf-worker-memory-bump',
    title: 'Async worker memory limit increase',
    description: 'Low-risk infrastructure tuning for a non-customer-facing worker.',
    request: {
      title: 'Raise memory limit for PDF worker',
      summary:
        'Increase the Kubernetes memory limit for the asynchronous PDF export worker from 512Mi to 768Mi after recurring OOM kills. No user-facing API path changes.',
      category: 'infrastructure',
      environment: 'production',
      services: ['pdf-worker'],
      infrastructureAreas: ['kubernetes', 'worker'],
      rolloutPlan:
        'Deploy one replica first, verify queue drain time and memory headroom, then roll the remaining replicas.',
      rollbackPlan:
        'Revert the deployment manifest to the previous resource settings.',
      observabilityPlan:
        'Track worker restarts, queue latency, and pod memory utilization.',
      safeguards: 'Single-replica verification before full rollout.',
      changeWindow: 'Off-peak weekday afternoon.',
      knownUnknowns: 'None.',
    },
    expected: {
      riskLevel: 'low',
      blastRadiusKeywords: ['worker', 'queue'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
  {
    id: 'cart-cache-ttl',
    title: 'Redis cart TTL reduction',
    description: 'Medium-risk cache change that can affect cart freshness and checkout conversion.',
    request: {
      title: 'Reduce cart cache TTL from 30m to 5m',
      summary:
        'Reduce the Redis TTL for cart objects to lower stale cart incidents during promotions. The change affects cart-api and checkout-api behavior in production.',
      category: 'application',
      environment: 'production',
      services: ['cart-api', 'checkout-api', 'redis-cart'],
      infrastructureAreas: ['cache', 'api'],
      rolloutPlan:
        'Roll to one region first and compare cache hit rate, cart restore success, and checkout conversion before global rollout.',
      rollbackPlan:
        'Restore the previous TTL value and flush only the impacted cache namespace if inconsistency appears.',
      observabilityPlan:
        'Monitor cart restore failures, checkout conversion, Redis saturation, and origin request volume.',
      safeguards: 'Regional rollout before global adoption.',
      changeWindow: 'Start outside promo peak hours.',
      knownUnknowns: 'Need confirmation that downstream rate limits can absorb extra origin reads.',
    },
    expected: {
      riskLevel: 'medium',
      blastRadiusKeywords: ['cart', 'checkout', 'redis'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
  {
    id: 'auth-sdk-upgrade',
    title: 'Authentication SDK major version upgrade',
    description: 'Medium-risk dependency change touching sign-in and session behavior.',
    request: {
      title: 'Upgrade auth SDK to latest major version',
      summary:
        'Upgrade the authentication SDK used by customer-portal and admin-console to the latest major version to stay on a supported release. Session refresh behavior changes under the new SDK.',
      category: 'security',
      environment: 'production',
      services: ['customer-portal', 'admin-console', 'auth-api'],
      infrastructureAreas: ['identity', 'frontend', 'api'],
      rolloutPlan:
        'Canary the new version for employees and 5% of customer traffic before broad rollout.',
      rollbackPlan:
        'Redeploy the previous application images and invalidate only sessions created under the new release if needed.',
      observabilityPlan:
        'Watch login success rate, token refresh failures, support contacts, and 401 spikes.',
      safeguards: 'Employee canary and versioned rollout.',
      changeWindow: 'Business hours with auth and support leads on point.',
      knownUnknowns: 'Need confirmation that admin SSO callback settings do not change.',
    },
    expected: {
      riskLevel: 'medium',
      blastRadiusKeywords: ['login', 'session', 'auth'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
  {
    id: 'orders-concurrent-index',
    title: 'Concurrent index on orders table',
    description: 'Medium-risk database change with mitigations but real write-path sensitivity.',
    request: {
      title: 'Add concurrent index to orders table',
      summary:
        'Create a concurrent index on orders.created_at to speed reporting queries, followed by a background backfill to validate planner improvements. Production PostgreSQL primary and replica are in scope.',
      category: 'database',
      environment: 'production',
      services: ['orders-api', 'reporting-worker', 'postgres-orders'],
      infrastructureAreas: ['database', 'postgres'],
      rolloutPlan:
        'Run on a replica first, then execute the concurrent index during a low-write window and observe replication lag before the follow-up validation step.',
      rollbackPlan:
        'Drop the new index if write amplification or lock contention becomes unacceptable.',
      observabilityPlan:
        'Monitor replication lag, write latency, lock wait time, and slow query volume.',
      safeguards: 'Replica rehearsal and low-write execution window.',
      changeWindow: 'Late evening maintenance window.',
      knownUnknowns: 'Need final confirmation on expected backfill duration.',
    },
    expected: {
      riskLevel: 'medium',
      blastRadiusKeywords: ['database', 'orders', 'replica'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
  {
    id: 'security-group-tightening',
    title: 'Production security group tightening',
    description: 'High-risk network control change with wide blast radius if rules are wrong.',
    request: {
      title: 'Tighten inbound rules for production app subnet',
      summary:
        'Restrict production security group ingress for the app subnet so only approved upstream load balancers and bastion hosts can connect. This replaces several broad CIDR rules.',
      category: 'network',
      environment: 'production',
      services: ['edge-api', 'payments-api', 'customer-portal'],
      infrastructureAreas: ['security group', 'terraform', 'load balancer'],
      rolloutPlan:
        'Apply in one production region first with network engineering and SRE on the bridge, then expand region by region after connection tests pass.',
      rollbackPlan:
        'Re-apply the previous Terraform plan artifact to restore the old ruleset.',
      observabilityPlan:
        'Watch 5xx rate, connection resets, TLS handshakes, and load balancer target health.',
      safeguards: 'Region-by-region rollout with precomputed revert plan.',
      changeWindow: 'After-hours maintenance window.',
      knownUnknowns: 'Need final allowlist signoff from analytics and support tooling owners.',
    },
    expected: {
      riskLevel: 'high',
      blastRadiusKeywords: ['traffic', 'load balancer', 'payments'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
  {
    id: 'ingress-rewrite',
    title: 'Kubernetes ingress path rewrite',
    description: 'High-risk edge routing change affecting user entry points and auth callbacks.',
    request: {
      title: 'Rewrite ingress paths for customer portal',
      summary:
        'Update Kubernetes ingress path rewrites so /app and /account share the same gateway layer. This changes routing for customer-portal, auth callbacks, and several static asset paths.',
      category: 'network',
      environment: 'production',
      services: ['customer-portal', 'auth-api', 'web-assets'],
      infrastructureAreas: ['kubernetes ingress', 'gateway', 'cdn'],
      rolloutPlan:
        'Deploy to one cluster first, run synthetic login and checkout journeys, then continue cluster by cluster.',
      rollbackPlan:
        'Revert the ingress manifest and invalidate any stale CDN route config.',
      observabilityPlan:
        'Track 404/502 spikes, auth callback failures, asset misses, and synthetic checks.',
      safeguards: 'Cluster-level rollout and synthetic path verification.',
      changeWindow: 'Low-traffic overnight change window.',
      knownUnknowns: 'Need confirmation that all hardcoded callback URLs were captured.',
    },
    expected: {
      riskLevel: 'high',
      blastRadiusKeywords: ['auth', 'traffic', 'portal'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
  {
    id: 'drop-legacy-column',
    title: 'Drop legacy customer column',
    description: 'High-risk destructive schema change even with cleanup context.',
    request: {
      title: 'Drop legacy loyalty_status column',
      summary:
        'Remove the legacy loyalty_status column from the customers table after recent app releases stopped writing to it. This is a destructive schema change on the production primary database.',
      category: 'database',
      environment: 'production',
      services: ['customer-api', 'loyalty-worker', 'postgres-customers'],
      infrastructureAreas: ['database', 'schema migration'],
      rolloutPlan:
        'Run a final dependency scan, take a fresh snapshot, and execute during a maintenance window with DB engineering present.',
      rollbackPlan:
        'Restore from backup or re-add the column from the migration if dependent code still references it.',
      observabilityPlan:
        'Watch database errors, application exceptions, and background worker failures tied to customer reads.',
      safeguards: 'Fresh snapshot and dependency scan before execution.',
      changeWindow: 'Scheduled maintenance window.',
      knownUnknowns: 'Need confirmation that the analytics export job no longer references the field.',
    },
    expected: {
      riskLevel: 'high',
      blastRadiusKeywords: ['database', 'customer', 'schema'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
  {
    id: 'vpc-peering-routes',
    title: 'VPC peering route table change',
    description: 'High-risk platform networking change across shared services.',
    request: {
      title: 'Update VPC peering routes between platform and payments',
      summary:
        'Modify VPC peering route tables so payments workloads use a new shared services path. The change affects east-west traffic between core-platform and payments.',
      category: 'platform',
      environment: 'production',
      services: ['payments-api', 'fraud-worker', 'shared-secrets'],
      infrastructureAreas: ['vpc peering', 'route tables', 'terraform'],
      rolloutPlan:
        'Apply to one region, validate connectivity and latency, then proceed region by region with networking and payments on call.',
      rollbackPlan:
        'Apply the previous route table definitions from the last known-good Terraform artifact.',
      observabilityPlan:
        'Monitor service-to-service latency, connection failures, payment authorization errors, and secret fetch success.',
      safeguards: 'Region-by-region cutover with a preserved last known-good plan.',
      changeWindow: 'Weekend maintenance window.',
      knownUnknowns: 'Need final inventory of every service using the shared path.',
    },
    expected: {
      riskLevel: 'high',
      blastRadiusKeywords: ['payments', 'traffic', 'shared'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
  {
    id: 'optimize-api-performance',
    title: 'Vague production performance tuning',
    description: 'Unknown-risk case where missing evidence is the central signal.',
    request: {
      title: 'Optimize production API performance',
      summary:
        'Make a few changes to improve production API performance before next week.',
      category: 'unknown',
      environment: 'production',
      services: [],
      infrastructureAreas: [],
      rolloutPlan: '',
      rollbackPlan: '',
      observabilityPlan: '',
      safeguards: '',
      changeWindow: '',
      knownUnknowns: 'The exact systems and changes are still being discussed.',
    },
    expected: {
      riskLevel: 'unknown',
      blastRadiusKeywords: ['production', 'api'],
      minimumQuestions: 4,
      expectRollbackGuidance: true,
      expectUnknownHandling: true,
    },
  },
  {
    id: 'new-cache-layer',
    title: 'Undefined cache layer rollout',
    description: 'Unknown-risk case with broad scope but not enough specifics to defend a rating.',
    request: {
      title: 'Enable a new cache layer',
      summary:
        'Enable a new cache layer in front of several services next sprint to improve latency.',
      category: 'platform',
      environment: 'production',
      services: [],
      infrastructureAreas: ['cache'],
      rolloutPlan: '',
      rollbackPlan: '',
      observabilityPlan: '',
      safeguards: '',
      changeWindow: '',
      knownUnknowns: 'Unsure which services, tenants, and regions will participate.',
    },
    expected: {
      riskLevel: 'unknown',
      blastRadiusKeywords: ['cache', 'latency'],
      minimumQuestions: 4,
      expectRollbackGuidance: true,
      expectUnknownHandling: true,
    },
  },
  {
    id: 'logging-agent-rollout',
    title: 'Node-level logging agent rollout',
    description: 'Medium-risk observability change with broad infrastructure coverage.',
    request: {
      title: 'Roll out new logging agent to production nodes',
      summary:
        'Replace the current node-level log shipping agent with a new DaemonSet across all production Kubernetes nodes to cut ingest costs and improve parsing quality.',
      category: 'observability',
      environment: 'production',
      services: ['platform-cluster'],
      infrastructureAreas: ['kubernetes', 'logging', 'daemonset'],
      rolloutPlan:
        'Roll out node pool by node pool and keep the old agent running in parallel for one pool before broader expansion.',
      rollbackPlan:
        'Scale down the new DaemonSet and restore the previous manifest if ingest lag, node CPU, or log loss appears.',
      observabilityPlan:
        'Watch node CPU, log ingestion lag, dropped log count, and alert fidelity during the cutover.',
      safeguards: 'Parallel validation on one node pool before full rollout.',
      changeWindow: 'Off-peak production window with platform on call.',
      knownUnknowns: 'Need final confirmation on parser parity for security audit logs.',
    },
    expected: {
      riskLevel: 'medium',
      blastRadiusKeywords: ['logging', 'nodes', 'observability'],
      minimumQuestions: 1,
      expectRollbackGuidance: true,
    },
  },
];

export const sampleFixtures: ChangeFixture[] = rawSampleFixtures.map(fixture => ({
  ...fixture,
  request: {
    artifactType: 'unknown',
    artifactText: '',
    ...fixture.request,
  },
}));

export function getFixtureById(id: string) {
  return sampleFixtures.find(fixture => fixture.id === id);
}

export const featuredFixtureIds = [
  'billing-banner-copy',
  'auth-sdk-upgrade',
  'drop-legacy-column',
  'optimize-api-performance',
] as const;

export const featuredFixtures = featuredFixtureIds
  .map(id => getFixtureById(id))
  .filter((fixture): fixture is ChangeFixture => Boolean(fixture));
