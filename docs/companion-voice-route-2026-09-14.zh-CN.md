# 陪伴型中文声音升级路线：现状、候选与验收边界

> 后续决定与实施更新（2026-09-14）：用户已经试听并选定 Matcha Baker，用于个人本地及非商业展示；当前 Graph 已显式选择 Matcha，完成 46 项纯单元与 2 项独立真实 Python Host 回归，完整链路由主线程继续验收。详见 [Matcha 接入说明](D:/workspace/muxiva-avatar/docs/matcha-local-integration.zh-CN.md)。本文下方保留的是较早的研究快照，其中“生产仍为 Kokoro”、云端优先建议和尚未选定听感的描述不代表当前决策。没有启用新云服务，也没有授权商业使用或公开分发 Baker 数据/权重。

核查日期：2026-09-14。范围：本机代码、既有试音报告和官方公开资料。本轮只新增本文，没有读取 `.env`、调用新云服务、下载或运行模型，也没有改变生产 TTS。

## 结论

目前没有证据证明，这台 Ryzen 7 5800H / 约 14 GiB 可见内存 / AMD 集显的 Windows 电脑，能用已经试过的小模型同时达到“自然中文、稳定的温暖成年女声、细腻情绪、低首音、长时并发稳定”。小模型已证明可运行，并未通过声音品质验收。继续升调、堆人格口头禅、增加缓冲，都不能替代声音模型和声线的升级。

建议两条路线并行选型、分开授权：

1. **体验优先路线**：保留本地 VAD/ASR、Pi Agent、数字人和播放控制，只在用户批准新服务、文本外发和预算后，试听 MiniMax Speech 2.8 Turbo/HD；以 Eleven v3 Conversational 作第二组对照。先选声，再接入。此排序是依据中文能力、表达控制和当前硬件限制的工程判断，不是已经做过的主观质量排名。
2. **全本地路线**：保留 Kokoro 作为当前可恢复基线；下一项有边界的质量实验考虑 GPT-SoVITS v2 ProPlus，以及上游链接的 CPUFast 推理分支。先审依赖、模型体积、许可证和内存，再申请隔离试音；不承诺本机实时。CosyVoice 3 更适合作为具备合适 GPU 后的私有部署候选。本轮不启动 Qwen。

“世界一流”应当是试听与真实交互验收目标，不能依据厂商演示、模型名字或 ASR 回读宣告已经达到。

## 1. 本机与当前实际配置

