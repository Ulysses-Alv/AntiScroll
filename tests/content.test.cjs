'use strict';
// A small DOM harness tests event decisions and restoration, not browser layout.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../extension/policy.js');
const code = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
class Surface {
  constructor() {this.listeners = {};}
  addEventListener(name, fn) {(this.listeners[name] ||= []).push(fn);}
  removeEventListener(name, fn) {this.listeners[name] = (this.listeners[name] || []).filter(item => item !== fn);}
  fire(name, values = {}) {
    const event = {type: name, target: this, preventDefault() {this.defaultPrevented = true;}, stopImmediatePropagation() {this.stopped = true;}, ...values};
    for (const fn of this.listeners[name] || []) {fn(event); if (event.stopped) break;}
    return event;
  }
}
class Style {
  constructor() {this.values = new Map();}
  getPropertyValue(key) {return this.values.get(key)?.value || '';}
  getPropertyPriority(key) {return this.values.get(key)?.priority || '';}
  setProperty(key, value, priority = '') {this.values.set(key, {value, priority});}
  removeProperty(key) {this.values.delete(key);}
}
class Element extends Surface {
  constructor(tag) {super(); this.tagName = tag; this.attrs = {}; this.style = new Style(); this.children = []; this.clientHeight = 800; this.scrollHeight = 800; this.scrollTop = 0; this.isConnected = true; this.overflow = 'visible';}
  setAttribute(key, value) {this.attrs[key] = value;}
  removeAttribute(key) {delete this.attrs[key];}
  getAttribute(key) {return this.attrs[key];}
  hasAttribute(key) {return key in this.attrs;}
  append(...children) {for (const child of children) {child.parentElement = this; this.children.push(child);}}
  remove() {this.isConnected = false;}
  attachShadow() {return new Element('shadow');}
  matches(selector) {
    return selector.split(',').some(part => {
      const s = part.trim(); if (s === '*') return true;
      if (s === '[contenteditable]:not([contenteditable="false"])') return this.hasAttribute('contenteditable') && this.attrs.contenteditable !== 'false';
      const match = s.match(/^([a-z]+)?(?:\[([^=\]]+)(?:="?([^"\]]+)"?)?\])?$/);
      if (!match) return false;
      return (!match[1] || this.tagName === match[1]) && (!match[2] || (match[3] === undefined ? this.hasAttribute(match[2]) : this.attrs[match[2]] === match[3]));
    });
  }
  closest(selector) {for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null;}
  querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
}
async function harness(url = 'https://x.com/home', stored = {}, load = async () => stored) {
  const win = new Surface(); const doc = new Surface(); const storageListeners = [];
  const html = new Element('html'); const body = new Element('body'); const main = new Element('main');
  const nested = new Element('div'); nested.clientHeight = 200; nested.scrollHeight = 1200; nested.overflow = 'auto';
  nested.style.setProperty('overflow-y', 'auto', 'important');
  const input = new Element('input'); const dialog = new Element('div'); dialog.setAttribute('role', 'dialog');
  const link = new Element('a'); link.setAttribute('href', '/i/immersive_media/1');
  main.append(nested); body.append(main, input, dialog, link); html.append(body);
  Object.assign(doc, {documentElement: html, body, scrollingElement: html, createElement: tag => new Element(tag), querySelector: selector => html.querySelector(selector), querySelectorAll: selector => html.querySelectorAll(selector)});
  const location = {href: url, replace(value) {this.redirectedTo = value;}};
  let ticker; let observer;
  const sandbox = {AntiScrollPolicy: P, Element, window: win, document: doc, location, URL, Date, console, getComputedStyle: el => ({overflowY: el.style.getPropertyValue('overflow-y') || el.overflow}), requestAnimationFrame: fn => fn(), setInterval: fn => {ticker = fn; return 1;}, clearInterval() {}, MutationObserver: class {constructor(fn) {this.fn = fn; observer = this;} observe() {} disconnect() {}}, chrome: {storage: {local: {get: async () => ({antiscrollState: await load()})}, onChanged: {addListener: fn => storageListeners.push(fn), removeListener() {}}}}};
  vm.runInNewContext(code, sandbox, {filename: 'content.js'});
  await new Promise(resolve => setImmediate(resolve));
  const set = value => storageListeners.forEach(fn => fn({antiscrollState: {newValue: value}}, 'local'));
  return {win, doc, html, body, main, nested, input, dialog, link, location, set, tick: () => ticker(), mutate: () => observer.fn()};
}
test('Direct video navigation never redirects on startup if that network is disabled', async () => {
  for (const [site, url] of [['x', 'https://x.com/i/videos'], ['instagram', 'https://www.instagram.com/reels/']]) {
    const h = await harness(url, {settings: {...P.DEFAULT_SETTINGS, [site]: false}, endAt: 0});
    assert.equal(h.location.redirectedTo, undefined, site);
  }
});
test('A late initial read cannot override a newer preference change', async () => {
  let finishRead;
  const h = await harness('https://x.com/i/videos', {}, () => new Promise(resolve => {finishRead = resolve;}));
  h.tick();
  assert.equal(h.location.redirectedTo, undefined);
  h.set({settings: {...P.DEFAULT_SETTINGS, x: false}});
  finishRead({settings: P.DEFAULT_SETTINGS});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.location.redirectedTo, undefined);
});
test('Blocks wheel, keyboard, and vertical touch; preserves typing and horizontal gestures', async () => {
  const h = await harness();
  assert.equal(h.html.hasAttribute('data-antiscroll-locked'), true);
  assert.equal(h.win.fire('wheel', {target: h.main, deltaY: 100, deltaX: 0}).defaultPrevented, true);
  assert.equal(h.win.fire('keydown', {target: h.main, key: 'End'}).defaultPrevented, true);
  assert.equal(h.win.fire('wheel', {target: h.input, deltaY: 100}).defaultPrevented, undefined);
  assert.equal(h.win.fire('keydown', {target: h.input, key: ' '}).defaultPrevented, undefined);
  h.win.fire('touchstart', {touches: [{clientX: 0, clientY: 0}]});
  assert.equal(h.win.fire('touchmove', {target: h.main, touches: [{clientX: 0, clientY: 100}]}).defaultPrevented, true);
  assert.equal(h.win.fire('touchmove', {target: h.main, touches: [{clientX: 100, clientY: 1}]}).defaultPrevented, undefined);
});
test('Resets programmatic page scrolling; dialogs remain scrollable', async () => {
  const h = await harness();
  h.nested.scrollTop = 100; h.win.fire('scroll', {target: h.nested}); assert.equal(h.nested.scrollTop, 0);
  h.html.scrollTop = 900; h.win.fire('scroll', {target: h.doc}); assert.equal(h.html.scrollTop, 0);
  h.dialog.scrollTop = 150; h.win.fire('scroll', {target: h.dialog}); assert.equal(h.dialog.scrollTop, 150);
});
test('SPA navigation to messages restores styles; returning to the feed relocks it', async () => {
  const h = await harness();
  assert.equal(h.nested.style.getPropertyValue('overflow-y'), 'hidden');
  h.location.href = 'https://x.com/messages/1'; h.tick();
  assert.equal(h.html.hasAttribute('data-antiscroll-locked'), false);
  assert.equal(h.nested.style.getPropertyValue('overflow-y'), 'auto');
  assert.equal(h.nested.style.getPropertyPriority('overflow-y'), 'important');
  h.location.href = 'https://x.com/home'; h.tick();
  assert.equal(h.html.hasAttribute('data-antiscroll-locked'), true);
});
test('A storage change unlocks scrolling; the deadline locks it again', async () => {
  const h = await harness();
  h.set({settings: P.DEFAULT_SETTINGS, endAt: Date.now() + 100_000});
  assert.equal(h.html.hasAttribute('data-antiscroll-locked'), false);
  h.set({settings: P.DEFAULT_SETTINGS, endAt: Date.now() - 1}); h.tick();
  assert.equal(h.html.hasAttribute('data-antiscroll-locked'), true);
});
test('Reels: hides the link, intercepts clicks, and detects direct navigation', async () => {
  const h = await harness();
  assert.equal(h.link.hasAttribute('data-antiscroll-hidden'), true);
  assert.equal(h.win.fire('click', {target: h.link}).defaultPrevented, true);
  h.location.href = 'https://x.com/i/immersive_media/1'; h.tick();
  assert.equal(h.location.redirectedTo, 'https://x.com/home');
  const ig = await harness('https://www.instagram.com/reels/');
  assert.equal(ig.location.redirectedTo, 'https://www.instagram.com/');
});
test('An SPA-reused link becomes visible when it no longer points to Reels', async () => {
  const h = await harness();
  h.link.setAttribute('href', '/messages'); h.mutate();
  assert.equal(h.link.hasAttribute('data-antiscroll-hidden'), false);
});
test('Disabling a network restores styles and links', async () => {
  const h = await harness(); h.set({settings: {...P.DEFAULT_SETTINGS, x: false}, endAt: 0});
  assert.equal(h.html.hasAttribute('data-antiscroll-locked'), false);
  assert.equal(h.link.hasAttribute('data-antiscroll-hidden'), false);
  assert.equal(h.html.style.getPropertyValue('overflow-y'), '');
});
