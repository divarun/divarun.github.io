// ── PUZZLE DATA ──
let PUZZLES = [];

async function loadPuzzles() {
  try {
    const res = await fetch('puzzles.json');
    PUZZLES = await res.json();
  } catch (err) {
    console.error('Failed to load puzzles:', err);
  }
}

// ── EMOJI MAP for sharing ──
const HOP_EMOJIS = ['🟢','🔵','🟣','🟡','🟠','🔴','⚫'];

// ── STATE ──
let state = {
  puzzle: null,
  queue: [],
  chain: [],         // words in current chain (not including start)
  score: 1000,
  startTime: null,
  elapsed: 0,
  timerRef: null,
  hopsUsed: 0,
  hintsUsed: 0,
  undoCount: 0,
  streak: parseInt(localStorage.getItem('ib_streak') || '0'),
  history: JSON.parse(localStorage.getItem('ib_history') || '[]'),
  done: false,
  penalties: 0,
};

async function init() {
  await loadVocab();
  await loadPuzzles();
  state.queue = shuffle([...PUZZLES]);
  document.getElementById('stat-streak').textContent = state.streak;
  renderHistory();
  nextPuzzle();
}

function shuffle(a) {
  for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

function nextPuzzle() {
  closeResult();
  if (state.queue.length === 0) state.queue = shuffle([...PUZZLES]);
  state.puzzle = state.queue.pop();
  state.chain = [];
  state.score = 1000;
  state.hopsUsed = 0;
  state.hintsUsed = 0;
  state.undoCount = 0;
  state.penalties = 0;
  state.done = false;
  state.elapsed = 0;
  clearInterval(state.timerRef);

  document.getElementById('ep-start').textContent = state.puzzle.start;
  document.getElementById('ep-target').textContent = state.puzzle.target;
  document.getElementById('word-input').value = '';
  document.getElementById('word-input').disabled = false;
  document.getElementById('submit-btn').disabled = false;
  document.getElementById('feedback').textContent = '';
  document.getElementById('reason-row').innerHTML = '';
  document.getElementById('hint-btn').disabled = false;
  hideSuggestions();

  renderChain();
  updateStats();
  updatePrompt();
  switchTab('play');

  // Start timer on first interaction
  state.startTime = null;
}

function startTimerIfNeeded() {
  if (state.startTime) return;
  state.startTime = Date.now();
  state.timerRef = setInterval(() => {
    state.elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    document.getElementById('stat-time').textContent = state.elapsed + 's';
  }, 500);
}

function submitWord() {
  if (state.done) return;
  startTimerIfNeeded();
  const raw = document.getElementById('word-input').value.trim();
  if (!raw) return;
  hideSuggestions();

  // Validate: not a duplicate in chain, not empty
  const lower = raw.toLowerCase();
  const startLower = state.puzzle.start.toLowerCase();
  const targetLower = state.puzzle.target.toLowerCase();
  const chainLower = state.chain.map(w => w.toLowerCase());

  if (lower === startLower) {
    showFeedback('That\'s the starting word!');
    shakeInput(); return;
  }
  if (chainLower.includes(lower)) {
    showFeedback('Already in your chain!');
    shakeInput(); return;
  }

  // Check if this word IS the target
  const isTarget = lower === targetLower;

  state.chain.push(isTarget ? state.puzzle.target : raw);
  state.hopsUsed++;

  // Show reason tag (fun prompt for user to confirm connection)
  showReasonTag(state.chain.length >= 2 ? state.chain[state.chain.length-2] : state.puzzle.start, raw);

  document.getElementById('word-input').value = '';
  renderChain();
  updateStats();
  updatePrompt();

  if (isTarget) {
    setTimeout(() => endPuzzle(true), 400);
  }
}

function showReasonTag(from, to) {
  const row = document.getElementById('reason-row');
  const tag = document.createElement('div');
  tag.className = 'reason-tag';
  const connections = [
    `${from} → ${to}: related`,
    `${from} leads to ${to}`,
    `${to} comes from ${from}`,
    `${from} & ${to} connected`,
  ];
  tag.textContent = connections[Math.floor(Math.random()*connections.length)];
  row.appendChild(tag);
  // Keep only last 3 tags
  while (row.children.length > 3) row.removeChild(row.firstChild);
}

function renderChain() {
  const vis = document.getElementById('chain-visual');
  vis.innerHTML = '';

  const words = [state.puzzle.start, ...state.chain];
  if (words.length === 1 && state.chain.length === 0) {
    vis.innerHTML = '<span class="chain-empty">Your chain will appear here…</span>';
    return;
  }

  words.forEach((w, i) => {
    const node = document.createElement('div');
    node.className = 'chain-node';

    const wordEl = document.createElement('span');
    wordEl.className = 'chain-word';
    if (i === 0) wordEl.classList.add('start-node');
    if (w.toLowerCase() === state.puzzle.target.toLowerCase()) wordEl.classList.add('target-node');
    wordEl.textContent = w;
    node.appendChild(wordEl);

    if (i < words.length - 1) {
      const arrow = document.createElement('span');
      arrow.className = 'chain-arrow';
      arrow.textContent = ' → ';
      node.appendChild(arrow);
    }

    vis.appendChild(node);
  });

  document.getElementById('hop-count').textContent = state.chain.length + ' hop' + (state.chain.length !== 1 ? 's' : '');
}

function updateStats() {
  const score = calcScore();
  animatePop('stat-score');
  document.getElementById('stat-hops').textContent = state.hopsUsed;
  document.getElementById('stat-score').textContent = score;
  document.getElementById('stat-streak').textContent = state.streak;
}

function calcScore() {
  const base = 1000;
  const hopPenalty = state.hopsUsed * 60;
  const timePenalty = state.elapsed * 2;
  const extraPenalty = state.penalties;
  return Math.max(0, base - hopPenalty - timePenalty - extraPenalty);
}

function animatePop(id) {
  const el = document.getElementById(id);
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 180);
}

