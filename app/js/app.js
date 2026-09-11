import { TYPES, VERDICTS, VERDICT_LABEL, against, formatMultiplier } from './types.js';
import { loadPokemon, spriteUrl, GENERATIONS } from './data.js';
import { MODES, nextQuestion, sameTypes } from './quiz.js';

const BEST_KEY = 'poketype.best';
const GENS_KEY = 'poketype.gens';

const el = (id) => document.getElementById(id);
const dom = {
  home: el('home'), quiz: el('quiz'), back: el('back'),
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

/** Type names are stored lowercase; headings and prose need them capitalised. */
function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function clear(node) {
  node.replaceChildren();
}

/* -------------------------------------------------------------------- home */

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

function startMode(mode) {
  state.mode = mode;
  state.streak = 0;
  dom.home.hidden = true;
  dom.quiz.hidden = false;
  dom.back.hidden = false;
  dom.streak.hidden = false;
  document.title = `PokéType — ${MODES[mode].title}`;
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
  if (q.pokemon) {
    const figure = document.createElement('figure');
    figure.className = 'pokemon';
    const img = document.createElement('img');
    img.src = spriteUrl(q.pokemon.id);
    img.alt = q.pokemon.name;
    img.width = 96;
    img.height = 96;
    const caption = document.createElement('figcaption');
    caption.innerHTML = `<span class="dex">#${String(q.pokemon.id).padStart(4, '0')}</span>${q.pokemon.name}`;
    figure.append(img, caption);
    dom.subject.append(figure);
  }

  if (q.mode === 'typeid') {
    dom.prompt.textContent = 'What type is it?';
    dom.defender.append(unknownChip('select 1 or 2 types'));
    renderTypeGrid();
  } else {
    dom.prompt.innerHTML = q.pokemon
      ? `A <span class="type-inline type-${q.attacker}">${q.attacker}</span> move hits ${q.pokemon.name}.`
      : `A <span class="type-inline type-${q.attacker}">${q.attacker}</span> move hits a Pokémon of this type${q.defenderTypes.length > 1 ? 's' : ''}:`;
    if (q.pokemon) {
      dom.defender.append(unknownChip('typing hidden'));
    } else {
      for (const t of q.defenderTypes) dom.defender.append(typeChip(t, { size: 'big' }));
    }
    renderVerdictButtons();
  }
}

function renderVerdictButtons() {
  clear(dom.answers);
  dom.answers.className = 'answers verdicts';
  VERDICTS.forEach((verdict, i) => {
    const btn = document.createElement('button');
    btn.className = `answer-btn verdict-${verdict}`;
    btn.dataset.verdict = verdict;
    btn.innerHTML = `<span class="key-hint">${i + 1}</span>${VERDICT_LABEL[verdict]}`;
    btn.addEventListener('click', () => answerVerdict(verdict));
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
  const check = document.createElement('button');
  check.id = 'check';
  check.className = 'primary-btn check-btn';
  check.textContent = 'Check';
  check.disabled = true;
  check.addEventListener('click', answerTypes);
  dom.answers.append(check);
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
  el('check').disabled = state.selection.length === 0;
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

function answerVerdict(chosen) {
  if (state.answered) return;
  const q = state.question;
  const correct = chosen === q.answer;
  scoreAnswer(correct);

  for (const btn of dom.answers.querySelectorAll('[data-verdict]')) {
    btn.disabled = true;
    if (btn.dataset.verdict === q.answer) btn.classList.add('correct');
    else if (btn.dataset.verdict === chosen) btn.classList.add('wrong');
  }

  // Reveal the typing that was hidden behind the sprite.
  if (q.pokemon) {
    clear(dom.defender);
    for (const t of q.defenderTypes) dom.defender.append(typeChip(t, { size: 'big' }));
  }

  showResult(correct, effectivenessDetail(q));
}

function answerTypes() {
  if (state.answered || state.selection.length === 0) return;
  const q = state.question;
  const correct = sameTypes(state.selection, q.answer);
  scoreAnswer(correct);

  el('check').hidden = true;
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

  showResult(correct, `${q.pokemon.name} is ${q.answer.map(cap).join(' / ')}.`);
}

/** "Fire → Grass 2× · Poison 1× = 2×" — the arithmetic behind the verdict. */
function effectivenessDetail(q) {
  const parts = q.defenderTypes.map((t) => `${cap(t)} ${formatMultiplier(against(q.attacker, t))}`);
  const sum = q.defenderTypes.length > 1
    ? `${parts.join(' · ')} = ${formatMultiplier(q.multiplier)}`
    : parts[0];
  return `${cap(q.attacker)} → ${sum}`;
}

function showResult(correct, detail) {
  dom.result.classList.toggle('is-correct', correct);
  dom.result.classList.toggle('is-wrong', !correct);
  const q = state.question;
  const answerLabel = q.mode === 'typeid'
    ? q.answer.map(cap).join(' / ')
    : `${VERDICT_LABEL[q.answer]} — ${formatMultiplier(q.multiplier)}`;
  dom.resultHeadline.textContent = correct ? `Correct — ${answerLabel}` : `Not quite — ${answerLabel}`;
  dom.resultDetail.textContent = detail;
  dom.result.hidden = false;
  dom.next.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------- wiring */

for (const card of document.querySelectorAll('.mode-card')) {
  card.addEventListener('click', () => startMode(card.dataset.mode));
}
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
  if (!state.answered && state.question.mode !== 'typeid') {
    const index = Number(event.key) - 1;
    if (index >= 0 && index < VERDICTS.length) answerVerdict(VERDICTS[index]);
  }
});

loadPokemon()
  .then((all) => {
    state.all = all;
    renderGenFilter();
    for (const card of document.querySelectorAll('.mode-card')) card.disabled = false;
  })
  .catch((err) => {
    dom.genFilter.textContent = `Could not load the Pokémon list (${err.message}).`;
    for (const card of document.querySelectorAll('.mode-card')) card.disabled = true;
  });
