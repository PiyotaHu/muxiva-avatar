# 当前语音链路、音色与人物改进

核对日期：2026-09-13。以本机graph.json、models.lock.json及TTS实现为准。本文不包含凭据。

## 当前 pipeline

浏览器麦克风（单声道16k PCM）→ local.media_source → muxiva.local_speech → builtin.voice_turn_controller → avatar.pi_agent → builtin.speech_formatter → muxiva.local_tts。

TTS输出分两路：一路到local.media_sink/浏览器AudioWorklet播放；另一路到独立avatar.animation Node生成嘴形事件，经media sink进入Three.js/VRM渲染。嘴形取实际已播放的采样位置，不按文字到达时间播放。文本输入复用同一个Controller及后续链路。

| 环节 | 当前实际实现 | 位置与用途 |
| --- | --- | --- |
| VAD | Silero VAD ONNX | 本地CPU；活动检测，当前静音端点0.6秒；不独自决定打断 |
| 实时ASR预览 | streaming Zipformer-small CTC zh（2025-04-01） | 本地CPU；尽早输出preview |
| 最终ASR | SenseVoiceSmall int8（2024-07-17） | 本地CPU；完整语段最终识别 |
| 会话/打断 | 已有VoiceTurnController | 过滤口水词，连续有效preview确认后提前取消，不等final，也不见VAD就取消 |
| Agent | @muxiva/agent适配器 + muxiva-pi-agent已有持久循环 | 每个Muxiva session隔离历史，不新增小Agent loop |
| 回答模型 | 百炼qwen-flash | 云端；只接收识别文本及对话上下文，不由此调用云端ASR/TTS |
| 文本整理 | 已有SpeechFormatter | 最小块12字、最大块60字，清理不适合朗读的内容 |
| TTS | Kokoro-82M v1.1-zh FP32，sherpa-onnx 1.13.5 | 本地CPU，4线程；speaker_id=3（zf_001中文女声），speed=1.0；24kHz输出 |
| 嘴形 | avatar.animation，20ms RMS能量包络 | 普通独立Node，不是音素识别或视频生成大模型 |
| 人物显示 | Three.js 0.180.0 + three-vrm 3.5.3 | 浏览器GPU；默认由character.json选择银紫双马尾VRM，原样例保留 |

当前应用尚未挂载旧产品的天气/新闻/绘画/画集工具。旧功能代码未删除，等价工具迁移仍待完成。

## 为什么音色机械

当前调用只有text、speaker id、speed，没有情感/风格指令或参考音频能力接入。角色提示词控制回答措辞，不等于能控制合成音色。12–60字的分句各自进入一次TTS生成，可能损失完整句子的连贯语调，需A/B试听确认影响量。40ms是输出PCM传输分包，不是每40ms重新合成。

Kokoro当时被选为默认，是因为本机CPU吞吐实测较合适（RTF约0.49–0.56），不代表它已经达到用户要求的中文表现力。不要把更快、更稳定等同于音色最好。

## 声音升级建议（本轮没有替换或下载模型）

1. 保留Kokoro作性能基线；用同组中文疑问、解释、安慰、兴奋、数字/多音字及长回答，比较完整句/当前分句，评估换speaker、语速与分段边界。单纯换speaker不是完整情感控制。
2. 优先测试GPT-SoVITS v2ProPlus作为本机CPU候选，参考音频必须自有或获授权。官方给出Windows CPU安装路径，但本机5800H时延、内存和最终听感尚未测试。不能拿官方M4或NVIDIA GPU速度冒充本机结果。[官方项目](https://github.com/RVC-Boss/GPT-SoVITS)
3. 若重点是自然语言指令控制语气，可对照Qwen3-TTS 1.7B CustomVoice；资源成本及CPU首包需要本机测试。不能把0.6B写成同等情感控制：当前官方实现对0b6关闭instruct，而主README的Instruction Control仅勾选1.7B。[官方项目](https://github.com/QwenLM/Qwen3-TTS)

升级只在TTS Node/provider及产品配置内进行，继续输出统一PCM/取消事件。更改外部云服务、上传参考音频前另行确认，不改变Muxiva骨架和Agent职责。

## 角色与动作

概念图：assets/avatar/concepts/adult-twintail-v1.png。生成工具、完整提示词和3D制作边界在同目录adult-twintail-v1.md。

银紫双马尾、纤细成年女性、学院风日常时装、表情亲切俏皮。用户批准方向后已实施独立adult-twintail-v1.vrm：新建发束、衬衫/开衫、百褶裙和配饰，保留获准修改的pixiv基础骨架、脸部表情、手和腿。原sample.vrm字节不变。它是依据参考方向制作的3D首版，不是概念图同精度的人工精修重建；详细资产和验收记录见character-v1.zh-CN.md。

动作改进与人物资产独立：使用标准VRM骨骼做自然站姿、头颈/身体微动、说话时手臂/手腕/手指动作，按实际播放状态淡入淡出；不是Agent生成的语义手势，也不是图像变成了3D。

动作验收：新增14项自动测试，覆盖停说平滑回落、严格取消水位、模型切换、缺骨跳过、无旋转累积和渲染接入。合并既有生命周期/时间线共24项通过。实际页面用qwen-flash回答、Kokoro本地出音，观察到头部与单侧手臂姿态变化，约60FPS；一次完整回答播放468114个24kHz采样并清空缓冲，另一回答播放过程中点击停止后缓冲归零、回到放松站姿，浏览器error为空。这不是最终角色穿模验收，也不是精确语义/音素对齐。

已有页面需结束会话后刷新，才加载新的前端模块和默认角色。角色选择、表情及动作幅度在assets/avatar/character.json；可切换正面/两侧/背面及近景/全身，也可继续导入本地VRM。

动作模块首次全量回归41/41通过；定制角色阶段追加配置、取景和真实VRM解析/蒙皮/弹簧检查，更新验收见character-v1.zh-CN.md。未提交或push。