只读系统核查得到 Ryzen 7 5800H，8 核 / 16 线程；Windows 可见物理内存约 13.87 GiB，本轮两次快照的可用内存约 3.08–3.26 GiB。Radeon(TM) Graphics 报告的 2 GiB 不等于独立 CUDA 显存。5800H 不在当前 AMD ROCm 支持的 Ryzen APU 清单中，因此不能把这块集显当作已经验证的 PyTorch GPU 推理设备，也不能承诺换成 DirectML 就可加速这些模型。[AMD 官方兼容矩阵](https://rocm-handbook.amd.com/projects/amd-rocm-programming-guide/en/docs-10.0.0/compatibility/compatibility-matrix.html)

生产 [graph.json](D:/workspace/muxiva-avatar/graph.json:74) 仍为：

- `builtin.speech_formatter`：最小 12、最大 60 字，保留现有清理规则。
- `muxiva.local_tts`：`.models/kokoro-multi-lang-v1_1`，默认后端 `kokoro`，FP32，`speaker_id=3`，4 个 CPU 线程，默认语速 1.0。
- PCM 输出为 24 kHz、单声道、16-bit little-endian；`pcm_chunk_ms=40`；待合成段上限 32、音频结果队列上限 64。

[现有实现](D:/workspace/muxiva-avatar/python/muxiva_avatar_speech/synthesis.py:44) 调用 Sherpa 的 `generate(text, sid, speed, callback)`。目前配置只支持 Kokoro / Kokoro INT8 / Melo，没有风格指令、逐段情绪控制或参考音频接口。Matcha、ZipVoice 的已有实验没有替换生产后端。

**机械感需要区分三个来源**：声线本身与模型的韵律能力；整段对话文本的表达；切片后每次合成可见的语调上下文。当前 12–60 字分句可能损失跨句语调，但没有完成单变量 A/B，不能把全部问题归因于分句。40 ms 是生成后 PCM 的传输分块，不是每 40 ms 重新合成几个字，不能描述成“音频拼字”。

## 2. 本机已有实测能证明什么

下表均为本机 CPU 4 线程、sherpa-onnx 1.13.5、相同五句、每句一次的独立实验。RTF 为总生成耗时 / 总音频时长。

| 方案 | 首批非空 PCM 库回调 | 加权 RTF | 测试进程峰值工作集 | 品质与适用限制 |
| --- | ---: | ---: | ---: | --- |
| Kokoro FP32 / speaker 3 | 0.33–1.33 秒 | 0.333 | 641 MiB | 当前基线；用户已明确不满意听感 |
| Matcha Baker / 3 步 + Vocos | 62–132 毫秒 | 0.041 | 236 MiB | 很快，但单一中文女声；未证明温暖情绪；Baker 数据有非商用限制 |
| ZipVoice-Distill INT8 / 4 步 + Vocos | 2.32–4.04 秒 | 0.519 | 585 MiB | 可参考音色，但本轮首回调接近整句完成，不能当低首音替换 |

ZipVoice 8 步另测两句：首回调约 6.82–6.94 秒、加权 RTF 约 1.032，未证明增加步数改善听感。参考音频使用已有 Kokoro 合成女声，不是真人或名人录音；这不能代表优质授权参考音色下的上限。

原始证据：[Kokoro](D:/workspace/muxiva-avatar/.artifacts/light-tts/kokoro-comparison/report.json)、[Matcha](D:/workspace/muxiva-avatar/.artifacts/light-tts/matcha-comparison/report.json)、[ZipVoice 四步](D:/workspace/muxiva-avatar/.artifacts/light-tts/zipvoice-comparison/report.json)、[八步](D:/workspace/muxiva-avatar/.artifacts/light-tts/zipvoice-8step-comparison/report.json)；试听、前处理和资源说明见[轻量中文 TTS 实测](D:/workspace/muxiva-avatar/docs/light-chinese-tts-2026-09-14.zh-CN.md)。

这些数字的必要限定：

- 首回调从已加载模型的 `generate()` 开始，可能包含前导静音；不是用户说完到扬声器出声。各模型内部聚合的首包文本量不同，不能直接排出端到端名次。
- 不包括进程启动、完整链路 ASR/Agent、网络、Host 排队、重采样和浏览器播放启动。加载时间只是模型构造阶段；生成时间不包括 WAV 写盘。
- RSS 使用 Windows 进程峰值工作集，随进程累计；不是每句独立新增内存、私有提交量或整机需求。
- 五句各一次，不是 p95、连续多轮或 ASR/渲染并发压测。17 段 SenseVoice 回读基本一致只证明内容初筛，不证明发音全对，更不证明自然、可爱、有情绪。

Matcha 官方明确 Baker 数据仅限非商业用途，不能因速度优秀直接作为商用默认音色。ZipVoice 官方定位为中英参考音色生成，当前 INT8 实验也不足以证明中文情绪能力。[Matcha 官方说明](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/matcha.html#matcha-icefall-zh-baker-chinese-1-female-speaker)、[ZipVoice 官方仓库](https://github.com/k2-fsa/ZipVoice)

## 3. 全本地升级候选

### GPT-SoVITS v2 ProPlus：下一项 CPU 质量实验

官方提供 Windows CPU 安装路径、中文参考音色和少样本能力，代码为 MIT。README 的 M4 CPU RTF 0.526 来自另一种硬件，不能当作这台 5800H 的证据。上游还链接了 CPUFast，但它是独立维护的推理分支，不等于已经在本机验证的官方发行包。[GPT-SoVITS 官方仓库](https://github.com/RVC-Boss/GPT-SoVITS)

CPUFast 保留中文 BERT 和 g2pw，使用纯 PyTorch，而不是可直接装进当前 Sherpa 的 ONNX 后端。该分支说明自己试验过 ONNX/ORT，但未采用；不能为了速度删掉中文前端后宣称等价。建议先固定源码提交、审查安装脚本与依赖，在独立环境采用有授权的成年女声参考，短句试音通过再考虑集成。本机首音、RTF、峰值内存、自然度均未测。[CPUFast 项目说明](https://github.com/baicai-1145/GPT-SoVITS-CPUFast)

### CosyVoice 3 0.5B：表达能力候选，不是现机低延迟承诺

官方列出中文、方言、参考音色、情绪/语速等指令与双向流式能力。官方宣传的约 150 ms 不能移植为本机数据。[官方仓库](https://github.com/QwenAudio/CosyVoice)

模型卡标注 Apache-2.0；源码存在无 CUDA 回退，但会关闭 `fp16` 和 TensorRT，这说明“存在 CPU 路径”，不是“在约 3 GiB 空闲内存下可稳定实时”。前端、声学模型和声码器一起加载，不能仅按 0.5B 参数估算完整资源。更适合后续合适 GPU 的本地或私有服务研究；新硬件、远端 GPU 和文本外发均需另行确认。[官方模型卡](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512)、[官方加载实现](https://raw.githubusercontent.com/QwenAudio/CosyVoice/main/cosyvoice/cli/cosyvoice.py)

### Qwen 状态

保持暂停，不启动现有隔离安装。尤其 Qwen3-TTS 0.6B CustomVoice 的当前官方实现会忽略 `instruct`，不能把给它加“甜美温暖”的提示词当作已经具有情绪指令控制。更大版本的能力和硬件门槛需要独立验收，不能直接沿用宣传中的首音数字。[官方 CustomVoice 实现](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/inference/qwen3_tts_model.py)

所有本地路线都要分别核查代码、权重、训练/参考音频、生成内容使用范围；开源代码许可证不自动授予第三方声线使用权。现有约 3 GiB 空闲内存不足以直接批准大型模型无护栏加载。后续实验应先估算峰值，再沿用独立子进程、单例运行、超时和低内存停止机制，只能终止自己的测试子进程。

## 4. 需要新云服务授权的候选

### 第一组：MiniMax Speech 2.8 Turbo / HD

截至核查日，官方当前音频列表为 `speech-2.8-turbo` 与 `speech-2.8-hd`，支持中文及情绪控制；2.8 加入呼吸、轻笑等声音标签。建议 Turbo 测交互，HD 作同声线质量对照，不依据命名断言一定更快或更自然。[官方模型列表](https://platform.minimax.io/docs/guides/models-intro)、[Speech 2.8 发布说明](https://www.minimax.io/news/minimax-speech-28)

双向 TTS WebSocket 将流入文本按句缓冲，提供 `task_flush` 和 `task_cancel`；取消不会撤回已送达客户端的音频。应保留标点，用真实上游完成事件刷新句尾，不能把服务端完成当成播放结束，也不能让遗留 PCM 在打断后复活。本机中文首音和网络尾延迟未测。[官方双向 TTS 协议](https://platform.minimax.io/docs/api-reference/speech-t2a-websocket-bidi)

### 第二组：Eleven v3 Conversational

使用专门的 `eleven_v3_conversational`，不是简单沿用旧版普通 v3 的结论。官方列出中文、声音标签和实时表现；约 280 ms 明确不含应用与网络延迟。因此只作为功能与可测路线证据，不作为本机 SLA。[官方模型说明](https://elevenlabs.io/docs/overview/models)

它有独立的文本到对话 WebSocket，不要求采用 ElevenAgents 或替换 Pi Agent。当前文档说明服务端会积累约 40 字符和 8 词，短输入可显式 flush；中文短答、标点、断网重连与单声线连续性必须实测。提供方的 `new_turn` 仅是适配器内部协议映射，不应侵入通用 Agent 的语义。[官方实时 TTS 接入指南](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd)

### 授权、成本、隐私和安全门槛

- 当前没有确认可用的新服务账户、额度、地域和用户预算；本文不是开通、充值、购买音色或发送测试文本的授权。
- TTS-only 也会外发要朗读的回答，可能包含对话中的私人信息。默认不发送麦克风原始音频、完整聊天历史或工具原始数据；声线克隆需要另行批准上传参考音频并确认本人/权利人授权。
- 启用前确认服务区域、留存/训练条款、可用模型与音色许可，以及单次试听/每月预算上限。价格、计费字符规则、最低套餐、克隆费用和取消后计费需按所选账户与地域复核；不能用未核实的“免费额度”承诺零成本。[MiniMax 官方定价入口](https://platform.minimax.io/docs/pricing/overview)、[ElevenAPI 官方定价](https://elevenlabs.io/pricing/api)
- 本轮审到 MiniMax 旧版 WebSocket 示例关闭证书与主机名验证。**不能照抄这两项设置**，必须保留标准 TLS 证书链和主机名校验；认证只在本机后端使用，禁止放进浏览器或普通日志。[相关官方示例](https://platform.minimax.io/docs/api-reference/speech-t2a-websocket)
- 云端失败时不得默默变成另一种声线。是否允许回退本地、何时告知用户，应是可配置且明确的产品选择；不能通过无限重试增加费用或播放重复片段。

## 5. 专业中文声线 brief 与试听验收

目标是 **22–28 岁成年女性的自然近距离交流感**：普通话清楚、音色温暖明亮、轻盈但不尖细，有适度微笑感和真实句末收束。可爱来自细微的节奏、关注和偶尔俏皮，不来自幼童音、持续高音、每句撒娇或固定人设口头禅。保持同一人的声线与音区；正经问题清楚直接，安慰放慢一点，惊喜有变化但不尖叫。不要每句气声、笑声、叹息和拖长尾音。

固定试听组建议至少覆盖：

1. 平静招呼：“回来啦。今天过得怎么样？”
2. 安慰与允许停顿：“今天辛苦啦。先休息一会儿，好吗？想说的时候，我再听你慢慢讲。”
3. 轻微惊喜：“真的？那太好了！你快跟我讲讲，后来怎么样了？”
4. 正经回答：“中国的陆地面积约九百六十万平方千米。你想了解地理，还是人口？”
5. 简短应答：“嗯，我在听。”、“好呀。”、“怎么啦？”；防止短文本卡住或被吞字。
6. 一段不切断的自然叙述，以及重庆、银行行长、日期、温度、百分比和中英混读。

每个候选先取 2–3 个有明确使用许可的成年女声，同文、同播放音量、随机编号盲听，保留原始音频；不靠后期升调掩盖模型差异。用户应分别评中文咬字、自然停顿、亲切感、声线一致性、长听疲劳、符合目标程度，并记录不自然片段。表达标签只在模型确实支持且该情境需要时使用；先测无标签基线，再测克制表达。ASR 仅辅助筛漏字，不能自动通过听感验收。

## 6. 后续接口位置：不越过架构边界

现有 [TTS Node 清单](D:/workspace/muxiva-avatar/.muxiva/nodes/local_tts/muxiva.node.json) 的端口可以继续作为兼容契约。优先在语音合成组件实现可配置 provider；若保留 `local_tts` 的“纯本地”命名与能力声明，则新建独立云 TTS Node，但使用相同输入/输出。不要把云调用藏在仍宣称 local 的实现中，也不需要新 Agent、loop 或 turn engine。

| 接口点 | 保留的契约 / 后续需要明确的内容 |
| --- | --- |
| `text_in` | `TextFrame` 的可朗读文本与 `sequence`；字符流可缓冲，但保留语言标点与句义。审查当前分句对韵律的影响后再调配置，不逐字发起独立合成。 |
| `signal_in` | 继续接收既有 `muxiva.turn.cancelled`；优先解析 payload 的 `turn_id`，保持严格取消早于边界的语义。调用提供方取消后，仍用本地 generation/序号丢弃迟到结果。 |
| `audio_out` | 统一 `pcm_s16le` / 24 kHz / mono；提供方若给压缩流或不同采样率，在适配器做连续解码/重采样。保持 `stream_id='assistant'`、输入序号、同一序号内累计样本时间戳和 `media_relative` 时钟。 |
| `event_out` | 复用 started / segment.completed / failed；提供方请求结束、合成完成、实际播放排空要分开，不伪造完成事件。 |
| 确定的文本尾部 | 双向服务 flush 必须由既有文本/完成事件的因果关系驱动；先确认跨边事件顺序。不要用“静默 200 ms”猜回答结束，更不能新增 Agent 轮次判断。 |
| 配置与状态 | provider、model、voice、语言、语速、有限风格选项、超时、队列预算在 Node/角色分支配置；凭据是后端秘密引用。Master 保持通用，不放声线名或陪伴业务内容。 |

逐段表达如果需要新元数据，应先设计有界、可验证的可选语音表现字段，由角色分支提供、TTS 适配器映射；不允许把任意模型控制串从聊天文本直接执行，不让服务商字段传播进通用核心。取消来源仍由现有 controller 决定，不能借换 TTS 改成 VAD 一响就打断。

## 7. 安全的下一步与上线门槛

现在无需新服务即可完成：确定上述声线 brief；保留同文试听集；完善真实客户端时延测量；对当前 formatter 做离线文本边界测试；审计 TTS 取消、尾部完成、有界排队的契约。不要先改生产默认再让用户被动验收。

拿到明确授权后，先做小额度、无敏感信息的云试听，或有内存预算的独立本地试音；选定声线才接入候选配置。性能验收必须将以下阶段分开，跨机器/浏览器时钟不得直接相减：用户语音结束、可用 ASR、Agent 首段文本、合成请求、首个可播放 PCM、客户端开始消费音频、最后音频排空。浏览器消费时间只是可观测的播放代理，不能未经回环测量就声称精确扬声器物理出声时刻。

至少进行 30 轮覆盖短答、安慰、正经长答、工具返回、说话中打断、取消后迟到包、重连的交互测试，并在 ASR 与数字人渲染同时工作时记录 p50/p95、卡顿、累计内存和音画同步。保持嘴型只跟实际播放，网络生成状态不能让角色提前开口。听感与稳定性都通过后，才由用户确认切默认、提交和 push。
