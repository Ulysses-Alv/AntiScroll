'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const P = require('../extension/policy.js');
const now = 1_000_000;
const defaults = P.DEFAULT_SETTINGS;
test('Feeds, profiles, Explore, and search are blocked by default', () => {
  for (const url of ['https://www.instagram.com/', 'https://www.instagram.com/persona/', 'https://www.instagram.com/explore/', 'https://www.instagram.com/explore/search/?q=unity', 'https://x.com/home', 'https://x.com/usuario', 'https://x.com/search?q=unity', 'https://twitter.com/explore']) assert.equal(P.decision(url, defaults, 0, now).locked, true, url);
});
test('Stories, DMs, composing, and individual posts remain available', () => {
  for (const url of ['https://www.instagram.com/stories/persona/1/', 'https://www.instagram.com/direct/inbox/', 'https://www.instagram.com/p/ABC/', 'https://x.com/messages/123', 'https://x.com/i/chat/123', 'https://x.com/compose/post', 'https://x.com/persona/status/1234']) assert.equal(P.decision(url, defaults, 0, now).locked, false, url);
});
test('Reels and immersive videos remain blocked during a pass', () => {
  for (const url of ['https://www.instagram.com/reels/', 'https://www.instagram.com/reel/ABC/', 'https://www.instagram.com/persona/reels/', 'https://x.com/i/immersive_media/123', 'https://x.com/i/videos']) assert.equal(P.decision(url, defaults, now + 60_000, now).redirect, true, url);
});
test('Search preference applies only to results, not Explore or profiles', () => {
  const config = {...defaults, allowSearchScroll: true};
  for (const url of ['https://x.com/search?q=unity', 'https://www.instagram.com/explore/search/?q=unity']) assert.equal(P.decision(url, config, 0, now).locked, false);
  for (const url of ['https://x.com/explore', 'https://www.instagram.com/explore/', 'https://x.com/unity']) assert.equal(P.decision(url, config, 0, now).locked, true);
});
test('The pass expires at its absolute deadline', () => {
  const url = 'https://x.com/home';
  assert.equal(P.decision(url, defaults, now + 1, now).locked, false);
  assert.equal(P.decision(url, defaults, now, now).locked, true);
  assert.equal(P.decision(url, defaults, now - 1, now).locked, true);
  for (const value of [NaN, Infinity, -1, null, '99999999999']) assert.equal(P.remaining(value, now), 0);
});
test('Network settings are independent; unrelated domains stay untouched', () => {
  assert.equal(P.decision('https://www.instagram.com/reels/', {...defaults, instagram: false}, 0, now).redirect, false);
  assert.equal(P.decision('https://x.com/home', {...defaults, instagram: false}, 0, now).locked, true);
  assert.equal(P.decision('https://x.com.evil.test/home', defaults, 0, now).enabled, false);
});
test('Invalid settings fall back to defaults; legacy timer values are ignored', () => {
  assert.deepEqual(P.settings(null), defaults);
  assert.deepEqual(P.settings({instagram: 'false', x: null, allowSearchScroll: 1, minutes: 180}), defaults);
});
