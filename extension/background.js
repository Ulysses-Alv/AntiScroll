/* global AntiScrollPolicy */
'use strict';
importScripts('policy.js');
const KEY = 'antiscrollState';
const ALARM = 'antiscroll-expiry';
const PASS_DURATION = 15 * 60_000;
const PASS_COOLDOWN = 24 * 60 * 60_000;
let queue = Promise.resolve();
function serialized(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
async function readState() {
  const raw = (await chrome.storage.local.get(KEY))[KEY] || {};
  const now = Date.now();
  let endAt = AntiScrollPolicy.remaining(raw.endAt, now) ? raw.endAt : 0;
  let nextAvailableAt = AntiScrollPolicy.remaining(raw.nextAvailableAt, now) ? raw.nextAvailableAt : 0;
  // Older versions stored only the active deadline. Give that pass a bounded
  // remaining duration and count it toward the first cooldown after upgrade.
  if (endAt && !nextAvailableAt) {
    endAt = Math.min(endAt, now + PASS_DURATION);
    nextAvailableAt = now + PASS_COOLDOWN;
  }
  return {settings: AntiScrollPolicy.settings(raw.settings), endAt, nextAvailableAt};
}
async function saveState(state) {
  await chrome.storage.local.set({[KEY]: state});
  if (state.endAt > Date.now()) await chrome.alarms.create(ALARM, {when: state.endAt});
  else await chrome.alarms.clear(ALARM);
  return state;
}
async function handle(message) {
  const state = await readState();
  switch (message.type) {
    case 'GET_STATE': return state;
    case 'SAVE_SETTINGS':
      state.settings = AntiScrollPolicy.settings({...state.settings, ...message.settings});
      return saveState(state);
    case 'START_SESSION': {
      const now = Date.now();
      // A second confirmation cannot extend an active pass or reset the cooldown.
      if (state.endAt > now) return state;
      if (state.nextAvailableAt > now) throw new Error('Your daily pass has already been used. Try again when the cooldown ends.');
      if (!state.settings.instagram && !state.settings.x) throw new Error('Enable at least one network to use your daily pass.');
      state.endAt = now + PASS_DURATION;
      state.nextAvailableAt = now + PASS_COOLDOWN;
      return saveState(state);
    }
    case 'STOP_SESSION': state.endAt = 0; return saveState(state);
    default: throw new Error('Unknown action.');
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content pages never write configuration. Only this extension's popup does.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  serialized(() => handle(message)).then(state => sendResponse({ok: true, state}), error => sendResponse({ok: false, error: error.message}));
  return true;
});
function reconcile() { return serialized(async () => saveState(await readState())).catch(console.error); }
chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) reconcile(); });
// Restore the alarm whenever the worker is revived; correctness uses the absolute deadline.
reconcile();
