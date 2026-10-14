# Teleférico

**Deutsch** · [English](README.md)

Ein minimalistisches Seilbahn-Strategiespiel im Browser. Du baust das Seilbahnnetz von **La Paz und El Alto** (Bolivien) – auf einer Karte, die der echten Topografie nachempfunden ist: das Hochplateau von El Alto (~4050 m), die zerklüftete Abbruchkante der *Ceja*, der Talkessel des Zentrums (~3600 m), das Tal des Río Choqueyapu und die Zona Sur (~3250 m).

Das Spiel selbst ist reines HTML5-Canvas und Vanilla JavaScript (ES-Module) ohne Build-Schritt. Es läuft am Desktop mit Maus und auf dem Handy mit Touch. Ein optionaler kleiner Node.js-Server ergänzt Konten, Spielstände im Konto und eine Bestenliste.

## Starten

### Mit Server (Konten, Speichern im Konto, Bestenliste)

Voraussetzung: Node.js 18 oder neuer.

```bash
npm install
npm start          # → http://localhost:3000
```

Der Server liefert das Spiel aus und stellt die API unter `/api` bereit. Die Daten liegen in einer SQLite-Datei (`server/data/teleferico.db`, wird automatisch angelegt). Einstellungen über Umgebungsvariablen:

| Variable | Bedeutung |
| --- | --- |
| `PORT` | Port des Servers (Standard `3000`) |
| `TELEFERICO_DB` | Pfad zur SQLite-Datenbank |
| `COOKIE_SECURE=1` | Sitzungs-Cookie nur über HTTPS senden (für den Betrieb hinter HTTPS) |
| `TRUST_PROXY` | Hinter einem Reverse-Proxy: `1` (ein Proxy), eine Anzahl oder IP-/CIDR-Liste – damit das Rate-Limit die echte Client-IP sieht |
| `PUBLIC_ORIGIN` | Öffentliche Adresse, z. B. `https://teleferico.example` (mehrere kommagetrennt). Nötig, wenn der Proxy den `Host`-Header umschreibt – sonst lehnt der Schutz vor fremden Seiten Anmelden und Speichern ab. Alternativ im Proxy den Host weiterreichen (nginx: `proxy_set_header Host $host;`). |

Tests (Server-API, Spielstände, Übersetzungen, Frontend-Erkennung): `npm test`

### Ohne Server (nur Gastmodus)

Jeder einfache statische Webserver genügt; Konten gibt es dann nicht, alles andere funktioniert:

```bash
npx serve .
# oder
python3 -m http.server 8000   # dann http://localhost:8000 öffnen
```

> **Hinweis zu `file://`:** Viele Browser blockieren JavaScript-Module, wenn die `index.html` direkt von der Festplatte geöffnet wird. Das Spiel zeigt dann einen Hinweis mit den Befehlen oben an.

## Spielregeln

**Ziel:** Bring so viele Fahrgäste wie möglich ans Ziel. Der Punktestand ist die Zahl der beförderten Fahrgäste.

- **Stationen** erscheinen nach und nach als Formen: Kreis, Dreieck, Quadrat – später auch seltene Formen (Raute, Stern, Kreuz). Sie tragen Namen realer Stadtteile und entstehen bevorzugt dort, wo bebaute Stadt ist.
- **Fahrgäste** tauchen als kleine Formen neben den Stationen auf. Jeder will zu *irgendeiner* Station mit seiner Form, wählt selbst den besten Weg durchs Netz und steigt dafür auch um.
- **Linien** ziehst du von Station zu Station. Seilbahnen fahren nur auf **geraden Seilstrecken** – die Richtung ändert sich ausschließlich an Stationen.
- **Gondeln** pendeln automatisch zwischen den Endstationen einer Linie. Jede Kabine fasst 6 Fahrgäste (große Kabine: 10).
- **Überfüllung:** Warten an einer Station mehr als 6 Fahrgäste (Umsteigestation: 12), füllt sich ein Kreis-Timer. Ist er voll, ist das Spiel vorbei. Sinkt die Zahl wieder, läuft der Timer langsam zurück.
- **Tageszeit:** Morgens und abends ist Stoßzeit, nachts ist es ruhiger und die Karte wird dunkler. Das kleine Illimani-Symbol neben der Uhr färbt sich mit der Tageszeit.
- **Wochen:** Zu Beginn jeder Woche gibt es eine neue Gondel und du wählst **eine von zwei Belohnungen**: *Neue Linie* (bis zu 10 Farben), *Gondel*, *2 Masten*, *Hoher Mast*, *Große Kabine* oder *Umsteigestation*.
- **Wachsende Stadt:** Die Runde beginnt in einem kleinen Ausschnitt rund um das Startgebiet. Woche für Woche wächst der bespielbare Bereich, die Kamera zoomt mit heraus. Eine typische Runde dauert 5–15 Minuten.

