'use strict';
// Shared test harness for the Maktub prototype regression suite.
// Drives the single-file app (../index.html) in phone-emulated Chromium.
// The app speaks to an in-page mock backend implementing
// docs/spec/02-api-contract.md; window.__maktub exposes test hooks.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OTP_CODE = '123456';
const DEFAULT_PHONE = '+13035550101';

function chromiumPath() {
  if (process.env.MAKTUB_CHROMIUM) return process.env.MAKTUB_CHROMIUM;
  const preinstalled = '/opt/pw-browsers/chromium'; // Claude Code remote env
  try { fs.accessSync(preinstalled); return preinstalled; } catch (e) { return undefined; }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function birthdateForAge(age) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 40); // safely past this year's birthday
  return d.toISOString().slice(0, 10);
}

// Fresh app with cleared storage (mock-backend DB included), on the welcome screen.
async function freshApp(page) {
  await page.goto(APP_URL);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  await page.waitForSelector('#screen-welcome.active');
}

// Walk phone -> OTP -> profile setup; ends on the discover deck.
async function signUp(page, opts = {}) {
  const o = Object.assign({
    name: 'Sam', age: 27, phone: DEFAULT_PHONE, bio: 'Test-run bio.',
    gender: 'nonbinary', showMe: 'everyone',
    interests: ['Coffee', 'Live music', 'Hiking'],
  }, opts);
  await page.click('#btn-get-started');
  await page.fill('#ph-number', o.phone);
  await page.click('#btn-send-code');
  await page.waitForSelector('#screen-otp.active');
  await page.fill('#otp-code', OTP_CODE);
  await page.click('#form-otp button[type=submit]');
  await page.waitForSelector('#screen-setup.active');
  await page.fill('#set-name', o.name);
  await page.fill('#set-birthdate', birthdateForAge(o.age));
  await page.selectOption('#set-gender', o.gender);
  await page.selectOption('#set-pref', o.showMe);
  await page.fill('#set-bio', o.bio);
  for (const t of o.interests) {
    await page.click(`#setup-interests .chip:has-text("${t}")`);
  }
  await page.click('#form-setup button[type=submit]');
  await page.waitForSelector('#screen-app.active');
  await page.waitForSelector('.deck-card, .deck-empty');
}

// Log in an existing account (onboarding already complete).
async function logIn(page, phone = DEFAULT_PHONE) {
  await page.click('#btn-get-started');
  await page.fill('#ph-number', phone);
  await page.click('#btn-send-code');
  await page.waitForSelector('#screen-otp.active');
  await page.fill('#otp-code', OTP_CODE);
  await page.click('#form-otp button[type=submit]');
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

// Test-facing view of the account state, served by the mock backend.
function storedState(page) {
  return page.evaluate(() => window.__maktub.snapshot());
}

// Raw API access for contract-conformance tests: returns {status, data|error}.
function rawRest(page, method, path, body, token) {
  return page.evaluate(
    args => window.__maktub.rawRest(args[0], args[1], args[2], args[3]),
    [method, path, body === undefined ? null : body, token === undefined ? null : token]
  );
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

module.exports = { APP_URL, OTP_CODE, DEFAULT_PHONE, suite, assert, freshApp, signUp,
  logIn, dragCard, topCardId, storedState, rawRest, birthdateForAge };
