/* global AntiScrollPolicy */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const switches = ['instagram', 'x', 'allowSearchScroll'];
  const confirmPass = $('confirmPass');
  let state;
  let busy = false;

  async function send(type, fields = {}) {
    const result = await chrome.runtime.sendMessage({type, ...fields});
    if (!result?.ok) throw new Error(result?.error || 'Could not connect. Reopen AntiScroll and try again.');
    return result.state;
  }
  function formatTime(ms, useHours) {
    const seconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const parts = useHours ? [Math.floor(minutes / 60), minutes % 60, seconds % 60] : [minutes, seconds % 60];
    return parts.map(value => String(value).padStart(2, '0')).join(':');
  }
  function render(fill = false) {
    if (!state) return;
    if (fill) for (const key of switches) $(key).checked = state.settings[key];
    const now = Date.now();
    const passLeft = AntiScrollPolicy.remaining(state.endAt, now);
    const cooldownLeft = AntiScrollPolicy.remaining(state.nextAvailableAt, now);
    const protectedNetwork = state.settings.instagram || state.settings.x;
    const canStart = !busy && !passLeft && !cooldownLeft && protectedNetwork;

    $('countdown').textContent = passLeft ? formatTime(passLeft, false) : cooldownLeft ? formatTime(cooldownLeft, true) : '15:00';
    $('statusLabel').textContent = passLeft ? 'Daily pass active' : cooldownLeft ? 'Daily pass used' : 'Daily pass available';
    $('timerHelp').textContent = passLeft ? 'The clock keeps running after you close this window.'
      : cooldownLeft ? 'Time until your next pass. Ending early does not reset the cooldown.'
        : protectedNetwork ? 'One 15-minute pass every 24 hours, shared across protected networks.'
          : 'Enable a network to use your daily pass.';
    $('start').hidden = !!passLeft;
    $('start').disabled = !canStart;
    $('stop').hidden = !passLeft;
    $('stop').disabled = busy;
    for (const key of switches) $(key).disabled = busy;
    if (!canStart && confirmPass.open) confirmPass.close();
  }
  async function action(task) {
    if (busy) return;
    busy = true;
    $('feedback').textContent = '';
    render();
    try { state = await task(); }
    catch (error) { $('feedback').textContent = error.message; }
    finally { busy = false; render(true); }
  }
  for (const key of switches) {
    $(key).addEventListener('change', () => action(() => send('SAVE_SETTINGS', {settings: {[key]: $(key).checked}})));
  }
  $('start').addEventListener('click', () => confirmPass.showModal());
  $('confirmStart').addEventListener('click', () => {
    confirmPass.close();
    action(() => send('START_SESSION'));
  });
  $('stop').addEventListener('click', () => action(() => send('STOP_SESSION')));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.antiscrollState?.newValue) { state = changes.antiscrollState.newValue; render(true); }
  });
  action(() => send('GET_STATE'));
  setInterval(() => render(), 250);
})();
