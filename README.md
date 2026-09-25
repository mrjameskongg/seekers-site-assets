# seekers-site-assets

Media for seekersspirits.com, served through jsDelivr.

- `hero/seekers-hero-vealthom-1080.mp4`: home hero loop, 14 s, 1920x1080, muted
- `hero/seekers-hero-vealthom-720.mp4`: same loop for phones, 1280x720
- `hero/seekers-hero-vealthom-poster.jpg` / `.webp`: first frame, shown while the loop loads

Footage: Veal Thom sunrise by Phearun Yin, for Seekers Independent Spirits.

Also serves chantyspirit.com:

- `chanty/liquid-logo.js`: renders the Chanty wordmark as liquid copper (WebGL, no dependencies). Add `data-liquid-logo` to the logo's `<svg>` or same-origin `<img>` and load the script. It falls back to the flat logo without WebGL and holds a still frame under reduced motion.

URLs are pinned to a tag, e.g. `https://cdn.jsdelivr.net/gh/mrjameskongg/seekers-site-assets@v1/hero/seekers-hero-vealthom-1080.mp4`.
To change a file, commit it under a new name or tag a new version; jsDelivr caches tags permanently.
