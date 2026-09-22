# 自制角色候选 v3：表情与有限正面曲面

日期：2026-09-14。状态：候选预览，不是世界一流成品验收。

## 用户决策

个人本地使用、开源展示；角色由本项目自制，不采购、不委托外包。
此前将专业资产或 Live2D SDK 作为继续制作的前提不准确。本轮从现有渲染器与用户认可的角色继续制作。
不将“采用 SDK”当作品质保证，也不将有限正面变形描述为完整 3D 或 Live2D。

## 本轮具体改动

- 内置 image_gen 编辑原中性图，生成对齐的微笑候选：`assets/avatar/illustration-smile-v3.png`，1024 × 1536。原素材不覆盖。
- 可选 `images.smile`：只将新纹理混合到头部的脸/眼/唇区域，不替换衣服、身体、头发、轮廓或 alpha。眨眼覆盖笑眼；开口仍由真正播放的 PCM 驱动。
- 可选 `rig.headRelief`：0–1，默认没有则维持旧版。候选为 0.7；48 × 48 头部网格加入浅脸盘/鼻梁深度，仅改 z，原 x/y/UV 保持。沿用原姿态，不新增控制器、Agent 实体或播放时钟。
- 只支持有限正面视差（最大 yaw ±12° / pitch ±8°），没有补绘侧脸、后脑或真实光照。
- v2 默认角色保持；新候选为 `character-illustration-v3.json`。单一参数或美术变化都可以单独回退。

预览：[真实语聊候选](http://127.0.0.1:4174/?character=character-illustration-v3)。
验收：[本地姿态实验页](http://127.0.0.1:4174/illustration-lab.html?character=character-illustration-v3)，不连接 Agent、不启用麦克风。

## 美术来源与生成记录

工具：Codex 内置 image_gen。
输入：项目已有、用户认可的 `assets/avatar/illustration-neutral-v1.png`。
原始输出：`C:/Users/qq/.codex/generated_images/01a036a4-24fd-78a1-aa18-ac8a60748bd7/exec-7b4c8238-8149-4dd3-a180-79a3bcaae4be.png`。
项目副本 SHA-256：`5b7c897f18aa4d2a8d475a4be06f52661601202add95e4cdfb35f3bec2db5712`。
项目副本保留原尺寸；未用脚本改画。
没有使用真人肖像、真人声音或冒充真人身份。

### 实际生成提示词

```text
Use case: identity-preserve. Asset type: an aligned facial-expression texture for an original realtime animated character. Image 1 is the EDIT TARGET, the existing full-body neutral illustration of an adult woman (age 25). Create exactly one same-size, same-framing 1024x1536 portrait image. Change ONLY the expression inside her face: a noticeably warmer, sincere and luminous friendly smile, slightly smiling eyes with relaxed upper lids and delicate lower-lid lift, pupils still clearly visible, subtly lifted cheeks, a softly curved closed-mouth smile. Keep this woman recognizable: same narrow jaw, violet eyes, silver-lilac hair, black ribbons, art style, linework and lighting. ABSOLUTELY preserve the rest of the image: head position and tilt, iris centres as nearly as possible, nose position, hairstyle, body, hands, clothes, skirt, stockings, shoes, silhouette, pose, canvas and white background unchanged. This will be blended locally into an existing animation, so do not move or scale the face or change the drawing outside the eyes/cheeks/lips. No new accessories, no blush symbols, no hearts, no text, no labels, no watermark. Not a concept sheet; a single precisely aligned expression variant. This is an adult fictional character, not a minor.
```

## 验收与限制

浏览器检查了候选全身、近景、左右视线/转头、招手定格；未见明显脸部破图，短时显示约 60 FPS。
姿态实验页的 FPS 和定格不代表长时间性能，也不是审美品质的证明。
纯几何测试检查原坐标和 UV 不变、颈部固定、鼻/脸缘相对视差，以及最大角度下三角形不翻转。
真实浏览器的本地固定回复夹具配合 Matcha 播放检查通过：口型峰值 0.97、停止后归零，微笑/手势可与说话并存；测试页的 error 级控制台记录为空。此测试不代表真实大模型情感或长期互动品质。详细测量口径见 [Matcha 接入](matcha-local-integration.zh-CN.md)。
`setExpression('portraitSmile', weight)` 对有微笑纹理的候选生效；旧素材仍保持原有行为。原 v2 默认不变，新候选入口已加入既有安全名称清单，没有开放任意远程图片或路径。
手仍为旧的有限关节平面绑定，尚无精细独立手指/替换手型；微笑只有一个新增状态，未完成关切、思考、轻惊讶的多表情绑定。
下一步应制作可检查的多表情与放松/欢迎手型，并逐项实机验收，而不是增加随机摇摆。

## 开源展示边界

代码、素材、模型分别记录来源与使用限制；本轮没有发布、上传、提交或 push。
AI 辅助自制不是对素材权利的无条件保证，发布时仍保留生成来源并检查所用参考资料。
Matcha Baker 的官方页面说明训练数据限非商业用途；个人非商用展示不能外推为商用授权，也不意味着权重可以不附限制地再分发。见 [官方说明](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/matcha.html#matcha-icefall-zh-baker-chinese-1-female-speaker)。
