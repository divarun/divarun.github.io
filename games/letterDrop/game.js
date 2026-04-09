// ── WORD BANK ──
let WORD_BANK = {};

async function loadWords() {
  try {
    const res = await fetch('words.json');
    WORD_BANK = await res.json();
  } catch (err) {
    console.error('Failed to load word bank:', err);
  }
}

// ── STATE ──
let gs = {
  running:         false,
  paused:          false,
  score:           0,
  wordsCorrect:    0,
  level:           1,
  lives:           3,
  combo:           1,
  comboTimer:      null,
  tiles:           [],
  usedWords:       new Set(),
  bestScores:      JSON.parse(localStorage.getItem('ld_scores') || '[]'),
  raf:             null,
  spawnInterval:   null,
  lastCorrectTime: 0,
};

const TILE_W = () => window.innerWidth <= 480 ? 88 : 108;
const ARENA_H = () => document.getElementById('arena').offsetHeight;

// ── LEVEL → DIFFICULTY TIER ──
function getTier() {
  if (gs.level <= 2) return 'easy';
  if (gs.level <= 4) return 'medium';
  if (gs.level <= 6) return 'hard';
  return 'expert';
}

async function startGame() {
  if (Object.keys(WORD_BANK).length === 0) await loadWords();

  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('answer-input').disabled = false;
  document.getElementById('submit-btn').disabled   = false;
  document.getElementById('answer-input').focus();

  gs.running   = true;
  gs.paused    = false;
  gs.score     = 0;
  gs.wordsCorrect = 0;
  gs.level     = 1;
  gs.lives     = 3;
  gs.combo     = 1;
  gs.tiles     = [];
  gs.usedWords = new Set();
  gs.lastCorrectTime = 0;

  document.getElementById('arena').innerHTML  = '';
  document.getElementById('ground').innerHTML = '';
  document.getElementById('def-strip').textContent = 'Solve a word to see its definition here.';
  document.getElementById('def-strip').classList.remove('faded');
  document.getElementById('feedback').textContent = '';

  updateUI();
  renderLives();

  clearInterval(gs.spawnInterval);
  spawnTile();
  gs.spawnInterval = setInterval(spawnTile, spawnDelay());

  requestAnimationFrame(gameLoop);
}

function restartGame() {
  document.getElementById('game-over-overlay').classList.remove('show');
  document.getElementById('answer-input').value = '';
  startGame();
}

function spawnDelay() {
  // Faster spawn at higher levels; floor at 1400ms
  return Math.max(1400, 3000 - (gs.level - 1) * 220);
}

function fallDuration() {
  // Faster fall at higher levels; floor at 3500ms
  return Math.max(3500, 8500 - (gs.level - 1) * 550);
}

function getWord() {
  const tier = getTier();
  let pool = WORD_BANK[tier] || WORD_BANK.easy;
  let filtered = pool.filter(w => !gs.usedWords.has(w[1]));
  if (filtered.length === 0) {
    // Exhausted this tier — clear and retry
    pool.forEach(w => gs.usedWords.delete(w[1]));
    filtered = pool;
  }
  return filtered[Math.floor(Math.random() * filtered.length)];
}

function spawnTile() {
  if (!gs.running || gs.paused) return;

  const [scrambled, answer, hint, def] = getWord();
  gs.usedWords.add(answer);

  const arena   = document.getElementById('arena');
  const arenaW  = arena.offsetWidth;
  const tileW   = TILE_W();
  const maxX    = arenaW - tileW - 10;
  const x       = 10 + Math.floor(Math.random() * Math.max(1, maxX));
  const dur     = fallDuration();
  const startTime = performance.now();

  const el = document.createElement('div');
  el.className = 'tile';
  el.style.cssText = `left:${x}px;top:-90px;width:${tileW}px;`;

  const lettersHtml = scrambled.split('').map(ch =>
    `<div class="tile-letter">${ch}</div>`
  ).join('');
  el.innerHTML = `<div class="tile-letters">${lettersHtml}</div><div class="tile-hint">${hint}</div>`;
  arena.appendChild(el);

  const tileObj = { el, answer, def, dur, startTime, removed: false, landed: false };
  gs.tiles.push(tileObj);
}

