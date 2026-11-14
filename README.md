# Finanzen

Persönliche Auswertung von Bank-Exporten (bank99, Trade Republic). Installierbare Web-App, funktioniert offline.

- In Chrome auf Android öffnen: https://dboandl.github.io/finanzen/ → Menü → **Zum Startbildschirm hinzufügen** (oder **App installieren**).
- Exporte über **Import** wählen oder aus der Bank-App per **Teilen → Finanzen** schicken.
- Daten liegen am Handy (IndexedDB). Mit Repo und Token unter **Sync** gehen Buchungen, Regeln und Einstellungen in ein privates GitHub-Repo.
- Klienten-Buchungen (MGT in der Referenz) werden beim Import anonymisiert, bevor irgendetwas gespeichert wird. Die Namensliste bleibt am Handy.
- Kein Build-Schritt: `index.html` (App), `core.js` (Exporte lesen, anonymisieren, kategorisieren), `sync.js` (Sync über die GitHub Git Data API), `sw.js` (Offline-Kopie, Teilen-Ziel).
- Unten auf jedem Bildschirm: **Prompt für Claude**, ein Änderungswunsch für die App. Er geht über den Sync ins private Repo (Namen vorher durch Kürzel ersetzt) und wird beim nächsten Mal am Mac gebaut.
- Hier stehen nur allgemeine Regeln. Persönliche Regeln und Kategorienamen kommen aus dem privaten Daten-Repo.
