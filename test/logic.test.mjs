// Runs on node:22-alpine with no dependencies:
//   docker compose run --rm test
// Covers the type chart, the dataset, and the question generator. The DOM
// layer is checked only for wiring (every id app.js looks up exists in the
// HTML), which is the failure that silently produces a blank screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';

const APP = new URL('../app/', import.meta.url);

// data.js fetches a relative URL; serve it off disk so the module works here.
globalThis.fetch = async (path) => {
  const body = await readFile(new URL(path, APP), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};

const { TYPES, against, multiplier, verdictOf, formatMultiplier } = await import('../app/js/types.js');
const { loadPokemon, pool, pickFresh } = await import('../app/js/data.js');
const { nextQuestion, sameTypes, MODES } = await import('../app/js/quiz.js');

const all = await loadPokemon();

/* ------------------------------------------------------------- type chart */

test('single-type matchups match the published chart', () => {
  assert.equal(against('fire', 'grass'), 2);
  assert.equal(against('fire', 'water'), 0.5);
  assert.equal(against('fire', 'normal'), 1);
  assert.equal(against('ground', 'flying'), 0);
  assert.equal(against('ghost', 'normal'), 0);
  assert.equal(against('normal', 'ghost'), 0);
  assert.equal(against('dragon', 'fairy'), 0);
  assert.equal(against('psychic', 'dark'), 0);
  assert.equal(against('fighting', 'ghost'), 0);
  assert.equal(against('poison', 'steel'), 0);
  assert.equal(against('electric', 'ground'), 0);
});

test('every attacking type has a row and the chart is 18x18', () => {
  assert.equal(TYPES.length, 18);
  for (const a of TYPES) {
    for (const d of TYPES) assert.equal(typeof against(a, d), 'number', `${a}->${d}`);
  }
});

test('dual types multiply, including to 4x and 0.25x', () => {
  assert.equal(multiplier('ice', ['dragon', 'flying']), 4);       // Dragonite
  assert.equal(multiplier('rock', ['fire', 'flying']), 4);        // Charizard
  assert.equal(multiplier('grass', ['fire', 'flying']), 0.25);    // Charizard
  assert.equal(multiplier('fighting', ['psychic', 'fairy']), 0.25);
  assert.equal(multiplier('normal', ['grass', 'poison']), 1);     // Bulbasaur
});

test('an immunity beats any amount of weakness', () => {
  // Gliscor is Ground/Flying: Ice is 2x on Ground but Flying is immune to Ground,
  // not to Ice - so check a real zero instead.
  assert.equal(multiplier('electric', ['ground', 'flying']), 0);  // Gliscor
  assert.equal(multiplier('ground', ['rock', 'flying']), 0);      // Aerodactyl
  assert.equal(multiplier('fighting', ['ghost', 'dark']), 0);     // Spiritomb
});

test('verdicts and formatting', () => {
  assert.equal(verdictOf(0), 'immune');
  assert.equal(verdictOf(0.25), 'resisted');
  assert.equal(verdictOf(0.5), 'resisted');
  assert.equal(verdictOf(1), 'neutral');
  assert.equal(verdictOf(2), 'super');
  assert.equal(verdictOf(4), 'super');
  assert.equal(formatMultiplier(0.25), '0.25×');
  assert.equal(formatMultiplier(1), '1×');
  assert.equal(formatMultiplier(4), '4×');
});

/* ----------------------------------------------------------------- dataset */

test('the dataset is the 1025 default forms of gens I-IX', () => {
  assert.equal(all.length, 1025);
  assert.deepEqual(all.map((p) => p.id), Array.from({ length: 1025 }, (_, i) => i + 1));
  const perGen = all.reduce((acc, p) => ((acc[p.gen] = (acc[p.gen] || 0) + 1), acc), {});
  assert.deepEqual(perGen, { 1: 151, 2: 100, 3: 135, 4: 107, 5: 156, 6: 72, 7: 88, 8: 96, 9: 120 });
});

test('every Pokemon has a name and one or two real types', () => {
  const valid = new Set(TYPES);
  for (const p of all) {
    assert.ok(p.name && p.name.length > 1, `#${p.id} name`);
    assert.ok(p.types.length === 1 || p.types.length === 2, `#${p.id} type count`);
    assert.equal(new Set(p.types).size, p.types.length, `#${p.id} duplicate type`);
    for (const t of p.types) assert.ok(valid.has(t), `#${p.id} unknown type ${t}`);
  }
});

test('a sprite exists for every Pokemon', async () => {
  await Promise.all(all.map((p) => access(new URL(`sprites/${p.id}.png`, APP))));
});

test('the generation filter narrows the pool, and empty means everything', () => {
  assert.equal(pool([]).length, 1025);
  assert.equal(pool(null).length, 1025);
  assert.equal(pool([1]).length, 151);
  assert.equal(pool([1, 2]).length, 251);
  assert.ok(pool([9]).every((p) => p.gen === 9));
});

test('pickFresh avoids immediate repeats', () => {
  const recent = [];
  const picks = Array.from({ length: 30 }, () => pickFresh(all, recent).id);
  for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1]);
});

