# AntiScroll · 0.1.0 beta

Use Instagram and X for what you came to do. AntiScroll blocks endless scrolling without getting in the way of messages, stories, or individual posts. It runs locally, with no account, server, or analytics.

## DUFWA 2026

**Do The Fuck U Want — 2026 Edition**

This is a vibe-coded side project. I built it for myself and shared it in case it's useful to someone else.

- Want to use it, change it, fork it, or sell it? Fucking go for it.
- Found a bug? Fix it in your fork if you feel like it.
- Expect me to fix it? Absolutely not.

**No support. No maintenance promises. No roadmap.**

**The code is free. My time isn't.**

DUFWA is the project's stance on support, not a software license. The code is available under the [BSD Zero Clause License (0BSD)](LICENSE).

## Install in desktop Chrome

1. On GitHub, click **Code → Download ZIP** and extract it to a folder you plan to keep.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder (the one with `manifest.json`).
4. Reload any open Instagram or X tabs. Pin AntiScroll from the extensions menu to keep the pass handy.

This beta is for desktop Chrome. It does not affect mobile apps.

## Use your daily pass

Click **Use my 15 minutes**, then confirm with **Yes, start the pass**. Choosing **Not now** does not use the pass.

- One fixed **15-minute pass** is shared across protected networks and tabs.
- The next pass unlocks **24 hours after you start this one**, not at midnight. Closing Chrome, reopening the popup, or ending the pass early does not reset that clock.
- At expiry, protected feeds return to the top and scrolling is blocked again. A suspended tab applies the change when it resumes.
- Reels and X's immersive video viewer stay blocked during the pass.

## What stays available

| Area | Default behavior |
| --- | --- |
| Home feeds, profiles, and Explore | The first screen stays visible; vertical scrolling is blocked. |
| Search results | You can type and choose results. Enable **Allow scrolling in search results** to scroll results, without unlocking Explore or profiles. |
| Stories, messages, settings, and individual posts | Remain available, including post comments and videos in regular X posts. |
| Instagram Reels and X's immersive video section | Known links are hidden, and direct navigation redirects to the feed. |

You can turn off protection separately for each network. Dialogs, menus, and text inputs stay usable. Search panels and related content on individual post pages may behave differently from feeds.

## Privacy

AntiScroll uses `storage` for preferences and pass deadlines, and `alarms` to coordinate expiry. It does not store your messages, searches, or browsing history, and does not send data to a server. The supported sites can observe the changes the extension makes to their pages. You can disable or remove the extension at any time.

## Development and verification

The `extension/` folder is the entire runtime package. No build step or runtime dependencies are required.

```sh
npm test
```

The automated tests use Node.js 20 or later. To test the unpacked extension in Chromium:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

The browser suite uses fixture pages at the platform URLs. It does not log in to or contact Instagram or X. You can set `CHROMIUM_PATH` to a compatible Chromium executable.

This is a beta. If you try it, smoke-test it on the current Instagram and X layouts: check feed scrolling, direct video links with protection both on and off, messages and stories, and pass confirmation across two tabs. The platforms may change without notice and break the extension.
