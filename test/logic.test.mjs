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

// balls.js reaches for document.createElementNS at call time, not import time.
// Only ballLabel is exercised here; the drawing itself is checked in a browser.
globalThis.document = undefined;

// data.js fetches a relative URL; serve it off disk so the module works here.
globalThis.fetch = async (path) => {
  const body = await readFile(new URL(path, APP), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};

const { TYPES, against, multiplier, verdictOf, formatMultiplier } = await import('../app/js/types.js');
const { loadPokemon, loadMoves, loadLearnsets, pool, movePool, pickFresh, learnsetOf } =
  await import('../app/js/data.js');
const { nextQuestion, sameTypes, gradeGuess, MODES, DUAL_TYPE_MULTIPLIERS, SINGLE_TYPE_MULTIPLIERS } =
  await import('../app/js/quiz.js');
const { calculate, statAt, boostMultiplier, LEVEL } = await import('../app/js/damage.js');
const { pokeball, ballLabel } = await import('../app/js/balls.js');

const all = await loadPokemon();
const moves = await loadMoves();
const learnsets = await loadLearnsets();
const byName = (name) => all.find((p) => p.name === name);
const moveNamed = (name) => moves.find((m) => m.name === name);

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
    for (let i = 0; i < 300; i++) {
      const q = nextQuestion(mode, all, []);
      if (mode === 'typeid') {
        assert.ok(q.pokemon, 'typeid needs a Pokemon');
        assert.deepEqual(q.answer, q.pokemon.types);
        continue;
      }
      if (mode === 'master') {
        assert.ok(q.attacker && q.defender && q.move, 'master needs both sides and a move');
        assert.notEqual(q.attacker.id, q.defender.id);
        assert.equal(q.answer, Math.round(q.result.percent));
        assert.ok(q.answer >= 0 && q.answer <= 100, `answer out of range: ${q.answer}`);
        continue;
      }
      assert.ok(TYPES.includes(q.attacker), `${mode}: bad attacker`);
      assert.equal(q.multiplier, multiplier(q.attacker, q.defenderTypes));
      assert.equal(q.answer, q.multiplier);
      assert.equal(q.verdict, verdictOf(q.multiplier));
      assert.ok(q.options.includes(q.answer), `${mode}: ${q.answer}x is not an offered option`);
      if (mode === 'easy') {
        assert.equal(q.defenderTypes.length, 1);
        assert.deepEqual(q.options, SINGLE_TYPE_MULTIPLIERS);
      }
      if (mode === 'medium') assert.equal(q.defenderTypes.length, 2);
      if (mode === 'hard') assert.deepEqual(q.defenderTypes, q.pokemon.types);
      if (mode === 'ultra') {
        // The whole point of Ultra: a move name, and the type it implies.
        assert.ok(q.move, 'ultra needs a move');
        assert.equal(q.attacker, q.move.type);
        assert.deepEqual(q.defenderTypes, q.pokemon.types);
      }
      // Hard and Ultra hide the typing, so a mono-type defender must still
      // offer 4x and 0.25x - otherwise the options leak the answer.
      if (mode !== 'easy') assert.deepEqual(q.options, DUAL_TYPE_MULTIPLIERS);
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

test('every multiplier comes up, and 1x does not dominate', () => {
  for (const mode of ['medium', 'hard', 'ultra']) {
    const counts = new Map(DUAL_TYPE_MULTIPLIERS.map((m) => [m, 0]));
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      const a = nextQuestion(mode, all, []).answer;
      counts.set(a, counts.get(a) + 1);
    }
    for (const [mult, n] of counts) {
      assert.ok(n > runs * 0.01, `${mode}: ${mult}x came up only ${n} times in ${runs}`);
    }
    assert.ok(counts.get(1) < runs * 0.45, `${mode}: 1x dominated with ${counts.get(1)}/${runs}`);
  }
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

test('the datasets are never served as immutable', async () => {
  // They are bind-mounted and rewritten in place at fixed URLs. Caching them
  // hard pairs a stale pokemon.json with fresh JS, which is exactly how Master
  // mode broke on 2026-09-11. Sprites are the opposite case and may stay
  // immutable: a sprite for a dex number never changes.
  const conf = await readFile(new URL('../nginx.conf', import.meta.url), 'utf8');
  const dataBlock = conf.slice(conf.indexOf('location ~* ^/data/'));
  const body = dataBlock.slice(0, dataBlock.indexOf('}'));
  assert.ok(!/immutable/.test(body), 'the /data/ location must not be immutable');
  assert.ok(/no-cache/.test(body), 'the /data/ location must revalidate');
  assert.ok(!/\^\/\(sprites\|data\)/.test(conf), 'sprites and data must not share a cache rule');
});

test('every dataset fetch is version-stamped', async () => {
  // The only thing that reaches past a cache entry already stored as
  // immutable is a different URL.
  const data = await readFile(new URL('../app/js/data.js', import.meta.url), 'utf8');
  assert.ok(/DATA_VERSION\s*=\s*\d+/.test(data), 'data.js needs a DATA_VERSION');
  assert.ok(/fetch\(`data\/\$\{file\}\?v=\$\{DATA_VERSION\}`\)/.test(data),
    'loadJSON must append the version to every dataset URL');
});

test('every type used by the UI has a colour in the stylesheet', async () => {
  const css = await readFile(new URL('styles.css', APP), 'utf8');
  for (const t of [...TYPES, 'unknown']) {
    assert.ok(css.includes(`.type-${t}`), `styles.css has no .type-${t}`);
  }
});


/* ---------------------------------------------------------- damage & master */

test('the damage formula reproduces a known calculation', () => {
  // Charizard (Sp. Atk base 109) Flamethrower into Blastoise (Sp. Def 105,
  // HP 79) at level 50: 129 Sp. Atk against 125 Sp. Def, 154 HP, STAB 1.5x
  // and Fire resisted by Water.
  const r = calculate(byName('Charizard'), moveNamed('Flamethrower'), byName('Blastoise'));
  assert.equal(r.attackStat, 129);
  assert.equal(r.defenseStat, 125);
  assert.equal(r.hp, 154);
  assert.equal(r.stab, 1.5);
  assert.equal(r.effectiveness, 0.5);
  assert.equal(r.damage, 28);
  assert.ok(Math.abs(r.percent - 18.18) < 0.01, `percent was ${r.percent}`);
});

test('a 4x hit lands where a damage calculator puts it', () => {
  // Pikachu Thunderbolt into Gyarados: Water/Flying, so Electric is 4x.
  const r = calculate(byName('Pikachu'), moveNamed('Thunderbolt'), byName('Gyarados'));
  assert.equal(r.effectiveness, 4);
  assert.equal(r.damage, 136);
  assert.equal(r.hp, 170);
});

test('stat stages scale the attack, and saturate the way the games do', () => {
  assert.equal(boostMultiplier(0), 1);
  assert.equal(boostMultiplier(1), 1.5);
  assert.equal(boostMultiplier(2), 2);
  assert.equal(boostMultiplier(6), 4);
  assert.equal(boostMultiplier(-1), 2 / 3);
  assert.equal(boostMultiplier(-2), 0.5);

  const flat = calculate(byName('Charizard'), moveNamed('Flamethrower'), byName('Blastoise'), 0);
  const boosted = calculate(byName('Charizard'), moveNamed('Flamethrower'), byName('Blastoise'), 2);
  assert.equal(boosted.attackStat, flat.attackStat * 2);
  assert.ok(boosted.damage > flat.damage);
});

test('HP and other stats use their separate level-50 formulas', () => {
  assert.equal(statAt(105, true), 180);   // HP adds the level and 10 on top
  assert.equal(statAt(105), 125);        // everything else adds a flat 5
  assert.equal(statAt(255, true), 330);  // Blissey
  assert.equal(statAt(45, true), 120);   // Bulbasaur
  assert.equal(LEVEL, 50);
});

/* -------------------------------------------------------------- abilities */

test('Levitate makes a Ground move do nothing at all', () => {
  const bronzong = byName('Bronzong');
  const earthquake = moveNamed('Earthquake');
  assert.ok(bronzong.abilities.includes('Levitate'));

  const grounded = calculate(byName('Machamp'), earthquake, bronzong, 0,
    { attacker: 'Guts', defender: 'Heatproof' });
  assert.ok(grounded.damage > 0, 'control: Earthquake should hurt without Levitate');

  const levitating = calculate(byName('Machamp'), earthquake, bronzong, 0,
    { attacker: 'Guts', defender: 'Levitate' });
  assert.equal(levitating.effectiveness, 0);
  assert.equal(levitating.damage, 0);
  assert.ok(levitating.notes.some((n) => n.includes('Levitate')));
});

test('the other absorbing abilities zero their own type', () => {
  const cases = [
    ['Flash Fire', 'Flamethrower'],
    ['Water Absorb', 'Surf'],
    ['Volt Absorb', 'Thunderbolt'],
    ['Sap Sipper', 'Energy Ball'],
    ['Storm Drain', 'Surf'],
    ['Lightning Rod', 'Thunderbolt'],
    ['Motor Drive', 'Thunderbolt'],
    ['Earth Eater', 'Earthquake'],
    ['Well-Baked Body', 'Flamethrower'],
  ];
  for (const [ability, moveName] of cases) {
    const r = calculate(byName('Mew'), moveNamed(moveName), byName('Snorlax'), 0, { defender: ability });
    assert.equal(r.damage, 0, `${ability} did not absorb ${moveName}`);
  }
});

test('damage-scaling abilities move the number in the right direction', () => {
  const plain = (atk, def) =>
    calculate(byName('Charizard'), moveNamed('Flamethrower'), byName('Snorlax'), 0,
      { attacker: atk, defender: def }).damage;

  const baseline = plain('Blaze', 'Immunity');
  assert.ok(plain('Blaze', 'Thick Fat') < baseline, 'Thick Fat should soften Fire');
  assert.ok(plain('Blaze', 'Heatproof') < baseline, 'Heatproof should soften Fire');
  assert.ok(plain('Blaze', 'Dry Skin') > baseline, 'Dry Skin should worsen Fire');
  assert.ok(plain('Adaptability', 'Immunity') > baseline, 'Adaptability should raise STAB');
  assert.ok(plain('Blaze', 'Multiscale') < baseline, 'Multiscale should halve at full HP');
  assert.ok(plain('Blaze', 'Ice Scales') < baseline, 'Ice Scales should halve a special hit');

  // Blaze itself must NOT fire: the attacker is at full HP.
  assert.equal(plain('Blaze', 'Immunity'), plain('Torrent', 'Immunity'));
});

test('Wonder Guard lets only super-effective moves through', () => {
  const shedinja = byName('Shedinja');
  const neutral = calculate(byName('Mew'), moveNamed('Psychic'), shedinja, 0, { defender: 'Wonder Guard' });
  assert.equal(neutral.damage, 0);
  const superEffective = calculate(byName('Mew'), moveNamed('Shadow Ball'), shedinja, 0, { defender: 'Wonder Guard' });
  assert.ok(superEffective.damage > 0, 'Ghost is super effective on Bug/Ghost');
});

test('Technician boosts weak moves only', () => {
  const weak = moveNamed('Bullet Punch');       // 40 BP
  const strong = moveNamed('Close Combat');     // 120 BP
  const a = byName('Scizor'), d = byName('Snorlax');
  assert.ok(calculate(a, weak, d, 0, { attacker: 'Technician' }).power > weak.power);
  assert.equal(calculate(a, strong, d, 0, { attacker: 'Technician' }).power, strong.power);
});

test('every Pokemon has at least one ability to draw', () => {
  for (const p of all) {
    assert.ok(p.abilities.length >= 1, `#${p.id} ${p.name} has no abilities`);
  }
});

/* ------------------------------------------------------------------ master */

test('master only pairs an attacker with a move it can learn', () => {
  for (let i = 0; i < 400; i++) {
    const q = nextQuestion('master', all, []);
    assert.ok(learnsetOf(q.attacker.id).includes(q.move.id),
      `${q.attacker.name} cannot learn ${q.move.name}`);
    assert.ok(q.attacker.abilities.includes(q.abilities.attacker));
    assert.ok(q.defender.abilities.includes(q.abilities.defender));
  }
});

test('master answers spread across the whole slider, not just the low end', () => {
  const buckets = new Array(8).fill(0);
  const runs = 1200;
  for (let i = 0; i < runs; i++) {
    const q = nextQuestion('master', all, []);
    buckets[Math.min(7, Math.floor(q.answer / 12.5))]++;
  }
  // Uniform would be 150 each. Anything above half that is an even-enough
  // spread; the point is that no bracket is effectively unreachable and the
  // top one is not a dumping ground for every KO.
  buckets.forEach((n, i) => {
    assert.ok(n > runs / 8 / 2, `bucket ${i} (${i * 12.5}-${(i + 1) * 12.5}%) got only ${n}/${runs}`);
  });
});

test('master respects the generation filter on both sides', () => {
  for (let i = 0; i < 120; i++) {
    const q = nextQuestion('master', all, [1]);
    assert.equal(q.attacker.gen, 1);
    assert.equal(q.defender.gen, 1);
    assert.ok(q.move.gen <= 1, `${q.move.name} is a gen ${q.move.gen} move`);
  }
});

test('grading is by distance, and the streak needs 10 points or better', () => {
  assert.deepEqual(gradeGuess(50, 50), { delta: 0, label: 'Spot on', correct: true });
  assert.equal(gradeGuess(45, 50).label, 'Very close');
  assert.equal(gradeGuess(41, 50).label, 'Close enough');
  assert.equal(gradeGuess(30, 50).correct, false);
  assert.equal(gradeGuess(60, 50).delta, 10);
  assert.equal(gradeGuess(61, 50).correct, false);
});

/* ----------------------------------------------------------------- polish */

test('every mode names a Pokeball that balls.js knows how to draw', () => {
  for (const [key, mode] of Object.entries(MODES)) {
    assert.ok(mode.ball, `${key} has no ball`);
    assert.ok(ballLabel(mode.ball), `${key} names an unknown ball: ${mode.ball}`);
  }
  const used = Object.values(MODES).map((m) => m.ball);
  assert.equal(new Set(used).size, used.length, 'two modes share a ball');
});

test('movePool is cumulative up to the newest chosen generation', () => {
  assert.equal(movePool([]).length, moves.length);
  assert.ok(movePool([1]).every((m) => m.gen === 1));
  assert.ok(movePool([1]).length < movePool([3]).length);
  assert.equal(movePool([9]).length, moves.length);
});

test('no move whose type the player cannot infer is in the pool', () => {
  // Each of these is nominally Normal in the source data, but its real type
  // comes from IVs, a held item, the weather, the terrain, a form or a Tera
  // type — none of which the quiz shows. Ultra would be unanswerable and
  // Master would compute STAB against the wrong type.
  const unknowable = [
    'Hidden Power', 'Weather Ball', 'Terrain Pulse', 'Judgment', 'Techno Blast',
    'Multi-Attack', 'Ivy Cudgel', 'Revelation Dance', 'Aura Wheel', 'Raging Bull',
    'Tera Blast', 'Tera Starstorm',
  ];
  for (const name of unknowable) {
    assert.equal(moves.find((m) => m.name === name), undefined, `${name} is still in moves.json`);
  }
});

test('every move can be used by the damage formula', () => {
  for (const m of moves) {
    assert.ok(m.power > 0, `${m.name} has no power`);
    assert.ok(m.cls === 'physical' || m.cls === 'special', `${m.name} is ${m.cls}`);
    assert.ok(TYPES.includes(m.type), `${m.name} has type ${m.type}`);
  }
});
