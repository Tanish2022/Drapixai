const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export const shopifyAppScript = `
const status = document.getElementById('status');
const button = document.getElementById('connect');
const next = document.getElementById('continue');
async function call(path, method) {
  const token = await shopify.idToken();
  const response = await fetch(path, {method, credentials:'omit', cache:'no-store', redirect:'error', headers:{Authorization:'Bearer '+token}});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'UNAVAILABLE');
  return body;
}
const messages = {
  SHOPIFY_ACCOUNT_OWNER_REQUIRED:'Ask the Shopify store owner to connect the DrapixAI workspace.',
  SHOPIFY_TOKEN_BUSY:'Another connection is in progress. Wait a moment, then try again.',
  RATE_LIMITED:'Too many attempts. Wait a minute before trying again.'
};
button.addEventListener('click', async () => {
  button.disabled = true; next.hidden = true; status.textContent = 'Verifying your store owner access…';
  try {
    const result = await call('/shopify/embedded/connect','POST');
    const url = new URL(result.continueUrl);
    if (url.protocol !== 'https:') throw new Error('UNAVAILABLE');
    next.href = url.href; next.hidden = false; next.focus();
    status.textContent = 'Continue in DrapixAI to sign in and confirm the workspace for this store.';
  } catch (error) { status.textContent = messages[error.message] || 'Connection could not be completed. Reopen DrapixAI from Shopify and try again.'; }
  finally {button.disabled = false;}
});
call('/shopify/embedded/status','GET').then(result => {
  status.textContent = result.connected ? 'This store is connected. Open DrapixAI to review its catalog and setup.' : 'Connect your store to your DrapixAI workspace. The store owner completes this step.';
  button.hidden = false;
}).catch(() => {status.textContent = 'Open this app from Shopify Admin to verify your session. If it is already open there, reload and try again.';});
`;

export const renderShopifyAppHome = (clientId: string, nonce: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="shopify-api-key" content="${escapeHtml(clientId)}"><meta name="robots" content="noindex,nofollow">
<title>DrapixAI · Connect your store</title>
<script nonce="${nonce}" src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f4f6f2;color:#172019;font:17px/1.6 system-ui,sans-serif}main{max-width:760px;margin:48px auto;padding:32px;background:#fff;border:1px solid #d4dcd5;border-radius:16px}h1{font-size:32px;line-height:1.2}p{max-width:62ch}button,a{font:inherit}button,.action{display:inline-block;background:#183f32;color:white;padding:12px 20px;border:2px solid transparent;border-radius:8px;cursor:pointer;text-decoration:none;margin:8px 8px 8px 0}button:disabled{cursor:wait}button:focus-visible,a:focus-visible{outline:3px solid #123c9e;outline-offset:4px}[hidden]{display:none!important}.note{padding:16px;background:#eef2ed}footer{margin-top:24px}footer a{color:#183f32}@media(max-width:600px){main{margin:16px;padding:20px}h1{font-size:28px}}</style></head>
<body><main><p>DrapixAI for Shopify</p><h1>Connect your store</h1>
<p id="status" role="status" aria-live="polite">Verifying your Shopify session…</p>
<button id="connect" type="button" hidden>Continue with DrapixAI</button>
<a id="continue" class="action" target="_blank" rel="noopener noreferrer" hidden>Open DrapixAI workspace (new tab)</a>
<p class="note">Read your product catalog, connect your workspace, then review eligible garments before enabling try-on. No customer or order access is requested. Try-on availability depends on completed setup and service readiness.</p>
<footer><a href="mailto:support@drapixai.com">Contact support</a></footer>
</main><script nonce="${nonce}">${shopifyAppScript}</script></body></html>`;
