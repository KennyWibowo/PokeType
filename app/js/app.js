import { TYPES, VERDICT_LABEL, against, formatMultiplier, verdictOf } from './types.js';
import { loadPokemon, loadMoves, loadLearnsets, spriteUrl, GENERATIONS } from './data.js';
import { MODES, nextQuestion, sameTypes, gradeGuess } from './quiz.js';
import { pokeball } from './balls.js';
import { boostLabel, LEVEL, AVERAGE_ROLL } from './damage.js';

const BEST_KEY = 'poketype.best';
const GENS_KEY = 'poketype.gens';

const el = (id) => document.getElementById(id);
const dom = {
  home: el('home'), quiz: el('quiz'), back: el('back'),
  modesEffect: el('modes-effect'), modesTyping: el('modes-typing'),
  modeBanner: el('mode-banner'),
  streak: el('streak'), streakCurrent: el('streak-current'), streakBest: el('streak-best'),
  genFilter: el('gen-filter'), subject: el('subject'), prompt: el('prompt'),
  defender: el('defender'), answers: el('answers'), result: el('result'),
  resultHeadline: el('result-headline'), resultDetail: el('result-detail'), next: el('next'),
};

const state = {
  all: [],
  mode: null,
  question: null,
  answered: false,
  streak: 0,
  best: readJSON(BEST_KEY, {}),
  gens: readJSON(GENS_KEY, []),
  selection: [],
};

// Elements built at render time. Kept here rather than looked up by id, so that
// getElementById is only ever used for things index.html actually declares.
const live = {};

// localStorage is a convenience here, not a source of truth: a private window
// or blocked site data must not stop the game from starting.
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not fatal */
  }
}

/* ------------------------------------------------------------ small pieces */

/** Type names are stored lowercase; headings and prose need them capitalised. */
function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function clear(node) {
  node.replaceChildren();
}

function typeChip(type, { size = '', state: chipState = '' } = {}) {
  const chip = document.createElement('span');
  chip.className = `type-chip type-${type} ${size} ${chipState}`.trim();
  chip.textContent = type;
  return chip;
}

function unknownChip(label = '?') {
  const chip = document.createElement('span');
  chip.className = 'type-chip type-unknown';
  chip.textContent = label;
  return chip;
}

function dexNumber(id) {
  return `#${String(id).padStart(4, '0')}`;
}

/** The sprite-and-name block used by every Pokémon-shaped question. */
function pokemonFigure(pokemon, { size = '', notes = [] } = {}) {
  const figure = document.createElement('figure');
  figure.className = `pokemon ${size}`.trim();
  const img = document.createElement('img');
  img.src = spriteUrl(pokemon.id);
  img.alt = pokemon.name;
  img.width = 96;
  img.height = 96;
  const caption = document.createElement('figcaption');
  caption.innerHTML = `<span class="dex">${dexNumber(pokemon.id)}</span>${pokemon.name}`;
  figure.append(img, caption);
  if (notes.length) {
    const row = document.createElement('span');
    row.className = 'pokemon-notes';
    for (const note of notes) {
      const tag = document.createElement('span');
      tag.className = 'pokemon-note';
      tag.textContent = note;
      row.append(tag);
    }
    figure.append(row);
  }
  return figure;
}

/* -------------------------------------------------------------------- home */

function renderModeCards() {
  clear(dom.modesEffect);
  clear(dom.modesTyping);
  for (const [key, mode] of Object.entries(MODES)) {
    const card = document.createElement('button');
    card.className = 'mode-card';
    card.dataset.mode = key;
    card.disabled = true;   // enabled once pokemon.json has loaded

    const head = document.createElement('span');
    head.className = 'mode-head';
    head.append(pokeball(mode.ball, 30));
    const rank = document.createElement('span');
    rank.className = `mode-rank rank-${key}`;
    rank.textContent = mode.title;
    head.append(rank);

    const name = document.createElement('span');
    name.className = 'mode-name';
    name.textContent = mode.name;

    const blurb = document.createElement('span');
    blurb.className = 'mode-blurb';
    blurb.textContent = mode.blurb;

    card.append(head, name, blurb);
    card.addEventListener('click', () => startMode(key));
    (mode.group === 'typing' ? dom.modesTyping : dom.modesEffect).append(card);
  }
}

