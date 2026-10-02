# Muxiva Avatar — Windows 本地数字人原型

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933.svg)](https://nodejs.org/)

这是一条真实 Muxiva Graph，不是另写的聊天循环。当前处于首轮集成与验收阶段，尚不等同成熟产品。

## 启动

在本目录运行 `node scripts/doctor.mjs` 检查，`node server.mjs` 前台启动；也可用 `powershell -File .\start.ps1` 在后台启动。浏览器访问 http://127.0.0.1:4174/ 。只监听本机，不对局域网/公网开放。

先按 `.env.example` 配置兼容 Chat Completions 的模型服务，再启动服务。需要 MUXIVA_MODEL_BASE_URL、MUXIVA_MODEL_ID、MUXIVA_MODEL_API_KEY；本地无鉴权模型必须显式 MUXIVA_MODEL_AUTH_MODE=none。不要把密钥填进Graph或提交。此原型没有默认云端，也不会假装已调用未配置的大模型。

“连接会话”会启动一个独立 Muxiva进程；“结束”回收其Node子进程。默认同机限1条会话（部署层内存限额，不是核心模型限制）。首次启用麦克风由用户自行授权。建议戴耳机做首次回声/插话验收。

## 模块与边界

- `graph.json`：产品装配、人格、ASR录音端点和口水词策略。
- `muxiva.local_speech`：本地Silero/Zipformer/SenseVoice，只输出活动/预览/最终识别。
- 已有 `builtin.voice_turn_controller`：唯一打断决定点，普通VAD不直接取消。
- `avatar.pi_agent`：已有AgentNodeAdapter + muxiva-pi-agent/main的持久循环；没有新Agent或Turn实体。
- `muxiva.local_tts`：当前选择 Matcha Baker 中文后端，4线程，输出24k单声道PCM；Kokoro/Melo仍是可配置后端。
- `avatar.animation`：保留的通用兼容Node，只输出带采样时间的PCM能量包络，不驱动身体、手势或Turn。
- `local.media_source/sink`：本地WebSocket、输入/输出、节奏和取消；不执行业务/模型策略。
- `web/`：共享的浏览器/桌宠Avatar Runtime。按已有VAD、Agent生命周期和真实AudioWorklet播放时钟合成四态VRMA、表情、眨眼、视线与五元音近似口型；只负责展示。

当前大模型仅装配对话能力。旧项目的天气、新闻、绘画、画集未删除或修改，但还没有迁入这个新应用的工具组合；未配置时不会假装执行。默认模型现为本机的 AvatarSample A；此前的定制 VRM、立绘及其图片素材已从应用素材目录移除。可通过“更换本地VRM”临时验证其他已绑定资产，不上传到外部服务，加载失败保留当前角色。

## 当前角色

打开 [本机语聊页面](http://127.0.0.1:4174/)，默认加载 `assets/avatar/AvatarSample_A.vrm`，由 `assets/avatar/character.json` 选择。旧角色的 query 预览入口已关闭。角色文件、取景、表情和动作强度属于应用配置，不进入 Muxiva core、Agent 或 TTS。

当前默认待机使用 `avatar-sample-a-idle-refined.vrma`：保留用户在 Blender 调好的手臂/手腕，手指和头部修正在离线资产中完成，不叠加第二套运行时骨骼驱动。维护角色动作时，可用 `?idlePreview=original`、`?idlePreview=2`、`?idlePreview=3`、`?idlePreview=4` 对比同一 Rocketbox 家族的四套待机动作。该参数只替换浏览器表现层的待机 VRMA，不改变 Graph、Agent、Voice Turn 或其他会话状态。

浏览器使用 Three.js + three-vrm 渲染真实3D模型。身体由同一 Rocketbox 家族的 VRMA 驱动：四种会话状态各自独立，三种说话动作每约7秒轮换，另有招手、点头、摇头、开心、轻微生气、笑和摊手短动作，交叉淡入后自动回落。已有 VAD 事件只切换倾听展示态，Agent 生命周期只切换思考态，真实 PCM 开始消费后才进入说话态。口型由浏览器对实际播放 PCM 做五元音近似分析，表情、眨眼、视线和身体分层合成；它不是中文音素模型。Electron 桌宠加载完全相同的页面和 Avatar Runtime，不复制动作或对话逻辑。

### 情绪动作（v11）

网页角色下方的“情绪动作…”可预览开心、小生气、笑、摇头和摊手；“打个招呼”“点头回应”也支持 VRM。桌宠右键菜单有“互动动作”，桌宠保持透明无常驻面板。更新原生菜单后需关闭并重新打开桌宠。

- `renderer.animation.variants`：会话状态的动作池；`gestures`：语义名称到短动作的映射。素材只有身体轨道能进入混合器，不接管口型和视线。动作冷却、减少动态效果和停止已淡出动作均在前端实现。
- `renderer.face.emotions`：表情名称及强度；开心、生气使用不同表情，而不是永远使用同一微笑。音频静止时嘴巴关闭，表情不伪造语音。
- `renderer.cues`：只对助手输出做有界的本地短语匹配；匹配结果等相同 sequence 的音频真正播放才呈现，打断后旧 sequence 不可复活。没有增加模型请求、修改 Agent 提示词或新增 Muxiva Node。
- 这是保守的句子/回答级规则，不是完整语义情绪识别，也不是逐词精确动作对齐。否定、引用、反讽和隐含情绪仍可能漏判或误判，不能声称已经具备真人情绪理解。没有匹配时仍有正常说话动作轮换。

参考 [AIRI 表情驱动](https://github.com/moeru-ai/airi/blob/main/packages/stage-ui-three/src/composables/vrm/expression.ts) 对情绪、眨眼、口型所有权的划分，以及 [Super Agent Party 的 VRM 实现](https://github.com/heshengtao/super-agent-party/blob/main/static/js/vrm.js) 的短动作/队列和语音分段表情思想；没有复制其业务服务或把展示逻辑放进通用 Agent。动作素材沿用本项目已有的 Hanami/Rocketbox MIT 家族，来源、固定提交与校验值见 `assets/avatar/animations/sources.json`。

`node scripts/setup-conversation-motions.mjs` 可重新获取校验过的新增动作；它不会覆盖内容不匹配的已有文件。`node tests/e2e.mjs --serve --performance` 启动独立4180固定回复夹具，再运行 `node scripts/verify-avatar-performance.mjs` 检查真实本地 TTS/AudioWorklet → 表情、说话变体和取消。此脚本使用独立 Chromium 配置和静音输出，不访问个人浏览器、不启用麦克风、不调用云模型。截图和报告位于 `.artifacts/performance-v11/`。测试覆盖桌宠共用页面与菜单映射，但不替代实际 Electron 右键菜单的人工验收。

通用 `IllustrationRenderer` 代码仍存在，但当前 Graph 不使用它，也不安装旧立绘资产。角色替换没有新增聊天循环或 turn 语义。

此前旧角色的验收记录仅是历史记录，不代表 AvatarSample A 已完成浏览器目视或长时间实机验收。

**当前 TTS 是 Matcha Baker 轻度调音版（+2 半音、速度 1.04 倍）。** `graph.json` 的 `local-tts.node_config.voice_effect` 控制本地 Rubber Band 音高/速度处理；删除该配置即可恢复原声。不改变模型 `speed`，不使用浏览器 `playbackRate`，网页和桌宠共享调音后的 24 kHz PCM、样本时钟和口型输入。

调音需要带 `rubberband` 滤镜的 FFmpeg：加入 PATH，或设置 `MUXIVA_FFMPEG` / `voice_effect.ffmpeg` 指向可执行文件。依赖缺失会明确报错，不会静默改回原声。每个 formatter 片段使用连续流处理，沿用有界队列、取消代次和时间戳；取消/关闭时回收所属 FFmpeg 子进程。试听文件的离线响度归一化不用于实时路径，以免增加等待时间，故实时音量可能与试听略有差异。音色仍来自单说话人 Matcha，调音不等于情感 TTS。

Qwen3-TTS 只完成下载、校验和隔离环境准备；用户要求暂不运行，因此未切换生产。详见 [Qwen 准备状态](docs/qwen-tts-local-setup.zh-CN.md)。

## 安装与复现

需要相邻目录 `../muxiva` 和 `../muxiva-pi-agent`，Node24+、Python3.13、可运行的Windows muxiva CLI。
`pnpm install` 安装web和Pi依赖；所需的SDK源码通过link解析。不要盲目批准不必要的第三方安装脚本。
`python scripts/setup-speech.py` 创建隔离环境、安装固定依赖、下载并校验本地语音权重。
本机角色文件需要放在 `assets/avatar/AvatarSample_A.vrm`；二进制 VRM 被 `.gitignore` 忽略，不随代码提交。
大模型服务仍需单独配置；本地语音不是“全部模型离线”。

## 回归

- `node --test tests/*.test.mjs`：Pi HTTP协议、服务器、播放时钟、角色取消/资源生命周期。
- `node --test tests/vrma-animation.test.mjs tests/character-config.test.mjs tests/character-import.test.mjs tests/avatar-view.test.mjs tests/avatar-lipsync.test.mjs`：四态VRMA真实重定向、VAD状态、播放优先级、口型时钟和本地VRM导入。
- `.venv\Scripts\python.exe tests/avatar-node.test.py`
- `.venv\Scripts\python.exe tests/avatar-host.test.py`
- `.venv\Scripts\python.exe -m unittest discover -s tests -p test_speech_nodes.py`
- `node tests/e2e.mjs`：真实Graph+真实本地语音与Avatar、仅LLM为明确固定回复的本地HTTP夹具。验证文本/音频输入、preview早于final取消、旧PCM过滤。不是模型质量评测。
- `node tests/e2e.mjs --serve`：4180端口人工浏览器测试，页面明确标记“测试模式”，不能当生产模型。
- `node scripts/verify-live.mjs --run`：对已启动4174生产服务做两次真实模型请求（会使用配置的API额度），验证文本/录音输入、TTS、Avatar和取消，结果写入忽略目录.artifacts；不会读取真实麦克风。
- `.venv\Scripts\python.exe scripts/benchmark-speech.py` 与 `benchmark-speech-cancel.py`：真实PythonHost性能报告及音频保存在 `.artifacts/`。

## 已知未验收

真实用户麦克风与AEC、真实模型时延的大样本统计、长稳2小时/100轮、多会话负载、工具等价迁移、最终人物资产和音色偏好，仍需后续验收。真实qwen-flash问答和本地语音/Avatar已完成小样本链路验证，详见docs/implementation-status.zh-CN.md。设备/模型故障会显式报错，不能通过静默或固定回复掩盖。

## 许可证

项目代码采用 [Apache License 2.0](LICENSE)。第三方模型、动作和其他资产仍遵循各自许可证；动作来源与声明见 `assets/avatar/animations/THIRD_PARTY_NOTICES.md`。本机使用的 AvatarSample A 二进制不进入仓库，其来源和限制记录在 `assets/avatar/AvatarSample_A.source.json`。
