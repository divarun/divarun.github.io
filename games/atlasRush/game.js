// ─── DATA ────────────────────────────────────────────────────────────────────
let COUNTRIES = [];

async function loadCountries() {
  try {
    const res = await fetch('countries.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    COUNTRIES = await res.json();
    console.log(`✅ Loaded ${COUNTRIES.length} countries`);
    init();
  } catch (err) {
    console.error('❌ Failed to load countries.json:', err);
    document.getElementById('clues-stack').innerHTML =
      '<p style="color:var(--danger);padding:1rem 0">Failed to load game data. Please refresh.</p>';
  }
}

// ─── DIFFICULTY ──────────────────────────────────────────────────────────────
// Difficulty is a field on each country in countries.json:
//   "easy"   = major well-known countries (5M+ pop, no territories)
//   "medium" = 500K+ pop countries
//   "hard"   = everything including territories and micronations
function getFilteredCountries(difficulty) {
  if (difficulty === 'hard')   return COUNTRIES;
  if (difficulty === 'medium') return COUNTRIES.filter(c => c.difficulty !== 'hard');
  return COUNTRIES.filter(c => c.difficulty === 'easy');
}

// ─── ALTERNATE NAMES ─────────────────────────────────────────────────────────
// Aliases live in the "alts" array on each country in countries.json.
let ALT_NAMES = {};

function buildAltNames() {
  ALT_NAMES = {};
  for (const c of COUNTRIES) {
    if (Array.isArray(c.alts)) {
      for (const alt of c.alts) {
        ALT_NAMES[alt.toLowerCase()] = c.name.toLowerCase();
      }
    }
  }
}

function normalizeGuess(raw) {
  const s = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  return ALT_NAMES[s] || s;
}

// ─── CLUE DEFINITIONS ────────────────────────────────────────────────────────
// Order: continent → flag → capital → landmark photo → borders → letter hint
const CLUE_KEYS   = ['continent', 'flag', 'capital', 'landmark_img','pop', 'borders', 'hint'];
const CLUE_LABELS = ['Continent', 'Flag', 'Capital', 'Landmark', 'Population','Borders', 'Letter Hint'];
const CLUE_ICONS  = ['🌍', '🏳️', '🏛️', '📸', '👥', '🗺️', '🔤'];

const MAX_SCORE  = 1000;
const CLUE_COST  = 200; // 5 clues × 200 = 1000 max deduction
const WRONG_COST = 50;

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentDifficulty = 'medium';
let activePool = [];

const state = {
  queue:        [],
  current:      null,
  revealed:     0,
  score:        MAX_SCORE,
  wrongGuesses: 0,
  streak:       0,
  bestScores:   JSON.parse(localStorage.getItem('atlasRush_scores') || '[]'),
  roundOver:    false,
  emojiLog:     [],
};

// ─── UTILITIES ───────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── INIT ────────────────────────────────────────────────────────────────────
function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  buildAltNames();
  initDifficultyButtons();
  setDifficulty(currentDifficulty, false);
  updateStreakDisplay();
  renderScores();
  initAutocomplete();
}

function setDifficulty(diff, restartRound = true) {
  currentDifficulty = diff;
  activePool = getFilteredCountries(diff);
  state.queue = shuffle(activePool);

  document.querySelectorAll('.diff-btn').forEach(b => {
    const active = b.dataset.diff === diff;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });

  if (restartRound) {
    state.streak = 0;
    updateStreakDisplay();
  }
  nextRound();
}

function initDifficultyButtons() {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => setDifficulty(btn.dataset.diff));
  });
}

// ─── ROUND ───────────────────────────────────────────────────────────────────
function nextRound() {
  if (state.queue.length === 0) state.queue = shuffle(activePool);
  state.current      = state.queue.pop();
  state.revealed     = 0;
  state.score        = MAX_SCORE;
  state.wrongGuesses = 0;
  state.roundOver    = false;
  state.emojiLog     = [];

  document.getElementById('result-card').classList.remove('show');
  const input = document.getElementById('guess-input');
  input.value = '';
  input.classList.remove('wrong');
  input.disabled = false;
  input.removeAttribute('aria-disabled');
  document.getElementById('guess-btn').disabled = false;
  document.getElementById('feedback').textContent = '';
  hideSuggestions();

  revealClue(0);
  renderLocked();
  renderProgress();
  updateScoreDisplay();
  switchTab('play');
}

