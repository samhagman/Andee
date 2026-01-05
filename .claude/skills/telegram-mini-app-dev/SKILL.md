---
name: telegram-mini-app-dev
description: Guide for building Telegram Mini Apps that integrate with Andee bot. Use when creating new Mini Apps, debugging data passing issues, or understanding the webapp link convention.
---

# Telegram Mini App Development Guide

This skill documents the patterns and gotchas for building Telegram Mini Apps that work with the Andee bot.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MINI APP DATA FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Claude generates response with webapp: link                             │
│     [Button Text](webapp:https://andee-7rd.pages.dev/app/#data=BASE64)     │
│                                                                             │
│  2. Grammy bot parses webapp: links → InlineKeyboard                        │
│     keyboard.webApp(text, url)                                              │
│                                                                             │
│  3. User taps button → Telegram opens Mini App                              │
│                                                                             │
│  4. Mini App reads data from URL HASH (not query params!)                   │
│     window.location.hash → #data=BASE64&tgWebAppVersion=...                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Critical: URL Hash vs Query Params

**Telegram Mini Apps pass data via the URL HASH (`#`), NOT query parameters (`?`).**

### Why This Matters

```
WRONG (will fail):
https://andee-7rd.pages.dev/weather/?data=eyJsb2Mi...
                                    ↑
                            Query param - gets stripped!

CORRECT (works):
https://andee-7rd.pages.dev/weather/#data=eyJsb2Mi...
                                    ↑
                            Hash - preserved by Telegram!
```

When Telegram opens a Mini App:
1. It may strip or ignore custom query parameters
2. It APPENDS its own parameters to the hash (tgWebAppVersion, tgWebAppData, etc.)
3. Your data in the hash is preserved alongside Telegram's params

### Reading Data in Mini App

```javascript
function extractDataParam() {
  // Try hash first (Telegram's method)
  const hash = window.location.hash.slice(1); // Remove leading #
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    const hashData = hashParams.get('data');
    if (hashData) return { data: hashData, source: 'hash' };
  }

  // Fallback to query params (for direct browser testing)
  const searchParams = new URLSearchParams(window.location.search);
  const searchData = searchParams.get('data');
  if (searchData) return { data: searchData, source: 'query' };

  return { data: null, source: 'none' };
}
```

## Base64url Encoding

Standard base64 uses characters that can cause issues in URLs:
- `+` → should be `-`
- `/` → should be `_`
- `=` → padding, should be removed

### Encoding (in skill/Claude response)

```javascript
// Standard base64
const base64 = btoa(JSON.stringify(data));
// Convert to base64url (remove padding)
const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
```

### Decoding (in Mini App)

```javascript
function base64urlToBase64(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }
  return base64;
}

// Usage
const json = atob(base64urlToBase64(dataParam));
const data = JSON.parse(json);
```

## webapp: Link Convention

Claude returns links in markdown format that the bot parses:

```markdown
[Button Text](webapp:https://andee-7rd.pages.dev/app-name/#data=BASE64URL)
```

The Grammy bot extracts these with regex and creates InlineKeyboard buttons:

```typescript
const webappRegex = /\[([^\]]+)\]\(webapp:(https?:\/\/[^)]+)\)/g;

// Creates Telegram web_app button
keyboard.webApp(buttonText, url);
```

## Compact Data Format

Keep JSON minimal to avoid URL length issues:

```json
// BAD - too verbose
{"location":"Boston, MA","currentTemp":25,"feelsLike":22}

// GOOD - compact keys
{"loc":"Boston","c":25,"fl":22}
```

The Mini App should normalize compact format to full format for rendering.

## Mini App Template

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
  <div id="app"></div>
  <script>
    // Initialize Telegram WebApp
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();

      // Apply Telegram theme
      if (tg.themeParams) {
        const tp = tg.themeParams;
        if (tp.bg_color) document.body.style.background = tp.bg_color;
        if (tp.text_color) document.body.style.color = tp.text_color;
      }
    }

    // Base64url decoder
    function base64urlToBase64(b64url) {
      let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4;
      if (pad) b64 += '='.repeat(4 - pad);
      return b64;
    }

    // Extract data from hash or query
    function getData() {
      const hash = window.location.hash.slice(1);
      if (hash) {
        const params = new URLSearchParams(hash);
        const data = params.get('data');
        if (data) return JSON.parse(atob(base64urlToBase64(data)));
      }
      const search = new URLSearchParams(window.location.search);
      const data = search.get('data');
      if (data) return JSON.parse(atob(base64urlToBase64(data)));
      return null;
    }

    // Main
    const data = getData();
    if (data) {
      document.getElementById('app').innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    } else {
      document.getElementById('app').innerHTML = '<p>No data provided</p>';
    }
  </script>
</body>
</html>
```

## Directory Structure

```
Andee/
├── apps/                          # All Mini Apps (Cloudflare Pages)
│   ├── package.json               # npm run deploy → deploys all apps
│   └── src/
│       ├── weather/index.html     # → andee-7rd.pages.dev/weather/
│       └── {new-app}/index.html   # → andee-7rd.pages.dev/{new-app}/
│
└── claude-sandbox-worker/
    └── .claude/skills/
        └── {skill}/SKILL.md       # Skills that generate webapp: links
```

## Adding a New Mini App

1. **Create the app:**
   ```bash
   mkdir -p apps/src/{app-name}
   # Create index.html with template above
   ```

2. **Deploy:**
   ```bash
   cd apps && npm run deploy
   ```

3. **Create corresponding skill** (if needed):
   ```bash
   mkdir -p claude-sandbox-worker/.claude/skills/{skill-name}
   # Create SKILL.md with instructions to generate webapp: link
   ```

4. **Rebuild sandbox container:**
   ```bash
   cd claude-sandbox-worker && npm run dev
   ```

## Debugging Tips

### Add Debug Output

When things aren't working, add debug info to error states:

```javascript
const debugInfo = `URL: ${window.location.href.substring(0, 60)}... | Hash: ${window.location.hash.substring(0, 40)}... | Source: ${dataSource}`;

showError('Failed to load', debugInfo);
```

### Test Without Telegram

Open the Mini App directly in browser with hash:
```
https://andee-7rd.pages.dev/weather/#data=eyJsb2MiOiJCb3N0b24ifQ
```

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No data provided" | Using `?data=` instead of `#data=` | Change to hash-based URL |
| Garbled JSON | Standard base64 with `+/=` chars | Use base64url encoding |
| Button doesn't appear | Regex not matching | Check `webapp:` prefix in link |
| Mini App blank | JS error | Check browser console |

## References

- [Telegram Mini Apps Docs](https://core.telegram.org/bots/webapps)
- [Launch Parameters](https://docs.telegram-mini-apps.com/platform/launch-parameters)
- [Grammy InlineKeyboard](https://grammy.dev/plugins/keyboard)
