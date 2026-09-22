# 本机中文 TTS 候选与实测边界

核查日期：2026-09-13。目标机器：Windows、Ryzen 7 5800H、约 14 GiB 系统内存、Radeon 集成显卡，无 CUDA。本轮仅研究和记录，没有安装新模型、切换后端或修改生产 TTS。

## 结论

建议先用同一组中文句子和同一份有授权的成年女性参考声音，对照 **GPT-SoVITS v2ProPlus** 与 **ZipVoice-Distill**。前者更适合探索角色音色与自然表达，后者的 CPU/ONNX 部署路径更贴近现有运行栈。两者在本机的首音、持续吞吐和听感均未实测，不能承诺优于当前方案。

“能在 CPU 上运行”“声音自然”“持续实时”“首音低延迟”是不同指标。可爱音色也不等于情绪丰富；单纯升调、加快语速或修改 Agent 人格提示词，不能替代 TTS 的韵律能力。

## 当前运行配置与可能的听感影响

依据 [Graph](../graph.json)、[TTS 实现](../python/muxiva_avatar_speech/synthesis.py) 和 [安装脚本](../scripts/setup-speech.py)：

- 当前为 **Kokoro v1.1-zh FP32**，`speaker_id=3`，即 `zf_001` 中文女声；CPU 4 线程、语速默认 1.0、24 kHz 单声道。
- 当前调用提供文本、音色和语速，没有情感指令、风格描述或参考音频入口。更换现有音色可能改善喜好匹配，但不能保证增加情绪控制。[官方音色映射](https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_1.html)
- `speech_formatter` 配置为最小 12 字、最大 60 字；每个输出片段独立合成，没有传入前后片段的完整文本上下文。这**可能**导致句间语调重置或损失韵律上下文，尚未通过整句/分句 A/B 验证，不能把它说成已确定的唯一原因。
- `pcm_chunk_ms=40` 只是生成后 PCM 的传输切片，**不是每 40 ms 重新合成，也不是“把声音逐字拼起来”**。要分别检查文本分句、模型生成和音频播放，不能混为一谈。

## 已有本机实测

以下报告使用真实 Muxiva Project Python Host、sherpa-onnx 1.13.5 CPU，仅包含三个短句；不是长时并发或主观音质验收。

| 输入 | Kokoro：首 PCM / RTF | Melo：首 PCM / RTF |
| --- | --- | --- |
| 你好，我是你的数字人助手，很高兴认识你。 | 407.9 ms / 0.564 | 267.7 ms / 0.445 |
| 今天的天气怎么样？请帮我查询一下。 | 937.8 ms / 0.509 | 692.3 ms / 0.503 |
| 请从一数到十：一，二，三，四，五，六，七，八，九，十。 | 1449.6 ms / 0.510 | 728.5 ms / 0.671 |

报告：[Kokoro FP32](../.artifacts/speech-kokoro-fp32/report.json)、[Melo ONNX](../.artifacts/speech-melo/report.json)。这些是本机生成的 `.artifacts` 文件，其他 checkout 未必包含。

限制：

- 首 PCM 指 TTS 首批音频数据，不是用户说完到扬声器出声的端到端延迟。
- RTF 为合成耗时 / 音频时长；小于 1 表示该样例生成快于播放，不代表任何文本和并发负载都实时。
- Kokoro 使用 4 线程、Melo 使用 2 线程；这不是统一线程配置的全面横向评测。
- Melo 的数数样例在 ASR 回读中出现明显缺失；需要听音复核，不能仅凭较快的速度宣布更好。
- 已测的是 **Sherpa-ONNX 的 Melo 后端**，不是原始 PyTorch Melo 加 OpenVoice2 的完整组合。

## 候选简表

