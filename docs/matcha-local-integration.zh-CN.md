# Matcha 本地 TTS 接入说明

日期：2026-09-14。用户已选择已有 Matcha Baker 试听，并确认个人本地使用及非商业展示。本轮在现有 `muxiva.local_tts` Node 增加可配置 Matcha 后端，保留 Kokoro / Kokoro INT8 / Melo；不新增 Agent、loop、turn controller 或服务。

## 实际配置与架构边界

[Graph](D:/workspace/muxiva-avatar/graph.json) 的 `local-tts.node_config` 现在选择：

```json
{
  "backend": "matcha",
  "model_dir": ".models/tts-candidates/matcha-icefall-zh-baker",
  "acoustic_model": "model-steps-3.onnx",
  "vocoder": "../vocos-22khz-univ.onnx",
  "rule_fsts": ["phone.fst", "date.fst", "number.fst"],
  "silence_scale": 1.0,
  "speaker_id": 0,
  "num_threads": 4,
  "pcm_chunk_ms": 40,
  "max_pending_segments": 32,
  "max_audio_chunks": 64,
  "max_segment_chars": 600
}
```

模型和词典均使用本机已有文件，没有重新下载或自动安装。新会话会读取这份 Graph；本轮没有重启常驻服务或既有会话。

通用 [LocalTtsNode](D:/workspace/muxiva-avatar/python/muxiva_avatar_speech/synthesis.py) 只知道 `matcha` 算法后端及配置路径，不包含 Baker 模型名、角色音色业务或用户身份。模型/声码器路径、FST 列表支持绝对路径；相对路径统一相对 `model_dir`，而 `model_dir` 仍按原方式相对应用工作目录。Matcha 必须明确指定 `model_dir`、`acoustic_model` 和 `vocoder`；同目录使用 `lexicon.txt`、`tokens.txt`。文件缺失会在模型构造前明确失败，不下载、不静默切换模型。

三步扩散烘焙在所选 acoustic ONNX 中，不新增运行时“步数”假开关。Matcha 的 noise/length scale 均为 1，与已有试听一致；`speaker_id=0` 是该单声线模型的正确配置。当前 Sherpa 不再需要 Matcha 的旧 `dict_dir` 参数，因此没有继续传入。FST 顺序按配置执行，限制最多 16 项，拒绝缺失、重复或包含逗号的规则文件路径。

`silence_scale` 是可选通用参数：本机 Matcha 明确设为 1，保留试听中的静音时长。未配置时仍沿用 Sherpa 现有默认值约 0.2，不悄悄改变旧后端。已经选定的音色不再通过升调或额外效果处理。

端口和输出不变：[Node 清单](D:/workspace/muxiva-avatar/.muxiva/nodes/local_tts/muxiva.node.json) 仍为 `text_in`、`signal_in`、`audio_out`、`event_out`。Matcha 原生 22,050 Hz 经原有流式 soxr 重采样输出 24,000 Hz、单声道 `pcm_s16le`；保留 `stream_id=assistant`、原输入 sequence、同序号跨文本片段连续样本时钟。原生回调和最终返回 PCM 不会重复输出，重采样尾部只刷新一次。

有界 worker 队列、Host 小批量排出、已有取消信号及 generation 防迟到逻辑未另起实现。`payload.turn_id` 优先于 SignalFrame 的序号；取消旧音频后，同边界序号的新回答仍可输出。这里只发每段合成完成事件，不把它冒充整轮播放完成。Master / Pi Agent / ASR / 美术前端没有因本次后端选择而改动。

## 回退方法

回退是明确配置变更，不会在失败时自动换音色。将 Graph 后端设为 `kokoro`，模型目录改回 `.models/kokoro-multi-lang-v1_1`、speaker 设为 3，并移除 Matcha 的 `acoustic_model`、`vocoder`、`rule_fsts`、`silence_scale`，即可恢复原配置；其余队列/输出参数保持不动。

Kokoro INT8 使用 `kokoro-int8` / `.models/kokoro-int8-multi-lang-v1_1`；Melo 使用 `melo` / `.models/vits-melo-tts-zh_en` / speaker 0。Node 原来的默认后端仍是 Kokoro，当前应用之所以使用 Matcha，是 Graph 显式选择的结果。

## 本轮验证结果

纯单元测试：

```powershell
& .venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
```

46 / 46 通过，包括新增 [11 项 Matcha 测试](D:/workspace/muxiva-avatar/tests/test_matcha_tts.py) 与原有语音节点、数字/温度/文本规范化、低内存护栏测试。新增覆盖路径解析、必需资源缺失、规则/参数校验、旧后端默认值、默认 speaker、22.05k 分块与尾部刷新、同序号多片段时钟、取消后的重采样尾部和迟到旧文本、启动失败释放。

