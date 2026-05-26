// popup.js — v3.0

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot  = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const mediaList  = document.getElementById('mediaList');
  const openBtn    = document.getElementById('openLibraryBtn');
  const refreshBtn = document.getElementById('refreshBtn');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isAdsLibrary = tab?.url?.includes('facebook.com/ads/library');

  if (isAdsLibrary) {
    statusDot.classList.add('active');
    statusText.textContent = 'פעיל — ספריית המודעות';
  } else {
    statusDot.classList.add('inactive');
    statusText.textContent = 'לא בספריית המודעות';
  }

  // ── History ────────────────────────────────────────────────────────
  async function loadHistory() {
    const result = await chrome.storage.local.get('madHistory');
    const history = result.madHistory || [];
    renderHistory(history);
  }

  function renderHistory(history) {
    if (!history.length) {
      mediaList.innerHTML = `
        <div class="empty-state">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <p>עוד לא ניתחת מודעות</p>
        </div>`;
      return;
    }

    mediaList.innerHTML = '';

    // Stats row
    const winners = history.filter(h => h.daysRunning >= 90).length;
    const statsDiv = document.createElement('div');
    statsDiv.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.45);padding:4px 2px 8px;direction:rtl;';
    statsDiv.textContent = `${history.length} מודעות נותחו | ${winners} winners 90d+`;
    mediaList.appendChild(statsDiv);

    history.slice(0, 15).forEach(item => {
      const div = document.createElement('div');
      div.className = 'media-item';

      const fmt = { video: '🎬', static: '🖼️', carousel: '🔄' }[item.format] || '📄';
      let daysBadge = '';
      if (item.daysRunning >= 90)     daysBadge = `<span class="badge badge-video">🏆 ${item.daysRunning}d</span>`;
      else if (item.daysRunning >= 30) daysBadge = `<span class="badge badge-image">✅ ${item.daysRunning}d</span>`;
      else if (item.daysRunning > 0)   daysBadge = `<span style="font-size:10px;color:rgba(255,255,255,0.35)">${item.daysRunning}d</span>`;

      const date = new Date(item.analyzedAt).toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit' });

      div.innerHTML = `
        <div class="media-item-icon" style="font-size:16px;background:transparent">${fmt}</div>
        <div class="media-item-info">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
            <span class="media-item-type">${item.brand || 'Unknown'}</span>
            ${daysBadge}
          </div>
          <div class="media-item-url">${date} ${item.cta ? '· ' + item.cta : ''}</div>
        </div>`;
      mediaList.appendChild(div);
    });

    // Clear history button
    const clearDiv = document.createElement('div');
    clearDiv.style.cssText = 'margin-top:10px;text-align:center;';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'נקה היסטוריה';
    clearBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.25);font-size:11px;cursor:pointer;';
    clearBtn.addEventListener('click', async () => {
      await chrome.storage.local.remove('madHistory');
      await loadHistory();
    });
    clearDiv.appendChild(clearBtn);
    mediaList.appendChild(clearDiv);
  }

  openBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.facebook.com/ads/library/' });
  });

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    await loadHistory();
    refreshBtn.disabled = false;
  });

  // ── Competitor Watchlist ───────────────────────────────────────────
  const watchlistInput = document.getElementById('watchlistInput');
  const saveWatchlistBtn = document.getElementById('saveWatchlist');

  async function loadWatchlist() {
    const r = await chrome.storage.local.get('madWatchlist');
    const list = r.madWatchlist || [];
    watchlistInput.value = list.join('\n');
  }

  saveWatchlistBtn.addEventListener('click', async () => {
    const list = watchlistInput.value.split('\n').map(s => s.trim()).filter(Boolean);
    await chrome.storage.local.set({ madWatchlist: list });
    if (isAdsLibrary) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_WATCHLIST', watchlist: list }); } catch(e) {}
    }
    saveWatchlistBtn.textContent = '✅ Saved!';
    setTimeout(() => { saveWatchlistBtn.textContent = 'Save list'; }, 1800);
  });

  await loadWatchlist();
  await loadHistory();
});