function renderGenFilter() {
  clear(dom.genFilter);
  for (const gen of GENERATIONS) {
    const btn = document.createElement('button');
    btn.className = 'gen-chip';
    btn.dataset.gen = String(gen.id);
    btn.innerHTML = `<strong>${gen.label}</strong><span>${gen.region}</span>`;
    btn.setAttribute('aria-pressed', String(state.gens.includes(gen.id)));
    btn.classList.toggle('on', state.gens.includes(gen.id));
    btn.addEventListener('click', () => {
      state.gens = state.gens.includes(gen.id)
        ? state.gens.filter((g) => g !== gen.id)
        : [...state.gens, gen.id].sort((a, b) => a - b);
      writeJSON(GENS_KEY, state.gens);
      renderGenFilter();
    });
    dom.genFilter.append(btn);
  }
}

function showHome() {
  state.mode = null;
  state.question = null;
  dom.home.hidden = false;
  dom.quiz.hidden = true;
  dom.back.hidden = true;
  dom.streak.hidden = true;
  document.title = 'PokéType — type effectiveness drill';
}

/* -------------------------------------------------------------------- quiz */

async function startMode(mode) {
  const card = dom.modesEffect.querySelector(`[data-mode="${mode}"]`)
    || dom.modesTyping.querySelector(`[data-mode="${mode}"]`);
  const needs = MODES[mode].needs;
  if (needs.length) {
    card.classList.add('loading');
    try {
      if (needs.includes('moves')) await loadMoves();
      if (needs.includes('learnsets')) await loadLearnsets();
    } catch (err) {
      card.classList.remove('loading');
      card.classList.add('failed');
      card.querySelector('.mode-blurb').textContent = `Could not load the data for this mode (${err.message}).`;
      return;
    }
    card.classList.remove('loading');
  }

  state.mode = mode;
  state.streak = 0;
  dom.home.hidden = true;
  dom.quiz.hidden = false;
  dom.back.hidden = false;
  dom.streak.hidden = false;
  document.title = `PokéType — ${MODES[mode].title}`;

  clear(dom.modeBanner);
  dom.modeBanner.append(pokeball(MODES[mode].ball, 22));
  const label = document.createElement('span');
  label.textContent = `${MODES[mode].title} · ${MODES[mode].name}`;
  dom.modeBanner.append(label);

  renderStreak();
  ask();
}

function renderStreak() {
  const best = state.best[state.mode] || 0;
  dom.streakCurrent.textContent = String(state.streak);
  dom.streakBest.textContent = String(best);
  dom.streak.classList.toggle('hot', state.streak >= 5);
}

function ask() {
  state.question = nextQuestion(state.mode, state.all, state.gens);
  state.answered = false;
  state.selection = [];
  dom.result.hidden = true;
  clear(dom.subject);
  clear(dom.defender);

  const q = state.question;
  if (q.mode === 'master') return askMaster(q);

  if (q.pokemon) dom.subject.append(pokemonFigure(q.pokemon));

  if (q.mode === 'typeid') {
    dom.prompt.textContent = 'What type is it?';
    dom.defender.append(unknownChip('select 1 or 2 types'));
    renderTypeGrid();
    return;
  }

  dom.prompt.innerHTML = attackPrompt(q);
  if (q.pokemon) {
    dom.defender.append(unknownChip('typing hidden'));
  } else {
    for (const t of q.defenderTypes) dom.defender.append(typeChip(t, { size: 'big' }));
  }
  renderMultiplierButtons(q.options);
}

