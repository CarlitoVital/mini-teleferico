# Teleférico

Ein minimalistisches Seilbahn-Strategiespiel im Browser. Du baust das Seilbahnnetz von **La Paz und El Alto** (Bolivien): vom Hochplateau El Alto (~4050 m) über die Hänge und das Zentrum im Talkessel (~3600 m) bis hinunter in die Zona Sur (~3300 m) – mit dem Illimani im Hintergrund.

Reines HTML5-Canvas und Vanilla JavaScript (ES-Module), ohne Build-Schritt und ohne externe Abhängigkeiten. Läuft am Desktop mit Maus und auf dem Handy mit Touch.

## Starten

Im Projektordner einen kleinen lokalen Server starten und die angezeigte Adresse im Browser öffnen:

```bash
npx serve .
# oder
python3 -m http.server 8000   # dann http://localhost:8000 öffnen
```

> **Hinweis zu `file://`:** Die `index.html` lässt sich auch direkt per Doppelklick öffnen. Viele Browser (z. B. Chrome, Edge, Safari) blockieren dabei aber JavaScript-Module. In dem Fall zeigt das Spiel einen Hinweis mit den Befehlen oben an.

## Spielregeln

**Ziel:** Bring so viele Fahrgäste wie möglich ans Ziel. Der Punktestand ist die Zahl der beförderten Fahrgäste.

- **Stationen** erscheinen nach und nach als Formen: Kreis, Dreieck, Quadrat – später auch seltene Formen (Raute, Stern, Kreuz). Anfangs wächst vor allem das Zentrum, später breitet sich die Stadt besonders in El Alto und der Zona Sur aus.
- **Fahrgäste** tauchen als kleine Formen neben den Stationen auf. Jeder will zu *irgendeiner* Station mit seiner Form. Sie wählen selbst den besten Weg durchs Netz und steigen dafür auch um.
- **Linien** ziehst du von Station zu Station. Seilbahnen fahren nur auf **geraden Seilstrecken** – die Richtung ändert sich ausschließlich an Stationen. Mehrere Linien auf derselben Strecke laufen nebeneinander.
- **Gondeln** pendeln automatisch zwischen den Endstationen einer Linie. Jede Kabine fasst 6 Fahrgäste (große Kabine: 10).
- **Masten:** Jede Seilstrecke hat eine maximale Spannweite. Längere Strecken brauchen Masten, und jede **Schlucht** (Río Choqueyapu, Río Orkojahuira) lässt sich nur mit einem Mast überqueren. Masten sind begrenzt und werden beim Bauen automatisch gesetzt; reichen sie nicht, färbt sich die Vorschau rot. Baust du eine Strecke ab, bekommst du ihre Masten zurück.
- **Höhe:** Gondeln fahren bergauf Richtung El Alto langsamer und bergab etwas schneller.
- **Überfüllung:** Warten an einer Station mehr als 6 Fahrgäste (Umsteigestation: 12), füllt sich um sie herum ein Kreis-Timer. Ist er voll, ist das Spiel vorbei. Sinkt die Zahl wieder, läuft der Timer langsam zurück.
- **Tageszeit:** Morgens und abends ist Stoßzeit mit deutlich mehr Fahrgästen, nachts ist es ruhiger (und die Karte wird etwas dunkler).
- **Wochen:** Zu Beginn jeder Woche bekommst du eine neue Gondel und wählst **eine von zwei Belohnungen**:
  - *Neue Linie* – eine weitere Linienfarbe (bis zu 10: Rot, Gelb, Grün, Blau, Orange, Weiß, Hellblau, Violett, Braun, Silber)
  - *Gondel* – eine zusätzliche Kabine
  - *2 Masten* – für weitere Schluchtquerungen und lange Spannweiten
  - *Große Kabine* – eine Gondel fasst 10 statt 6 Fahrgäste
  - *Umsteigestation* – Station fasst 12 Fahrgäste, Ein- und Umsteigen geht doppelt so schnell
- Mit der Zeit erscheinen Stationen und Fahrgäste immer schneller. Eine typische Runde dauert 5–15 Minuten.

## Steuerung

