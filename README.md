# ItemAssist Static Site

First-pass static homepage scaffold for ItemAssist.

## Structure

- `index.html` contains the homepage markup.
- `styles.css` contains all layout and visual styling.
- `script.js` contains minimal interaction for the mobile navigation.
- `assets/report-preview.png` is the hero preview image.
- `Stitch-Export/` contains the raw Google Stitch reference export and prototype code.

## Local Preview

Option 1:

- Open `index.html` directly in a browser.

Option 2:

- From this folder, run `python -m http.server 8000`
- Open `http://localhost:8000`

## Notes

- The site is framework-free and deployable as a static site on GitHub Pages or Vercel.
- If a stronger branded report preview is available later, replace `assets/report-preview.png` with the new asset and keep the same relative path.