显式真实 Host 测试（会加载本机 Matcha，不在默认 `test_*.py` 发现范围内）：

```powershell
& .venv\Scripts\python.exe tests/matcha-host.test.py
```

[Host 回归](D:/workspace/muxiva-avatar/tests/matcha-host.test.py) 的 2 / 2 通过；读取当前 Muxiva Python Host 源码和当前 Node 入口，在独立子进程运行，不使用服务、麦克风、播放设备、ASR 或网络。为稳定制造背压，测试将音频队列缩为 8 项，生产仍为 64 项。

有效资源计数口径的一次运行：

| 项目 | 结果 |
| --- | ---: |
| Host prepare（含模型初始化，不含解释器启动） | 2,733.9 ms |
| 首个 Host PCM 观测 | 82.5 ms |
| 两段短句音频合计 | 3.720 秒 |
| 输出 | 24 kHz / mono / pcm_s16le |
| 运行前可用物理内存 | 2,117 MiB |
| 测试观测最低可用物理内存 | 1,915 MiB |
| 实际 Python Host 峰值工作集 | 210 MiB |
| 实际 Python Host 采样 private bytes 峰值 | 681 MiB |

首次测试发现 Windows venv 启动器 PID 不等于实际 Python Host PID，只有数 MiB 的启动器计数已弃用；上表来自修正后的实际解释器 PID。private bytes 是采样值，不是系统保证的精确历史峰值；工作集不是完整内存需求。测试设有启动时至少 1.5 GiB 空闲、低于 800 MiB 持续 500 ms 的保护和分阶段超时，只能终止自己创建的测试进程树。全部测试进程已经结束。

真实 Host 验证了两段文本连续时钟，以及 `signal.sequence=0`、`payload.turn_id=201` 的取消后不再排出旧序号 200 PCM，新序号 201 从零偏移开始。首包是 Host 接收观测，不是浏览器首播、扬声器物理出声或端到端语音延迟；单次短句不代表 p95 或长期并发稳定性。

主线程随后完成真实 Graph 的 normal / formatter / long 三种 e2e，以及浏览器实际 PCM 播放与停止检查（见下节）。没有重启常驻生产服务。已有词典的 `shei2` 告警并未通过业务硬编码掩盖，后续仍需对“谁”等短词、多音字和日期进行主观发音抽查。用户已选择此前听感；接口测试和 ASR 回读均不能替代主观试听验收。

### 主线程完整链路与浏览器验证

使用现有 Windows debug Muxiva 二进制和当前生产 Graph，模型回答端为本地固定回复测试夹具；VAD / ASR / Python TTS / Avatar Node 均真实运行。不外发测试文字、不用真实麦克风。

- `node tests/e2e.mjs`：首音频包 2,983 ms；ASR 识别预览在 final 前触发取消，新旧 sequence 校验通过。
- `node tests/e2e.mjs --formatter`：首包 3,073 ms；跨分块小数、百分比、URL 格式化回归通过。
- `node tests/e2e.mjs --long`：首包 3,031 ms；25.380 秒、639 包连续样本时钟无断点/重复，传输取消观测 61 ms；随后 ASR / Agent 第二请求仍通过。
- 浏览器隔离夹具 `--serve --long`：已连接后发送测试文字，页面诊断首文字 258 ms、首 PCM 包 490 ms、首次真实 PCM 消费 503 ms；最大播放缓冲 139 ms。观察到口型随播放开合、峰值 0.97，约 60 FPS。停止后嘴型 0、缓冲 0；取消回执 37 ms、PCM 停止 38 ms。
- 前端/服务 JS 全套 277 项通过；最后的表情接口与预览入口修订又分别跑相关 28/38 项回归通过。数字人候选只修改展示代码，不改 Agent 或播放时钟。

这些都是单次功能测试，不是 p95，不是扬声器物理出声测量，也不含云端大模型的真实响应等待。独立 Host、e2e 夹具和浏览器是不同测量起点/运行状态，不能拿 82.5 ms 当端到端体验承诺。浏览器测试会话已结束，常驻 4174 生产服务保持运行。

## 使用范围与公开发布

官方明确该 Baker 模型训练数据仅限非商业用途。[官方模型说明](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/matcha.html#matcha-icefall-zh-baker-chinese-1-female-speaker)

本机按用户确认的个人使用/非商业展示范围选择此模型；**开源应用代码不等于取得训练数据、模型权重或第三方声线的无限制商用/再分发权利**。本轮不打包或上传 `.models`、模型下载缓存、生成音频或私有运行配置，没有公开发布、采购、提交或 push。后续若要随代码分发权重、商业部署或出售服务，应单独核查相应权利或换用授权清晰的模型；代码后端可配置，不需改变通用 Agent 架构。
