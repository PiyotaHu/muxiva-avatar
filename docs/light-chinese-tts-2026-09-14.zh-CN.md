# Windows 轻量中文 TTS 实测（2026-09-14）

## 结论与当前状态

已在这台电脑的 CPU 上跑通两个新候选：Matcha 中文女声和 ZipVoice-Distill INT8，并用相同五句文本重跑 Kokoro FP32 对照。另补测了 ZipVoice 8 步的两句音频。没有运行 Qwen，没有替换线上 TTS，没有修改 Graph、Agent、语音轮次控制或数字人形象。

资源优先的候选是 Matcha；需要可配置参考音色的研究方向是 ZipVoice。但本次没有完成主观听感验收，不能声称任何一款已解决“机械、没有感情、不可爱”。ASR 回读只能筛查内容，不是自然度评分。两者也均未完成商用授权审查，不作为默认产品音色发布。

## 同一句话试听

文本：今天辛苦啦。先休息一会儿，好吗？别着急，我会陪你慢慢把事情理清楚。

Matcha 中文女声：

![Matcha 中文试音](D:/workspace/muxiva-avatar/.artifacts/light-tts/matcha-comparison/matcha-case-2.wav)

ZipVoice INT8 / 4 步：

![ZipVoice 四步试音](D:/workspace/muxiva-avatar/.artifacts/light-tts/zipvoice-comparison/zipvoice-int8-case-2.wav)

ZipVoice INT8 / 8 步（只改变步数，不保证听感更好）：

![ZipVoice 八步试音](D:/workspace/muxiva-avatar/.artifacts/light-tts/zipvoice-8step-comparison/zipvoice-int8-case-1.wav)

Kokoro FP32 / speaker 3 对照：

![Kokoro 对照试音](D:/workspace/muxiva-avatar/.artifacts/light-tts/kokoro-comparison/kokoro-case-2.wav)

惊喜语气的同文样例：[Matcha](D:/workspace/muxiva-avatar/.artifacts/light-tts/matcha-comparison/matcha-case-3.wav)、[ZipVoice 四步](D:/workspace/muxiva-avatar/.artifacts/light-tts/zipvoice-comparison/zipvoice-int8-case-3.wav)、[ZipVoice 八步](D:/workspace/muxiva-avatar/.artifacts/light-tts/zipvoice-8step-comparison/zipvoice-int8-case-2.wav)、[Kokoro](D:/workspace/muxiva-avatar/.artifacts/light-tts/kokoro-comparison/kokoro-case-3.wav)。

没有对样例后期升调、加情绪效果或重新拼接。ZipVoice 使用已有 Kokoro 合成女声的 4.326 秒问候作为参考，不使用真人或名人录音。它不是独立的新声线设计，也不能代表优质授权参考音频下的表现上限。

## 本机性能

Windows / Ryzen 7 5800H / CPU 4 线程 / sherpa-onnx 1.13.5。三个模型顺序运行，不并行压内存。五句涵盖问候、安慰、惊喜、日期百分比、多音字；每句一次。速度为 1，silence_scale 为 1。

| 方案 | 模型加载 | 首批非空 PCM 回调范围 | 五句加权 RTF | 测试进程峰值 RSS |
| --- | ---: | ---: | ---: | ---: |
| Matcha 中文 / 3 步 + Vocos 22k | 1.898 秒 | 62–132 毫秒 | 0.041 | 236 MiB |
| ZipVoice-Distill INT8 / 4 步 + Vocos 24k | 1.983 秒 | 2.32–4.04 秒 | 0.519 | 585 MiB |
| Kokoro FP32 / speaker 3 | 1.814 秒 | 0.33–1.33 秒 | 0.333 | 641 MiB |

RTF = 生成耗时 / 音频时长，越小表示吞吐越快。不是首音时间，也不是声音好坏的评分。

同一安慰句：Matcha 0.404 秒生成 9.114 秒音频，首回调 0.081 秒；ZipVoice 四步 3.426 秒生成 7.019 秒音频，首回调也是 3.426 秒；Kokoro 2.853 秒生成 9.475 秒音频，首回调 0.630 秒。

