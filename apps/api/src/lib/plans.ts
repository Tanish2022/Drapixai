export const TRIAL_TRYONS = 300;
export const TRIAL_DAYS = 12;
const ENTERPRISE_DEFAULT_QUOTA = Number(process.env.DRAPIXAI_ENTERPRISE_QUOTA || 100000);

export const PUBLIC_PLAN_KEYS = ['starter', 'growth', 'pro'] as const;
export type PublicPlanKey = (typeof PUBLIC_PLAN_KEYS)[number];
export type PlanKey =
  | 'trial'
  | PublicPlanKey
  | 'enterprise'
  | 'expired'
  | 'canceled'
  | 'none';

type PlanConfig = {
  key: PlanKey;
  name: string;
  quota: number;
  quality: 'standard';
  active: boolean;
};

export type PlanAccessInput = {
  planType?: string | null;
  subscriptionStatus?: string | null;
  subscriptionProvider?: string | null;
  subscriptionCurrentPeriodEndsAt?: Date | string | null;
  trialExpiresAt?: Date | string | null;
  at?: Date | string | null;
};

export type PlanAccessContext = {
  normalizedPlan: PlanKey;
  planName: string;
  quota: number;
  quality: 'standard';
  active: boolean;
  inactive: boolean;
  blockedReason: 'PLAN_INACTIVE' | 'TRIAL_EXPIRED' | 'SUBSCRIPTION_INACTIVE' | 'SUBSCRIPTION_PERIOD_EXPIRED' | null;
  trialDaysLeft: number;
};

const PLAN_CONFIG: Record<PlanKey, PlanConfig> = {
  trial: {
    key: 'trial',
    name: 'Trial',
    quota: TRIAL_TRYONS,
    quality: 'standard',
    active: true,
  },
  starter: {
    key: 'starter',
    name: 'Starter',
    quota: 1000,
    quality: 'standard',
    active: true,
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    quota: 7500,
    quality: 'standard',
    active: true,
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    quota: 25000,
    quality: 'standard',
    active: true,
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    quota: ENTERPRISE_DEFAULT_QUOTA,
    quality: 'standard',
    active: true,
  },
  expired: {
    key: 'expired',
    name: 'Expired',
    quota: 0,
    quality: 'standard',
    active: false,
  },
  canceled: {
    key: 'canceled',
    name: 'Canceled',
    quota: 0,
    quality: 'standard',
    active: false,
  },
  none: {
    key: 'none',
    name: 'No Plan',
    quota: 0,
    quality: 'standard',
    active: false,
  },
};

const INACTIVE_SUBSCRIPTION_STATUSES = new Set([
  'canceled',
  'cancelled',
  'expired',
  'inactive',
  'past_due',
  'paused',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'suspended',
]);

const normalizeSubscriptionStatus = (value: string | null | undefined) =>
  String(value || '').trim().toLowerCase();

const normalizeTrialExpiry = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const STRIPE_PERIOD_GRACE_MS = 15 * 60 * 1000;

export const normalizePlanKey = (value: string | null | undefined): PlanKey => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized in PLAN_CONFIG) {
    return normalized as PlanKey;
  }
  return 'none';
};

export const normalizeSelectedPlan = (value: string | null | undefined): PublicPlanKey | null => {
  const normalized = String(value || '').trim().toLowerCase();
  return (PUBLIC_PLAN_KEYS as readonly string[]).includes(normalized)
    ? (normalized as PublicPlanKey)
    : null;
};

export const getPlanConfig = (value: string | null | undefined): PlanConfig =>
  PLAN_CONFIG[normalizePlanKey(value)];

export const getPlanQuota = (value: string | null | undefined) =>
  getPlanConfig(value).quota;

export const getPlanName = (value: string | null | undefined) =>
  getPlanConfig(value).name;

export const getPlanQuality = (value: string | null | undefined) =>
  getPlanConfig(value).quality;

export const hasActivePlanAccess = (value: string | null | undefined) =>
  getPlanConfig(value).active;

export const isInactivePlan = (value: string | null | undefined) => {
  const plan = normalizePlanKey(value);
  return plan === 'expired' || plan === 'canceled' || plan === 'none';
};

export const getPlanAccessContext = (input: PlanAccessInput): PlanAccessContext => {
  const normalizedPlan = normalizePlanKey(input.planType);
  const config = PLAN_CONFIG[normalizedPlan];
  const subscriptionStatus = normalizeSubscriptionStatus(input.subscriptionStatus);
  const trialExpiresAt = normalizeTrialExpiry(input.trialExpiresAt);
  const subscriptionPeriodEndsAt = normalizeTrialExpiry(input.subscriptionCurrentPeriodEndsAt);
  const at = normalizeTrialExpiry(input.at) || new Date();
  const trialDaysLeft = normalizedPlan === 'trial' && trialExpiresAt
    ? Math.max(0, Math.ceil((trialExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  let active = config.active;
  let blockedReason: PlanAccessContext['blockedReason'] = active ? null : 'PLAN_INACTIVE';

  if (active && normalizedPlan === 'trial' && trialExpiresAt && trialExpiresAt.getTime() <= Date.now()) {
    active = false;
    blockedReason = 'TRIAL_EXPIRED';
  }

  if (active && INACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) {
    active = false;
    blockedReason = 'SUBSCRIPTION_INACTIVE';
  }

  if (
    active
    && input.subscriptionProvider === 'stripe'
    && subscriptionPeriodEndsAt
    && subscriptionPeriodEndsAt.getTime() + STRIPE_PERIOD_GRACE_MS <= at.getTime()
  ) {
    active = false;
    blockedReason = 'SUBSCRIPTION_PERIOD_EXPIRED';
  }

  return {
    normalizedPlan,
    planName: config.name,
    quota: config.quota,
    quality: config.quality,
    active,
    inactive: !active,
    blockedReason,
    trialDaysLeft,
  };
};

export const formatPlanLabel = (value: string | null | undefined) => {
  const normalized = normalizePlanKey(value);
  return PLAN_CONFIG[normalized].name;
};
