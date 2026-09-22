# Qwen3-TTS 本地独立试验准备

日期：2026-09-13。按用户最新要求，先完成数字人形象，Qwen 试听暂缓。

**模型下载、离线文件校验、独立依赖安装与 `pip check` 已完成（无损坏依赖）。没有加载完整模型、运行算子探针、生成试听、测速或替换生产 TTS。**

## 隔离范围

- 独立 Python 环境：`.venv-qwen-tts/`，不修改现有 `.venv/`。
- 官方模型：`.models/qwen3-tts-0.6b-customvoice/`。
- 安装脚本：[setup-qwen-tts.py](../scripts/setup-qwen-tts.py)。
- 待运行试验脚本：[benchmark-qwen-tts.py](../scripts/benchmark-qwen-tts.py)。目前仅做了语法检查。
- 实际文件与 SHA256：[model-manifest.json](../.artifacts/qwen-tts/model-manifest.json)。
- 已安装的完整包版本：[installed-packages.json](../.artifacts/qwen-tts/installed-packages.json)。

没有修改 Muxiva core、Agent、Graph/master、生产 TTS node 或默认音色；没有云端调用。

## 下载与依赖

选用官方 [Qwen3-TTS-12Hz-0.6B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice)，Apache-2.0，固定 revision `85e237c12c027371202489a0ec509ded67b5e4b5`。

11 个必需文件合计 **2,498,383,610 字节，约 2.327 GiB，下载 100%**。主权重 1,811,626,576 字节，声音 tokenizer 权重 682,293,092 字节。两份权重使用官方 LFS SHA256 校验；其他文件先核对固定 revision 的 Git blob，再记录 SHA256。已完成独立离线复核。

固定安装版本：Python 3.13.7、CPU-only `torch==2.8.0+cpu` / `torchaudio==2.8.0+cpu`、`qwen-tts==0.1.1`、`transformers==4.57.3`、`accelerate==1.12.0`、`numpy==2.2.6`。官方建议 Python 3.12；本次使用机器现有 Python 3.13 的 Windows wheels，整模运行兼容性尚未验证。[官方安装说明](https://github.com/QwenLM/Qwen3-TTS#environment-setup)、[PyPI 包](https://pypi.org/project/qwen-tts/0.1.1/)。

只从官方 PyTorch CPU wheel 索引、PyPI 与 Qwen 官方 Hugging Face 仓库获取内容；未安装 FlashAttention、CUDA/ROCm 或来历不明的可执行安装器。

## 下次继续前必须知道

- 官方 0.6B CustomVoice **不支持情感 `instruct` 控制**，实现会忽略该参数。未来计划先听 `Serena`（温柔中文女声）与 `Vivian`（明亮中文女声）；尚未判断它们是否符合用户的亲切甜美偏好。[能力与音色表](https://github.com/QwenLM/Qwen3-TTS#custom-voice-generate)、[0.6B 处理逻辑](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/inference/qwen3_tts_model.py)。
- 1.7B CustomVoice 支持指令控制，但没有下载或安装其权重。官方文件元数据合计约 4.52 GB，内存和运算负担明显更高，不能把它当作本机已验证方案。[1.7B 官方模型](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)。
- 本机 Ryzen 7 5800H、约 13.87 GiB 可用总物理内存、Radeon 集显，无 CUDA。核查期间空闲仅约 2–3 GiB，不能为试验擅自关闭其他用户程序。
- 仅读取 safetensors 元数据得出的参数存储预算：主模型 905,788,672 参数，tokenizer 170,557,441 参数；全 BF16 约 **2.00 GiB**、全 FP32 约 **4.01 GiB**。这些不含 Python/Torch、临时张量、解码激活与桌面余量，**不是实际峰值内存**。
- 官方接口接受 CPU 和不同 dtype，但本机 BF16/FP16 算子及整模兼容、速度均未验证；不能因为参数占用小就认定适合实时语聊。[官方 CPU/dtype 参数](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/cli/demo.py)。
- 试验脚本在加载前要求半精度至少 4.5 GiB、FP32 至少 7 GiB 空闲；运行期间若空闲内存持续低于 1 GiB，会终止**自己的测试子进程**。这是保守试验护栏，不是官方硬件下限，也不保证所有文本都安全。

## 安全校验命令（不做推理）

在仓库根目录运行：

```powershell
.\.venv-qwen-tts\Scripts\python.exe -m pip check
python scripts/setup-qwen-tts.py --verify-only
```

`--verify-only` 只读取本机 manifest 与模型文件、校验大小和 SHA256，不访问网络，也不载入模型张量。

## 用户明确允许后再执行的命令

下面的命令本轮**没有执行**。需先让空闲内存满足门槛，并确认不与其他重负载工作并行。

```powershell
# 小算子兼容性检查；结果仍不等于整模推理已通过。
.\.venv-qwen-tts\Scripts\python.exe scripts/benchmark-qwen-tts.py --probe

# 只有上一步通过并确认资源余量后，再进行有保护的短句试听。
.\.venv-qwen-tts\Scripts\python.exe scripts/benchmark-qwen-tts.py --dtype bfloat16 --case-count 1 --speakers Serena,Vivian --run-name official-bf16
```

首句与现有 [Kokoro FP32 报告](../.artifacts/speech-kokoro-fp32/report.json) 相同：“你好，我是你的数字人助手，很高兴认识你。”

官方 `generate_custom_voice` 目前整段生成后才返回 PCM；`non_streaming_mode=False` 仅模拟流式文本，并不会让这个 Python 包调用流式返回音频。因此脚本的首 PCM 是完整音频数组首次返回时间，**不是首个 codec token、不是扬声器首音，也不是端到端语聊延迟**。未试验前，不应引用官方 GPU 97 ms 指标作为这台电脑的结果。[官方函数说明](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/inference/qwen3_tts_model.py)。