/** The sentence above the answers, for every effectiveness mode but Master. */
function attackPrompt(q) {
  const target = q.pokemon
    ? q.pokemon.name
    : `a Pokémon of this type${q.defenderTypes.length > 1 ? 's' : ''}`;
  // Ultra names the move and withholds its type — that is the whole mode.
  const source = q.move
    ? `<span class="move-name">${q.move.name}</span>`
    : `A <span class="type-inline type-${q.attacker}">${q.attacker}</span> move`;
  return `${source} hits ${target}${q.pokemon ? '.' : ':'}`;
}

function renderMultiplierButtons(options) {
  clear(dom.answers);
  dom.answers.className = `answers multipliers count-${options.length}`;
  options.forEach((mult, i) => {
    const verdict = verdictOf(mult);
    const btn = document.createElement('button');
    btn.className = `answer-btn verdict-${verdict}`;
    btn.dataset.multiplier = String(mult);
    btn.innerHTML = `<span class="key-hint">${i + 1}</span>`
      + `<span class="answer-mult">${formatMultiplier(mult)}</span>`
      + `<span class="answer-verdict">${VERDICT_LABEL[verdict]}</span>`;
    btn.addEventListener('click', () => answerMultiplier(mult));
    dom.answers.append(btn);
  });
}

function renderTypeGrid() {
  clear(dom.answers);
  dom.answers.className = 'answers type-grid';
  for (const type of TYPES) {
    const btn = document.createElement('button');
    btn.className = `type-chip type-${type} selectable`;
    btn.dataset.type = type;
    btn.textContent = type;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => toggleType(type));
    dom.answers.append(btn);
  }
  live.check = document.createElement('button');
  live.check.className = 'primary-btn check-btn';
  live.check.textContent = 'Check';
  live.check.disabled = true;
  live.check.addEventListener('click', answerTypes);
  dom.answers.append(live.check);
}

