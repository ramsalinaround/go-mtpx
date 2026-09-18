'use strict';
// Feature: discovery preferences (contract 02 — PUT /me/preferences with
// min_age/max_age/max_distance_km/genders; interests are a prototype extension).
// Guards: each filter narrows GET /feed correctly, the empty state, and reset.
//
// Candidate pool ground truth (excluding seeded matches maya/jonah):
//   priya W 27/3km, theo M 29/5, amara W 25/8, luca M 31/2, noor W 26/12,
//   felix M 28/6, ivy W 24/9, mateo M 30/4, sasha W 27/15, wren W 26/7,
//   daniel M 33/10, zoe W 25/5

const { suite, assert, freshApp, signUp } = require('./harness');

async function applyAndCount(page) {
  await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
  await page.click('#btn-apply-filters');
  const toast = await page.waitForSelector('#toast.show');
  return toast.textContent();
}

suite('Discovery filters', async ({ page, test }) => {

  await test('default filters admit the full 12-person pool', async () => {
    await freshApp(page);
    await signUp(page);
    await page.click('#btn-filters');
    await page.waitForSelector('#filter-backdrop.open');
    assert(/12 people/.test(await applyAndCount(page)), 'expected 12 with defaults');
  });

  await test('max age 26 narrows to the 5 matching candidates', async () => {
    await page.click('#btn-filters');
    await page.locator('#f-age-max').fill('26');
    // amara 25, noor 26, ivy 24, wren 26, zoe 25
    assert(/5 people/.test(await applyAndCount(page)), 'age filter wrong');
  });

  await test('distance 5 km narrows to the 5 nearby candidates', async () => {
    await page.click('#btn-filters');
    await page.click('#btn-reset-filters');
    await page.waitForTimeout(300);
    await page.locator('#f-dist').fill('5');
    // priya 3, theo 5, luca 2, mateo 4, zoe 5
    assert(/5 people/.test(await applyAndCount(page)), 'distance filter wrong');
  });

  await test('gender preference narrows the feed', async () => {
    await page.click('#btn-filters');
    await page.click('#btn-reset-filters');
    await page.waitForTimeout(300);
    // all three genders start selected; keep only Men
    await page.click('#f-genders .chip:has-text("Women")');
    await page.click('#f-genders .chip:has-text("Non-binary")');
    // theo, luca, felix, mateo, daniel
    assert(/5 people/.test(await applyAndCount(page)), 'gender filter wrong');
  });

  await test('shared-interest filter narrows to Art profiles', async () => {
    await page.click('#btn-filters');
    await page.click('#btn-reset-filters');
    await page.waitForTimeout(300);
    await page.click('#f-interests .chip:has-text("Art")');
    // priya, ivy, wren
    assert(/3 people/.test(await applyAndCount(page)), 'interest filter wrong');
  });

  await test('impossible filters show the empty state with a widen hint', async () => {
    await page.click('#btn-filters');
    await page.click('#btn-reset-filters');
    await page.waitForTimeout(300);
    await page.locator('#f-dist').fill('1');
    assert(/No one matches/.test(await applyAndCount(page)), 'no empty-toast');
    await page.waitForSelector('.deck-empty');
  });

  await test('reset restores defaults and the full deck', async () => {
    await page.click('.deck-empty button:has-text("Adjust filters")');
    await page.waitForSelector('#filter-backdrop.open');
    await page.click('#btn-reset-filters');
    await page.waitForTimeout(300);
    assert((await page.inputValue('#f-age-min')) === '21', 'age min not reset');
    assert((await page.inputValue('#f-age-max')) === '40', 'age max not reset');
    assert((await page.inputValue('#f-dist')) === '25', 'distance not reset');
    assert(/12 people/.test(await applyAndCount(page)), 'deck not restored');
  });
});
