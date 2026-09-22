# 首轮实施与实机验收记录
日期：2026-09-13。目录：D:\workspace\muxiva-avatar。

## 已落地
独立应用Graph串联浏览器麦克风/文本、local_speech、现有VoiceTurnController、通用Pi Agent、已有SpeechFormatter、local_tts、独立avatar.animation和本地媒体节点。未新增Agent循环/Turn Engine。角色和业务配置不进入Muxiva骨架。

本地VAD/ASR/TTS模型已下载、SHA256锁定并使用隔离Python环境；默认TTS最终选择Kokoro FP32，4线程、中文女声3。Melo、int8仅为可切换对照。

## 验收证据
- 初次应用自动测试42项通过：20项JavaScript（播放/角色/Pi/服务器）、6项语音单测、15项Avatar Node、1项真实Python Host Avatar协议；接入真实模型后另补凭据隔离与脱敏测试。
- 通用核心：Studio34项、CLI契约12项通过；新debug Windows CLI构建成功。
- 真实Graph端到端：仅LLM替换为明确标识的本地HTTP固定回复夹具；其余均真实Muxiva、Pi SDK和本地模型。
  - 输入文本→Pi→TTS→媒体输出→Avatar事件一致。
  - 真实合成录音以16k/40ms实时输入ASR，回读“你好，我是你的数字人助手，很高兴认识你。”。
  - 同段preview/final标识一致，有效preview触发的取消早于final；两次输入只产生两次Pi请求，保留会话历史。
  - 取消后的旧PCM未恢复。
- 较长回答检查：连续25.14秒、633个PCM包无缺口/重复；发送节奏跟随播放时长而非一次塞满；传输端取消通知62ms。不是实际扬声器声学停止延迟，也不是两小时稳定性认证。
- 浏览器实测：ANGLE/AMD Radeon/D3D11硬件渲染，官方VRM样例约59–60 FPS；一次回答播放71548采样（24kHz），播放后缓冲回零。未启用用户真实麦克风（仍需用户授权/实测），ASR测试输入为本地生成录音。
- TTS独立真实Host基准：Kokoro FP32 RTF0.51–0.56，三句首PCM408–1450ms；不同句长不可一概而论。int8 RTF1.36–1.42，因此没有作为默认。单节点推理取消ACK0.30ms，旧音频0块。
- 首次冷启动Graph文本→第一PCM在测试夹具下约3.31秒；较长文本约4.67秒。它包含初始化/分段/推理/媒体环节，**不是云端真实大模型端到端时延**，不以单节点361ms预热成绩替代。

## 修复所在层
Muxiva核心仅改3文件：node_library.rs、typescript_host.mjs、docs/nodes/python.md。
修复语言Host取消回调输出/Signal payload、媒体timestamp/stream/trace/clock域透传、Source显式Signal sequence，以及Windows管道UTF-8 strict。没有角色/语音人格/天气/新闻等内容进入核心。

应用媒体层处理有界队列、音频节奏和优先取消；播放端只用AudioWorklet消费样本推进口型。渲染支路可丢旧帧而不阻塞音频，Avatar使用源PCM时间戳保持丢帧后时间轴。

## 真实模型接入验收（同日追加）
用户授权配置百炼北京地域业务空间专属兼容接口，模型qwen-flash；凭据只在本机忽略文件.env中，不写Graph或本报告。启动入口加载配置，导入server和本地测试不会自动读取它。应用模型HTTP错误、媒体错误事件和跨分块运行日志增加脱敏。文件仍继承目录ACL，尝试收紧为用户独占访问被Windows拒绝，不能称为加密或独占存储。

- 直连接口HTTP200，单次小请求约797ms（不是语音端到端时延）。
- `node scripts/verify-live.mjs --run` 使用生产4174服务和真实模型，无固定回复：回答“中国的陆地面积约960万平方千米。”；文本首块3222ms，冷启动首PCM5061ms。
- 随后本地生成录音经真实VAD/ASR识别，ASR final到回答首PCM882ms；有效preview取消早于final，显式取消通知30ms、旧PCM未恢复，音频与Avatar样本时钟一致。
- 以上为本机两次输入的单次观测，不是p95/平均值；第二次882ms的短回答不能代表所有问题。录音通过媒体接口注入，不是用户真实麦克风验收。
- 完成后测试会话及子进程已释放；生产服务保留运行，testFixture=false。报告在.artifacts/live-model.json，无凭据或业务空间标识。
- 追加27项JavaScript回归全通过，包含7项纯dummy凭据隔离/错误脱敏测试；检查应用源码、报告和日志共68个文本文件，真实密钥在.env之外匹配数为0。
- 页面实测真实模型自我介绍回复，AudioWorklet消费114456个24kHz采样，结束后缓冲为0，角色约60FPS，浏览器错误日志为空；未启用麦克风权限。验收会话结束，页面保留供用户连接测试。

## 尚未完成，不应标记“成熟链路”
1. 真实回答模型已接通；真实链路的更大样本时延、网络失败恢复与模型质量仍需继续验收。
2. 官方技术样例已保留为基础参考；默认新增独立银紫双马尾、纤细学院风VRM首版。真实脸部/发丝精细度仍低于批准的概念图，不能宣称最终美术精修已完成。详见character-v1.zh-CN.md。
3. 目前能量嘴形开合，不是中文音素级对齐；待听感和视觉共同校准。
4. 用户真实麦克风/AEC、外放回声、咳嗽/口水词样本、2小时/100轮长稳、并发负载、断网恢复还需验收。
5. 天气、新闻、绘画/画集仍在旧产品代码，未删除或改动，但尚未迁入新应用工具组合。新Node不假装具备这些工具。
6. 本轮新增代码未提交/push；之前Windows适配e0bd681仍已在GitHub main。上述通用Host修复仍为本地工作树更改。

## 使用

2026-09-13 第二版角色已成为默认全身显示，原第一版资产和配置保留。新增脸部/虹膜贴图、脸型与衣料调整、单侧手势/弯指和角色配置内的避裙姿态；最终美术质量仍待精修。详细实施与验收见 `character-v2.zh-CN.md`。中文声音替代候选及未测边界见 `tts-candidates-2026-09-13.zh-CN.md`，生产 TTS 尚未切换。

运行 start.ps1 启动本机4174端口。README给出依赖、模型和回归命令。
报告：.artifacts/speech-kokoro-fp32/report.json、speech-melo/report.json、speech-cancel.json。

## 2026-09-22：共享动作运行时

- 当前 AvatarSample A 改用同一 Microsoft Rocketbox 女性站立动作家族的四个 VRMA：idle、listening、thinking、speaking；配置不再把四态映射到同一个 idle。
- `local_speech` 已有的 `muxiva.voice.speech.started/stopped` 事件直接进入浏览器展示状态；没有新增 Muxiva Node、Agent loop、Turn Controller 或打断规则。实时播放仍优先于VAD展示，真正的打断决定仍只在既有 VoiceTurnController。
- `VrmAnimationController` 是身体骨骼唯一写入者。当前动作自带双手与手指轨道，角色配置移除了额外手指 rest pose 覆盖；表情、眨眼、视线与按实际PCM消费时钟驱动的口型保持独立。
- 正常网页与 Electron 桌宠继续加载同一 `web/` 运行时；Electron层没有复制动作或会话逻辑。
- 四个动作二进制、固定来源提交、SHA-256 和 MIT 声明位于 `assets/avatar/animations/`。新增真实 VRMA→AvatarSample A 重定向/有限矩阵测试和VAD状态集成测试。