// ── WORD BANK ──
// ── WORD BANK (NOW LOADED) ──
let WORD_BANK = [];

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
  running: false,
  paused: false,
  score: 0,
  wordsCorrect: 0,
  level: 1,
  lives: 3,
  combo: 1,
  comboTimer: null,
  tiles: [],          // { el, answer, def, animId, startTime, fallDuration, removed }
  usedWords: new Set(),
  bestScores: JSON.parse(localStorage.getItem('ld_scores') || '[]'),
  raf: null,
  lastCorrectTime: 0,
};

const ARENA_H = () => document.getElementById('arena').offsetHeight;
const TILE_W = window.innerWidth <= 480 ? 90 : 110;

async function startGame() {

  // ensure words loaded
  if (WORD_BANK.length === 0) {
    await loadWords();
  }

  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('answer-input').disabled = false;
  document.getElementById('submit-btn').disabled = false;
  document.getElementById('answer-input').focus();

  gs.running = true; gs.paused = false;
  gs.score = 0; gs.wordsCorrect = 0; gs.level = 1;
  gs.lives = 3; gs.combo = 1;
  gs.tiles = []; gs.usedWords = new Set();
  gs.lastCorrectTime = 0;

  document.getElementById('arena').innerHTML = '';
  document.getElementById('ground').innerHTML = '';
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
  return Math.max(1800, 3200 - (gs.level - 1) * 250);
}

function fallDuration() {
  return Math.max(4000, 9000 - (gs.level - 1) * 600);
}

function getWord() {
  let pool = [];

  if (gs.level <= 2) pool = WORD_BANK.easy;
  else if (gs.level <= 4) pool = WORD_BANK.medium;
  else pool = WORD_BANK.hard;

  const filtered = pool.filter(w => !gs.usedWords.has(w[1]));

  if (filtered.length === 0) {
    gs.usedWords.clear();
    return getWord();
  }

  return filtered[Math.floor(Math.random() * filtered.length)];
}

function spawnTile() {
  if (!gs.running || gs.paused) return;

  const [scrambled, answer, hint, def] = getWord();
  gs.usedWords.add(answer);

  const arena = document.getElementById('arena');
  const arenaW = arena.offsetWidth;
  const maxX = arenaW - TILE_W - 10;
  const x = 10 + Math.floor(Math.random() * Math.max(1, maxX));

  const dur = fallDuration();
  const startTime = performance.now();

  const el = document.createElement('div');
  el.className = 'tile';
  el.style.left = x + 'px';
  el.style.top = '-90px';
  el.style.width = TILE_W + 'px';

  const lettersHtml = scrambled.split('').map(ch =>
    `<div class="tile-letter">${ch}</div>`
  ).join('');
  el.innerHTML = `<div class="tile-letters">${lettersHtml}</div><div class="tile-hint">${hint}</div>`;

  arena.appendChild(el);

  const tileObj = { el, answer, def, dur, startTime, removed: false, landed: false };
  gs.tiles.push(tileObj);
}

