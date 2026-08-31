# Keyfall

A browser-based physics puzzle built with [Matter.js](https://brm.io/matter-js/) and
Kenney's [rolling-ball / physics asset pack](https://kenney.nl/assets/rolling-ball-assets)
(recolored to a custom palette).

A yellow marble drops from the top of a vertical playfield through a field of
magenta pivot arms. Click or tap an arm to rotate it 90°, redirecting the ball's
fall. Guide the ball to land on every numbered yellow keyhole switch in a single
continuous drop, before it exits the bottom — clear them all and the bonus star
unlocks.

## Play it

Open `index.html` in a browser (or serve the folder locally, e.g.
`python3 -m http.server`, then visit `http://localhost:8000`).

## Controls

- **Drop Ball** — release the ball from the top.
- **Click / tap a magenta arm** — rotate it 90°.
- **Reset Level** — restore the arms to their starting layout and try again from scratch.
- **Nudge** — give the ball a small random shove if it gets parked on a surface mid-fall.

## Palette

| Element | Color |
|---|---|
| Platforms / ledges | Teal `#60D0C0` |
| Pivot arms | Magenta `#D840B8` |
| Ball & keyhole switches | Yellow `#F8E060` |
| Background & outlines | Ink `#101018` |

## Credits

Art: [Kenney](https://kenney.nl) rolling-ball asset pack (CC0), recolored to the
palette above — see `ASSET_LICENSE.txt`.
Physics: [Matter.js](https://brm.io/matter-js/) 0.20.0.
