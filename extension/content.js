/* global AntiScrollPolicy */
(() => {
  'use strict';
  const P = AntiScrollPolicy;
  const KEY = 'antiscrollState';
  let state;
  let mode;
  let href = '';
  let root;
  let badge;
  let status;
  let toastUntil = 0;
  let scheduled = false;
  let redirecting = false;
  let tornDown = false;
  let touchStart;
  let structureDirty = true;
  const hidden = new Set();
  const pins = new Map();
  const cleanups = [];
  function listen(target, name, fn, options) {
    target.addEventListener(name, fn, options);
    cleanups.push(() => target.removeEventListener(name, fn, options));
  }
  function editable(node) {
    return node instanceof Element && Boolean(node.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
  }
  function exempt(node) {
    if (!(node instanceof Element)) return false;
    return editable(node) || Boolean(node.closest('[data-antiscroll-ui], [role="dialog"], [role="listbox"], [role="menu"], [role="combobox"], header, nav, aside, [role="navigation"], [data-testid="sidebarColumn"]'));
  }
  function snapshotPin(el) {
    if (pins.has(el)) return;
    pins.set(el, ['overflow-y', 'scroll-behavior', 'overscroll-behavior-y'].map(key => [key, el.style.getPropertyValue(key), el.style.getPropertyPriority(key)]));
    el.style.setProperty('overflow-y', 'hidden', 'important');
    el.style.setProperty('scroll-behavior', 'auto', 'important');
    el.style.setProperty('overscroll-behavior-y', 'none', 'important');
  }
  function release() {
    for (const [el, styles] of pins) for (const [key, value, priority] of styles) {
      if (value) el.style.setProperty(key, value, priority); else el.style.removeProperty(key);
    }
    pins.clear();
    root?.removeAttribute('data-antiscroll-locked');
  }
  function pinPage(scan) {
    if (!mode?.locked || !root) return;
    root.setAttribute('data-antiscroll-locked', '');
    for (const el of [root, document.body]) {
      if (!el) continue;
      snapshotPin(el);
      el.scrollTop = 0;
    }
    const main = document.querySelector('main, [role="main"], [data-testid="primaryColumn"]');
    if (scan && main) {
      const ancestors = [];
      for (let parent = main.parentElement; parent && parent !== document.body; parent = parent.parentElement) ancestors.push(parent);
      // Scan only when DOM/navigation changes; avoid repeated layout work every tick.
      for (const el of [...ancestors, main, ...main.querySelectorAll('*')]) {
        if (exempt(el) || el.clientHeight < 120 || el.scrollHeight <= el.clientHeight + 2) continue;
        if (['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) snapshotPin(el);
      }
    }
    for (const el of pins.keys()) { if (el.isConnected) el.scrollTop = 0; else pins.delete(el); }
  }
  function showHint() {
    toastUntil = Date.now() + 1800;
    if (status) status.textContent = 'Scrolling paused. Stay intentional.';
  }
  function setHidden(el) {
    if (!hidden.has(el)) { hidden.add(el); el.setAttribute('data-antiscroll-hidden', ''); }
  }
  function clearHidden() {
    for (const el of hidden) el.removeAttribute('data-antiscroll-hidden');
    hidden.clear();
  }
  function filterReels() {
    if (!mode?.blockReels) return;
    for (const el of hidden) {
      let stillReel = el.matches('[data-testid="AppTabBar_Video_Link"]');
      try { if (el.matches('a[href]')) stillReel = P.route(new URL(el.getAttribute('href'), location.href).href).kind === 'reels'; } catch { /* Ignore invalid hrefs. */ }
      if (!el.isConnected || !stillReel) { el.removeAttribute('data-antiscroll-hidden'); hidden.delete(el); }
    }
    for (const el of document.querySelectorAll('a[href]')) {
      try {
        const target = P.route(new URL(el.getAttribute('href'), location.href).href);
        if (target.site === mode.site && target.kind === 'reels') setHidden(el);
      } catch { /* Ignore non-HTTP links. */ }
    }
    // X's video shortcut can be rendered without an href on some layouts.
    if (mode.site === 'x') for (const el of document.querySelectorAll('[data-testid="AppTabBar_Video_Link"]')) setHidden(el);
    for (const el of hidden) if (!el.isConnected) hidden.delete(el);
  }
  function redirect() {
    if (redirecting) return;
    redirecting = true;
    location.replace(mode.site === 'instagram' ? 'https://www.instagram.com/' : 'https://x.com/home');
  }
  function mount() {
    if (badge?.isConnected || !document.body) return;
    badge = document.createElement('div');
    badge.setAttribute('data-antiscroll-ui', '');
    const shadow = badge.attachShadow({mode: 'closed'});
    const style = document.createElement('style');
    style.textContent = ':host{all:initial!important;position:fixed!important;bottom:16px!important;left:16px!important;z-index:2147483646!important;pointer-events:none!important}div{display:flex;gap:9px;align-items:center;background:#17251e;color:#eff7ed;border:1px solid #54735c;border-radius:999px;padding:10px 14px;font:12px/1.3 system-ui,sans-serif;box-shadow:0 4px 20px #0003;max-width:310px}i{width:7px;height:7px;border-radius:50%;background:#a9d395;flex:none}';
    const box = document.createElement('div');
    const dot = document.createElement('i');
    status = document.createElement('span');
    box.append(dot, status);
    shadow.append(style, box);
    document.body.append(badge);
  }
  function update() {
    // Do not block or redirect until the user's saved preferences are known.
    if (tornDown || !state) return;
    const next = P.decision(location.href, state.settings, state.endAt);
    const changed = href !== location.href;
    const transitioned = !mode?.locked && next.locked;
    const scan = structureDirty || changed || transitioned || mode?.blockReels !== next.blockReels;
    structureDirty = false;
    if (changed || (mode?.locked && !next.locked)) release();
    href = location.href;
    mode = next;
    if (mode.redirect) { redirect(); return; }
    redirecting = false;
    root = document.documentElement;
    mount();
    if (badge) badge.style.display = mode.enabled ? '' : 'none';
    if (!mode.blockReels) clearHidden();
    if (scan) filterReels();
    if (mode.locked) pinPage(scan);
    if (transitioned) showHint();
    if (status && Date.now() >= toastUntil) {
      const seconds = Math.ceil(P.remaining(state.endAt) / 1000);
      status.textContent = seconds ? `Daily pass · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : mode.locked ? 'AntiScroll active · scrolling blocked' : 'AntiScroll · browse with intention';
    }
  }
  function schedule() {
    if (scheduled || tornDown) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; update(); });
  }
  function stopScroll(event) {
    updateIfRouteChanged();
    if (!mode?.locked || exempt(event.target)) return;
    // Horizontal gestures keep Instagram's story carousel usable.
    if (event.type === 'wheel' && (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) return;
    if (event.type === 'touchmove' && touchStart && event.touches[0]) {
      const dx = event.touches[0].clientX - touchStart.x;
      const dy = event.touches[0].clientY - touchStart.y;
      if (Math.abs(dx) > Math.abs(dy)) return;
    }
    event.preventDefault();
    showHint();
    schedule();
  }
  function updateIfRouteChanged() {
    if (href !== location.href || (state?.endAt && !P.remaining(state.endAt))) update();
  }
  function onKey(event) {
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Spacebar'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.key === ' ' || event.key === 'Spacebar') && event.target instanceof Element && event.target.closest('button, a, [role="button"], video')) return;
    stopScroll(event);
  }
  function onScroll(event) {
    updateIfRouteChanged();
    if (!mode?.locked) return;
    const el = event.target === document ? document.scrollingElement : event.target;
    if (!(el instanceof Element) || exempt(el) || !el.scrollTop) return;
    const main = el.closest('main, [role="main"], [data-testid="primaryColumn"]');
    const containsMain = el.querySelector('main, [role="main"], [data-testid="primaryColumn"]');
    if (el === document.scrollingElement || el === document.body || main || containsMain || pins.has(el)) {
      el.scrollTop = 0;
      showHint();
    }
  }
  function onClick(event) {
    updateIfRouteChanged();
    if (!mode?.blockReels) return;
    const el = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!el) return;
    try {
      const target = P.route(new URL(el.getAttribute('href'), location.href).href);
      if (target.site === mode.site && target.kind === 'reels') { event.preventDefault(); event.stopImmediatePropagation(); showHint(); }
    } catch { /* Ignore invalid hrefs. */ }
  }
  function onStorage(changes, area) {
    if (area !== 'local' || !changes[KEY]) return;
    applyState(changes[KEY].newValue);
  }
  function applyState(value = {}) {
    state = {settings: P.settings(value?.settings), endAt: value?.endAt || 0};
    update();
  }
  listen(window, 'wheel', stopScroll, {capture: true, passive: false});
  listen(window, 'touchstart', event => {
    const touch = event.touches[0];
    touchStart = touch ? {x: touch.clientX, y: touch.clientY} : null;
  }, {capture: true, passive: true});
  listen(window, 'touchmove', stopScroll, {capture: true, passive: false});
  listen(window, 'keydown', onKey, true);
  listen(window, 'scroll', onScroll, true);
  listen(window, 'click', onClick, true);
  listen(window, 'auxclick', onClick, true);
  listen(window, 'popstate', schedule);
  listen(window, 'hashchange', schedule);
  listen(window, 'focus', schedule);
  listen(document, 'visibilitychange', schedule);
  // SPA navigation is detected without injecting code into the page's JS world.
  const interval = setInterval(update, 250);
  const observer = new MutationObserver(() => { structureDirty = true; schedule(); });
  function start() {
    root = document.documentElement;
    if (!root) return;
    observer.observe(root, {childList: true, subtree: true, attributes: true, attributeFilter: ['href']});
    update();
  }
  chrome.storage.onChanged.addListener(onStorage);
  chrome.storage.local.get(KEY).then(result => {
    // A later storage event wins over this initial snapshot.
    if (!state) applyState(result[KEY]);
  }).catch(() => { /* Leave navigation alone if preferences can't be read. */ });
  if (document.documentElement) start();
  else listen(document, 'DOMContentLoaded', start, {once: true});
  // Cleanup if the extension context is invalidated after a reload/update.
  listen(window, 'error', event => {
    if (!String(event.message).includes('Extension context invalidated')) return;
    tornDown = true;
    clearInterval(interval);
    observer.disconnect();
    chrome.storage.onChanged.removeListener(onStorage);
    cleanups.forEach(fn => fn());
    release(); clearHidden(); badge?.remove();
  });
})();
