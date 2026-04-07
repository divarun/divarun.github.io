let COUNTRIES = []; // placeholder

  async function loadCountries() {
    try {
      const res = await fetch('countries.json'); // your JSON path
      if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
      COUNTRIES = await res.json();
      console.log("✅ Countries loaded:", COUNTRIES.length);

      // Now that COUNTRIES is loaded, initialize everything
      init();
    } catch (err) {
      console.error("❌ Failed to load countries JSON:", err);
    }
  }


    const CLUE_KEYS = ["continent","pop","flag","borders","capital","landmark","hint"];
    const CLUE_LABELS = ["Continent","Population","Flag","Borders","Capital","Famous Landmark","Letter Hint"];
    const CLUE_ICONS = ["🌍","👥","🏳️","🗺️","🏛️","📸","🔤"];
    const MAX_SCORE = 1000;
    const CLUE_COST = 150;
    const WRONG_COST = 50;

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
      let a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;
    }

    function init() {
      state.queue = shuffle(COUNTRIES);
      updateStreakDisplay();
      renderScores();
      nextRound();
      initAutocomplete();
    }

    function nextRound() {
      if (state.queue.length === 0) state.queue = shuffle(COUNTRIES);
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
             style="width:64px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.4);">
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
      for (let i = state.revealed; i < CLUE_KEYS.length; i++) {
        const pill = document.createElement('div');
        pill.className = 'locked-pill';
        pill.innerHTML = `<span class="lock">🔒</span>${CLUE_LABELS[i]}`;
        row.appendChild(pill);
      }
    }

    function renderProgress() {
      const row = document.getElementById('progress-row');
      row.innerHTML = '';
      document.getElementById('clue-total').textContent = CLUE_KEYS.length;
      for (let i = 0; i < CLUE_KEYS.length; i++) {
        const d = document.createElement('div');
        d.className = 'dot';
        if (i < state.revealed - 1) d.classList.add('used');
        else if (i === state.revealed - 1) d.classList.add('active');
        row.appendChild(d);
      }
    }

    function updateRevealBtn() {
      const btn = document.getElementById('reveal-btn');
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

      const guess = raw.toLowerCase().replace(/\s+/g,' ');
      const answer = state.current.name.toLowerCase();

      if (guess === answer || guess === answer.replace(/\s+/g,'')) {
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

      updateStreakDisplay();
      renderScores();
      showResult(won);
    }

    function showResult(won) {
      document.getElementById('res-flag').innerHTML =
    `<img src="https://flagcdn.com/w320/${state.current.code}.png" style="width:90px;border-radius:10px;">`;
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
      const header = `AtlasRush 🌍`;
      const scoreStr = `Score: ${state.score} pts`;
      const clueStr  = `Clues used: ${state.revealed}/${CLUE_KEYS.length}`;
      const log = state.emojiLog.join('');
      const share = `${header}\n${state.current.flag} ${state.current.name}\n${log}\n${scoreStr} | ${clueStr}\nStreak: 🔥${state.streak}`;
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
        country: state.current.name,
        flag: state.current.flag,
        score: state.score,
        clues: state.revealed,
        date: new Date().toLocaleDateString()
      });
      state.bestScores = state.bestScores.slice(0, 10);
      localStorage.setItem('atlasRush_scores', JSON.stringify(state.bestScores));
    }

    function renderScores() {
      const list = document.getElementById('scores-list');
      if (state.bestScores.length === 0) {
        list.innerHTML = '<div style="color:var(--muted);font-size:14px;text-align:center;padding:24px 0;">No scores yet — play a round!</div>';
        return;
      }
      list.innerHTML = state.bestScores.map((s,i) => `
        <div class="score-row">
          <div style="display:flex;align-items:center;">
            <span class="c">${s.flag}</span>
            <div><div class="cn">${s.country}</div><div class="clues-used">${s.clues} clue${s.clues!==1?'s':''} · ${s.date}</div></div>
          </div>
          <div class="sc">${s.score}</div>
        </div>`).join('');
    }

    function updateStreakDisplay() {
      document.getElementById('streak-count').textContent = state.streak;
    }

    // ─── AUTOCOMPLETE ───

    let allCountries = [];

function initAutocomplete() {
  allCountries = COUNTRIES.map(c => c.name);

  const input = document.getElementById('guess-input');

  input.addEventListener('input', function() {
    const val = this.value.trim().toLowerCase();
    const box = document.getElementById('suggestions');

    if (!val) { hideSuggestions(); return; }

    const matches = allCountries.filter(n => n.toLowerCase().startsWith(val)).slice(0,6);
    if (matches.length === 0) { hideSuggestions(); return; }

    box.innerHTML = matches.map(name => {
      const country = COUNTRIES.find(c => c.name === name);
      return `<div class="sug-item" onclick="selectSuggestion('${name}')">
                <span class="sug-flag">
                  <img src="https://flagcdn.com/w40/${country.code}.png" style="width:20px;border-radius:3px;">
                </span>
                ${name}
              </div>`;
    }).join('');
    box.className = 'suggestions show';
  });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitGuess();
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('#guess-input') && !e.target.closest('#suggestions')) hideSuggestions();
  });
}



    document.getElementById('guess-input').addEventListener('input', function() {
      const val = this.value.trim().toLowerCase();
      if (!val || val.length < 1) { hideSuggestions(); return; }
      const matches = allCountries.filter(n => n.toLowerCase().startsWith(val)).slice(0, 6);
      if (matches.length === 0) { hideSuggestions(); return; }

      const box = document.getElementById('suggestions');
      box.innerHTML = matches.map(n => {
        const flag = COUNTRIES.find(c => c.name === n)?.flag || '🌐';
        return `<div class="sug-item" onclick="selectSuggestion('${n}')"><span class="sug-flag">
    <img src="https://flagcdn.com/w40/${COUNTRIES.find(c=>c.name===n).code}.png" style="width:20px;border-radius:3px;">
  </span>${n}</div>`;
      }).join('');
      box.className = 'suggestions show';
    });

    document.getElementById('guess-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') submitGuess();
    });

    function selectSuggestion(name) {
      document.getElementById('guess-input').value = name;
      hideSuggestions();
      submitGuess();
    }

    function hideSuggestions() {
      document.getElementById('suggestions').className = 'suggestions';
    }

    document.addEventListener('click', function(e) {
      if (!e.target.closest('#guess-input') && !e.target.closest('#suggestions')) hideSuggestions();
    });

    // ─── TABS ───
    function switchTab(id) {
      document.querySelectorAll('.tab-btn').forEach((b,i) => {
        const ids = ['play','how','scores'];
        b.classList.toggle('active', ids[i] === id);
      });
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById('tab-'+id).classList.add('active');
    }

loadCountries();