# 中文声音：现有候选原始对照

这三段使用完全相同的安慰文本，均为已有本机实验的真实输出，本轮只核实文件与报告，没有重新合成或改变生产声线。

> 今天辛苦啦。先休息一会儿，好吗？别着急，我会陪你慢慢把事情理清楚。

以下保留原始音频，未做响度归一、升调或加速；不是严格盲听。请分别关注自然停顿、咬字、亲切感和听久是否疲劳，不要只按声音大小判断。

## 当前基线：Kokoro FP32

![Kokoro 原始安慰样本](D:/workspace/muxiva-avatar/.artifacts/light-tts/kokoro-comparison/kokoro-case-2.wav)

## 候选：Matcha Baker

![Matcha 原始安慰样本](D:/workspace/muxiva-avatar/.artifacts/light-tts/matcha-comparison/matcha-case-2.wav)

本地非商业试音用途；Baker 数据限制未解除，不作为可直接商业分发的默认模型。

## 候选：ZipVoice-Distill INT8

![ZipVoice 原始安慰样本](D:/workspace/muxiva-avatar/.artifacts/light-tts/zipvoice-comparison/zipvoice-int8-case-2.wav)

参考来自现有 Kokoro 合成女声，不是真人或名人音频。没有采用真实人物克隆，也未证明对目标声线的最终效果。

这三份不是“世界一流”验收通过的成品；没有通过主观听评前不切换默认。性能与原始报告见 [既有轻量 TTS 实测](D:/workspace/muxiva-avatar/docs/light-chinese-tts-2026-09-14.zh-CN.md)。