### Gelände

Die Karte ist ca. 25 × 20 km groß (Norden oben) und aus Kontrollpunkten in `src/data/terrain.js` berechnet: Höhenbänder in flachen Farben, feine Höhenlinien, die gestrichelte Abbruchkante der Ceja, Flüsse und Schluchten in Blau sowie kleine Ortsnamen.

- **Masten** werden beim Bauen automatisch gesetzt und kommen aus deinem Vorrat. Gebraucht werden sie
  - für Spannweiten über 2,3 km,
  - über jeder **Schlucht**, die mindestens 35 m tief ist (Choqueyapu, Orkojahuira, Irpavi, Achocalla und viele Seitenquebradas),
  - an **steilen Kanten** wie der Ceja (mehr als 70 m Höhenunterschied auf 240 m),
  - wo ein Bergrücken das Seil berühren würde (das Seil hängt zwischen 18 m hohen Stationstürmen und 30 m hohen Masten und braucht 12 m Bodenabstand).

  Reicht der Vorrat nicht, wird die Vorschau rot gestrichelt. Baust du eine Strecke ab, bekommst du ihre Masten zurück.
- **Höhe:** Gondeln fahren bergauf Richtung El Alto langsamer und bergab etwas schneller.
- **Bauplätze:** Stationen entstehen nur auf bebaubarem Gelände – nicht in Schluchten und Flüssen und nicht an Hängen steiler als etwa 19 %.

### Gebäude

Die Bebauung wird aus dem Seed erzeugt und folgt den Stadtgebieten (Schachbrett in El Alto, Hangsiedlungen am Kessel, Gartenstadt in der Zona Sur):

- **Überbaubar** (hellgrau): Wohnhäuser, Märkte, Plätze, Felder. Seile dürfen darüber hinweg.
- **Blockierend** (dunkel, mit Symbol): Hochhäuser im Zentrum und in der Zona Sur, Stadien, Spitäler mit Hubschrauberlandeplatz, Kasernen sowie der **Flughafen El Alto samt Anflugschneise**.

Beim Ziehen prüft das Spiel jede Seilstrecke sofort: Ungültige Strecken werden rot gestrichelt, lassen sich nicht bauen, und ein kurzer Hinweis nennt den Grund (z. B. „Flughafen-Sperrzone: kein Seil über Flughafen und Einflugschneise.“, „Hier braucht das Seil 1 hohen Mast über Gebäude – frei: 0.“ oder „Zu wenig Masten: …“). Mit der Belohnung **Hoher Mast** darf ein Seil ein *einzelnes* Hochhaus, Stadion, Spital oder eine Kaserne überspannen – der Flughafen bleibt tabu. Hohe Masten erscheinen größer und mit rot-weißer Spitze; normale Masten werden automatisch neben blockierende Gebäude gesetzt. Fährst du mit der Maus über ein Gebäude (Touch: kurz antippen), zeigt ein Tooltip, was es ist.

### Seeds und Startgebiete

Jede Runde beginnt in einem zufälligen Startgebiet – Zentrum, El Alto, Zona Sur, Achocalla, Ovejuyo, Villa Fátima oder Ciudad Satélite – mit drei Startstationen. Alles Zufällige (Startgebiet, Gebäude, Startstationen, Spielverlauf) hängt an einem **Seed** und einem eigenen Zufallsgenerator: **gleicher Seed = gleiche Karte und gleicher Start.**

- Der Seed steht im Startbildschirm, im Menü und auf dem Game-Over-Bildschirm.
- Im Startbildschirm kannst du einen eigenen Seed eingeben (Buchstaben und Ziffern, bis 12 Zeichen) oder mit dem Würfel einen neuen erzeugen.
- „Gleicher Seed“ bzw. „Neu starten (gleicher Seed)“ spielt dieselbe Karte noch einmal.

## Sprache

