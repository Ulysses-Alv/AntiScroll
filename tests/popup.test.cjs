'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../extension/policy.js');
const code = fs.readFileSync(path.join(__dirname, '../extension/popup.js'), 'utf8');
const NOW = 1_000_000;

async function harness() {
  let now = NOW;
  let tick;
  const messages = [];
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const element = {
        handlers: {}, open: false,
        addEventListener(type, fn) {this.handlers[type] = fn;},
        showModal() {this.open = true;},
        close() {this.open = false;},
        click() {if (!this.disabled && !this.hidden) this.handlers.click();}
      };
      nodes.set(id, element);
    }
    return nodes.get(id);
  };
  let state = {settings: P.DEFAULT_SETTINGS, endAt: 0, nextAvailableAt: 0};
  const sendMessage = async ({type}) => {
    messages.push(type);
    if (type === 'START_SESSION') state = {...state, endAt: now + 900_000, nextAvailableAt: now + 86_400_000};
    if (type === 'STOP_SESSION') state = {...state, endAt: 0};
    return {ok: true, state};
  };
  vm.runInNewContext(code, {
    AntiScrollPolicy: P, Date: {now: () => now}, document: {getElementById: node},
    chrome: {runtime: {sendMessage}, storage: {onChanged: {addListener() {}}}},
    setInterval: fn => {tick = fn;}
  }, {filename: 'popup.js'});
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return {node, messages, settle, advance(ms) {now += ms; tick();}};
}

test('Requesting the pass and dismissing confirmation never starts it', async () => {
  const h = await harness();
  h.node('start').click();
  assert.equal(h.node('confirmPass').open, true);
  assert.deepEqual(h.messages, ['GET_STATE']);
  h.node('confirmPass').close();
  assert.equal(h.node('start').disabled, false);
  assert.deepEqual(h.messages, ['GET_STATE']);
});
test('Confirming starts once; stopping switches to cooldown until the 24-hour boundary', async () => {
  const h = await harness();
  h.node('start').click();
  h.node('confirmStart').click();
  await h.settle();
  assert.equal(h.node('confirmPass').open, false);
  assert.equal(h.node('countdown').textContent, '15:00');
  assert.equal(h.node('stop').hidden, false);
  assert.deepEqual(h.messages, ['GET_STATE', 'START_SESSION']);
  h.node('stop').click();
  await h.settle();
  assert.equal(h.node('statusLabel').textContent, 'Daily pass used');
  assert.equal(h.node('countdown').textContent, '24:00:00');
  h.advance(86_399_999);
  assert.equal(h.node('start').disabled, true);
  h.advance(1);
  assert.equal(h.node('start').disabled, false);
  assert.equal(h.node('countdown').textContent, '15:00');
});
