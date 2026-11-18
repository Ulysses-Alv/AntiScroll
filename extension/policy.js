(function (root) {
  'use strict';
  const DEFAULT_SETTINGS = Object.freeze({instagram: true, x: true, allowSearchScroll: false});
  function settings(value = {}) {
    value = value && typeof value === 'object' ? value : {};
    return {
      instagram: typeof value.instagram === 'boolean' ? value.instagram : DEFAULT_SETTINGS.instagram,
      x: typeof value.x === 'boolean' ? value.x : DEFAULT_SETTINGS.x,
      allowSearchScroll: value.allowSearchScroll === true
    };
  }
  function siteFor(host) {
    if (['instagram.com', 'www.instagram.com'].includes(host)) return 'instagram';
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(host)) return 'x';
    return null;
  }
  function route(input) {
    const url = new URL(input);
    const site = siteFor(url.hostname);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (!site) return {site, kind: 'other'};
    if (site === 'instagram') {
      if (/^\/(?:reels?|[^/]+\/reels?)(?:\/|$)/i.test(path)) return {site, kind: 'reels'};
      if (/^\/(?:direct|stories|accounts|settings|challenge|oauth|emails|notifications|your_activity|create)(?:\/|$)/i.test(path)) return {site, kind: 'utility'};
      if (/^\/(?:p|tv)\/[^/]+/i.test(path)) return {site, kind: 'post'};
      if (/^\/explore\/search(?:\/|$)/i.test(path) || (path === '/explore' && (url.searchParams.has('q') || url.searchParams.has('query')))) return {site, kind: 'search'};
    } else {
      if (/^\/i\/(?:immersive_media|videos)(?:\/|$)/i.test(path)) return {site, kind: 'reels'};
      if (/^\/(?:messages|notifications|settings|login|logout|signup|account|compose|i\/(?:chat|flow|oauth|connect_people))(?:\/|$)/i.test(path)) return {site, kind: 'utility'};
      if (/^\/[^/]+\/status\/\d+(?:\/|$)/i.test(path)) return {site, kind: 'post'};
      if (path === '/search') return {site, kind: 'search'};
    }
    return {site, kind: 'feed'};
  }
  function remaining(endAt, now = Date.now()) {
    return typeof endAt === 'number' && Number.isFinite(endAt) ? Math.max(0, endAt - now) : 0;
  }
  function decision(input, config, endAt, now = Date.now()) {
    const current = route(input);
    const prefs = settings(config);
    const enabled = Boolean(current.site && prefs[current.site]);
    return {...current, enabled,
      blockReels: enabled,
      redirect: enabled && current.kind === 'reels',
      locked: enabled && !['utility', 'post', 'reels'].includes(current.kind) &&
        !(current.kind === 'search' && prefs.allowSearchScroll) && remaining(endAt, now) === 0
    };
  }
  const api = {DEFAULT_SETTINGS, settings, siteFor, route, remaining, decision};
  root.AntiScrollPolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
