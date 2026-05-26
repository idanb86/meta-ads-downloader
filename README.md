# Meta Ads Downloader & Analyzer 🎬

A Chrome extension to download videos/images from Meta Ads Library and generate AI analysis prompts for Claude.

## Features

- **⬇ Download** — grab videos and images from any ad in one click
- **🤖 Analyze** — generates a ready-to-paste prompt to analyze the ad in Claude (hook, value prop, scoring, 3 new ad variations)
- **📋 Copy URL** — copy the media link directly
- **🍌 Nano Banana** — generate a visual-creation prompt based on a winning ad
- **🏆 Winner Tags** — auto-tags ads by how long they've been running (90d+ = proven winner)
- **📊 Batch Analysis** — analyze all visible ads at once for pattern detection
- **📚 History** — tracks analyzed ads in the popup

## Installation (Developer Mode)

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the `meta-ads-downloader-public` folder
5. Go to [facebook.com/ads/library](https://www.facebook.com/ads/library/)

## Usage

1. Search any advertiser or keyword in Meta Ads Library
2. Buttons appear below each "See ad details" button
3. **Download:** play the video first (a second or two), then click ⬇
4. **Analyze:** click 🤖 → copy the prompt → paste into Claude

## How It Works

- Captures media URLs via the browser's `PerformanceObserver` API (CSP-safe, no script injection)
- Per-video tracking ties each download button to its specific ad
- Analysis prompts open a new Claude chat — paste and send

## Notes

- Meta's media URLs expire after a few hours — for visual analysis, download the file and attach it to Claude directly
- Some videos load as blob URLs — play them first so the extension can capture the real URL

## Tech

Manifest V3 · No external dependencies · No data leaves your browser

---

Created by **Idan Birenberg**
