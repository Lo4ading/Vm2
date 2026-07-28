// script.js — UI-Schicht für Flow-Markt V0.1
// Enthält ausschließlich Rendering und Event-Wiring. Keine Spielregeln hier;
// jede Aktion delegiert an die Game-Instanz aus rules.js.

(function () {
  'use strict';

  const { Game, HAND_LIMIT, BIN_CAPACITY } = window.FlowMarkt;

  let game = null;
  let selectedCardIds = new Set();
  let debugEnabled = false;
  let lastLoggedIndex = 0;
  let announcedCompleteSets = new Set(); // `${playerId}:${setName}`, verhindert wiederholte Feier-Toasts
  let celebrationFired = false;
  let previousHandCardIds = new Set(); // für die Zieh-Einflug-Animation neuer Handkarten
  let previousActivePlayerIndex = -1; // für den Zugwechsel-Puls

  const CONFETTI_EMOJI = ['🎉', '🎊', '✨', '🥳'];

  // Spielernamen landen an mehreren Stellen in innerHTML-Strings - ungeschützt
  // wäre das eine HTML-Injection (z. B. brach ein "<" im Namen bisher das
  // Log-Rendering).
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
    binPileCount: document.getElementById('bin-pile-count'),
    eventCardDisplay: document.getElementById('event-card-display'),

    playersArea: document.getElementById('players-area'),
    handCount: document.getElementById('hand-count'),
    handLimit: document.getElementById('hand-limit'),
    handCards: document.getElementById('hand-cards'),

    playSetBtn: document.getElementById('play-set-btn'),
    binPutBtn: document.getElementById('bin-put-btn'),
    binTakeBtn: document.getElementById('bin-take-btn'),
    endTurnBtn: document.getElementById('end-turn-btn'),
    newGameBtn: document.getElementById('new-game-btn'),

    handArea: document.querySelector('.hand-area'),

    toastContainer: document.getElementById('toast-container'),
    confettiLayer: document.getElementById('confetti-layer'),

    discardRequired: document.getElementById('discard-required'),
    discardNeededCount: document.getElementById('discard-needed-count'),
    confirmDiscardBtn: document.getElementById('confirm-discard-btn'),

    hintBanner: document.getElementById('hint-banner'),
    modifierBanner: document.getElementById('modifier-banner'),
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
    window.FlowMarkt.debugGame = game; // Konsolenzugriff für Fehlersuche/Tests

    el.setupScreen.hidden = true;
    el.gameScreen.hidden = false;
    autoDrawIfNeeded();
    flushLogToasts();
    render();
  });

  // Kein window.confirm(): in eingebetteten/sandboxed Ansichten (z. B. Artifacts)
  // werden native Dialoge oft unterdrückt, wodurch der Button sonst wirkungslos wäre.
  el.newGameBtn.addEventListener('click', () => {
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
  el.playSetBtn.addEventListener('click', () =>
    runAction(() => {
      if (selectedCardIds.size === 0) {
        throw new Error('Bitte zuerst Handkarten auswählen.');
      }
      game.playSet([...selectedCardIds]);
      selectedCardIds.clear();
    })
  );

  // Grabbelkiste: der einzige Weg, wie Karten heute den Besitzer wechseln.
  // Kein Zielspieler, keine Absprache möglich - pro Zug normalerweise nur
  // eine Richtung (rein ODER raus), siehe rules.js putInBin()/takeFromBin().
  el.binPutBtn.addEventListener('click', () =>
    runAction(() => {
      if (selectedCardIds.size !== 1) {
        throw new Error('Bitte genau 1 Karte zum Reinlegen auswählen.');
      }
      const [cardId] = selectedCardIds;
      game.putInBin(cardId);
      selectedCardIds.clear();
    })
  );

  el.binTakeBtn.addEventListener('click', () => runAction(() => game.takeFromBin()));

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
    autoDrawIfNeeded();
    flushLogToasts();
    render();
  }

  // Ziehen ist kein eigener Zugschritt mehr, den man anstoßen muss - man zieht
  // ohnehin bei jedem Zug automatisch genau 1 Karte. Läuft nach jeder Aktion,
  // damit es greift, sobald der Zug wirklich beginnt (z. B. direkt nach
  // Spielstart, nach Zugwechsel oder nachdem ein Ereignis-Popup bestätigt
  // wurde) - die Zieh-Einflug-Animation (siehe renderHand) bleibt dabei erhalten.
  function autoDrawIfNeeded() {
    if (!game) return;
    if (game.phase === 'playing' && !game.hasDrawnThisTurn && !game.pendingEvent) {
      try {
        game.drawCard();
      } catch {
        // sollte durch die obige Bedingung nie eintreten - sicherheitshalber
        // trotzdem abgefangen, damit ein unerwarteter Zustand nicht die
        // ganze Aktionskette blockiert.
      }
    }
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
      if (entry.includes('Grabbelkiste')) variant = 'trade';
      if (entry.startsWith('💬')) variant = 'flavor';
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
    const tooltip = card.type === 'mysterio' && card.effectText ? card.effectText : card.flavorText;
    if (tooltip) div.title = tooltip;
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
    el.binPileCount.textContent = `${game.bargainBin.length}/${BIN_CAPACITY}`;
    const lastEvent = game.revealedEvents[game.revealedEvents.length - 1];
    el.eventCardDisplay.textContent = lastEvent
      ? `${lastEvent.title}\n${lastEvent.description}`
      : 'Noch keine aufgedeckt';
  }

  function renderModifierBanner() {
    el.modifierBanner.textContent = game.activeModifier
      ? `🔥 ${game.activeModifier.label}: ${game.activeModifier.description}`
      : '';
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

  // Nur noch zwei Zustände: 'event' (Popup wartet auf OK, hat Vorrang) oder
  // 'normal'. Ohne 1:1-Tausch gibt es keinen dritten, wartenden Zustand mehr.
  function currentUiState() {
    if (game.pendingEvent) return 'event';
    return 'normal';
  }

  function renderHand() {
    const state = currentUiState();
    const player = game.currentPlayer;
    el.handCount.textContent = String(player.hand.length);
    el.handLimit.textContent = String(HAND_LIMIT);
    el.handCards.innerHTML = '';
    const newCardIds = new Set();
    player.hand.forEach((card) => {
      const cardEl = createCardElement(card, {
        selectable: state === 'normal',
        selected: selectedCardIds.has(card.id),
        onClick: (c) => {
          if (selectedCardIds.has(c.id)) selectedCardIds.delete(c.id);
          else selectedCardIds.add(c.id);
          render();
        },
      });
      if (!previousHandCardIds.has(card.id)) cardEl.classList.add('just-drawn');
      newCardIds.add(card.id);
      el.handCards.appendChild(cardEl);
    });
    previousHandCardIds = newCardIds;
  }

  // Prüft, ob die aktuelle Auswahl überhaupt ein gültiges (Teil-)Set ergäbe -
  // dieselbe Logik wie rules.js playSet(), aber ohne Seiteneffekte. Der Button
  // bleibt so grau, solange die Auswahl kein spielbares Set bildet, statt erst
  // beim Klick eine Fehlermeldung zu zeigen.
  function selectionFormsValidSet() {
    if (selectedCardIds.size === 0) return false;
    const player = game.currentPlayer;
    const cards = player.hand.filter((c) => selectedCardIds.has(c.id));
    if (cards.length !== selectedCardIds.size) return false;
    const setName = cards[0].setName;
    if (!cards.every((c) => c.setName === setName)) return false;
    const existing = player.collection.getGroupSize(setName);
    return existing + cards.length >= 2;
  }

  // Ermittelt in Klartext, was als Nächstes zu tun ist - hilft Einsteigern,
  // ohne die Spielregeln selbst irgendwo zu duplizieren.
  function computeHint(state) {
    if (game.phase === 'ended') return '🏁 Die Partie ist vorbei – die Endwertung steht unten.';
    if (state === 'event') {
      return '📣 Ereignis aufgedeckt – im Popup mit „OK“ bestätigen.';
    }
    if (game.needsDiscard()) {
      const overflow = game.currentPlayer.hand.length - HAND_LIMIT;
      return `🗑️ Handkartenlimit überschritten: wähle ${overflow} Karte(n) aus und lege sie ab.`;
    }
    if (selectedCardIds.size > 0) {
      return '🃏 Passt die Auswahl? Klicke auf „Set ausspielen“ oder „In Grabbelkiste legen“ (bei genau 1 Karte).';
    }
    if (game.phase === 'showdown') {
      return '⏳ Showdown: keine neuen Karten mehr – spiele vorhandene Sets aus oder beende deinen Zug.';
    }
    return '👉 Wähle passende Handkarten für ein Set aus, greif in die Grabbelkiste oder beende deinen Zug.';
  }

  function renderActions() {
    const state = currentUiState();
    const blocked = state !== 'normal';
    const needsDiscard = game.needsDiscard();
    const ended = game.phase === 'ended';
    const mustDrawFirst = game.phase === 'playing' && !game.hasDrawnThisTurn;
    const notPlaying = game.phase !== 'playing';

    const modifier = game.activeModifier?.id;
    const setsForbidden = modifier === 'verkaufsstopp' || (modifier === 'nur-fuer-profis' && game.currentPlayer.collection.getAllCards().length === 0);

    el.playSetBtn.disabled = blocked || ended || needsDiscard || mustDrawFirst || setsForbidden || !selectionFormsValidSet();
    el.binPutBtn.disabled =
      blocked || ended || needsDiscard || mustDrawFirst || notPlaying ||
      selectedCardIds.size !== 1 || game.binPutUsedThisTurn || game.bargainBin.length >= BIN_CAPACITY;
    el.binTakeBtn.disabled =
      blocked || ended || needsDiscard || mustDrawFirst || notPlaying ||
      game.binTakeUsedThisTurn || game.bargainBin.length === 0;
    el.endTurnBtn.disabled = blocked || ended || needsDiscard || mustDrawFirst;

    el.discardRequired.hidden = !needsDiscard || state !== 'normal';
    if (needsDiscard && state === 'normal') {
      const overflow = game.currentPlayer.hand.length - HAND_LIMIT;
      el.discardNeededCount.textContent = String(overflow);
      el.confirmDiscardBtn.disabled = selectedCardIds.size !== overflow;
    }

    // Hebt die naheliegende nächste Aktion optisch hervor, ohne andere gültige Züge zu sperren.
    [el.playSetBtn, el.endTurnBtn].forEach((btn) => btn.classList.remove('primary'));
    if (!ended && state === 'normal') {
      if (!el.playSetBtn.disabled) el.playSetBtn.classList.add('primary');
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
        const mysterioLabel = s.mysterioBonus > 0 ? `✨ +${s.mysterioBonus}` : '–';
        return `
        <tr class="${winnerIds.has(s.player.id) ? 'winner' : ''}">
          <td>${escapeHtml(s.player.name)}</td>
          <td>${s.setPoints}</td>
          <td>${s.handPoints}</td>
          <td>${mysterioLabel}</td>
          <td>${s.total}</td>
        </tr>`;
      })
      .join('');

    el.finalScores.innerHTML = `
      <table>
        <thead><tr><th>Spieler</th><th>Set-Punkte</th><th>Handkarten</th><th>Mysterio</th><th>Gesamt</th></tr></thead>
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
          `<div>${escapeHtml(s.player.name)}: ${s.total} Punkte (Sets ${s.setPoints}, Hand ${s.handPoints}, Mysterio ${s.mysterioBonus})</div>`
      )
      .join('');

    const binContents = game.bargainBin.length
      ? game.bargainBin.map((c) => escapeHtml(cardLabel(c))).join(', ')
      : '(leer)';

    const modifierHtml = game.activeModifier
      ? `<div>${escapeHtml(game.activeModifier.label)}: ${escapeHtml(game.activeModifier.description)}</div>`
      : '<div>Kein aktiver Twist.</div>';

    el.debugContent.innerHTML = `
      <section><h4>Nachziehstapel (Reihenfolge, oben zuerst)</h4>${drawOrder}</section>
      <section><h4>Alle Spielerhände</h4>${hands}</section>
      <section><h4>Ereigniskarten</h4>${events}</section>
      <section><h4>Mysterio-Karten im Spiel</h4>${allMysterio}</section>
      <section><h4>Aktiver Twist</h4>${modifierHtml}</section>
      <section><h4>Grabbelkiste (normalerweise verdeckt)</h4>${binContents}</section>
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

  // Jeder Renderschritt läuft einzeln abgesichert: wirft einer eine Ausnahme
  // (z. B. ein unerwarteter Datenzustand), dürfen die folgenden Schritte -
  // allen voran renderActions(), das die Buttons wieder freischaltet -
  // trotzdem noch laufen. Ohne dieses Netz bliebe die Seite nach einem
  // einzigen fehlerhaften Renderschritt mit eingefrorenen Buttons stehen,
  // ohne dass ersichtlich wäre, warum nichts mehr reagiert.
  const RENDER_STEPS = [
    renderStatusBar,
    renderPiles,
    renderModifierBanner,
    renderPlayers,
    renderHand,
    renderActions,
    renderEndPanel,
    renderLog,
    renderDebugPanel,
    renderEventModal,
  ];

  function render() {
    if (!game) return;
    for (const step of RENDER_STEPS) {
      try {
        step();
      } catch (err) {
        console.error(`Renderfehler in ${step.name}:`, err);
        if (el.statusMessage) {
          el.statusMessage.textContent = `Anzeigefehler (${step.name}): ${err.message}. Bitte Seite neu laden, falls Buttons nicht mehr reagieren.`;
        }
      }
    }
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
