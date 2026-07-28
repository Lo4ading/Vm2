// rules.js — Spielregeln für Flow-Markt V0.1
// Enthält Player und Game. Kennt keine DOM-APIs; die UI (script.js) spricht
// ausschließlich über diese Schnittstelle mit dem Spielzustand.

(function (global) {
  'use strict';

  const FlowMarkt = global.FlowMarkt || (global.FlowMarkt = {});
  const {
    Deck,
    DiscardPile,
    Collection,
    createObjectCards,
    createMysterioCards,
    createRamschCards,
    createEventCards,
  } = FlowMarkt;

  const HAND_LIMIT = 3;
  const BIN_CAPACITY = 5;
  const BIN_CAPACITY_BOOSTED = 8;

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
      // Höchstens 1 Bonuskarte pro Zug, egal wie viele Sets gespielt werden -
      // dämpft den Schneeball-Effekt (mehr Sets → mehr Karten → noch mehr Sets).
      this.bonusDrawGrantedThisTurn = false;
      this.drawPile = null;
      this.discardPile = new DiscardPile();
      this.eventDeck = null;
      this.revealedEvents = [];
      this.log = [];
      this._playerCount = playerCount;
      this._playerNames = playerNames;
      // Grabbelkiste: gemeinsamer, verdeckter Stapel in der Tischmitte - der
      // einzige Weg, wie Karten heute zwischen Spielern die Seite wechseln.
      // Bewusst nicht 1:1/zielgerichtet: niemand kann sich mit einem anderen
      // Spieler gezielt absprechen ("Teamarbeit"), da man nie weiß, wer eine
      // hineingelegte Karte am Ende herausnimmt.
      this.bargainBin = [];
      this.binPutUsedThisTurn = false;
      this.binTakeUsedThisTurn = false;
      // Die aufgedeckte EventCard, solange ihr Effekt noch nicht bestätigt
      // wurde (siehe acknowledgePendingEvent) - blockiert ebenfalls den Zug,
      // damit das Popup in der UI erzwungen werden kann.
      this.pendingEvent = null;
      // { id, label, description } einer "Twist"-Ereigniskarte, aktiv bis
      // das nächste Ereignis aufgedeckt wird (siehe acknowledgePendingEvent).
      this.activeModifier = null;
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
      this.bonusDrawGrantedThisTurn = false;
      this.bargainBin = [];
      this.binPutUsedThisTurn = false;
      this.binTakeUsedThisTurn = false;
      this.pendingEvent = null;
      this.activeModifier = null;
      this.log = [];

      this.players.forEach((player) => {
        player.hand = [];
        player.collection = new Collection();
        player.addCards(this.drawPile.drawMany(2));
      });

      this.phase = 'playing';
      this._log('Spiel gestartet.');
    }

    get currentPlayer() {
      return this.players[this.currentPlayerIndex];
    }

    // Ein noch nicht bestätigtes Ereignis pausiert immer den ganzen Zug - das
    // Popup ist global und muss aktiv mit "OK" bestätigt werden.
    _assertNoPendingInterrupt() {
      if (this.pendingEvent) {
        throw new Error('Bitte zuerst das Ereignis bestätigen.');
      }
    }

    // --- Zugschritt 1: Karte ziehen -------------------------------------
    drawCard() {
      this._assertNoPendingInterrupt();
      if (this.phase !== 'playing') {
        throw new Error('Im Showdown werden keine Karten mehr gezogen.');
      }
      if (this.hasDrawnThisTurn) {
        throw new Error('In diesem Zug wurde bereits gezogen.');
      }

      const player = this.currentPlayer;
      // Twist-Ereignis "Ramsch-Pflicht": vor dem Ziehen muss eine Ramsch-Karte
      // abgegeben werden, falls vorhanden - wer keine hat, zieht kostenlos.
      if (this.activeModifier?.id === 'ramsch-pflicht') {
        const ramsch = player.hand.find((c) => c.setName === 'Ramsch');
        if (ramsch) {
          player.removeFromHand([ramsch.id]);
          this.discardPile.add(ramsch);
          this._log(`🗑️ ${player.name} opfert eine Ramsch-Karte, um ziehen zu dürfen.`);
        }
      }

      if (this.drawPile.isEmpty) {
        this._enterShowdown();
        return null;
      }
      const card = this.drawPile.draw();
      player.addCards([card]);
      this.hasDrawnThisTurn = true;
      this._log(`${player.name} zieht eine Karte.`);
      if (this.drawPile.isEmpty) this._enterShowdown();
      return card;
    }

    // --- Zugschritt 2+3: Set ausspielen + Bonuskarte ---------------------
    playSet(cardIds) {
      this._assertNoPendingInterrupt();
      if (this.phase === 'playing' && !this.hasDrawnThisTurn) {
        throw new Error('Bitte zuerst eine Karte ziehen.');
      }
      if (this.phase === 'ended') {
        throw new Error('Das Spiel ist bereits beendet.');
      }
      if (this.activeModifier?.id === 'verkaufsstopp') {
        throw new Error('Verkaufsstopp: Aktuell dürfen keine Sets ausgespielt werden.');
      }

      const player = this.currentPlayer;
      if (this.activeModifier?.id === 'nur-fuer-profis' && player.collection.getAllCards().length === 0) {
        throw new Error('Nur für Profis: Du musst zuerst mindestens ein Set gespielt haben.');
      }
      const idSet = new Set(cardIds);
      const cards = player.hand.filter((c) => idSet.has(c.id));
      if (cards.length !== cardIds.length || cards.length === 0) {
        throw new Error('Ungültige Kartenauswahl.');
      }
      const setName = cards[0].setName;
      if (!cards.every((c) => c.setName === setName)) {
        throw new Error('Alle ausgewählten Karten müssen zum selben Set gehören.');
      }
      const existing = player.collection.getGroupSize(setName);
      if (existing + cards.length < 2) {
        throw new Error('Ein Set benötigt mindestens 2 Karten (oder ein bereits begonnenes Set).');
      }

      player.removeFromHand(cardIds);
      player.collection.addCards(cards);
      this._log(`${player.name} spielt ${cards.length} Karte(n) im Set "${setName}" aus.`);

      // Gag-Spruch als Lesestoff für die Mitspieler, während der aktive
      // Spieler dran ist - landet automatisch im Verlauf/Toast (script.js).
      for (const card of cards) {
        if (card.flavorText) this._log(`💬 "${card.flavorText}"`);
      }

      // Mysterio: drawback() feuert einmalig direkt beim Ausspielen (kann
      // Seiteneffekte haben); specialEffect() liefert den Punktebonus erst
      // live in calculateScores(), da er z. B. von der Handkartenzahl bei
      // Spielende abhängen kann (siehe "Verbogene Wünschelrute").
      for (const card of cards) {
        if (card.type === 'mysterio' && typeof card.drawback === 'function') {
          try {
            card.drawback({ game: this, player });
          } catch (err) {
            this._log(`Fehler beim Mysterio-Effekt: ${err.message}`);
          }
        }
      }

      // Ramsch ist spielbar (siehe Collection.computeScore für die flache
      // Wertung), gibt aber bewusst keine Bonuskarte - das bleibt echten
      // Sets vorbehalten, damit Ramsch klar die schwächere Wahl bleibt.
      // Ausnahme: während "Ramsch-Boom" gibt auch Ramsch eine Bonuskarte.
      // Pro Zug gibt es höchstens 1 Bonuskarte, egal wie viele Sets folgen.
      const ramschBoom = this.activeModifier?.id === 'ramsch-boom';
      if (this.phase === 'playing' && (setName !== 'Ramsch' || ramschBoom) && !this.bonusDrawGrantedThisTurn) {
        if (this.drawPile.isEmpty) {
          this._enterShowdown();
        } else {
          const bonus = this.drawPile.draw();
          player.addCards([bonus]);
          this.bonusDrawGrantedThisTurn = true;
          this._log(`${player.name} zieht eine Bonuskarte für das ausgespielte Set.`);
          if (this.drawPile.isEmpty) this._enterShowdown();
        }
      }
    }

    // --- Optionale Zusatzaktion: Grabbelkiste -------------------------------
    // Ein gemeinsamer, verdeckter Stapel in der Tischmitte - der einzige Weg,
    // wie Karten heute den Besitzer wechseln. Rein und Raus sind unabhängige
    // Aktionen, je höchstens einmal pro Zug - wer eine schlechte Karte
    // reinlegt, darf im selben Zug auch eine (andere, unbekannte) herausholen,
    // statt nur altruistisch zu spenden. Kein Zielspieler, keine Absprache
    // möglich - anders als ein 1:1-Tausch lässt sich das nicht zur Teamarbeit
    // zwischen zwei Spielern gegen den Rest missbrauchen.
    _binCapacity() {
      return this.activeModifier?.id === 'grabbelkiste-ausverkauf' ? BIN_CAPACITY_BOOSTED : BIN_CAPACITY;
    }

    putInBin(cardId) {
      this._assertNoPendingInterrupt();
      if (this.phase !== 'playing') {
        throw new Error('Die Grabbelkiste ist im Showdown geschlossen.');
      }
      if (!this.hasDrawnThisTurn) {
        throw new Error('Bitte zuerst eine Karte ziehen.');
      }
      if (this.needsDiscard()) {
        throw new Error('Bitte zuerst das Handkartenlimit einhalten.');
      }
      if (this.binPutUsedThisTurn) {
        throw new Error('In diesem Zug wurde schon etwas in die Grabbelkiste gelegt.');
      }
      if (this.bargainBin.length >= this._binCapacity()) {
        throw new Error('Die Grabbelkiste ist voll - erst muss jemand herausnehmen.');
      }

      const player = this.currentPlayer;
      const [card] = player.removeFromHand([cardId]);
      if (!card) {
        throw new Error('Ungültige Kartenauswahl.');
      }
      this.bargainBin.push(card);
      this.binPutUsedThisTurn = true;
      this._log(`${player.name} legt 1 Karte verdeckt in die Grabbelkiste.`);
    }

    takeFromBin() {
      this._assertNoPendingInterrupt();
      if (this.phase !== 'playing') {
        throw new Error('Die Grabbelkiste ist im Showdown geschlossen.');
      }
      if (!this.hasDrawnThisTurn) {
        throw new Error('Bitte zuerst eine Karte ziehen.');
      }
      if (this.needsDiscard()) {
        throw new Error('Bitte zuerst das Handkartenlimit einhalten.');
      }
      if (this.binTakeUsedThisTurn) {
        throw new Error('In diesem Zug wurde schon aus der Grabbelkiste genommen.');
      }
      if (this.bargainBin.length === 0) {
        throw new Error('Die Grabbelkiste ist leer.');
      }

      const player = this.currentPlayer;
      const index = Math.floor(Math.random() * this.bargainBin.length);
      const [card] = this.bargainBin.splice(index, 1);
      player.addCards([card]);
      this.binTakeUsedThisTurn = true;
      // Bewusst nicht loggen, WELCHE Karte es war - das bleibt auch im
      // gemeinsamen Verlauf verdeckt, sonst wäre "blind" nur ein Wort.
      this._log(`${player.name} greift blind in die Grabbelkiste.`);
    }

    // --- Zugschritt 5: Handkartenlimit -----------------------------------
    needsDiscard() {
      return this.currentPlayer.isOverHandLimit();
    }

    // Handkartenlimit-Überschuss wandert bevorzugt in die Grabbelkiste (bis
    // zu ihrer Kapazität) statt auf den Sperrmüll - eine zweite, unfreiwillige
    // Möglichkeit, schlechte Karten gegen unbekannte einzutauschen, statt sie
    // ins Nichts zu legen. Ist die Kiste voll, geht der Rest auf den Sperrmüll.
    discardCards(cardIds) {
      const player = this.currentPlayer;
      const removed = player.removeFromHand(cardIds);
      let intoBin = 0;
      for (const card of removed) {
        if (this.bargainBin.length < this._binCapacity()) {
          this.bargainBin.push(card);
          intoBin++;
        } else {
          this.discardPile.add(card);
        }
      }
      if (intoBin === removed.length) {
        this._log(`${player.name} legt ${removed.length} Karte(n) in die Grabbelkiste (Handkartenlimit).`);
      } else if (intoBin === 0) {
        this._log(`${player.name} legt ${removed.length} Karte(n) auf den Sperrmüll (Grabbelkiste voll).`);
      } else {
        this._log(`${player.name} legt ${intoBin} Karte(n) in die Grabbelkiste, ${removed.length - intoBin} auf den Sperrmüll (Handkartenlimit).`);
      }
    }

    // --- Zugschritt 6: Zug beenden ----------------------------------------
    endTurn() {
      if (this.phase === 'ended') return;
      this._assertNoPendingInterrupt();
      if (this.phase === 'playing' && !this.hasDrawnThisTurn) {
        throw new Error('Bitte zuerst eine Karte ziehen.');
      }
      if (this.needsDiscard()) {
        throw new Error('Handkartenlimit überschritten – bitte zuerst Karten ablegen.');
      }
      this._advanceTurn();
    }

    // Wechselt zum nächsten Spieler.
    _advanceTurn() {
      const wasLastPlayer = this.currentPlayerIndex === this.players.length - 1;
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      this.hasDrawnThisTurn = false;
      this.bonusDrawGrantedThisTurn = false;
      this.binPutUsedThisTurn = false;
      this.binTakeUsedThisTurn = false;

      if (wasLastPlayer) {
        this.roundNumber++;
        this._recalculateHandLimits();
        this._revealEventCard(); // deckt nur auf, wendet den Effekt noch nicht an
      }

      // Läuft ein Ereignis-Popup, wartet die Showdown-Prüfung, bis es
      // bestätigt wurde (acknowledgePendingEvent) - der Effekt könnte
      // Handkarten verändern, die für die Prüfung relevant sind.
      if (!this.pendingEvent) {
        this._checkShowdownEnd();
      }
    }

    // Ausgleich gegen den Bonuskarten-Schneeball: wer bei Rundenwechsel den
    // niedrigsten Punktestand hat, darf bis zur nächsten Runde 1 Handkarte
    // mehr halten, ohne sie ablegen zu müssen - keine geschenkte Karte,
    // sondern mehr Spielraum, ein Teilset zusammenzuhalten. Bei Gleichstand
    // (z. B. Runde 1, alle bei 0) bekommen alle Betroffenen den Ausgleich.
    _recalculateHandLimits() {
      const scores = this.calculateScores();
      const lowest = Math.min(...scores.map((s) => s.total));
      for (const s of scores) {
        const boosted = s.total === lowest;
        const newLimit = boosted ? HAND_LIMIT + 1 : HAND_LIMIT;
        if (s.player.handLimit !== newLimit) {
          s.player.handLimit = newLimit;
          if (boosted) {
            this._log(`${s.player.name} darf bis zur nächsten Runde ${newLimit} statt ${HAND_LIMIT} Handkarten halten (niedrigster Punktestand).`);
          }
        }
      }
    }

    _revealEventCard() {
      if (!this.eventDeck || this.eventDeck.isEmpty) return;
      const card = this.eventDeck.draw();
      this.revealedEvents.push(card);
      this.pendingEvent = card;
      this._log(`Ereignis aufgedeckt: "${card.title}" – ${card.description}`);
    }

    // Von der UI aufgerufen, sobald das Ereignis-Popup mit "OK" bestätigt wurde.
    acknowledgePendingEvent() {
      if (!this.pendingEvent) {
        throw new Error('Es gibt kein offenes Ereignis.');
      }
      const card = this.pendingEvent;
      // Ein Twist bleibt nur "bis zum nächsten Ereignis" aktiv - unabhängig
      // davon, ob dieses neue Ereignis selbst wieder einen Twist setzt.
      const hadModifier = this.activeModifier;
      this.activeModifier = null;
      try {
        card.effect(this);
      } catch (err) {
        this._log(`Fehler beim Ereigniseffekt: ${err.message}`);
      }
      if (hadModifier && !this.activeModifier) {
        this._log(`${hadModifier.label} ist nicht mehr aktiv.`);
      }
      this.pendingEvent = null;
      this._checkShowdownEnd();
    }

    _checkShowdownEnd() {
      if (this.phase === 'showdown' && !this._anyoneCanPlaySet()) {
        this._endGame();
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
    // Mysterio-Karten zählen über ihr Set "Mysterio" wie gewöhnliche
    // Objektkarten in computeScore() mit, plus ihren eigenen specialEffect-
    // Bonus obendrauf - live berechnet, da er z. B. von der aktuellen
    // Handkartenzahl abhängen kann ("Verbogene Wünschelrute").
    calculateScores() {
      return this.players.map((player) => {
        const { total, breakdown } = player.collection.computeScore();
        const handPoints = player.hand.reduce((sum, c) => sum + (c.points || 0), 0);
        const mysterioCards = player.collection.getGroups().get('Mysterio') || [];
        let mysterioBonus = 0;
        for (const card of mysterioCards) {
          if (typeof card.specialEffect === 'function') {
            try {
              mysterioBonus += card.specialEffect({ game: this, player }) || 0;
            } catch {
              // specialEffect muss reine Berechnung sein - ein Fehler hier
              // fließt einfach mit 0 Bonus für diese Karte in die Wertung ein.
            }
          }
        }
        return {
          player,
          setPoints: total,
          breakdown,
          handPoints,
          mysterioBonus,
          total: total + handPoints + mysterioBonus,
        };
      });
    }

    getWinner() {
      const scores = this.calculateScores();
      const max = Math.max(...scores.map((s) => s.total));
      return scores.filter((s) => s.total === max);
    }
  }

  Object.assign(FlowMarkt, { Player, Game, HAND_LIMIT, BIN_CAPACITY });
})(window);
