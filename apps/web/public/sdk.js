(function () {
  var sdkScriptElement = document.currentScript;
  var sdkAssetBaseUrl = sdkScriptElement && sdkScriptElement.src
    ? new URL('.', sdkScriptElement.src).toString().replace(/\/$/, '')
    : window.location.origin;

  function createWatermarkedBlob(imageUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          var context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);

          var watermarkText = 'DrapixAI';
          var fontSize = Math.max(18, Math.round(canvas.width * 0.026));
          var padding = Math.max(18, Math.round(canvas.width * 0.028));
          context.font = '700 ' + fontSize + 'px Arial, sans-serif';
          context.textAlign = 'right';
          context.textBaseline = 'bottom';

          var metrics = context.measureText(watermarkText);
          var textWidth = metrics.width;
          var boxWidth = textWidth + 24;
          var boxHeight = fontSize + 18;
          var x = canvas.width - padding;
          var y = canvas.height - padding;

          context.fillStyle = 'rgba(5, 8, 22, 0.62)';
          context.beginPath();
          if (typeof context.roundRect === 'function') {
            context.roundRect(x - boxWidth, y - boxHeight, boxWidth, boxHeight, 12);
          } else {
            context.rect(x - boxWidth, y - boxHeight, boxWidth, boxHeight);
          }
          context.fill();

          context.fillStyle = 'rgba(255,255,255,0.94)';
          context.fillText(watermarkText, x - 12, y - 10);

          canvas.toBlob(function (blob) {
            if (!blob) {
              reject(new Error('EXPORT_FAILED'));
              return;
            }
            resolve(blob);
          }, 'image/png');
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = function () {
        reject(new Error('IMAGE_LOAD_FAILED'));
      };
      image.src = imageUrl;
    });
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeCssValue(value, fallback) {
    var text = String(value == null ? '' : value).trim();
    if (!text || text.length > 220) {
      return fallback;
    }
    if (/[<>"'{};]/.test(text) || /expression\s*\(|javascript\s*:|data\s*:|@import|url\s*\(/i.test(text)) {
      return fallback;
    }
    return text;
  }

  function isLocalHttpAsset(resolved) {
    return resolved.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(resolved.hostname);
  }

  function sanitizeAssetUrl(value, fallback) {
    var text = String(value == null ? '' : value).trim();
    if (!text || text.length > 500 || /[\s<>"']/g.test(text)) {
      return fallback;
    }
    try {
      var resolved = new URL(text, window.location.origin);
      if (resolved.protocol === 'https:' || isLocalHttpAsset(resolved)) {
        return resolved.href;
      }
    } catch (_) {
      // reject malformed URLs
    }
    return fallback;
  }

  var SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  function isSupportedImageFile(file) {
    return Boolean(file && SUPPORTED_IMAGE_TYPES.indexOf(String(file.type || '').toLowerCase()) !== -1);
  }

  function parseNumber(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function parseJsonObject(value) {
    if (!value) {
      return undefined;
    }
    try {
      var parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function readTryOnMetadata(response) {
    var warnings = response.headers.get('x-drapixai-warnings') || '';
    return {
      resultId: response.headers.get('x-drapixai-tryon-result-id') || undefined,
      engine: response.headers.get('x-drapixai-engine') || undefined,
      qualityScore: parseNumber(response.headers.get('x-drapixai-quality-score')),
      candidateCount: parseNumber(response.headers.get('x-drapixai-candidate-count')),
      processingMs: parseNumber(response.headers.get('x-drapixai-processing-ms')),
      latencyMs: parseNumber(response.headers.get('x-drapixai-latency-ms')),
      latencyTargetMs: parseNumber(response.headers.get('x-drapixai-latency-target-ms')),
      qualityMode: response.headers.get('x-drapixai-quality-mode') || undefined,
      garmentSource: response.headers.get('x-drapixai-garment-source') || undefined,
      garmentCacheStatus: response.headers.get('x-drapixai-garment-cache-status') || undefined,
      garmentCacheVersion: response.headers.get('x-drapixai-garment-cache-version') || undefined,
      confidenceBadge: response.headers.get('x-drapixai-confidence-badge') || undefined,
      productAccuracyReport: parseJsonObject(response.headers.get('x-drapixai-product-accuracy-json')),
      timings: parseJsonObject(response.headers.get('x-drapixai-timing-json')),
      qualityMetrics: parseJsonObject(response.headers.get('x-drapixai-quality-json')),
      warnings: warnings ? warnings.split(',').map(function (item) { return item.trim(); }).filter(Boolean) : []
    };
  }

  function ensureWidgetStyles() {
    if (document.getElementById('drapixai-sdk-styles')) {
      return;
    }

    var style = document.createElement('style');
    style.id = 'drapixai-sdk-styles';
    style.textContent = [
      '@keyframes drapixPulse {',
      '  0% { transform: translateY(0px); opacity: 0.55; }',
      '  50% { transform: translateY(-4px); opacity: 0.85; }',
      '  100% { transform: translateY(0px); opacity: 0.55; }',
      '}',
      '.drapix-dropzone.dragover { border-color: rgba(34,211,238,0.7) !important; background: rgba(34,211,238,0.12) !important; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function isUsableColor(value) {
    return value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)' && value !== 'rgba(0,0,0,0)';
  }

  function getComputedValue(node, property, fallback) {
    if (!node || !window.getComputedStyle) {
      return fallback;
    }
    var value = window.getComputedStyle(node).getPropertyValue(property);
    return value && value.trim() ? value.trim() : fallback;
  }

  function findBrandButton() {
    var selectors = [
      '[data-drapix-brand-button]',
      '.product-card button:not([data-drapix-launcher])',
      'button:not([data-drapix-launcher])',
      '[role="button"]',
      '.button',
      '.btn'
    ];
    for (var index = 0; index < selectors.length; index += 1) {
      var node = document.querySelector(selectors[index]);
      if (node) {
        return node;
      }
    }
    return null;
  }

  function resolveBrandTheme(anchor, options, config) {
    var theme = options.theme || {};
    var root = document.documentElement;
    var body = document.body || root;
    var brandButton = findBrandButton();
    var computedButtonBg = getComputedValue(brandButton, 'background-color', '');
    var computedButtonRadius = getComputedValue(brandButton, 'border-radius', '');
    var computedFont = getComputedValue(body, 'font-family', 'Arial, sans-serif');
    var computedText = getComputedValue(body, 'color', '#111827');
    var computedSurface = getComputedValue(anchor, 'background-color', '') || getComputedValue(body, 'background-color', '#ffffff');
    var rootPrimary = getComputedValue(root, '--drapixai-primary', '');

    var primary = theme.primaryColor
      || theme.primary
      || rootPrimary
      || (isUsableColor(computedButtonBg) ? computedButtonBg : '')
      || '#111827';
    var radius = theme.radius || computedButtonRadius || '8px';
    var fontFamily = theme.fontFamily || computedFont;

    return {
      primary: sanitizeCssValue(primary, '#111827'),
      primaryGradient: sanitizeCssValue(theme.primaryGradient || config.primaryGradient || primary, '#111827'),
      fontFamily: sanitizeCssValue(fontFamily, 'Arial, sans-serif'),
      text: sanitizeCssValue(theme.textColor || computedText || '#111827', '#111827'),
      mutedText: sanitizeCssValue(theme.mutedTextColor || '#64748b', '#64748b'),
      surface: sanitizeCssValue(theme.surfaceColor || '#ffffff', '#ffffff'),
      softSurface: sanitizeCssValue(theme.softSurfaceColor || '#f8fafc', '#f8fafc'),
      pageSurface: sanitizeCssValue(theme.pageSurfaceColor || (isUsableColor(computedSurface) ? computedSurface : '#f8fafc'), '#f8fafc'),
      border: sanitizeCssValue(theme.borderColor || '#dbe4ee', '#dbe4ee'),
      radius: sanitizeCssValue(radius, '8px'),
      cardRadius: sanitizeCssValue(theme.cardRadius || '24px', '24px'),
      buttonRadius: sanitizeCssValue(theme.buttonRadius || radius, '8px'),
      shadow: sanitizeCssValue(theme.shadow || '0 30px 80px rgba(15,23,42,0.22)', '0 30px 80px rgba(15,23,42,0.22)'),
      overlay: sanitizeCssValue(theme.overlayColor || 'rgba(15, 23, 42, 0.34)', 'rgba(15, 23, 42, 0.34)')
    };
  }

  window.DrapixAI = {
    init: async function (options) {
      options = options || {};
      var config = {
        apiKey: options.apiKey,
        productId: options.productId || 'default',
        containerId: options.containerId || 'drapixai-container',
        autoAttach: Boolean(options.autoAttach),
        productSelector: options.productSelector || '[data-drapix-product-id]',
        productIdAttribute: options.productIdAttribute || 'data-drapix-product-id',
        buttonTargetSelector: options.buttonTargetSelector || '[data-drapix-button-slot]',
        baseUrl: options.baseUrl || window.DRAPIXAI_API_BASE_URL || window.location.origin,
        garmentType: (options.garmentType || 'upper').toLowerCase(),
        quality: 'standard',
        buttonText: options.buttonText || 'Try On',
        modalTitle: options.modalTitle || 'DrapixAI Virtual Try-On',
        modalSubtitle: options.modalSubtitle || 'Upload your front-facing image and generate a polished DrapixAI try-on preview.',
        footerText: options.footerText || 'Privacy: your photo is used only for this try-on preview, quality review, fraud prevention, and support. It is not shown publicly.',
        timeoutMs: Number(options.timeoutMs || 20000),
        adaptBrandTheme: options.adaptBrandTheme !== false,
        primaryGradient: options.primaryGradient || null,
        buyButtonText: options.buyButtonText || 'Buy this item',
        buyUrlAttribute: options.buyUrlAttribute || 'data-drapix-buy-url',
        logoUrl: sanitizeAssetUrl(options.logoUrl || sdkAssetBaseUrl + '/drapixai_emblem_64.webp', sdkAssetBaseUrl + '/drapixai_emblem_64.webp')
      };

      function reportStartupError(message, productId) {
        if (typeof options.onError === 'function') {
          options.onError({ message: message, productId: productId || config.productId });
        }
        return new Error(message);
      }

      if (config.garmentType !== 'upper') {
        throw reportStartupError('UPPER_BODY_ONLY');
      }
      if (options.quality && String(options.quality).toLowerCase() !== 'standard') {
        throw reportStartupError('INVALID_QUALITY');
      }

      var container = document.getElementById(config.containerId);
      if (!config.autoAttach && !container) {
        throw reportStartupError('CONTAINER_NOT_FOUND');
      }

      ensureWidgetStyles();

      var domain = window.location.hostname;
      var validateRes;
      try {
        validateRes = await fetch(config.baseUrl + '/sdk/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + config.apiKey
          },
          body: JSON.stringify({ domain: domain })
        });
      } catch (_) {
        throw reportStartupError('VALIDATION_NETWORK_FAILED');
      }

      if (!validateRes.ok) {
        var validateErr = await validateRes.json().catch(function () { return {}; });
        throw reportStartupError(validateErr && (validateErr.message || validateErr.error) || 'VALIDATION_FAILED');
      }

      function createLauncherMarkup(productId, theme) {
        theme = theme || resolveBrandTheme(document.body, options, config);
        return [
          '<div style="font-family:', escapeHtml(theme.fontFamily), ';">',
          '  <button data-drapix-launcher="true" data-drapix-product-id="', escapeHtml(productId), '" style="display:inline-flex;align-items:center;gap:10px;background:', escapeHtml(theme.primaryGradient), ';color:#fff;border:none;padding:10px 16px;border-radius:', escapeHtml(theme.buttonRadius), ';cursor:pointer;font-weight:700;box-shadow:0 12px 30px rgba(15,23,42,0.14);font-family:', escapeHtml(theme.fontFamily), ';">',
          '    <img src="', escapeHtml(config.logoUrl), '" alt="" aria-hidden="true" style="width:26px;height:26px;object-fit:cover;border-radius:6px;" />',
          '    ', escapeHtml(config.buttonText),
          '  </button>',
          '</div>'
        ].join('');
      }

      function bindLauncher(openBtn, productId) {
        openBtn.addEventListener('click', function () {
        if (document.getElementById('drapix-modal')) {
          return;
        }

        var productNode = openBtn.closest ? openBtn.closest(config.productSelector) : null;
        var buyUrl = options.buyUrl || options.checkoutUrl || (productNode ? productNode.getAttribute(config.buyUrlAttribute) : '');
        var theme = config.adaptBrandTheme ? resolveBrandTheme(productNode || openBtn, options, config) : resolveBrandTheme(document.body, { theme: options.theme || {} }, config);

        var modal = document.createElement('div');
        modal.id = 'drapix-modal';
        modal.style.position = 'fixed';
        modal.style.inset = '0';
        modal.style.zIndex = '9999';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.padding = '18px';
        modal.style.background = theme.overlay;
        modal.style.fontFamily = theme.fontFamily;

        modal.innerHTML = [
          '<div id="drapix-card" style="position:relative;width:min(680px,96vw);max-height:92vh;overflow:auto;border-radius:', escapeHtml(theme.cardRadius), ';border:1px solid ', escapeHtml(theme.border), ';background:', escapeHtml(theme.surface), ';color:', escapeHtml(theme.text), ';box-shadow:', escapeHtml(theme.shadow), ';font-family:', escapeHtml(theme.fontFamily), ';">',
          '  <button id="drapix-close" type="button" aria-label="Close DrapixAI try-on" style="position:absolute;z-index:3;top:16px;right:18px;width:36px;height:36px;min-width:36px;min-height:36px;padding:0;border-radius:999px;border:1px solid ', escapeHtml(theme.border), ';background:', escapeHtml(theme.surface), ';color:', escapeHtml(theme.text), ';cursor:pointer;font-size:22px;line-height:1;box-shadow:0 8px 22px rgba(15,23,42,0.08);font-family:', escapeHtml(theme.fontFamily), ';display:inline-flex;align-items:center;justify-content:center;text-align:center;">&times;</button>',
          '  <div style="position:relative;padding:26px;">',
          '    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">',
          '      <img src="', escapeHtml(config.logoUrl), '" alt="DrapixAI" style="display:block;width:40px;height:40px;object-fit:cover;border-radius:', escapeHtml(theme.buttonRadius), ';" />',
          '      <div>',
          '        <div style="font-size:15px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:', escapeHtml(theme.primary), ';">DrapixAI</div>',
          '        <div style="font-size:12px;color:', escapeHtml(theme.mutedText), ';">Premium virtual try-on preview</div>',
          '      </div>',
          '    </div>',
          '    <div style="font-size:24px;font-weight:700;line-height:1.2;margin-bottom:8px;">', escapeHtml(config.modalTitle), '</div>',
          '    <div style="font-size:13px;line-height:1.6;color:', escapeHtml(theme.mutedText), ';max-width:560px;margin-bottom:20px;">', escapeHtml(config.modalSubtitle), '</div>',
          '    <div style="display:grid;gap:18px;">',
          '      <div id="drapix-dropzone" class="drapix-dropzone" style="position:relative;border:1px dashed ', escapeHtml(theme.border), ';border-radius:', escapeHtml(theme.cardRadius), ';padding:24px;background:', escapeHtml(theme.softSurface), ';transition:all .2s ease;">',
          '        <input id="drapix-person" type="file" accept="image/jpeg,image/png,image/webp" style="display:none;" />',
          '        <div id="drapix-upload-state">',
          '          <div style="display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:', escapeHtml(theme.buttonRadius), ';background:', escapeHtml(theme.pageSurface), ';margin-bottom:14px;">',
          '            <span style="font-size:22px;color:', escapeHtml(theme.text), ';">&#8593;</span>',
          '          </div>',
          '          <div style="font-size:16px;font-weight:700;margin-bottom:8px;">Upload your front-facing image or drop it here</div>',
          '          <div style="font-size:13px;color:', escapeHtml(theme.mutedText), ';line-height:1.6;">Clear lighting and a straight-facing pose produce the strongest DrapixAI try-on previews.</div>',
          '        </div>',
          '        <div id="drapix-preview-shell" style="display:none;">',
          '          <div style="display:grid;grid-template-columns:160px 1fr;gap:16px;align-items:center;">',
          '            <img id="drapix-preview" alt="Preview" style="width:160px;height:200px;object-fit:cover;border-radius:', escapeHtml(theme.buttonRadius), ';border:1px solid ', escapeHtml(theme.border), ';background:', escapeHtml(theme.softSurface), ';" />',
          '            <div>',
          '              <div style="font-size:15px;font-weight:700;margin-bottom:6px;">Ready to proceed</div>',
          '              <div id="drapix-file-name" style="font-size:13px;color:', escapeHtml(theme.text), ';margin-bottom:10px;"></div>',
          '              <div style="font-size:12px;line-height:1.6;color:', escapeHtml(theme.mutedText), ';">If you want a different photo, use Reset and upload another front-facing image before starting the virtual try-on process.</div>',
          '            </div>',
          '          </div>',
          '        </div>',
          '      </div>',
          '      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;">',
          '        <label style="font-size:12px;color:', escapeHtml(theme.mutedText), ';display:flex;gap:10px;align-items:flex-start;max-width:390px;">',
          '          <input id="drapix-consent" type="checkbox" style="accent-color:', escapeHtml(theme.primary), ';margin-top:2px;" />',
          '          <span>I confirm I have permission to upload this image for DrapixAI try-on preview processing.</span>',
          '        </label>',
          '        <div style="display:flex;gap:10px;flex-wrap:wrap;">',
          '          <button id="drapix-reset" type="button" style="display:inline-flex;align-items:center;justify-content:center;padding:11px 18px;border-radius:', escapeHtml(theme.buttonRadius), ';border:1px solid ', escapeHtml(theme.border), ';background:', escapeHtml(theme.surface), ';color:', escapeHtml(theme.text), ';font-weight:600;cursor:pointer;font-family:', escapeHtml(theme.fontFamily), ';">Reset</button>',
          '          <button id="drapix-run" type="button" style="display:inline-flex;align-items:center;justify-content:center;padding:11px 18px;border-radius:', escapeHtml(theme.buttonRadius), ';border:none;background:', escapeHtml(theme.primaryGradient), ';color:#fff;font-weight:700;cursor:pointer;box-shadow:0 12px 30px rgba(15,23,42,0.14);font-family:', escapeHtml(theme.fontFamily), ';">Proceed</button>',
          '        </div>',
          '      </div>',
          '      <div style="display:flex;gap:10px;align-items:flex-start;border:1px solid ', escapeHtml(theme.border), ';border-radius:', escapeHtml(theme.buttonRadius), ';background:', escapeHtml(theme.pageSurface), ';padding:12px 14px;">',
          '        <span style="display:inline-flex;width:22px;height:22px;border-radius:999px;background:', escapeHtml(theme.primaryGradient), ';color:#fff;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex:0 0 auto;">&#10003;</span>',
          '        <div style="font-size:12px;line-height:1.6;color:', escapeHtml(theme.mutedText), ';">DrapixAI checks realism, garment accuracy, pose preservation, and latency before showing a storefront preview.</div>',
          '      </div>',
          '      <div id="drapix-progress" style="display:none;">',
          '        <div style="height:8px;border-radius:999px;background:', escapeHtml(theme.pageSurface), ';overflow:hidden;">',
          '          <div id="drapix-progress-bar" style="height:100%;width:14%;background:', escapeHtml(theme.primaryGradient), ';transition:width .25s ease;"></div>',
          '        </div>',
          '      </div>',
          '      <div id="drapix-status" style="font-size:13px;color:', escapeHtml(theme.mutedText), ';min-height:20px;"></div>',
          '      <div id="drapix-result-shell" style="display:none;border:1px solid ', escapeHtml(theme.border), ';border-radius:', escapeHtml(theme.cardRadius), ';padding:18px;background:', escapeHtml(theme.surface), ';">',
          '        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;">',
          '          <div>',
          '            <div style="font-size:18px;font-weight:700;">Your try-on preview is ready</div>',
          '            <div id="drapix-result-meta" style="font-size:12px;color:', escapeHtml(theme.mutedText), ';margin-top:4px;">Download and Share exports include a small DrapixAI watermark in the bottom-right corner.</div>',
          '          </div>',
          '          <div style="display:flex;gap:10px;flex-wrap:wrap;">',
          '            <button id="drapix-buy" type="button" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:', escapeHtml(theme.buttonRadius), ';border:none;background:', escapeHtml(theme.primaryGradient), ';color:#fff;font-weight:700;cursor:pointer;font-family:', escapeHtml(theme.fontFamily), ';">', escapeHtml(config.buyButtonText), '</button>',
          '            <button id="drapix-download" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:', escapeHtml(theme.buttonRadius), ';border:1px solid ', escapeHtml(theme.border), ';background:', escapeHtml(theme.surface), ';color:', escapeHtml(theme.text), ';font-weight:700;cursor:pointer;font-family:', escapeHtml(theme.fontFamily), ';">Download</button>',
          '            <button id="drapix-share" type="button" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:', escapeHtml(theme.buttonRadius), ';border:1px solid ', escapeHtml(theme.border), ';background:', escapeHtml(theme.surface), ';color:', escapeHtml(theme.text), ';font-weight:600;cursor:pointer;font-family:', escapeHtml(theme.fontFamily), ';">Share</button>',
          '          </div>',
          '        </div>',
          '        <img id="drapix-result" alt="DrapixAI Result" style="width:100%;display:block;border-radius:', escapeHtml(theme.buttonRadius), ';background:', escapeHtml(theme.softSurface), ';border:1px solid ', escapeHtml(theme.border), ';" />',
          '      </div>',
          '      <div style="font-size:11px;color:', escapeHtml(theme.mutedText), ';">', escapeHtml(config.footerText), '</div>',
          '    </div>',
          '  </div>',
          '</div>'
        ].join('');

        document.body.appendChild(modal);

        var personInput = modal.querySelector('#drapix-person');
        var dropzone = modal.querySelector('#drapix-dropzone');
        var uploadState = modal.querySelector('#drapix-upload-state');
        var previewShell = modal.querySelector('#drapix-preview-shell');
        var preview = modal.querySelector('#drapix-preview');
        var fileName = modal.querySelector('#drapix-file-name');
        var resetBtn = modal.querySelector('#drapix-reset');
        var runBtn = modal.querySelector('#drapix-run');
        var status = modal.querySelector('#drapix-status');
        var resultShell = modal.querySelector('#drapix-result-shell');
        var result = modal.querySelector('#drapix-result');
        var progress = modal.querySelector('#drapix-progress');
        var progressBar = modal.querySelector('#drapix-progress-bar');
        var closeBtn = modal.querySelector('#drapix-close');
        var buyBtn = modal.querySelector('#drapix-buy');
        var downloadBtn = modal.querySelector('#drapix-download');
        var shareBtn = modal.querySelector('#drapix-share');
        var activePreviewUrl = '';
        var activeResultUrl = '';
        var activeController = null;
        var isClosed = false;

        function closeModal() {
          if (isClosed) {
            return;
          }
          isClosed = true;
          if (activeController) {
            activeController.abort();
          }
          if (activePreviewUrl) {
            URL.revokeObjectURL(activePreviewUrl);
          }
          if (activeResultUrl) {
            URL.revokeObjectURL(activeResultUrl);
          }
          document.removeEventListener('keydown', handleEscape);
          modal.remove();
        }

        function handleEscape(event) {
          if (event.key === 'Escape') {
            closeModal();
          }
        }

        function updatePreview(file) {
          if (activePreviewUrl) {
            URL.revokeObjectURL(activePreviewUrl);
          }
          activePreviewUrl = URL.createObjectURL(file);
          preview.src = activePreviewUrl;
          fileName.textContent = file.name;
          uploadState.style.display = 'none';
          previewShell.style.display = 'block';
          status.textContent = 'Photo ready. Click Proceed to start the virtual try-on.';
        }

        function resetState() {
          if (activePreviewUrl) {
            URL.revokeObjectURL(activePreviewUrl);
            activePreviewUrl = '';
          }
          if (activeResultUrl) {
            URL.revokeObjectURL(activeResultUrl);
            activeResultUrl = '';
          }
          personInput.value = '';
          preview.removeAttribute('src');
          result.removeAttribute('src');
          uploadState.style.display = 'block';
          previewShell.style.display = 'none';
          resultShell.style.display = 'none';
          progress.style.display = 'none';
          progressBar.style.width = '14%';
          status.textContent = 'Upload a new front-facing image to continue.';
        }

        function setSelectedFile(file) {
          var transfer = new DataTransfer();
          transfer.items.add(file);
          personInput.files = transfer.files;
          updatePreview(file);
        }

        async function exportWatermarkedBlob() {
          if (!activeResultUrl) {
            throw new Error('RESULT_NOT_READY');
          }
          return createWatermarkedBlob(activeResultUrl);
        }

        async function handleDownload() {
          try {
            status.textContent = 'Preparing watermarked download...';
            var blob = await exportWatermarkedBlob();
            downloadBlob(blob, 'drapixai-tryon.png');
            status.textContent = 'Downloaded your watermarked DrapixAI result.';
          } catch (error) {
            status.textContent = 'Unable to prepare the download right now.';
          }
        }

        async function handleShare() {
          try {
            status.textContent = 'Preparing shareable result...';
            var blob = await exportWatermarkedBlob();
            var file = new File([blob], 'drapixai-tryon.png', { type: 'image/png' });

            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({
                title: 'DrapixAI Virtual Try-On',
                text: 'Generated with DrapixAI',
                files: [file]
              });
              status.textContent = 'Share sheet opened.';
              return;
            }

            downloadBlob(blob, 'drapixai-tryon-share.png');
            status.textContent = 'Your browser does not support direct file sharing here, so we downloaded the watermarked result instead.';
          } catch (error) {
            status.textContent = 'Unable to share the result right now.';
          }
        }

        function handleBuy() {
          var resolvedProductId = productId || config.productId;
          var detail = { productId: resolvedProductId, buyUrl: buyUrl || undefined };

          if (typeof options.onBuy === 'function') {
            options.onBuy(detail);
          }
          window.dispatchEvent(new CustomEvent('drapixai:buy', { detail: detail }));

          if (buyUrl) {
            window.location.href = buyUrl;
            return;
          }

          status.textContent = 'Buy action sent for this item.';
        }

        closeBtn.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          closeModal();
        });
        modal.addEventListener('click', function (event) {
          if (event.target === modal) {
            closeModal();
          }
        });
        modal.querySelector('#drapix-card').addEventListener('click', function (event) {
          event.stopPropagation();
        });
        document.addEventListener('keydown', handleEscape);

        dropzone.addEventListener('click', function () {
          personInput.click();
        });
        personInput.addEventListener('change', function () {
          if (personInput.files && personInput.files[0]) {
            if (!isSupportedImageFile(personInput.files[0])) {
              status.textContent = 'Please upload a JPEG, PNG, or WebP image.';
              personInput.value = '';
              return;
            }
            updatePreview(personInput.files[0]);
          }
        });
        ['dragenter', 'dragover'].forEach(function (eventName) {
          dropzone.addEventListener(eventName, function (event) {
            event.preventDefault();
            event.stopPropagation();
            dropzone.classList.add('dragover');
          });
        });
        ['dragleave', 'drop'].forEach(function (eventName) {
          dropzone.addEventListener(eventName, function (event) {
            event.preventDefault();
            event.stopPropagation();
            dropzone.classList.remove('dragover');
          });
        });
        dropzone.addEventListener('drop', function (event) {
          var droppedFile = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
          if (isSupportedImageFile(droppedFile)) {
            setSelectedFile(droppedFile);
          } else {
            status.textContent = 'Please drop a JPEG, PNG, or WebP image.';
          }
        });

        resetBtn.addEventListener('click', function () {
          resetState();
        });
        buyBtn.addEventListener('click', handleBuy);
        downloadBtn.addEventListener('click', handleDownload);
        shareBtn.addEventListener('click', handleShare);

        runBtn.addEventListener('click', async function () {
          if (!personInput.files || !personInput.files[0]) {
            status.textContent = 'Please upload your front-facing image first.';
            return;
          }

          if (!isSupportedImageFile(personInput.files[0])) {
            status.textContent = 'Please upload a JPEG, PNG, or WebP image.';
            return;
          }

          var consent = modal.querySelector('#drapix-consent');
          if (consent && !consent.checked) {
            status.textContent = 'Please confirm image upload consent before proceeding.';
            return;
          }

          status.textContent = 'Brewing your DrapixAI virtual try-on...';
          resultShell.style.display = 'none';
          progress.style.display = 'block';
          progressBar.style.width = '18%';
          runBtn.disabled = true;
          runBtn.style.opacity = '0.7';
          runBtn.style.cursor = 'wait';

          var progressStops = [18, 32, 52, 72, 88];
          var progressIndex = 0;
          var progressTimer = setInterval(function () {
            if (progressIndex < progressStops.length) {
              progressBar.style.width = progressStops[progressIndex] + '%';
              progressIndex += 1;
            }
          }, 520);

          try {
            var form = new FormData();
            form.append('person_image', personInput.files[0]);
            form.append('productId', productId || config.productId);
            form.append('quality', config.quality);
            form.append('garment_type', config.garmentType);

            var startedAt = Date.now();
            activeController = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timeoutId = activeController ? setTimeout(function () {
              activeController.abort();
            }, config.timeoutMs) : null;
            var res = await fetch(config.baseUrl + '/sdk/tryon', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + config.apiKey },
              body: form,
              signal: activeController ? activeController.signal : undefined
            });
            if (timeoutId) {
              clearTimeout(timeoutId);
            }

            if (!res.ok) {
              var err = await res.json().catch(function () { return {}; });
              if (err && err.error === 'TRYON_RESULT_NOT_PUBLISHABLE') {
                throw new Error(err.message || 'This preview did not pass DrapixAI quality checks. Please retry with a clearer front-facing photo.');
              }
              throw new Error(err && (err.message || err.error) || 'TRY_ON_FAILED');
            }

            var metadata = readTryOnMetadata(res);
            if (!metadata.latencyMs) {
              metadata.latencyMs = Date.now() - startedAt;
            }
            var blob = await res.blob();
            if (activeResultUrl) {
              URL.revokeObjectURL(activeResultUrl);
            }
            window.DrapixAI.lastResultMetadata = metadata;
            if (typeof options.onResult === 'function') {
              options.onResult(metadata);
            }
            activeResultUrl = URL.createObjectURL(blob);
            result.src = activeResultUrl;
            var resultMeta = modal.querySelector('#drapix-result-meta');
            if (resultMeta) {
              var latencyText = metadata.latencyMs ? ' - ' + (metadata.latencyMs / 1000).toFixed(1) + 's' : '';
              var scoreText = typeof metadata.qualityScore === 'number' ? ' - score ' + metadata.qualityScore.toFixed(2) : '';
              resultMeta.textContent = (metadata.confidenceBadge || 'Review') + scoreText + latencyText + '. Download and Share exports include a small DrapixAI watermark.';
            }
            resultShell.style.display = 'block';
            progressBar.style.width = '100%';
            status.textContent = 'Your DrapixAI try-on is ready.';
          } catch (error) {
            if (isClosed) {
              return;
            }
            var message = error && error.name === 'AbortError'
              ? 'TRY_ON_TIMEOUT'
              : (error && error.message ? error.message : 'Try-on failed.');
            if (typeof options.onError === 'function') {
              options.onError({ message: message, productId: productId || config.productId });
            }
            status.textContent = message;
            progressBar.style.width = '0%';
            resultShell.style.display = 'none';
          } finally {
            activeController = null;
            clearInterval(progressTimer);
            if (isClosed) {
              return;
            }
            setTimeout(function () {
              progress.style.display = 'none';
              progressBar.style.width = '14%';
            }, 500);
            runBtn.disabled = false;
            runBtn.style.opacity = '1';
            runBtn.style.cursor = 'pointer';
          }
        });
        });
      }

      function attachLaunchers(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var productNodes = Array.prototype.slice.call(scope.querySelectorAll(config.productSelector));
        productNodes.forEach(function (node) {
          var productId = node.getAttribute(config.productIdAttribute);
          if (!productId) {
            return;
          }
          var targetNode = node.querySelector(config.buttonTargetSelector) || node;
          if (targetNode.querySelector('[data-drapix-launcher="true"]')) {
            return;
          }
          var wrapper = document.createElement('div');
          wrapper.innerHTML = createLauncherMarkup(productId, resolveBrandTheme(node, options, config));
          var launcher = wrapper.firstElementChild;
          targetNode.appendChild(launcher);
          if (launcher) {
            bindLauncher(launcher, productId);
          }
        });
      }

      if (config.autoAttach) {
        attachLaunchers(document);

        if (!window.__drapixObserverAttached) {
          var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
              Array.prototype.slice.call(mutation.addedNodes || []).forEach(function (node) {
                if (node && node.nodeType === 1) {
                  attachLaunchers(node);
                }
              });
            });
          });
          observer.observe(document.body, { childList: true, subtree: true });
          window.__drapixObserverAttached = true;
        }
        return;
      }

      container.innerHTML = createLauncherMarkup(config.productId, resolveBrandTheme(container, options, config));
      var openBtn = container.querySelector('[data-drapix-launcher="true"]');
      bindLauncher(openBtn, config.productId);
    }
  };
})();
