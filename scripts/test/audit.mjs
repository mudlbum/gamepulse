#!/usr/bin/env node
/**
 * Post-build audit: internal link integrity, per-page SEO tags, heading
 * structure, image alt text, accessible link names, WCAG AA contrast in BOTH
 * themes, and live interactivity checks on the tools and mobile nav.
 *
 * Usage:  npm run build && npx astro preview & sleep 5 && npm run audit
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.AUDIT_URL || 'http://localhost:4321';
const issues = [];
const ok = [];

// 1. Collect every built page
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}
const files = walk('dist');
const routes = files.map((f) => '/' + f.replace(/^dist\//, '').replace(/index\.html$/, '')).map((r) => r.replace(/\/$/, '') || '/');

// 2. Internal link integrity
const built = new Set(routes.map((r) => r.replace(/\/$/, '') || '/'));
const extraFiles = new Set(readdirSync('dist').filter((f) => !statSync(join('dist', f)).isDirectory()).map((f) => '/' + f));
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  const from = '/' + f.replace(/^dist\//, '').replace(/index\.html$/, '');
  if (from.includes('404')) continue; // error pages resolve via the host's 404 handler
  for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    let href = m[1].replace(/\/$/, '') || '/';
    if (href.startsWith('//')) continue;
    if (built.has(href) || extraFiles.has(href) || extraFiles.has(href + '.xml')) continue;
    if (/\.(png|svg|xml|txt|webmanifest|ico|json|jpg|css|js)$/.test(m[1])) continue;
    issues.push(`BROKEN LINK  ${from} -> ${m[1]}`);
  }
}
ok.push(`${routes.length} routes built, internal links checked`);

// 3. Per-page SEO + a11y
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });

const sample = routes.filter((r) => !r.includes('404'));
for (const r of sample) {
  const res = await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
  if (!res || res.status() >= 400) { issues.push(`HTTP ${res?.status()} at ${r}`); continue; }
  const d = await page.evaluate(() => {
    const h1 = document.querySelectorAll('h1');
    const imgs = [...document.querySelectorAll('img')];
    const links = [...document.querySelectorAll('a')];
    const heads = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => +h.tagName[1]);
    let skips = 0;
    for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) skips++;
    return {
      title: document.title,
      desc: document.querySelector('meta[name=description]')?.content || '',
      canonical: document.querySelector('link[rel=canonical]')?.href || '',
      hreflang: document.querySelectorAll('link[rel=alternate][hreflang]').length,
      jsonld: document.querySelectorAll('script[type="application/ld+json"]').length,
      h1: h1.length,
      h1text: h1[0]?.textContent?.trim().slice(0, 60) || '',
      lang: document.documentElement.lang,
      imgsNoAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
      emptyLinks: links.filter((a) => !a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img,svg')).length,
      extNoRel: links.filter((a) => a.target === '_blank' && !(a.rel || '').includes('noopener')).length,
      headingSkips: skips,
      ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
    };
  });
  if (d.h1 !== 1) issues.push(`H1 count ${d.h1} at ${r}`);
  if (!d.title || d.title.length > 70) issues.push(`title ${d.title.length} chars at ${r}: "${d.title.slice(0,60)}"`);
  if (!d.desc || d.desc.length < 70 || d.desc.length > 320) issues.push(`meta desc ${d.desc.length} chars at ${r}`);
  if (!d.canonical) issues.push(`no canonical at ${r}`);
  if (d.hreflang < 3) issues.push(`hreflang ${d.hreflang} at ${r}`);
  if (!d.jsonld) issues.push(`no JSON-LD at ${r}`);
  if (d.imgsNoAlt) issues.push(`${d.imgsNoAlt} img without alt at ${r}`);
  if (d.emptyLinks) issues.push(`${d.emptyLinks} link with no accessible name at ${r}`);
  if (d.extNoRel) issues.push(`${d.extNoRel} target=_blank without noopener at ${r}`);
  if (d.headingSkips) issues.push(`${d.headingSkips} heading-level skip at ${r}`);
  if (!d.ogImage) issues.push(`no og:image at ${r}`);
  const expectLang = r.startsWith('/ko') ? 'ko-KR' : 'en-US';
  if (d.lang !== expectLang) issues.push(`lang="${d.lang}" expected ${expectLang} at ${r}`);
}
ok.push(`${sample.length} pages audited for SEO + a11y`);

// 4. Contrast check on both themes
for (const theme of ['dark', 'light']) {
  await page.addInitScript((t) => { try { localStorage.setItem('gp-theme', t); } catch(e){} }, theme);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const low = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
        v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const parseable = (c) => {
      if (!/^rgba?\(/.test(c || '')) return false;           // color-mix()/oklab() — unreadable here
      const m = c.match(/rgba\([^)]*,\s*([\d.]+)\s*\)$/);
      return !m || Number(m[1]) >= 0.5;                       // a 78%-black scrim IS the background
    };
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        // Skip color-mix()/oklab() and translucent layers: they do not parse as
        // plain rgb and reading them as such yields nonsense luminance.
        if (parseable(bg)) return bg;
        n = n.parentElement;
      }
      const b = getComputedStyle(document.body).backgroundColor;
      return parseable(b) ? b : 'rgb(10,12,16)';
    };
    const out = [];
    for (const el of document.querySelectorAll('p,a,h1,h2,h3,span,td,th,li,button')) {
      const txt = el.textContent?.trim();
      if (!txt || txt.length < 3 || el.children.length) continue;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.5) continue;
      const size = parseFloat(s.fontSize);
      const l1 = lum(s.color), l2 = lum(bgOf(el));
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const need = (size >= 24 || (size >= 18.66 && +s.fontWeight >= 700)) ? 3 : 4.5;
      if (ratio < need) out.push({ t: txt.slice(0, 32), ratio: +ratio.toFixed(2), need, size: Math.round(size) });
    }
    return out.slice(0, 8);
  });
  for (const l of low) issues.push(`CONTRAST ${theme}: ${l.ratio}:1 (need ${l.need}) "${l.t}" ${l.size}px`);
  ok.push(`contrast checked (${theme})`);
}

// 5. Theme toggle + interactivity
await page.goto(BASE + '/tools', { waitUntil: 'networkidle' });
const before = await page.getAttribute('html', 'data-theme');
await page.click('#theme-toggle');
await page.waitForTimeout(300);
const after = await page.getAttribute('html', 'data-theme');
if (before === after) issues.push('theme toggle did not change data-theme');
else ok.push(`theme toggle works (${before} -> ${after})`);

await page.fill('#sens-value', '2.5');
await page.waitForTimeout(200);
const conv = await page.textContent('#sens-out');
if (!conv || conv === '—') issues.push('sensitivity converter did not recompute');
else ok.push(`sensitivity converter recomputes (${conv})`);

await page.fill('#pity-current', '75');
await page.waitForTimeout(200);
const pity = await page.textContent('#pity-any');
if (!pity || pity === '—') issues.push('pity calculator did not recompute');
else ok.push(`pity calculator recomputes at soft pity (${pity})`);

// 6. Mobile nav
const m = await b.newPage({ viewport: { width: 390, height: 800 } });
await m.goto(BASE + '/', { waitUntil: 'networkidle' });
await m.click('#burger');
await m.waitForTimeout(250);
const navVisible = await m.isVisible('#mobile-nav');
if (!navVisible) issues.push('mobile nav did not open');
else ok.push('mobile nav opens');
await m.close();

if (errors.length) for (const e of [...new Set(errors)].slice(0, 6)) issues.push(`JS ERROR: ${e}`);
else ok.push('no JS errors on any page');

await b.close();

console.log('\n=== PASSED ===');
for (const o of ok) console.log('  ✓ ' + o);
console.log(`\n=== ISSUES (${issues.length}) ===`);
const grouped = {};
for (const i of issues) { const k = i.split(' at ')[0].replace(/\d+/g, 'N'); grouped[k] = (grouped[k]||0)+1; }
for (const i of [...new Set(issues)].slice(0, 40)) console.log('  ✗ ' + i);
if (issues.length > 40) console.log(`  … and ${issues.length - 40} more`);
