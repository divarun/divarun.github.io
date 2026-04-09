let COUNTRIES = [];

async function loadCountries() {
  try {
    const res = await fetch('countries.json');
    if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
    COUNTRIES = await res.json();
    console.log("✅ Countries loaded:", COUNTRIES.length);
    init();
  } catch (err) {
    console.error("❌ Failed to load countries JSON:", err);
  }
}

// ─── DIFFICULTY FILTERING ───
// Territories, micronations, and obscure places get filtered out in Easy/Medium.
const HARD_ONLY_KEYWORDS = [
  'territory','islands','island','saint ','st.','sint ','dependency',
  'reunion','mayotte','guiana','guadeloupe','martinique','jersey','guernsey',
  'cayman','gibraltar','bermuda','aruba','curacao','bonaire','montserrat',
  'falkland','pitcairn','tokelau','wallis','niue','palau','nauru','tuvalu',
  'kiribati','marshall','micronesia','cook islands','antarctica','svalbard',
  'faroe','aland','french polynesia','new caledonia','western sahara',
  'american samoa','northern mariana','puerto rico','virgin','cocos',
  'christmas','norfolk','heard','south georgia','british indian',
  'french guiana','saint martin','saint barthelemy','sint maarten',
  'saint pierre','turks','anguilla','british virgin'
];

const MEDIUM_SMALL_POP = 500000; // filter below this in Easy

function getFilteredCountries(difficulty) {
  if (difficulty === 'hard') return COUNTRIES;

  return COUNTRIES.filter(c => {
    const nameLower = c.name.toLowerCase();
    const isHardOnly = HARD_ONLY_KEYWORDS.some(kw => nameLower.includes(kw));
    if (isHardOnly) return false;

    if (difficulty === 'easy') {
      const popNum = parsePopulation(c.pop);
      return popNum >= 5000000; // Easy: 5M+ population countries
    }
    // medium: exclude tiny territories but keep everything else
    const popNum = parsePopulation(c.pop);
    return popNum >= MEDIUM_SMALL_POP;
  });
}

function parsePopulation(popStr) {
  if (!popStr) return 0;
  const s = popStr.replace(/[~,\s]/g, '');
  const num = parseFloat(s);
  if (s.includes('billion')) return num * 1e9;
  if (s.toLowerCase().includes('million')) return num * 1e6;
  if (s.toLowerCase().includes('thousand')) return num * 1e3;
  return num || 0;
}

// ─── ALTERNATE NAMES ───
// Maps common aliases → canonical country name (lowercase)
const ALT_NAMES = {
  'usa': 'united states',
  'us': 'united states',
  'united states of america': 'united states',
  'america': 'united states',
  'uae': 'united arab emirates',
  'uk': 'united kingdom',
  'great britain': 'united kingdom',
  'england': 'united kingdom',
  "cote d'ivoire": 'ivory coast',
  "côte d'ivoire": 'ivory coast',
  'republic of china': 'taiwan',
  'czech republic': 'czechia',
  'russia': 'russia',
  'south korea': 'south korea',
  'north korea': 'north korea',
  'drc': 'democratic republic of the congo',
  'congo-kinshasa': 'democratic republic of the congo',
  'roc': 'republic of the congo',
  'congo-brazzaville': 'republic of the congo',
  'myanmar': 'myanmar',
  'burma': 'myanmar',
  'holland': 'netherlands',
  'the netherlands': 'netherlands',
  'iran': 'iran',
  'persia': 'iran',
  'vietnam': 'vietnam',
  'viet nam': 'vietnam',
  'palestine': 'palestine',
  'eswatini': 'eswatini',
  'swaziland': 'eswatini',
  'north macedonia': 'north macedonia',
  'macedonia': 'north macedonia',
  'cape verde': 'cabo verde',
};

function normalizeGuess(raw) {
  const s = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  return ALT_NAMES[s] || s;
}

const CLUE_KEYS   = ["continent","pop","flag","borders","capital","landmark","hint"];
const CLUE_LABELS = ["Continent","Population","Flag","Borders","Capital","Famous Landmark","Letter Hint"];
const CLUE_ICONS  = ["🌍","👥","🏳️","🗺️","🏛️","📸","🔤"];
const MAX_SCORE   = 1000;
const CLUE_COST   = 150;
const WRONG_COST  = 50;

let currentDifficulty = 'medium';
let activePool = [];

let state = {
  queue: [],
  current: null,
  revealed: 0,
  score: MAX_SCORE,
  wrongGuesses: 0,
  streak: 0,
  bestScores: JSON.parse(localStorage.getItem('atlasRush_scores') || '[]'),
  roundOver: false,
  emojiLog: [],
};