/* --------------------------------------------------------------- questions */

test('every mode produces a self-consistent question', () => {
  for (const mode of Object.keys(MODES)) {
    for (let i = 0; i < 500; i++) {
      const q = nextQuestion(mode, all, []);
      if (mode === 'typeid') {
        assert.ok(q.pokemon, 'typeid needs a Pokemon');
        assert.deepEqual(q.answer, q.pokemon.types);
        continue;
      }
      assert.ok(TYPES.includes(q.attacker), `${mode}: bad attacker`);
      assert.equal(q.multiplier, multiplier(q.attacker, q.defenderTypes));
      assert.equal(q.answer, verdictOf(q.multiplier));
      if (mode === 'easy') assert.equal(q.defenderTypes.length, 1);
      if (mode === 'medium') assert.equal(q.defenderTypes.length, 2);
      if (mode === 'hard') assert.deepEqual(q.defenderTypes, q.pokemon.types);
    }
  }
});

test('medium only asks about typings a Pokemon actually has', () => {
  const real = new Set(all.filter((p) => p.types.length === 2).map((p) => p.types.join('/')));
  for (let i = 0; i < 300; i++) {
    const q = nextQuestion('medium', all, []);
    assert.ok(real.has(q.defenderTypes.join('/')), `no Pokemon is ${q.defenderTypes.join('/')}`);
  }
});

test('Pokemon-based modes respect the generation filter', () => {
  for (const mode of ['hard', 'typeid']) {
    for (let i = 0; i < 200; i++) {
      assert.equal(nextQuestion(mode, all, [1]).pokemon.gen, 1);
    }
  }
});

test('all four verdicts come up, and neutral does not dominate', () => {
  const counts = { super: 0, neutral: 0, resisted: 0, immune: 0 };
  for (let i = 0; i < 4000; i++) counts[nextQuestion('medium', all, []).answer]++;
  for (const [verdict, n] of Object.entries(counts)) {
    assert.ok(n > 40, `${verdict} came up only ${n} times in 4000`);
  }
  assert.ok(counts.neutral < 2000, `neutral dominated: ${counts.neutral}/4000`);
});

test('type ID accepts either order', () => {
  assert.ok(sameTypes(['grass', 'poison'], ['poison', 'grass']));
  assert.ok(sameTypes(['fire'], ['fire']));
  assert.ok(!sameTypes(['fire'], ['fire', 'flying']));
  assert.ok(!sameTypes(['fire', 'flying'], ['fire', 'dragon']));
});

/* ------------------------------------------------------------- DOM wiring */

test('every element id app.js looks up exists in index.html', async () => {
  const html = await readFile(new URL('index.html', APP), 'utf8');
  const js = await readFile(new URL('js/app.js', APP), 'utf8');
  const ids = new Set(html.match(/id="([\w-]+)"/g)?.map((m) => m.slice(4, -1)));
  const looked = [...js.matchAll(/\bel\('([\w-]+)'\)/g)].map((m) => m[1]);
  assert.ok(looked.length > 10, 'expected app.js to look up ids');
  for (const id of looked) {
    // "check" is created by renderTypeGrid at runtime, not present in the HTML.
    if (id === 'check') continue;
    assert.ok(ids.has(id), `app.js reads #${id}, which index.html does not define`);
  }
});

test('every type used by the UI has a colour in the stylesheet', async () => {
  const css = await readFile(new URL('styles.css', APP), 'utf8');
  for (const t of [...TYPES, 'unknown']) {
    assert.ok(css.includes(`.type-${t}`), `styles.css has no .type-${t}`);
  }
});
