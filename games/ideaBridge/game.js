// ── PUZZLE DATA ──
let PUZZLES = [];
let VOCAB   = [];

async function loadData() {
  try {
    const [pRes, vRes] = await Promise.all([
      fetch('puzzles.json'),
      fetch('vocab.json')
    ]);
    PUZZLES = await pRes.json();
    VOCAB   = await vRes.json();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

// ── EMOJI MAP ──
const HOP_EMOJIS = ['🟢','🔵','🟣','🟡','🟠','🔴','⚫'];

// ── STATE ──
let state = {
  puzzle:     null,
  queue:      [],
  chain:      [],        // words added after start (not including start)
  score:      1000,
  startTime:  null,
  elapsed:    0,
  timerRef:   null,
  hopsUsed:   0,
  hintsUsed:  0,
  undoCount:  0,
  streak:     parseInt(localStorage.getItem('ib_streak') || '0'),
  history:    JSON.parse(localStorage.getItem('ib_history') || '[]'),
  done:       false,
  penalties:  0,
  validating: false,     // true while API check is in flight
};

async function init() {
  await loadData();
  state.queue = shuffle([...PUZZLES]);
  document.getElementById('stat-streak').textContent = state.streak;
  renderHistory();
  nextPuzzle();
  document.getElementById('year').textContent = new Date().getFullYear();
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── WORD VALIDATION ──
// Philosophy: generous first, strict only as last resort.
// The game is about creative lateral thinking — we trust the player's
// reasoning. We only reject a word if the API has never heard of it.
//
// One parallel batch of wide-net Datamuse queries:
//   ml      = "means like" / semantic similarity  (max 100)
//   rel_trg = free-association triggers            (max 100)
//   rel_bga = words that follow in bigrams         (max 50)
//   rel_bgb = words that precede in bigrams        (max 50)
//
// Accept if ANY of these signals fire:
//   1. Vocab shortcut — both words are in the curated vocab list → always pass
//   2. Direct hit    — each word appears in the other's cloud
//   3. Shared bridge — 2+ common neighbours between the two clouds
//   4. One-sided hit — one word in vocab AND appears in the other's cloud
//   5. Both known    — API knows both words → trust the player's logic
//
// Only reject if API returns nothing for one of the words (not a real word).

const validationCache = new Map();

async function checkConnection(fromWord, toWord) {
  const key = fromWord.toLowerCase() + '|' + toWord.toLowerCase();
  if (validationCache.has(key)) return validationCache.get(key);

  const from    = encodeURIComponent(fromWord.toLowerCase());
  const to      = encodeURIComponent(toWord.toLowerCase());
  const fromLow = fromWord.toLowerCase();
  const toLow   = toWord.toLowerCase();

  // Signal 1: vocab shortcut — both words are curated concepts, always allow
  const inVocab = w => VOCAB.some(v => v.toLowerCase() === w);
  if (inVocab(fromLow) && inVocab(toLow)) {
    const result = { valid: true, reason: 'known concepts — connection accepted' };
    validationCache.set(key, result);
    return result;
  }

  try {
    const [mlFrom, trgFrom, bgaFrom, mlTo, trgTo, bgbTo] = await Promise.all([
      fetch('https://api.datamuse.com/words?ml='      + from + '&max=100').then(r=>r.json()).catch(()=>[]),
      fetch('https://api.datamuse.com/words?rel_trg=' + from + '&max=100').then(r=>r.json()).catch(()=>[]),
      fetch('https://api.datamuse.com/words?rel_bga=' + from + '&max=50' ).then(r=>r.json()).catch(()=>[]),
      fetch('https://api.datamuse.com/words?ml='      + to   + '&max=100').then(r=>r.json()).catch(()=>[]),
      fetch('https://api.datamuse.com/words?rel_trg=' + to   + '&max=100').then(r=>r.json()).catch(()=>[]),
      fetch('https://api.datamuse.com/words?rel_bgb=' + to   + '&max=50' ).then(r=>r.json()).catch(()=>[]),
    ]);

    const cloudFrom = new Set([...mlFrom, ...trgFrom, ...bgaFrom].map(w => w.word.toLowerCase()));
    const cloudTo   = new Set([...mlTo,   ...trgTo,   ...bgbTo  ].map(w => w.word.toLowerCase()));

    // Signal 2: direct hit — each word appears in the other's cloud
    if (cloudFrom.has(toLow) || cloudTo.has(fromLow)) {
      const result = { valid: true, reason: 'directly related' };
      validationCache.set(key, result);
      return result;
    }

    // Signal 3: shared bridge — at least 2 common neighbours
    const shared = [...cloudFrom].filter(w => cloudTo.has(w));
    if (shared.length >= 2) {
      const result = { valid: true, reason: 'both relate to "' + shared[0] + '"' };
      validationCache.set(key, result);
      return result;
    }

    // Signal 4: one word in vocab AND in the other's cloud
    if ((inVocab(fromLow) && cloudTo.has(fromLow)) ||
        (inVocab(toLow)   && cloudFrom.has(toLow))) {
      const result = { valid: true, reason: 'conceptually linked' };
      validationCache.set(key, result);
      return result;
    }

    // Signal 5: API knows both words — trust the player
    const apiKnowsFrom = mlFrom.length > 0 || trgFrom.length > 0;
    const apiKnowsTo   = mlTo.length   > 0 || trgTo.length   > 0;
    if (apiKnowsFrom && apiKnowsTo) {
      const result = { valid: true, reason: 'connection accepted — your reasoning counts!' };
      validationCache.set(key, result);
      return result;
    }

    // Reject only if one word is unrecognised
    const unknown = apiKnowsFrom ? toWord : fromWord;
    const result = { valid: false, reason: '"' + unknown + '" doesn\'t look like a recognised word' };
    validationCache.set(key, result);
    return result;

  } catch (err) {
    console.warn('Validation API error, allowing word:', err);
    return { valid: true, reason: 'connection assumed (offline)' };
  }
}

// ── NEXT PUZZLE ──
function nextPuzzle() {
  hideResult();
  if (state.queue.length === 0) state.queue = shuffle([...PUZZLES]);
  state.puzzle     = state.queue.pop();
  state.chain      = [];
  state.score      = 1000;
  state.hopsUsed   = 0;
  state.hintsUsed  = 0;
  state.undoCount  = 0;
  state.penalties  = 0;
  state.done       = false;
  state.elapsed    = 0;
  state.validating = false;
  state.startTime  = null;
  clearInterval(state.timerRef);

  document.getElementById('ep-start').textContent    = state.puzzle.start;
  document.getElementById('ep-target').textContent   = state.puzzle.target;
  document.getElementById('word-input').value        = '';
  document.getElementById('word-input').disabled     = false;
  document.getElementById('submit-btn').disabled     = false;
  document.getElementById('feedback').textContent    = '';
  document.getElementById('feedback').className      = 'feedback';
  document.getElementById('hint-btn').disabled       = false;
  document.getElementById('validation-note').textContent = '';
  document.getElementById('validation-note').className   = 'chain-validation-note';
  hideSuggestions();
  renderChain();
  updateStats();
  updatePrompt();
  switchTab('play');
}

function startTimerIfNeeded() {
  if (state.startTime) return;
  state.startTime = Date.now();
  state.timerRef  = setInterval(() => {
    state.elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    document.getElementById('stat-time').textContent = state.elapsed + 's';
  }, 500);
}

// ── SUBMIT WORD ──
async function submitWord() {
  if (state.done || state.validating) return;

  const raw   = document.getElementById('word-input').value.trim();
  if (!raw) return;
  hideSuggestions();

  const lower      = raw.toLowerCase();
  const startLower = state.puzzle.start.toLowerCase();
  const targLower  = state.puzzle.target.toLowerCase();
  const chainLower = state.chain.map(w => w.toLowerCase());

  if (lower === startLower) {
    showFeedback("That's the starting word — enter something new.");
    shakeInput(); return;
  }
  if (chainLower.includes(lower)) {
    showFeedback('Already in your chain.');
    shakeInput(); return;
  }

  startTimerIfNeeded();

  // Get previous word (the word this new one must connect to)
  const prevWord = state.chain.length > 0
    ? state.chain[state.chain.length - 1]
    : state.puzzle.start;

  // ── Validate connection via Datamuse ──
  setValidating(true);

  const { valid, reason } = await checkConnection(prevWord, raw);

  setValidating(false);

  if (!valid) {
    showFeedback(`Not accepted: ${reason}. Try a word more closely related to "${prevWord}".`);
    shakeInput();
    setValidationNote('invalid', `"${raw}" doesn't connect to "${prevWord}"`);
    return;
  }

  // Word accepted
  const isTarget = lower === targLower;
  state.chain.push(isTarget ? state.puzzle.target : raw);
  state.hopsUsed++;

  setValidationNote('valid', reason);
  showFeedback(`✓ "${raw}" accepted — ${reason}`, 'positive');
  document.getElementById('word-input').value = '';

  renderChain();
  updateStats();
  updatePrompt();

  if (isTarget) {
    setTimeout(() => endPuzzle(true), 500);
  }
}

function setValidating(on) {
  state.validating = on;
  const input = document.getElementById('word-input');
  const btn   = document.getElementById('submit-btn');
  input.disabled = on;
  btn.disabled   = on;
  if (on) {
    input.classList.add('checking');
    setValidationNote('checking', 'checking connection…');
    showFeedback('Checking connection…', 'info');
  } else {
    input.classList.remove('checking');
    input.disabled = state.done;
    btn.disabled   = state.done;
  }
}

function setValidationNote(type, text) {
  const el = document.getElementById('validation-note');
  el.className = 'chain-validation-note ' + type;
  el.textContent = text;
}

// ── RENDER CHAIN ──
function renderChain() {
  const vis   = document.getElementById('chain-visual');
  const words = [state.puzzle.start, ...state.chain];
  vis.innerHTML = '';

  if (state.chain.length === 0) {
    vis.innerHTML = '<span class="chain-empty">Start by entering a word below ↓</span>';
    document.getElementById('hop-count').textContent = '0 hops';
    return;
  }

  words.forEach((w, i) => {
    const node    = document.createElement('div');
    node.className = 'chain-node';
    node.setAttribute('role', 'listitem');

    const wordEl = document.createElement('span');
    wordEl.className = 'chain-word';
    if (i === 0) wordEl.classList.add('start-node');
    else if (w.toLowerCase() === state.puzzle.target.toLowerCase()) wordEl.classList.add('target-node');
    else wordEl.classList.add('valid-node');
    wordEl.textContent = w;
    node.appendChild(wordEl);

    if (i < words.length - 1) {
      const arrow = document.createElement('span');
      arrow.className = 'chain-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      node.appendChild(arrow);
    }
    vis.appendChild(node);
  });

  const hops = state.chain.length;
  document.getElementById('hop-count').textContent = hops + ' hop' + (hops !== 1 ? 's' : '');
}

// ── STATS ──
function updateStats() {
  const score = calcScore();
  animatePop('stat-score');
  document.getElementById('stat-hops').textContent  = state.hopsUsed;
  document.getElementById('stat-score').textContent = score;
  document.getElementById('stat-streak').textContent = state.streak;
}

function calcScore() {
  return Math.max(0,
    1000
    - state.hopsUsed * 60
    - state.elapsed  * 2
    - state.penalties
  );
}

function animatePop(id) {
  const el = document.getElementById(id);
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 180);
}

function updatePrompt() {
  const last = state.chain.length > 0 ? state.chain[state.chain.length - 1] : state.puzzle.start;
  document.getElementById('from-word').textContent = last;
  document.getElementById('to-word').textContent   = state.puzzle.target;
}

// ── UNDO ──
function undoLast() {
  if (state.chain.length === 0 || state.done || state.validating) return;
  state.chain.pop();
  state.hopsUsed   = Math.max(0, state.hopsUsed - 1);
  state.penalties += 50;
  state.undoCount++;
  renderChain();
  updateStats();
  updatePrompt();
  setValidationNote('', '');
  showFeedback('Undone. −50 pts');
}

// ── HINT ──
function useHint() {
  if (state.done || state.validating) return;
  const hint = state.puzzle.hints[state.hintsUsed];
  if (!hint) { showFeedback('No more hints available.'); return; }
  state.hintsUsed++;
  state.penalties += 100;
  showFeedback('Hint: ' + hint, 'positive');
  updateStats();
  if (state.hintsUsed >= state.puzzle.hints.length) {
    document.getElementById('hint-btn').disabled = true;
  }
}

// ── SKIP ──
function skipPuzzle() {
  if (state.done) return;
  clearInterval(state.timerRef);
  endPuzzle(false);
}

// ── END PUZZLE ──
function endPuzzle(won) {
  clearInterval(state.timerRef);
  state.done = true;
  document.getElementById('word-input').disabled  = true;
  document.getElementById('submit-btn').disabled  = true;
  document.getElementById('feedback').textContent = '';
  hideSuggestions();

  const finalScore = won ? calcScore() : 0;

  if (won) state.streak++;
  else     state.streak = 0;
  localStorage.setItem('ib_streak', state.streak);

  const rec = {
    start:  state.puzzle.start,
    target: state.puzzle.target,
    chain:  [state.puzzle.start, ...state.chain],
    score:  finalScore,
    hops:   state.hopsUsed,
    time:   state.elapsed,
    won,
    date:   new Date().toLocaleDateString()
  };

  state.history.unshift(rec);
  state.history = state.history.slice(0, 15);
  localStorage.setItem('ib_history', JSON.stringify(state.history));
  renderHistory();
  showResult(won, rec);
}

// ── SHOW RESULT ──
function showResult(won, rec) {
  document.getElementById('res-icon').textContent  = won ? '⛓️' : '✗';
  document.getElementById('res-title').textContent = won ? 'Chain Complete!' : 'Puzzle Over';
  document.getElementById('res-sub').textContent   = won
    ? `You connected ${rec.start} → ${rec.target} in ${rec.hops} hop${rec.hops !== 1 ? 's' : ''}!`
    : `The puzzle was skipped. Better luck next time!`;

  document.getElementById('res-chain').textContent =
    rec.chain.join(' → ') + (won ? ` → ${state.puzzle.target}` : ' → ✗');

  document.getElementById('rs-score').textContent = rec.score;
  document.getElementById('rs-hops').textContent  = rec.hops;
  document.getElementById('rs-time').textContent  = rec.time + 's';

  // Build share text
  const emojiChain = rec.chain.slice(1)
    .map((_, i) => HOP_EMOJIS[i % HOP_EMOJIS.length]).join('');
  const shareText = [
    'IdeaBridge ⛓️',
    `${rec.start} → ${rec.target}`,
    won ? `${emojiChain}✅` : `${emojiChain}❌`,
    `${rec.hops} hops · ${rec.score} pts · ${rec.time}s`,
    `🔥 Streak: ${state.streak}`
  ].join('\n');

  document.getElementById('share-box').textContent = shareText;
  window._shareText = shareText;
  document.getElementById('stat-streak').textContent = state.streak;

  const card = document.getElementById('result-card');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() {
  const card = document.getElementById('result-card');
  card.style.display = 'none';
  document.getElementById('copied-msg').textContent = '';
}

function copyShare() {
  navigator.clipboard.writeText(window._shareText || '').then(() => {
    document.getElementById('copied-msg').textContent = '✓ Copied to clipboard!';
    setTimeout(() => { document.getElementById('copied-msg').textContent = ''; }, 2500);
  });
}

// ── FEEDBACK ──
function showFeedback(msg, type) {
  const el = document.getElementById('feedback');
  el.className = 'feedback' + (type ? ' ' + type : '');
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
}

function shakeInput() {
  const inp = document.getElementById('word-input');
  inp.classList.add('shake');
  setTimeout(() => inp.classList.remove('shake'), 400);
}

// ── HISTORY ──
function renderHistory() {
  const list = document.getElementById('history-list');
  if (state.history.length === 0) {
    list.innerHTML = '<div class="history-empty">No puzzles completed yet.</div>';
    return;
  }
  list.innerHTML = state.history.map(r => `
    <div class="hist-row">
      <div>
        <div class="hist-pair">${r.start}<span class="sep" aria-hidden="true">⛓</span>${r.target}</div>
        <div class="hist-meta">${r.hops} hop${r.hops !== 1 ? 's' : ''} · ${r.time}s · ${r.date} ${r.won ? '✅' : '❌'}</div>
      </div>
      <div class="hist-score">${r.score}</div>
    </div>`).join('');
}

// ── AUTOCOMPLETE / SUGGESTIONS ──
let sugTimeout = null;

document.getElementById('word-input').addEventListener('input', function() {
  const val = this.value.trim().toLowerCase();
  if (sugTimeout) clearTimeout(sugTimeout);
  if (!val) { hideSuggestions(); return; }
  sugTimeout = setTimeout(() => generateSuggestions(val), 250);
});

async function generateSuggestions(inputVal) {
  const lastWord = state.chain.length > 0
    ? state.chain[state.chain.length - 1]
    : state.puzzle.start;

  let suggestions = [];

  try {
    // Get words semantically related to the last word in chain
    const res  = await fetch(
      `https://api.datamuse.com/words?ml=${encodeURIComponent(lastWord)}&max=20`
    );
    const data = await res.json();

    suggestions = data
      .map(w => capitalize(w.word))
      .filter(w =>
        w.length > 2 &&
        w.toLowerCase().startsWith(inputVal) &&
        !state.chain.map(c => c.toLowerCase()).includes(w.toLowerCase()) &&
        w.toLowerCase() !== state.puzzle.start.toLowerCase()
      );
  } catch (err) {
    // Fallback to vocab
  }

  // Supplement with vocab filter
  if (suggestions.length < 4) {
    const fallback = VOCAB
      .filter(w =>
        w.toLowerCase().startsWith(inputVal) &&
        !suggestions.map(s => s.toLowerCase()).includes(w.toLowerCase())
      )
      .slice(0, 4 - suggestions.length);
    suggestions = [...suggestions, ...fallback];
  }

  // Always pin target if it matches
  const target = state.puzzle.target;
  if (target && target.toLowerCase().startsWith(inputVal) && !suggestions.includes(target)) {
    suggestions.unshift(target);
  }

  renderSuggestions(suggestions.slice(0, 6));
}

function renderSuggestions(list) {
  if (!list.length) { hideSuggestions(); return; }
  const box = document.getElementById('suggestions');
  box.innerHTML = list.map(w => `
    <div class="sug-item" role="option" tabindex="0"
         onclick="selectSug('${w.replace(/'/g, "\\'")}')"
         onkeydown="if(event.key==='Enter')selectSug('${w.replace(/'/g, "\\'")}')">
      <span>${w}</span>
      <span class="sug-rel">related</span>
    </div>
  `).join('');
  box.className = 'suggestions open';
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

document.getElementById('word-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') submitWord();
});

function selectSug(w) {
  document.getElementById('word-input').value = w;
  hideSuggestions();
  submitWord();
}

function hideSuggestions() {
  document.getElementById('suggestions').className = 'suggestions';
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('#word-input') && !e.target.closest('#suggestions')) hideSuggestions();
});

// ── TABS ──
function switchTab(id) {
  const ids = ['play', 'how', 'history'];
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    const active = ids[i] === id;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
}

// ── BOOT ──
init();