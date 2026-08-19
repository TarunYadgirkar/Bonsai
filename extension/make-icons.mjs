// Render the Bonsai extension icons from an inline SVG via Playwright chromium.
import { chromium } from 'playwright';

const svg = (size) => `<!doctype html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#f5f1e8"/>
  <!-- trunk -->
  <path d="M62 108 C60 88 58 78 50 66 C60 70 66 78 68 86 C70 74 76 62 88 54 C80 68 76 80 74 92 C73 98 72 104 72 108 Z"
        fill="#5a4632"/>
  <!-- canopy pads -->
  <ellipse cx="44" cy="52" rx="22" ry="14" fill="#4d7c54"/>
  <ellipse cx="88" cy="40" rx="24" ry="15" fill="#3f6b46"/>
  <ellipse cx="64" cy="28" rx="20" ry="12" fill="#568a5e"/>
  <!-- pot -->
  <path d="M38 108 L90 108 L84 122 L44 122 Z" fill="#8a4a32"/>
  <rect x="34" y="104" width="60" height="7" rx="3.5" fill="#a05a3c"/>
</svg></body>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(svg(size));
  await page.screenshot({
    path: `extension/icons/icon${size}.png`,
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: true,
  });
  console.log(`icon${size}.png`);
}
await browser.close();
