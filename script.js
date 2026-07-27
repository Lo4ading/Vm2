// script.js — UI-Schicht für Flow-Markt V0.1
// Enthält ausschließlich Rendering und Event-Wiring. Keine Spielregeln hier;
// jede Aktion delegiert an die Game-Instanz aus rules.js.

(function () {
  'use strict';

  const { Game, HAND_LIMIT, SET_DEFINITIONS } = window.FlowMarkt;

  let game = null;
  let selectedCardIds = new Set();
  let debugEnabled = false;
  let lastLoggedIndex = 0;
  let announcedCompleteSets = new Set(); // `${playerId}:${setName}`, verhindert wiederholte Feier-Toasts
  let celebrationFired = false;
  let previousHandCardIds = new Set(); // für die Zieh-Einflug-Animation neuer Handkarten
  let previousActivePlayerIndex = -1; // für den Zugwechsel-Puls

  // Tausch-UI-Zustand: 'normal' | 'composing' (Angebot zusammenstellen).
  // Ein 'pending'-Zustand ergibt sich implizit aus game.pendingTrade und hat
  // beim Rendern immer Vorrang vor uiMode, siehe currentUiState().
  let uiMode = 'normal';
  let tradeOfferSelection = new Set(); // Karten, die gerade als Angebot markiert werden
  let tradeOfferTargetIndex = null; // Zielspieler-Index für das Angebot
  let tradeResponseSelection = new Set(); // Gegenkarten beim Reagieren auf ein Angebot

  const CONFETTI_EMOJI = ['🎉', '🎊', '✨', '🥳'];

  // Spielernamen und Tauschangebote kommen von Nutzereingaben und landen an
  // mehreren Stellen in innerHTML-Strings - ungeschützt wäre das eine
  // HTML-Injection (z. B. brach ein "<" im Tauschtext bisher das Log-Rendering).
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }

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
    declutterBtn: document.getElementById('declutter-btn'),
    tradeBtn: document.getElementById('trade-btn'),
    endTurnBtn: document.getElementById('end-turn-btn'),
    newGameBtn: document.getElementById('new-game-btn'),

    secretGoalBadge: document.getElementById('secret-goal-badge'),

    tradeCompose: document.getElementById('trade-compose'),
    tradeTargetOptions: document.getElementById('trade-target-options'),
    tradeSendBtn: document.getElementById('trade-send-btn'),
    tradeComposeCancelBtn: document.getElementById('trade-compose-cancel-btn'),

    tradePending: document.getElementById('trade-pending'),
    tradePendingSummary: document.getElementById('trade-pending-summary'),
    tradeResponseHand: document.getElementById('trade-response-hand'),
    tradeAcceptBtn: document.getElementById('trade-accept-btn'),
    tradeDeclineBtn: document.getElementById('trade-decline-btn'),

    handArea: document.querySelector('.hand-area'),

    toastContainer: document.getElementById('toast-container'),
    confettiLayer: document.getElementById('confetti-layer'),

    discardRequired: document.getElementById('discard-required'),
    discardNeededCount: document.getElementById('discard-needed-count'),
    confirmDiscardBtn: document.getElementById('confirm-discard-btn'),

    hintBanner: document.getElementById('hint-banner'),
    modifierBanner: document.getElementById('modifier-banner'),
    pendingTradeBanner: document.getElementById('pending-trade-banner'),
    statusMessage: document.getElementById('status-message'),
    endPanel: document.getElementById('end-panel'),
    finalScores: document.getElementById('final-scores'),

    logList: document.getElementById('log-list'),
    debugPanel: document.getElementById('debug-panel'),
    debugContent: document.getElementById('debug-content'),

    eventModal: document.getElementById('event-modal'),
    eventModalTitle: document.getElementById('event-modal-title'),
    eventModalDescription: document.getElementById('event-modal-description'),
    eventModalOkBtn: document.getElementById('event-modal-ok-btn'),
  };

  // --- Setup-Bildschirm -----------------------------------------------------
  function renderNameInputs() {
    const count = Number(el.playerCountInput.value) || 3;
    el.playerNameInputs.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `Name Spieler ${i + 1} (optional)`;
      input.maxLength = 24;
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
    previousHandCardIds.clear();
    previousActivePlayerIndex = -1;
    uiMode = 'normal';
    tradeOfferSelection.clear();
    tradeOfferTargetIndex = null;
    tradeResponseSelection.clear();
    window.FlowMarkt.debugGame = game; // Konsolenzugriff für Fehlersuche/Tests

    el.setupScreen.hidden = true;
    el.gameScreen.hidden = false;
    render();
  });

  // Kein window.confirm(): in eingebetteten/sandboxed Ansichten (z. B. Artifacts)
  // werden native Dialoge oft unterdrückt, wodurch der Button sonst wirkungslos wäre.
  el.newGameBtn.addEventListener('click', () => {
    game = null;
    selectedCardIds.clear();
    uiMode = 'normal';
    tradeOfferSelection.clear();
    tradeOfferTargetIndex = null;
    tradeResponseSelection.clear();
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

  el.declutterBtn.addEventListener('click', () =>
    runAction(() => {
      if (selectedCardIds.size !== 2) {
        throw new Error('Bitte genau 2 Karten für den Trödel auswählen.');
      }
      game.declutter([...selectedCardIds]);
      selectedCardIds.clear();
    })
  );

  // Verdeckter Tausch, kein window.prompt(): der Spieler stellt ein Angebot aus
  // eigenen Handkarten zusammen, ein Zielspieler nimmt es (blind, Gegenkarten
  // ausgewählt ohne das Angebot zu sehen) an oder lehnt ab.
  el.tradeBtn.addEventListener('click', () => {
    uiMode = 'composing';
    tradeOfferSelection.clear();
    const opponents = game.players.map((_, i) => i).filter((i) => i !== game.currentPlayerIndex);
    tradeOfferTargetIndex = opponents.length === 1 ? opponents[0] : null;
    render();
  });

  el.tradeComposeCancelBtn.addEventListener('click', () => {
    uiMode = 'normal';
    tradeOfferSelection.clear();
    tradeOfferTargetIndex = null;
    render();
  });

  el.tradeSendBtn.addEventListener('click', () =>
    runAction(() => {
      if (tradeOfferSelection.size === 0) {
        throw new Error('Bitte zuerst Karte(n) für das Angebot auswählen.');
      }
      if (tradeOfferTargetIndex === null) {
        throw new Error('Bitte einen Zielspieler auswählen.');
      }
      game.proposeTrade([...tradeOfferSelection], tradeOfferTargetIndex);
      uiMode = 'normal';
      tradeOfferSelection.clear();
      tradeOfferTargetIndex = null;
    })
  );

  el.tradeDeclineBtn.addEventListener('click', () =>
    runAction(() => {
      game.declineTrade();
      tradeResponseSelection.clear();
    })
  );

  el.tradeAcceptBtn.addEventListener('click', () =>
    runAction(() => {
      if (tradeResponseSelection.size === 0) {
        throw new Error('Bitte zuerst Gegenkarte(n) auswählen.');
      }
      game.acceptTradeWithCounter([...tradeResponseSelection]);
      tradeResponseSelection.clear();
    })
  );

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

  // Das Ereignis-Popup lässt sich bewusst nur über den OK-Button schließen
  // (kein Klick auf den Hintergrund, kein Escape) - es soll aktiv bestätigt
  // werden, nicht versehentlich weggeklickt werden können.
  el.eventModalOkBtn.addEventListener('click', () => runAction(() => game.acknowledgePendingEvent()));

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
      if (entry.includes('Tausch')) variant = 'trade';
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
    const isSetCard = card.type === 'object' || card.type === 'mysterio' || card.type === 'ramsch';
    if (card.type === 'mysterio' && card.effectText) div.title = card.effectText;
    div.innerHTML = `
      ${isSetCard ? `<div class="card-badge">${card.imagePlaceholder} ×${card.setSize}</div>` : ''}
      <div class="placeholder">${cardPlaceholder(card)}</div>
      <div class="card-name">${cardLabel(card)}</div>
      ${card.type === 'mysterio' ? '<div class="card-effect-hint">✨ Effekt</div>' : ''}
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

  // Der Kundenwunsch ist privat: nur während des eigenen Zugs sichtbar, nicht
  // im gemeinsamen Spielerbereich für alle - erst die Endwertung deckt alles auf.
  function renderSecretGoalBadge() {
    if (game.phase === 'ended') {
      el.secretGoalBadge.textContent = '';
      return;
    }
    const player = game.currentPlayer;
    const goalDef = SET_DEFINITIONS.find((s) => s.name === player.secretGoal);
    if (!goalDef) {
      el.secretGoalBadge.textContent = '';
      return;
    }
    const owned = player.collection.getGroupSize(player.secretGoal);
    const met = owned >= goalDef.goal;
    el.secretGoalBadge.textContent = `🎯 Kundenwunsch von ${player.name}: ${goalDef.emoji} ${goalDef.name} (${owned}/${goalDef.goal})${met ? ' ✅ erfüllt!' : ''}`;
  }

  function renderModifierBanner() {
    el.modifierBanner.textContent = game.activeModifier
      ? `🔥 ${game.activeModifier.label}: ${game.activeModifier.description}`
      : '';
  }

  // Zeigt Namen und Kartenzahl eines offenen Tauschs für alle sichtbar an,
  // solange er NICHT gerade den aktuellen Spieler blockiert (dafür gibt es
  // schon das eigene Panel) - macht nachvollziehbar, worauf man noch wartet.
  function renderPendingTradeBanner() {
    if (!game.pendingTrade || game.pendingTrade.toPlayerIndex === game.currentPlayerIndex) {
      el.pendingTradeBanner.textContent = '';
      return;
    }
    const fromPlayer = game.players[game.pendingTrade.fromPlayerIndex];
    const toPlayer = game.players[game.pendingTrade.toPlayerIndex];
    const count = game.pendingTrade.offeredCardIds.length;
    el.pendingTradeBanner.textContent = `📬 Offener Tausch: ${fromPlayer.name} → ${toPlayer.name} (${count} Karte(n), wartet bis ${toPlayer.name} an der Reihe ist)`;
  }

  function renderPlayers() {
    el.playersArea.innerHTML = '';
    const activeChanged = game.currentPlayerIndex !== previousActivePlayerIndex;
    previousActivePlayerIndex = game.currentPlayerIndex;
    game.players.forEach((player, index) => {
      const isActive = index === game.currentPlayerIndex;
      const box = document.createElement('div');
      box.className = 'player-box' + (isActive ? ' active' : '') + (isActive && activeChanged ? ' just-active' : '');

      const groupsHtml = [...player.collection.getGroups().entries()]
        .map(([setName, cards]) => {
          const goal = cards[0].setGoal || cards[0].setSize;
          const complete = cards.length >= goal;
          const key = `${player.id}:${setName}`;
          let justCompleted = false;
          if (complete && !announcedCompleteSets.has(key)) {
            announcedCompleteSets.add(key);
            justCompleted = true;
            showToast(`🎉 ${player.name}: Set ${cards[0].imagePlaceholder} komplett – Punkte verdoppelt!`, 'celebrate');
          }
          const classes = ['set-group', complete && 'complete', justCompleted && 'just-completed'].filter(Boolean).join(' ');
          return `<span class="${classes}">${cards[0].imagePlaceholder} ${cards.length}/${goal}</span>`;
        })
        .join('') || '<em>keine Sets</em>';

      box.innerHTML = `
        <h4>${escapeHtml(player.name)}<span>${player.hand.length} Karte(n)</span></h4>
        <div class="groups">${groupsHtml}</div>
      `;
      el.playersArea.appendChild(box);
    });
  }

  // 'event' (Popup wartet auf OK) hat Vorrang vor 'pending' vor 'composing'
  // vor 'normal'. 'pending' greift nur, wenn der AKTUELLE Spieler auch das
  // Ziel des offenen Tauschs ist - andere Spieler spielen dazwischen ganz
  // normal weiter, bis der Tausch bei ihrem eigenen Zug ansteht.
  function currentUiState() {
    if (game.pendingEvent) return 'event';
    if (game.pendingTrade && game.pendingTrade.toPlayerIndex === game.currentPlayerIndex) return 'pending';
    if (uiMode === 'composing') return 'composing';
    return 'normal';
  }

  function renderHand() {
    const state = currentUiState();
    el.handArea.hidden = state === 'pending';
    if (state === 'pending') return; // die Gegenkarten-Auswahl rendert renderTradePanels()

    const player = game.currentPlayer;
    const activeSelection = state === 'composing' ? tradeOfferSelection : selectedCardIds;
    el.handCount.textContent = String(player.hand.length);
    el.handLimit.textContent = String(HAND_LIMIT);
    el.handCards.innerHTML = '';
    const newCardIds = new Set();
    player.hand.forEach((card) => {
      const cardEl = createCardElement(card, {
        selectable: true,
        selected: activeSelection.has(card.id),
        onClick: (c) => {
          if (activeSelection.has(c.id)) activeSelection.delete(c.id);
          else activeSelection.add(c.id);
          render();
        },
      });
      if (!previousHandCardIds.has(card.id)) cardEl.classList.add('just-drawn');
      newCardIds.add(card.id);
      el.handCards.appendChild(cardEl);
    });
    previousHandCardIds = newCardIds;
  }

  function renderTradeTargetOptions() {
    el.tradeTargetOptions.innerHTML = '';
    game.players.forEach((player, index) => {
      if (index === game.currentPlayerIndex) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${player.name} (${player.hand.length} Karte(n))`;
      if (index === tradeOfferTargetIndex) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        tradeOfferTargetIndex = index;
        render();
      });
      el.tradeTargetOptions.appendChild(btn);
    });
  }

  function renderTradeResponseHand() {
    el.tradeResponseHand.innerHTML = '';
    if (!game.pendingTrade) return;
    const responder = game.players[game.pendingTrade.toPlayerIndex];
    responder.hand.forEach((card) => {
      const cardEl = createCardElement(card, {
        selectable: true,
        selected: tradeResponseSelection.has(card.id),
        onClick: (c) => {
          if (tradeResponseSelection.has(c.id)) tradeResponseSelection.delete(c.id);
          else tradeResponseSelection.add(c.id);
          render();
        },
      });
      el.tradeResponseHand.appendChild(cardEl);
    });
  }

  function renderTradePanels() {
    const state = currentUiState();
    el.tradeCompose.classList.toggle('open', state === 'composing');
    el.tradePending.classList.toggle('open', state === 'pending');

    // Immer aufrufen (nicht nur im 'pending'-Zweig): renderTradeResponseHand()
    // leert den Container selbst, wenn kein Tausch mehr offen ist - sonst
    // blieben dort alte, nur per CSS versteckte Kartenelemente im DOM stehen.
    renderTradeResponseHand();

    if (state === 'composing') {
      renderTradeTargetOptions();
      el.tradeSendBtn.disabled = tradeOfferSelection.size === 0 || tradeOfferTargetIndex === null;
    }

    if (state === 'pending') {
      const { fromPlayerIndex, offeredCardIds, toPlayerIndex } = game.pendingTrade;
      const fromPlayer = game.players[fromPlayerIndex];
      const toPlayer = game.players[toPlayerIndex];
      el.tradePendingSummary.textContent = `– ${fromPlayer.name} bietet ${toPlayer.name} ${offeredCardIds.length} Karte(n) verdeckt an`;
      el.tradeAcceptBtn.disabled = tradeResponseSelection.size === 0;
    }
  }

  // Ermittelt in Klartext, was als Nächstes zu tun ist - hilft Einsteigern,
  // ohne die Spielregeln selbst irgendwo zu duplizieren.
  function computeHint(state) {
    if (game.phase === 'ended') return '🏁 Die Partie ist vorbei – die Endwertung steht unten.';
    if (state === 'event') {
      return '📣 Ereignis aufgedeckt – im Popup mit „OK“ bestätigen.';
    }
    if (state === 'pending') {
      const fromPlayer = game.players[game.pendingTrade.fromPlayerIndex];
      const toPlayer = game.players[game.pendingTrade.toPlayerIndex];
      return `🎁 ${toPlayer.name}: Nimmst du das verdeckte Angebot von ${fromPlayer.name} an oder lehnst du ab?`;
    }
    if (state === 'composing') {
      return '🤝 Wähle Handkarte(n) für dein Angebot und ein Ziel, dann sende es ab.';
    }
    if (game.needsDiscard()) {
      const overflow = game.currentPlayer.hand.length - HAND_LIMIT;
      return `🗑️ Handkartenlimit überschritten: wähle ${overflow} Karte(n) aus und lege sie ab.`;
    }
    if (game.phase === 'playing' && !game.hasDrawnThisTurn) {
      return '🎴 Ziehe eine Karte, um deinen Zug zu beginnen.';
    }
    if (selectedCardIds.size > 0) {
      return '🃏 Passt die Auswahl? Klicke auf „Set ausspielen“.';
    }
    if (game.phase === 'showdown') {
      return '⏳ Showdown: keine neuen Karten mehr – spiele vorhandene Sets aus oder beende deinen Zug.';
    }
    return '👉 Wähle passende Handkarten für ein Set aus oder beende deinen Zug.';
  }

  function renderActions() {
    const state = currentUiState();
    const blocked = state !== 'normal'; // ein offener Tausch pausiert den normalen Zug
    const needsDiscard = game.needsDiscard();
    const ended = game.phase === 'ended';
    const mustDrawFirst = game.phase === 'playing' && !game.hasDrawnThisTurn;

    const modifier = game.activeModifier?.id;
    const setsForbidden = modifier === 'verkaufsstopp' || (modifier === 'nur-fuer-profis' && game.currentPlayer.collection.getAllCards().length === 0);

    el.drawBtn.disabled = blocked || ended || needsDiscard || game.phase !== 'playing' || game.hasDrawnThisTurn;
    el.playSetBtn.disabled = blocked || ended || needsDiscard || mustDrawFirst || selectedCardIds.size === 0 || setsForbidden;
    el.declutterBtn.disabled =
      blocked || ended || needsDiscard || mustDrawFirst || game.phase !== 'playing' || selectedCardIds.size !== 2;
    // Weltweit nur 1 offener Tausch gleichzeitig (siehe rules.js proposeTrade) -
    // der Button bleibt also auch für unbeteiligte Spieler gesperrt, solange
    // irgendwo noch einer aussteht.
    el.tradeBtn.disabled = blocked || ended || needsDiscard || mustDrawFirst || Boolean(game.pendingTrade);
    el.endTurnBtn.disabled = blocked || ended || needsDiscard || mustDrawFirst;

    el.discardRequired.hidden = !needsDiscard || state !== 'normal';
    if (needsDiscard && state === 'normal') {
      const overflow = game.currentPlayer.hand.length - HAND_LIMIT;
      el.discardNeededCount.textContent = String(overflow);
      el.confirmDiscardBtn.disabled = selectedCardIds.size !== overflow;
    }

    // Hebt die naheliegende nächste Aktion optisch hervor, ohne andere gültige Züge zu sperren.
    [el.drawBtn, el.playSetBtn, el.endTurnBtn].forEach((btn) => btn.classList.remove('primary'));
    if (!ended && state === 'normal') {
      if (mustDrawFirst && !needsDiscard) el.drawBtn.classList.add('primary');
      else if (selectedCardIds.size > 0 && !el.playSetBtn.disabled) el.playSetBtn.classList.add('primary');
      else if (!needsDiscard && !el.endTurnBtn.disabled) el.endTurnBtn.classList.add('primary');
    }

    el.hintBanner.textContent = computeHint(state);
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
      .map((s) => {
        const goalDef = SET_DEFINITIONS.find((g) => g.name === s.player.secretGoal);
        const goalLabel = goalDef
          ? `${goalDef.emoji} ${escapeHtml(goalDef.name)} ${s.secretGoalMet ? '✅ +' + s.secretGoalBonus : '❌'}`
          : '–';
        return `
        <tr class="${winnerIds.has(s.player.id) ? 'winner' : ''}">
          <td>${escapeHtml(s.player.name)}</td>
          <td>${s.setPoints}</td>
          <td>${s.handPoints}</td>
          <td>${goalLabel}</td>
          <td>${s.total}</td>
        </tr>`;
      })
      .join('');

    el.finalScores.innerHTML = `
      <table>
        <thead><tr><th>Spieler</th><th>Set-Punkte</th><th>Handkarten</th><th>Kundenwunsch</th><th>Gesamt</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><strong>Gewinner:</strong> ${winners.map((w) => escapeHtml(w.player.name)).join(', ')}</p>
    `;
  }

  function renderLog() {
    el.logList.innerHTML = game.log
      .slice(-30)
      .reverse()
      .map((entry) => `<li>${escapeHtml(entry)}</li>`)
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
      .map((p) => `<div><strong>${escapeHtml(p.name)}:</strong> ${p.hand.map(cardLabel).join(', ') || '(leer)'}</div>`)
      .join('');

    const events = [
      ...game.revealedEvents.map((c) => `${cardLabel(c)} (aufgedeckt)`),
      ...game.eventDeck.cards.slice().reverse().map((c) => `${cardLabel(c)} (verdeckt)`),
    ].join('<br>');

    const allMysterio = game.players
      .map((p) => {
        const owned = p.collection.getGroups().get('Mysterio') || [];
        return owned.length ? `<div>${escapeHtml(p.name)}: ${owned.map(cardLabel).join(', ')}</div>` : '';
      })
      .filter(Boolean)
      .join('') || '<div>Noch keine ausgespielt.</div>';

    const scores = game
      .calculateScores()
      .map(
        (s) =>
          `<div>${escapeHtml(s.player.name)}: ${s.total} Punkte (Sets ${s.setPoints}, Hand ${s.handPoints}, Kundenwunsch ${s.secretGoalMet ? '✅' : '❌'})</div>`
      )
      .join('');

    const secretGoals = game.players
      .map((p) => `<div>${escapeHtml(p.name)}: ${escapeHtml(p.secretGoal || '–')}</div>`)
      .join('');

    let pendingTradeHtml = '<div>Kein offener Tausch.</div>';
    if (game.pendingTrade) {
      const { fromPlayerIndex, offeredCardIds, toPlayerIndex } = game.pendingTrade;
      const fromPlayer = game.players[fromPlayerIndex];
      const toPlayer = game.players[toPlayerIndex];
      const offeredNames = fromPlayer.hand.filter((c) => offeredCardIds.includes(c.id)).map(cardLabel).join(', ');
      pendingTradeHtml = `<div>${escapeHtml(fromPlayer.name)} → ${escapeHtml(toPlayer.name)}: ${escapeHtml(offeredNames)}</div>`;
    }

    const modifierHtml = game.activeModifier
      ? `<div>${escapeHtml(game.activeModifier.label)}: ${escapeHtml(game.activeModifier.description)}</div>`
      : '<div>Kein aktiver Twist.</div>';

    el.debugContent.innerHTML = `
      <section><h4>Nachziehstapel (Reihenfolge, oben zuerst)</h4>${drawOrder}</section>
      <section><h4>Alle Spielerhände</h4>${hands}</section>
      <section><h4>Ereigniskarten</h4>${events}</section>
      <section><h4>Mysterio-Karten im Spiel</h4>${allMysterio}</section>
      <section><h4>Aktiver Twist</h4>${modifierHtml}</section>
      <section><h4>Offener Tausch (normalerweise verdeckt)</h4>${pendingTradeHtml}</section>
      <section><h4>Kundenwünsche (normalerweise privat)</h4>${secretGoals}</section>
      <section><h4>Aktuelle Punkte</h4>${scores}</section>
    `;
  }

  function renderEventModal() {
    const isOpen = !!game.pendingEvent;
    const wasOpen = el.eventModal.classList.contains('open');
    el.eventModal.classList.toggle('open', isOpen);
    if (isOpen) {
      el.eventModalTitle.textContent = game.pendingEvent.title;
      el.eventModalDescription.textContent = game.pendingEvent.description;
      if (!wasOpen) el.eventModalOkBtn.focus();
    }
  }

  function render() {
    if (!game) return;
    renderStatusBar();
    renderPiles();
    renderModifierBanner();
    renderPendingTradeBanner();
    renderSecretGoalBadge();
    renderPlayers();
    renderHand();
    renderTradePanels();
    renderActions();
    renderEndPanel();
    renderLog();
    renderDebugPanel();
    renderEventModal();
  }

  renderNameInputs();

  // Sicherheitsnetz: eine unerwartete Ausnahme irgendwo im Code soll sichtbares
  // Feedback geben statt die Seite scheinbar "einfrieren" zu lassen, ohne dass
  // erkennbar ist, warum Buttons plötzlich nicht mehr reagieren.
  window.addEventListener('error', (e) => {
    if (el.statusMessage) {
      el.statusMessage.textContent = `Unerwarteter Fehler: ${e.message}. Bitte Seite neu laden, falls sie nicht mehr reagiert.`;
    }
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (el.statusMessage) {
      el.statusMessage.textContent = `Unerwarteter Fehler: ${e.reason?.message || e.reason}. Bitte Seite neu laden, falls sie nicht mehr reagiert.`;
    }
  });
})();
