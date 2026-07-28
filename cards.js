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
    // flavorText = kurzer Gag-Spruch, wird beim Ausspielen als Log-Toast
    // gezeigt - Lesestoff für die wartenden Mitspieler (siehe rules.js playSet).
    constructor({ id, name, setName, setSize, setGoal, imagePlaceholder, color, points = 1, flavorText = '' }) {
      super(id);
      this.name = name;
      this.setName = setName;
      this.setSize = setSize;
      this.setGoal = setGoal || setSize;
      this.imagePlaceholder = imagePlaceholder;
      this.color = color || '#495057';
      this.points = points;
      this.flavorText = flavorText;
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
    constructor({ id, name, imagePlaceholder, totalCount, flavorText }) {
      super({ id, name, setName: 'Ramsch', setSize: totalCount, imagePlaceholder, color: RAMSCH_COLOR, points: 0, flavorText });
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
        { name: 'Zerfledderter Liebesroman', flavor: 'Die letzten drei Seiten fehlen - das Happy End bleibt Verhandlungssache.' },
        { name: 'Kochbuch von 1987', flavor: 'Jedes Rezept beginnt mit "Man nehme 250g Butter".' },
        { name: 'Vinyl: Beste Schlager Vol. 3', flavor: 'Vol. 1 und 2 sind für immer verschollen.' },
        { name: 'Lexikon, Band 7 von 12', flavor: 'Zufällig genau der Band mit dem Stichwort "Flohmarkt".' },
        { name: 'Reiseführer Mallorca \'98', flavor: 'Der Ballermann hat sich seitdem kaum verändert.' },
        { name: 'Angefangenes Kreuzworträtselheft', flavor: '7 Buchstaben, "wertloser Kram". Lösung: FLOHMARKT.' },
      ],
    },
    {
      name: 'Spielzeug & Nostalgie',
      size: 7,
      goal: 4,
      emoji: '🧸',
      color: '#e8590c',
      items: [
        { name: 'Einarmiger Teddybär', flavor: 'Der andere Arm liegt vermutlich noch unterm Sofa von 1994.' },
        { name: 'Zauberwürfel (ungelöst)', flavor: 'Der Vorbesitzer hat einfach die Sticker umgeklebt.' },
        { name: 'Blechroboter mit Rost', flavor: 'Funktioniert nur noch als Türstopper, aber das mit Stil.' },
        { name: 'Puppe mit Augenklappe', flavor: 'Sieht nachts gruseliger aus als tagsüber.' },
        { name: 'Kaputtes Kaleidoskop', flavor: 'Zeigt nur noch ein Muster: Enttäuschung.' },
        { name: 'Holzpferd auf Rädern', flavor: 'Ein Rad quietscht so laut wie ein ganzer Bauernhof.' },
        { name: 'Handheld-Konsole ohne Akku', flavor: 'Läuft nur noch mit Batterien, die es nicht mehr gibt.' },
      ],
    },
    {
      name: 'Küche & Haushalt',
      size: 8,
      goal: 4,
      emoji: '🍳',
      color: '#2f9e44',
      items: [
        { name: 'Fondue-Set ohne Stecker', flavor: 'Kalter Käse schmeckt trotzdem nach Silvester.' },
        { name: 'Eieruhr im Hühnerformat', flavor: 'Gackert beim Klingeln - manche behaupten, das sei Absicht.' },
        { name: 'Emaille-Kanne mit Beule', flavor: 'Die Beule hat Charakter, sagt zumindest der Verkäufer.' },
        { name: 'Handmixer, Baujahr \'82', flavor: 'Läuft lauter als ein Rasenmäher, rührt aber tapfer weiter.' },
        { name: 'Käseglocke aus Glas', flavor: 'Schützt seit Jahren erfolgreich: absolut gar nichts.' },
        { name: 'Suppenteller-Set (3 von 6)', flavor: 'Die anderen drei sind auf Weltreise.' },
        { name: 'Toaster mit Eigenleben', flavor: 'Wirft Toast manchmal auch ganz ungefragt raus.' },
        { name: 'Omas altes Nudelholz', flavor: 'Hat schon mehr Teig gesehen als du warme Mahlzeiten.' },
      ],
    },
    {
      name: 'Deko & Kuriositäten',
      size: 7,
      goal: 4,
      emoji: '🏺',
      color: '#9c36b5',
      items: [
        { name: 'Grinsender Gartenzwerg', flavor: 'Er guckt dich beim Vorbeigehen definitiv an.' },
        { name: 'Lavalampe (halb kaputt)', flavor: 'Die Lava bewegt sich nur noch, wenn man kräftig schüttelt.' },
        { name: 'Getrocknetes Blumenbouquet', flavor: 'War 2003 mal frisch, versprochen.' },
        { name: 'Schneekugel ohne Schnee', flavor: 'Der Schnee ist ausgewandert, die Kugel ist geblieben.' },
        { name: 'Muschelsammlung im Glas', flavor: 'Riecht noch leicht nach Nordsee, Sommer 2009.' },
        { name: 'Sonnenuntergangs-Bild', flavor: 'Passt zu jeder Wand, die es nicht besser verdient hat.' },
        { name: 'Schiefer Kerzenständer', flavor: 'Die Schräglage ist ein Feature, kein Fehler.' },
      ],
    },
    {
      name: 'Kleidung & Accessoires',
      size: 7,
      goal: 4,
      emoji: '👒',
      color: '#1971c2',
      items: [
        { name: 'Blumenhut mit Mottenloch', flavor: 'Die Motten hatten offensichtlich Geschmack.' },
        { name: 'Krawatte mit Ananas-Muster', flavor: 'Niemand hat sie je freiwillig getragen.' },
        { name: 'Ausgeleierter Ledergürtel', flavor: 'Passt inzwischen auf jede Kleidergröße.' },
        { name: 'Einzelner Handschuh', flavor: 'Der Zweite bleibt eines der großen Menschheitsrätsel.' },
        { name: 'Second-Hand-Sakko', flavor: 'Riecht nach fremdem Parfüm und alten Geschichten.' },
        { name: 'Poncho aus den 70ern', flavor: 'Kommt alle 20 Jahre wieder in Mode - Wartezeit läuft.' },
        { name: 'Sonnenbrille mit Sprung', flavor: 'Der Sprung sorgt für einen ganz eigenen Filtereffekt.' },
      ],
    },
  ]; // Summe = 35 echte Objektkarten (+ 15 Ramsch-Karten = 50)

  // 30%-Ramsch-Anteil: eigenständige, wertlose Fundstücke ohne Set-Zugehörigkeit.
  const RAMSCH_ITEMS = [
    { name: 'Einzelne Socke', flavor: 'Ihr Partner ist im Trockner-Nirwana verschwunden.' },
    { name: 'Rostiger Nagel', flavor: 'Tetanusgefahr inklusive, Preis trotzdem verhandelbar.' },
    { name: 'Leere Streichholzschachtel', flavor: 'Perfekt zum Aufbewahren von noch mehr Nichts.' },
    { name: 'Verblasstes Preisschild', flavor: 'Man kann nur noch erahnen, was es mal kosten sollte.' },
    { name: 'Kabel ohne Stecker', flavor: 'Passt zu keinem Gerät, das du besitzt.' },
    { name: 'Zerrissene Plastiktüte', flavor: 'Trägt theoretisch noch, praktisch eher nicht.' },
    { name: 'Angebrochene Kerze', flavor: 'Hat genau einen Geburtstag überlebt.' },
    { name: 'Verbogene Büroklammer', flavor: 'Hält nichts mehr zusammen, außer Erinnerungen.' },
    { name: 'Fleckiger Bierdeckel', flavor: 'Die Ringe erzählen von besseren Abenden.' },
    { name: 'Leere Batterie', flavor: '0% Ladung - aber immerhin schön leicht.' },
    { name: 'Lose Schraube', flavor: 'Passt zu niemandem hier - vielleicht ist das die Pointe.' },
    { name: 'Unlesbare Werbebroschüre', flavor: 'Wirbt für ein Geschäft, das es längst nicht mehr gibt.' },
    { name: 'Kaputter Kugelschreiber', flavor: 'Schreibt nur noch auf Wunschdenken.' },
    { name: 'Verstaubtes Preisschild-Etikett', flavor: 'Klebt an nichts mehr, klebt aber trotzdem irgendwie.' },
    { name: 'Angerissene Serviette', flavor: 'Einmal benutzt, für immer verewigt.' },
  ];

  function createRamschCards() {
    return RAMSCH_ITEMS.map((item, index) => {
      const idNum = String(index + 1).padStart(2, '0');
      return new RamschCard({
        id: `ram-${idNum}`,
        name: item.name,
        imagePlaceholder: '🗑️',
        totalCount: RAMSCH_ITEMS.length,
        flavorText: item.flavor,
      });
    });
  }

  function createObjectCards() {
    const cards = [];
    let counter = 1;
    for (const set of SET_DEFINITIONS) {
      set.items.forEach((item) => {
        const idNum = String(counter).padStart(2, '0');
        cards.push(
          new ObjectCard({
            id: `obj-${idNum}`,
            name: item.name,
            setName: set.name,
            setSize: set.size,
            setGoal: set.goal,
            imagePlaceholder: set.emoji,
            color: set.color,
            flavorText: item.flavor,
          })
        );
        counter++;
      });
    }
    return cards;
  }

  // 5 Mysterio-Karten bilden zugleich ihr eigenes seltenes Set ("Mysterio") -
  // mysteriöse Flohmarkt-Legenden mit echtem Spezialeffekt. effectText
  // beschreibt ihn fürs UI (Tooltip/Log); specialEffect() fließt live in die
  // Wertung ein, drawback() feuert einmalig beim Ausspielen (siehe rules.js).
  function mysterioEffectDefinitions() {
    return [
      {
        itemName: 'Spiegel mit Eigenwillen',
        effectText: '✨ +3 Bonuspunkte am Spielende - er verzerrt nur dein Spiegelbild, nicht deine Punktzahl.',
        specialEffect: () => 3,
        drawback: ({ game, player }) => game._log(`${player.name} hängt den Spiegel mit Eigenwillen auf - der Rest ist Verhandlungssache mit dem eigenen Spiegelbild.`),
      },
      {
        itemName: 'Wackelige Kristallkugel',
        effectText: '🔮 +2 Bonuspunkte, verlangt beim Ausspielen aber ein Opfer: deine älteste Handkarte wandert auf den Friedhof.',
        specialEffect: () => 2,
        drawback: ({ game, player }) => {
          const [card] = player.removeFromHand([player.hand[0]?.id].filter(Boolean));
          if (card) game.discardPile.add(card);
          game._log(`${player.name} befragt die wacklige Kristallkugel - sie verlangt eine Handkarte als Opfer.`);
        },
      },
      {
        itemName: 'Anhalter-Amulett',
        effectText: '🧿 +4 Bonuspunkte, völlig bedingungslos - das einzig ehrliche Angebot auf dem ganzen Markt.',
        specialEffect: () => 4,
        drawback: ({ game, player }) => game._log(`${player.name} steckt sich das Anhalter-Amulett an - kein Haken, ausnahmsweise.`),
      },
      {
        itemName: 'Verbogene Wünschelrute',
        effectText: '🪄 Bonus = Anzahl deiner Handkarten bei Spielende - wer hortet, gewinnt hier richtig.',
        specialEffect: ({ player }) => player.hand.length,
        drawback: ({ game, player }) => game._log(`${player.name} schwingt die verbogene Wünschelrute - der Ausschlag hängt von der vollen Hand ab.`),
      },
      {
        itemName: 'Truhe mit Eigenleben',
        effectText: '🎁 +5 Bonuspunkte, verschluckt beim Ausspielen aber die oberste Karte des Nachziehstapels.',
        specialEffect: () => 5,
        drawback: ({ game, player }) => {
          const extra = game.drawPile.draw();
          if (extra) game.discardPile.add(extra);
          game._log(`${player.name} öffnet die Truhe mit Eigenleben - sie schnappt sich dafür eine Karte vom Nachziehstapel.`);
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

  // 12 Ereigniskarten, im Wechsel aus 11 Effekt-Vorlagen - jede Vorlage soll
  // spürbar humorvoll den bisherigen Spielstand oder Spielspaß auf den Kopf
  // stellen, nicht nur nüchtern Karten verschieben.
  function eventEffectTemplates() {
    return [
      {
        title: 'Bonuszug',
        description: '📦 Lieferung falsch einsortiert! Der aktive Spieler darf sich sofort eine zusätzliche Karte aus der Kiste fischen.',
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
        title: 'Große Inventur',
        description: '🧹 Der Marktaufseher zählt durch! Jeder Spieler muss seine älteste Handkarte auf den Friedhof legen - Ordnung muss sein.',
        effect: (game) => {
          for (const player of game.players) {
            const oldest = player.hand[0];
            if (oldest) {
              player.removeFromHand([oldest.id]);
              game.discardPile.add(oldest);
            }
          }
          game._log('🧹 Große Inventur: alle Spieler legen ihre älteste Handkarte ab.');
        },
      },
      {
        title: 'Preissturz',
        description: '📉 Ausverkauf, alles muss raus! Die obersten zwei Karten des Nachziehstapels landen sofort auf dem Friedhof.',
        effect: (game) => {
          const removed = game.drawPile.drawMany(2);
          game.discardPile.addMany(removed);
          game._log(`📉 Preissturz: ${removed.length} Karte(n) vom Nachziehstapel abgelegt.`);
        },
      },
      {
        title: 'Zufallsglück',
        description: '🍀 Ein Schnäppchen im Ausschuss! Der aktive Spieler darf die oberste Karte des Friedhofs zurückholen.',
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
        title: 'Laufkundschaft',
        description: '🚶 Es strömt Laufkundschaft rein! Jeder Spieler mit weniger als 3 Handkarten zieht auf.',
        effect: (game) => {
          for (const player of game.players) {
            while (player.hand.length < 3 && !game.drawPile.isEmpty) {
              player.addCards([game.drawPile.draw()]);
            }
          }
          if (game.drawPile.isEmpty) game._enterShowdown();
          game._log('🚶 Laufkundschaft: alle Spieler mit weniger als 3 Handkarten ziehen auf.');
        },
      },
      {
        title: 'Razzia am Flohmarkt',
        description: '🚨 Das Ordnungsamt greift durch! Die Grabbelkiste wird sofort beschlagnahmt - alles darin wandert auf den Friedhof.',
        effect: (game) => {
          const count = game.bargainBin.length;
          if (count > 0) {
            game.discardPile.addMany(game.bargainBin);
            game.bargainBin = [];
          }
          game._log(`🚨 Razzia am Flohmarkt: ${count} Karte(n) aus der Grabbelkiste beschlagnahmt.`);
        },
      },
      // --- Twist-Ereignisse ---------------------------------------------
      // Diese setzen game.activeModifier statt (nur) sofort zu wirken: die
      // Regeländerung bleibt aktiv, bis das nächste Ereignis aufgedeckt wird
      // (siehe acknowledgePendingEvent in rules.js, das activeModifier vor
      // jedem neuen Effekt zurücksetzt). So dreht jede Runde spürbar an den
      // Regeln, nicht nur am Kartenbestand.
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
        description: '🚫 Der Marktaufseher macht Standkontrolle! Bis zum nächsten Ereignis dürfen keine Sets ausgespielt werden - nur sammeln und die Grabbelkiste nutzen.',
        effect: (game) => {
          game.activeModifier = {
            id: 'verkaufsstopp',
            label: 'Verkaufsstopp',
            description: 'Sets ausspielen ist verboten, bis das nächste Ereignis kommt.',
          };
          game._log('🚫 Verkaufsstopp ist aktiv, bis das nächste Ereignis aufgedeckt wird.');
        },
      },
      {
        title: 'Ausverkauf am Grabbeltisch',
        description: '📬 Alles muss raus! Bis zum nächsten Ereignis darf jeder Spieler pro Zug einmal rein UND einmal raus aus der Grabbelkiste greifen.',
        effect: (game) => {
          game.activeModifier = {
            id: 'grabbelkiste-ausverkauf',
            label: 'Ausverkauf am Grabbeltisch',
            description: 'Pro Zug ist sowohl Reinlegen als auch Herausnehmen aus der Grabbelkiste erlaubt.',
          };
          game._log('📬 Ausverkauf am Grabbeltisch ist aktiv, bis das nächste Ereignis aufgedeckt wird.');
        },
      },
    ];
  }

  const EVENT_CARD_COUNT = 12;

  function createEventCards() {
    const templates = eventEffectTemplates();
    const cards = [];
    for (let i = 0; i < EVENT_CARD_COUNT; i++) {
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
