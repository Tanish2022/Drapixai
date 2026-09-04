export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const getPublicBaseUrl = () => String(
  process.env.EMAIL_PUBLIC_BASE_URL
  || process.env.NEXT_PUBLIC_WEB_BASE_URL
  || 'https://drapixai.com'
).trim().replace(/\/+$/, '');

const getLogoUrl = () => String(
  process.env.EMAIL_BRAND_LOGO_URL
  || `${getPublicBaseUrl()}/drapixai_wordmark.webp`
).trim();

const getSupportEmail = () => String(process.env.EMAIL_SUPPORT_ADDRESS || 'support@drapixai.com').trim();

const renderShell = ({
  preheader,
  eyebrow,
  title,
  body,
  action,
  note,
}: {
  preheader: string;
  eyebrow: string;
  title: string;
  body: string;
  action?: { label: string; url: string };
  note?: string;
}) => {
  const logoUrl = escapeHtml(getLogoUrl());
  const supportEmail = escapeHtml(getSupportEmail());
  const actionMarkup = action
    ? `<a href="${escapeHtml(action.url)}" style="display:inline-block;background:#154b3a;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 20px;margin-top:8px;">${escapeHtml(action.label)}</a>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#eef2ed;color:#172019;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2ed;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #d8dfd9;">
            <tr>
              <td style="padding:24px 28px;border-bottom:1px solid #e1e6e2;">
                <img src="${logoUrl}" width="176" height="59" alt="DrapixAI" style="display:block;width:150px;height:auto;border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:34px 28px 28px;">
                <p style="margin:0 0 12px;color:#31725b;font-size:12px;font-weight:700;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                <h1 style="margin:0 0 18px;color:#101712;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.12;font-weight:700;">${escapeHtml(title)}</h1>
                <div style="color:#536057;font-size:16px;line-height:1.7;">${body}</div>
                ${actionMarkup}
                ${note ? `<p style="margin:24px 0 0;padding-top:18px;border-top:1px solid #e1e6e2;color:#748078;font-size:13px;line-height:1.6;">${note}</p>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background:#101712;color:#bdc7bf;font-size:12px;line-height:1.6;">
                This is an operational DrapixAI email. Need help? Contact
                <a href="mailto:${supportEmail}" style="color:#ffffff;">${supportEmail}</a>.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

export const buildOtpEmail = (
  code: string,
  purpose: 'signup' | 'email_change_current' | 'email_change_new' | 'password_reset'
): EmailContent => {
  const copy = {
    signup: {
      subject: 'Your DrapixAI sign-up verification code',
      eyebrow: 'Secure account verification',
      title: 'Complete your DrapixAI sign-up.',
      intro: 'Use this one-time code to verify your email and create your brand workspace.',
    },
    email_change_current: {
      subject: 'Verify your current DrapixAI email',
      eyebrow: 'Security check',
      title: 'Confirm your current email.',
      intro: 'Use this one-time code to confirm your current account email before changing it.',
    },
    email_change_new: {
      subject: 'Verify your new DrapixAI email',
      eyebrow: 'Security check',
      title: 'Verify your new email.',
      intro: 'Use this one-time code to verify the new email address for your DrapixAI account.',
    },
    password_reset: {
      subject: 'Your DrapixAI password reset code',
      eyebrow: 'Secure account recovery',
      title: 'Reset your DrapixAI password.',
      intro: 'Use this one-time code to continue resetting your password.',
    },
  }[purpose];
  const safeCode = escapeHtml(code);
  const text = `${copy.intro}\n\n${code}\n\nThis code expires in 10 minutes. DrapixAI will never ask you to share this code. If you did not request it, ignore this email.`;
  const html = renderShell({
    preheader: `${copy.intro} The code expires in 10 minutes.`,
    eyebrow: copy.eyebrow,
    title: copy.title,
    body: `<p style="margin:0 0 18px;">${escapeHtml(copy.intro)}</p><div style="display:inline-block;padding:14px 20px;background:#eef2ed;border-left:4px solid #31725b;color:#101712;font-size:28px;font-weight:700;letter-spacing:6px;">${safeCode}</div>`,
    note: 'This code expires in 10 minutes. DrapixAI will never ask you to share it. If you did not request this action, ignore this email.',
  });
  return { subject: copy.subject, text, html };
};

export const buildWelcomeEmail = (companyName?: string | null): EmailContent => {
  const brand = String(companyName || '').trim();
  const greeting = brand ? `Welcome, ${brand}.` : 'Welcome to DrapixAI.';
  const dashboardUrl = `${getPublicBaseUrl()}/dashboard`;
  const text = `${greeting}\n\nYour brand workspace is ready. Start by uploading a clean garment-only upper-body product image, confirm its product mapping, review the prepared cache, and publish only approved products.\n\nOpen your workspace: ${dashboardUrl}`;
  const html = renderShell({
    preheader: 'Your DrapixAI brand workspace is ready.',
    eyebrow: 'Workspace ready',
    title: greeting,
    body: '<p style="margin:0 0 14px;">Your brand workspace is ready.</p><p style="margin:0;">Start with a clean garment-only upper-body product image, confirm its product mapping, review the prepared cache, and publish only approved products.</p>',
    action: { label: 'Open brand workspace', url: dashboardUrl },
    note: 'Shopper photos are processed only for the requested try-on and are never used to train AI models.',
  });
  return { subject: 'Your DrapixAI workspace is ready', text, html };
};

export const buildGarmentDecisionEmail = (
  garmentId: string,
  status: 'approved' | 'rejected',
  reason?: string | null
): EmailContent => {
  const safeGarmentId = escapeHtml(garmentId);
  const dashboardUrl = `${getPublicBaseUrl()}/dashboard`;
  const approved = status === 'approved';
  const reasonText = String(reason || 'Review the garment record for the required changes.').trim();
  const subject = approved ? `Garment approved: ${garmentId}` : `Garment needs review: ${garmentId}`;
  const text = approved
    ? `Garment ${garmentId} passed review and is ready for its confirmed try-on mapping.\n\nReview product readiness: ${dashboardUrl}`
    : `Garment ${garmentId} did not pass review.\n\nReason: ${reasonText}\n\nReview and regenerate the garment cache: ${dashboardUrl}`;
  const html = renderShell({
    preheader: approved ? `${garmentId} passed DrapixAI review.` : `${garmentId} needs review before storefront use.`,
    eyebrow: approved ? 'Product approved' : 'Action required',
    title: approved ? 'This garment passed review.' : 'This garment needs another review.',
    body: approved
      ? `<p style="margin:0;">Garment <strong style="color:#172019;">${safeGarmentId}</strong> is ready for its confirmed try-on mapping.</p>`
      : `<p style="margin:0 0 12px;">Garment <strong style="color:#172019;">${safeGarmentId}</strong> was held back from storefront use.</p><p style="margin:0;"><strong style="color:#172019;">Reason:</strong> ${escapeHtml(reasonText)}</p>`,
    action: { label: approved ? 'Review product readiness' : 'Review garment cache', url: dashboardUrl },
    note: 'DrapixAI does not show rejected or unreviewed garment results to shoppers.',
  });
  return { subject, text, html };
};

export const buildTrialReminderEmail = (daysLeft: number): EmailContent => {
  const isLastDay = daysLeft <= 1;
  const upgradeUrl = process.env.BILLING_UPGRADE_URL || `${getPublicBaseUrl()}/pricing`;
  const subject = isLastDay ? 'Your DrapixAI trial ends today' : 'Your DrapixAI trial is ending soon';
  const timeText = isLastDay ? 'today' : `in ${daysLeft} days`;
  const text = `Your DrapixAI trial ends ${timeText}. Review your products and choose a plan to keep storefront try-on active.\n\nReview plans: ${upgradeUrl}`;
  const html = renderShell({
    preheader: `Your DrapixAI trial ends ${timeText}.`,
    eyebrow: 'Trial reminder',
    title: `Your trial ends ${timeText}.`,
    body: '<p style="margin:0;">Review your mapped products, approved garment caches, and current usage before choosing the capacity your storefront needs.</p>',
    action: { label: 'Review plans and usage', url: upgradeUrl },
    note: 'This reminder relates to your active DrapixAI workspace and is not a marketing campaign email.',
  });
  return { subject, text, html };
};
