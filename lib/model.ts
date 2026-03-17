import { gateway } from 'ai';

export const REVIEW_MODEL_OPTIONS = [
  {
    id: 'amazon/nova-micro',
    label: 'Amazon Nova Micro',
    summary: 'Ultra-cheap first pass for straightforward changes.',
  },
  {
    id: 'google/gemini-3-flash',
    label: 'Gemini 3 Flash',
    summary: 'Escalation model for ambiguous changes and long artifacts.',
  },
  {
    id: 'openai/gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    summary: 'Balanced fallback option when you want stronger default quality.',
  },
] as const;

export type GatewayModelId = (typeof REVIEW_MODEL_OPTIONS)[number]['id'];

export const DEFAULT_PRIMARY_MODEL: GatewayModelId = 'amazon/nova-micro';
export const DEFAULT_ESCALATION_MODEL: GatewayModelId = 'google/gemini-3-flash';

const gatewayModelIds = new Set<GatewayModelId>(
  REVIEW_MODEL_OPTIONS.map(option => option.id),
);

export function hasGatewayAccess() {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL);
}

export function isGatewayModelId(value: string): value is GatewayModelId {
  return gatewayModelIds.has(value as GatewayModelId);
}

function getConfiguredModel({
  configuredValue,
  fallback,
}: {
  configuredValue?: string | null;
  fallback: GatewayModelId;
}) {
  if (configuredValue && isGatewayModelId(configuredValue)) {
    return configuredValue;
  }

  return fallback;
}

export function getConfiguredReviewModels() {
  return {
    primaryModelId: getConfiguredModel({
      configuredValue: process.env.RISK_PRIMARY_MODEL?.trim(),
      fallback: DEFAULT_PRIMARY_MODEL,
    }),
    escalationModelId: getConfiguredModel({
      configuredValue: process.env.RISK_ESCALATION_MODEL?.trim(),
      fallback: DEFAULT_ESCALATION_MODEL,
    }),
  };
}

export function getModelLabel(modelId: string | null) {
  if (!modelId) {
    return 'Deterministic fallback';
  }

  return (
    REVIEW_MODEL_OPTIONS.find(option => option.id === modelId)?.label ?? modelId
  );
}

export function getGatewayModel(modelId: GatewayModelId) {
  return gateway(modelId);
}