Das Spiel gibt es auf **Deutsch, Englisch und Spanisch**. Die Sprache wählst du im Startbildschirm oben rechts oder im Pausenmenü (**DE · EN · ES**). Sie gilt sofort – auch mitten in einer Runde und in offenen Dialogen – und wird im Browser gespeichert. Beim ersten Start richtet sich das Spiel nach der Browsersprache (sonst Englisch).

- Orts-, Stations- und Flussnamen sind spanische Eigennamen und bleiben in allen Sprachen gleich.
- Der Server antwortet bei Fehlern zusätzlich mit einem Fehlercode (`code`, ggf. `params`); das Spiel zeigt die Meldung damit in der gewählten Sprache an.
- Alle Texte stehen in `src/lang/de.js`, `en.js` und `es.js`. Ein Test prüft, dass alle drei dieselben Schlüssel und Platzhalter haben und jeder im Code verwendete Schlüssel existiert. Eine weitere Sprache braucht nur ein neues Wörterbuch und einen Eintrag in `LANGS` (`src/i18n.js`).

## Steuerung

| Aktion | Maus / Touch |
| --- | --- |
| Neue Linie bauen | Von einer Station aus über weitere Stationen ziehen. Zurück über die letzte Station nimmt sie wieder heraus. |
| Linie verlängern | Am **T-Ende** einer Linie greifen und zu neuen Stationen ziehen |
| Linie kürzen | Am T-Ende greifen und über die vorletzte Station zurückziehen (bis zu einer Station = Linie löschen) |
| Strecke umleiten | Ein Seilstück in der Mitte greifen und auf eine oder mehrere Stationen ziehen – sie werden dazwischen eingefügt |
| Station abhängen | Ein Seilstück greifen und über eine seiner Endstationen hinweg auf die nächste Station der Linie ziehen |
| Linie auswählen | Auf ein Seilstück oder den Farbpunkt unten tippen |
| Linie löschen | Linie auswählen, dann **Löschen** (oder `Entf`). Die Gondeln lassen an der nächsten Station alle aussteigen und kehren ins Depot zurück. |
| Gondel einsetzen | Gondel-Symbol aus der unteren Leiste auf eine Linie ziehen |
| Gondel versetzen / entfernen | Gondel greifen und auf eine andere Linie ziehen – oder irgendwo ablegen (zurück ins Depot) |
| Große Kabine / Umsteigestation | Symbol aus der Leiste auf eine Gondel bzw. Station ziehen |
| Stationsinfo | Mit der Maus über eine Station fahren oder kurz antippen (Name, Höhe, Wartende) |
| **Karte verschieben** | Rechte (oder mittlere) Maustaste gedrückt halten und ziehen · Touch: mit zwei Fingern ziehen |
| **Zoomen** | Mausrad bzw. Touchpad · Touch: mit zwei Fingern auseinander-/zusammenziehen |
| Ansicht zentrieren | Knopf oben rechts (erscheint nach dem Verschieben) oder `C` |

Solange du die Kamera nicht selbst bewegst, folgt sie automatisch der wachsenden Stadt. Nach dem Verschieben oder Zoomen bleibt sie, wo du sie hingestellt hast, bis du die Ansicht zentrierst.

| Taste | Funktion |
| --- | --- |
| `Leertaste` | Pause / weiter (Bauen ist auch in der Pause möglich) |
| `1` / `2` | Spielgeschwindigkeit 1× / 2× – im Belohnungsdialog: Belohnung wählen |
| `+` / `-` | Hinein- / herauszoomen |
| `C` / `Pos1` | Ansicht auf die Stadt zentrieren |
| `Entf` / `Backspace` | Ausgewählte Linie löschen |
| `M` | Ton an/aus |
| `Esc` | Ziehen abbrechen, Auswahl aufheben, Dialog schließen bzw. Menü öffnen |
| `Enter` | Im Start- und Game-Over-Bildschirm: Runde starten |

## Speichern

