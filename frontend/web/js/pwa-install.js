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

  // 1. Registrasi Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('sw.js')
        .then(() => {
          // SW registered successfully
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

  // 4. Modal Panduan Instalasi (Khusus iOS / Browser tanpa beforeinstallprompt)
  function createModalHtml() {
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
              Gulir ke bawah dan pilih opsi <strong>"Tambahkan ke Layar Utama" (Add to Home Screen)</strong>.
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
              Ketuk tombol menu browser <strong>Titik Tiga (⋮)</strong> di pojok kanan atas.
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">2</div>
            <div class="pwa-step-text">
              Pilih menu <strong>"Instal Aplikasi"</strong> atau <strong>"Tambahkan ke Layar Utama"</strong>.
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
          *Di Desktop/PC, Anda juga dapat mengklik ikon instal di sisi kanan bilah alamat (URL bar) browser.
        </p>
      `;
    }

    const modal = document.createElement('div');
    modal.id = 'pwaInstallGuideModal';
    modal.className = 'pwa-modal-backdrop';
    modal.innerHTML = `
      <div class="pwa-modal-card">
        <div class="pwa-modal-header">
          <img src="assets/logo-pia.png" alt="Logo PIA" class="pwa-modal-app-icon" />
          <div>
            <h3 class="pwa-modal-title">Instal Sistem Absensi PIA</h3>
            <span class="pwa-modal-subtitle">Pendidikan Islam At-Taqwa</span>
          </div>
          <button type="button" class="pwa-modal-close" id="pwaCloseModalBtn" aria-label="Tutup">&times;</button>
        </div>
        <div class="pwa-modal-body">
          <p class="pwa-modal-desc">
            Instal aplikasi ini ke layar utama perangkat Anda untuk akses instan satu ketukan, navigasi layar penuh yang responsif, dan performa maksimal.
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
    if (modal) modal.classList.add('is-open');
  }

  function showToast(message) {
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

