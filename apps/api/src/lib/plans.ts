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
  quality: 'standard' | 'enhanced';
  active: boolean;
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
    quality: 'enhanced',
    active: true,
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    quota: 25000,
    quality: 'enhanced',
    active: true,
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    quota: ENTERPRISE_DEFAULT_QUOTA,
    quality: 'enhanced',
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

export const formatPlanLabel = (value: string | null | undefined) => {
  const normalized = normalizePlanKey(value);
  return PLAN_CONFIG[normalized].name;
};