| Aktion | Maus / Touch |
| --- | --- |
| Neue Linie bauen | Von einer Station aus über weitere Stationen ziehen. Zurück über die letzte Station nimmt sie wieder heraus. |
| Linie verlängern | Am **T-Ende** einer Linie greifen und zu neuen Stationen ziehen |
| Linie kürzen | Am T-Ende greifen und über die vorletzte Station zurückziehen (bis zu einer Station = Linie löschen) |
| Strecke umleiten | Ein Seilstück in der Mitte greifen und auf eine oder mehrere Stationen ziehen – sie werden dazwischen eingefügt |
| Station abhängen | Ein Seilstück greifen und über eine seiner Endstationen hinweg auf die nächste Station der Linie ziehen – die übersprungene Station wird aus der Linie genommen |
| Linie auswählen | Auf ein Seilstück oder den Farbpunkt unten tippen |
| Linie löschen | Linie auswählen, dann **Löschen** (oder `Entf`). Die Gondeln fahren zur nächsten Station, lassen alle aussteigen und kehren ins Depot zurück. |
| Farbe der nächsten Linie | Freien Farbpunkt unten antippen |
| Gondel einsetzen | Gondel-Symbol aus der unteren Leiste auf eine Linie ziehen |
| Gondel versetzen / entfernen | Gondel auf dem Netz greifen und auf eine andere Linie ziehen – oder irgendwo ablegen, dann geht sie zurück ins Depot |
| Große Kabine / Umsteigestation | Symbol aus der Leiste auf eine Gondel bzw. Station ziehen |
| Stationsinfo | Mit der Maus über eine Station fahren oder kurz antippen (Name, Höhe, Wartende) |

| Taste | Funktion |
| --- | --- |
| `Leertaste` | Pause / weiter (Bauen ist auch in der Pause möglich) |
| `1` / `2` | Spielgeschwindigkeit 1× / 2× – im Belohnungsdialog: Belohnung wählen |
| `Entf` / `Backspace` | Ausgewählte Linie löschen |
| `M` | Ton an/aus |
| `Esc` | Ziehen abbrechen, Auswahl aufheben bzw. Menü öffnen |

Der Highscore wird lokal im Browser gespeichert (`localStorage`); im privaten Modus funktioniert das Spiel auch ohne.

## Projektstruktur

```
index.html          Seitengerüst, HUD, Bildschirme
style.css           Gestaltung der Oberfläche (responsiv)
src/
  main.js           Einstieg, Spielschleife (requestAnimationFrame, Delta-Time), Verdrahtung, Highscore
  game.js           Spielzustand und Regeln: Zeit/Wochen, Spawning, Netz-Operationen, Ressourcen, Game Over
  map.js            Karte: Höhenbänder, Schluchten, Mastbedarf, Bauplätze, Illimani
  station.js        Stationen, Formen, wartende Fahrgäste, Überfüllungs-Timer
  line.js           Linien, parallele Versätze, T-Enden, Masten
  gondola.js        Gondeln: Fahrt mit Beschleunigung, Pendeln am Seil, Ein-/Aus-/Umsteigen
  passenger.js      Fahrgäste und Routing (Dijkstra über Station×Linie mit Umsteigekosten)
  render.js         Kamera und Zeichnen eines Frames (Hintergrund wird zwischengespeichert)
  input.js          Maus- und Touch-Bedienung (Pointer Events)
  ui.js             DOM-Oberfläche: HUD, Leiste, Belohnungen, Game Over
  audio.js          Prozedurale Klänge über die Web Audio API
  autoplay.js       Einfacher Bot für den Startbildschirm und die Balancing-Simulation
  config.js         Spielkonstanten, Linienfarben, Formen
  util.js           Mathe-, Geometrie- und Speicher-Helfer
tools/
  simulate.mjs      Balancing: lässt den Bot mehrere Runden headless spielen
  stress.mjs        Stresstest mit zufälligen Netzänderungen und Invarianten-Prüfung
```

Die Spiellogik (`game.js` und abhängige Module) kommt ohne DOM aus und läuft deshalb auch in Node.js:

```bash
node tools/simulate.mjs 12   # 12 Bot-Runden, zeigt Dauer, Woche und Punkte
node tools/stress.mjs 30     # 30 Runden mit zufälligen Umbauten während des Betriebs
```

In der Browser-Konsole ist der laufende Spielzustand unter `window.__teleferico.game` erreichbar.

## Hinweise

Teleférico ist ein eigenständiges Spiel mit eigenem Namen, eigener Grafik und eigenem Code. Das Spielprinzip ist von Liniennetz-Spielen inspiriert; es werden keine Assets, Texte oder Logos von *Mini Metro* oder vom Betreiber des realen Seilbahnnetzes in La Paz verwendet. Stationsnamen sind Namen realer Stadtteile von La Paz und El Alto.
