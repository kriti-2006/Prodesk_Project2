import fs from 'node:fs';
import path from 'node:path';

const files = [
  'js/services/EventBus.js',
  'js/core/dom.js',
  'js/core/Component.js',
  'js/services/StorageService.js',
  'js/services/ContentService.js',
  'js/state/schema.js',
  'js/state/StateManager.js',
  'js/components/Navigation.js',
  'js/components/ThemeToggle.js',
  'js/components/HeroSection.js',
  'js/components/FeatureCards.js',
  'js/components/StatCounters.js',
  'js/components/TestimonialCards.js',
  'js/components/PricingCards.js',
  'js/components/FaqAccordion.js',
  'js/components/ContactForm.js',
  'js/components/FooterSection.js',
  'js/app.js'
];

let bundleContent = '(function() {\n"use strict";\n\n';

for (const relPath of files) {
  const fullPath = path.resolve(relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${relPath}`);
    process.exit(1);
  }
  let code = fs.readFileSync(fullPath, 'utf8');

  // Strip import statements
  code = code.replace(/^\s*import\s+[^;]+;\s*$/gm, '');

  // Strip export keywords
  code = code.replace(/^export\s+default\s+/gm, '');
  code = code.replace(/^export\s+(class|const|let|var|function)\s+/gm, '$1 ');

  bundleContent += `// ===== ${relPath} =====\n` + code.trim() + '\n\n';
}

bundleContent += '})();\n';

fs.writeFileSync('bundle.js', bundleContent, 'utf8');
console.log('Successfully bundled to bundle.js (' + Buffer.byteLength(bundleContent) + ' bytes)');
