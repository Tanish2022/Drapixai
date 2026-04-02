(function () {
  const DrapixAI = {
    init: async function (options) {
      const config = {
        apiKey: options.apiKey,
        productId: options.productId || 'default',
        containerId: options.containerId || 'drapixai-container',
        baseUrl: options.baseUrl || window.DRAPIXAI_API_BASE_URL || window.location.origin,
        garmentType: (options.garmentType || 'upper').toLowerCase(),
        buttonText: options.buttonText || 'Try On',
        modalTitle: options.modalTitle || 'DrapixAI Try-On (Upper Body)',
        modalSubtitle: options.modalSubtitle || 'Upload a person image. Garment is linked to the product ID.',
        footerText: options.footerText || 'Your photo is processed securely and not stored.',
        primaryGradient: options.primaryGradient || 'linear-gradient(90deg,#22d3ee,#3b82f6)',
      };

      if (config.garmentType !== 'upper') {
        throw new Error('UPPER_BODY_ONLY');
      }

      const container = document.getElementById(config.containerId);
      if (!container) throw new Error('Container not found');

      const domain = window.location.hostname;
      const validateRes = await fetch(`${config.baseUrl}/sdk/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({ domain })
      });

      if (!validateRes.ok) {
        const err = await validateRes.json();
        throw new Error(err?.message || 'Validation failed');
      }

      container.innerHTML = `
        <div style="font-family: Arial, sans-serif;">
          <button id="vx-open" style="background:${config.primaryGradient}; color:#fff; border:none; padding:10px 16px; border-radius:999px; cursor:pointer; font-weight:600; box-shadow:0 10px 25px rgba(34,211,238,0.15);">
            ${config.buttonText}
          </button>
        </div>
      `;

      const openBtn = container.querySelector('#vx-open');
      let modal;
      let personInput;
      let runBtn;
      let status;
      let result;
      const logoData = 'data:image/webp;base64,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';

      const buildModal = () => {
        modal = document.createElement('div');
        modal.id = 'vx-modal';
        modal.style.position = 'fixed';
        modal.style.inset = '0';
        modal.style.background = 'rgba(5,8,22,0.65)';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '9999';
        modal.innerHTML = `
          <div style="width:min(560px, 92vw); background:radial-gradient(120% 120% at 0% 0%, rgba(34,211,238,0.12), rgba(11,17,32,0.9)), #0b1120; color:#fff; border:1px solid rgba(255,255,255,0.08); border-radius:18px; padding:20px; position:relative; box-shadow:0 40px 80px rgba(5,8,22,0.75);">
            <div style="position:absolute; inset:-40px; background:radial-gradient(40% 40% at 20% 10%, rgba(34,211,238,0.18), rgba(0,0,0,0)), radial-gradient(30% 30% at 80% 20%, rgba(59,130,246,0.16), rgba(0,0,0,0)); filter:blur(30px); opacity:0.7; animation: drapixaiGlow 6s ease-in-out infinite;"></div>
            <button id="vx-close" style="position:absolute; top:10px; right:12px; background:transparent; border:none; color:#9aa4b2; font-size:18px; cursor:pointer;">×</button>
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
              <img src="${logoData}" width="36" height="36" alt="DrapixAI" style="border-radius:10px;" />
              <div style="font-weight:700; letter-spacing:0.4px;">DrapixAI</div>
            </div>
            <div style="font-weight:600; margin-bottom:8px;">${config.modalTitle}</div>
            <div style="font-size:12px; color:#9aa4b2; margin-bottom:12px;">${config.modalSubtitle}</div>
            <div style="display:grid; gap:10px;">
              <label style="display:block; padding:12px; background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.15); border-radius:12px; cursor:pointer;">
                <input id="vx-person" type="file" accept="image/*" style="display:none;" />
                <span style="font-size:12px; color:#cbd5e1;">Click to upload your photo</span>
              </label>
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <label style="font-size:12px; color:#cbd5e1; display:flex; gap:8px; align-items:center;">
                  <input id="vx-consent" type="checkbox" style="accent-color:#22d3ee;" />
                  I agree to upload my photo for try‑on preview.
                </label>
                <button id="vx-run" style="background:${config.primaryGradient}; color:#fff; border:none; padding:8px 12px; border-radius:10px; cursor:pointer; font-weight:600;">Generate</button>
              </div>
              <div style="font-size:11px; color:#8b9bb4;">Best results: front‑facing, good lighting, plain background.</div>
            </div>
            <div id="vx-progress" style="margin-top:10px; height:6px; border-radius:999px; background:rgba(255,255,255,0.06); overflow:hidden; display:none;">
              <div id="vx-progress-bar" style="height:100%; width:0%; background:${config.primaryGradient}; transition:width 300ms ease;"></div>
            </div>
            <div id="vx-status" style="margin-top:10px; font-size:12px; color:#9aa4b2;"></div>
            <img id="vx-result" style="margin-top:12px; width:100%; border-radius:8px; display:none;" />
            <div style="margin-top:12px; font-size:11px; color:#6b7280;">${config.footerText}</div>
          </div>
        `;
        document.body.appendChild(modal);
        personInput = modal.querySelector('#vx-person');
        runBtn = modal.querySelector('#vx-run');
        status = modal.querySelector('#vx-status');
        result = modal.querySelector('#vx-result');
        modal.querySelector('#vx-close').addEventListener('click', () => {
          modal.remove();
        });
        modal.addEventListener('click', (e) => {
          if (e.target === modal) modal.remove();
        });

        if (!document.getElementById('drapixai-modal-styles')) {
          const style = document.createElement('style');
          style.id = 'drapixai-modal-styles';
          style.textContent = `
            @keyframes drapixaiGlow {
              0% { opacity: 0.45; transform: translateY(0px); }
              50% { opacity: 0.7; transform: translateY(-6px); }
              100% { opacity: 0.45; transform: translateY(0px); }
            }
          `;
          document.head.appendChild(style);
        }

        runBtn.addEventListener('click', async function () {
          if (!personInput.files[0]) {
            status.textContent = 'Please select a person image.';
            return;
          }
          const consent = modal.querySelector('#vx-consent');
          if (consent && !consent.checked) {
            status.textContent = 'Please accept the consent checkbox.';
            return;
          }
          status.textContent = 'Generating...';
          result.style.display = 'none';
          const progress = modal.querySelector('#vx-progress');
          const bar = modal.querySelector('#vx-progress-bar');
          if (progress && bar) {
            progress.style.display = 'block';
            bar.style.width = '15%';
          }

          const form = new FormData();
          form.append('person_image', personInput.files[0]);
          form.append('productId', config.productId);
          form.append('quality', 'enhanced');
          form.append('garment_type', 'upper');

          const res = await fetch(`${config.baseUrl}/sdk/tryon`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${config.apiKey}` },
            body: form
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            status.textContent = err?.error || 'Try-on failed.';
            if (progress && bar) {
              bar.style.width = '0%';
              progress.style.display = 'none';
            }
            return;
          }

          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          result.src = url;
          result.style.display = 'block';
          status.textContent = 'Done.';
          if (progress && bar) {
            bar.style.width = '100%';
            setTimeout(() => {
              progress.style.display = 'none';
              bar.style.width = '0%';
            }, 600);
          }
        });
      };

      openBtn.addEventListener('click', () => {
        if (!document.getElementById('vx-modal')) buildModal();
      });
    }
  };

  window.DrapixAI = DrapixAI;
})();
