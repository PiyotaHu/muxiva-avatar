# 分层立绘 v2 美术提示词与来源

使用内置 image_gen 工具，不使用 CLI/API 密钥。所有输入均为本项目已有立绘；角色是成年女性。保留 v1 原始文件，下面两份新素材是可替换的应用本地资源。未承诺逐像素复刻或世界一流美术认证。

## atlas

中间稿，棋盘绘入RGB，未接入。

生成原稿：[exec-bc5af852-79be-41fa-a73c-2592243d1c93.png](C:/Users/qq/.codex/generated_images/01a036a4-24fd-78a1-aa18-ac8a60748bd7/exec-bc5af852-79be-41fa-a73c-2592243d1c93.png)

```text
Use case: identity-preserve, production animation texture atlas.
Input image 1 is the exact character identity and costume reference, not a new design.
Create ONE high-resolution animation sprite atlas for this same clearly adult anime woman (age 25). It will be assembled in a front-facing 2.5D digital assistant. Preserve her sophisticated friendly face, lilac-silver hair, purple eyes, fine painted anime shading, ivory buttoned blouse with burgundy ribbon, charcoal cropped jacket, pleated skirt, semi-sheer black tights, black gold-buckle loafers. Modest fashion, no new cleavage or exposure. Make both thighs and calves just 6% slimmer than reference, keeping natural knees, lengths and shoes unchanged.
Output a square 3072x3072 PNG atlas with actual transparent background (alpha), no drawn checkerboard, no shadow or ground, no text, no labels, no visible grid. Exactly a 3 by 3 grid of equal square cells. Each part centered in its own cell, clear generous transparent margins, no part touching another cell. This is a digital paper-doll rig of non-gory illustrated sprite components, NOT a full-character illustration.
Cell row1 col1: head only, including exact same face, bangs, short face-framing locks, dark bows at roots, ears and short complete neck extending below chin. Eyes open, small friendly closed-mouth smile. NO long ponytails, no torso. Copy facial identity.
row1 col2: complete FRONT TORSO ONLY, neck opening to waistband, ivory blouse/bow plus charcoal jacket shoulder caps, NO HEAD, NO ARMS, NO SKIRT. Fill hidden cloth under the arms and hair cleanly, shoulder caps rounded for hidden overlap.
row1 col3: complete charcoal pleated SKIRT ONLY with same double gold buckle waistband, hem gently curved, front view. Preserve restrained short skirt length and delicate pleats; don't exaggerate flare. No torso or legs.
row2 col1: COMPLETE SCREEN-LEFT ARM from rounded shoulder cap, sleeve, cuff to relaxed hand, in original hanging pose, slightly away from body. Natural five fingers. NO torso or hair.
row2 col2: COMPLETE SCREEN-RIGHT ARM from rounded shoulder cap to sleeve/cuff/relaxed hand, original pose. Natural five fingers. NO torso or hair.
row2 col3: BOTH LEGS TOGETHER ONLY from modestly hidden under-skirt upper-thigh region through shoes, side by side matching exact reference pose, each thigh and calf about 6% slimmer. Black semi-sheer tights and complete black gold-buckle loafers. No skirt, no pelvis, no torso; stocking-covered upper ends simple rounded and will be hidden behind skirt.
row3 col1: SCREEN-LEFT LONG CURLY PONYTAIL ONLY, complete continuous lilac strands from bow attachment through curled tip. NO face, body or arm. Reconstruct strands that were hidden by shoulder; original color and detailed strands.
row3 col2: SCREEN-RIGHT LONG CURLY PONYTAIL ONLY, complete continuous lilac strands from bow attachment through curled tip. NO face, body or arm. Reconstruct hidden hair; original color and detailed strands.
row3 col3: leave completely transparent and empty.
Keep all 8 components visually coherent and high quality, accurate material texture and original outline. All components face camera and preserve original neutral orientation; don't invent side/back views. No duplicate full person anywhere. Real clean alpha around every component, preserve white blouse as opaque white.
```

## matte

复制为 assets/avatar/illustration-parts-v2.png；RGB绿幕，运行时显式色键合成。

生成原稿：[exec-36d268d5-47c3-4fb5-83e8-bbf0777e94b4.png](C:/Users/qq/.codex/generated_images/01a036a4-24fd-78a1-aa18-ac8a60748bd7/exec-36d268d5-47c3-4fb5-83e8-bbf0777e94b4.png)

```text
Use case: background replacement only. Image 1 is the exact edit target, an 8-part anime digital puppet texture atlas. Preserve EVERY existing illustrated character component exactly: face and facial proportions, painted hair, blouse, clothing, hands, legs, shoes, outline placement, same 3x3 layout and same canvas framing. Do not redraw, resize, move, delete or add parts. Change ONLY the gray-and-white checkerboard outside every component, including checkerboard visible between hair strands and fingers, into one perfectly uniform opaque bright pure chroma green RGB(0,255,0), hex #00FF00. This green is a technical compositing matte, not an environment. No green lighting, reflection, tint or spill on the subject. Keep the white blouse, white hair highlights and pale skin opaque and unchanged. No checkerboard at all. No shadow, no text, no labels, no grid lines. Export a regular PNG with solid pure green matte, not simulated transparency. This is a technical image cleanup for non-gory illustrated animation sprites, not a different artwork. Preserve all 8 objects and the empty bottom-right cell.
```

## eye-white

复制为 assets/avatar/illustration-eye-white-v2.png；只采样眼部，绝不直接整帧展示。

生成原稿：[exec-71d5febf-a463-4eee-9186-68d52ac9ccee.png](C:/Users/qq/.codex/generated_images/01a036a4-24fd-78a1-aa18-ac8a60748bd7/exec-71d5febf-a463-4eee-9186-68d52ac9ccee.png)

```text
Use case: precise-object-edit for an animation sprite. Input image is the exact edit target. Keep the entire 1024x1536 illustration, composition, adult character identity, face shape, eyelids, eyelashes, eyebrows, hair, nose, mouth, clothes, legs, background EXACTLY unchanged. Change ONLY the inside of the two open eyes: remove the purple irises and black pupils and their specular highlights, replacing just that interior with continuous softly shaded ivory-white sclera. Retain both exact original eye-opening outlines and eyelashes. This is a technical eye-white underlayer; separate iris sprites will be overlaid by animation software, not a new expression. No repositioning, no closed eyes, no additional eyes, no restyling, no text. Keep everything outside the eye interiors pixel-aligned with the input.
```

## 最终工程资源

- [分层 atlas](D:/workspace/muxiva-avatar/assets/avatar/illustration-parts-v2.png)
- [眼白底图](D:/workspace/muxiva-avatar/assets/avatar/illustration-eye-white-v2.png)
- [图层登记与绑定](D:/workspace/muxiva-avatar/assets/avatar/illustration-v2.json)

atlas 的裁切和回填位置、支点、父子关系由 manifest 管理；运行时不保存修改过的像素图。腿部细化在生成的新素材中完成，目标为轻微约 6% 的视觉收细，不把生图结果冒充精确几何测量。原眼睛/嘴部来源仍为 v1 同源图片，通过新眼白底图和小虹膜区域分开合成。
