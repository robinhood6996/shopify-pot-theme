/* ─────────────────────────────────────────────────────────
   KILN & CLAY · theme.js
   Cart drawer, header interactions, qty steppers, wishlist,
   plus a tiny pub-sub for cart updates so any section can
   react to add/remove without re-implementing AJAX.
───────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ─── Tiny pub-sub ───
  const events = {};
  const PubSub = {
    on: (k, fn) => { (events[k] = events[k] || []).push(fn); },
    emit: (k, p) => { (events[k] || []).forEach(fn => fn(p)); }
  };
  window.KC = window.KC || {};
  window.KC.events = PubSub;

  // ─── Money formatter (uses shop currency template from window.Shopify) ───
  const moneyFmt = window.Shopify && window.Shopify.money_format
    ? window.Shopify.money_format
    : '£{{amount}}';
  window.KC.formatMoney = function (cents) {
    const n = (cents / 100).toFixed(2);
    return moneyFmt.replace('{{amount}}', n).replace('{{amount_no_decimals}}', Math.round(cents/100));
  };

  // ─── Cart drawer ───
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('drawer-overlay');

  function openCartDrawer() {
    if (!drawer) return;
    drawer.classList.add('show');
    if (overlay) overlay.classList.add('show');
    document.body.classList.add('drawer-open');
  }
  function closeCartDrawer() {
    if (!drawer) return;
    drawer.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('drawer-open');
  }
  window.KC.openCartDrawer = openCartDrawer;
  window.KC.closeCartDrawer = closeCartDrawer;

  // Wire up cart-open buttons
  document.querySelectorAll('[data-cart-open]').forEach(btn => {
    btn.addEventListener('click', e => { e.preventDefault(); openCartDrawer(); });
  });
  // Close
  document.querySelectorAll('[data-cart-close]').forEach(btn => {
    btn.addEventListener('click', closeCartDrawer);
  });
  if (overlay) overlay.addEventListener('click', closeCartDrawer);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer && drawer.classList.contains('show')) closeCartDrawer();
  });

  // ─── Cart fetch + render ───
  async function fetchCart() {
    try {
      const res = await fetch('/cart.js');
      return await res.json();
    } catch (e) { return null; }
  }

  function renderShipBar(cart) {
    const bar = document.getElementById('ship-bar');
    if (!bar) return;
    const threshold = parseInt(bar.dataset.threshold || '5000', 10);
    const remaining = threshold - cart.total_price;
    const pct = Math.min(100, (cart.total_price / threshold) * 100);
    bar.style.setProperty('--w', pct + '%');
    const text = bar.querySelector('.h');
    if (cart.total_price >= threshold) {
      text.innerHTML = '<strong>You\'ve qualified for free UK delivery.</strong>';
    } else {
      text.innerHTML = '<strong>Add ' + window.KC.formatMoney(remaining) + '</strong> for free UK delivery.';
    }
  }

  function renderCart(cart) {
    const itemsList = document.getElementById('cart-drawer-items');
    const emptyState = document.getElementById('cart-drawer-empty');
    const foot = document.getElementById('cart-drawer-foot');
    const subtotalEl = document.getElementById('cart-drawer-subtotal');
    const totalEl = document.getElementById('cart-drawer-total');
    const headerBadge = document.querySelector('.cart-badge');
    const headerCount = document.getElementById('cart-drawer-count');
    if (!itemsList) return;

    if (!cart || cart.item_count === 0) {
      itemsList.innerHTML = '';
      itemsList.style.display = 'none';
      if (emptyState) emptyState.style.display = 'flex';
      if (foot) foot.style.display = 'none';
      const shipBar = document.getElementById('ship-bar');
      if (shipBar) shipBar.style.display = 'none';
      if (headerBadge) { headerBadge.textContent = '0'; headerBadge.style.display = 'none'; }
      if (headerCount) headerCount.textContent = '0 items';
      return;
    }

    itemsList.style.display = '';
    if (emptyState) emptyState.style.display = 'none';
    if (foot) foot.style.display = '';
    const shipBar = document.getElementById('ship-bar');
    if (shipBar) shipBar.style.display = '';

    if (headerBadge) {
      headerBadge.textContent = cart.item_count;
      headerBadge.style.display = '';
      headerBadge.classList.remove('bump');
      void headerBadge.offsetWidth;
      headerBadge.classList.add('bump');
    }
    if (headerCount) {
      headerCount.textContent = cart.item_count + (cart.item_count === 1 ? ' item' : ' items');
    }

    // Render items
    itemsList.innerHTML = cart.items.map(item => `
      <div class="cart-drawer-item" data-key="${item.key}">
        <a href="${item.url}" class="cart-drawer-item-img">
          ${item.image ? `<img src="${item.image}" alt="${item.title}" loading="lazy">` : ''}
        </a>
        <div class="cart-drawer-item-info">
          <a href="${item.url}" class="nm">${item.product_title}</a>
          <div class="var">${item.variant_title || ''}</div>
          <div class="qty-row">
            <div class="qty-stepper" data-key="${item.key}">
              <button data-step="-1" aria-label="Decrease quantity">−</button>
              <input type="text" value="${item.quantity}" readonly>
              <button data-step="1" aria-label="Increase quantity">+</button>
            </div>
            <button class="item-remove" data-remove="${item.key}">Remove</button>
          </div>
        </div>
        <div class="cart-drawer-item-price">${window.KC.formatMoney(item.final_line_price)}</div>
      </div>
    `).join('');

    if (subtotalEl) subtotalEl.textContent = window.KC.formatMoney(cart.total_price);
    if (totalEl) totalEl.textContent = window.KC.formatMoney(cart.total_price);

    renderShipBar(cart);
    bindItemHandlers();
  }

  function bindItemHandlers() {
    document.querySelectorAll('#cart-drawer-items .qty-stepper button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const stepper = btn.parentElement;
        const key = stepper.dataset.key;
        const input = stepper.querySelector('input');
        let v = parseInt(input.value, 10) + parseInt(btn.dataset.step, 10);
        v = Math.max(0, v);
        await updateQty(key, v);
      });
    });
    document.querySelectorAll('#cart-drawer-items [data-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateQty(btn.dataset.remove, 0);
      });
    });
  }

  async function updateQty(key, qty) {
    const res = await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, quantity: qty })
    });
    const cart = await res.json();
    PubSub.emit('cart:updated', cart);
    renderCart(cart);
  }

  // ─── Add to cart (intercept add-to-cart forms) ───
  async function addToCart(formData) {
    const res = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: formData
    });
    if (!res.ok) {
      const err = await res.json();
      console.error('Add to cart error', err);
      return null;
    }
    const item = await res.json();
    const cart = await fetchCart();
    PubSub.emit('cart:updated', cart);
    PubSub.emit('cart:added', item);
    renderCart(cart);
    openCartDrawer();
    return item;
  }
  window.KC.addToCart = addToCart;

  // Intercept any product form
  document.querySelectorAll('form[action="/cart/add"]').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      const formData = new FormData(form);
      await addToCart(formData);
      if (submitBtn) submitBtn.disabled = false;
    });
  });

  // ─── Initial cart render on page load ───
  document.addEventListener('DOMContentLoaded', async () => {
    const cart = await fetchCart();
    renderCart(cart);
  });

  // ─── Wishlist (localStorage) ───
  const KEY = 'kc_wishlist';
  function readWishlist() {
    try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveWishlist(set) {
    try { localStorage.setItem(KEY, JSON.stringify([...set])); }
    catch (e) {}
  }
  function syncWishlistUI() {
    const wl = readWishlist();
    document.querySelectorAll('.wishlist-btn').forEach(btn => {
      const id = btn.dataset.wish;
      btn.classList.toggle('active', wl.has(id));
    });
  }
  syncWishlistUI();
  document.querySelectorAll('.wishlist-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const id = btn.dataset.wish;
      const wl = readWishlist();
      if (wl.has(id)) wl.delete(id); else wl.add(id);
      saveWishlist(wl);
      syncWishlistUI();
    });
  });

  // ─── Mobile nav drawer ───
  const mobileNav = document.getElementById('mobile-nav');
  const mobileNavOverlay = document.getElementById('mobile-nav-overlay');
  document.querySelectorAll('[data-mobile-nav-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!mobileNav) return;
      mobileNav.classList.add('show');
      if (mobileNavOverlay) mobileNavOverlay.classList.add('show');
      document.body.classList.add('drawer-open');
    });
  });
  document.querySelectorAll('[data-mobile-nav-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!mobileNav) return;
      mobileNav.classList.remove('show');
      if (mobileNavOverlay) mobileNavOverlay.classList.remove('show');
      document.body.classList.remove('drawer-open');
    });
  });
  if (mobileNavOverlay) mobileNavOverlay.addEventListener('click', () => {
    mobileNav.classList.remove('show');
    mobileNavOverlay.classList.remove('show');
    document.body.classList.remove('drawer-open');
  });

  // ─── Generic qty stepper (for cart page, PDP) ───
  document.addEventListener('click', e => {
    const stepBtn = e.target.closest('.qty-stepper button:not([data-key])');
    if (!stepBtn) return;
    const stepper = stepBtn.parentElement;
    const input = stepper.querySelector('input');
    if (!input) return;
    let v = parseInt(input.value, 10) || 1;
    v = Math.max(1, v + parseInt(stepBtn.dataset.step, 10));
    input.value = v;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // ─── Toasts (window.KC.toast) ───
  const toastStack = document.getElementById('toast-stack');
  const toastIcons = {
    success:  '<svg fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg>',
    error:    '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
    info:     '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7-4.5-9.5-9C.5 8 3 4 7 4c2 0 4 1.5 5 3 1-1.5 3-3 5-3 4 0 6.5 4 4.5 8-2.5 4.5-9.5 9-9.5 9Z"/></svg>'
  };
  window.KC.toast = function (opts) {
    if (!toastStack) return;
    const { type = 'info', title, body, action, dur = 4000, image } = opts;
    const t = document.createElement('div');
    t.className = 'toast t-' + type + (image ? ' has-thumb' : '');
    t.style.setProperty('--dur', (dur / 1000) + 's');
    const iconHtml = image
      ? '<img src="' + image + '" alt="">'
      : (toastIcons[type] || toastIcons.info);
    const actionHtml = action
      ? '<div class="actions"><button type="button" data-toast-act>' + action.label + '</button></div>'
      : '';
    t.innerHTML =
      '<div class="toast-icon">' + iconHtml + '</div>' +
      '<div class="toast-content">' +
        '<div class="title">' + (title || '') + '</div>' +
        (body ? '<div class="body">' + body + '</div>' : '') +
        actionHtml +
      '</div>' +
      '<button class="toast-close" aria-label="Close" type="button">' +
        '<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>' +
      '</button>' +
      '<div class="toast-progress"></div>';
    toastStack.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
    let timer;
    function dismiss() {
      if (t.classList.contains('dismissing')) return;
      t.classList.add('dismissing');
      setTimeout(() => t.remove(), 380);
    }
    function start() { timer = setTimeout(dismiss, dur); }
    function clear() { clearTimeout(timer); }
    t.addEventListener('mouseenter', () => { t.classList.add('paused'); clear(); });
    t.addEventListener('mouseleave', () => { t.classList.remove('paused'); start(); });
    t.querySelector('.toast-close').addEventListener('click', dismiss);
    if (action && action.handler) {
      const btn = t.querySelector('[data-toast-act]');
      if (btn) btn.addEventListener('click', e => { e.preventDefault(); action.handler(); dismiss(); });
    }
    start();
    return { dismiss };
  };

  // Cart events → automatic toast on add
  PubSub.on('cart:added', item => {
    if (!item) return;
    window.KC.toast({
      type: 'success',
      image: item.image || null,
      title: '<em>' + (item.product_title || 'Item') + '</em> · added to basket',
      body: item.variant_title ? item.variant_title + ' · ' + window.KC.formatMoney(item.final_price || item.price || 0) : '',
      action: { label: 'View basket →', handler: openCartDrawer },
      dur: 4500
    });
  });

  // ─── Cookie consent ───
  const COOKIE_KEY = 'kc_cookie_consent';
  const cookieBanner = document.getElementById('cookie-banner');
  const cookieReopen = document.getElementById('cookie-reopen');
  const cookieToast = document.getElementById('cookie-toast');
  const cookieToastSummary = document.getElementById('cookie-toast-summary');

  function readConsent() {
    try { return JSON.parse(localStorage.getItem(COOKIE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function saveConsent(c) {
    try { localStorage.setItem(COOKIE_KEY, JSON.stringify(c)); }
    catch (e) {}
  }
  window.KC.consent = readConsent() || { essential: true };

  if (cookieBanner) {
    function showCookie() { cookieBanner.classList.add('show'); cookieReopen.classList.remove('show'); }
    function hideCookie() { cookieBanner.classList.remove('show'); cookieBanner.classList.remove('expanded'); cookieReopen.classList.add('show'); }
    function expandCookie() { cookieBanner.classList.add('expanded'); }
    function setUI(c) {
      cookieBanner.querySelectorAll('[data-pref]').forEach(t => {
        const k = t.dataset.pref;
        if (k === 'essential') return;
        t.classList.toggle('on', !!(c && c[k]));
      });
    }
    function getPrefs() {
      const out = { essential: true };
      cookieBanner.querySelectorAll('[data-pref]').forEach(t => { out[t.dataset.pref] = t.classList.contains('on'); });
      out.timestamp = Date.now();
      return out;
    }
    function showSavedToast(summary) {
      if (!cookieToast) return;
      cookieToastSummary.textContent = summary;
      cookieToast.classList.add('show');
      setTimeout(() => cookieToast.classList.remove('show'), 2400);
    }
    function acceptAll() {
      const c = { essential: true, analytics: true, marketing: true, personalisation: true, timestamp: Date.now() };
      saveConsent(c); setUI(c); window.KC.consent = c; hideCookie(); showSavedToast('all cookies');
    }
    function essentialOnly() {
      const c = { essential: true, analytics: false, marketing: false, personalisation: false, timestamp: Date.now() };
      saveConsent(c); setUI(c); window.KC.consent = c; hideCookie(); showSavedToast('essential cookies only');
    }
    function savePrefs() {
      const c = getPrefs();
      saveConsent(c); window.KC.consent = c;
      const enabled = ['analytics', 'marketing', 'personalisation'].filter(k => c[k]);
      const summary = enabled.length === 3 ? 'all cookies' :
                      enabled.length === 0 ? 'essential cookies only' :
                      'essential + ' + enabled.join(', ');
      hideCookie(); showSavedToast(summary);
    }
    cookieBanner.querySelectorAll('[data-cookie-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        switch (btn.dataset.cookieAction) {
          case 'customize':   expandCookie(); break;
          case 'accept-all':  acceptAll(); break;
          case 'essential':   essentialOnly(); break;
          case 'save-prefs':  savePrefs(); break;
        }
      });
    });
    cookieBanner.querySelectorAll('.toggle-switch:not(.locked)').forEach(t => {
      t.addEventListener('click', () => t.classList.toggle('on'));
    });
    if (cookieReopen) cookieReopen.addEventListener('click', () => {
      const c = readConsent();
      if (c) setUI(c);
      expandCookie();
      showCookie();
    });
    const existing = readConsent();
    if (existing) {
      setUI(existing);
      cookieReopen.classList.add('show');
    } else {
      setTimeout(showCookie, 600);
    }
  }

})();

/* ─────────────────────────────────────────────────────────
   KC MOTION SYSTEM — IntersectionObserver scroll reveal
   + reading progress bar.
   Respects prefers-reduced-motion automatically.
───────────────────────────────────────────────────────── */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Auto-tag elements that should reveal (skip anything inside .hero)
  const revealSelectors = [
    '.lc-section', '.lc-section-h',
    '.blog-section', '.blog-featured', '.blog-grid',
    '.article-body', '.article-hero', '.article-author',
    '.search-results-section',
    '.cart-section',
    '.ct-layout', '.ct-visit', '.ct-map-strip',
    '.page-shell',
    'h2:not(.no-reveal)', 'h3:not(.no-reveal)',
    '.mailer', '.newsletter-section',
    '.callout', '.cta-block',
    '.section-head', '.lc-section-h .lhs',
    '.info-rail'
  ];
  document.querySelectorAll(revealSelectors.join(',')).forEach(function (el) {
    if (!el.hasAttribute('data-reveal') && !el.hasAttribute('data-reveal-stagger') && !el.closest('.hero')) {
      el.setAttribute('data-reveal', '');
    }
  });

  // Auto-tag grid containers for stagger
  const staggerSelectors = [
    '.lc-grid', '.blog-articles-grid', '.related-grid',
    '.ct-visit-grid', '.ct-chips', '.ct-quick-links',
    '.anchor-list', '.tag-pills'
  ];
  document.querySelectorAll(staggerSelectors.join(',')).forEach(function (el) {
    el.setAttribute('data-reveal-stagger', '');
    el.removeAttribute('data-reveal');
  });

  // IntersectionObserver
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('kc-in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

  document.querySelectorAll('[data-reveal], [data-reveal-stagger]').forEach(function (el) {
    io.observe(el);
  });

  // Reading progress bar — only on article/blog pages (2+ sections)
  if (document.querySelectorAll('section, .lc-section, .ct-layout').length >= 2) {
    var bar = document.createElement('div');
    bar.className = 'kc-progress';
    document.body.appendChild(bar);
    var rafId = null;
    function updateProgress() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
      bar.style.width = pct + '%';
      rafId = null;
    }
    window.addEventListener('scroll', function () {
      if (rafId) return;
      rafId = requestAnimationFrame(updateProgress);
    }, { passive: true });
  }

})();
