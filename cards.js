// cards.js — Kartendaten und Kartenmodelle für Flow-Markt V0.1
// Enthält ausschließlich Datenmodelle (Card-Klassen, Deck, DiscardPile, Collection)
// und Fabrikfunktionen für das Spielmaterial. Keine UI-, keine Spielablauflogik.

(function (global) {
  'use strict';

  const FlowMarkt = global.FlowMarkt || (global.FlowMarkt = {});

  // ---------------------------------------------------------------------
  // Basis-Kartenklassen
  // ---------------------------------------------------------------------

  class Card {
    constructor(id) {
      this.id = id;
    }
  }

  class ObjectCard extends Card {
    constructor({ id, name, setName, setSize, imagePlaceholder }) {
      super(id);
      this.name = name;
      this.setName = setName;
      this.setSize = setSize;
      this.imagePlaceholder = imagePlaceholder;
      this.points = 1;
    }

    get type() {
      return 'object';
    }
  }

  class EventCard extends Card {
    constructor({ id, title, description, effect }) {
      super(id);
      this.title = title;
      this.description = description;
      // effect(game): führt einen einmaligen, sofortigen Effekt auf den Spielzustand aus.
      this.effect = effect;
    }

    get type() {
      return 'event';
    }
  }

  // Mysterio-Karten sind normale Objektkarten (nehmen an Set-Wertung teil),
  // besitzen zusätzlich einen dauerhaften Bonus (specialEffect) und einen
  // einmaligen Nachteil (drawback), der beim Ausspielen ausgelöst wird.
  //
  // Vertrag für Effekt-Funktionen (wichtig für Erweiterbarkeit):
  //  - specialEffect({ game, player }) muss eine reine Punktzahl zurückgeben
  //    (keine Seiteneffekte!). Wird bei jeder Wertungsberechnung aufgerufen,
  //    auch wiederholt für Live-Anzeigen im Debug-Modus.
  //  - drawback({ game, player }) darf Seiteneffekte haben und wird genau
  //    einmal aufgerufen, sobald die Karte ausgespielt wird.
  class MysterioCard extends ObjectCard {
    constructor({ id, name, setName, setSize, imagePlaceholder, specialEffect, drawback }) {
      super({ id, name, setName, setSize, imagePlaceholder });
      this.rarity = 'rare';
      this.specialEffect = specialEffect;
      this.drawback = drawback;
    }

    get type() {
      return 'mysterio';
    }
  }

  // ---------------------------------------------------------------------
  // Stapel-Klassen
  // ---------------------------------------------------------------------

  class Deck {
    constructor(cards = []) {
      this.cards = cards.slice();
    }

    shuffle() {
      for (let i = this.cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
      }
      return this;
    }

    draw() {
      return this.cards.length ? this.cards.pop() : null;
    }

    drawMany(count) {
      const drawn = [];
      for (let i = 0; i < count; i++) {
        const card = this.draw();
        if (!card) break;
        drawn.push(card);
      }
      return drawn;
    }

    addToBottom(cards) {
      this.cards.unshift(...cards);
    }

    get size() {
      return this.cards.length;
    }

    get isEmpty() {
      return this.cards.length === 0;
    }
  }

  // Ablagestapel ("Friedhof"). Karten liegen verdeckt und nehmen an keiner
  // weiteren Wertung mehr teil.
  class DiscardPile {
    constructor() {
      this.cards = [];
    }

    add(card) {
      this.cards.push(card);
    }

    addMany(cards) {
      this.cards.push(...cards);
    }

    get size() {
      return this.cards.length;
    }
  }

  // Sammlung der dauerhaft offen ausgespielten Sets eines Spielers,
  // gruppiert nach setName.
  class Collection {
    constructor() {
      this.groups = new Map();
    }

    addCards(cards) {
      if (!cards.length) return;
      const setName = cards[0].setName;
      if (!this.groups.has(setName)) this.groups.set(setName, []);
      this.groups.get(setName).push(...cards);
    }

    getGroupSize(setName) {
      return this.groups.get(setName)?.length || 0;
    }

    getGroups() {
      return this.groups;
    }

    getAllCards() {
      return [...this.groups.values()].flat();
    }

    // Punktewertung: Einzelkarte = 1 Punkt, teilweises Set = Anzahl × Setgröße,
    // vollständiges Set = (Anzahl × Setgröße) × 2.
    computeScore() {
      let total = 0;
      const breakdown = [];
      for (const [setName, cards] of this.groups) {
        const setSize = cards[0].setSize;
        const count = cards.length;
        let points;
        if (count <= 1) {
          points = count * (cards[0]?.points || 1);
        } else if (count >= setSize) {
          points = count * setSize * 2;
        } else {
          points = count * setSize;
        }
        breakdown.push({ setName, count, setSize, isComplete: count >= setSize, points });
        total += points;
      }
      return { total, breakdown };
    }
  }

  // ---------------------------------------------------------------------
  // Spielmaterial (Platzhalterdaten)
  // ---------------------------------------------------------------------

  const SET_DEFINITIONS = [
    { name: 'Set A', size: 8, emoji: '🟥' },
    { name: 'Set B', size: 10, emoji: '🟦' },
    { name: 'Set C', size: 12, emoji: '🟩' },
    { name: 'Set D', size: 10, emoji: '🟨' },
    { name: 'Set E', size: 10, emoji: '🟪' },
  ]; // Summe = 50 Objektkarten

  function createObjectCards() {
    const cards = [];
    let counter = 1;
    for (const set of SET_DEFINITIONS) {
      for (let i = 0; i < set.size; i++) {
        const idNum = String(counter).padStart(2, '0');
        cards.push(
          new ObjectCard({
            id: `obj-${idNum}`,
            name: `Karte ${idNum}`,
            setName: set.name,
            setSize: set.size,
            imagePlaceholder: set.emoji,
          })
        );
        counter++;
      }
    }
    return cards;
  }

  // 5 Mysterio-Karten bilden zugleich ihr eigenes seltenes Set ("Mysterio").
  function mysterioEffectDefinitions() {
    return [
      {
        label: 'Marktgespür',
        specialEffect: () => 3,
        drawback: ({ game, player }) => game._log(`${player.name} zahlt den Preis des Marktgespürs (kein sofortiger Effekt in V0.1).`),
      },
      {
        label: 'Glückspilz',
        specialEffect: () => 2,
        drawback: ({ game, player }) => {
          const [card] = player.removeFromHand([player.hand[0]?.id].filter(Boolean));
          if (card) game.discardPile.add(card);
          game._log(`${player.name} legt durch den Glückspilz-Nachteil eine Handkarte ab.`);
        },
      },
      {
        label: 'Trittbrettfahrer',
        specialEffect: () => 4,
        drawback: () => {},
      },
      {
        label: 'Schnäppchenjäger',
        specialEffect: ({ player }) => player.hand.length,
        drawback: ({ game, player }) => game._log(`${player.name} riskiert mit dem Schnäppchenjäger einen unsicheren Bonus.`),
      },
      {
        label: 'Flaschenhals',
        specialEffect: () => 5,
        drawback: ({ game }) => {
          const extra = game.drawPile.draw();
          if (extra) game.discardPile.add(extra);
          game._log('Der Flaschenhals-Effekt entfernt eine Karte vom Nachziehstapel.');
        },
      },
    ];
  }

  function createMysterioCards() {
    const setSize = 5;
    const definitions = mysterioEffectDefinitions();
    return definitions.map((def, index) => {
      const idNum = String(index + 1).padStart(2, '0');
      return new MysterioCard({
        id: `mys-${idNum}`,
        name: `Mysterio ${idNum} (${def.label})`,
        setName: 'Mysterio',
        setSize,
        imagePlaceholder: '❓',
        specialEffect: def.specialEffect,
        drawback: def.drawback,
      });
    });
  }

  // 10 Ereigniskarten, 5 Effekt-Typen im Wechsel.
  function eventEffectTemplates() {
    return [
      {
        title: 'Bonuszug',
        description: 'Der aktive Spieler zieht sofort eine zusätzliche Karte.',
        effect: (game) => {
          const player = game.currentPlayer;
          const card = game.drawPile.draw();
          if (card) {
            player.addCards([card]);
            game._log(`Bonuszug: ${player.name} zieht eine zusätzliche Karte.`);
          } else {
            game._log('Bonuszug: Nachziehstapel ist leer, kein Effekt.');
          }
        },
      },
      {
        title: 'Kollektive Ablage',
        description: 'Jeder Spieler legt seine älteste Handkarte auf den Friedhof.',
        effect: (game) => {
          for (const player of game.players) {
            const oldest = player.hand[0];
            if (oldest) {
              player.removeFromHand([oldest.id]);
              game.discardPile.add(oldest);
            }
          }
          game._log('Kollektive Ablage: alle Spieler legen ihre älteste Handkarte ab.');
        },
      },
      {
        title: 'Marktschwankung',
        description: 'Die obersten zwei Karten des Nachziehstapels wandern auf den Friedhof.',
        effect: (game) => {
          const removed = game.drawPile.drawMany(2);
          game.discardPile.addMany(removed);
          game._log(`Marktschwankung: ${removed.length} Karte(n) vom Nachziehstapel abgelegt.`);
        },
      },
      {
        title: 'Zufallsglück',
        description: 'Der aktive Spieler nimmt die oberste Karte des Friedhofs auf die Hand.',
        effect: (game) => {
          const player = game.currentPlayer;
          const card = game.discardPile.cards.pop();
          if (card) {
            player.addCards([card]);
            game._log(`Zufallsglück: ${player.name} holt eine Karte aus dem Friedhof zurück.`);
          } else {
            game._log('Zufallsglück: Friedhof ist leer, kein Effekt.');
          }
        },
      },
      {
        title: 'Ruhige Runde',
        description: 'Nichts passiert. Der Markt macht heute Pause.',
        effect: (game) => {
          game._log('Ruhige Runde: kein Effekt.');
        },
      },
    ];
  }

  function createEventCards() {
    const templates = eventEffectTemplates();
    const cards = [];
    for (let i = 0; i < 10; i++) {
      const template = templates[i % templates.length];
      const idNum = String(i + 1).padStart(2, '0');
      cards.push(
        new EventCard({
          id: `evt-${idNum}`,
          title: `Ereignis ${idNum}: ${template.title}`,
          description: template.description,
          effect: template.effect,
        })
      );
    }
    return cards;
  }

  Object.assign(FlowMarkt, {
    Card,
    ObjectCard,
    EventCard,
    MysterioCard,
    Deck,
    DiscardPile,
    Collection,
    SET_DEFINITIONS,
    createObjectCards,
    createMysterioCards,
    createEventCards,
  });
})(window);
