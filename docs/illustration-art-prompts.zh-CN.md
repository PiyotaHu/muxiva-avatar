# 正面立绘的生成提示词与来源

2026-09-14。使用 Codex 内置 imagegen，未使用外部 CLI/API，不在运行时调用生图。

用户提供的两张概念参考保存在 `assets/avatar/concepts/reference-v4-full.png` 和 `reference-v4-skirt.png`。参考为明确成年女性角色。基础生成图再作为三个生产状态的编辑目标，三张 PNG 分别保存为 `assets/avatar/illustration-{neutral,blink,speaking}-v1.png`，均为 1024 × 1536。

透明背景的两次尝试仍把棋盘画进 RGB，已弃用，未接入应用。最终采用纯白背景，并与展示区白色底色配合；这些资产**不是透明 PNG**。渲染器兼容未来带真实 alpha 的资产，但当前不声称已经得到透明分层。五官与画风尽量贴参考，不声称逐像素复刻。生成图的身体差异不会因眨眼/说话整帧切换而闪动：运行时只采样小范围眼睛和口部区域。

## 基础生成（用户两张图为视觉参考）

```text
Use case: identity-preserve.
Asset type: final production front-facing 2.5D animated-character base illustration, NOT a concept sheet and NOT a 3D render.
Input Image 1: the approved adult woman's EXACT FACE IDENTITY, hair, outfit style, painterly anime rendering and material reference. Input Image 2: strict FRONT SKIRT SILHOUETTE and full-leg stocking reference.
Draw the SAME adult woman (approximately 23 years old) as Image 1, preserving her refined facial features, fine almond eyes with warm gray-violet irises, small delicate nose, soft natural chin, tiny confident warm smile, silver-lavender long wavy twin tails and charcoal fabric ribbons. Do not redesign her identity or simplify her face into a generic doll. Mouth gently closed at rest with natural rising corners, eyes open looking at camera.
Pose and framing: single full body, directly front facing, standing upright with a relaxed natural stance and feet slightly apart, no crossed legs. Head nearly level with just a subtle friendly tilt. Both arms relaxed beside body, hands slightly separated from skirt so each hand and its five fingers has a clear silhouette. Do NOT use a rigid T-pose. Entire top of hair, ribbons, fingertips, stocking-clad legs and both shoes visible with 5% clear margin around them. Character centered, portrait 2:3 composition.
Clothing precisely as references: white/ivory pointed-collar buttoned blouse with soft fabric folds and natural covered bust shape, small wine-purple ribbon at center collar, charcoal cropped cardigan with gently loose sleeves and small brass buttons. Naturally narrow waist, NOT tiny wasp waist, NOT exaggerated breasts or hips. The skirt must match Image 2: high-waisted charcoal-black A-line pleated short skirt, restrained near-straight outward drape from waistband to hem, fine vertical pleat folds, lightly curved hem and TWO small brass buckles at one side of waist. No balloon/bell skirt, no rigid cone, no ruffled petticoat, no low scoop neckline or cleavage redesign.
Stockings: precisely the softly translucent black nylon of reference2, skin subtly visible through fabric, natural dark-to-warm sheen along legs, no opaque painted-black legs. Black leather loafers with small brass hardware.
Rendering: match Image 1's polished painted anime illustration, delicate confident linework, detailed soft shading and subtle warm-gray light. Clear face and hands, silky flowing hair as broad natural wavy locks, NOT wire noodles. No photoreal skin, no cartoon plastic 3D.
Background: actual transparent alpha background; no environment, no cast floor shadow, no gradient rectangle, no checkerboard printed into pixels, no oval platform. Only the complete cut-out character.
Absolutely no text, no labels, no sheet panels, no extra objects, no extra people.
```

## 生产中性帧

```text
Use case: precise-object-edit. Edit target: attached full-body adult anime character. Preserve EXACTLY the same character identity, five facial features, geometry, placement, scale, full body composition, pose, clothes, colors, and all detailed painted linework, using the identical 1024x1536 canvas. This is one registered animation frame, not a new design. Replace the entire painted checkerboard behind her with completely uniform pure white #FFFFFF, including every gap between hair curls, arms, torso, and legs. No checkerboard, no shadows on the background, no vignette or gradients, no text. Keep the entire character precisely registered to the input. Change nothing else. Keep both eyes open and the original closed-mouth small warm smile.
```

## 生产眨眼帧

```text
Use case: precise-object-edit. Edit target: attached full-body adult anime character. Preserve EXACTLY the same character identity, five facial features, geometry, placement, scale, full body composition, pose, clothes, colors, and all detailed painted linework, using the identical 1024x1536 canvas. This is one registered animation frame, not a new design. Replace the entire painted checkerboard behind her with completely uniform pure white #FFFFFF, including every gap between hair curls, arms, torso, and legs. No checkerboard, no shadows on the background, no vignette or gradients, no text. Keep the entire character precisely registered to the input. The ONLY character edit is BOTH EYELIDS CLOSED in a natural gentle blink. Eyelash edges curve gently, relaxed and not squeezed into angry or happy wedges. Same eyes position and eyebrow position; keep nose, cheeks, closed-mouth smile, chin, hair, body and clothing UNCHANGED. Do not move the face or head.
```

## 生产说话帧

```text
Use case: precise-object-edit. Edit target: attached full-body adult anime character. Preserve EXACTLY the same character identity, five facial features, geometry, placement, scale, full body composition, pose, clothes, colors, and all detailed painted linework, using the identical 1024x1536 canvas. This is one registered animation frame, not a new design. Replace the entire painted checkerboard behind her with completely uniform pure white #FFFFFF, including every gap between hair curls, arms, torso, and legs. No checkerboard, no shadows on the background, no vignette or gradients, no text. Keep the entire character precisely registered to the input. The ONLY character edit is opening her mouth moderately for a natural speaking 'ah', small softly open friendly anime mouth with a subtle upper-teeth sliver and warm tongue, not a giant oval or black hole. Use original mouth center. Lips open just a little vertically, unchanged width and smiling corners; keep both eyes open exactly like input and all nose, cheeks, chin, hair, body and clothing UNCHANGED. Do not move the face or head.
```
