# 正面可动立绘 v1：2.5D 展示与语音同步

日期：2026-09-14。本版优先贴近用户参考图的正面画风，采用本地三张立绘与有限 GPU 变形，**不是 Live2D 完整绑定模型，也不是真 3D**。它替换的是应用前端的展示方式，不是 Agent 或语音链路。

## 使用与当前状态

启动本机应用后，打开 [本机语聊页面](http://127.0.0.1:4174/)，默认显示“银紫 · 可动立绘”。[指定版本预览](http://127.0.0.1:4174/?character=character-illustration-v1) 也仍可使用；它是同一个应用、同一条真实 Graph，不是另起一个聊天循环。预览参数只接受已配置的角色名称，不接受任意远程模型地址。

默认角色由 [character.json](../assets/avatar/character.json) 指定，现已正式切换为 [character-illustration-v1.json](../assets/avatar/character-illustration-v1.json) 对应的 2.5D 版本。服务重启后，不带预览参数的新页面已实际显示该角色。原 VRM 各版与官方样例保留，默认切换未覆盖或删除它们。

“全身 / 中近景”只调整正面取景；中近景允许裁掉发梢或下半身。此资产没有侧脸或背面数据，不提供伪装成真 3D 的侧面旋转。“更换本地 VRM”仍可使用，文件只在本机浏览器读取；完整加载成功才更换当前画布，失败保留原角色并显示错误。

## 资产与配置

- [character-illustration-v1.json](../assets/avatar/character-illustration-v1.json)：角色名称、署名、版本、renderer 类型、取景与动作强度；asset 指向下列 manifest。
- [illustration-v1.json](../assets/avatar/illustration-v1.json)：三图地址、画布尺寸与局部变形区域。
- [illustration-neutral-v1.png](../assets/avatar/illustration-neutral-v1.png)：中性表情和完整角色基础图。
- [illustration-blink-v1.png](../assets/avatar/illustration-blink-v1.png)：闭眼状态，运行时只使用眼部局部。
- [illustration-speaking-v1.png](../assets/avatar/illustration-speaking-v1.png)：开口状态，运行时只使用嘴部局部。

三张生产图片均为 **1024 × 1536、纯白不透明背景**，与展示区白底配合。透明背景尝试把棋盘绘进了 RGB，已弃用、未接入；当前 PNG 不是透明抠图，也不是分层绘画工程。生成过程与完整提示词见 [illustration-art-prompts.zh-CN.md](illustration-art-prompts.zh-CN.md)。参考来自用户提供的成年人物概念图，不声称逐像素复刻或完成全部美术精修。

manifest 的 schemaVersion 为 1、kind 为 illustration。rig 坐标统一采用左上角为原点的归一化坐标：center 是中心，radius 是水平/垂直半径，pivot 是旋转锚点。head、双手、hair、skirt、双眼、mouth 及 bodyPivot 都来自配置，渲染器不识别角色姓名，也不根据文件名硬编码人体位置。

[illustration-config.mjs](../web/illustration-config.mjs) 检查必需字段、未知字段、有限数值、非零区域和画布边界，眼口范围必须位于头部范围内；返回独立副本。图片只允许本应用 /assets/avatar/ 下安全 PNG 文件名，拒绝外链、编码、查询参数和路径跳转。manifest 的像素尺寸必须为 16–4096 的整数，渲染器还会校验三张解码图片尺寸一致及 GPU 纹理上限。

修改动作位置时应调整 manifest；修改此角色的强度、取景时应调整角色配置。不要把此角色的坐标、服装或名称放入 Muxiva core、Agent 或公共语音 Node。

## 与现有链路的关系

语音和动画仍从同一份 TTS PCM 分支：

```text
本地 TTS PCM
  ├─ 本地媒体输出 → 浏览器 AudioWorklet → 实际已消费样本位置
  └─ avatar.animation Node → 动画事件 → 既有 AvatarTimeline
                                           ↑
                         用已消费样本位置采样口型
                                           ↓
                    IllustrationRenderer → 局部眼嘴合成 / 有限变形
```

[avatar.animation](../.muxiva/nodes/avatar_animation/node.py) 仍是独立的标准 Node，将 PCM 按约 20ms 窗口转换为能量嘴形事件，保留源采样位置与流/序号。它不知道图片、衣服或前端采用 VRM 还是立绘。媒体传输和打断仍沿用原 Graph，未新增 Agent loop、Turn Engine 或数字人专用会话语义。

[IllustrationRenderer](../web/illustration.mjs) 是应用前端适配器，复用 [AvatarTimeline](../web/avatar-timeline.mjs)，由应用已有渲染循环更新。嘴形跟随 AudioWorklet 实际消费的样本位置，而不是收到回复文本、网络包或 TTS 推理结束的时间。动画积压不会反过来阻塞声音；没有对应播放样本时嘴部收闭。

[IllustrationMotion](../web/illustration-motion.mjs) 只提供有界的姿态偏移：轻微头摆/侧倾、呼吸、偶发单侧手部动作，以及头发和裙摆的轻微变形。它不理解回答内容、不调用模型，也不决定何时打断。停止播放时嘴部关闭，手部动作平滑回到休止；取消沿用 streamId/sequence 水位，旧音频或迟到事件不应重新启动已取消的说话状态。

GPU 使用同一张细分平面采样三张图：中性图保持身体底图，blink 仅在双眼 mask 内混合，speaking 仅在嘴部 mask 内混合。三个状态共享同一次形变，不整帧切换身体或服装，避免生图状态之间的身体细节差异造成整个人闪变。

## 效果边界

- 只有正面图像：头摆是小幅二维形变，不能生成真实侧脸、背面、深度遮挡或绕到人物身后。
- 不是 Live2D Cubism 工程：没有完整分层、手工绑定、多角度五官或可交换的 Live2D 动作文件。
- 手指沿用绘画细节，没有逐指骨骼；手势不能被描述成精确抓握。头发和裙摆是受限的局部形变，不是布料/毛发物理模拟。
- 只有中性、闭眼、开口三种图像来源，无法任意合成表情；兼容的 expression 接口也不代表已制作整套表情资产。
- 嘴形是能量驱动的开合与混合，不是中文音素级口型、唇读或表情语义识别。
- 当前白底会限制深色背景或复杂背景合成；要获得真正透明的任意场景展示，需要另行制作干净 alpha 和更可靠的分层。
- 有限变形仍可能拉伸袖口、头发边缘等局部细节；视觉相似度和动作自然度仍需要用户确认，不能用单元测试代替。

## 语音模型没有随形象切换

生产 TTS 仍是原来的 **Kokoro FP32**；本轮 2.5D 不修改 TTS、音色或生成分句配置。

Qwen3-TTS 仅完成模型下载、文件校验、独立环境安装与依赖检查。按用户要求，目前**不加载模型、不运行推理/试听/测速，也不切换生产 TTS**；没有本机 Qwen 首音或实时率成绩。准备状态和后续授权边界见 [qwen-tts-local-setup.zh-CN.md](qwen-tts-local-setup.zh-CN.md)。

## 验收结果

以下为 2026-09-14 本机验收结果；这是短时、小样本验证，不是长时高可用认证：

- 默认正式切换为 illustration v1，服务安全重启，验收时 PID 为 26964；新打开、不带 query 的 4174 页面实际显示“银紫 · 可动立绘”。
- 应用 JavaScript 全套 **165/165 通过，0 跳过，耗时 63.16 秒**，覆盖配置安全、取消水位、迟到资源释放、同尺寸校验、独立预览、VRM 导入失败保留旧角色及正面取景等行为。
- doctor 检查项全部为 true；验收时服务 stderr 为 0 字节、activeSessions 为 0，没有遗留测试会话。这是检查时状态，不是未来不会故障的保证。
- 浏览器实际 WebGL shader 渲染约 **60 FPS**，截图已观察到自然闭眼/睁眼；属于当前电脑与当前窗口的短时表现，不代表所有设备。
- 最后仅调整小窗口展示区的响应式高度；在 **1265 × 707** 的浏览器窗口实测默认全身取景，头发至鞋均完整位于首屏。中近景仍可单独选择；此次 CSS 调整没有再修改 JavaScript。
- 两次真实文本输入均经过 **Pi Agent → Kokoro → 浏览器播放**，没有用固定回复夹具替代回答模型。第二次已播放 **282168 个样本**，收到 **297 个动画事件**，实际 GPU mouthOpen 峰值 **0.99**，播放结束后口型为 **0**。mouthOpen 是归一化开合权重，不是音素匹配准确率。
- 第一次在播放中执行停止，停止后播放缓冲为 **0**，播放位置样本计数复位为 **0**；不将这两个数字解释为已测得扬声器的声学停止延迟。
- 本轮没有重新测试实体麦克风 ASR；用户麦克风/AEC、外放回声、长时间多轮稳定性、声学停止延迟和模型回答质量仍需独立验收。能量口型联动已验证，不声称中文音素级同步。
- Qwen 下载与隔离环境准备已完成，但始终未加载或运行模型、未试听/测速、未替换生产；本轮真实播放使用的仍是 Kokoro FP32。

回归命令：

```powershell
node --test tests/illustration-*.test.mjs tests/character-config.test.mjs tests/character-import.test.mjs tests/avatar-timeline.test.mjs
node --test tests/*.test.mjs
```

真实模型端到端验收仍使用 README 所列的 verify-live 脚本，会使用已配置服务的 API 额度；固定回复夹具与真实模型测试必须明确区分。本说明不授权自动运行真实模型、启用用户麦克风或恢复 Qwen 试验。
