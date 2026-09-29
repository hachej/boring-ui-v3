# Image viewer

The image-viewer item over `useImage`: PNG, JPEG, WebP, GIF, SVG with wheel zoom, drag pan, fit, actual size and temporary highlights. Laws: VIEWERS-1, VIEWERS-3, UI-BOUNDARY-1.

## Sub-features

- zoom (`image_zoom` level or factor, 5%–3200%), pan (`image_pan` by dx/dy or centred on an image pixel), fit (`image_fit`), all `applied`.
- highlight (`image_annotate`, image pixels, a few seconds, optional label); refused outside the image.
- describe (`image_describe`): path, type, revision, natural size, zoom, pan: metadata only, never pixels.
- sources: SVG from its text; a raster stored as a `data:image/...;base64,` file as is; other raster files need the host's `source(address, revision)`.

## How to get to it (user POV)

Open `/workspace/images/diagram.svg` or `swatch.png` in the tree; scroll to zoom, drag to pan; ask "zoom the image".

## Driving it with boring

```bash
node bin/boring.mjs env up --example registry-host && node bin/boring.mjs thread --from-page
node bin/boring.mjs send "open /workspace/images/diagram.svg" --wait
node bin/boring.mjs send "zoom the image" --wait                   # describe → zoom 2 → annotate
node bin/boring.mjs wait-for "[data-boring=annotation]" && node bin/boring.mjs eval "document.querySelector('[data-boring=zoom]').textContent"   # "200%"
```

Observed: the reply `The image is 480×260 (image/svg+xml); I zoomed to 200% and highlighted its centre.`; the highlight disappears after about four seconds.

## Gotchas

- `pan` to an image pixel needs the image decoded (the natural size); right after opening it can answer `denied`.
- While fitting, the zoom follows the viewport; any explicit zoom leaves fit mode.
