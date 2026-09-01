# SnapFit

A mobile-first camera web app in the spirit of Instagram and the iPhone camera:
shoot high-resolution photos and videos with live filters, lens effects and
printable-style frames — entirely in the browser, no backend.

Supported browsers: iPhone Safari and Android Chrome (modern versions).

## Features

- **High-resolution photo & video capture** — requests up to 4K from
  `getUserMedia`; stills are rendered at the native resolution of the visible
  sensor region.
- **Zoom** — pinch (or mouse wheel on desktop) for 1×–8× digital zoom, applied
  in the WebGL pipeline so captures match the viewfinder.
- **Lens switching** — front/back flip, physical ultra-wide/telephoto lens
  selection where the device exposes them (with a digital 2× fallback), plus a
  simulated fisheye lens effect.
- **Live filters** — normal, film, toy camera, pixel-art, pale/white, vivid,
  mono and retro, implemented as WebGL fragment shaders and applied to photos
  and videos alike.
- **Frames** — Instax-style (cheki) card, perforated postage stamp and 35mm
  film strip. The instax and stamp frames keep a transparent outer margin
  (exported as PNG); the film frame has transparent sprocket holes.
- **Multi-shot collage** — 2-up, 3-up film strip or 2×2 grid shot sequentially
  and composed into a single image, combinable with any frame.
- **Save to device** — download or hand off via the Web Share sheet (which
  allows saving straight to the photo library on iOS).

## Development

```sh
npm install
npm run dev
```

The dev server runs over HTTPS with a self-signed certificate
(`@vitejs/plugin-basic-ssl`) because camera access requires a secure context —
open `https://<your-lan-ip>:5173` on your phone and accept the certificate
warning. Set `SNAPFIT_HTTP=1` to serve plain HTTP for localhost automation.

```sh
npm run build    # production build into dist/
npm run preview  # serve the production build
```

The output is fully static; deploy `dist/` to any static host (HTTPS required).
Vercel Web Analytics is injected via `@vercel/analytics`; it only reports when
the app is deployed on Vercel and stays inert elsewhere.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/camera.js` | `getUserMedia` lifecycle, facing flip, physical lens enumeration |
| `src/renderer.js` | WebGL pipeline: filter shaders, fisheye distortion, digital zoom, full-resolution still capture |
| `src/filters.js` | Filter definitions as fragment-shader grading snippets |
| `src/frames.js` | 2D-canvas frame compositors (instax / stamp / film) |
| `src/collage.js` | Multi-shot layouts and compositing |
| `src/recorder.js` | `MediaRecorder` over the filtered canvas stream + microphone audio |
| `src/save.js` | Blob download and Web Share integration |
| `src/main.js` | UI state and event wiring |
