// script.js — UI-Schicht für Flow-Markt V0.1
// Enthält ausschließlich Rendering und Event-Wiring. Keine Spielregeln hier;
// jede Aktion delegiert an die Game-Instanz aus rules.js.

(function () {
  'use strict';

  const { Game, HAND_LIMIT } = window.FlowMarkt;

  let game = null;
  let selectedCardIds = new Set();
  let debugEnabled = false;

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
    window.FlowMarkt.debugGame = game; // Konsolenzugriff für Fehlersuche/Tests



    el.setupScreen.hidden = true;
    el.gameScreen.hidden = false;
    render();
  });

  el.newGameBtn.addEventListener('click', () => {
    if (!confirm('Aktuelle Partie verwerfen und neu starten?')) return;
    game = null;
    selectedCardIds.clear();
    el.gameScreen.hidden = true;
    el.setupScreen.hidden = false;
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

  el.tradeBtn.addEventListener('click', () => {
    const offer = prompt('Tauschangebot (optional, wird nur protokolliert):', '') || '';
    runAction(() => game.announceTrade(offer));
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
    render();
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
    if (selected) div.classList.add('selected');
    div.innerHTML = `
      <div class="placeholder">${cardPlaceholder(card)}</div>
      <div class="card-name">${cardLabel(card)}</div>
      <div class="card-meta">${card.type === 'object' || card.type === 'mysterio' ? card.setName : ''}</div>
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
          return `<span class="set-group${complete ? ' complete' : ''}">${setName}: ${cards.length}/${setSize}</span>`;
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
