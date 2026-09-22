# 成年双马尾角色：概念 v1

日期：2026-09-13。由内置 image_gen 生成；原始生成图保留，项目副本为 adult-twintail-v1.png。

## 用途与边界

这是供用户确认美术方向的二维设计参考，不是 VRM、不是已绑定模型，也没有替换 sample.vrm。
设计方向：约24岁成年女性，银紫双马尾、纤细成熟比例、学院风日常时装、温柔俏皮、略带成熟魅力。图中的发型、衣服与比例尚需3D造型确认。

正式资产交付需要：统一正侧背参考；面部和衣发网格及贴图；标准VRM humanoid（含手指）绑定；嘴形/表情blendshapes；双马尾SpringBone与身体碰撞体；动作下衣袖/手臂/头发穿模检查；VRM导出与运行验收。不要用贴在平面上的本图冒充完成的3D人物。

当前通用动作代码与角色资产分离：标准VRM骨骼驱动留在浏览器渲染模块；PCM嘴形时间轴仍由独立Avatar Node及真实播放采样时钟提供。角色设计、外观和动作参数不进入Muxiva核心或Pi Agent主循环。

## 最终生成提示词（内置工具）

```text
Use case: stylized-concept.
Asset type: original character concept sheet to guide a future rigged VRM 3D conversational avatar. Create a NEW design, not a screenshot edit and not a UI mockup.
Primary request: a very cute yet subtly alluring adult anime woman, unmistakably around 24 years old, slim elegant adult proportions, long flowing twin ponytails, lively intelligent eyes, approachable playful confidence. A refined adult fashion / academy-inspired outfit, NOT a child or a school student. Long smoky lavender-silver twin ponytails with understated dark ribbon ties, polished soft anime cel shading. Tasteful fitted ivory blouse, slim charcoal cropped cardigan worn neatly with an open collar showing only the collarbones, a muted plum neck ribbon, a dark pleated skirt ending above the knees, opaque dark stockings and simple low-heeled shoes. Fully opaque, fully clothed, no exposed underwear, no cleavage emphasis.
Scene/backdrop: clean warm light-grey studio background with ample clear margins, no scene clutter.
Composition/framing: one professional landscape character-design sheet of the SAME adult character: a dominant attractive full-body three-quarter hero view with a warm smile, relaxed natural contrapposto and one small friendly open-hand greeting; a smaller straight-on neutral full-body front view; a smaller neutral full-body rear view showing ponytail attachment and the consistent outfit; a small expressive close-up of the same adult face. Each figure fully visible including hands and shoes, no overlap. Clear shape language usable by a 3D modeler, natural five-finger hands. Outfit and anatomy consistent in every view.
Style/medium: sophisticated high-quality anime illustration, clean fine linework, soft cel-shaded volumes, subtle detailed fabric and hair, attractive adult VTuber design, expressive but not childish. Eye-level camera, balanced soft studio lighting. Emphasize warmth, charm and personality over doll-like blankness.
Constraints: Original design, adult age visible in proportions and styling; no existing franchise character, no logos, no watermarks, no UI, no written labels, no nudity, no sexual act, no fetish costume, no childlike/chibi proportions. This is a 2D concept sheet, not a claim of a finished 3D asset.
```