function updatePrompt() {
  const last = state.chain.length > 0 ? state.chain[state.chain.length-1] : state.puzzle.start;
  document.getElementById('from-word').textContent = last;
  document.getElementById('to-word').textContent = state.puzzle.target;
}

function undoLast() {
  if (state.chain.length === 0 || state.done) return;
  state.chain.pop();
  state.hopsUsed = Math.max(0, state.hopsUsed - 1);
  state.penalties += 50;
  state.undoCount++;
  // Remove last reason tag
  const row = document.getElementById('reason-row');
  if (row.lastChild) row.removeChild(row.lastChild);
  renderChain();
  updateStats();
  updatePrompt();
  showFeedback('Undone. −50 pts', 'var(--ink3)');
}

function useHint() {
  if (state.done) return;
  const hint = state.puzzle.hints[state.hintsUsed];
  if (!hint) { showFeedback('No more hints!'); return; }
  state.hintsUsed++;
  state.penalties += 100;
  showFeedback('💡 Hint: ' + hint, 'var(--green)');
  updateStats();
  if (state.hintsUsed >= state.puzzle.hints.length) {
    document.getElementById('hint-btn').disabled = true;
  }
}

function skipPuzzle() {
  if (state.done) return;
  clearInterval(state.timerRef);
  endPuzzle(false);
}

function endPuzzle(won) {
  clearInterval(state.timerRef);
  state.done = true;
  document.getElementById('word-input').disabled = true;
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('feedback').textContent = '';
  hideSuggestions();

  const finalScore = won ? calcScore() : 0;

  if (won) {
    state.streak++;
  } else {
    state.streak = 0;
  }
  localStorage.setItem('ib_streak', state.streak);

  const rec = {
    start: state.puzzle.start,
    target: state.puzzle.target,
    chain: [state.puzzle.start, ...state.chain],
    score: finalScore,
    hops: state.hopsUsed,
    time: state.elapsed,
    won,
    date: new Date().toLocaleDateString()
  };
  state.history.unshift(rec);
  state.history = state.history.slice(0, 15);
  localStorage.setItem('ib_history', JSON.stringify(state.history));
  renderHistory();

  showResult(won, rec);
}

function showResult(won, rec) {
  document.getElementById('res-icon').textContent = won ? '⛓️' : '💀';
  document.getElementById('res-title').textContent = won ? 'Chain Complete!' : 'Puzzle Over';
  document.getElementById('res-sub').textContent = won
    ? `You connected ${rec.start} → ${rec.target} in ${rec.hops} hop${rec.hops!==1?'s':''}!`
    : `The chain was broken. Better luck next time!`;

  const chainWords = rec.chain;
  document.getElementById('res-chain').textContent = chainWords.join(' → ') + (won ? ` → ${state.puzzle.target}` : ' → ✗');

  document.getElementById('rs-score').textContent = rec.score;
  document.getElementById('rs-hops').textContent = rec.hops;
  document.getElementById('rs-time').textContent = rec.time + 's';

  // Build share text
  const emojiChain = rec.chain.slice(1).map((_,i) => HOP_EMOJIS[i % HOP_EMOJIS.length]).join('');
  const shareText = [
    `IdeaBridge ⛓️`,
    `${rec.start} → ${rec.target}`,
    won ? `${emojiChain}${won ? '✅' : '❌'}` : `${emojiChain}💀`,
    `${rec.hops} hops · ${rec.score} pts · ${rec.time}s`,
    `🔥 Streak: ${state.streak}`
  ].join('\n');
  document.getElementById('share-box').textContent = shareText;
  window._shareText = shareText;

  document.getElementById('result-overlay').classList.add('show');
  document.getElementById('stat-streak').textContent = state.streak;
}

