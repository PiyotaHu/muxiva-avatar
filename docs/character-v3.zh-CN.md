# 银紫第三版：正面展示

定位：明确成年的年轻女性二次元角色。保留可动 VRM，不用静态立绘代替；本轮只调整独立 muxiva-avatar 应用，未改 Muxiva 核心、Graph、Pi Agent、ASR 或 TTS。

## 资源与设计

- `scripts/build-character-v3.mjs` 独立生成 `assets/avatar/adult-twintail-v3.vrm`；sample、v1、v2 保留。
- `scripts/avatar/face-v3.mjs` 局部重塑眼睑、外眼角、眉形、鼻唇和下颌；将原模型 57 个表情目标按端点一致变换。`portraitSmile` 是资源自定义表情，不写入语音或 Agent 节点；不禁止嘴形、眨眼或视线。
- `scripts/avatar/outfit-v3.mjs` 重做收腰、臀部轮廓、较短轻薄褶裙和领口；连续颈胸皮肤壳替代原衣领遮盖部分。裙内有完整不透明里衬，使用标准 VRM spring bone 小幅摆动。
  上胸使用标准 glTF PBR 材质配合柔和顶点色和实际凹面；当前 MToon 实现默认忽略 COLOR_0，因此不能把成功导出顶点色当作渲染已生效。裙褶的可见性主要来自真实折面与材质明暗，不依赖该颜色属性。
- `scripts/avatar/stockings-v3.mjs` 使用同骨架的肤色底层与半透明黑色尼龙层，标准 glTF PBR + COLOR_0 透明度；不是把整条腿直接涂黑，没有角色专用运行时 shader。
- `assets/avatar/textures/hair-fibers-v3.png` 用内置 ImageGen 生成银色细发丝贴图，随后嵌入实际 VRM。完整提示词见同目录 `.prompt.txt`，原始生成图保留在 Codex generated_images 目录。UV 由资产构建器生成。

## 展示与动作边界

应用仅显示正面，可切换全身/近景。取消侧背面 UI 是聚焦展示，并不宣称减少其他机位渲染开销——原本每帧也只渲染一个机位。3D 仍完整保留，避免头摆时显露空洞。

通用 renderer 配置新增 `framePadding`；通用 motion 参数 `headYawAmount`、`headTiltAmount`、`hipSwayAmount` 默认均为 0，不改变旧 profile。第三版通过配置启用缓入、停留、回正的动作。运行时没有按角色名查找特殊骨骼，没有新 turn engine 或独立动作循环。

自定义表情名称在配置中按安全标识符验证，加载资源后再验证其确实存在；不再把 renderer 限制为六种预设心情。实际播放采样仍驱动嘴形，停止回答依旧清除播放与嘴形。

## 构建

```powershell
node scripts/build-character-v3.mjs
node --test tests/*.test.mjs
```

预览：`http://127.0.0.1:4174/?character=character-v3`。

基础骨架与脸部拓扑来源 pixiv Inc. 的 VRM1_Constraint_Twist_Sample；不是从零雕刻的原创商业模型。署名、可修改再分发许可及其他原始许可限制均保留，具体见资源同名 `.source.json`。

代码与几何测试不能代替视觉验收。全身、近景、头摆、手部、裙摆以及真实回答/中断均须在实际页面复核。

## 本机回归记录

2026-09-13：AMD Radeon 集成显卡、D3D11 浏览器实际预览约 60 FPS；这是当前页面观察，不是长时间压力测试。浏览器第一段真实回答消费 258,033 个音频样本；第二段较长回答播放后点击停止，缓冲从非零回到 0，播放采样归零，语音口型停止而配置微笑保留。没有开启或录制用户麦克风。测试会话已结束。

共 90 项 Node 测试通过（包括原始样本/v1/v2 字节不变、实际 57 morph、v3 真实手部到裙面大于 3mm 净空与停止回落）。最终材质与默认配置调整另跑相关 17 项通过。最终资产 SHA-256：`7132c108ff196c7ebafdb50a5998ca03ad161719b2020a7b2cff1505344719e8`。

服务重启后再次执行 `scripts/verify-live.mjs --run`：真实模型两次请求成功，音频与数字人采样时钟对齐；中断传输 31ms，旧 PCM 未重新进入播放；录音样本 ASR preview 在 final 前触发中断。测试输入是文字和本地生成的录音，不是用户物理麦克风。完整本机记录位于 `.artifacts/live-model.json`；上述单次测量不代表持续延迟保证。