| 候选 | 中文音色 / 表达能力 | 本机可行性与未测边界 | 许可与官方依据 |
| --- | --- | --- | --- |
| **GPT-SoVITS v2ProPlus** | 参考声音克隆；可探索有表现力的参考声或定制微调。不是现成的自然语言情绪滑杆。 | 官方明确提供 Windows `--Device CPU` 安装。官方 M4 CPU RTF 0.526 不能套用到 5800H；本机首音、内存及持续实时性未知。 | 代码与官方权重标 MIT；参考声音及第三方角色权重仍需各自授权。[项目](https://github.com/RVC-Boss/GPT-SoVITS)、[官方权重](https://huggingface.co/lj1995/GPT-SoVITS) |
| **ZipVoice-Distill，123M** | 中文/英文零样本克隆，需要参考音频及准确转写；不能承诺直接通过文字控制情绪。 | 官方提供 CPU 多线程、ONNX、INT8 和 sherpa-onnx 路径；蒸馏可采用 4 步。它是离线生成模型，不因 PCM 分包就成为真流式。未在本机实测；INT8 有音质折损风险，速度也须实测。 | 代码 Apache-2.0；核查时官方 HF 权重页未明确独立许可，产品分发前需确认。[项目](https://github.com/k2-fsa/ZipVoice)、[部署](https://k2-fsa.github.io/sherpa/onnx/tts/zipvoice.html)、[权重页](https://huggingface.co/k2-fsa/ZipVoice) |
| **MeloTTS / OpenVoice2** | Melo 提供中文基声；OpenVoice2 的音色转换不等于自动改善基声的停顿和抑扬顿挫。 | Melo ONNX 已有上表本机速度基线。OpenVoice2 官方示例支持 CPU，但采用先合成、再转换的两阶段流程；新增阶段耗时、整链路首音均未测。 | 官方标 MIT。适合作为音色定制对照，不能当作已验证的情感升级。[Melo](https://github.com/myshell-ai/MeloTTS)、[OpenVoice](https://github.com/myshell-ai/OpenVoice)、[实际流程](https://github.com/myshell-ai/OpenVoice/blob/main/demo_part3.ipynb) |
| **CosyVoice3 0.5B** | 支持参考声音与情绪、语速等指令，表达控制更完整。 | 官方实现有 CPU 路径，但 Windows 依赖、首音和持续实时性未在本机验证。官方 150 ms 指标不能作为此电脑保证；CUDA/TRT/vLLM 加速也不能默认可用。 | 模型 Apache-2.0。可列第二阶段质量对照。[项目](https://github.com/QwenAudio/CosyVoice)、[CPU 实现](https://github.com/QwenAudio/CosyVoice/blob/main/cosyvoice/cli/cosyvoice.py)、[模型](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) |
| **Qwen3-TTS** | 1.7B CustomVoice / VoiceDesign 支持指令控制；0.6B CustomVoice 不支持该能力，当前官方实现明确忽略 `instruct`。 | 不能把 0.6B 推荐成低成本情绪指令版。1.7B 在这台无 CUDA、约 14 GiB 内存电脑上的计算和内存余量需验证；官方 97 ms 不是本机成绩。 | Apache-2.0。[型号能力表](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)、[0.6B 实现](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/inference/qwen3_tts_model.py) |

## 两条建议路线

### A. 听感优先：GPT-SoVITS v2ProPlus

选择有授权、自然轻快而不过度表演的成年女性参考声音，先离线做中文对照听评，再测 CPU 性能。角色音色和情绪表现必须以实际输出判断，不能只听官方演示就保证本机效果。若明显低于实时或影响 ASR/动画，不直接替换常用链路。

### B. 资源与接入成本优先：ZipVoice-Distill

用同一份参考声音与准确转写，比较蒸馏步数及适用 ONNX 版本的速度和自然度，验证是否能复用现有 `local_tts` 的配置化后端边界。它不会自动解决首句等待或文本分句的韵律问题；权重授权也须单独确认。

两条路线都应保留当前 Kokoro/Melo 作为可回退基线。后续如实施，只在 TTS 后端能力和配置边界内扩展，不新增业务 Agent Loop、Turn 实体或把模型细节塞进通用核心。

## 下一次验证应记录什么

- 同样的普通问答、疑问、安慰、惊喜、数字/日期/百分比、中英混读及长回答；不要只测一句问候。
- 单独听评音色喜好、重音与停顿、情绪自然度、错漏字，避免把高音调直接等同于“可爱”。
- 冷启动与热启动、首 PCM、真实开始播放、持续 RTF、进程峰值内存；同时运行 ASR 和数字人观察资源竞争。
- 连续回答、打断取消、迟到音频隔离和长时间稳定性。
- 整句与当前 12–60 字分句 A/B，分别记录听感和首音代价。

上述均是后续验证计划，不代表本轮已安装、已测试新候选或已更换生产 TTS。