function closeResult() {
  document.getElementById('result-overlay').classList.remove('show');
  document.getElementById('copied-msg').textContent = '';
}

function copyShare() {
  navigator.clipboard.writeText(window._shareText || '').then(() => {
    document.getElementById('copied-msg').textContent = '✓ Copied to clipboard!';
    setTimeout(() => { document.getElementById('copied-msg').textContent = ''; }, 2500);
  });
}

function showFeedback(msg, color) {
  const el = document.getElementById('feedback');
  el.style.color = color || 'var(--danger)';
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2500);
}

function shakeInput() {
  const inp = document.getElementById('word-input');
  inp.classList.add('shake');
  setTimeout(() => inp.classList.remove('shake'), 400);
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (state.history.length === 0) {
    list.innerHTML = '<div style="color:var(--ink3);font-size:14px;text-align:center;padding:24px 0;">No puzzles completed yet.</div>';
    return;
  }
  list.innerHTML = state.history.map(r => `
    <div class="hist-row">
      <div>
        <div class="hist-pair">${r.start}<span class="sep">⛓</span>${r.target}</div>
        <div class="hist-meta">${r.hops} hops · ${r.time}s · ${r.date} ${r.won ? '✅' : '❌'}</div>
      </div>
      <div class="hist-score">${r.score}</div>
    </div>`).join('');
}

// ── AUTOCOMPLETE / SUGGESTIONS ──
// Suggest from a broad vocabulary pool
let VOCAB = [];

async function loadVocab() {
  try {
    const res = await fetch('vocab.json');
    VOCAB = await res.json();
    console.log('Vocab loaded:', VOCAB.length);
  } catch (err) {
    console.error('Failed to load vocab:', err);
  }
}

let sugTimeout = null;

document.getElementById('word-input').addEventListener('input', function() {
  const val = this.value.trim().toLowerCase();

  if (sugTimeout) clearTimeout(sugTimeout);

  if (!val) {
    hideSuggestions();
    return;
  }

  // debounce (prevents API spam)
  sugTimeout = setTimeout(() => {
    generateSmartSuggestions(val);
  }, 250);
});

async function generateSmartSuggestions(inputVal) {
  const lastWord = state.chain.length > 0
    ? state.chain[state.chain.length - 1]
    : state.puzzle.start;

  let suggestions = [];

  try {
    // 🔥 Datamuse semantic query
    const res = await fetch(
      `https://api.datamuse.com/words?ml=${encodeURIComponent(lastWord)}&max=10`
    );

    const data = await res.json();

    suggestions = data
      .map(w => capitalize(w.word))
      .filter(w => w.length > 2);
  } catch (err) {
    console.warn('Datamuse failed, using fallback');
  }

  // 🛟 FALLBACK (or supplement)
  if (suggestions.length < 5) {
    const fallback = VOCAB.filter(w =>
      w.toLowerCase().includes(inputVal) ||
      w.toLowerCase().includes(lastWord.toLowerCase())
    );

    suggestions = [...new Set([...suggestions, ...fallback])]
      .slice(0, 8);
  }

  // 🎯 Always include target if relevant
  const target = state.puzzle.target;
  if (
    target &&
    !suggestions.includes(target) &&
    target.toLowerCase().includes(inputVal)
  ) {
    suggestions.unshift(target);
  }

  renderSuggestions(suggestions.slice(0, 6));
}
function renderSuggestions(list) {
  if (!list.length) {
    hideSuggestions();
    return;
  }

  const box = document.getElementById('suggestions');

  box.innerHTML = list.map(w => `
    <div class="sug-item" onclick="selectSug('${w.replace(/'/g,"\\'")}')">
      <span>${w}</span>
      <span class="sug-link">use</span>
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
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    const ids = ['play','how','history'];
    b.classList.toggle('active', ids[i] === id);
  });
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
}

init();