# Look Studio

Fotobearbeitung im Browser – gebaut fürs iPhone, für den Feed von [@framesthroughdavid](https://www.instagram.com/framesthroughdavid/).
Alles läuft lokal auf dem Gerät, Fotos werden nirgendwo hochgeladen.

## Funktionen (Phase 1 + 2)

- **Looks:** 5 Start-Presets aus dem eigenen Feed abgeleitet (Lost Memory, Aegean Film, Winter Stillness, Urban Gaze, Golden Hour) mit Stärke-Regler, eigene Presets speichern
- **Licht:** Belichtung, Kontrast, Lichter, Tiefen, Weiß, Schwarz
- **Farbe:** Temperatur, Tönung, Dynamik, Sättigung, Schwarzweiß, **Color Key** (Farbe im Bild antippen → nur sie bleibt farbig)
- **HSL:** Farbton/Sättigung/Luminanz für 8 Farbbereiche
- **Kurven:** RGB + Rot/Grün/Blau mit Histogramm
- **Color Grading:** Farbräder für Tiefen, Mitteltöne, Lichter, Balance, Übergang
- **Effekte:** Klarheit, Schärfe, Fade, Körnung, Vignette
- Vorher/Nachher (Bild gedrückt halten), Rückgängig/Wiederholen
- Export: Instagram (1080 px) oder volle Auflösung, über das Teilen-Menü direkt in Fotos sichern

Die Bearbeitung ist nicht-destruktiv: alle Regler werden als Parameter gespeichert und per WebGL2-Shader auf der Grafikkarte angewendet.

## Auf dem iPhone nutzen

1. Seite in Safari öffnen (GitHub-Pages-Link des Repos)
2. Teilen → „Zum Home-Bildschirm“ – startet dann wie eine App, auch offline

## Entwicklung

```bash
npm install
npm run dev      # lokaler Server
npm run build    # Produktions-Build nach dist/
```

Deployment: Jeder Push auf `main` baut und veröffentlicht automatisch über GitHub Actions
(einmalig in den Repo-Einstellungen unter *Settings → Pages → Source* „GitHub Actions“ wählen).

## Roadmap

- Phase 3: Film-Looks (LUTs, RawTherapee Film Simulation Collection), Spiegeln/Kaleidoskop, Linsen- und Lichteffekte
- Phase 4: Zuschneiden 4:5 / 1:1 / 9:16, Begradigen, Look auf mehrere Bilder, Feed-Vorschau