function toggleType(type) {
  if (state.answered) return;
  if (state.selection.includes(type)) {
    state.selection = state.selection.filter((t) => t !== type);
  } else if (state.selection.length < 2) {
    state.selection = [...state.selection, type];
  } else {
    // Third pick replaces the oldest, so the grid never feels stuck.
    state.selection = [state.selection[1], type];
  }
  for (const btn of dom.answers.querySelectorAll('[data-type]')) {
    const on = state.selection.includes(btn.dataset.type);
    btn.classList.toggle('picked', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  live.check.disabled = state.selection.length === 0;
}

/* ------------------------------------------------------------------ master */

function askMaster(q) {
  const matchup = document.createElement('div');
  matchup.className = 'matchup';
  matchup.append(pokemonFigure(q.attacker, {
    size: 'small',
    notes: [q.abilities.attacker, boostLabel(q.stage, q.move.cls)],
  }));

  const middle = document.createElement('div');
  middle.className = 'matchup-move';
  middle.innerHTML = `<span class="move-name">${q.move.name}</span>`
    + `<span class="move-meta">${q.move.power} BP · ${q.move.cls === 'physical' ? 'Physical' : 'Special'}</span>`
    + '<span class="matchup-arrow" aria-hidden="true">▶</span>';
  matchup.append(middle);

  matchup.append(pokemonFigure(q.defender, {
    size: 'small',
    notes: [q.abilities.defender, `${q.result.hp} HP`],
  }));
  dom.subject.append(matchup);

  dom.prompt.innerHTML = `How much of <strong>${q.defender.name}</strong>'s HP does that take?`
    + `<span class="assumptions">level ${LEVEL} · 31 IVs · no EVs · neutral nature`
    + ` · ${AVERAGE_ROLL} damage roll · abilities count · no items, weather or screens</span>`;
  renderSlider(q);
}

function renderSlider(q) {
  clear(dom.answers);
  dom.answers.className = 'answers slider-panel';

  const bar = document.createElement('div');
  bar.className = 'hp-bars';
  bar.innerHTML = `
    <span class="bar-label">your guess</span>
    <span class="hp-track"><span class="hp-fill hp-guess"></span></span>
    <span class="bar-label bar-actual" hidden>actual</span>
    <span class="hp-track hp-track-actual" hidden><span class="hp-fill hp-actual"></span></span>`;
  live.hpGuess = bar.querySelector('.hp-guess');
  live.hpActual = bar.querySelector('.hp-actual');
  live.actualLabel = bar.querySelector('.bar-actual');
  live.actualTrack = bar.querySelector('.hp-track-actual');

  const readout = document.createElement('div');
  readout.className = 'slider-readout';
  readout.innerHTML = '<strong class="slider-value">50%</strong>'
    + `<span class="slider-hp">of ${q.result.hp} HP</span>`;
  live.sliderValue = readout.querySelector('.slider-value');
  live.sliderHp = readout.querySelector('.slider-hp');

  live.slider = document.createElement('input');
  live.slider.type = 'range';
  live.slider.min = '0';
  live.slider.max = '100';
  live.slider.value = '50';
  live.slider.className = 'hp-slider';
  live.slider.setAttribute('aria-label', `Percentage of ${q.defender.name}'s HP removed`);
  live.slider.addEventListener('input', updateSlider);

  live.lock = document.createElement('button');
  live.lock.className = 'primary-btn';
  live.lock.textContent = 'Lock it in';
  live.lock.addEventListener('click', answerSlider);

  dom.answers.append(bar, readout, live.slider, live.lock);
  updateSlider();
}

function updateSlider() {
  const value = Number(live.slider.value);
  live.hpGuess.style.width = `${value}%`;
  live.sliderValue.textContent = `${value}%`;
  live.sliderHp.textContent = `≈ ${Math.round((value / 100) * state.question.result.hp)} of ${state.question.result.hp} HP`;
}

function answerSlider() {
  if (state.answered) return;
  const q = state.question;
  const guess = Number(live.slider.value);
  const { delta, label, correct } = gradeGuess(guess, q.answer);
  scoreAnswer(correct);

  live.slider.disabled = true;
  live.lock.hidden = true;
  live.actualLabel.hidden = false;
  live.actualTrack.hidden = false;
  live.hpActual.style.width = `${q.answer}%`;
  live.hpActual.classList.toggle('over', q.answer >= 100);
  dom.answers.classList.add('answered');

  const { result, move, attacker, defender } = q;
  const stat = move.cls === 'physical' ? 'Atk' : 'Sp. Atk';
  const against_ = move.cls === 'physical' ? 'Def' : 'Sp. Def';
  const detail = [
    result.power === move.power
      ? `${move.name} ${move.power} BP`
      : `${move.name} ${move.power} → ${result.power} BP`,
    `${stat} ${result.attackStat} vs ${against_} ${result.defenseStat}`,
    `STAB ${formatMultiplier(result.stab)}`,
    `${cap(move.type)} ${formatMultiplier(result.effectiveness)}`,
    result.damage >= result.hp
      ? `${result.damage} damage to ${result.hp} HP — a KO`
      : `${result.damage} of ${result.hp} HP`,
    ...result.notes,
  ].join(' · ');

  showResult(correct, detail, {
    headline: `${label} — it takes ${q.answer}%`,
    sub: `you said ${guess}%, ${delta === 0 ? 'exactly right' : `${delta} point${delta === 1 ? '' : 's'} off`}`,
  });
}

/* ----------------------------------------------------------------- scoring */

function scoreAnswer(correct) {
  state.answered = true;
  state.streak = correct ? state.streak + 1 : 0;
  if (state.streak > (state.best[state.mode] || 0)) {
    state.best[state.mode] = state.streak;
    writeJSON(BEST_KEY, state.best);
  }
  renderStreak();
}

function answerMultiplier(chosen) {
  if (state.answered) return;
  const q = state.question;
  const correct = chosen === q.answer;
  scoreAnswer(correct);

  for (const btn of dom.answers.querySelectorAll('[data-multiplier]')) {
    btn.disabled = true;
    if (Number(btn.dataset.multiplier) === q.answer) btn.classList.add('correct');
    else if (Number(btn.dataset.multiplier) === chosen) btn.classList.add('wrong');
  }

  // Reveal whatever the question withheld — the move's type, the defender's
  // typing, or both. Easy and Medium hid nothing, so leave their chips alone.
  if (q.move || q.pokemon) {
    clear(dom.defender);
    if (q.move) {
      dom.defender.append(typeChip(q.move.type, { size: 'big' }));
      const arrow = document.createElement('span');
      arrow.className = 'reveal-arrow';
      arrow.textContent = '→';
      dom.defender.append(arrow);
    }
    for (const t of q.defenderTypes) dom.defender.append(typeChip(t, { size: 'big' }));
  }

  showResult(correct, effectivenessDetail(q), {
    headline: `${VERDICT_LABEL[q.verdict]} — ${formatMultiplier(q.multiplier)}`,
  });
}

function answerTypes() {
  if (state.answered || state.selection.length === 0) return;
  const q = state.question;
  const correct = sameTypes(state.selection, q.answer);
  scoreAnswer(correct);

  live.check.hidden = true;
  for (const btn of dom.answers.querySelectorAll('[data-type]')) {
    btn.disabled = true;
    const isAnswer = q.answer.includes(btn.dataset.type);
    const picked = state.selection.includes(btn.dataset.type);
    if (isAnswer) btn.classList.add('correct');
    else if (picked) btn.classList.add('wrong');
    else btn.classList.add('faded');
  }

  clear(dom.defender);
  for (const t of q.answer) dom.defender.append(typeChip(t, { size: 'big' }));
  showResult(correct, `${q.pokemon.name} is ${q.answer.map(cap).join(' / ')}.`, {
    headline: q.answer.map(cap).join(' / '),
  });
}

/** "Fire → Grass 2× · Poison 1× = 2×" — the arithmetic behind the verdict. */
function effectivenessDetail(q) {
  const parts = q.defenderTypes.map((t) => `${cap(t)} ${formatMultiplier(against(q.attacker, t))}`);
  const sum = q.defenderTypes.length > 1
    ? `${parts.join(' · ')} = ${formatMultiplier(q.multiplier)}`
    : parts[0];
  const source = q.move ? `${q.move.name} (${cap(q.attacker)})` : cap(q.attacker);
  return `${source} → ${sum}`;
}

function showResult(correct, detail, { headline, sub = '' }) {
  dom.result.classList.toggle('is-correct', correct);
  dom.result.classList.toggle('is-wrong', !correct);
  dom.resultHeadline.textContent = state.question.mode === 'master'
    ? headline
    : `${correct ? 'Correct' : 'Not quite'} — ${headline}`;
  dom.resultDetail.textContent = sub ? `${sub} · ${detail}` : detail;
  dom.result.hidden = false;
  dom.next.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ wiring */

dom.back.addEventListener('click', showHome);
dom.next.addEventListener('click', ask);

document.addEventListener('keydown', (event) => {
  if (!state.mode || event.metaKey || event.ctrlKey || event.altKey) return;
  if (state.answered && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    ask();
    return;
  }
  if (event.key === 'Escape') {
    showHome();
    return;
  }
  if (state.answered) return;
  if (state.question.mode === 'master') {
    if (event.key === 'Enter') {
      event.preventDefault();
      answerSlider();
    }
    return;
  }
  if (state.question.mode === 'typeid') return;
  const index = Number(event.key) - 1;
  const options = state.question.options;
  if (index >= 0 && index < options.length) answerMultiplier(options[index]);
});

renderModeCards();
loadPokemon()
  .then((all) => {
    state.all = all;
    renderGenFilter();
    for (const card of document.querySelectorAll('.mode-card')) card.disabled = false;
  })
  .catch((err) => {
    const banner = document.createElement('p');
    banner.className = 'load-error';
    banner.textContent = `Could not start: ${err.message}.`;
    dom.home.prepend(banner);
    dom.genFilter.textContent = '';
  });