// ── GAME LOOP ──
function gameLoop(now) {
  if (!gs.running) return;

  if (!gs.paused) {
    const arenaH    = ARENA_H();
    const groundTop = arenaH - 52;
    const dangerY   = groundTop - 60 - 56;

    gs.tiles.forEach(t => {
      if (t.removed) return;
      const progress = Math.min((now - t.startTime) / t.dur, 1);
      const y = -90 + progress * (groundTop + 90);
      t.el.style.top = y + 'px';

      if (y > dangerY && !t.el.classList.contains('urgent')) {
        t.el.classList.add('urgent');
      }

      if (progress >= 1 && !t.landed) {
        t.landed = true;
        loseLife(t);
      }
    });
  }

  gs.raf = requestAnimationFrame(gameLoop);
}

function loseLife(tileObj) {
  if (tileObj.removed) return;
  removeTile(tileObj);

  gs.lives--;
  gs.combo = 1;
  renderLives();
  updateUI();
  showFeedback(`Missed "${tileObj.answer}" — −1 life`, false);

  // Briefly show on ground
  const ground = document.getElementById('ground');
  const gl = document.createElement('div');
  gl.className = 'ground-letter';
  gl.textContent = tileObj.answer[0];
  ground.appendChild(gl);
  setTimeout(() => gl.remove(), 1500);

  if (gs.lives <= 0) {
    setTimeout(endGame, 300);
  }
}

function removeTile(tileObj) {
  tileObj.removed = true;
  tileObj.el.remove();
  gs.tiles = gs.tiles.filter(t => t !== tileObj);
}

// ── SUBMIT ──
function submitAnswer() {
  if (!gs.running || gs.paused) return;
  const raw = document.getElementById('answer-input').value.trim().toUpperCase();
  if (!raw) return;

  const matched = gs.tiles.find(t => !t.removed && t.answer.toUpperCase() === raw);
  if (matched) {
    const now = performance.now();
    const timeSinceLast = now - gs.lastCorrectTime;
    gs.lastCorrectTime = now;

    // Combo: consecutive correct within 5s
    gs.combo = (timeSinceLast < 5000 && gs.wordsCorrect > 0)
      ? Math.min(gs.combo + 1, 4)
      : 1;

    const points = matched.answer.length * 10 * gs.combo * gs.level;
    gs.score += points;
    gs.wordsCorrect++;

    animatePop('stat-score');
    animatePop('stat-words');

    const comboStr = gs.combo > 1 ? ` · Combo ×${gs.combo}` : '';
    showFeedback(`+${points} pts${comboStr}`, true);
    showDef(matched.answer, matched.def);

    // Flash tile green then remove
    matched.el.style.background = 'rgba(120,196,160,0.12)';
    matched.el.style.borderColor = 'rgba(120,196,160,0.4)';
    setTimeout(() => removeTile(matched), 220);

    const inp = document.getElementById('answer-input');
    inp.classList.remove('wrong');
    inp.classList.add('correct');
    setTimeout(() => inp.classList.remove('correct'), 380);

    // Level up every 5 correct words
    if (gs.wordsCorrect % 5 === 0) {
      gs.level++;
      clearInterval(gs.spawnInterval);
      gs.spawnInterval = setInterval(spawnTile, spawnDelay());
      const tier = getTier();
      showFeedback(`Level ${gs.level}! Now: ${tier.charAt(0).toUpperCase() + tier.slice(1)} words`, true);
      document.getElementById('level-badge').textContent = `Level ${gs.level}`;
    }

    updateUI();
  } else {
    // Wrong guess
    gs.combo = 1;
    const inp = document.getElementById('answer-input');
    inp.classList.add('wrong');
    setTimeout(() => inp.classList.remove('wrong'), 380);
    showFeedback('No match — keep trying!', false);
    updateUI();
  }

  document.getElementById('answer-input').value = '';
}

function showDef(word, def) {
  const strip = document.getElementById('def-strip');
  strip.classList.remove('faded');
  strip.innerHTML = `<strong>${word}</strong> — ${def.replace(/^[^:]+: /, '')}`;
}

