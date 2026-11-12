/**
 * PWA Install Manager - Sistem Absensi Pendidikan Islam At-Taqwa (PIA)
 * Menangani instalasi Web App (PWA) di Desktop, Android, dan iOS.
 */

(function () {
  let deferredPrompt = null;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  // Injeksi CSS mandiri agar modal selalu tampil sempurna tanpa bergantung cache CSS eksternal
  function injectPwaStyles() {
    if (document.getElementById('pwa-injected-styles')) return;
    const style = document.createElement('style');
    style.id = 'pwa-injected-styles';
    style.textContent = `
      .pwa-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.65);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
      }
      .pwa-modal-backdrop.is-open {
        opacity: 1;
        pointer-events: auto;
      }
      .pwa-modal-card {
        background: #ffffff;
        border-radius: 20px;
        max-width: 440px;
        width: 100%;
        box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.35);
        border: 1px solid #e2e8f0;
        overflow: hidden;
        transform: translateY(16px) scale(0.97);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: inherit;
      }
      .pwa-modal-backdrop.is-open .pwa-modal-card {
        transform: translateY(0) scale(1);
      }
      .pwa-modal-header {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 18px 20px;
        border-bottom: 1px solid #f1f5f9;
        background: #f8fafc;
      }
      .pwa-modal-app-icon {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        object-fit: cover;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        background: #ffffff;
        border: 1px solid #e2e8f0;
      }
      .pwa-modal-title {
        font-size: 1.05rem;
        font-weight: 700;
        color: #0f172a;
        margin: 0;
      }
      .pwa-modal-subtitle {
        font-size: 0.8rem;
        color: #64748b;
        font-weight: 500;
        display: block;
      }
      .pwa-modal-close {
        margin-left: auto;
        background: none;
        border: none;
        font-size: 1.7rem;
        line-height: 1;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px;
        transition: color 0.15s ease;
      }
      .pwa-modal-close:hover {
        color: #0f172a;
      }
      .pwa-modal-body {
        padding: 20px;
      }
      .pwa-modal-desc {
        font-size: 0.88rem;
        color: #475569;
        line-height: 1.5;
        margin-top: 0;
        margin-bottom: 16px;
      }
      .pwa-guide-steps {
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #f8fafc;
        padding: 14px;
        border-radius: 14px;
        border: 1px solid #e2e8f0;
      }
      .pwa-step-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }
      .pwa-step-num {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: #2563eb;
        color: #ffffff;
        font-size: 0.78rem;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 2px;
      }
      .pwa-step-text {
        font-size: 0.86rem;
        color: #1e293b;
        line-height: 1.45;
      }
      .pwa-inline-icon {
        display: inline-flex;
        vertical-align: -3px;
        color: #2563eb;
        margin: 0 2px;
      }
      .pwa-modal-footer {
        padding: 14px 20px;
        background: #f8fafc;
        border-top: 1px solid #f1f5f9;
        display: flex;
        justify-content: flex-end;
      }
      .btn-pwa-primary {
        padding: 10px 22px;
        border-radius: 10px;
        background: #2563eb;
        color: #ffffff;
        border: none;
        font-weight: 700;
        font-size: 0.9rem;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .btn-pwa-primary:hover {
        background: #1d4ed8;
      }
      .pwa-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(50px);
        background: #0f172a;
        color: #ffffff;
        padding: 12px 24px;
        border-radius: 9999px;
        font-size: 0.88rem;
        font-weight: 600;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.35);
        z-index: 1000000;
        opacity: 0;
        pointer-events: none;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .pwa-toast.show {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  // 1. Registrasi Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('sw.js')
        .then(() => {
          // SW terdaftar sukses
        })
        .catch((err) => {
          console.debug('Service Worker reg bypassed:', err);
        });
    });
  }

  // 2. Tangkap event beforeinstallprompt (Android / Chrome Desktop / Edge)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window._piaInstallPrompt = e;
    updateInstallButtonsState('ready');
  });

  // 3. Tangkap event appinstalled
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window._piaInstallPrompt = null;
    updateInstallButtonsState('installed');
    showToast('Aplikasi Sistem Absensi PIA berhasil diinstal! ✓');
  });

  function updateInstallButtonsState(state) {
    const buttons = document.querySelectorAll('.btn-install-app, #navInstallAppBtn');
    buttons.forEach((btn) => {
      if (state === 'installed' || isStandalone) {
        btn.classList.add('is-installed');
        const textSpan = btn.querySelector('span:not(.badge-install-pill)');
        if (textSpan) textSpan.textContent = 'Aplikasi Terpasang';
        const pill = btn.querySelector('.badge-install-pill');
        if (pill) {
          pill.textContent = '✓';
          pill.style.background = '#10b981';
        }
      } else if (state === 'ready') {
        const textSpan = btn.querySelector('span:not(.badge-install-pill)');
        if (textSpan) textSpan.textContent = 'Install Aplikasi';
      }
    });
  }

  // 4. Modal Panduan Instalasi (Khusus iOS / Android / Desktop)
  function createModalHtml() {
    injectPwaStyles();
    if (document.getElementById('pwaInstallGuideModal')) return;

    let guideContent = '';
    if (isIos) {
      guideContent = `
        <div class="pwa-guide-steps">
          <div class="pwa-step-item">
            <div class="pwa-step-num">1</div>
            <div class="pwa-step-text">
              Ketuk tombol <strong>Bagikan (Share)</strong> 
              <span class="pwa-inline-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                  <polyline points="16 6 12 2 8 6"></polyline>
                  <line x1="12" y1="2" x2="12" y2="15"></line>
                </svg>
              </span> 
              di bilah menu bawah browser Safari.
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">2</div>
            <div class="pwa-step-text">
              Gulir menu ke bawah lalu pilih opsi <strong>"Tambahkan ke Layar Utama" (Add to Home Screen)</strong>.
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">3</div>
            <div class="pwa-step-text">
              Ketuk <strong>"Tambah" (Add)</strong> di sudut kanan atas untuk menyelesaikan pemasangan.
            </div>
          </div>
        </div>
      `;
    } else {
      guideContent = `
        <div class="pwa-guide-steps">
          <div class="pwa-step-item">
            <div class="pwa-step-num">1</div>
            <div class="pwa-step-text">
              Ketuk tombol menu browser <strong>Titik Tiga (⋮)</strong> di pojok kanan atas Chrome.
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">2</div>
            <div class="pwa-step-text">
              Pilih menu <strong>"Instal Aplikasi"</strong> atau <strong>"Tambahkan ke Layar Utama" (Add to Home screen)</strong>.
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">3</div>
            <div class="pwa-step-text">
              Konfirmasi dengan menekan tombol <strong>"Instal"</strong>.
            </div>
          </div>
        </div>
        <p style="font-size: 0.82rem; color: #64748b; margin-top: 14px; text-align: center;">
          *Di Desktop/PC, Anda juga dapat mengklik ikon instal di bilah alamat URL browser (ujung kanan atas).
        </p>
      `;
    }

    const modal = document.createElement('div');
    modal.id = 'pwaInstallGuideModal';
    modal.className = 'pwa-modal-backdrop';
    modal.innerHTML = `
      <div class="pwa-modal-card">
        <div class="pwa-modal-header">
          <img src="assets/icon-192.png" alt="Logo PIA" class="pwa-modal-app-icon" />
          <div>
            <h3 class="pwa-modal-title">Instal Aplikasi PIA</h3>
            <span class="pwa-modal-subtitle">Pendidikan Islam At-Taqwa</span>
          </div>
          <button type="button" class="pwa-modal-close" id="pwaCloseModalBtn" aria-label="Tutup">&times;</button>
        </div>
        <div class="pwa-modal-body">
          <p class="pwa-modal-desc">
            Pasang aplikasi ini ke layar utama ponsel Anda untuk akses cepat satu ketukan, tampilan layar penuh tanpa URL bar, dan responsivitas maksimal.
          </p>
          ${guideContent}
        </div>
        <div class="pwa-modal-footer">
          <button type="button" class="btn-pwa-primary" id="pwaDismissBtn">Saya Mengerti</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#pwaCloseModalBtn');
    const dismissBtn = modal.querySelector('#pwaDismissBtn');
    const closeModal = () => modal.classList.remove('is-open');

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (dismissBtn) dismissBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  function showInstallModal() {
    createModalHtml();
    const modal = document.getElementById('pwaInstallGuideModal');
    if (modal) {
      setTimeout(() => modal.classList.add('is-open'), 10);
    }
  }

  function showToast(message) {
    injectPwaStyles();
    let toast = document.getElementById('pwaToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pwaToast';
      toast.className = 'pwa-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  // 5. Fungsi utama penanganan klik tombol instal
  window.triggerPwaInstall = async function () {
    if (isStandalone) {
      showToast('Aplikasi Sistem Absensi PIA sudah terpasang di perangkat Anda ✓');
      return;
    }

    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          deferredPrompt = null;
          window._piaInstallPrompt = null;
          updateInstallButtonsState('installed');
        } else {
          showInstallModal();
        }
      } catch (err) {
        console.warn('Prompt error, showing modal guide:', err);
        showInstallModal();
      }
    } else {
      // Jika browser tidak menyediakan prompt otomatis (misal iOS Safari atau prompt sudah terlewati)
      showInstallModal();
    }
  };

  // 6. Bind event listener ke tombol install
  function bindInstallTriggers() {
    injectPwaStyles();
    updateInstallButtonsState(isStandalone ? 'installed' : (deferredPrompt ? 'ready' : 'initial'));

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#navInstallAppBtn, .btn-install-app');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        window.triggerPwaInstall();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindInstallTriggers);
  } else {
    bindInstallTriggers();
  }
})();