function shuffle(arr) {
  let a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  setDifficulty(currentDifficulty, false);
  updateStreakDisplay();
  renderScores();
  initAutocomplete();
  initDifficultyButtons();
}

function setDifficulty(diff, restartRound = true) {
  currentDifficulty = diff;
  activePool = getFilteredCountries(diff);
  state.queue = shuffle(activePool);

  document.querySelectorAll('.diff-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.diff === diff);
  });

  if (restartRound) {
    state.streak = 0;
    updateStreakDisplay();
    nextRound();
  } else {
    nextRound();
  }
}

function initDifficultyButtons() {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => setDifficulty(btn.dataset.diff));
  });
}

function nextRound() {
  if (state.queue.length === 0) state.queue = shuffle(activePool);
  state.current = state.queue.pop();
  state.revealed = 0;
  state.score = MAX_SCORE;
  state.wrongGuesses = 0;
  state.roundOver = false;
  state.emojiLog = [];

  document.getElementById('result-card').classList.remove('show');
  document.getElementById('guess-input').value = '';
  document.getElementById('guess-input').classList.remove('wrong');
  document.getElementById('feedback').textContent = '';
  document.getElementById('suggestions').className = 'suggestions';
  document.getElementById('guess-input').disabled = false;
  document.getElementById('guess-btn').disabled = false;

  revealClue(0);
  renderLocked();
  renderProgress();
  updateScoreDisplay();
  switchTab('play');
}

function revealClue(idx) {
  const key = CLUE_KEYS[idx];
  let val = state.current[key];

  if (key === "flag") {
    val = `
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="https://flagcdn.com/w160/${state.current.code}.png"
             style="width:64px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.4);"
             alt="Flag of ${state.current.name}">
        <span style="font-size:14px;color:var(--muted);">Flag</span>
      </div>
    `;
  }

  state.revealed = idx + 1;

  const stack = document.getElementById('clues-stack');
  if (idx === 0) stack.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'clue-card' + (idx === 0 ? ' first' : '');
  card.innerHTML = `
    <div class="clue-icon">${CLUE_ICONS[idx]}</div>
    <div class="clue-content">
      <div class="clue-label">${CLUE_LABELS[idx]}</div>
      <div class="clue-value">${val}</div>
    </div>`;
  stack.appendChild(card);

  document.getElementById('clue-num').textContent = state.revealed;
  renderLocked();
  renderProgress();
  updateRevealBtn();
}

