// script.js — UI-Schicht für Flow-Markt V0.1
// Enthält ausschließlich Rendering und Event-Wiring. Keine Spielregeln hier;
// jede Aktion delegiert an die Game-Instanz aus rules.js.

(function () {
  'use strict';

  const { Game, HAND_LIMIT } = window.FlowMarkt;

  let game = null;
  let selectedCardIds = new Set();
  let debugEnabled = false;
  let lastLoggedIndex = 0;
  let announcedCompleteSets = new Set(); // `${playerId}:${setName}`, verhindert wiederholte Feier-Toasts
  let celebrationFired = false;

  const CONFETTI_EMOJI = ['🎉', '🎊', '✨', '🥳'];

  // --- DOM-Referenzen -----------------------------------------------------
  const el = {
    setupScreen: document.getElementById('setup-screen'),
    gameScreen: document.getElementById('game-screen'),
    playerCountInput: document.getElementById('player-count-input'),
    playerNameInputs: document.getElementById('player-name-inputs'),
    startGameBtn: document.getElementById('start-game-btn'),
    debugToggle: document.getElementById('debug-toggle'),

    phaseLabel: document.getElementById('phase-label'),
    roundLabel: document.getElementById('round-label'),
    currentPlayerLabel: document.getElementById('current-player-label'),

    drawPileCount: document.getElementById('draw-pile-count'),
    discardPileCount: document.getElementById('discard-pile-count'),
    eventCardDisplay: document.getElementById('event-card-display'),

    playersArea: document.getElementById('players-area'),
    handCount: document.getElementById('hand-count'),
    handLimit: document.getElementById('hand-limit'),
    handCards: document.getElementById('hand-cards'),

    drawBtn: document.getElementById('draw-btn'),
    playSetBtn: document.getElementById('play-set-btn'),
    tradeBtn: document.getElementById('trade-btn'),
    endTurnBtn: document.getElementById('end-turn-btn'),
    newGameBtn: document.getElementById('new-game-btn'),

    tradeForm: document.getElementById('trade-form'),
    tradeInput: document.getElementById('trade-input'),
    tradeSubmitBtn: document.getElementById('trade-submit-btn'),
    tradeCancelBtn: document.getElementById('trade-cancel-btn'),

    toastContainer: document.getElementById('toast-container'),
    confettiLayer: document.getElementById('confetti-layer'),

    discardRequired: document.getElementById('discard-required'),
    discardNeededCount: document.getElementById('discard-needed-count'),
    confirmDiscardBtn: document.getElementById('confirm-discard-btn'),

    statusMessage: document.getElementById('status-message'),
    endPanel: document.getElementById('end-panel'),
    finalScores: document.getElementById('final-scores'),

    logList: document.getElementById('log-list'),
    debugPanel: document.getElementById('debug-panel'),
    debugContent: document.getElementById('debug-content'),
  };

  // --- Setup-Bildschirm -----------------------------------------------------
  function renderNameInputs() {
    const count = Number(el.playerCountInput.value) || 3;
    el.playerNameInputs.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `Name Spieler ${i + 1} (optional)`;
      input.dataset.playerIndex = String(i);
      el.playerNameInputs.appendChild(input);
    }
  }

  el.playerCountInput.addEventListener('input', renderNameInputs);

  el.startGameBtn.addEventListener('click', () => {
    const count = Math.max(2, Math.min(6, Number(el.playerCountInput.value) || 3));
    const names = [...el.playerNameInputs.querySelectorAll('input')]
      .map((input) => input.value.trim());

    game = new Game({ playerCount: count, playerNames: names });
    game.setup();
    selectedCardIds.clear();
    lastLoggedIndex = game.log.length; // Startmeldung nicht extra als Toast anzeigen
    announcedCompleteSets.clear();
    celebrationFired = false;
    window.FlowMarkt.debugGame = game; // Konsolenzugriff für Fehlersuche/Tests

    el.setupScreen.hidden = true;
    el.gameScreen.hidden = false;
    el.tradeForm.hidden = true;
    render();
  });

  // Kein window.confirm(): in eingebetteten/sandboxed Ansichten (z. B. Artifacts)
  // werden native Dialoge oft unterdrückt, wodurch der Button sonst wirkungslos wäre.
  el.newGameBtn.addEventListener('click', () => {
    game = null;
    selectedCardIds.clear();
    el.gameScreen.hidden = true;
    el.setupScreen.hidden = false;
    el.tradeForm.hidden = true;
  });

  el.debugToggle.addEventListener('change', () => {
    debugEnabled = el.debugToggle.checked;
    render();
  });

  // --- Aktions-Buttons --------------------------------------------------
  el.drawBtn.addEventListener('click', () => runAction(() => game.drawCard()));

  el.playSetBtn.addEventListener('click', () =>
    runAction(() => {
      if (selectedCardIds.size === 0) {
        throw new Error('Bitte zuerst Handkarten auswählen.');
      }
      game.playSet([...selectedCardIds]);
      selectedCardIds.clear();
    })
  );

  // Kein window.prompt(): ersetzt durch ein eingebettetes Formular, damit der
  // Button auch in sandboxed Ansichten (z. B. Artifacts) funktioniert.
  el.tradeBtn.addEventListener('click', () => {
    el.tradeForm.hidden = false;
    el.tradeInput.value = '';
    el.tradeInput.focus();
  });

  el.tradeCancelBtn.addEventListener('click', () => {
    el.tradeForm.hidden = true;
  });

  el.tradeSubmitBtn.addEventListener('click', () => {
    const offer = el.tradeInput.value.trim();
    el.tradeForm.hidden = true;
    runAction(() => game.announceTrade(offer));
  });

  el.tradeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.tradeSubmitBtn.click();
    if (e.key === 'Escape') el.tradeCancelBtn.click();
  });

  el.endTurnBtn.addEventListener('click', () =>
    runAction(() => {
      game.endTurn();
      selectedCardIds.clear();
    })
  );

  el.confirmDiscardBtn.addEventListener('click', () =>
    runAction(() => {
      game.discardCards([...selectedCardIds]);
      selectedCardIds.clear();
    })
  );

  function runAction(fn) {
    try {
      el.statusMessage.textContent = '';
      fn();
    } catch (err) {
      el.statusMessage.textContent = err.message;
    }
    flushLogToasts();
    render();
  }

  // --- Toasts & Konfetti ("coole Effekte") --------------------------------
  function showToast(message, variant = 'default') {
    while (el.toastContainer.children.length >= 4) {
      el.toastContainer.firstElementChild.remove();
    }
    const toast = document.createElement('div');
    toast.className = `toast${variant !== 'default' ? ` ${variant}` : ''}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // Nicht jede Log-Zeile ist eine Überraschung wert - Routine-Aktionen werden gefiltert.
  function isNoteworthy(entry) {
    if (/ zieht eine Karte\.$/.test(entry)) return false;
    if (/ legt \d+ Karte\(n\) auf den Friedhof\.$/.test(entry)) return false;
    return true;
  }

  function flushLogToasts() {
    if (!game) return;
    const newEntries = game.log.slice(lastLoggedIndex);
    lastLoggedIndex = game.log.length;
    for (const entry of newEntries) {
      if (!isNoteworthy(entry)) continue;
      let variant = 'default';
      if (entry.includes('Ereignis aufgedeckt')) variant = 'event';
      if (entry.includes('Showdown beginnt') || entry.includes('das Spiel endet')) variant = 'celebrate';
      showToast(entry, variant);
    }
  }

  function spawnConfetti() {
    const count = 28;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.textContent = CONFETTI_EMOJI[i % CONFETTI_EMOJI.length];
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.animationDelay = `${Math.random() * 0.6}s`;
      el.confettiLayer.appendChild(piece);
      setTimeout(() => piece.remove(), 3200);
    }
  }

  // --- Rendering ----------------------------------------------------------
  function cardLabel(card) {
    return card.type === 'event' ? card.title : card.name;
  }

  function cardPlaceholder(card) {
    return card.imagePlaceholder || '🂠';
  }

  function createCardElement(card, { selectable = false, selected = false, onClick = null } = {}) {
    const div = document.createElement('div');
    div.className = `card ${card.type}`;
    div.dataset.id = card.id;
    if (card.color) div.style.setProperty('--card-accent', card.color);
    if (selected) div.classList.add('selected');
    const isSetCard = card.type === 'object' || card.type === 'mysterio';
    div.innerHTML = `
      ${isSetCard ? `<div class="card-badge">${card.imagePlaceholder} ×${card.setSize}</div>` : ''}
      <div class="placeholder">${cardPlaceholder(card)}</div>
      <div class="card-name">${cardLabel(card)}</div>
    `;
    if (selectable) {
      div.tabIndex = 0;
      div.setAttribute('role', 'button');
      div.setAttribute('aria-pressed', String(selected));
      div.addEventListener('click', () => onClick(card));
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(card);
        }
      });
    }
    return div;
  }

  function renderStatusBar() {
    const phaseNames = { setup: 'Vorbereitung', playing: 'Spielrunde', showdown: 'Showdown', ended: 'Spielende' };
    el.phaseLabel.textContent = phaseNames[game.phase] || game.phase;
    el.roundLabel.textContent = `Runde ${game.roundNumber}`;
    el.currentPlayerLabel.textContent =
      game.phase === 'ended' ? '' : `Am Zug: ${game.currentPlayer.name}`;
  }

  function renderPiles() {
    el.drawPileCount.textContent = String(game.drawPile.size);
    el.discardPileCount.textContent = String(game.discardPile.size);
    const lastEvent = game.revealedEvents[game.revealedEvents.length - 1];
    el.eventCardDisplay.textContent = lastEvent
      ? `${lastEvent.title}\n${lastEvent.description}`
      : 'Noch keine aufgedeckt';
  }

  function renderPlayers() {
    el.playersArea.innerHTML = '';
    game.players.forEach((player, index) => {
      const box = document.createElement('div');
      box.className = 'player-box' + (index === game.currentPlayerIndex ? ' active' : '');

      const groupsHtml = [...player.collection.getGroups().entries()]
        .map(([setName, cards]) => {
          const setSize = cards[0].setSize;
          const complete = cards.length >= setSize;
          const key = `${player.id}:${setName}`;
          let justCompleted = false;
          if (complete && !announcedCompleteSets.has(key)) {
            announcedCompleteSets.add(key);
            justCompleted = true;
            showToast(`🎉 ${player.name}: Set ${cards[0].imagePlaceholder} komplett – Punkte verdoppelt!`, 'celebrate');
          }
          const classes = ['set-group', complete && 'complete', justCompleted && 'just-completed'].filter(Boolean).join(' ');
          return `<span class="${classes}">${cards[0].imagePlaceholder} ${cards.length}/${setSize}</span>`;
        })
        .join('') || '<em>keine Sets</em>';

      box.innerHTML = `
        <h4>${player.name}<span>${player.hand.length} Karte(n)</span></h4>
        <div class="groups">${groupsHtml}</div>
      `;
      el.playersArea.appendChild(box);
    });
  }

  function renderHand() {
    const player = game.currentPlayer;
    el.handCount.textContent = String(player.hand.length);
    el.handLimit.textContent = String(HAND_LIMIT);
    el.handCards.innerHTML = '';
    player.hand.forEach((card) => {
      const cardEl = createCardElement(card, {
        selectable: true,
        selected: selectedCardIds.has(card.id),
        onClick: (c) => {
          if (selectedCardIds.has(c.id)) selectedCardIds.delete(c.id);
          else selectedCardIds.add(c.id);
          render();
        },
      });
      el.handCards.appendChild(cardEl);
    });
  }

  function renderActions() {
    const needsDiscard = game.needsDiscard();
    const ended = game.phase === 'ended';
    const mustDrawFirst = game.phase === 'playing' && !game.hasDrawnThisTurn;

    el.drawBtn.disabled = ended || needsDiscard || game.phase !== 'playing' || game.hasDrawnThisTurn;
    el.playSetBtn.disabled = ended || needsDiscard || mustDrawFirst || selectedCardIds.size === 0;
    el.tradeBtn.disabled = ended || needsDiscard;
    el.endTurnBtn.disabled = ended || needsDiscard || mustDrawFirst;

    el.discardRequired.hidden = !needsDiscard;
    if (needsDiscard) {
      const overflow = game.currentPlayer.hand.length - HAND_LIMIT;
      el.discardNeededCount.textContent = String(overflow);
      el.confirmDiscardBtn.disabled = selectedCardIds.size !== overflow;
    }
  }

  function renderEndPanel() {
    const ended = game.phase === 'ended';
    el.endPanel.hidden = !ended;
    if (!ended) return;

    if (!celebrationFired) {
      celebrationFired = true;
      spawnConfetti();
    }

    const scores = game.calculateScores();
    const winners = game.getWinner();
    const winnerIds = new Set(winners.map((w) => w.player.id));

    const rows = scores
      .slice()
      .sort((a, b) => b.total - a.total)
      .map(
        (s) => `
        <tr class="${winnerIds.has(s.player.id) ? 'winner' : ''}">
          <td>${s.player.name}</td>
          <td>${s.setPoints}</td>
          <td>${s.mysterioBonus}</td>
          <td>${s.handPoints}</td>
          <td>${s.total}</td>
        </tr>`
      )
      .join('');

    el.finalScores.innerHTML = `
      <table>
        <thead><tr><th>Spieler</th><th>Set-Punkte</th><th>Mysterio-Bonus</th><th>Handkarten</th><th>Gesamt</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><strong>Gewinner:</strong> ${winners.map((w) => w.player.name).join(', ')}</p>
    `;
  }

  function renderLog() {
    el.logList.innerHTML = game.log
      .slice(-30)
      .reverse()
      .map((entry) => `<li>${entry}</li>`)
      .join('');
  }

  function renderDebugPanel() {
    el.debugPanel.hidden = !debugEnabled;
    if (!debugEnabled) return;

    const drawOrder = game.drawPile.cards
      .slice()
      .reverse()
      .map((c) => cardLabel(c))
      .join(', ') || '(leer)';

    const hands = game.players
      .map((p) => `<div><strong>${p.name}:</strong> ${p.hand.map(cardLabel).join(', ') || '(leer)'}</div>`)
      .join('');

    const events = [
      ...game.revealedEvents.map((c) => `${cardLabel(c)} (aufgedeckt)`),
      ...game.eventDeck.cards.slice().reverse().map((c) => `${cardLabel(c)} (verdeckt)`),
    ].join('<br>');

    const allMysterio = game.players
      .map((p) => {
        const owned = p.collection.getGroups().get('Mysterio') || [];
        return owned.length ? `<div>${p.name}: ${owned.map(cardLabel).join(', ')}</div>` : '';
      })
      .filter(Boolean)
      .join('') || '<div>Noch keine ausgespielt.</div>';

    const scores = game
      .calculateScores()
      .map((s) => `<div>${s.player.name}: ${s.total} Punkte (Sets ${s.setPoints}, Mysterio ${s.mysterioBonus}, Hand ${s.handPoints})</div>`)
      .join('');

    el.debugContent.innerHTML = `
      <section><h4>Nachziehstapel (Reihenfolge, oben zuerst)</h4>${drawOrder}</section>
      <section><h4>Alle Spielerhände</h4>${hands}</section>
      <section><h4>Ereigniskarten</h4>${events}</section>
      <section><h4>Mysterio-Karten im Spiel</h4>${allMysterio}</section>
      <section><h4>Aktuelle Punkte</h4>${scores}</section>
    `;
  }

  function render() {
    if (!game) return;
    renderStatusBar();
    renderPiles();
    renderPlayers();
    renderHand();
    renderActions();
    renderEndPanel();
    renderLog();
    renderDebugPanel();
  }

  renderNameInputs();
})();
