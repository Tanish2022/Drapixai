import { buildOtpEmail } from '../services/email-templates';

export const buildStagingEmailTests = () => (['signup', 'password_reset'] as const).map(purpose => {
  const content = buildOtpEmail('DEMO-CODE', purpose);
  const id = purpose === 'signup' ? '20261022-APP-SIGNUP-01' : '20261022-APP-RESET-01';
  const notice = `TEST ONLY. Test ID: ${id}. This is an email template example. DEMO-CODE is not a usable verification code. No account action was requested or changed.`;
  return {
    id, purpose,
    subject:`TEST ONLY - DrapixAI ${purpose === 'signup' ? 'signup' : 'password-reset'} email - ${id}`,
    text:`${notice}\n\n${content.text}`,
    html:content.html.replace(/(<body[^>]*>)/, `$1<p style="padding:16px;background:#fff3cd;color:#332701;font:16px Arial;">${notice}</p>`),
    idempotencyKey:`cpu-staging-app-email/${id}`,
  };
});
