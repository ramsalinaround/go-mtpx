'use strict';
// Feature: the reference Go backend (dating-app/server) + the client's remote
// transport. Builds and starts the real server, checks contract conformance
// over real HTTP, then drives the served client end to end over a real
// WebSocket (signup -> deck -> match -> chat round trip with receipts).

const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');
const { assert, birthdateForAge, OTP_CODE } = require('./harness');

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = path.resolve(__dirname, '..', 'server');

function chromiumPath() {
  if (process.env.MAKTUB_CHROMIUM) return process.env.MAKTUB_CHROMIUM;
  const preinstalled = '/opt/pw-browsers/chromium';
  try { fs.accessSync(preinstalled); return preinstalled; } catch (e) { return undefined; }
}

async function rest(method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + '/v1' + p, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  return { status: res.status, data, error: data && data.error };
}

(async () => {
  let passed = 0, failed = 0, server = null, browser = null;
  const test = async (label, fn) => {
    try { await fn(); passed++; console.log('  ok   ' + label); }
    catch (e) { failed++; console.log('  FAIL ' + label + ' — ' + e.message.split('\n')[0]); throw e; }
  };
  console.log('Reference Go server (real HTTP + WS)');

  try {
    // build once, run the binary (fast + easy to kill)
    const bin = path.join(os.tmpdir(), 'maktub-server-test');
    execSync(`go build -o ${bin} .`, { cwd: SERVER_DIR, stdio: 'pipe' });
    server = spawn(bin, ['-addr', `:${PORT}`, '-static', path.resolve(__dirname, '..')],
      { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch(BASE + '/v1/healthz')).ok; }
      catch (e) { await new Promise(r => setTimeout(r, 200)); }
    }
    if (!up) throw new Error('server did not come up');

    /* ---------- contract conformance over real HTTP ---------- */

    let access = null, refresh = null, jonahMatch = null;
    const PHONE = '+13039990177';

    await test('healthz + error envelope over real HTTP', async () => {
      const bad = await rest('POST', '/otp/request', { phone: 'nope' });
      assert(bad.status === 400 && bad.error.code === 'validation_failed', 'envelope wrong: ' + JSON.stringify(bad));
    });

    await test('OTP throttling with retry_after_s', async () => {
      for (let i = 0; i < 3; i++) {
        assert((await rest('POST', '/otp/request', { phone: PHONE })).status === 204, 'request failed');
      }
      const res = await rest('POST', '/otp/request', { phone: PHONE });
      assert(res.status === 429 && res.error.code === 'otp_throttled' && res.error.retry_after_s > 0,
        'not throttled: ' + JSON.stringify(res));
    });

    await test('verify, refresh rotation, underage, onboarding + seeds', async () => {
      const v = await rest('POST', '/otp/verify', { phone: PHONE, code: OTP_CODE });
      assert(v.status === 200 && v.data.user.onboarding_state === 'profile_incomplete', 'verify wrong');
      access = v.data.access_token; refresh = v.data.refresh_token;
      const r1 = await rest('POST', '/auth/refresh', { refresh_token: refresh });
      assert(r1.status === 200, 'refresh failed');
      assert((await rest('POST', '/auth/refresh', { refresh_token: refresh })).status === 401,
        'refresh token not rotating');
      access = r1.data.access_token; refresh = r1.data.refresh_token;
      const young = await rest('PATCH', '/me/profile',
        { name: 'Casey', birthdate: birthdateForAge(17), gender: 'woman' }, access);
      assert(young.error && young.error.code === 'underage', 'underage not enforced');
      const ok = await rest('PATCH', '/me/profile',
        { name: 'Casey', birthdate: birthdateForAge(28), gender: 'woman', bio: 'Server bot.' }, access);
      assert(ok.status === 200, 'profile patch failed');
      const matches = await rest('GET', '/matches', undefined, access);
      assert(matches.data.matches.length === 2, 'expected 2 seeded matches');
      jonahMatch = matches.data.matches.filter(m => m.user.id === 'jonah')[0];
      assert(jonahMatch && jonahMatch.unread_count === 1, 'jonah seed wrong');
    });

    await test('idempotent swipes and feed exclusions', async () => {
      const s1 = await rest('POST', '/swipes', { target_id: 'priya', direction: 'like', client_id: 'c1' }, access);
      assert(s1.data.match && s1.data.match.user.id === 'priya', 'no match on mutual like');
      const s2 = await rest('POST', '/swipes', { target_id: 'priya', direction: 'like', client_id: 'c1' }, access);
      assert(s2.data.match.id === s1.data.match.id, 'retry made a new match');
      const feed = await rest('GET', '/feed?limit=25', undefined, access);
      const ids = feed.data.candidates.map(c => c.id);
      assert(ids.length === 11 && !ids.includes('priya') && !ids.includes('maya'), 'feed exclusions wrong');
      // pool candidates only serialize approved photos
      const theo = feed.data.candidates.filter(c => c.id === 'theo')[0];
      assert(theo.photos.length === 0, 'pending photo leaked in feed');
    });

    await test('message pagination, REST send echo, read state', async () => {
      const mayaMatch = (await rest('GET', '/matches', undefined, access))
        .data.matches.filter(m => m.user.id === 'maya')[0];
      const p1 = await rest('GET', `/matches/${mayaMatch.id}/messages?limit=2`, undefined, access);
      assert(p1.data.messages.length === 2 && p1.data.next_cursor, 'page 1 wrong');
      assert(p1.data.messages[0].seq > p1.data.messages[1].seq, 'not newest-first');
      const p2 = await rest('GET',
        `/matches/${mayaMatch.id}/messages?limit=2&before=${p1.data.next_cursor}`, undefined, access);
      assert(p2.data.messages.length === 1 && p2.data.next_cursor === null, 'page 2 wrong');
      const sent = await rest('POST', `/matches/${jonahMatch.id}/messages`,
        { body: 'Espresso.', client_id: 'cm1' }, access);
      assert(sent.data.client_id === 'cm1', 'client_id not echoed');
      await rest('POST', `/matches/${jonahMatch.id}/read`, { last_message_id: sent.data.id }, access);
      const jm = (await rest('GET', '/matches', undefined, access))
        .data.matches.filter(m => m.user.id === 'jonah')[0];
      assert(jm.unread_count === 0, 'unread not cleared');
    });

    await test('photos: presign -> PUT -> confirm -> moderation', async () => {
      const pre = await rest('POST', '/me/photos/presign', { content_type: 'image/jpeg' }, access);
      assert(pre.data.upload_url && pre.data.key, 'presign wrong');
      const put = await fetch(BASE + pre.data.upload_url, { method: 'PUT', body: 'sunset' });
      assert(put.status === 200, 'upload failed');
      const conf = await rest('POST', '/me/photos/confirm', { key: pre.data.key }, access);
      assert(conf.data.moderation_status === 'pending', 'confirm not pending');
      await new Promise(r => setTimeout(r, 3200));
      const me = await rest('GET', '/me', undefined, access);
      assert(me.data.photos[0].moderation_status === 'approved', 'moderation did not approve');
    });

    await test('unmatch, blocks, reports, export, deletion', async () => {
      assert((await rest('DELETE', `/matches/${jonahMatch.id}`, undefined, access)).status === 204, 'unmatch failed');
      const closed = await rest('POST', `/matches/${jonahMatch.id}/messages`, { body: 'x', client_id: 'c9' }, access);
      assert(closed.error && closed.error.code === 'match_closed', 'closed match accepted a message');
      assert((await rest('POST', '/blocks', { user_id: 'amara' }, access)).status === 204, 'block failed');
      const feed = await rest('GET', '/feed?limit=25', undefined, access);
      assert(!feed.data.candidates.some(c => c.id === 'amara'), 'blocked user in feed');
      assert((await rest('POST', '/reports', { user_id: 'theo', reason: 'vibes' }, access)).status === 400, 'bad reason accepted');
      assert((await rest('POST', '/reports', { user_id: 'theo', reason: 'spam_or_fake' }, access)).status === 204, 'report failed');
      assert((await rest('POST', '/me/export', undefined, access)).status === 202, 'export not 202');
      assert((await rest('DELETE', '/me', undefined, access)).status === 204, 'deletion failed');
      assert((await rest('GET', '/me', undefined, access)).status === 401, 'deleted token still valid');
    });

    /* ---------- served client over the real transport ---------- */

    browser = await chromium.launch({ executablePath: chromiumPath() });
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await test('served client detects the remote transport', async () => {
      await page.goto(BASE + '/');
      await page.waitForFunction(() => document.documentElement.dataset.transport === 'remote',
        null, { timeout: 5000 });
    });

    await test('full signup through the real API', async () => {
      await page.click('#btn-get-started');
      await page.fill('#ph-number', '+13039990178');
      await page.click('#btn-send-code');
      await page.waitForSelector('#screen-otp.active');
      await page.fill('#otp-code', OTP_CODE);
      await page.click('#form-otp button[type=submit]');
      await page.waitForSelector('#screen-setup.active');
      await page.fill('#set-name', 'Remy');
      await page.fill('#set-birthdate', birthdateForAge(26));
      await page.fill('#set-bio', 'Talking to a real Go server.');
      for (const t of ['Coffee', 'Film', 'Hiking']) {
        await page.click(`#setup-interests .chip:has-text("${t}")`);
      }
      await page.click('#form-setup button[type=submit]');
      await page.waitForSelector('#screen-app.active');
      await page.waitForSelector('.deck-card');
    });

    await test('swipe -> match modal against the real API', async () => {
      await page.click('#btn-like'); // Priya, mutual like
      await page.waitForSelector('#match-overlay.open', { timeout: 5000 });
      await page.click('#btn-say-hi');
      await page.waitForSelector('#screen-chat.active');
    });

    await test('chat round trip over the real WebSocket', async () => {
      await page.fill('#chat-input', 'Hello from the remote transport!');
      await page.click('#chat-send');
      await page.waitForFunction(() => document.querySelectorAll('.bubble.me').length === 1,
        null, { timeout: 5000 });
      // bot reply arrives as a message.new frame over the socket
      await page.waitForFunction(() => document.querySelectorAll('.bubble.them:not(.typing)').length >= 1,
        null, { timeout: 8000 });
      // and its message.read frame produces a receipt
      await page.waitForSelector('.bubble.me .receipt', { timeout: 5000 });
    });

    await test('session + data survive reload against the server', async () => {
      await page.reload();
      await page.waitForSelector('#screen-app.active');
      await page.click('#tab-btn-matches');
      await page.waitForSelector('.match-row:has-text("Priya")');
    });

    await test('no page errors during the remote run', async () => {
      assert(pageErrors.length === 0, 'page errors: ' + pageErrors.join(' | '));
    });
  } catch (e) {
    if (!failed) { failed++; console.log('  SUITE ERROR: ' + e.message.split('\n')[0]); }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill('SIGKILL');
  }
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