function gameLoop(now) {
  if (!gs.running) return;
  if (!gs.paused) {
    const arenaH = ARENA_H();
    const groundTop = arenaH - 52; // ground height
    const dangerY = groundTop - 64 - 60; // tile height ~60px

    gs.tiles.forEach(t => {
      if (t.removed) return;
      const elapsed = now - t.startTime;
      const progress = Math.min(elapsed / t.dur, 1);
      // fall from -90 to groundTop (landing zone)
      const y = -90 + progress * (groundTop + 90);
      t.el.style.top = y + 'px';

      // urgent styling near danger zone
      if (y > dangerY) {
        t.el.classList.add('urgent');
      }

      // landed
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
  showFeedback('Missed! −1 life', false);

  // Show on ground briefly
  const ground = document.getElementById('ground');
  const gl = document.createElement('div');
  gl.className = 'ground-letter';
  gl.textContent = tileObj.answer[0];
  ground.appendChild(gl);
  setTimeout(() => { if (gl.parentNode) gl.parentNode.removeChild(gl); }, 1500);

  if (gs.lives <= 0) {
    setTimeout(endGame, 300);
  }
}

function removeTile(tileObj) {
  tileObj.removed = true;
  if (tileObj.el.parentNode) tileObj.el.parentNode.removeChild(tileObj.el);
  gs.tiles = gs.tiles.filter(t => t !== tileObj);
}

function submitAnswer() {
  if (!gs.running || gs.paused) return;
  const raw = document.getElementById('answer-input').value.trim().toUpperCase();
  if (!raw) return;

  const matched = gs.tiles.find(t => !t.removed && t.answer.toUpperCase() === raw);
  if (matched) {
    // Correct!
    const now = performance.now();
    const timeSinceLast = now - gs.lastCorrectTime;
    gs.lastCorrectTime = now;

    if (timeSinceLast < 5000 && gs.wordsCorrect > 0) {
      gs.combo = Math.min(gs.combo + 1, 4);
    } else {
      gs.combo = 1;
    }

    const points = matched.answer.length * 10 * gs.combo * gs.level;
    gs.score += points;
    gs.wordsCorrect++;

    animatePop('stat-score');
    animatePop('stat-words');

    showFeedback(`+${points} pts! ${gs.combo > 1 ? '🔥 Combo x' + gs.combo : ''}`, true);
    showDef(matched.answer, matched.def);

    // Flash tile green before removing
    matched.el.style.background = 'rgba(79,255,176,0.15)';
    matched.el.style.borderColor = 'rgba(79,255,176,0.5)';
    setTimeout(() => removeTile(matched), 250);

    document.getElementById('answer-input').classList.remove('wrong');
    document.getElementById('answer-input').classList.add('correct');
    setTimeout(() => document.getElementById('answer-input').classList.remove('correct'), 400);

    // Level up every 5 words
    if (gs.wordsCorrect % 5 === 0) {
      gs.level++;
      clearInterval(gs.spawnInterval);
      gs.spawnInterval = setInterval(spawnTile, spawnDelay());
      showFeedback(`Level ${gs.level}! ⬆️ Speed up!`, true);
    }

    updateUI();
  } else {
    // Wrong
    gs.combo = 1;
    document.getElementById('answer-input').classList.add('wrong');
    setTimeout(() => document.getElementById('answer-input').classList.remove('wrong'), 400);
    showFeedback('Not a match — keep trying!', false);
    updateUI();
  }

  document.getElementById('answer-input').value = '';
}

function showDef(word, def) {
  const strip = document.getElementById('def-strip');
  strip.classList.remove('hidden');
  strip.innerHTML = `<strong>${word}</strong> — ${def.replace(/^[^:]+: /, '')}`;
}

function showFeedback(msg, good) {
  const fb = document.getElementById('feedback');
  fb.textContent = msg;
  fb.className = 'feedback' + (good ? ' good' : '');
  clearTimeout(fb._t);
  fb._t = setTimeout(() => { fb.textContent = ''; }, 2200);
}

function animatePop(id) {
  const el = document.getElementById(id);
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 180);
}

function renderLives() {
  const row = document.getElementById('lives-row');
  row.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const h = document.createElement('span');
    h.className = 'heart' + (i >= gs.lives ? ' lost' : '');
    h.textContent = '❤️';
    row.appendChild(h);
  }
}

function updateUI() {
  document.getElementById('stat-score').textContent = gs.score;
  document.getElementById('stat-words').textContent = gs.wordsCorrect;
  document.getElementById('stat-level').textContent = gs.level;
  document.getElementById('stat-combo').textContent = 'x' + gs.combo;
  document.getElementById('level-badge').textContent = `Level ${gs.level}`;
}

function togglePause() {
  if (!gs.running) return;
  gs.paused = !gs.paused;
  document.getElementById('pause-btn').textContent = gs.paused ? '▶ Resume' : '⏸ Pause';
  if (!gs.paused) requestAnimationFrame(gameLoop);
}

function endGame() {
  gs.running = false;
  cancelAnimationFrame(gs.raf);
  clearInterval(gs.spawnInterval);
  document.getElementById('answer-input').disabled = true;
  document.getElementById('submit-btn').disabled = true;

  // Clear remaining tiles
  gs.tiles.forEach(t => { if (t.el.parentNode) t.el.parentNode.removeChild(t.el); });
  gs.tiles = [];

  // Save score
  gs.bestScores.unshift({ score: gs.score, words: gs.wordsCorrect, level: gs.level, date: new Date().toLocaleDateString() });
  gs.bestScores = gs.bestScores.slice(0, 10);
  localStorage.setItem('ld_scores', JSON.stringify(gs.bestScores));
  renderScores();

  // Show overlay
  document.getElementById('go-score').textContent = gs.score;
  document.getElementById('go-words').textContent = gs.wordsCorrect;
  document.getElementById('go-level').textContent = gs.level;
  document.getElementById('go-sub').textContent = gs.wordsCorrect >= 10 ? 'Impressive vocabulary!' : 'The letters got the better of you.';

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

function renderScores() {
  const box = document.getElementById('score-rows');
  if (gs.bestScores.length === 0) {
    box.innerHTML = '<div style="color:var(--muted);font-size:14px;text-align:center;padding:24px 0;">No scores yet — play a round!</div>';
    return;
  }
  box.innerHTML = gs.bestScores.map(s => `
    <div class="score-row">
      <div>
        <div style="font-size:14px;font-weight:500;">${s.words} words · Level ${s.level}</div>
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
  document.querySelectorAll('.tab-btn').forEach((b,i) => {
    const ids = ['play','how','scores'];
    b.classList.toggle('active', ids[i] === id);
  });
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  if (id === 'scores') renderScores();
}

// ── INIT ──
renderLives();
renderScores();