ZipVoice 八步单独测两句，首回调分别为 6.944 秒和 6.820 秒，几乎等于完整生成时间。它在这台机器上不适合作为低首音方案直接替换。四步和八步都使用同一 INT8 权重，不额外下载模型。

统计限制：

- 首回调从已加载模型的 generate 调用开始计时，可能仍包含前导静音；不是扬声器出声时间。各模型内部断句不同，首回调包含的内容量不同。
- 未包含 ASR、Agent、网络、Host、22.05k→24k 重采样、播放队列、浏览器音频启动。没有测数字人完整端到端时延。
- 加载单独计时，不等于 Python 进程启动总耗时。生成包含模型前端及 ZipVoice 参考条件计算，但不包含 WAV 写盘。
- RSS 是独立合成进程的峰值工作集，不是整机内存需求或私有提交总量。不能仅凭 RSS 保证不发生系统分页。
- 五句各一次，不是 p95、长时稳定性或 ASR/TTS 并发压测。后四句报告中的 warm_repeat 仅表示模型已热，不代表同句重复统计。
- 与以前 Host 测试的 silence_scale=0.2 口径不同，本表只使用本轮直接 API 的同文结果。

原始报告：[Matcha](D:/workspace/muxiva-avatar/.artifacts/light-tts/matcha-comparison/report.json)、[ZipVoice 四步](D:/workspace/muxiva-avatar/.artifacts/light-tts/zipvoice-comparison/report.json)、[ZipVoice 八步](D:/workspace/muxiva-avatar/.artifacts/light-tts/zipvoice-8step-comparison/report.json)、[Kokoro](D:/workspace/muxiva-avatar/.artifacts/light-tts/kokoro-comparison/report.json)。

## 中文内容检查

所有 17 段对照 WAV 均由本地 SenseVoice INT8 顺序回读成功。数字句和“重庆、银行行长、出差、重新、音乐”所在句的识别文字与输入基本一致；Matcha 和 Kokoro 的“太好啦”被识别成“太好了”。没有发现明显整句遗漏，不能据此证明每个声调正确或所有输入都稳定。

数字已在输入中展开成中文，这一轮不验证任意阿拉伯数字、日期串或特殊符号的前端规范化。Matcha 初始化有 Unknown token: shei2 词典告警，本批文本不含“谁”；后续接入前必须加入相应边界用例，不通过硬编码业务句子绕过。

回读记录：[三模型 15 段](D:/workspace/muxiva-avatar/.artifacts/light-tts/asr-content-comparison.json)、[八步补测 2 段](D:/workspace/muxiva-avatar/.artifacts/light-tts/asr-content-8step.json)。ASR 本身也会识别错误，不用于自动宣告音质达标。

## 模型与许可筛选

