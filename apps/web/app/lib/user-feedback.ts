export type FeedbackTone = 'error' | 'success' | 'info';
export type Feedback = { message: string; tone: FeedbackTone } | null;
export type ErrorContext = 'workspace' | 'login' | 'register' | 'reset' | 'admin' | 'demo';

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: 'The email or password is incorrect. Check both and try again.',
  INVALID_OR_EXPIRED_OTP: 'That verification code is invalid or has expired. Check the latest email or request a new code.',
  EMAIL_REQUIRED: 'Enter your email address.',
  EMAIL_AND_PASSWORD_REQUIRED: 'Enter your email address and password.',
  EMAIL_NOT_VERIFIED: 'Verify your email address before signing in.',
  EMAIL_ALREADY_REGISTERED: 'This email cannot be used for a new account. Try signing in or recovering access.',
  EMAIL_ALREADY_IN_USE_BY_ACCOUNT: 'This email is already linked to an account. Choose another address or contact support.',
  EMAIL_DELIVERY_UNAVAILABLE: 'We could not confirm delivery of the code. If an email arrives, use its latest code; otherwise wait and request another.',
  AUTHENTICATION_BUSY: 'Sign-in is temporarily busy. Please wait a moment and try again.',
  CURRENT_PASSWORD_INCORRECT: 'Your current password is incorrect. Check it or use password recovery.',
  CURRENT_AND_NEW_PASSWORD_REQUIRED: 'Enter your current password and a new password.',
  PASSWORD_TOO_SHORT: 'Use a password with at least 8 characters.',
  PASSWORD_TOO_LONG: 'Use a password with no more than 128 characters.',
  PASSWORD_RESET_REQUIRED: 'Reset your password before signing in again.',
  MFA_REQUIRED_OR_INVALID: 'Check your password and the latest six-digit authenticator code, then try again.',
  ADMIN_ACCESS_DENIED: 'Check your administrator credentials and the latest six-digit authenticator code, then try again.',
  INVALID_CURRENT_EMAIL_OTP: 'The code for your current email is invalid or expired. Use the latest code.',
  INVALID_NEW_EMAIL_OTP: 'The code for your new email is invalid or expired. Use the latest code.',
  EMAIL_AND_BOTH_OTPS_REQUIRED: 'Enter the new email address and both verification codes.',
  TERMS_ACCEPTANCE_REQUIRED: 'Review and accept the current terms before continuing.',
  TERMS_VERSION_CHANGED: 'The terms have changed. Reload this page before accepting.',
  TERMS_ACCEPTANCE_UNAVAILABLE: 'We could not confirm your acceptance. Choose Check again before retrying.',
  TRYON_INTAKE_PAUSED: 'Try-on and image preparation are temporarily paused. Please try again later.',
  TRYON_TEMPORARILY_UNAVAILABLE: 'Try-on and image preparation are temporarily unavailable. Please try again later.',
  AI_SERVICE_UNAVAILABLE: 'Image preparation is temporarily unavailable. Please try again later.',
  CLOTH_IMAGE_REQUIRED: 'Choose a garment photo before continuing.',
  INVALID_IMAGE_CONTENT: 'Choose a valid JPEG, PNG or WebP image.',
  FILE_TOO_LARGE: 'This file is too large. Choose an image within the size limit shown on the form.',
  LIMIT_FILE_SIZE: 'This file is too large. Choose an image within the size limit shown on the form.',
  LOW_RESOLUTION: 'Choose a clearer image at least 512 × 512 pixels.',
  IMAGE_BLURRY: 'Choose a sharper image with visible garment details.',
  MODEL_WORN_GARMENT: 'Use a garment-only photo without a person or mannequin wearing it.',
  UNSUPPORTED_GARMENT_CATEGORY: 'Choose a supported upper-body garment, such as a shirt, T-shirt, blouse or top.',
  LOWER_BODY_NOT_ENABLED: 'Lower-body garments are not currently supported in this flow.',
  GARMENT_NOT_APPROVED: 'This garment needs preparation or review before it can be used.',
  GARMENT_PENDING_APPROVAL: 'This garment is awaiting review. Check its status before continuing.',
  GARMENT_NOT_READY: 'This garment is not ready yet. Check its preparation status.',
  GARMENT_NOT_FOUND: 'This garment is no longer available. Refresh your products before trying again.',
  PRODUCT_NOT_FOUND: 'This product is no longer available. Refresh your products before trying again.',
  GARMENT_CACHE_MISS: 'This garment needs to be prepared again. Check its preparation status.',
  GARMENT_CACHE_STALE: 'The product image changed. Prepare and review the garment again.',
  GARMENT_PRODUCT_TYPE_MISMATCH: 'Choose a product and garment of the same supported type.',
  SHOPPER_CONSENT_REQUIRED: 'Confirm that you have permission for temporary photo processing before continuing.',
  STORE_DOMAIN_NOT_CONFIGURED: 'Save your store domain before verifying it.',
  STORE_VERIFICATION_FAILED: 'We could not verify the store. Check the saved domain and verification tag, then try again.',
  STORE_VERIFICATION_HTTPS_FAILED: 'We could not verify the store over HTTPS. Check its secure homepage and verification tag.',
  STORE_VERIFICATION_TIMEOUT: 'The store took too long to respond. Check its availability before trying verification again.',
  STORE_VERIFICATION_REDIRECT_BLOCKED: 'We could not follow the store redirect safely. Check that your saved domain opens the correct HTTPS homepage.',
  STORE_VERIFICATION_PROTOCOL_BLOCKED: 'Use the HTTPS address of your store before verifying it.',
  STORE_VERIFICATION_REQUEST_FAILED: 'We could not reach the store safely. Check its public HTTPS address and contact support if this continues.',
  FEED_URL_REQUIRED: 'Enter a product feed URL before syncing.',
  SHOPIFY_SYNC_BUSY: 'Your catalog sync is pending. Check its status shortly; you do not need to submit it again.',
  SHOPIFY_INSTALLATION_NOT_ACTIVE: 'This Shopify connection is inactive. Reconnect the store before syncing.',
  SHOPIFY_PREPARATION_RECONCILIATION_REQUIRED: 'Preparation needs support review before it can resume. Contact support with your product reference.',
  BILLING_UNAVAILABLE: 'Billing is not available yet. Contact support for account or plan help.',
  BILLING_PROVIDER_UNAVAILABLE: 'The payment provider is temporarily unavailable. Check your subscription before trying again.',
  BILLING_CHECKOUT_IN_PROGRESS: 'A checkout is already being prepared. Wait and check your subscription before starting another.',
  BILLING_CHECKOUT_ALREADY_FINALIZED: 'This checkout has already completed. Refresh your subscription details.',
  BILLING_REDIRECT_REJECTED: 'We could not verify the payment destination. Contact support before trying again.',
  USE_BILLING_PORTAL_FOR_EXISTING_SUBSCRIPTION: 'Manage your existing subscription through billing settings.',
  REQUEST_TIMEOUT: 'The request took too long. Check the latest status before trying the action again.',
  REQUEST_CANCELLED: 'The request was interrupted. Check the latest status before trying the action again.',
  NETWORK_UNAVAILABLE: 'We could not connect. Check your connection and the latest status before trying again.',
  INVALID_RESPONSE: 'The service returned an unexpected response. Refresh or check service status before continuing.',
};

