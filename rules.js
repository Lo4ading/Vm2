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
    SET_DEFINITIONS,
  } = FlowMarkt;

  const HAND_LIMIT = 3;
  const SECRET_GOAL_BONUS = 15;
  const SET_GOALS = Object.fromEntries(SET_DEFINITIONS.map((s) => [s.name, s.goal]));

  class Player {
    constructor(id, name) {
      this.id = id;
      this.name = name;
      this.hand = [];
      this.collection = new Collection();
      this.handLimit = HAND_LIMIT;
      // Privates Sammelziel ("Kundenwunsch"), von Game.setup() zugewiesen -
      // nur der jeweilige Spieler bekommt es während der Partie angezeigt.
      this.secretGoal = null;
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
      // { fromPlayerIndex, offeredCardIds, toPlayerIndex } while ein Tausch auf
      // eine Reaktion wartet; blockiert währenddessen alle anderen Zugaktionen.
      this.pendingTrade = null;
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
      this.pendingTrade = null;
      this.pendingEvent = null;
      this.activeModifier = null;
      this.log = [];

      // Kundenwunsch: jeder Spieler bekommt eine zufällige, private
      // Zielkategorie (per Deck-Shuffle für dieselbe geprüfte Zufallslogik
      // wie beim Kartenmischen). Bei mehr Spielern als Kategorien wiederholt
      // sich die Liste einfach.
      const shuffledGoals = new Deck(SET_DEFINITIONS.map((s) => s.name)).shuffle().cards;
      this.players.forEach((player, i) => {
        player.hand = [];
        player.collection = new Collection();
        player.secretGoal = shuffledGoals[i % shuffledGoals.length];
        player.addCards(this.drawPile.drawMany(2));
      });

      this.phase = 'playing';
      this._log('Spiel gestartet.');
    }

    get currentPlayer() {
      return this.players[this.currentPlayerIndex];
    }

    // Ein noch nicht bestätigtes Ereignis pausiert immer den ganzen Zug (das
    // Popup ist global). Ein offener Tausch pausiert nur, wenn der aktuelle
    // Spieler auch der Zielspieler ist - alle anderen spielen normal weiter,
    // bis der Tausch bei ihrem eigenen Zug ansteht (siehe proposeTrade).
    _assertNoPendingInterrupt() {
      if (this.pendingEvent) {
        throw new Error('Bitte zuerst das Ereignis bestätigen.');
      }
      if (this.pendingTrade && this.pendingTrade.toPlayerIndex === this.currentPlayerIndex) {
        throw new Error('Bitte zuerst den offenen Tausch klären.');
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

      // Mysterio-Karten haben schon einen (Platzhalter-)Effekttext in der UI,
      // ihre specialEffect/drawback-Funktionen werden für V0.1 aber bewusst
      // noch nicht ausgelöst - das Verdrahten folgt in einer späteren Version.

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

    // --- Optionale Zusatzaktion: Trödeln -----------------------------------
    // Legt genau 2 Handkarten (beliebiger Art, auch Ramsch) auf den Friedhof
    // und zieht dafür 1 neue Karte - gibt Spielern mit einer wertlosen Hand
    // immer eine sinnvolle Handlung, statt nur zu ziehen und wieder abzulegen.
    // Wie ein Set zählt das als Zugaktion und ist im Showdown nicht möglich
    // (dort wird grundsätzlich nicht mehr gezogen).
    declutter(cardIds) {
      this._assertNoPendingInterrupt();
      if (this.phase !== 'playing') {
        throw new Error('Trödeln ist im Showdown nicht mehr möglich, es wird nicht mehr gezogen.');
      }
      if (!this.hasDrawnThisTurn) {
        throw new Error('Bitte zuerst eine Karte ziehen.');
      }
      if (cardIds.length !== 2) {
        throw new Error('Bitte genau 2 Karten für den Trödel auswählen.');
      }

      const player = this.currentPlayer;
      const idSet = new Set(cardIds);
      const cards = player.hand.filter((c) => idSet.has(c.id));
      if (cards.length !== 2) {
        throw new Error('Ungültige Kartenauswahl.');
      }

      player.removeFromHand(cardIds);
      this.discardPile.addMany(cards);
      this._log(`${player.name} trödelt 2 Karte(n) gegen 1 neue.`);

      if (this.drawPile.isEmpty) {
        this._enterShowdown();
        return;
      }
      const card = this.drawPile.draw();
      player.addCards([card]);
      if (this.drawPile.isEmpty) this._enterShowdown();
    }

    // --- Zugschritt 4: Tausch anbieten -------------------------------------
    // Verdeckter Tausch: Der Zielspieler sieht die angebotenen Karten nicht,
    // bevor er reagiert - er kann nur die Anzahl kennen. Damit ist ein Tausch
    // reines Glücksspiel und Ramsch-Karten lassen sich unbemerkt loswerden.
    //
    // Ein Angebot ist die einzige Aktion des Zugs: es beendet den Zug sofort
    // (ein Spieler tauscht also höchstens einmal pro Zug an). Die angebotenen
    // Karten bleiben bis zur Reaktion in der Hand des Anbietenden - "gesperrt"
    // sind sie nicht, aber niemand kann in der Zwischenzeit an den Tausch
    // heran, weil nur der Zielspieler reagieren darf (siehe declineTrade/
    // acceptTradeWithCounter) und der erst wieder an der Reihe sein muss.
    // Andere Spieler spielen bis dahin ganz normal weiter.
    proposeTrade(offeredCardIds, toPlayerIndex) {
      this._assertNoPendingInterrupt();
      if (this.pendingTrade) {
        throw new Error('Es gibt bereits einen offenen Tausch.');
      }
      if (this.phase === 'ended') {
        throw new Error('Das Spiel ist bereits beendet.');
      }
      if (this.phase === 'playing' && !this.hasDrawnThisTurn) {
        throw new Error('Bitte zuerst eine Karte ziehen.');
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
      this._log(
        `${fromPlayer.name} bietet ${toPlayer.name} ${cards.length} Karte(n) verdeckt zum Tausch an und beendet damit seinen Zug. ${toPlayer.name} entscheidet, sobald er/sie an der Reihe ist.`
      );
      this._advanceTurn();
    }

    declineTrade() {
      if (!this.pendingTrade) {
        throw new Error('Es gibt keinen offenen Tausch.');
      }
      if (this.pendingTrade.toPlayerIndex !== this.currentPlayerIndex) {
        throw new Error('Nur der Zielspieler kann auf diesen Tausch reagieren.');
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
      if (this.pendingTrade.toPlayerIndex !== this.currentPlayerIndex) {
        throw new Error('Nur der Zielspieler kann auf diesen Tausch reagieren.');
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
      this._assertNoPendingInterrupt();
      if (this.phase === 'playing' && !this.hasDrawnThisTurn) {
        throw new Error('Bitte zuerst eine Karte ziehen.');
      }
      if (this.needsDiscard()) {
        throw new Error('Handkartenlimit überschritten – bitte zuerst Karten ablegen.');
      }
      this._advanceTurn();
    }

    // Wechselt zum nächsten Spieler - von endTurn() und von proposeTrade()
    // aufgerufen (ein Tauschangebot beendet den Zug automatisch).
    _advanceTurn() {
      const wasLastPlayer = this.currentPlayerIndex === this.players.length - 1;
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      this.hasDrawnThisTurn = false;
      this.bonusDrawGrantedThisTurn = false;

      if (wasLastPlayer) {
        this.roundNumber++;
        this._grantCatchUpBonus();
        this._revealEventCard(); // deckt nur auf, wendet den Effekt noch nicht an
      }

      // Läuft ein Ereignis-Popup, wartet die Showdown-Prüfung, bis es
      // bestätigt wurde (acknowledgePendingEvent) - der Effekt könnte
      // Handkarten verändern, die für die Prüfung relevant sind.
      if (!this.pendingEvent) {
        this._checkShowdownEnd();
      }
    }

    // Nachzügler-Bonus: wer bei Rundenwechsel den niedrigsten Punktestand hat,
    // zieht 1 Karte extra (still, ohne Popup) - dämpft den Bonuskarten-
    // Schneeball etwas, indem der Rückstand nicht nur größer werden kann.
    // Bei einem Gleichstand (z. B. Runde 1, alle bei 0) bekommen alle
    // Betroffenen die Karte, was sich gegenseitig neutralisiert.
    _grantCatchUpBonus() {
      if (this.phase !== 'playing' || this.drawPile.isEmpty) return;
      const scores = this.calculateScores();
      const lowest = Math.min(...scores.map((s) => s.total));
      const trailingPlayers = scores.filter((s) => s.total === lowest).map((s) => s.player);
      for (const player of trailingPlayers) {
        if (this.drawPile.isEmpty) {
          this._enterShowdown();
          break;
        }
        const card = this.drawPile.draw();
        player.addCards([card]);
        this._log(`🐢 Nachzügler-Bonus: ${player.name} zieht 1 Karte extra (niedrigster Punktestand).`);
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
    // Mysterio-Karten zählen hier wie normale Objektkarten über ihr Set
    // "Mysterio" mit - ihr specialEffect-Bonus ist für V0.1 bewusst noch
    // nicht verdrahtet (siehe MysterioCard-Kommentar in cards.js).
    calculateScores() {
      return this.players.map((player) => {
        const { total, breakdown } = player.collection.computeScore();
        const handPoints = player.hand.reduce((sum, c) => sum + (c.points || 0), 0);
        const goal = SET_GOALS[player.secretGoal];
        const secretGoalMet = Boolean(goal) && player.collection.getGroupSize(player.secretGoal) >= goal;
        const secretGoalBonus = secretGoalMet ? SECRET_GOAL_BONUS : 0;
        return {
          player,
          setPoints: total,
          breakdown,
          handPoints,
          secretGoalMet,
          secretGoalBonus,
          total: total + handPoints + secretGoalBonus,
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
