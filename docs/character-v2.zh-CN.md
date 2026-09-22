# 角色第二版：实施与验收边界

日期：2026-09-13。仅修改独立 muxiva-avatar 应用的角色资产构建、展示和动作；没有修改 Muxiva 核心、Agent、Graph、ASR 或生产 TTS。

## 已实施

- 默认 `character.json` 选择 `adult-twintail-v2.vrm`，默认全身取景，黑色长袜和鞋完整可见。第一版 profile 保留为 `character-v1.json`，通过 `/?character=character-v1` 对照。
- 在绑定空间收窄颊部和下颌、微调眼部轮廓；对全部原有面部 morph 同步应用相同变形，保留标准表情与口型绑定。
- 使用内置 image_gen 编辑原 UV 布局，生成并实际嵌入脸部和紫色虹膜贴图；不是用概念图充当可动模型。原始提示词与贴图文件见 [textures/README.md](../assets/avatar/textures/README.md)。
- 重新整理成年体态的胸腰轮廓与衣料过渡、薄贴体开衫、布面领结；修正侧面袖窿内衬衫穿出问题。
- 手指由错误的 Y 轴扇开改为正确的 Z 轴渐进弯曲；静态手掌朝内。说话动作改为带休止段的交替单侧抬掌，不持续双手摆动。
- 当前裙装需要的前臂避让仅存在 v2 profile 的 `restPose`，不将衣服尺寸硬编码进通用动画模块。
- 渲染器增加可配置的短暂视线移动与选定表情微变，使用 VRM 自带 lookAt；不根据音量推测情绪或假装识别音素。

## 验证

- 应用 JavaScript 全量测试 62/62 通过；包括凭据边界、会话回收、音频时间线、动作取消、配置校验、三个真实 VRM 骨架以及 v2 面部 morph/弹簧有限性。
- v2 实际被渲染的 1436 个手部主权重顶点，与真实裙面在休息、抬掌、保持、取消回落和停止后五个状态的采样检查均保持超过 3mm 间距；静态最小约 8.5mm。这不是所有可能姿态的连续碰撞证明。
- 浏览器检查正面全身、近景和侧面；修掉首次预览发现的手部穿裙和袖根白色三角。AMD Radeon / ANGLE D3D11，在最终页面检查中显示约60FPS。
- 真实 qwen-flash 回答经本地 Kokoro 播放：一次短文消费388963个24kHz样本，另一次较长回答消费1319161个样本，结束均显示缓冲0。第三次回答播放中点击停止后，缓冲归0、口型关闭、回到可提问状态；最后结束验收会话。
- 另外通过 `scripts/verify-live.mjs --run` 验证真实文本/本地合成录音→ASR→Agent→TTS→Avatar时间戳一致、有效ASR preview早于final取消、取消后的旧PCM不恢复。该轮传输取消31ms；首次文本5459ms、首次音频8599ms，另一轮ASR final到音频1193ms。这是小样本，不是稳定延迟承诺，也不是物理麦克风测试。报告：[live-model.json](../.artifacts/live-model.json)。
- `sample.vrm` 和第一版VRM SHA256保持不变。构建命令：`node scripts/build-character.mjs --v2`；资产来源与输出SHA见 `adult-twintail-v2.source.json`。
- 默认配置切换后，旧常驻服务仍缓存上一版配置校验器，曾误报 `avatarAvailable:false`；在活动会话为0时仅重启4174服务，最终状态 `modelConfigured/avatarAvailable/speechReady=true`、`activeSessions=0`。切换默认配置后的9项配置/取景定向测试也通过。

## 仍未达到的目标

本版修正了结构和展示问题，但面部雕刻、发丝层次、材质精细度仍低于批准的概念图，不应称为最终美术精修完成。当前仍是基于获准修改的 pixiv 样例制作的程序化衍生资产，不是专业手工重拓扑的完整定制模型。

手势是程序化对话点缀而非语义动作；嘴形仍是实际播放能量驱动的 aa 开合，不是中文音素级对齐。没有做长时间稳定性或所有视角/动作的穿模穷举。

声音问题另见 [中文 TTS 候选研究](tts-candidates-2026-09-13.zh-CN.md)。本轮未更换声音模型，也未提交或 push。