- Der vollständige Spielzustand wird gespeichert: Seed, Zeit und Woche, Stationen mit Wartenden und Timern, Linien, Gondeln mitsamt Fahrgästen und Position, Masten, Vorrat, Punktestand, Zufallsgenerator und Kamera. Ein geladener Stand läuft danach exakt so weiter, wie er gespeichert wurde.
- **Automatisch** alle 30 Sekunden Spielzeit sowie beim Verlassen oder Verstecken der Seite. Im Startbildschirm setzt **Weiterspielen** die letzte Runde fort. Endet eine Runde, wird ihr automatischer Stand gelöscht bzw. im Konto als beendet markiert – so bietet sie auch kein anderes Gerät mehr an. Ein nur geladener, unveränderter Stand überschreibt den automatischen Stand nicht.
- **Manuell** über *Menü → Spiel speichern* in einen von drei Speicherplätzen. *Spielstände* (Start- und Menübildschirm) zeigt alle Plätze mit Vorschau (Datum, Woche, Punkte, Startgebiet, Seed) zum Laden oder Löschen. Ein geladener Stand beginnt pausiert.
- Lokal liegen die Stände in der **IndexedDB** des Browsers – getrennt nach Gast und Konto, sodass nach dem Abmelden oder auf einem geteilten Rechner niemand die Stände eines anderen Kontos sieht. Ist kein Speicher verfügbar (z. B. privater Modus), läuft das Spiel trotzdem – die Stände leben dann nur bis zum Neuladen.
- Jeder Stand trägt eine Versionsnummer (`SAVE_VERSION` in `src/save.js`). Beim Laden läuft er durch `migrate()` – dort werden künftige Formatänderungen nachgezogen; Stände aus einer neueren Spielversion werden abgelehnt.

## Konten

Nur verfügbar, wenn das Spiel über den mitgelieferten Server läuft. Ohne Anmeldung bleibt alles als **Gast** spielbar (nur lokale Spielstände).

- **Registrieren / Anmelden** im Startbildschirm unter *Anmelden*. Benutzername 3–24 Zeichen (Buchstaben, Ziffern, `_ . -`), Passwort mindestens 8 Zeichen. Der angemeldete Name steht klein in der Ecke.
- Angemeldet wird jeder Spielstand zusätzlich im **Konto** gespeichert (eigene Konto-Plätze in der Spielstand-Liste) und lässt sich so in einem anderen Browser oder auf einem anderen Gerät laden.
- Nach der Anmeldung bietet das Spiel an, **lokale Gast-Spielstände ins Konto zu übernehmen**. Belegte Konto-Plätze werden dabei nicht überschrieben, sondern als „Übernommen N“ abgelegt.
- Am Rundenende wird die Punktzahl eingetragen: **Bestenliste** mit den besten Spielern und deinen persönlichen Bestwerten. Der lokale Highscore im Browser bleibt zusätzlich erhalten. Der Server prüft Ergebnisse auf Plausibilität (bekanntes Startgebiet, gültiger Seed, Woche passend zur Spielzeit, nicht mehr Fahrgäste, als in dieser Zeit entstehen können); nachspielen kann er eine Runde aber nicht.
- Läuft die Anmeldung ab (oder wurde in einem anderen Tab abgemeldet), meldet das Spiel das und speichert bis zur erneuten Anmeldung nur lokal.
- Sicherheit: Passwörter werden mit bcrypt gehasht, die Sitzung läuft über ein `HttpOnly`-Cookie (`SameSite=Lax`, 30 Tage), Eingaben werden geprüft, Fehlversuche beim Anmelden sind pro IP und Benutzer begrenzt (erfolgreiche Anmeldungen zählen nicht, damit sich z. B. eine Schulklasse hinter einer Adresse nicht aussperrt), neue Konten pro IP und Stunde ebenso. Ändernde Anfragen von fremden Seiten werden abgelehnt. Ein Spielstand darf höchstens 256 KB groß sein, alle Stände eines Kontos zusammen 2 MB (echte Stände: 10–60 KB).

### API

| Methode | Pfad | Zweck |
| --- | --- | --- |
| `POST` | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Konto anlegen, anmelden, abmelden |
| `GET` | `/api/auth/me` | Angemeldeter Benutzer |
| `GET` | `/api/saves` | Liste der Spielstände (nur Vorschau) |
| `GET` / `PUT` / `DELETE` | `/api/saves/:slot` | Spielstand laden / speichern / löschen |
| `POST` | `/api/scores` | Punktzahl eintragen |
| `GET` | `/api/scores/me`, `/api/leaderboard` | Persönliche Bestwerte, globale Bestenliste |

## Projektstruktur