function renderLocked() {
  const row = document.getElementById('locked-row');
  row.innerHTML = '';
  const lockSVG = `<svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  for (let i = state.revealed; i < CLUE_KEYS.length; i++) {
    const pill = document.createElement('div');
    pill.className = 'locked-pill';
    pill.innerHTML = `${lockSVG}${CLUE_LABELS[i]}`;
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
      // Round ended — colour all revealed dots
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
    cost.textContent = `−${CLUE_COST} pts`;
  }
}

function revealNextClue() {
  if (state.roundOver || state.revealed >= CLUE_KEYS.length) return;
  state.score = Math.max(0, state.score - CLUE_COST);
  state.emojiLog.push('🟡');
  revealClue(state.revealed);
  updateScoreDisplay();
}

function updateScoreDisplay(animate) {
  const el = document.getElementById('score-display');
  el.textContent = state.score;

  // Color shifts: green → yellow → orange → red
  el.classList.remove('score-high','score-mid','score-low','score-critical');
  if (state.score >= 700)       el.classList.add('score-high');
  else if (state.score >= 450)  el.classList.add('score-mid');
  else if (state.score >= 200)  el.classList.add('score-low');
  else                          el.classList.add('score-critical');

  if (animate) {
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 200);
  }
}

function submitGuess() {
  if (state.roundOver) return;
  const raw = document.getElementById('guess-input').value.trim();
  if (!raw) return;
  hideSuggestions();

  const guess  = normalizeGuess(raw);
  const answer = state.current.name.toLowerCase();
  // Also accept answer without spaces (e.g. "unitedstates")
  const answerNS = answer.replace(/\s+/g,'');

  if (guess === answer || guess === answerNS || guess.replace(/\s+/g,'') === answerNS) {
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
    fb.textContent = `"${raw}" is not correct. −${WRONG_COST} pts`;
    setTimeout(() => { fb.textContent = ''; }, 2200);

    if (state.score <= 0) {
      state.score = 0;
      endRound(false);
    }
  }
}

function endRound(won) {
  state.roundOver = true;
  document.getElementById('guess-input').disabled = true;
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

  renderProgress(won); // recolour all revealed dots
  updateStreakDisplay();
  renderScores();
  showResult(won);
}

function showResult(won) {
  document.getElementById('res-flag').innerHTML =
    `<img src="https://flagcdn.com/w320/${state.current.code}.png"
          style="width:90px;border-radius:10px;"
          alt="Flag of ${state.current.name}">`;
  document.getElementById('res-country').textContent = state.current.name;
  document.getElementById('res-subtitle').textContent = won
    ? `Correct! 🎉 Identified in ${state.revealed} clue${state.revealed !== 1 ? 's' : ''}`
    : `Not quite — it was ${state.current.name}`;
  document.getElementById('rs-score').textContent = state.score;
  document.getElementById('rs-clues').textContent = state.revealed;
  document.getElementById('rs-streak').textContent = state.streak;
  buildShareBlock(won);
  document.getElementById('result-card').classList.add('show');
}

function buildShareBlock(won) {
  const header   = `AtlasRush 🌍`;
  const scoreStr = `Score: ${state.score} pts`;
  const clueStr  = `Clues used: ${state.revealed}/${CLUE_KEYS.length}`;
  const log      = state.emojiLog.join('');
  const diffLabel = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
  const share    = `${header} [${diffLabel}]\n${state.current.flag} ${state.current.name}\n${log}\n${scoreStr} | ${clueStr}\nStreak: 🔥${state.streak}`;
  document.getElementById('share-block').textContent = share;
  window._shareText = share;
}

function copyShare() {
  navigator.clipboard.writeText(window._shareText || '').then(() => {
    document.getElementById('copied-msg').textContent = '✓ Copied to clipboard!';
    setTimeout(() => { document.getElementById('copied-msg').textContent = ''; }, 2500);
  });
}

function skipCountry() {
  if (!state.roundOver) endRound(false);
  else nextRound();
}

function saveBestScore() {
  state.bestScores.unshift({
    country:    state.current.name,
    flag:       state.current.flag,
    score:      state.score,
    clues:      state.revealed,
    difficulty: currentDifficulty,
    date:       new Date().toLocaleDateString()
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
    const diffBadge = s.difficulty
      ? `<span class="diff-badge diff-badge--${s.difficulty}">${s.difficulty}</span>`
      : '';
    return `
      <div class="score-row">
        <div style="display:flex;align-items:center;">
          <span class="c">${s.flag}</span>
          <div>
            <div class="cn">${s.country} ${diffBadge}</div>
            <div class="clues-used">${s.clues} clue${s.clues!==1?'s':''} · ${s.date}</div>
          </div>
        </div>
        <div class="sc">${s.score}</div>
      </div>`;
  }).join('');
}

function updateStreakDisplay() {
  document.getElementById('streak-count').textContent = state.streak;
}

// ─── AUTOCOMPLETE with keyboard navigation ───

let allCountryNames = [];
let suggestFocusIdx = -1;

function initAutocomplete() {
  allCountryNames = COUNTRIES.map(c => c.name);

  const input = document.getElementById('guess-input');

  input.addEventListener('input', function() {
    suggestFocusIdx = -1;
    const val = this.value.trim().toLowerCase();
    const box = document.getElementById('suggestions');

    if (!val) { hideSuggestions(); return; }

    const matches = allCountryNames
      .filter(n => n.toLowerCase().startsWith(val))
      .slice(0, 6);

    if (matches.length === 0) { hideSuggestions(); return; }

    box.innerHTML = matches.map((name, i) =>
      `<div class="sug-item" role="option" tabindex="-1"
            data-idx="${i}" data-name="${name}"
            onclick="selectSuggestion('${name.replace(/'/g,"\\'")}')">
        ${name}
      </div>`
    ).join('');
    box.className = 'suggestions show';
  });

  input.addEventListener('keydown', function(e) {
    const box = document.getElementById('suggestions');
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
      if (suggestFocusIdx >= 0 && items[suggestFocusIdx]) {
        selectSuggestion(items[suggestFocusIdx].dataset.name);
      } else {
        submitGuess();
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('#guess-input') && !e.target.closest('#suggestions')) {
      hideSuggestions();
    }
  });
}

function updateSuggestFocus(items) {
  items.forEach((item, i) => {
    item.classList.toggle('focused', i === suggestFocusIdx);
  });
  if (suggestFocusIdx >= 0 && items[suggestFocusIdx]) {
    document.getElementById('guess-input').value = items[suggestFocusIdx].dataset.name;
  }
}

function selectSuggestion(name) {
  document.getElementById('guess-input').value = name;
  hideSuggestions();
  submitGuess();
}

function hideSuggestions() {
  document.getElementById('suggestions').className = 'suggestions';
  suggestFocusIdx = -1;
}

// ─── TABS ───
function switchTab(id) {
  const ids = ['play','how','scores'];
  document.querySelectorAll('.tab-btn').forEach((b,i) => {
    const active = ids[i] === id;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
}

loadCountries();