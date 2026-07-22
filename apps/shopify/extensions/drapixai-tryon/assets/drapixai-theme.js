(function () {
  'use strict';

  function showStatus(root, message) {
    var status = root.querySelector('[data-drapixai-status]');
    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
  }

  function loadScript(url) {
    if (window.DrapixAI) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-drapixai-sdk]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.drapixaiSdk = '1';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function clickProductBuyButton() {
    var submit = document.querySelector('form[action*="/cart/add"] button[type="submit"], form[action*="/cart/add"] input[type="submit"]');
    if (submit && typeof submit.click === 'function') submit.click();
  }

  async function mount(root) {
    if (root.dataset.drapixaiMounted === '1') return;
    root.dataset.drapixaiMounted = '1';
    var apiBase = String(root.dataset.apiBase || '').replace(/\/+$/, '');
    var shop = root.dataset.shop || '';
    if (!apiBase || !shop) {
      showStatus(root, 'DrapixAI is not configured for this theme yet.');
      return;
    }

    try {
      var productId = String(root.dataset.productId || '');
      var storefrontConfigUrl = '/apps/drapixai?product_id=' + encodeURIComponent(productId);
      var response = await fetch(storefrontConfigUrl, {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      var config = await response.json();
      if (!response.ok || !config.token || !config.sdkUrl) throw new Error(config.error || 'CONFIG_UNAVAILABLE');
      await loadScript(config.sdkUrl);
      await window.DrapixAI.init({
        apiKey: config.token,
        tokenProvider: async function (requestedProductId) {
          var tokenResponse = await fetch('/apps/drapixai?product_id=' + encodeURIComponent(requestedProductId), {
            credentials: 'same-origin',
            cache: 'no-store'
          });
          var tokenConfig = await tokenResponse.json();
          if (!tokenResponse.ok || !tokenConfig.token) throw new Error(tokenConfig.error || 'TOKEN_UNAVAILABLE');
          return tokenConfig.token;
        },
        productId: productId,
        containerId: root.dataset.containerId,
        baseUrl: config.baseUrl || apiBase,
        garmentType: 'upper',
        quality: 'standard',
        buttonText: root.dataset.buttonText || 'Try it on',
        buyButtonText: root.dataset.buyText || 'Buy this item',
        enableDownload: true,
        adaptBrandTheme: true,
        onBuy: clickProductBuyButton,
        onError: function (error) {
          var code = error && error.message ? error.message : 'TRY_ON_UNAVAILABLE';
          if (code === 'GARMENT_CACHE_REQUIRED' || code === 'GARMENT_NOT_READY') {
            showStatus(root, 'Try-on is being prepared for this product.');
          }
        }
      });
    } catch (error) {
      root.dataset.drapixaiMounted = '0';
      showStatus(root, 'Virtual try-on is temporarily unavailable for this product.');
    }
  }

  function mountAll() {
    document.querySelectorAll('[data-drapixai-shopify]').forEach(mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();
  document.addEventListener('shopify:section:load', mountAll);
})();