```
index.html            Seitengerüst, HUD, Bildschirme und Dialoge
style.css             Gestaltung der Oberfläche (responsiv)
src/
  main.js             Einstieg, Spielschleife, Verdrahtung, Autosave, Menüs, Konten
  game.js             Spielzustand und Regeln: Zeit/Wochen, Startgebiet, Spawning, Netz, Ressourcen, Game Over
  data/terrain.js     Geländedaten: Plateau, Ceja, Flüsse, Bergrücken, Stadtgebiete, Orte, Startgebiete, Wahrzeichen
  terrain.js          Höhenmodell aus den Geländedaten, Schluchten, Höhenlinien
  map.js              Karte: Zeichnen, Bauplätze, Ortsnamen, Mastbedarf aus dem Geländeprofil
  buildings.js        Prozedurale Bebauung, blockierende Gebäude, Prüfung der Seilstrecken
  station.js          Stationen, Formen, wartende Fahrgäste, Überfüllungs-Timer
  line.js             Linien, parallele Versätze, T-Enden, Masten
  gondola.js          Gondeln: Fahrt mit Beschleunigung, Pendeln am Seil, Ein-/Aus-/Umsteigen
  passenger.js        Fahrgäste und Routing (Dijkstra über Station×Linie mit Umsteigekosten)
  render.js           Kamera (Folgen, Verschieben, Zoom) und Zeichnen; Hintergrund in Kacheln zwischengespeichert
  input.js            Maus- und Touch-Bedienung inkl. Pinch-Zoom und Kamerasteuerung
  ui.js               DOM-Oberfläche: HUD, Leiste, Belohnungen, Spielstände, Konto, Bestenliste
  i18n.js             Sprachauswahl, Übersetzungsfunktion t(), Namen (Farben, Formen, Tage, Startgebiete)
  lang/               Wörterbücher: de.js (Ausgangssprache), en.js, es.js
  save.js             Spielstand serialisieren, laden und migrieren
  storage.js          Lokale Spielstände in IndexedDB (mit Ersatz im Arbeitsspeicher)
  persist.js          Speicherplätze lokal und im Konto, Übernahme von Gast-Ständen
  api.js              Client für die Server-API
  audio.js            Prozedurale Klänge über die Web Audio API
  autoplay.js         Einfacher Bot für den Startbildschirm und die Simulation
  config.js           Spielkonstanten, Linienfarben, Formen
  util.js             Mathe, Geometrie, Seeds und Zufallsgenerator, Speicher-Helfer
server/
  index.js            Startpunkt (npm start), Umgebungsvariablen
  app.js              Express-App: API, Validierung, Auslieferung des Frontends
  db.js               SQLite-Schema (Benutzer, Sitzungen, Spielstände, Punkte)
  session.js          Sitzungs-Token und Cookies
  ratelimit.js        Einfaches Rate-Limiting
  config.js           Auswertung von TRUST_PROXY und PUBLIC_ORIGIN
  plausible.js        Plausibilitätsprüfung für Bestenlisten-Einträge
tests/                Node-Tests (npm test)
tools/
  simulate.mjs        Balancing: lässt den Bot mehrere Runden headless spielen
  stress.mjs          Stresstest mit zufälligen Netzänderungen und Invarianten-Prüfung
```

Die Spiellogik (`game.js` und abhängige Module) kommt ohne DOM aus und läuft deshalb auch in Node.js:

```bash
node tools/simulate.mjs 12   # 12 Bot-Runden, zeigt Dauer, Woche und Punkte
node tools/stress.mjs 30     # 30 Runden mit zufälligen Umbauten während des Betriebs
```

In der Browser-Konsole ist der laufende Spielzustand unter `window.__teleferico.game` erreichbar.

## Hinweise

Teleférico ist ein eigenständiges Spiel mit eigenem Namen, eigener Grafik und eigenem Code. Das Spielprinzip ist von Liniennetz-Spielen inspiriert; es werden keine Assets, Texte oder Logos von *Mini Metro* oder vom Betreiber des realen Seilbahnnetzes in La Paz verwendet. Stations- und Ortsnamen sind Namen realer Stadtteile von La Paz und El Alto.

Die Topografie ist von Hand aus öffentlich bekanntem Kartenwissen nachgebaut und stark vereinfacht. Ein Kartenausschnitt, der dabei als Referenz diente (`reference/la-paz-topo.png`), ist bewusst nicht Teil des Repositorys.
