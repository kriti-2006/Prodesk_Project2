# Prodesk Cloud Landing Page

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/prodeskcloud/landing-page)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

The official marketing and corporate landing page for Prodesk Cloud. This repository contains the source code for the public-facing homepage and associated static assets.

## Architecture

This project is intentionally built as a lightweight, static frontend using core web technologies to maximize performance (Lighthouse score optimization) and minimize bundle size.

- **Vanilla JavaScript**: Zero-dependency frontend architecture for speed and simplicity.
- **Custom CSS Design System**: Uses native CSS variables for tokens, theming (light/dark mode), and responsive layouts.
- **JSON-Driven Content**: Text copy, metadata, and marketing assets are decoupled into `data/content.json` to allow product marketing teams to update content without touching component logic.
- **Custom Bundler**: Uses a lightweight custom build script (`scripts/build-bundle.mjs`) to concatenate and minify JavaScript into a single `bundle.js` artifact for production.

## Local Development

### Prerequisites
- Node.js `v20.11.0` or higher (see `.nvmrc`)

### Getting Started

1. **Install Dependencies**
   Although this is a vanilla JS project, we use `package.json` for test runners and build scripts.
   ```bash
   npm install
   ```

2. **Start the Development Server**
   Runs a local static server to serve the assets and watch for changes.
   ```bash
   npm run dev
   ```
   The site will be available at `http://localhost:3000`.

## Build & Test Pipeline

### Building for Production
To bundle the modular JavaScript files (`js/`) into the final production payload (`bundle.js`):
```bash
npm run build
```

### Running the Test Suite
The project includes a robust validation suite using JSDOM to ensure component hydration, theme initialization, and state management work flawlessly.
```bash
npm test
```
This executes both:
- **Runtime Verification**: Simulates a fresh page load and asserts component lifecycle hooks and EventBus interactions.
- **Persistence Verification**: Simulates a page reload to guarantee that user preferences (dark mode, FAQ toggles, analytics counts) are correctly restored from `localStorage`.

## Directory Structure

```text
.
├── assets/           # Images, icons, and static media
├── data/             # JSON payload (content.json)
├── js/               # Modular JavaScript (App logic, components, state)
│   ├── components/   # UI components (Hero, FAQ, Nav)
│   ├── core/         # Base Component class, DOM utilities
│   ├── services/     # EventBus, Storage, Content fetching
│   └── state/        # StateManager and Schema
├── scripts/          # Build and deployment scripts
├── index.html        # Entry point
├── style.css         # Global stylesheet and design tokens
└── test-*.mjs        # Automated testing environments
```

## Deployment

This repository is configured for continuous deployment on static hosting platforms (Vercel, Netlify, Cloudflare Pages). 

The production build command is:
```bash
npm run build
```
And the publish directory is the repository root (`./`). Ensure the build system is using the Node version specified in `.nvmrc`.

---
*Maintained by the Prodesk Core Web Team.*
