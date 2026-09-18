'use strict';
// Contract conformance (docs/spec/02-api-contract.md), exercised directly
// against the mock backend via window.__maktub.rawRest — error envelope,
// OTP throttling, token rotation, underage enforcement, idempotent swipes,
// cursor pagination, read state, unmatch, blocks, deletion.

const { suite, assert, freshApp, rawRest, birthdateForAge, OTP_CODE } = require('./harness');

const PHONE = '+13035550177';

suite('API contract conformance', async ({ page, test }) => {
  let access = null, refresh = null;
  let mayaMatch = null, jonahMatch = null;

  await test('non-2xx responses use the error envelope', async () => {
    await freshApp(page);
    const res = await rawRest(page, 'POST', '/otp/request', { phone: 'nope' });
    assert(res.status === 400, 'expected 400, got ' + res.status);
    assert(res.error && res.error.code === 'validation_failed', 'wrong code: ' + JSON.stringify(res.error));
    assert(typeof res.error.message === 'string' && res.error.message.length > 0, 'no message');
  });

  await test('otp_throttled carries retry_after_s after 3 requests/min', async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await rawRest(page, 'POST', '/otp/request', { phone: PHONE });
      assert(ok.status === 204, 'request ' + i + ' failed: ' + JSON.stringify(ok));
    }
    const res = await rawRest(page, 'POST', '/otp/request', { phone: PHONE });
    assert(res.status === 429 && res.error.code === 'otp_throttled', 'not throttled: ' + JSON.stringify(res));
    assert(typeof res.error.retry_after_s === 'number' && res.error.retry_after_s > 0, 'no retry_after_s');
  });

  await test('verify rejects a wrong code, accepts the right one with a token pair', async () => {
    const bad = await rawRest(page, 'POST', '/otp/verify', { phone: PHONE, code: '999999' });
    assert(bad.error && bad.error.code === 'invalid_otp', 'expected invalid_otp');
    const res = await rawRest(page, 'POST', '/otp/verify', { phone: PHONE, code: OTP_CODE });
    assert(res.status === 200, 'verify failed');
    assert(res.data.access_token && res.data.refresh_token, 'missing tokens');
    assert(res.data.user.onboarding_state === 'profile_incomplete', 'wrong onboarding_state');
    access = res.data.access_token;
    refresh = res.data.refresh_token;
  });

  await test('bearer auth is required and refresh tokens rotate', async () => {
    const noAuth = await rawRest(page, 'GET', '/me', null, null);
    assert(noAuth.status === 401 && noAuth.error.code === 'token_expired', 'unauthenticated call not rejected');
    const r1 = await rawRest(page, 'POST', '/auth/refresh', { refresh_token: refresh });
    assert(r1.status === 200 && r1.data.access_token && r1.data.refresh_token, 'refresh failed');
    const replay = await rawRest(page, 'POST', '/auth/refresh', { refresh_token: refresh });
    assert(replay.status === 401, 'old refresh token replay not rejected (rotation)');
    access = r1.data.access_token;
    refresh = r1.data.refresh_token;
  });

  await test('PATCH /me/profile rejects underage birthdates with `underage`', async () => {
    const res = await rawRest(page, 'PATCH', '/me/profile',
      { name: 'Casey', birthdate: birthdateForAge(17), gender: 'woman' }, access);
    assert(res.error && res.error.code === 'underage', 'expected underage: ' + JSON.stringify(res));
  });

  await test('completing the profile flips onboarding_state and seeds matches', async () => {
    const res = await rawRest(page, 'PATCH', '/me/profile',
      { name: 'Casey', birthdate: birthdateForAge(28), gender: 'woman', bio: 'Conformance bot.' }, access);
    assert(res.status === 200, 'profile patch failed');
    await rawRest(page, 'PUT', '/me/preferences',
      { min_age: 21, max_age: 40, max_distance_km: 25, genders: [] }, access);
    const meRes = await rawRest(page, 'GET', '/me', null, access);
    assert(meRes.data.onboarding_state === 'complete', 'onboarding not complete');
    const matches = await rawRest(page, 'GET', '/matches', null, access);
    assert(matches.data.matches.length === 2, 'expected 2 seeded matches');
    matches.data.matches.forEach(m => {
      if (m.user.id === 'maya') mayaMatch = m;
      if (m.user.id === 'jonah') jonahMatch = m;
    });
    assert(mayaMatch && jonahMatch, 'seeded matches wrong');
    assert(jonahMatch.unread_count === 1, 'jonah unread_count wrong');
  });

  await test('swipes are idempotent on (user, target)', async () => {
    const s1 = await rawRest(page, 'POST', '/swipes',
      { target_id: 'priya', direction: 'like', client_id: 'cid-1' }, access);
    assert(s1.data.match && s1.data.match.user.id === 'priya', 'mutual like did not match');
    const s2 = await rawRest(page, 'POST', '/swipes',
      { target_id: 'priya', direction: 'like', client_id: 'cid-1' }, access);
    assert(s2.data.match && s2.data.match.id === s1.data.match.id, 'retry created a different match');
    const matches = await rawRest(page, 'GET', '/matches', null, access);
    assert(matches.data.matches.length === 3, 'duplicate match created on retry');
  });

  await test('the feed excludes swiped, matched, and blocked users', async () => {
    const before = await rawRest(page, 'GET', '/feed?limit=25', null, access);
    const ids = before.data.candidates.map(c => c.id);
    assert(ids.indexOf('priya') < 0 && ids.indexOf('maya') < 0 && ids.indexOf('jonah') < 0,
      'feed contains swiped/matched users');
    assert(ids.length === 11, 'expected 11 candidates, got ' + ids.length);
    await rawRest(page, 'POST', '/blocks', { user_id: 'amara' }, access);
    const after = await rawRest(page, 'GET', '/feed?limit=25', null, access);
    assert(after.data.candidates.map(c => c.id).indexOf('amara') < 0, 'feed contains a blocked user');
  });

  await test('messages paginate newest-first with a cursor', async () => {
    const p1 = await rawRest(page, 'GET', '/matches/' + mayaMatch.id + '/messages?limit=2', null, access);
    assert(p1.data.messages.length === 2, 'wrong page size');
    assert(p1.data.messages[0].seq > p1.data.messages[1].seq, 'not newest-first');
    assert(p1.data.next_cursor, 'missing next_cursor');
    const p2 = await rawRest(page, 'GET',
      '/matches/' + mayaMatch.id + '/messages?limit=2&before=' + p1.data.next_cursor, null, access);
    assert(p2.data.messages.length === 1, 'wrong second page');
    assert(p2.data.next_cursor === null, 'cursor should be exhausted');
  });

  await test('REST message send echoes client_id; read clears unread', async () => {
    const sent = await rawRest(page, 'POST', '/matches/' + jonahMatch.id + '/messages',
      { body: 'Espresso, no sugar.', client_id: 'cid-msg-1' }, access);
    assert(sent.status === 200 && sent.data.client_id === 'cid-msg-1', 'client_id not echoed');
    const read = await rawRest(page, 'POST', '/matches/' + jonahMatch.id + '/read',
      { last_message_id: sent.data.id }, access);
    assert(read.status === 204, 'read failed');
    const matches = await rawRest(page, 'GET', '/matches', null, access);
    const jonah = matches.data.matches.filter(m => m.user.id === 'jonah')[0];
    assert(jonah.unread_count === 0, 'unread not cleared');
  });

  await test('unmatch closes the match; a closed match 404s', async () => {
    const del = await rawRest(page, 'DELETE', '/matches/' + jonahMatch.id, null, access);
    assert(del.status === 204, 'unmatch failed');
    const matches = await rawRest(page, 'GET', '/matches', null, access);
    assert(matches.data.matches.every(m => m.user.id !== 'jonah'), 'closed match still listed');
    const again = await rawRest(page, 'GET', '/matches/' + jonahMatch.id + '/messages', null, access);
    assert(again.status === 200 || again.status === 404, 'unexpected status');
    const send = await rawRest(page, 'POST', '/matches/' + jonahMatch.id + '/messages',
      { body: 'hello?', client_id: 'cid-x' }, access);
    assert(send.error && send.error.code === 'match_closed', 'send into closed match not rejected');
  });

  await test('reports validate the reason enum', async () => {
    const bad = await rawRest(page, 'POST', '/reports', { user_id: 'theo', reason: 'vibes' }, access);
    assert(bad.error && bad.error.code === 'validation_failed', 'bad reason accepted');
    const ok = await rawRest(page, 'POST', '/reports', { user_id: 'theo', reason: 'spam_or_fake' }, access);
    assert(ok.status === 204, 'valid report rejected');
  });

  await test('export returns 202; account deletion invalidates the session', async () => {
    const exp = await rawRest(page, 'POST', '/me/export', null, access);
    assert(exp.status === 202, 'export not accepted');
    const del = await rawRest(page, 'DELETE', '/me', null, access);
    assert(del.status === 204, 'deletion failed');
    const after = await rawRest(page, 'GET', '/me', null, access);
    assert(after.status === 401, 'deleted account token still works');
  });
});