function showFeedback(msg, good) {
  const fb = document.getElementById('feedback');
  fb.textContent = msg;
  fb.className = 'feedback' + (good ? ' good' : '');
  clearTimeout(fb._t);
  fb._t = setTimeout(() => { fb.textContent = ''; }, 2500);
}

function animatePop(id) {
  const el = document.getElementById(id);
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 180);
}

// ── LIVES (SVG hearts) ──
function renderLives() {
  const row = document.getElementById('lives-row');
  row.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', i < gs.lives ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('aria-hidden', 'true');
    svg.className.baseVal = 'heart' + (i >= gs.lives ? ' lost' : '');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z');
    svg.appendChild(path);
    row.appendChild(svg);
  }
}

function updateUI() {
  document.getElementById('stat-score').textContent = gs.score;
  document.getElementById('stat-words').textContent = gs.wordsCorrect;
  document.getElementById('stat-level').textContent = gs.level;
  document.getElementById('stat-combo').textContent = '×' + gs.combo;
  document.getElementById('level-badge').textContent = `Level ${gs.level}`;
}

function togglePause() {
  if (!gs.running) return;
  gs.paused = !gs.paused;
  const btn = document.getElementById('pause-btn');
  btn.textContent = gs.paused ? 'Resume' : 'Pause';
  btn.setAttribute('aria-label', gs.paused ? 'Resume game' : 'Pause game');
  if (!gs.paused) requestAnimationFrame(gameLoop);
}

// ── END GAME ──
function endGame() {
  gs.running = false;
  cancelAnimationFrame(gs.raf);
  clearInterval(gs.spawnInterval);

  document.getElementById('answer-input').disabled = true;
  document.getElementById('submit-btn').disabled   = true;

  gs.tiles.forEach(t => t.el.remove());
  gs.tiles = [];

  // Save score
  gs.bestScores.unshift({
    score: gs.score,
    words: gs.wordsCorrect,
    level: gs.level,
    date:  new Date().toLocaleDateString()
  });
  gs.bestScores = gs.bestScores.slice(0, 10);
  localStorage.setItem('ld_scores', JSON.stringify(gs.bestScores));
  renderScores();

  // Populate modal
  document.getElementById('go-score').textContent = gs.score;
  document.getElementById('go-words').textContent = gs.wordsCorrect;
  document.getElementById('go-level').textContent = gs.level;
  document.getElementById('go-sub').textContent = gs.wordsCorrect >= 10
    ? 'Impressive vocabulary!'
    : 'The letters got the better of you.';

  const stars = gs.score >= 500 ? '⭐⭐⭐' : gs.score >= 200 ? '⭐⭐' : '⭐';
  const shareText = `LetterDrop 🔤\n${stars}\nScore: ${gs.score} | Words: ${gs.wordsCorrect} | Level: ${gs.level}\nplay at divarun.github.io`;
  document.getElementById('go-share').textContent = shareText;
  window._shareText = shareText;

  document.getElementById('game-over-overlay').classList.add('show');
}

function copyShare() {
  navigator.clipboard.writeText(window._shareText || '').then(() => {
    document.getElementById('copied-msg').textContent = '✓ Copied!';
    setTimeout(() => { document.getElementById('copied-msg').textContent = ''; }, 2200);
  });
}

// ── SCORES ──
function renderScores() {
  const box = document.getElementById('score-rows');
  if (gs.bestScores.length === 0) {
    box.innerHTML = '<div class="scores-empty">No scores yet — play a round!</div>';
    return;
  }
  box.innerHTML = gs.bestScores.map(s => `
    <div class="score-row">
      <div>
        <div class="sr-label">${s.words} word${s.words !== 1 ? 's' : ''} · Level ${s.level}</div>
        <div class="sr-meta">${s.date}</div>
      </div>
      <div class="sr-n">${s.score}</div>
    </div>`).join('');
}

// ── INPUT HANDLERS ──
document.getElementById('answer-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitAnswer();
});

// ── TABS ──
function switchTab(id) {
  const ids = ['play', 'how', 'scores'];
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    const active = ids[i] === id;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  if (id === 'scores') renderScores();
}

// ── INIT ──
document.getElementById('year').textContent = new Date().getFullYear();
renderLives();
renderScores();