// ─── CLUE RENDERING ──────────────────────────────────────────────────────────
function revealClue(idx) {
  const key = CLUE_KEYS[idx];
  state.revealed = idx + 1;

  const stack = document.getElementById('clues-stack');
  if (idx === 0) stack.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'clue-card' + (idx === 0 ? ' first' : '');

  const iconEl  = `<div class="clue-icon" aria-hidden="true">${CLUE_ICONS[idx]}</div>`;
  const labelEl = `<div class="clue-label">${CLUE_LABELS[idx]}</div>`;

  if (key === 'flag') {
    // Flag image from flagcdn
    card.innerHTML = `
      ${iconEl}
      <div class="clue-content">
        ${labelEl}
        <div class="clue-value">
          <img src="https://flagcdn.com/w160/${escHtml(state.current.code)}.png"
               class="clue-flag-img"
               alt="The mystery country's flag"
               loading="lazy">
        </div>
      </div>`;

  } else if (key === 'landmark_img') {
    // Static Wikimedia URL stored directly in the JSON — no async fetch needed
    const imgUrl  = state.current.landmark_img;
    const caption = escHtml(state.current.landmark || '');

    if (imgUrl) {
      card.innerHTML = `
        ${iconEl}
        <div class="clue-content">
          ${labelEl}
          <div class="clue-value">
            <figure class="landmark-figure">
              <img src="${escHtml(imgUrl)}"
                   class="landmark-img"
                   alt="A famous landmark — country name hidden until round ends"
                   loading="lazy"
                   onerror="this.parentElement.innerHTML='<span class=clue-text-fallback>${caption}</span>'"
              >
              <figcaption class="landmark-caption">${caption}</figcaption>
            </figure>
          </div>
        </div>`;
    } else {
      // No image stored — show text
      card.innerHTML = `
        ${iconEl}
        <div class="clue-content">
          ${labelEl}
          <div class="clue-value">${caption || '—'}</div>
        </div>`;
    }

  } else {
    // Plain text clue
    card.innerHTML = `
      ${iconEl}
      <div class="clue-content">
        ${labelEl}
        <div class="clue-value">${escHtml(state.current[key] ?? '—')}</div>
      </div>`;
  }

  stack.appendChild(card);

  document.getElementById('clue-num').textContent = state.revealed;
  renderLocked();
  renderProgress();
  updateRevealBtn();

  // Scroll newest card into view on mobile
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── LOCKED + PROGRESS ───────────────────────────────────────────────────────
function renderLocked() {
  const row = document.getElementById('locked-row');
  row.innerHTML = '';
  const lockSVG = `<svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  for (let i = state.revealed; i < CLUE_KEYS.length; i++) {
    const pill = document.createElement('div');
    pill.className = 'locked-pill';
    pill.innerHTML = `${lockSVG}${escHtml(CLUE_LABELS[i])}`;
    row.appendChild(pill);
  }
}

function renderProgress(won) {
  const row = document.getElementById('progress-row');
  row.innerHTML = '';
  document.getElementById('clue-total').textContent = CLUE_KEYS.length;
  for (let i = 0; i < CLUE_KEYS.length; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    if (won !== undefined && i < state.revealed) {
      d.classList.add(won ? 'win' : 'used');
    } else if (i < state.revealed - 1) {
      d.classList.add('used');
    } else if (i === state.revealed - 1) {
      d.classList.add('active');
    }
    row.appendChild(d);
  }
}

function updateRevealBtn() {
  const btn  = document.getElementById('reveal-btn');
  const cost = document.getElementById('reveal-cost');
  if (state.revealed >= CLUE_KEYS.length) {
    btn.disabled = true;
    cost.textContent = 'all revealed';
  } else {
    btn.disabled = false;
    cost.textContent = `-${CLUE_COST} pts`;
  }
}

function revealNextClue() {
  if (state.roundOver || state.revealed >= CLUE_KEYS.length) return;
  state.score = Math.max(0, state.score - CLUE_COST);
  state.emojiLog.push('🟡');
  revealClue(state.revealed);
  updateScoreDisplay();
}

// ─── SCORE DISPLAY ───────────────────────────────────────────────────────────
function updateScoreDisplay(animate) {
  const el = document.getElementById('score-display');
  el.textContent = state.score;
  el.classList.remove('score-high', 'score-mid', 'score-low', 'score-critical');
  if      (state.score >= 700) el.classList.add('score-high');
  else if (state.score >= 450) el.classList.add('score-mid');
  else if (state.score >= 200) el.classList.add('score-low');
  else                          el.classList.add('score-critical');
  if (animate) {
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 200);
  }
}

// ─── GUESSING ────────────────────────────────────────────────────────────────
function submitGuess() {
  if (state.roundOver) return;
  const raw = document.getElementById('guess-input').value.trim();
  if (!raw) return;
  hideSuggestions();

  const guess    = normalizeGuess(raw);
  const answer   = state.current.name.toLowerCase();
  const answerNS = answer.replace(/\s+/g, '');

  if (guess === answer || guess === answerNS || guess.replace(/\s+/g, '') === answerNS) {
    endRound(true);
  } else {
    state.wrongGuesses++;
    state.score = Math.max(0, state.score - WRONG_COST);
    state.emojiLog.push('❌');
    updateScoreDisplay(true);

    const input = document.getElementById('guess-input');
    input.classList.add('wrong');
    setTimeout(() => input.classList.remove('wrong'), 400);

    const fb = document.getElementById('feedback');
    fb.textContent = `"${raw}" is not correct. -${WRONG_COST} pts`;
    setTimeout(() => { fb.textContent = ''; }, 2200);

    if (state.score <= 0) {
      state.score = 0;
      endRound(false);
    }
  }
}

// ─── END ROUND ───────────────────────────────────────────────────────────────
function endRound(won) {
  state.roundOver = true;
  const input = document.getElementById('guess-input');
  input.disabled = true;
  input.setAttribute('aria-disabled', 'true');
  document.getElementById('guess-btn').disabled = true;
  document.getElementById('feedback').textContent = '';
  hideSuggestions();

  if (won) {
    state.streak++;
    state.emojiLog.push('✅');
    saveBestScore();
  } else {
    state.streak = 0;
    state.emojiLog.push('💀');
    state.score = 0;
  }

  renderProgress(won);
  updateStreakDisplay();
  renderScores();
  showResult(won);
}

function showResult(won) {
  document.getElementById('res-flag').innerHTML =
    `<img src="https://flagcdn.com/w320/${escHtml(state.current.code)}.png"
          class="result-flag-img"
          alt="Flag of ${escHtml(state.current.name)}"
          loading="lazy">`;
  document.getElementById('res-country').textContent = state.current.name;
  document.getElementById('res-subtitle').textContent = won
    ? `Correct! Identified in ${state.revealed} clue${state.revealed !== 1 ? 's' : ''}`
    : `Not quite — the answer was ${state.current.name}`;
  document.getElementById('rs-score').textContent  = state.score;
  document.getElementById('rs-clues').textContent  = state.revealed;
  document.getElementById('rs-streak').textContent = state.streak;
  buildShareBlock();

  const card = document.getElementById('result-card');
  card.classList.add('show');
  card.setAttribute('tabindex', '-1');
  setTimeout(() => card.focus(), 50);
}

function buildShareBlock() {
  const diffLabel = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
  const share = [
    `AtlasRush 🌍 [${diffLabel}]`,
    `${state.current.flag} ${state.current.name}`,
    state.emojiLog.join(''),
    `Score: ${state.score} pts | Clues: ${state.revealed}/${CLUE_KEYS.length}`,
    `Streak: 🔥${state.streak}`,
  ].join('\n');
  document.getElementById('share-block').textContent = share;
  window._shareText = share;
}

function copyShare() {
  const finish = () => {
    document.getElementById('copied-msg').textContent = '✓ Copied to clipboard!';
    const btn = document.querySelector('.btn-share');
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = orig, 2500); }
    setTimeout(() => { document.getElementById('copied-msg').textContent = ''; }, 2500);
  };
  const fallback = () => {
    const ta = Object.assign(document.createElement('textarea'), {
      value: window._shareText || '',
      style: 'position:fixed;opacity:0;top:0;left:0'
    });
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(window._shareText || '').then(finish).catch(() => { fallback(); finish(); });
  } else { fallback(); finish(); }
}

function skipCountry() {
  if (!state.roundOver) endRound(false);
  else nextRound();
}

// ─── SCORES ──────────────────────────────────────────────────────────────────
function saveBestScore() {
  state.bestScores.unshift({
    country:    state.current.name,
    flag:       state.current.flag,
    score:      state.score,
    clues:      state.revealed,
    difficulty: currentDifficulty,
    date:       new Date().toLocaleDateString(),
  });
  state.bestScores = state.bestScores.slice(0, 10);
  localStorage.setItem('atlasRush_scores', JSON.stringify(state.bestScores));
}

function renderScores() {
  const list = document.getElementById('scores-list');
  if (state.bestScores.length === 0) {
    list.innerHTML = '<div class="scores-empty">No scores yet — play a round!</div>';
    return;
  }
  list.innerHTML = state.bestScores.map(s => {
    const badge = s.difficulty
      ? `<span class="diff-badge diff-badge--${s.difficulty}">${s.difficulty}</span>` : '';
    return `
      <div class="score-row">
        <div class="score-row-left">
          <span class="c" aria-hidden="true">${s.flag}</span>
          <div>
            <div class="cn">${escHtml(s.country)} ${badge}</div>
            <div class="clues-used">${s.clues} clue${s.clues !== 1 ? 's' : ''} · ${s.date}</div>
          </div>
        </div>
        <div class="sc">${s.score}</div>
      </div>`;
  }).join('');
}

function updateStreakDisplay() {
  document.getElementById('streak-count').textContent = state.streak;
}

// ─── AUTOCOMPLETE ─────────────────────────────────────────────────────────────
let allCountryNames = [];
let suggestFocusIdx = -1;

function initAutocomplete() {
  allCountryNames = COUNTRIES.map(c => c.name);
  const input = document.getElementById('guess-input');

  input.addEventListener('input', function () {
    suggestFocusIdx = -1;
    const val = this.value.trim().toLowerCase();
    const box = document.getElementById('suggestions');
    if (!val) { hideSuggestions(); return; }

    const matches = allCountryNames
      .filter(n => n.toLowerCase().startsWith(val))
      .slice(0, 6);

    if (!matches.length) { hideSuggestions(); return; }

    box.innerHTML = matches.map((name, i) =>
      `<div class="sug-item"
            role="option"
            tabindex="-1"
            aria-selected="false"
            data-idx="${i}"
            data-name="${escHtml(name)}"
            onpointerdown="selectSuggestion(event,'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
       >${escHtml(name)}</div>`
    ).join('');
    box.className = 'suggestions show';
    box.setAttribute('aria-expanded', 'true');
  });

  input.addEventListener('keydown', function (e) {
    const box   = document.getElementById('suggestions');
    const items = box.querySelectorAll('.sug-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestFocusIdx = Math.min(suggestFocusIdx + 1, items.length - 1);
      updateSuggestFocus(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestFocusIdx = Math.max(suggestFocusIdx - 1, -1);
      updateSuggestFocus(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestFocusIdx >= 0 && items[suggestFocusIdx]) {
        selectSuggestion(null, items[suggestFocusIdx].dataset.name);
      } else {
        submitGuess();
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  document.addEventListener('pointerdown', function (e) {
    if (!e.target.closest('#guess-input') && !e.target.closest('#suggestions')) {
      hideSuggestions();
    }
  });
}

function updateSuggestFocus(items) {
  items.forEach((item, i) => {
    const active = i === suggestFocusIdx;
    item.classList.toggle('focused', active);
    item.setAttribute('aria-selected', String(active));
  });
  if (suggestFocusIdx >= 0 && items[suggestFocusIdx]) {
    document.getElementById('guess-input').value = items[suggestFocusIdx].dataset.name;
  }
}

function selectSuggestion(e, name) {
  if (e) e.preventDefault();
  document.getElementById('guess-input').value = name;
  hideSuggestions();
  submitGuess();
}

function hideSuggestions() {
  const box = document.getElementById('suggestions');
  box.className = 'suggestions';
  box.setAttribute('aria-expanded', 'false');
  suggestFocusIdx = -1;
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function switchTab(id) {
  const ids = ['play', 'how', 'scores'];
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    const active = ids[i] === id;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
    b.setAttribute('tabindex', active ? '0' : '-1');
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.remove('active');
    p.hidden = true;
  });
  const pane = document.getElementById('tab-' + id);
  pane.classList.add('active');
  pane.hidden = false;
}

// ─── START ────────────────────────────────────────────────────────────────────
loadCountries();