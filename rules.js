// rules.js — Spielregeln für Flow-Markt V0.1
// Enthält Player und Game. Kennt keine DOM-APIs; die UI (script.js) spricht
// ausschließlich über diese Schnittstelle mit dem Spielzustand.

(function (global) {
  'use strict';

  const FlowMarkt = global.FlowMarkt || (global.FlowMarkt = {});
  const { Deck, DiscardPile, Collection, createObjectCards, createMysterioCards, createRamschCards, createEventCards } = FlowMarkt;

  const HAND_LIMIT = 3;

  class Player {
    constructor(id, name) {
      this.id = id;
      this.name = name;
      this.hand = [];
      this.collection = new Collection();
      this.handLimit = HAND_LIMIT;
    }

    addCards(cards) {
      this.hand.push(...cards);
    }

    removeFromHand(cardIds) {
      const ids = new Set(cardIds);
      const removed = this.hand.filter((c) => ids.has(c.id));
      this.hand = this.hand.filter((c) => !ids.has(c.id));
      return removed;
    }

    isOverHandLimit() {
      return this.hand.length > this.handLimit;
    }
  }

  class Game {
    constructor({ playerCount = 3, playerNames = [], debug = false } = {}) {
      this.debug = debug;
      this.phase = 'setup'; // setup | playing | showdown | ended
      this.players = [];
      this.currentPlayerIndex = 0;
      this.roundNumber = 0;
      this.hasDrawnThisTurn = false;
      this.drawPile = null;
      this.discardPile = new DiscardPile();
      this.eventDeck = null;
      this.revealedEvents = [];
      this.log = [];
      this._playerCount = playerCount;
      this._playerNames = playerNames;
      // { fromPlayerIndex, offeredCardIds, toPlayerIndex } while ein Tausch auf
      // eine Reaktion wartet; blockiert währenddessen alle anderen Zugaktionen.
      this.pendingTrade = null;
    }

    _log(message) {
      this.log.push(message);
      if (this.log.length > 200) this.log.shift();
    }

    setup() {
      this.players = [];
      for (let i = 0; i < this._playerCount; i++) {
        const name = this._playerNames[i] || `Spieler ${i + 1}`;
        this.players.push(new Player(`p${i + 1}`, name));
      }

      const objectCards = createObjectCards();
      const mysterioCards = createMysterioCards();
      const ramschCards = createRamschCards();
      this.drawPile = new Deck([...objectCards, ...mysterioCards, ...ramschCards]).shuffle();

      this.eventDeck = new Deck(createEventCards()).shuffle();
      this.discardPile = new DiscardPile();
      this.revealedEvents = [];
      this.currentPlayerIndex = 0;
      this.roundNumber = 1;
      this.hasDrawnThisTurn = false;
      this.pendingTrade = null;
      this.log = [];

      for (const player of this.players) {
        player.hand = [];
        player.collection = new Collection();
        player.addCards(this.drawPile.drawMany(2));
      }

      this.phase = 'playing';
      this._log('Spiel gestartet.');
    }

    get currentPlayer() {
      return this.players[this.currentPlayerIndex];
    }

    // --- Zugschritt 1: Karte ziehen -------------------------------------
    drawCard() {
      if (this.pendingTrade) {
        throw new Error('Bitte zuerst den offenen Tausch klären.');
      }
      if (this.phase !== 'playing') {
        throw new Error('Im Showdown werden keine Karten mehr gezogen.');
      }
      if (this.hasDrawnThisTurn) {
        throw new Error('In diesem Zug wurde bereits gezogen.');
      }
      if (this.drawPile.isEmpty) {
        this._enterShowdown();
        return null;
      }
      const card = this.drawPile.draw();
      this.currentPlayer.addCards([card]);
      this.hasDrawnThisTurn = true;
      this._log(`${this.currentPlayer.name} zieht eine Karte.`);
      if (this.drawPile.isEmpty) this._enterShowdown();
      return card;
    }

    // --- Zugschritt 2+3: Set ausspielen + Bonuskarte ---------------------
    playSet(cardIds) {
      if (this.pendingTrade) {
        throw new Error('Bitte zuerst den offenen Tausch klären.');
      }
      if (this.phase === 'playing' && !this.hasDrawnThisTurn) {
        throw new Error('Bitte zuerst eine Karte ziehen.');
      }
      if (this.phase === 'ended') {
        throw new Error('Das Spiel ist bereits beendet.');
      }

      const player = this.currentPlayer;
      const idSet = new Set(cardIds);
      const cards = player.hand.filter((c) => idSet.has(c.id));
      if (cards.length !== cardIds.length || cards.length === 0) {
        throw new Error('Ungültige Kartenauswahl.');
      }
      const setName = cards[0].setName;
      if (!cards.every((c) => c.setName === setName)) {
        throw new Error('Alle ausgewählten Karten müssen zum selben Set gehören.');
      }
      if (setName === 'Ramsch') {
        throw new Error('Ramsch-Karten sind wertlos und lassen sich nicht als Set ausspielen - nur ablegen oder verdeckt wegtauschen.');
      }
      const existing = player.collection.getGroupSize(setName);
      if (existing + cards.length < 2) {
        throw new Error('Ein Set benötigt mindestens 2 Karten (oder ein bereits begonnenes Set).');
      }

      player.removeFromHand(cardIds);
      player.collection.addCards(cards);
      this._log(`${player.name} spielt ${cards.length} Karte(n) im Set "${setName}" aus.`);

      // Mysterio-Karten haben schon einen (Platzhalter-)Effekttext in der UI,
      // ihre specialEffect/drawback-Funktionen werden für V0.1 aber bewusst
      // noch nicht ausgelöst - das Verdrahten folgt in einer späteren Version.

      if (this.phase === 'playing') {
        if (this.drawPile.isEmpty) {
          this._enterShowdown();
        } else {
          const bonus = this.drawPile.draw();
          player.addCards([bonus]);
          this._log(`${player.name} zieht eine Bonuskarte für das ausgespielte Set.`);
          if (this.drawPile.isEmpty) this._enterShowdown();
        }
      }
    }

    // --- Zugschritt 4: Tausch anbieten -------------------------------------
    // Verdeckter Tausch: Der Zielspieler sieht die angebotenen Karten nicht,
    // bevor er reagiert - er kann nur die Anzahl kennen. Damit ist ein Tausch
    // reines Glücksspiel und Ramsch-Karten lassen sich unbemerkt loswerden.
    proposeTrade(offeredCardIds, toPlayerIndex) {
      if (this.pendingTrade) {
        throw new Error('Es gibt bereits einen offenen Tausch.');
      }
      if (this.phase === 'ended') {
        throw new Error('Das Spiel ist bereits beendet.');
      }
      if (this.needsDiscard()) {
        throw new Error('Bitte zuerst das Handkartenlimit einhalten.');
      }
      if (!Number.isInteger(toPlayerIndex) || toPlayerIndex < 0 || toPlayerIndex >= this.players.length) {
        throw new Error('Ungültiger Zielspieler.');
      }
      if (toPlayerIndex === this.currentPlayerIndex) {
        throw new Error('Du kannst nicht mit dir selbst tauschen.');
      }

      const fromPlayer = this.currentPlayer;
      const idSet = new Set(offeredCardIds);
      const cards = fromPlayer.hand.filter((c) => idSet.has(c.id));
      if (cards.length !== offeredCardIds.length || cards.length === 0) {
        throw new Error('Bitte mindestens eine Karte für den Tausch auswählen.');
      }

      const toPlayer = this.players[toPlayerIndex];
      this.pendingTrade = {
        fromPlayerIndex: this.currentPlayerIndex,
        offeredCardIds: cards.map((c) => c.id),
        toPlayerIndex,
      };
      this._log(`${fromPlayer.name} bietet ${toPlayer.name} ${cards.length} Karte(n) verdeckt zum Tausch an.`);
    }

    declineTrade() {
      if (!this.pendingTrade) {
        throw new Error('Es gibt keinen offenen Tausch.');
      }
      const fromPlayer = this.players[this.pendingTrade.fromPlayerIndex];
      const toPlayer = this.players[this.pendingTrade.toPlayerIndex];
      this._log(`${toPlayer.name} lehnt den Tausch von ${fromPlayer.name} ab.`);
      this.pendingTrade = null;
    }

    acceptTradeWithCounter(counterCardIds) {
      if (!this.pendingTrade) {
        throw new Error('Es gibt keinen offenen Tausch.');
      }
      const { fromPlayerIndex, offeredCardIds, toPlayerIndex } = this.pendingTrade;
      const fromPlayer = this.players[fromPlayerIndex];
      const toPlayer = this.players[toPlayerIndex];

      const idSet = new Set(counterCardIds);
      const counterCards = toPlayer.hand.filter((c) => idSet.has(c.id));
      if (counterCards.length !== counterCardIds.length || counterCards.length === 0) {
        throw new Error('Bitte mindestens eine Gegenkarte auswählen.');
      }

      const offeredCards = fromPlayer.removeFromHand(offeredCardIds);
      const givenBack = toPlayer.removeFromHand(counterCards.map((c) => c.id));
      toPlayer.addCards(offeredCards);
      fromPlayer.addCards(givenBack);
      this._log(
        `${fromPlayer.name} und ${toPlayer.name} tauschen ${offeredCards.length} gegen ${givenBack.length} Karte(n) - erst jetzt sehen beide, was sie bekommen haben.`
      );
      this.pendingTrade = null;
    }

    // --- Zugschritt 5: Handkartenlimit -----------------------------------
    needsDiscard() {
      return this.currentPlayer.isOverHandLimit();
    }

    discardCards(cardIds) {
      const player = this.currentPlayer;
      const removed = player.removeFromHand(cardIds);
      this.discardPile.addMany(removed);
      this._log(`${player.name} legt ${removed.length} Karte(n) auf den Friedhof.`);
    }

    // --- Zugschritt 6: Zug beenden ----------------------------------------
    endTurn() {
      if (this.phase === 'ended') return;
      if (this.pendingTrade) {
        throw new Error('Bitte zuerst den offenen Tausch klären.');
      }
      if (this.phase === 'playing' && !this.hasDrawnThisTurn) {
        throw new Error('Bitte zuerst eine Karte ziehen.');
      }
      if (this.needsDiscard()) {
        throw new Error('Handkartenlimit überschritten – bitte zuerst Karten ablegen.');
      }

      const wasLastPlayer = this.currentPlayerIndex === this.players.length - 1;
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      this.hasDrawnThisTurn = false;

      if (wasLastPlayer) {
        this.roundNumber++;
        this._resolveEventCard();
      }

      if (this.phase === 'showdown' && !this._anyoneCanPlaySet()) {
        this._endGame();
      }
    }

    _resolveEventCard() {
      if (!this.eventDeck || this.eventDeck.isEmpty) return;
      const card = this.eventDeck.draw();
      this.revealedEvents.push(card);
      this._log(`Ereignis aufgedeckt: "${card.title}" – ${card.description}`);
      try {
        card.effect(this);
      } catch (err) {
        this._log(`Fehler beim Ereigniseffekt: ${err.message}`);
      }
    }

    _enterShowdown() {
      if (this.phase !== 'showdown') {
        this.phase = 'showdown';
        this._log('Der Nachziehstapel ist leer – Showdown beginnt!');
      }
    }

    _anyoneCanPlaySet() {
      return this.players.some((p) => this._playerHasPlayableSet(p));
    }

    _playerHasPlayableSet(player) {
      const bySetName = new Map();
      for (const card of player.hand) {
        if (card.setName === 'Ramsch') continue; // Ramsch lässt sich nie ausspielen
        if (!bySetName.has(card.setName)) bySetName.set(card.setName, []);
        bySetName.get(card.setName).push(card);
      }
      for (const [setName, cards] of bySetName) {
        const existing = player.collection.getGroupSize(setName);
        if (existing > 0 || cards.length >= 2) return true;
      }
      return false;
    }

    _endGame() {
      this.phase = 'ended';
      this._log('Niemand kann noch Sets bilden – das Spiel endet.');
    }

    // --- Wertung -----------------------------------------------------------
    // Mysterio-Karten zählen hier wie normale Objektkarten über ihr Set
    // "Mysterio" mit - ihr specialEffect-Bonus ist für V0.1 bewusst noch
    // nicht verdrahtet (siehe MysterioCard-Kommentar in cards.js).
    calculateScores() {
      return this.players.map((player) => {
        const { total, breakdown } = player.collection.computeScore();
        const handPoints = player.hand.reduce((sum, c) => sum + (c.points || 0), 0);
        return {
          player,
          setPoints: total,
          breakdown,
          handPoints,
          total: total + handPoints,
        };
      });
    }

    getWinner() {
      const scores = this.calculateScores();
      const max = Math.max(...scores.map((s) => s.total));
      return scores.filter((s) => s.total === max);
    }
  }

  Object.assign(FlowMarkt, { Player, Game, HAND_LIMIT });
})(window);
