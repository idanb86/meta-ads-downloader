// content.js — Meta Ads Downloader & Analyzer v1.0
// Features: download, analyze, copy URL, winner tags, batch analysis, history

(function () {
  'use strict';

  if (window.__madInit) return;
  window.__madInit = true;

  // ─── PerformanceObserver ──────────────────────────────────────────────────
  const urlPool = [];

  function captureUrl(url) {
    if (!url || typeof url !== 'string') return;
    if (!url.startsWith('http')) return;
    if (!url.includes('fbcdn.net')) return;
    if (url.includes('/rsrc/') || url.includes('emoji')) return;
    if (urlPool.find(u => u.url === url)) return;
    const isVideo = url.includes('.mp4') || url.includes('video') || !!url.match(/\/v\//i);
    const isImage = !isVideo && !!url.match(/\.(jpg|jpeg|png|webp)/i);
    if (!isVideo && !isImage) return;
    urlPool.push({ url, type: isVideo ? 'video' : 'image', ts: Date.now() });
  }

  try {
    new PerformanceObserver(list => {
      list.getEntries().forEach(e => captureUrl(e.name));
    }).observe({ type: 'resource', buffered: true });
  } catch(e) {}

  function scanPerfEntries() {
    try { performance.getEntriesByType('resource').forEach(e => captureUrl(e.name)); } catch(e) {}
  }

  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.type === 'GET_MEDIA') { scanPerfEntries(); sendResponse({ media: urlPool }); }
    return true;
  });

  // ─── Per-video URL tracking ───────────────────────────────────────────────
  const videoUrlMap = new WeakMap();
  let pollTimer = null;

  function watchVideo(video) {
    if (video.dataset.madWatched) return;
    video.dataset.madWatched = '1';

    function onPlay() {
      if (!videoUrlMap.has(video)) videoUrlMap.set(video, []);
      const before = urlPool.length;
      clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        urlPool.slice(before).filter(u => u.type === 'video').forEach(u => {
          const arr = videoUrlMap.get(video) || [];
          if (!arr.find(e => e.url === u.url)) { arr.push(u); videoUrlMap.set(video, arr); }
        });
      }, 150);
    }

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', () => clearInterval(pollTimer));
    video.addEventListener('ended', () => clearInterval(pollTimer));
    video.addEventListener('canplay', () => {
      const src = video.currentSrc;
      if (src && src.startsWith('http') && src.includes('fbcdn')) {
        captureUrl(src);
        if (!videoUrlMap.has(video)) videoUrlMap.set(video, []);
        const arr = videoUrlMap.get(video);
        if (!arr.find(u => u.url === src)) arr.push({ url: src, type: 'video', ts: Date.now() });
      }
    });
  }

  // ─── History (chrome.storage.local) ──────────────────────────────────────
  async function saveToHistory(adData) {
    try {
      const result = await chrome.storage.local.get('madHistory');
      const history = result.madHistory || [];
      history.unshift({
        brand: adData.brandName || adData.advertiser || 'Unknown',
        format: adData.format,
        daysRunning: adData.daysRunning,
        cta: adData.cta,
        hasMultipleVersions: adData.hasMultipleVersions,
        analyzedAt: Date.now()
      });
      // Keep last 100
      await chrome.storage.local.set({ madHistory: history.slice(0, 100) });
    } catch(e) {}
  }

  // ─── Parse days running from card ────────────────────────────────────────
  function parseDaysRunning(cardText) {
    const dateMatch = cardText.match(/Started running on ([A-Za-z]+ \d+, \d{4})/);
    if (!dateMatch) return 0;
    const ms = new Date(dateMatch[1]).getTime();
    if (isNaN(ms)) return 0;
    return Math.floor((Date.now() - ms) / 86400000);
  }

    // ─── Winner Tags ─────────────────────────────────────────────────────────
  const taggedCards = new WeakSet();

  function parseDaysRunning(cardText) {
    const dateMatch = cardText.match(/Started running on ([A-Za-z]+ \d+, \d{4})/);
    if (!dateMatch) return 0;
    const ms = new Date(dateMatch[1]).getTime();
    if (isNaN(ms)) return 0;
    return Math.floor((Date.now() - ms) / 86400000);
  }

  function injectWinnerTag(card) {
    if (taggedCards.has(card)) return;
    if (card.querySelector('.mad-winner-tag')) return;

    const days = parseDaysRunning(card.textContent || '');
    if (days < 14) return;

    taggedCards.add(card);

    let label, cls;
    if (days >= 90)      { label = `🏆 ${days}d winner`; cls = 'mad-tag-gold'; }
    else if (days >= 30) { label = `✅ ${days}d running`; cls = 'mad-tag-green'; }
    else                 { label = `🔵 ${days}d`;          cls = 'mad-tag-blue'; }

    const tag = document.createElement('div');
    tag.className = `mad-winner-tag ${cls}`;
    tag.textContent = label;
    tag.title = `Ad has been running for ${days} days`;

    const style = getComputedStyle(card);
    if (style.position === 'static') card.style.position = 'relative';
    card.appendChild(tag);
  }

  // ─── Competitor Watchlist ─────────────────────────────────────────────────
  let watchlist = [];

  chrome.storage.local.get('madWatchlist').then(r => {
    if (r.madWatchlist && Array.isArray(r.madWatchlist)) {
      watchlist = r.madWatchlist.map(s => s.toLowerCase());
    }
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.type === 'UPDATE_WATCHLIST') {
      watchlist = (msg.watchlist || []).map(s => s.toLowerCase());
      document.querySelectorAll('[data-mad-card]').forEach(c => {
        c.classList.remove('mad-competitor');
        c.querySelector('.mad-comp-tag')?.remove();
        compCheckedCards.delete(c);
        highlightIfCompetitor(c);
      });
      sendResponse({ ok: true });
    }
    return true;
  });

  const compCheckedCards = new WeakSet();

  function highlightIfCompetitor(card) {
    if (compCheckedCards.has(card)) return;
    if (!watchlist.length) return;
    compCheckedCards.add(card);

    const cardText = card.textContent || '';
    // Quick brand extraction from card text
    const sponsoredEl = Array.from(card.querySelectorAll('span, a'))
      .find(el => el.textContent?.trim().toLowerCase() === 'sponsored');
    let brand = '';
    if (sponsoredEl) {
      let node = sponsoredEl.parentElement;
      for (let i = 0; i < 4; i++) {
        if (!node) break;
        for (const link of node.querySelectorAll('a, strong, b')) {
          const t = link.textContent?.trim();
          if (t && t.length > 1 && t.length < 60 && t.toLowerCase() !== 'sponsored') {
            brand = t.toLowerCase(); break;
          }
        }
        if (brand) break;
        node = node.parentElement;
      }
    }
    if (!brand) return;

    const match = watchlist.find(w => brand.includes(w) || w.includes(brand));
    if (!match) return;

    card.classList.add('mad-competitor');
    const tag = document.createElement('div');
    tag.className = 'mad-comp-tag';
    tag.textContent = '👁️ Competitor';
    tag.title = `Competitor on your watchlist`;
    const style = getComputedStyle(card);
    if (style.position === 'static') card.style.position = 'relative';
    card.appendChild(tag);
  }

  // ─── Nano Banana ──────────────────────────────────────────────────────────
  function detectSceneType(card, data) {
    const text = (data.adText || '').toLowerCase();
    const imgs = card.querySelectorAll('img[src*="fbcdn"]');
    let aspectHint = 'square (1:1)';
    const mainImg = Array.from(imgs).find(i => (i.naturalWidth || i.width) > 200);
    if (mainImg) {
      const w = mainImg.naturalWidth || mainImg.width;
      const h = mainImg.naturalHeight || mainImg.height;
      if (h > w * 1.2) aspectHint = 'vertical (4:5 or 9:16)';
      else if (w > h * 1.2) aspectHint = 'horizontal (16:9)';
    }
    const sceneTypes = [];
    if (/wear|wearing|street|outdoor|travel|lifestyle|everyday/.test(text)) sceneTypes.push('lifestyle / on-model');
    if (/studio|clean|minimal|product|detail/.test(text)) sceneTypes.push('studio / product');
    if (/gift|holiday|christmas|valentine/.test(text)) sceneTypes.push('gift / seasonal');
    if (/nature|wood|stone|earth|sustainable|eco/.test(text)) sceneTypes.push('natural / textured');
    return {
      type: sceneTypes.length ? sceneTypes.join(', ') : 'general product',
      aspect: aspectHint,
      format: data.format
    };
  }

  function buildNanoPrompt(data, scene) {
    const brand = data.brandName || data.advertiser || 'competitor';
    return `# Nano Banana — Visual Prompt Generator

I analyzed a winning ad from ${brand}${data.daysRunning >= 30 ? ` (running ${data.daysRunning} days)` : ''}.
I want to create a visual in the same style/mood for my product.

**Scene style detected:** ${scene.type}
**Aspect ratio:** ${scene.aspect}
**Format:** ${scene.format === 'video' ? 'video' : 'image'}

${data.imageUrl ? `**Reference image:** ${data.imageUrl}\n💡 Download and attach the image to this chat as a visual reference.\n` : ''}
**Original ad copy (for mood context):**
${data.adText || 'Not detected'}

---

## What I need from you

Tell me which product you want to feature (I'll answer), then create a **full Nano Banana prompt** that produces a visual in the same style/mood as this winning ad.

**Important prompt guidelines:**
1. If I attach a reference photo of my product — instruct Nano Banana to copy the exact product from the image (without describing every detail separately — this produces more accurate results)
2. Specify exact dimensions, colors and materials
3. Describe model continuity if relevant
4. Preserve the mood and lighting of the original ad

**Output:**
1. Ready-to-paste prompt (in English) for Nano Banana
2. Brief explanation of visual choices
3. One additional variation (different angle/lighting) for A/B testing`;
  }

  function showNanoPopup(prompt, data) {
    document.querySelector('.mad-prompt-popup')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'mad-prompt-popup';
    overlay.innerHTML = `
      <div class="mad-pp-box">
        <div class="mad-pp-header">
          <span class="mad-pp-title">🍌 Nano Banana — ${data.brandName || 'Competitor'}</span>
          <button class="mad-pp-close">✕</button>
        </div>
        <textarea class="mad-pp-text" readonly>${prompt}</textarea>
        <div class="mad-pp-actions">
          <button class="mad-pp-copy-btn">📋 Copy text</button>
          <button class="mad-pp-open-btn">Open Claude ←</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('.mad-pp-text');
    const copyBtn  = overlay.querySelector('.mad-pp-copy-btn');
    const openBtn  = overlay.querySelector('.mad-pp-open-btn');
    const closeBtn = overlay.querySelector('.mad-pp-close');
    textarea.addEventListener('focus', () => textarea.select());
    copyBtn.addEventListener('click', async () => {
      textarea.select();
      try { await navigator.clipboard.writeText(prompt); } catch(e) { document.execCommand('copy'); }
      copyBtn.textContent = '✅ Copied!';
      copyBtn.style.background = '#0a4d2a';
      setTimeout(() => { copyBtn.textContent = '📋 Copy text'; copyBtn.style.background = ''; }, 2000);
    });
    openBtn.addEventListener('click', () => { window.open('https://claude.ai/new', '_blank'); });
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    setTimeout(() => { textarea.focus(); textarea.select(); }, 100);
  }

  function setLoading2(btn) {
    btn.style.pointerEvents = 'none';
    btn.innerHTML = '<svg class="mad-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
  }

  async function handleNanoClick(btn, card) {
    setLoading2(btn);
    const adData = extractAdData(card);
    const scene = detectSceneType(card, adData);
    const prompt = buildNanoPrompt(adData, scene);
    btn.innerHTML = '<span style="font-size:15px">🍌</span>';
    btn.style.pointerEvents = '';
    showNanoPopup(prompt, adData);
  }

  // ─── Extract ad data from a card ─────────────────────────────────────────
  function extractAdData(card) {
    const cardText = card.textContent || '';
    const data = {
      advertiser: '', brandName: '', adText: '', headline: '',
      cta: '', platforms: [], startDate: '', daysRunning: 0,
      libraryId: '', hasMultipleVersions: false,
      format: 'static', imageUrl: '', videoUrl: ''
    };

    // Advertiser
    for (const sel of ['[data-testid="ad-archive-advertiser"]', 'a[href*="/ads/library"]', 'h2', 'h3']) {
      const el = card.querySelector(sel);
      const t = el?.textContent?.trim();
      if (t && t.length > 1 && t.length < 80) { data.advertiser = t; break; }
    }

    // Brand name from "Sponsored" sibling
    const sponsoredEl = Array.from(card.querySelectorAll('span, a'))
      .find(el => el.textContent?.trim().toLowerCase() === 'sponsored');
    if (sponsoredEl) {
      let node = sponsoredEl.parentElement;
      for (let i = 0; i < 4; i++) {
        if (!node) break;
        for (const link of node.querySelectorAll('a, strong, b')) {
          const t = link.textContent?.trim();
          if (t && t.length > 1 && t.length < 60 && t.toLowerCase() !== 'sponsored') {
            data.brandName = t; break;
          }
        }
        if (data.brandName) break;
        node = node.parentElement;
      }
    }
    if (!data.brandName) data.brandName = data.advertiser;

    // Ad text — clean extraction
    const UI_STRINGS = ['sponsored', 'see ad details', 'see summary details', 'shop now',
      'learn more', 'sign up', 'get offer', 'watch more', 'contact us', 'apply now',
      'book now', 'download', 'open dropdown', 'active', 'library id', 'platforms',
      'started running', 'this ad has', 'about the advertiser'];

    const blocks = Array.from(card.querySelectorAll('span, p, div'))
      .filter(el => el.children.length <= 3)
      .map(el => el.textContent?.trim() || '')
      .filter(t => {
        if (!t || t.length < 15 || t.length > 1000) return false;
        const lower = t.toLowerCase();
        return !UI_STRINGS.some(u => lower === u || lower.startsWith(u));
      });

    // Deduplicate blocks (longer contains shorter)
    const unique = blocks.filter((b, i) =>
      !blocks.some((other, j) => j !== i && other.includes(b) && other.length > b.length)
    );

    // Headline = shortest meaningful block, body = longest
    const sorted = [...unique].sort((a, b) => a.length - b.length);
    data.headline = sorted[0] || '';
    data.adText = unique.sort((a, b) => b.length - a.length)[0] || '';

    // CTA
    const CTA_LIST = ['shop now','learn more','sign up','get offer','watch more',
      'contact us','apply now','book now','download','order now','get started','try now','buy now'];
    for (const btn of card.querySelectorAll('[role="button"], button')) {
      const t = btn.textContent?.trim().toLowerCase();
      if (CTA_LIST.includes(t)) { data.cta = btn.textContent.trim(); break; }
    }

    // Platforms
    card.querySelectorAll('img, [aria-label]').forEach(el => {
      const label = (el.alt || el.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('facebook') && !data.platforms.includes('Facebook')) data.platforms.push('Facebook');
      if (label.includes('instagram') && !data.platforms.includes('Instagram')) data.platforms.push('Instagram');
      if (label.includes('messenger') && !data.platforms.includes('Messenger')) data.platforms.push('Messenger');
      if (label.includes('audience network') && !data.platforms.includes('Audience Network')) data.platforms.push('Audience Network');
    });

    // Dates & days
    const dateMatch = cardText.match(/Started running on ([A-Za-z]+ \d+, \d{4})/);
    if (dateMatch) {
      data.startDate = dateMatch[1];
      data.daysRunning = parseDaysRunning(cardText);
    }

    // Library ID
    const libMatch = cardText.match(/Library ID[:\s]+(\d+)/i);
    if (libMatch) data.libraryId = libMatch[1];

    // Flags
    data.hasMultipleVersions = /this ad has multiple versions/i.test(cardText);

    // Format
    if (card.querySelector('video')) data.format = 'video';
    else if (card.querySelectorAll('img[src*="fbcdn"]').length > 2) data.format = 'carousel';
    else data.format = 'static';

    // Media
    const items = getCardMedia(card);
    const vid = items.find(i => i.type === 'video');
    const img = items.find(i => i.type === 'image');
    if (vid) data.videoUrl = vid.url;
    if (img) data.imageUrl = img.url;

    return data;
  }

  // ─── Build single-ad prompt ───────────────────────────────────────────────
  function buildAnalysisPrompt(data) {
    const brand = data.brandName || data.advertiser || 'לא זוהה';
    const formatHebrew = { video: 'סרטון', static: 'תמונה סטטית', carousel: 'קרוסלה' }[data.format] || data.format;

    let runningSignal = '';
    if (data.daysRunning >= 90)     runningSignal = `✅ ${data.daysRunning} ימים — Winner מוכח`;
    else if (data.daysRunning >= 30) runningSignal = `🟡 ${data.daysRunning} ימים — מבטיח`;
    else if (data.daysRunning > 0)   runningSignal = `🔵 ${data.daysRunning} ימים — מודעה חדשה`;

    const mediaUrl = data.videoUrl || data.imageUrl || '';
    const mediaType = data.videoUrl ? 'סרטון' : 'תמונה';
    const mediaNote = mediaUrl
      ? `${mediaType} (לינק): ${mediaUrl}\n💡 מומלץ: הורד את ה${mediaType} עם כפתור "הורד" וצרף אותו ישירות לשיחה — הלינקים של Meta פוקעים תוך שעות.`
      : '';

    return `מודעת מתחרה מ-Meta Ads Library:

מותג: ${brand}
פורמט: ${formatHebrew}${data.cta ? `\nCTA: ${data.cta}` : ''}${data.platforms.length ? `\nפלטפורמות: ${data.platforms.join(', ')}` : ''}${runningSignal ? `\nזמן הרצה: ${runningSignal}` : ''}${data.hasMultipleVersions ? `\nגרסאות: יש מספר וריאנטים` : ''}

טקסט:
${data.adText || 'לא זוהה'}
${mediaNote ? `\n${mediaNote}` : ''}

---

נתח את המודעה:
- Hook, Value Prop, Pain Points, קהל יעד
- ציון 1–10 לכל מרכיב (Hook / Copy / CTA / ויזואל) + ציון כולל${data.daysRunning >= 30 ? `\n- למה לדעתך זה רץ כבר ${data.daysRunning} יום?` : ''}

לאחר מכן צור 3 וריאציות חדשות בהשראת המודעה — כל אחת בזווית שיווקית שונה (emotion / social proof / problem-solution).
לכל וריאציה: Hook + Body (2–4 משפטים) + CTA + הסבר קצר על הזווית.`;
  }

  // ─── Build batch prompt ───────────────────────────────────────────────────
  function buildBatchPrompt(adsData) {
    const winners = adsData.filter(a => a.daysRunning >= 90);
    const promising = adsData.filter(a => a.daysRunning >= 30 && a.daysRunning < 90);

    const adLines = adsData.map((a, i) => {
      const brand = a.brandName || a.advertiser || 'Unknown';
      const days = a.daysRunning > 0 ? `${a.daysRunning}d` : '?d';
      const fmt = { video: '🎬', static: '🖼️', carousel: '🔄' }[a.format] || '';
      const multi = a.hasMultipleVersions ? ' [multi]' : '';
      const text = a.adText ? a.adText.substring(0, 120) + (a.adText.length > 120 ? '...' : '') : 'N/A';
      return `${i+1}. ${fmt} ${brand} | ${days}${multi} | CTA: ${a.cta || '?'}
   "${text}"`;
    }).join('\n\n');

    return `ניתוח batch — ${adsData.length} מודעות מ-Meta Ads Library:
(${winners.length} winners 90d+, ${promising.length} מבטיחות 30d+)

${adLines}

---

1. מה הדפוסים החוזרים בין המודעות שרצות הכי הרבה זמן?
   (hook patterns, offer types, emotional triggers, formats)

2. מה ה-CTA הנפוץ ביותר? מה זה אומר על הקהל?

3. מה בולט לרעה — מה לא עובד?

4. בהתבסס על הדפוסים האלה, כתוב 2 מודעות "מסונתזות" למוצרים שלנו
   שמשלבות את הטוב מכל הwinners.`;
  }

  // ─── Find card helpers ────────────────────────────────────────────────────
  function findSeeAdDetailsBtn(card) {
    for (const el of card.querySelectorAll('div[role="button"], button')) {
      const text = el.textContent?.trim().toLowerCase() || '';
      if (text === 'see ad details' || text === 'see summary details' || text === 'ראה פרטי מודעה') {
        if (el.closest('[data-mad-card]') === card || !el.closest('[data-mad-card]')) return el;
      }
    }
    return null;
  }

  function getCardMedia(card) {
    const items = [], seen = new Set();
    function add(url, type) {
      if (!url || seen.has(url) || !url.startsWith('http') || url.startsWith('blob:')) return;
      seen.add(url); items.push({ url, type, ts: Date.now() });
    }
    card.querySelectorAll('video').forEach(v => {
      (videoUrlMap.get(v) || []).forEach(u => add(u.url, 'video'));
      [v.currentSrc, v.src].forEach(s => { if (s && s.includes('fbcdn')) add(s, 'video'); });
    });
    card.querySelectorAll('img[src*="fbcdn.net"]').forEach(img => {
      if (img.src.includes('/rsrc/') || img.src.includes('emoji')) return;
      if ((img.naturalWidth || img.width) < 100 || (img.naturalHeight || img.height) < 100) return;
      add(img.src, 'image');
    });
    return items;
  }

  // ─── Process each card ────────────────────────────────────────────────────
  const processedCards = new WeakSet();

  function processCard(card) {
    if (processedCards.has(card)) return;
    if (card.querySelector('.mad-btn-container')) return;

    const seeBtn = findSeeAdDetailsBtn(card);
    if (!seeBtn) return;

    processedCards.add(card);
    card.dataset.madCard = '1';
    card.querySelectorAll('video').forEach(watchVideo);

    // Winner tag
    injectWinnerTag(card);

    // Button row
    const container = document.createElement('div');
    container.className = 'mad-btn-container';

    // Download
    const dlBtn = makeBtn('mad-download', `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>הורד</span>`);
    dlBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); handleDownloadClick(dlBtn, card); });

    // Analyze
    const anBtn = makeBtn('mad-analyze', `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <span>נתח</span>`);
    anBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); handleAnalyzeClick(anBtn, card); });

    // Copy URL
    const cpBtn = makeBtn('mad-copy', `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>`);
    cpBtn.title = 'העתק כתובת מדיה';
    cpBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); handleCopyClick(cpBtn, card); });

    // Nano Banana
    const nbBtn = makeBtn('mad-nano', `<span style="font-size:15px">🍌</span>`);
    nbBtn.title = 'צור prompt ל-Nano Banana';
    nbBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); handleNanoClick(nbBtn, card); });

    container.append(dlBtn, anBtn, cpBtn, nbBtn);
    const insertAfter = seeBtn.closest('div') || seeBtn;
    insertAfter.insertAdjacentElement('afterend', container);
  }

  function makeBtn(cls, html) {
    const btn = document.createElement('div');
    btn.className = `mad-card-btn ${cls}`;
    btn.setAttribute('role', 'button');
    btn.innerHTML = html;
    return btn;
  }

  // ─── Download handler ─────────────────────────────────────────────────────
  async function handleDownloadClick(btn, card) {
    scanPerfEntries();
    card.querySelectorAll('video').forEach(watchVideo);
    let items = getCardMedia(card);

    const videoEls = card.querySelectorAll('video');
    if (videoEls.length > 0 && !items.find(i => i.type === 'video')) {
      setLoading(btn, 'טוען...');
      try {
        watchVideo(videoEls[0]);
        await videoEls[0].play();
        for (let i = 0; i < 20; i++) {
          await sleep(150); scanPerfEntries();
          items = getCardMedia(card);
          if (items.find(i => i.type === 'video')) break;
        }
        videoEls[0].pause();
      } catch(e) {}
      resetBtn(btn, 'mad-download');
    }

    if (!items.length) { showToast('לא נמצאה מדיה', 'error'); return; }
    if (items.length === 1) await doDownload(btn, items[0]);
    else showPicker(btn, items, (item) => doDownload(btn, item));
  }

  // ─── Analyze handler ──────────────────────────────────────────────────────
  async function handleAnalyzeClick(btn, card) {
    setLoading(btn, 'אוסף...');
    const adData = extractAdData(card);
    await saveToHistory(adData);
    const prompt = buildAnalysisPrompt(adData);
    resetBtn(btn, 'mad-analyze');
    showPromptPopup(prompt, `ניתוח מודעה — ${adData.brandName || adData.advertiser || 'מתחרה'}`);
  }

  // ─── Nano Banana handler ──────────────────────────────────────────────────


  // ─── Copy URL handler ─────────────────────────────────────────────────────
  async function handleCopyClick(btn, card) {
    scanPerfEntries();
    const items = getCardMedia(card);
    if (!items.length) { showToast('לא נמצאה מדיה. נגן קודם.', 'error'); return; }
    if (items.length === 1) await copyUrl(btn, items[0].url);
    else showPicker(btn, items, (item) => copyUrl(btn, item.url));
  }

  async function copyUrl(btn, url) {
    try { await navigator.clipboard.writeText(url); }
    catch(e) {
      const ta = Object.assign(document.createElement('textarea'), { value: url });
      ta.style.cssText = 'position:fixed;top:-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    btn.classList.add('mad-done');
    showToast('הכתובת הועתקה! 📋', 'success');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('mad-done'); }, 2500);
  }

  // ─── Batch analysis ───────────────────────────────────────────────────────
  function injectBatchBtn() {
    if (document.querySelector('.mad-batch-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'mad-batch-btn';
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
        <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
        <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
      <span>נתח batch</span>
    `;

    btn.addEventListener('click', handleBatchClick);
    document.body.appendChild(btn);
  }

  async function handleBatchClick() {
    const btn = document.querySelector('.mad-batch-btn');
    if (btn) { btn.style.opacity = '0.6'; btn.querySelector('span').textContent = 'אוסף...'; }

    // Collect all processed cards
    const cards = Array.from(document.querySelectorAll('[data-mad-card]'));
    if (cards.length === 0) {
      showToast('לא נמצאו מודעות — גלול בדף תחילה', 'error');
      if (btn) { btn.style.opacity = ''; btn.querySelector('span').textContent = 'נתח batch'; }
      return;
    }

    const adsData = cards.map(card => extractAdData(card))
      .filter(d => d.adText || d.brandName); // skip empty

    const prompt = buildBatchPrompt(adsData);

    if (btn) { btn.style.opacity = ''; btn.querySelector('span').textContent = 'נתח batch'; }

    showPromptPopup(prompt, `Batch — ${adsData.length} מודעות`);
  }

  // ─── Prompt popup ─────────────────────────────────────────────────────────
  function showPromptPopup(prompt, title = 'פרומפט מוכן', mediaUrl = '') {
    document.querySelector('.mad-prompt-popup')?.remove();

    const mediaRow = mediaUrl ? `
        <div class="mad-pp-media">
          <input class="mad-pp-url" type="text" readonly value="${mediaUrl}" />
          <button class="mad-pp-url-copy" title="העתק לינק">📋</button>
        </div>` : '';

    const overlay = document.createElement('div');
    overlay.className = 'mad-prompt-popup';
    overlay.innerHTML = `
      <div class="mad-pp-box">
        <div class="mad-pp-header">
          <span class="mad-pp-title">🤖 ${title}</span>
          <button class="mad-pp-close">✕</button>
        </div>
        <textarea class="mad-pp-text" readonly>${prompt}</textarea>
        ${mediaRow}
        <div class="mad-pp-actions">
          <button class="mad-pp-copy-btn">📋 העתק טקסט</button>
          <button class="mad-pp-open-btn">פתח Claude ←</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('.mad-pp-text');
    const copyBtn  = overlay.querySelector('.mad-pp-copy-btn');
    const openBtn  = overlay.querySelector('.mad-pp-open-btn');
    const closeBtn = overlay.querySelector('.mad-pp-close');
    const urlCopy  = overlay.querySelector('.mad-pp-url-copy');
    const urlInput = overlay.querySelector('.mad-pp-url');

    textarea.addEventListener('focus', () => textarea.select());

    copyBtn.addEventListener('click', async () => {
      textarea.select();
      try { await navigator.clipboard.writeText(prompt); }
      catch(e) { document.execCommand('copy'); }
      copyBtn.textContent = '✅ הועתק!';
      copyBtn.style.background = '#0a4d2a';
      setTimeout(() => { copyBtn.textContent = '📋 העתק טקסט'; copyBtn.style.background = ''; }, 2000);
    });

    if (urlCopy) {
      urlCopy.addEventListener('click', async () => {
        urlInput.select();
        try { await navigator.clipboard.writeText(mediaUrl); }
        catch(e) { document.execCommand('copy'); }
        urlCopy.textContent = '✅';
        setTimeout(() => { urlCopy.textContent = '📋'; }, 1500);
      });
    }

    openBtn.addEventListener('click', () => {
      window.open('https://claude.ai/new', '_blank');
    });

    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    setTimeout(() => { textarea.focus(); textarea.select(); }, 100);
  }

  // ─── Download helper ──────────────────────────────────────────────────────
  async function doDownload(btn, item) {
    const orig = btn.innerHTML;
    setLoading(btn, 'מוריד...');
    try {
      const ext = item.type === 'video' ? 'mp4' : 'jpg';
      const filename = `MetaAd_${new Date().toISOString().slice(0,10)}.${ext}`;
      const resp = await chrome.runtime.sendMessage({ type: 'DOWNLOAD', url: item.url, filename });
      if (resp && !resp.success) throw new Error(resp.error || 'נכשל');
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>הורד ✓</span>`;
      btn.classList.add('mad-done');
      showToast('ההורדה החלה! 🎉', 'success');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('mad-done'); btn.style.pointerEvents = ''; }, 3000);
    } catch(err) {
      btn.innerHTML = orig; btn.style.pointerEvents = '';
      showToast('שגיאה: ' + err.message, 'error');
    }
  }

  function setLoading(btn, text) {
    btn.style.pointerEvents = 'none';
    btn.innerHTML = `<svg class="mad-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>${text}</span>`;
  }

  function resetBtn(btn, type) {
    btn.style.pointerEvents = '';
    const icons = {
      'mad-download': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>הורד</span>`,
      'mad-analyze':  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span>נתח</span>`,
    };
    if (icons[type]) btn.innerHTML = icons[type];
  }

  // ─── Picker ───────────────────────────────────────────────────────────────
  function showPicker(btn, items, onSelect) {
    document.querySelectorAll('.mad-picker').forEach(p => p.remove());
    const picker = document.createElement('div');
    picker.className = 'mad-picker';

    const title = document.createElement('div');
    title.className = 'mad-picker-title';
    title.textContent = 'בחר:';
    picker.appendChild(title);

    items.slice(0, 8).forEach((item, i) => {
      const row = document.createElement('button');
      row.className = 'mad-picker-item';
      const ext = item.type === 'video' ? 'mp4' : 'jpg';
      row.innerHTML = `<span>${item.type === 'video' ? '🎬' : '🖼️'} ${item.type === 'video' ? 'סרטון' : 'תמונה'} ${i+1}</span><span class="mad-picker-ext">.${ext}</span>`;
      row.addEventListener('click', () => { picker.remove(); onSelect(item); });
      picker.appendChild(row);
    });

    const r = btn.getBoundingClientRect();
    picker.style.cssText = `position:fixed;top:${r.bottom+6}px;left:${Math.max(4,r.left)}px;z-index:2147483647;`;
    document.body.appendChild(picker);
    setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 100);
  }

  // ─── Toast ────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    document.querySelector('.mad-toast')?.remove();
    const t = document.createElement('div');
    t.className = `mad-toast mad-toast--${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('mad-toast--visible'));
    setTimeout(() => { t.classList.remove('mad-toast--visible'); setTimeout(() => t.remove(), 300); }, 4000);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─── Scanner ──────────────────────────────────────────────────────────────
  function scan() {
    scanPerfEntries();
    document.querySelectorAll('div[role="button"], button').forEach(el => {
      const text = el.textContent?.trim().toLowerCase() || '';
      if (text === 'see ad details' || text === 'see summary details' || text === 'ראה פרטי מודעה') {
        let card = el;
        for (let i = 0; i < 12; i++) {
          card = card.parentElement;
          if (!card || card === document.body) break;
          const rect = card.getBoundingClientRect();
          if (rect.width > 200 && rect.height > 200) { processCard(card); break; }
        }
      }
    });
    // Tag runner cards even without "See ad details" (e.g. already processed)
    document.querySelectorAll('[data-mad-card]').forEach(injectWinnerTag);
    document.querySelectorAll('[data-mad-card]').forEach(highlightIfCompetitor);
    document.querySelectorAll('video').forEach(watchVideo);
    injectBatchBtn();
  }

  function startObserver() {
    if (!document.body) { setTimeout(startObserver, 100); return; }
    let t;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 400); })
      .observe(document.body, { childList: true, subtree: true });
  }

  startObserver();
  setTimeout(scan, 800);
  setTimeout(scan, 2000);
  setTimeout(scan, 4500);

  console.log('[MetaAdsAnalyzer] v1.0 loaded ✓');
})();
