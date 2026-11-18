'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../extension/policy.js');
const code = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');
const NOW = 1_000_000;
const PASS = 15 * 60_000;
const DAY = 24 * 60 * 60_000;

function harness(persisted, initialNow = NOW) {
  let now = initialNow;
  let stored = persisted ? structuredClone(persisted) : undefined;
  const listeners = {};
  const alarms = new Map();
  const event = name => ({addListener(fn) {listeners[name] = fn;}});
  const chrome = {
    runtime: {id: 'unit-test', getURL: file => `chrome-extension://unit-test/${file}`, onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup')},
    storage: {local: {async get() {return {antiscrollState: structuredClone(stored)};}, async set(value) {stored = structuredClone(value.antiscrollState);}}},
    alarms: {onAlarm: event('alarm'), async create(name, spec) {alarms.set(name, spec);}, async clear(name) {alarms.delete(name);}}
  };
  vm.runInNewContext(code, {chrome, AntiScrollPolicy: P, importScripts() {}, console, Date: {now: () => now}}, {filename: 'background.js'});
  function send(type, extra = {}, sender = {id: 'unit-test', url: 'chrome-extension://unit-test/popup.html'}) {
    return new Promise(resolve => {const pending = listeners.message({type, ...extra}, sender, resolve); if (!pending) resolve(undefined);});
  }
  return {send, alarms, listeners, advance: ms => {now += ms;}, get state() {return structuredClone(stored);}};
}

test('First run persists defaults; only supported preferences can be saved', async () => {
  const h = harness();
  assert.equal((await h.send('GET_STATE')).ok, true);
  assert.deepEqual(h.state.settings, {instagram: true, x: true, allowSearchScroll: false});
  await h.send('SAVE_SETTINGS', {settings: {minutes: 60, x: false, allowSearchScroll: true}});
  assert.deepEqual((await harness(h.state).send('GET_STATE')).state.settings, {instagram: true, x: false, allowSearchScroll: true});
});
test('Concurrent starts use one fixed 15-minute pass without extending either deadline', async () => {
  const h = harness();
  const results = await Promise.all([h.send('START_SESSION'), h.send('START_SESSION'), h.send('START_SESSION')]);
  assert.ok(results.every(({ok, state}) => ok && state.endAt === NOW + PASS && state.nextAvailableAt === NOW + DAY));
  h.advance(40_000);
  assert.equal((await h.send('START_SESSION')).state.endAt, NOW + PASS);
  assert.equal(h.state.nextAvailableAt, NOW + DAY);
  assert.equal(h.alarms.get('antiscroll-expiry').when, NOW + PASS);
});
test('A worker restart restores the alarm and preserves both deadlines', async () => {
  const h = harness(); await h.send('START_SESSION');
  const revived = harness(h.state, NOW + 30_000);
  const {state} = await revived.send('GET_STATE');
  assert.equal(state.endAt, NOW + PASS);
  assert.equal(state.nextAvailableAt, NOW + DAY);
  assert.equal(revived.alarms.get('antiscroll-expiry').when, NOW + PASS);
});
test('Expiry relocks without an alarm; another pass is allowed exactly 24 hours after start', async () => {
  const h = harness(); await h.send('START_SESSION'); h.advance(PASS);
  assert.equal((await h.send('GET_STATE')).state.endAt, 0);
  assert.equal((await h.send('START_SESSION')).ok, false);
  h.advance(DAY - PASS - 1);
  assert.equal((await h.send('START_SESSION')).ok, false);
  h.advance(1);
  const {state} = await h.send('START_SESSION');
  assert.equal(state.endAt, NOW + DAY + PASS);
  assert.equal(state.nextAvailableAt, NOW + 2 * DAY);
});
test('Stopping early and restarting the worker do not refund the daily pass', async () => {
  const h = harness(); await h.send('START_SESSION'); await h.send('STOP_SESSION');
  assert.equal(h.state.endAt, 0);
  assert.equal(h.state.nextAvailableAt, NOW + DAY);
  assert.equal(h.alarms.size, 0);
  const revived = harness(h.state, NOW + PASS);
  await revived.send('SAVE_SETTINGS', {settings: {x: false}});
  assert.equal((await revived.send('START_SESSION')).ok, false);
  assert.equal(revived.state.nextAvailableAt, NOW + DAY);
});
test('Starting with both networks off does not use the pass', async () => {
  const h = harness(); await h.send('SAVE_SETTINGS', {settings: {x: false, instagram: false}});
  assert.equal((await h.send('START_SESSION')).ok, false);
  assert.equal(h.state.nextAvailableAt, 0);
});
test('An active session from an older version gets at most 15 more minutes and counts as used', async () => {
  const h = harness({settings: {...P.DEFAULT_SETTINGS, minutes: 180}, endAt: NOW + 2 * PASS});
  await h.send('GET_STATE');
  assert.equal(h.state.endAt, NOW + PASS);
  assert.equal(h.state.nextAvailableAt, NOW + DAY);
  assert.equal(h.state.settings.minutes, undefined);
});
test('A website cannot change settings or use the pass', async () => {
  const h = harness();
  assert.equal(await h.send('STOP_SESSION', {}, {id: 'unit-test', url: 'https://x.com/home', tab: {id: 1}}), undefined);
  assert.equal(await h.send('START_SESSION', {}, {id: 'other', url: 'chrome-extension://unit-test/popup.html'}), undefined);
  assert.equal((await h.send('INVALID_ACTION')).ok, false);
});