// Only reviewed codes become public copy. Never echo raw server messages,
// stack traces, HTML, provider errors, filenames, credentials or query strings.
export function getApiErrorMessage(payload: unknown, fallback: string, status?: number, context: ErrorContext = 'workspace'): string {
  if (payload instanceof WebsiteError) return payload.message;
  const object = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const candidates = [object.code, object.reason, object.error, object.message];
  if (status === 429) return 'Too many requests. Please wait before trying again.';
  if (status && status >= 500 && candidates.some(code => typeof code === 'string' && /^(INVALID_|PASSWORD_|CURRENT_PASSWORD_|EMAIL_ALREADY_|MFA_)/.test(code))) return 'We could not complete this request. Check the latest status before retrying, or contact support.';
  for (const candidate of candidates) if (typeof candidate === 'string' && Object.hasOwn(messages, candidate)) return messages[candidate];
  if (status === 401) return context === 'login' ? messages.INVALID_CREDENTIALS : context === 'admin' ? messages.MFA_REQUIRED_OR_INVALID : 'Your session has expired. Sign in again to continue.';
  if (status === 403) return 'Your account does not have permission for this action. Contact your workspace owner or support.';
  if (status === 429) return 'Too many requests. Please wait before trying again.';
  if (status === 413) return messages.FILE_TOO_LARGE;
  if (status === 409) return 'This action conflicts with the latest account state. Refresh and check its status before trying again.';
  if (status === 503 || status === 502 || status === 504) return 'The service is temporarily unavailable. Please try again later or check service status.';
  if (status && status >= 500) return 'We could not complete this request. Check the latest status before retrying, or contact support.';
  return fallback;
}