- Matcha：本次为 matcha-icefall-zh-baker，单一中文女声。声学 ONNX 加 Vocos 共 129,508,635 字节，约 124 MiB，不含词典和下载缓存。官方明确 Baker 训练数据仅限非商业用途，因此这里只做本地研究试音，不直接作为商用产品默认模型。[官方模型说明](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/matcha.html#matcha-icefall-zh-baker-chinese-1-female-speaker)
- ZipVoice：官方 123M 参数、支持中文和英文，支持参考音频；本次 INT8 encoder/decoder 加 Vocos 共 184,384,720 字节，约 176 MiB。官方提醒 INT8 可能损失音质，短词可能遗漏，多音字前端也存在限制。代码仓的 Apache-2.0 不能代替权重、数据和参考音色的许可审查。[官方仓库](https://github.com/k2-fsa/ZipVoice)、[sherpa 部署说明](https://k2-fsa.github.io/sherpa/onnx/tts/zipvoice.html)、[权重卡](https://huggingface.co/k2-fsa/ZipVoice)
- Melo：本机已有且此前听感不满足，不把重复更换音调当成新模型解决方案。[官方模型卡](https://huggingface.co/myshell-ai/MeloTTS-Chinese)
- Piper 中文：有更小权重，但不同声线许可、中文前端依赖各异，没有足够证据说明更适合本次情感女声目标，未继续下载安装。[huayan 模型卡](https://huggingface.co/rhasspy/piper-voices/blob/main/zh/zh_CN/huayan/medium/MODEL_CARD)、[xiao_ya 模型卡](https://huggingface.co/rhasspy/piper-voices/blob/main/zh/zh_CN/xiao_ya/medium/MODEL_CARD)
- Kitten、Pocket、Supertonic：核查到的这些小模型没有可确认的中文生成支持，不因附带中文词典就宣称模型支持中文，也没有下载尝试。[Kitten 实现](https://github.com/KittenML/KittenTTS/blob/main/kittentts/onnx_model.py)、[Pocket 官方语言列表](https://github.com/kyutai-labs/pocket-tts)、[Supertonic 官方仓库](https://github.com/supertone-oss-archive/supertonic)

## 实施边界与后续接入位置

本轮只增加独立下载、试音、回读脚本及实验数据。没有启动新的常驻服务，没有关闭用户程序，没有运行 Qwen，没有删除已有模型，没有提交或 push。

若后续采用其中之一，应作为已有 local_tts Node 的可配置后端，配置管理模型路径、声码器、参考音频及其准确转写、线程、步数和采样率。Master/Agent 不应知道角色音色、模型名或语音轮次策略；既有 turn controller 继续负责打断。输出复用原有 PCM 协议。音频分段需保留完整短句韵律，不能为了造出低首音数字而拆成逐字 TTS。

正式接入前仍需中文短词/多音字/长数字边界、说话中打断、取消后无残留音频、连续多轮和 ASR 并发回归。现阶段完成的是本机可运行性、资源和内容初筛，不是生产稳定性验收。

## 重现入口

- [下载脚本](D:/workspace/muxiva-avatar/scripts/setup-light-tts.py)：四个官方 release 资源；三个有官方 SHA-256 可核对，Vocos 22k release 未提供 digest，使用 HTTPS、官方大小检查并记录本地 SHA-256，不声称四个均有发布方哈希校验。[下载记录](D:/workspace/muxiva-avatar/.artifacts/light-tts/download-all.json)
- [基准脚本](D:/workspace/muxiva-avatar/scripts/benchmark-light-tts.py)：独立低优先级子进程、启动内存门槛、运行期低内存保护、每句超时、原生 PCM 与计时报告。只会停止自己启动的子进程。
- [内容回读脚本](D:/workspace/muxiva-avatar/scripts/check-tts-content.py)：只接受明确 WAV 路径，本地顺序 ASR，不更改音频，不连接云端。
- [固定五句文本](D:/workspace/muxiva-avatar/.artifacts/light-tts/cases.json)、[基准保护逻辑测试](D:/workspace/muxiva-avatar/tests/test_light_tts_benchmark.py)：15/15 纯 fake 测试通过。

在 D:\workspace\muxiva-avatar 中运行；output-dir 请使用新的实验目录，保留已有结果：

```powershell
& .venv\Scripts\python.exe scripts/benchmark-light-tts.py --backend matcha --model-dir .models/tts-candidates/matcha-icefall-zh-baker --acoustic-model .models/tts-candidates/matcha-icefall-zh-baker/model-steps-3.onnx --vocoder .models/tts-candidates/vocos-22khz-univ.onnx --cases .artifacts/light-tts/cases.json
& .venv\Scripts\python.exe scripts/benchmark-light-tts.py --backend zipvoice-int8 --model-dir .models/tts-candidates/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia --vocoder .models/tts-candidates/vocos_24khz.onnx --reference-audio .artifacts/speech-kokoro-fp32/speaker-3-case-1.wav --reference-text '你好，我是你的数字人助手，很高兴认识你。' --cases .artifacts/light-tts/cases.json
& .venv\Scripts\python.exe scripts/benchmark-light-tts.py --backend kokoro --model-dir .models/kokoro-multi-lang-v1_1 --cases .artifacts/light-tts/cases.json
& .venv\Scripts\python.exe -m unittest discover -s tests -p test_light_tts_benchmark.py
```

检查时 localhost:4174/api/status 返回 speechReady=true、avatarAvailable=true、pipeline=muxiva-graph。graph.json、synthesis.py、web/app.mjs、assets/avatar/character.json 的 SHA-256 与本轮开始时一致。
