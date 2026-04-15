(function () {
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
          context.roundRect(x - boxWidth, y - boxHeight, boxWidth, boxHeight, 12);
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

  window.DrapixAI = {
    init: async function (options) {
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
        buttonText: options.buttonText || 'Try On',
        modalTitle: options.modalTitle || 'DrapixAI Virtual Try-On',
        modalSubtitle: options.modalSubtitle || 'Upload your front-facing image and generate a polished DrapixAI try-on preview.',
        footerText: options.footerText || 'Your uploaded photo is processed only for the preview flow.',
        primaryGradient: options.primaryGradient || 'linear-gradient(135deg,#22d3ee 0%,#3b82f6 100%)'
      };

      if (config.garmentType !== 'upper') {
        throw new Error('UPPER_BODY_ONLY');
      }

      var container = document.getElementById(config.containerId);
      if (!config.autoAttach && !container) {
        throw new Error('CONTAINER_NOT_FOUND');
      }

      ensureWidgetStyles();

      var domain = window.location.hostname;
      var validateRes = await fetch(config.baseUrl + '/sdk/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.apiKey
        },
        body: JSON.stringify({ domain: domain })
      });

      if (!validateRes.ok) {
        var validateErr = await validateRes.json().catch(function () { return {}; });
        throw new Error(validateErr && (validateErr.message || validateErr.error) || 'VALIDATION_FAILED');
      }

      function createLauncherMarkup(productId) {
        return [
          '<div style="font-family: Arial, sans-serif;">',
          '  <button data-drapix-launcher="true" data-drapix-product-id="', productId, '" style="display:inline-flex;align-items:center;gap:10px;background:', config.primaryGradient, ';color:#fff;border:none;padding:10px 16px;border-radius:999px;cursor:pointer;font-weight:700;box-shadow:0 18px 40px rgba(34,211,238,0.18);">',
          '    <span style="display:inline-flex;width:26px;height:26px;border-radius:999px;background:rgba(255,255,255,0.16);align-items:center;justify-content:center;font-size:12px;">D</span>',
          '    ', config.buttonText,
          '  </button>',
          '</div>'
        ].join('');
      }

      function bindLauncher(openBtn, productId) {
        openBtn.addEventListener('click', function () {
        if (document.getElementById('drapix-modal')) {
          return;
        }

        var modal = document.createElement('div');
        modal.id = 'drapix-modal';
        modal.style.position = 'fixed';
        modal.style.inset = '0';
        modal.style.zIndex = '9999';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.padding = '18px';
        modal.style.background = 'rgba(4, 8, 20, 0.72)';

        modal.innerHTML = [
          '<div style="position:relative;width:min(680px,96vw);max-height:92vh;overflow:auto;border-radius:28px;border:1px solid rgba(255,255,255,0.08);background:linear-gradient(180deg,rgba(11,17,32,0.96) 0%,rgba(8,12,24,0.98) 100%);color:#fff;box-shadow:0 40px 120px rgba(4,8,20,0.65);">',
          '  <div style="position:absolute;inset:-20% auto auto -10%;width:220px;height:220px;border-radius:999px;background:rgba(34,211,238,0.14);filter:blur(45px);animation:drapixPulse 6s ease-in-out infinite;"></div>',
          '  <div style="position:absolute;inset:auto -12% -18% auto;width:240px;height:240px;border-radius:999px;background:rgba(59,130,246,0.12);filter:blur(55px);animation:drapixPulse 7s ease-in-out infinite;"></div>',
          '  <button id="drapix-close" style="position:absolute;top:16px;right:18px;width:36px;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#cbd5e1;cursor:pointer;font-size:18px;">×</button>',
          '  <div style="position:relative;padding:26px;">',
          '    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">',
          '      <div style="display:flex;width:40px;height:40px;border-radius:14px;align-items:center;justify-content:center;background:', config.primaryGradient, ';font-weight:800;letter-spacing:0.02em;">D</div>',
          '      <div>',
          '        <div style="font-size:15px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#dbeafe;">DrapixAI</div>',
          '        <div style="font-size:12px;color:#94a3b8;">Premium virtual try-on preview</div>',
          '      </div>',
          '    </div>',
          '    <div style="font-size:24px;font-weight:700;line-height:1.2;margin-bottom:8px;">', config.modalTitle, '</div>',
          '    <div style="font-size:13px;line-height:1.6;color:#9fb0c7;max-width:560px;margin-bottom:20px;">', config.modalSubtitle, '</div>',
          '    <div style="display:grid;gap:18px;">',
          '      <div id="drapix-dropzone" class="drapix-dropzone" style="position:relative;border:1px dashed rgba(255,255,255,0.16);border-radius:22px;padding:24px;background:rgba(255,255,255,0.03);transition:all .2s ease;">',
          '        <input id="drapix-person" type="file" accept="image/*" style="display:none;" />',
          '        <div id="drapix-upload-state">',
          '          <div style="display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:18px;background:rgba(255,255,255,0.06);margin-bottom:14px;">',
          '            <span style="font-size:22px;">↑</span>',
          '          </div>',
          '          <div style="font-size:16px;font-weight:700;margin-bottom:8px;">Upload your front-facing image or drop it here</div>',
          '          <div style="font-size:13px;color:#94a3b8;line-height:1.6;">Clear lighting and a straight-facing pose produce the strongest DrapixAI try-on previews.</div>',
          '        </div>',
          '        <div id="drapix-preview-shell" style="display:none;">',
          '          <div style="display:grid;grid-template-columns:160px 1fr;gap:16px;align-items:center;">',
          '            <img id="drapix-preview" alt="Preview" style="width:160px;height:200px;object-fit:cover;border-radius:18px;border:1px solid rgba(255,255,255,0.08);background:#081226;" />',
          '            <div>',
          '              <div style="font-size:15px;font-weight:700;margin-bottom:6px;">Ready to proceed</div>',
          '              <div id="drapix-file-name" style="font-size:13px;color:#cbd5e1;margin-bottom:10px;"></div>',
          '              <div style="font-size:12px;line-height:1.6;color:#94a3b8;">If you want a different photo, use Reset and upload another front-facing image before starting the virtual try-on process.</div>',
          '            </div>',
          '          </div>',
          '        </div>',
          '      </div>',
          '      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;">',
          '        <label style="font-size:12px;color:#cbd5e1;display:flex;gap:10px;align-items:flex-start;max-width:390px;">',
          '          <input id="drapix-consent" type="checkbox" style="accent-color:#22d3ee;margin-top:2px;" />',
          '          <span>I confirm I have permission to upload this image for DrapixAI try-on preview processing.</span>',
          '        </label>',
          '        <div style="display:flex;gap:10px;flex-wrap:wrap;">',
          '          <button id="drapix-reset" style="display:inline-flex;align-items:center;justify-content:center;padding:11px 18px;border-radius:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#e2e8f0;font-weight:600;cursor:pointer;">Reset</button>',
          '          <button id="drapix-run" style="display:inline-flex;align-items:center;justify-content:center;padding:11px 18px;border-radius:14px;border:none;background:', config.primaryGradient, ';color:#fff;font-weight:700;cursor:pointer;box-shadow:0 18px 40px rgba(34,211,238,0.16);">Proceed</button>',
          '        </div>',
          '      </div>',
          '      <div id="drapix-progress" style="display:none;">',
          '        <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.06);overflow:hidden;">',
          '          <div id="drapix-progress-bar" style="height:100%;width:14%;background:', config.primaryGradient, ';transition:width .25s ease;"></div>',
          '        </div>',
          '      </div>',
          '      <div id="drapix-status" style="font-size:13px;color:#a7b8cc;min-height:20px;"></div>',
          '      <div id="drapix-result-shell" style="display:none;border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:18px;background:rgba(255,255,255,0.03);">',
          '        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;">',
          '          <div>',
          '            <div style="font-size:18px;font-weight:700;">Your try-on preview is ready</div>',
          '            <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Download and Share exports include a small DrapixAI watermark in the bottom-right corner.</div>',
          '          </div>',
          '          <div style="display:flex;gap:10px;flex-wrap:wrap;">',
          '            <button id="drapix-download" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:12px;border:none;background:', config.primaryGradient, ';color:#fff;font-weight:700;cursor:pointer;">Download</button>',
          '            <button id="drapix-share" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#fff;font-weight:600;cursor:pointer;">Share</button>',
          '          </div>',
          '        </div>',
          '        <img id="drapix-result" alt="DrapixAI Result" style="width:100%;display:block;border-radius:18px;background:#081226;border:1px solid rgba(255,255,255,0.06);" />',
          '      </div>',
          '      <div style="font-size:11px;color:#7f91a8;">', config.footerText, '</div>',
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
        var downloadBtn = modal.querySelector('#drapix-download');
        var shareBtn = modal.querySelector('#drapix-share');
        var activePreviewUrl = '';
        var activeResultUrl = '';

        function closeModal() {
          if (activePreviewUrl) {
            URL.revokeObjectURL(activePreviewUrl);
          }
          if (activeResultUrl) {
            URL.revokeObjectURL(activeResultUrl);
          }
          modal.remove();
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

        modal.querySelector('#drapix-close').addEventListener('click', closeModal);
        modal.addEventListener('click', function (event) {
          if (event.target === modal) {
            closeModal();
          }
        });

        dropzone.addEventListener('click', function () {
          personInput.click();
        });
        personInput.addEventListener('change', function () {
          if (personInput.files && personInput.files[0]) {
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
          if (droppedFile && droppedFile.type.indexOf('image/') === 0) {
            setSelectedFile(droppedFile);
          } else {
            status.textContent = 'Please drop a valid image file.';
          }
        });

        resetBtn.addEventListener('click', function () {
          resetState();
        });
        downloadBtn.addEventListener('click', handleDownload);
        shareBtn.addEventListener('click', handleShare);

        runBtn.addEventListener('click', async function () {
          if (!personInput.files || !personInput.files[0]) {
            status.textContent = 'Please upload your front-facing image first.';
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
            form.append('quality', 'enhanced');
            form.append('garment_type', 'upper');

            var res = await fetch(config.baseUrl + '/sdk/tryon', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + config.apiKey },
              body: form
            });

            if (!res.ok) {
              var err = await res.json().catch(function () { return {}; });
              throw new Error(err && (err.message || err.error) || 'TRY_ON_FAILED');
            }

            var blob = await res.blob();
            if (activeResultUrl) {
              URL.revokeObjectURL(activeResultUrl);
            }
            activeResultUrl = URL.createObjectURL(blob);
            result.src = activeResultUrl;
            resultShell.style.display = 'block';
            progressBar.style.width = '100%';
            status.textContent = 'Your DrapixAI try-on is ready.';
          } catch (error) {
            status.textContent = error && error.message ? error.message : 'Try-on failed.';
            progressBar.style.width = '0%';
            resultShell.style.display = 'none';
          } finally {
            clearInterval(progressTimer);
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
          wrapper.innerHTML = createLauncherMarkup(productId);
          targetNode.appendChild(wrapper.firstElementChild);
          var launcher = targetNode.querySelector('[data-drapix-launcher="true"][data-drapix-product-id="' + productId + '"]');
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

      container.innerHTML = createLauncherMarkup(config.productId);
      var openBtn = container.querySelector('[data-drapix-launcher="true"]');
      bindLauncher(openBtn, config.productId);
    }
  };
})();
