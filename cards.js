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
    // setSize = physische Gesamtzahl dieser Karte im Spiel (Anzeige/Badge).
    // setGoal = wie viele davon zum "vollständigen Set" (×2-Bonus) reichen -
    // bewusst kleiner als setSize, damit der Bonus erreichbar bleibt. Fällt
    // auf setSize zurück, wenn nicht gesetzt (z. B. bei Mysterio).
    constructor({ id, name, setName, setSize, setGoal, imagePlaceholder, color, points = 1 }) {
      super(id);
      this.name = name;
      this.setName = setName;
      this.setSize = setSize;
      this.setGoal = setGoal || setSize;
      this.imagePlaceholder = imagePlaceholder;
      this.color = color || '#495057';
      this.points = points;
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
  //
  // WICHTIG (V0.1): specialEffect/drawback sind aktuell nur vorbereitet und
  // werden von rules.js bewusst noch NICHT aufgerufen - effectText zeigt in
  // der UI schon an, was die Karte einmal tun wird. Die Funktionen bleiben
  // stehen, damit das Verdrahten später keine Architekturänderung braucht.
  class MysterioCard extends ObjectCard {
    constructor({ id, name, setName, setSize, imagePlaceholder, specialEffect, drawback, effectText }) {
      super({ id, name, setName, setSize, imagePlaceholder, color: MYSTERIO_COLOR });
      this.rarity = 'rare';
      this.specialEffect = specialEffect;
      this.drawback = drawback;
      this.effectText = effectText;
    }

    get type() {
      return 'mysterio';
    }
  }

  // Ramsch-Karten: der Krempel, der auf jedem Flohmarkt auch dabei ist.
  // Sie gehören keinem echten Set an (setName "Ramsch") und zählen einzeln
  // 0 Punkte. Ab zwei Karten lassen sie sich wie ein normales Set ausspielen,
  // geben dabei aber keine Bonuskarte (siehe rules.js) und werden flach mit
  // 1 Punkt pro Karte gewertet (siehe Collection.computeScore) - spielbar,
  // aber klar schwächer als ein echtes Set.
  class RamschCard extends ObjectCard {
    constructor({ id, name, imagePlaceholder, totalCount }) {
      super({ id, name, setName: 'Ramsch', setSize: totalCount, imagePlaceholder, color: RAMSCH_COLOR, points: 0 });
    }

    get type() {
      return 'ramsch';
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
    // vollständiges Set (ab setGoal erreichten Karten) = (Anzahl × Setgröße) × 2.
    // setGoal ist absichtlich kleiner als die physische Setgröße, damit der
    // ×2-Bonus in einer normalen Partie auch wirklich erreichbar ist - der
    // Multiplikator bleibt trotzdem an der vollen Setgröße, das frühere
    // Erreichen wird also spürbar belohnt. Ramsch ist die Ausnahme: flach
    // 1 Punkt pro ausgespielter Karte, ohne Multiplikator - spielbar und
    // nicht mehr toter Ballast, aber klar schwächer als ein echtes Set (das
    // zusätzlich noch eine Bonuskarte einbringt).
    computeScore() {
      let total = 0;
      const breakdown = [];
      for (const [setName, cards] of this.groups) {
        const setSize = cards[0].setSize;
        const goal = cards[0].setGoal || setSize;
        const count = cards.length;
        let points;
        if (setName === 'Ramsch') {
          points = count;
        } else if (count <= 1) {
          points = count * (cards[0]?.points || 1);
        } else if (count >= goal) {
          points = count * setSize * 2;
        } else {
          points = count * setSize;
        }
        breakdown.push({ setName, count, setSize, goal, isComplete: count >= goal, points });
        total += points;
      }
      return { total, breakdown };
    }
  }

  // ---------------------------------------------------------------------
  // Spielmaterial (Platzhalterdaten)
  // ---------------------------------------------------------------------

  const MYSTERIO_COLOR = '#e8b100';
  const RAMSCH_COLOR = '#6b6255';

  // Jede Kategorie steht für einen Flohmarkt-Tisch: ein Emoji, eine Akzentfarbe
  // und genau `items.length` (== size) konkrete Fundstücke statt Platzhaltertexten.
  // Von den 50 "Objekt"-Slots sind nur 35 echte, setfähige Fundstücke (70%) -
  // die restlichen 15 (30%) sind separate Ramsch-Karten (siehe unten), weil auf
  // einem echten Flohmarkt eben nicht alles etwas wert ist.
  // goal = ab wie vielen Karten der ×2-Bonus greift (siehe Collection.computeScore) -
  // bewusst rund die Hälfte von size, damit "vollständig" in einer normalen
  // Partie überhaupt erreichbar ist.
  const SET_DEFINITIONS = [
    {
      name: 'Bücher & Platten',
      size: 6,
      goal: 3,
      emoji: '📚',
      color: '#8a5a2f',
      items: [
        'Zerfledderter Liebesroman',
        'Kochbuch von 1987',
        'Vinyl: Beste Schlager Vol. 3',
        'Lexikon, Band 7 von 12',
        'Reiseführer Mallorca \'98',
        'Angefangenes Kreuzworträtselheft',
      ],
    },
    {
      name: 'Spielzeug & Nostalgie',
      size: 7,
      goal: 4,
      emoji: '🧸',
      color: '#e8590c',
      items: [
        'Einarmiger Teddybär',
        'Zauberwürfel (ungelöst)',
        'Blechroboter mit Rost',
        'Puppe mit Augenklappe',
        'Kaputtes Kaleidoskop',
        'Holzpferd auf Rädern',
        'Handheld-Konsole ohne Akku',
      ],
    },
    {
      name: 'Küche & Haushalt',
      size: 8,
      goal: 4,
      emoji: '🍳',
      color: '#2f9e44',
      items: [
        'Fondue-Set ohne Stecker',
        'Eieruhr im Hühnerformat',
        'Emaille-Kanne mit Beule',
        'Handmixer, Baujahr \'82',
        'Käseglocke aus Glas',
        'Suppenteller-Set (3 von 6)',
        'Toaster mit Eigenleben',
        'Omas altes Nudelholz',
      ],
    },
    {
      name: 'Deko & Kuriositäten',
      size: 7,
      goal: 4,
      emoji: '🏺',
      color: '#9c36b5',
      items: [
        'Grinsender Gartenzwerg',
        'Lavalampe (halb kaputt)',
        'Getrocknetes Blumenbouquet',
        'Schneekugel ohne Schnee',
        'Muschelsammlung im Glas',
        'Sonnenuntergangs-Bild',
        'Schiefer Kerzenständer',
      ],
    },
    {
      name: 'Kleidung & Accessoires',
      size: 7,
      goal: 4,
      emoji: '👒',
      color: '#1971c2',
      items: [
        'Blumenhut mit Mottenloch',
        'Krawatte mit Ananas-Muster',
        'Ausgeleierter Ledergürtel',
        'Einzelner Handschuh',
        'Second-Hand-Sakko',
        'Poncho aus den 70ern',
        'Sonnenbrille mit Sprung',
      ],
    },
  ]; // Summe = 35 echte Objektkarten (+ 15 Ramsch-Karten = 50)

  // 30%-Ramsch-Anteil: eigenständige, wertlose Fundstücke ohne Set-Zugehörigkeit.
  const RAMSCH_ITEMS = [
    'Einzelne Socke',
    'Rostiger Nagel',
    'Leere Streichholzschachtel',
    'Verblasstes Preisschild',
    'Kabel ohne Stecker',
    'Zerrissene Plastiktüte',
    'Angebrochene Kerze',
    'Verbogene Büroklammer',
    'Fleckiger Bierdeckel',
    'Leere Batterie',
    'Lose Schraube',
    'Unlesbare Werbebroschüre',
    'Kaputter Kugelschreiber',
    'Verstaubtes Preisschild-Etikett',
    'Angerissene Serviette',
  ];

  function createRamschCards() {
    return RAMSCH_ITEMS.map((itemName, index) => {
      const idNum = String(index + 1).padStart(2, '0');
      return new RamschCard({
        id: `ram-${idNum}`,
        name: itemName,
        imagePlaceholder: '🗑️',
        totalCount: RAMSCH_ITEMS.length,
      });
    });
  }

  function createObjectCards() {
    const cards = [];
    let counter = 1;
    for (const set of SET_DEFINITIONS) {
      set.items.forEach((itemName) => {
        const idNum = String(counter).padStart(2, '0');
        cards.push(
          new ObjectCard({
            id: `obj-${idNum}`,
            name: itemName,
            setName: set.name,
            setSize: set.size,
            setGoal: set.goal,
            imagePlaceholder: set.emoji,
            color: set.color,
          })
        );
        counter++;
      });
    }
    return cards;
  }

  // 5 Mysterio-Karten bilden zugleich ihr eigenes seltenes Set ("Mysterio") -
  // mysteriöse Flohmarkt-Legenden, denen man einen Spezialeffekt nachsagt.
  // effectText beschreibt diesen Effekt bereits als Platzhalter in der UI;
  // specialEffect/drawback sind vorbereitet, aber laut Vorgabe für V0.1
  // absichtlich noch nicht verdrahtet (siehe Kommentar an MysterioCard).
  function mysterioEffectDefinitions() {
    return [
      {
        itemName: 'Spiegel mit Eigenwillen',
        effectText: '✨ Effekt (geplant): +3 Bonuspunkte am Spielende.',
        specialEffect: () => 3,
        drawback: ({ game, player }) => game._log(`${player.name} zahlt den Preis des Spiegels mit Eigenwillen (kein Effekt in V0.1).`),
      },
      {
        itemName: 'Wackelige Kristallkugel',
        effectText: '✨ Effekt (geplant): +2 Bonuspunkte, kostet aber eine zufällige Handkarte.',
        specialEffect: () => 2,
        drawback: ({ game, player }) => {
          const [card] = player.removeFromHand([player.hand[0]?.id].filter(Boolean));
          if (card) game.discardPile.add(card);
          game._log(`${player.name} legt durch die wacklige Kristallkugel eine Handkarte ab.`);
        },
      },
      {
        itemName: 'Anhalter-Amulett',
        effectText: '✨ Effekt (geplant): +4 Bonuspunkte, ganz ohne Haken.',
        specialEffect: () => 4,
        drawback: () => {},
      },
      {
        itemName: 'Verbogene Wünschelrute',
        effectText: '✨ Effekt (geplant): Bonus richtet sich nach der Anzahl deiner Handkarten.',
        specialEffect: ({ player }) => player.hand.length,
        drawback: ({ game, player }) => game._log(`${player.name} riskiert mit der verbogenen Wünschelrute einen unsicheren Bonus.`),
      },
      {
        itemName: 'Truhe mit Eigenleben',
        effectText: '✨ Effekt (geplant): +5 Bonuspunkte, entfernt aber eine Karte vom Nachziehstapel.',
        specialEffect: () => 5,
        drawback: ({ game }) => {
          const extra = game.drawPile.draw();
          if (extra) game.discardPile.add(extra);
          game._log('Die Truhe mit Eigenleben entfernt eine Karte vom Nachziehstapel.');
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
        name: def.itemName,
        setName: 'Mysterio',
        setSize,
        imagePlaceholder: '❓',
        specialEffect: def.specialEffect,
        drawback: def.drawback,
        effectText: def.effectText,
      });
    });
  }

  // 10 Ereigniskarten, 5 Effekt-Typen im Wechsel.
  function eventEffectTemplates() {
    return [
      {
        title: 'Bonuszug',
        description: '📦 Lieferengpass behoben! Der aktive Spieler zieht sofort eine zusätzliche Karte.',
        effect: (game) => {
          const player = game.currentPlayer;
          const card = game.drawPile.draw();
          if (card) {
            player.addCards([card]);
            game._log(`📦 Bonuszug: ${player.name} zieht eine zusätzliche Karte.`);
          } else {
            game._log('📦 Bonuszug: Nachziehstapel ist leer, kein Effekt.');
          }
        },
      },
      {
        title: 'Kollektive Ablage',
        description: '🧹 Inventur! Jeder Spieler legt seine älteste Handkarte auf den Friedhof.',
        effect: (game) => {
          for (const player of game.players) {
            const oldest = player.hand[0];
            if (oldest) {
              player.removeFromHand([oldest.id]);
              game.discardPile.add(oldest);
            }
          }
          game._log('🧹 Kollektive Ablage: alle Spieler legen ihre älteste Handkarte ab.');
        },
      },
      {
        title: 'Marktschwankung',
        description: '📉 Die Preise crashen! Die obersten zwei Karten des Nachziehstapels wandern auf den Friedhof.',
        effect: (game) => {
          const removed = game.drawPile.drawMany(2);
          game.discardPile.addMany(removed);
          game._log(`📉 Marktschwankung: ${removed.length} Karte(n) vom Nachziehstapel abgelegt.`);
        },
      },
      {
        title: 'Zufallsglück',
        description: '🍀 Ein Schnäppchen im Ausschuss! Der aktive Spieler nimmt die oberste Karte des Friedhofs auf die Hand.',
        effect: (game) => {
          const player = game.currentPlayer;
          const card = game.discardPile.cards.pop();
          if (card) {
            player.addCards([card]);
            game._log(`🍀 Zufallsglück: ${player.name} holt eine Karte aus dem Friedhof zurück.`);
          } else {
            game._log('🍀 Zufallsglück: Friedhof ist leer, kein Effekt.');
          }
        },
      },
      {
        title: 'Ruhiger Handel',
        description: '🤝 Ruhiger Tag auf dem Markt: Jeder Spieler mit weniger als 3 Handkarten zieht auf.',
        effect: (game) => {
          for (const player of game.players) {
            while (player.hand.length < 3 && !game.drawPile.isEmpty) {
              player.addCards([game.drawPile.draw()]);
            }
          }
          if (game.drawPile.isEmpty) game._enterShowdown();
          game._log('🤝 Ruhiger Handel: alle Spieler mit weniger als 3 Handkarten ziehen auf.');
        },
      },
      // --- Twist-Ereignisse ---------------------------------------------
      // Diese vier setzen game.activeModifier statt (nur) sofort zu wirken:
      // die Regeländerung bleibt aktiv, bis das nächste Ereignis aufgedeckt
      // wird (siehe acknowledgePendingEvent in rules.js, das activeModifier
      // vor jedem neuen Effekt zurücksetzt). So dreht jede Runde spürbar an
      // den Regeln, nicht nur am Kartenbestand.
      {
        title: 'Ramsch-Pflicht',
        description: '🗑️ Standkontrolle! Bis zum nächsten Ereignis muss jeder, der zieht, zuerst eine Ramsch-Karte abgeben (falls vorhanden).',
        effect: (game) => {
          game.activeModifier = {
            id: 'ramsch-pflicht',
            label: 'Ramsch-Pflicht',
            description: 'Vor jedem Ziehen muss eine Ramsch-Karte abgegeben werden (falls vorhanden).',
          };
          game._log('🗑️ Ramsch-Pflicht ist aktiv, bis das nächste Ereignis aufgedeckt wird.');
        },
      },
      {
        title: 'Nur für Profis',
        description: '🎓 Reserviert für Stammkunden! Bis zum nächsten Ereignis dürfen nur Spieler Sets ausspielen, die schon mindestens ein Set gespielt haben.',
        effect: (game) => {
          game.activeModifier = {
            id: 'nur-fuer-profis',
            label: 'Nur für Profis',
            description: 'Sets ausspielen geht nur, wer schon mindestens ein Set gespielt hat.',
          };
          game._log('🎓 Nur für Profis ist aktiv, bis das nächste Ereignis aufgedeckt wird.');
        },
      },
      {
        title: 'Ramsch-Boom',
        description: '📈 Vintage-Trend! Bis zum nächsten Ereignis gibt auch ein ausgespieltes Ramsch-Set eine Bonuskarte.',
        effect: (game) => {
          game.activeModifier = {
            id: 'ramsch-boom',
            label: 'Ramsch-Boom',
            description: 'Ramsch-Sets geben vorübergehend auch eine Bonuskarte.',
          };
          game._log('📈 Ramsch-Boom ist aktiv, bis das nächste Ereignis aufgedeckt wird.');
        },
      },
      {
        title: 'Verkaufsstopp',
        description: '🚫 Der Marktaufseher macht Standkontrolle! Bis zum nächsten Ereignis dürfen keine Sets ausgespielt werden - nur sammeln, trödeln, tauschen.',
        effect: (game) => {
          game.activeModifier = {
            id: 'verkaufsstopp',
            label: 'Verkaufsstopp',
            description: 'Sets ausspielen ist verboten, bis das nächste Ereignis kommt.',
          };
          game._log('🚫 Verkaufsstopp ist aktiv, bis das nächste Ereignis aufgedeckt wird.');
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
    RamschCard,
    Deck,
    DiscardPile,
    Collection,
    SET_DEFINITIONS,
    createObjectCards,
    createMysterioCards,
    createRamschCards,
    createEventCards,
  });
})(window);
