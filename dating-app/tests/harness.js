'use strict';
// Shared test harness for the Maktub prototype regression suite.
// Drives the single-file app (../index.html) in phone-emulated Chromium.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

function chromiumPath() {
  if (process.env.MAKTUB_CHROMIUM) return process.env.MAKTUB_CHROMIUM;
  const preinstalled = '/opt/pw-browsers/chromium'; // Claude Code remote env
  try { fs.accessSync(preinstalled); return preinstalled; } catch (e) { return undefined; }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Fresh app with cleared storage, landed on the welcome screen.
async function freshApp(page) {
  await page.goto(APP_URL);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  await page.waitForSelector('#screen-welcome.active');
}

// Walk signup + profile setup; ends on the discover deck.
async function signUp(page, opts = {}) {
  const o = Object.assign({
    name: 'Sam', age: '27', email: 'sam@example.com', password: 'hunter22',
    bio: 'Test-run bio.', interests: ['Coffee', 'Live music', 'Hiking'],
  }, opts);
  await page.click('#btn-goto-signup');
  await page.fill('#su-name', o.name);
  await page.fill('#su-age', o.age);
  await page.fill('#su-email', o.email);
  await page.fill('#su-password', o.password);
  await page.click('#form-signup button[type=submit]');
  await page.waitForSelector('#screen-setup.active');
  await page.fill('#set-bio', o.bio);
  for (const t of o.interests) {
    await page.click(`#setup-interests .chip:has-text("${t}")`);
  }
  await page.click('#form-setup button[type=submit]');
  await page.waitForSelector('#screen-app.active');
}

// Drag the top deck card left ("pass") or right ("like") with pointer events.
async function dragCard(page, dir) {
  const sign = dir === 'like' ? 1 : -1;
  const box = await page.locator('.deck-card >> nth=-1').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + sign * i * 22, cy - i * 3);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

function topCardId(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.deck-card:last-child');
    return c ? c.dataset.id : null;
  });
}

function storedState(page) {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('maktub-proto-v1')); }
    catch (e) { return null; }
  });
}

// suite(name, async ({ page, test, ... }) => { ... })
// Fail-fast: the first failing test aborts the suite (later steps depend on
// earlier state, so cascading failures would only add noise).
function suite(name, body) {
  (async () => {
    const browser = await chromium.launch({ executablePath: chromiumPath() });
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      ignoreHTTPSErrors: true, // remote-env proxy CA; harmless elsewhere
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {
      // resource failures are environment noise (fonts/CDN offline); JS errors are not
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
        errors.push('console: ' + m.text());
      }
    });

    let passed = 0, failed = 0;
    console.log(name);
    const test = async (label, fn) => {
      try {
        await fn();
        passed++;
        console.log('  ok   ' + label);
      } catch (e) {
        failed++;
        console.log('  FAIL ' + label + ' — ' + e.message.split('\n')[0]);
        throw e;
      }
    };

    try {
      await body({ browser, ctx, page, test });
    } catch (e) {
      if (!failed) { failed++; console.log('  SUITE ERROR: ' + e.message.split('\n')[0]); }
    }
    if (errors.length) {
      failed++;
      console.log('  page errors:');
      errors.forEach(x => console.log('    ' + x));
    }
    await browser.close();
    console.log(`  ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { APP_URL, suite, assert, freshApp, signUp, dragCard, topCardId, storedState };
