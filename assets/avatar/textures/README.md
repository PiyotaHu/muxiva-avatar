# V2 production textures

Generated on 2026-09-13 using the built-in `image_gen` tool, editing the extracted face / iris UV maps from the licensed `sample.vrm`. The original model is retained unchanged. These PNGs are embedded in `adult-twintail-v2.vrm` by `sculptFace`; they are actual runtime textures, not concept-image placeholders. The base rig and original atlas layout are credited to pixiv Inc.; see `../adult-twintail-v2.source.json` for inherited permissions.

## Face — face-v2.png

Use case: precise-object-edit. Asset type: production facial skin base-color UV texture for a rigged adult anime woman, NOT an illustration or a portrait. Image 1 is the existing 1024x1024 UV face atlas to edit. Preserve the exact UV layout, all boundaries, ear islands in the upper corners and lower corners, two eye socket placeholders at their exact original positions, nose mark and the mouth line at their exact original positions. Keep the whole canvas square with NO text or labels. Improve only the painted skin/makeup: delicate elegant adult anime makeup, subtle peach-rose blush beneath the outer eye sockets, softly shaded lids around the holes, a very subtle mauve lash-line shadow, a small natural rose-tinted mouth with a subtle lower-lip glint centered exactly at the existing mouth line. Refined soft warm fair skin. This is a 3D texture, so keep lighting very diffuse and neutral, no cast shadows, no hair, no eyebrows, no actual eyes or pupils, no new facial features. Leave eye socket interiors untouched. Do not draw a face outline or shrink/rearrange the UV islands. The overall skin color must stay extremely close to the input to match the existing neck texture. Improve finesse without exaggerated blush or heavy cosmetics.

## Iris — iris-v2.png

Use case: precise-object-edit. Asset type: actual anime iris UV texture map for a 3D adult woman. Edit the attached brown iris atlas. Preserve the canvas aspect ratio exactly 2:1 and preserve the two iris ellipse locations, sizes, silhouettes, and pupil centers exactly. Two matching beautiful detailed lavender-violet irises, darker indigo outer limbal ring, rich radial brushlike iris fibers, deep plum-black pupil, jewel-like restrained layered specular highlights, brighter lilac lower iris gradation. Professional hand-painted anime game eye texture. Replace all brown pigmentation with elegant violet, dark purple and lilac. Preserve the existing atlas arrangement and dark/transparent outer background exactly; absolutely no face, no skin, no eyelids, no eyelashes, no head, no body, no decorations or text. This is a technical texture atlas, not an illustration of eyes in a face. Use soft natural catchlights, not stars or heart-shaped pupils. Keep the original UV alignment.

## Rebuild

Run `node scripts/build-character.mjs --v2` from the app directory. V1 is retained as a review baseline and is never overwritten by this command. Image generation is not part of rebuild, so the approved saved PNG bytes are reused.
