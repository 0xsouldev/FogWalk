# Fogwalk

A fog-of-war map that clears wherever you walk. Built for the Isle of Wight, works anywhere. Runs in the browser and keeps everything on your device.

## Features
- **Fog, Lines and Heat views.** Fog clears as you walk, Lines shows each walk (newer walks glow brighter), Heat glows hotter on streets you walk again and again.
- **Live tracking** with distance, pace and new ground, plus a summary when you finish.
- **Isle of Wight progress.** See what percentage of the island you've uncovered.
- **Hidden collectibles.** Coins, map scraps, gems and crowns are hidden all over the map. They shimmer through the fog when you're within 300 m, and you collect them by walking within 35 m. Everyone gets the same treasure in the same places.
- **Badges, streaks and levels.** 22 badges, a daily walking streak, and XP from walking, finds, badges and pins.
- **Your fog sprite.** Customise your character's colour, eyes, headwear, extra and trail colour. More items unlock as you level up and earn badges.
- **Pins** with an icon, a note and an optional photo.
- **Weekly stats** with a km-per-week chart, your best week, longest walk and average pace.
- **Share cards.** Turn your map or a single walk into a 1080 × 1920 image for your story.
- **Import** GPX, KML, TCX, GeoJSON or a ZIP of them. **Back up and restore** everything as one file.

## Run it locally
It's static files, no build step. Serve the folder over HTTP (location needs `https` or `localhost`):

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Put it online (GitHub Pages)
Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`. It goes live at `https://<username>.github.io/fogwalk/`.

## On iPhone
- Open it in Safari, then **Share → Add to Home Screen**. Home Screen apps keep their saved data. Safari can clear a website's data after 7 days without a visit.
- Live tracking only runs while Fogwalk is open with the screen on. iOS pauses GPS for web pages when the screen locks.
- Tap **Back up** now and then. Restore by importing the backup file.

## How it's built
Plain HTML, CSS and JavaScript modules with [Leaflet](https://leafletjs.com) for the map. The fog, heatmap and collectibles are drawn on a canvas layer.

| File | What it does |
|---|---|
| `js/app.js` | Map, drawing, live tracking and all the UI |
| `js/geo.js` | Distance maths and the 10 m grid used to count uncovered area |
| `js/island.js`, `js/island-data.js` | Isle of Wight coastline and the land mask for island % |
| `js/game.js` | Collectibles, streaks, badges and levels |
| `js/avatar.js` | The fog sprite: parts, unlocks and SVG drawing |
| `js/stats.js` | Weekly numbers and the bar chart |
| `js/share.js` | Share card rendering |
| `js/parse.js` | GPX, KML, TCX and GeoJSON import |
| `js/store.js` | IndexedDB storage |

## Credits
- Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Optional CARTO Voyager tiles need your own free CARTO API key.
- Isle of Wight boundary: ONS Local Authority Districts via [martinjc/UK-GeoJSON](https://github.com/martinjc/UK-GeoJSON). Contains National Statistics data and OS data © Crown copyright and database right, [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