export class WebsiteError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) { super(message); this.name = 'WebsiteError'; }
}

export function errorField(error: unknown): 'email' | 'password' | 'otp' | 'credentials' | undefined {
  if (!(error instanceof WebsiteError)) return;
  if (error.status && error.status >= 500) return;
  if (error.code === 'INVALID_OR_EXPIRED_OTP') return 'otp';
  if (['EMAIL_REQUIRED', 'EMAIL_NOT_VERIFIED', 'EMAIL_ALREADY_REGISTERED'].includes(error.code || '')) return 'email';
  if (['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG', 'CURRENT_PASSWORD_INCORRECT'].includes(error.code || '')) return 'password';
  if (error.code === 'INVALID_CREDENTIALS') return 'credentials';
}

export function userError(error: unknown, fallback = 'We could not complete this action. Check its status before trying again.'): string {
  return error instanceof WebsiteError ? error.message : fallback;
}

export function timedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const deadline = AbortSignal.timeout(typeof FormData !== 'undefined' && init.body instanceof FormData ? 120000 : 15000);
  return globalThis.fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
}

// No automatic retries: a timed-out mutation may already have been accepted.
export async function requestJson<T = any>(url: string, init: RequestInit = {}, options: { context?: ErrorContext; timeoutMs?: number; fallback?: string } = {}): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (init.signal?.aborted) throw new WebsiteError(messages.REQUEST_CANCELLED);
  init.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = globalThis.setTimeout(cancel, Math.max(1000, Math.min(options.timeoutMs || 15000, 120000)));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (controller.signal.aborted) throw new WebsiteError(init.signal?.aborted ? messages.REQUEST_CANCELLED : messages.REQUEST_TIMEOUT);
    if (!response.ok || typeof data?.error === 'string' && data.error.length > 0) {
      const code = typeof data?.error === 'string' && Object.hasOwn(messages, data.error) ? data.error : options.context === 'login' && response.status === 401 ? 'INVALID_CREDENTIALS' : undefined;
      throw new WebsiteError(getApiErrorMessage(data, options.fallback || 'Check the information entered and try again.', response.status, options.context), response.status, code);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new WebsiteError(messages.INVALID_RESPONSE, 502);
    return data as T;
  } catch (error) {
    if (error instanceof WebsiteError) throw error;
    throw new WebsiteError(init.signal?.aborted ? messages.REQUEST_CANCELLED : controller.signal.aborted ? messages.REQUEST_TIMEOUT : messages.NETWORK_UNAVAILABLE);
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', cancel);
  }
}

export async function copyText(value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); }
  catch { throw new WebsiteError('Clipboard access was blocked. Select the text and copy it manually.'); }
}
