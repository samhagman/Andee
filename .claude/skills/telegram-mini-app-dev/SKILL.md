---
name: telegram-mini-app-dev
description: Guide for building Telegram Mini Apps that integrate with Andee bot. Use when creating new Mini Apps, debugging data passing issues, or understanding the Direct Link Mini App convention.
---

# Telegram Mini App Development Guide

This skill documents patterns for building Telegram Mini App components using the Vite + TypeScript framework.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MINI APPS FRAMEWORK (Vite + TypeScript)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LINK FORMAT:                                                               │
│  https://t.me/HeyAndee_bot/app?startapp={component}_{base64url_data}       │
│                                                                             │
│  BUILD SYSTEM:                                                              │
│  src/lib/          src/app/         src/weather/      src/{component}/      │
│  ┌──────────┐      ┌──────────┐     ┌──────────┐      ┌──────────┐         │
│  │telegram.ts│◄────│main.ts   │     │main.ts   │◄─────│main.ts   │         │
│  │base64url.ts│    │index.html│     │index.html│      │index.html│         │
│  │data.ts    │◄────────────────────┬┘            ◄────┘                    │
│  │base.css   │                     │                                        │
│  │types/     │◄────────────────────┘                                        │
│  └──────────┘                                                               │
│       │                                                                     │
│       ▼ npm run build (Vite)                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  dist/app/index.html  │  dist/weather/index.html  │  dist/assets/*   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│       │                                                                     │
│       ▼ npm run deploy (Cloudflare Pages)                                   │
│  https://andee-7rd.pages.dev/                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Link Format

```
https://t.me/HeyAndee_bot/app?startapp={component}_{base64url_data}
```

**startapp format:** `{component}_{base64url_data}`

| Part | Description | Example |
|------|-------------|---------|
| `component` | Component folder name | `weather` |
| `_` | Separator | `_` |
| `base64url_data` | Encoded JSON | `eyJsb2MiOiJCb3N0b24ifQ` |

**Constraints:**
- Characters allowed: A-Z, a-z, 0-9, `_`, `-`
- Max length: 512 characters

## Shared Library (`apps/src/lib/`)

All components import from the shared library:

### Telegram Utilities (`telegram.ts`)

```typescript
import { initTelegram, applyTheme, getStartParam } from '../lib';

// Initialize Telegram WebApp + apply theme
initTelegram();

// Get startapp parameter (for shell router)
const param = getStartParam();  // "weather_eyJsb2Mi..."
```

### Base64url (`base64url.ts`)

```typescript
import { encode, decode } from '../lib';

// Encode (in skills, not Mini Apps)
const encoded = encode({ loc: "Boston", c: -3 });

// Decode (generic, typed)
const data = decode<MyData>(encoded);
```

### Data Extraction (`data.ts`)

```typescript
import { getData } from '../lib';
import type { WeatherData } from '../lib/types';

const { data, error } = getData<WeatherData>();
if (error) {
  showError(error.message);
} else if (data) {
  render(data);
}
```

### TypeScript Types (`types/`)

Each component should have its data interface in `apps/src/lib/types/`:

```typescript
// apps/src/lib/types/mycomponent.ts
export interface MyComponentData {
  title: string;
  items: string[];
}

// apps/src/lib/types/index.ts
export * from './mycomponent';
```

## Creating a New Component

### 1. Create Directory Structure

```bash
mkdir -p apps/src/{component-name}
```

### 2. Add TypeScript Interface

Create `apps/src/lib/types/{component}.ts`:

```typescript
export interface MyComponentData {
  title: string;
  value: number;
}
```

Export from `apps/src/lib/types/index.ts`:

```typescript
export * from './mycomponent';
```

### 3. Create index.html

Minimal HTML entry point:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>My Component</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <link rel="stylesheet" href="../lib/base.css">
</head>
<body>
  <div id="app">
    <!-- Component HTML structure -->
  </div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

### 4. Create main.ts

```typescript
import { initTelegram, getData } from '../lib';
import type { MyComponentData } from '../lib/types';
import './component.css';  // Optional component-specific styles

// Initialize Telegram
initTelegram();

// Get data from URL
const { data, error } = getData<MyComponentData>();

if (error) {
  document.getElementById('app')!.innerHTML = `
    <div class="error">Error: ${error.message}</div>
  `;
} else if (!data) {
  document.getElementById('app')!.innerHTML = `
    <div class="error">No data provided</div>
  `;
} else {
  // Render component
  render(data);
}

function render(data: MyComponentData): void {
  document.getElementById('app')!.innerHTML = `
    <h1>${data.title}</h1>
    <p>Value: ${data.value}</p>
  `;
}
```

### 5. Add to Vite Config

Edit `apps/vite.config.ts`:

```typescript
rollupOptions: {
  input: {
    app: resolve(__dirname, "src/app/index.html"),
    weather: resolve(__dirname, "src/weather/index.html"),
    mycomponent: resolve(__dirname, "src/mycomponent/index.html"),  // Add this
  },
},
```

### 6. Build & Test

```bash
cd apps
npm run typecheck    # Verify types
npm run dev          # Test at http://localhost:8788/mycomponent/#data={base64url}
npm run build        # Build for production
```

### 7. Deploy

```bash
cd apps && npm run deploy
```

### 8. Update Skill

In `claude-sandbox-worker/.claude/skills/{skill}/SKILL.md`, generate links:

```markdown
[Open Component](https://t.me/HeyAndee_bot/app?startapp=mycomponent_{base64url})
```

## Commands

```bash
cd apps
npm run dev          # Vite dev server (port 8788)
npm run build        # Build to dist/
npm run typecheck    # TypeScript validation
npm run preview      # Preview built files
npm run deploy       # Build + deploy to Cloudflare Pages
```

## Testing

**Test component directly:**
```
http://localhost:8788/weather/#data={base64url}
https://andee-7rd.pages.dev/weather/#data={base64url}
```

**Test via shell:**
```
http://localhost:8788/app/?startapp=weather_{base64url}
https://andee-7rd.pages.dev/app/?startapp=weather_{base64url}
```

## Directory Structure

```
apps/
├── package.json              # Vite + TypeScript
├── vite.config.ts            # Multi-page app config
├── tsconfig.json
└── src/
    ├── lib/                  # SHARED LIBRARY
    │   ├── index.ts          # Re-exports
    │   ├── telegram.ts       # initTelegram(), applyTheme()
    │   ├── base64url.ts      # encode(), decode()
    │   ├── data.ts           # getData<T>()
    │   ├── base.css          # Shared styles
    │   └── types/
    │       ├── index.ts
    │       └── weather.ts    # WeatherData interface
    ├── app/                  # Shell router
    │   ├── index.html
    │   ├── main.ts
    │   └── shell.css
    ├── weather/              # Weather component
    │   ├── index.html
    │   ├── main.ts
    │   └── weather.css
    └── {component}/          # Add new components
        ├── index.html
        ├── main.ts
        └── component.css
```

## Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| "No data" | Missing hash | Ensure URL has `#data=` |
| Garbled text | Standard base64 | Use base64url encoding |
| Component blank | JS error | Check browser console |
| Link not clickable | Special chars | Only use allowed chars |
| TypeScript error | Missing type | Add interface to `lib/types/` |
| Build fails | Missing entry | Add to `vite.config.ts` input |
