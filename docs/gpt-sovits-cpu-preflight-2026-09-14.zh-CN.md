# GPT-SoVITS CPU 候选：隔离试音前核查

2026-09-14。结论：仍可作为质量候选，但当前内存没有足够的保守启动余量；没有安装、下载权重或执行模型。生产 Graph、TTS 和角色未改变。本报告不是试音结果或音质排名。

## 实机状态

本轮 Windows 可用内存快照约 3.46、3.67、最终 3.396 GiB；D 盘约 172 GiB 空闲。主语音/Qwen 环境均为 Python 3.13.7，另有应用自带 Python 3.12。Qwen 继续暂停。

最后公开服务状态：`modelConfigured=true`、`activeSessions=0`、`testFixture=false`。未关闭其他软件、重启服务、开启物理麦克风或发送测试文本到新云服务。

## 固定候选及安装范围

CPUFast 固定审查提交为 `d3e58751282c7d345fb72a643a730cabb672d2b8`。它有 Windows CPU 路径；推荐 Python 3.10，`numpy<2` 不适合直接沿用现有 Python 3.13 的常规 wheel 安装。独立 Python 3.12 可列为待验证路线，不是项目已保证的兼容环境。[项目](https://github.com/baicai-1145/GPT-SoVITS-CPUFast)、[固定依赖](https://github.com/baicai-1145/GPT-SoVITS-CPUFast/blob/d3e58751282c7d345fb72a643a730cabb672d2b8/requirements.txt)

安装脚本还涉及 CPU Torch、CMake、PyAV、分词/读音前端、NLTK/OpenJTalk 资源；不能直接对生产 venv 执行。按其选择 v2ProPlus 的资源清单与发布元数据，模型、配置和字典包合计约 2,106,919,637 字节（1.962 GiB），不含 Python、源码及 wheel。该大小不是运行内存。[安装脚本](https://github.com/baicai-1145/GPT-SoVITS-CPUFast/blob/d3e58751282c7d345fb72a643a730cabb672d2b8/install.ps1)、[发布文件](https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained/tree/main/pretrained_models)、[G2PW 发布文件](https://huggingface.co/baicai1145/g2pw)

## 为什么本轮不加载

默认 CPU 路径禁用 FP16，同时保留 T2S、VITS、SV、BERT、HuBERT；首次中文处理还需 G2PW。没有面向正常中文推理的顺序卸载配置。不能将“CPU 优化”直接理解成小内存模型。[实际初始化](https://github.com/baicai-1145/GPT-SoVITS-CPUFast/blob/d3e58751282c7d345fb72a643a730cabb672d2b8/GPT_SoVITS/TTS_infer_pack/TTS.py#L424)

按所审源码、默认结构和发布字典推导：

| 部分 | FP32 参数存储估算 |
| --- | ---: |
| 当前未绑定 MLM 权重的中文 BERT | 约 1.293 GiB |
| G2PW | 约 0.592 GiB |
| HuBERT | 约 0.352 GiB |
| T2S 的 24 层、512 维主要矩阵 | 约 0.281 GiB |

G2PW 加载时，checkpoint 与新建模型有重叠，释放在复制权重之后。上述部分连同这一重叠约 3.109 GiB，尚未计入整个 VITS、SV、Torch、激活和分配器。对照 3.67 GiB 可用内存并预留 800 MiB，实验预算只有约 2.889 GiB。[G2PW 加载](https://github.com/baicai-1145/GPT-SoVITS-CPUFast/blob/d3e58751282c7d345fb72a643a730cabb672d2b8/GPT_SoVITS/text/g2pw/torch_api.py#L212)、[BERT 实现](https://github.com/baicai-1145/GPT-SoVITS-CPUFast/blob/d3e58751282c7d345fb72a643a730cabb672d2b8/GPT_SoVITS/text/chinese_bert.py)、[T2S 默认结构](https://github.com/baicai-1145/GPT-SoVITS-CPUFast/blob/d3e58751282c7d345fb72a643a730cabb672d2b8/GPT_SoVITS/configs/s1longer-v2.yaml)

**这是配置级估算，不是下载后的逐 tensor 核验，也不是本机峰值实测。** 权重内嵌配置可能不同，不能称为“数学证明机器跑不了”。结论是当前不满足保守试音门槛。后续可在约 5–6 GiB 可用内存下开始单进程短句实验，并保留独立 watchdog、800 MiB 余量和超时；实际要求须根据测量收敛，不保证该门槛足够。

源码存在可选 G2PW INT8 路径，但当前发布列表没有对应权重，不构成现成可用的低内存包。没有删除中文前端、擅自量化或用英文路径代替中文质量实验。[可选路径](https://github.com/baicai-1145/GPT-SoVITS-CPUFast/blob/d3e58751282c7d345fb72a643a730cabb672d2b8/GPT_SoVITS/text/g2pw/torch_api.py#L393)

## 声线与角色条件

代码/权重包的 MIT 标记不自动授权第三方参考声线；依赖模型的原许可证仍须分别保留。未找到本分支随仓提供且权利明确的目标参考女声。参考需为约 3–10 秒的授权录音或允许再合成的合成音。现有 Kokoro 参考可以验证通路，但不能凭其声线转换就宣布声音品质升级。[上游权重卡](https://huggingface.co/lj1995/GPT-SoVITS)、[参考与初始化实现](https://github.com/baicai-1145/GPT-SoVITS-CPUFast/blob/d3e58751282c7d345fb72a643a730cabb672d2b8/GPT_SoVITS/TTS_infer_pack/TTS.py)

项目当前角色配置仍指向 `illustration-v2.json`。对 `assets` 的文件核查未找到 .moc3/.model3.json/.cmo3/.can3/.psd。不能把八层原型算作已交付专业表演资产。新 SDK、角色源资产、声线或云端服务尚未获确认；没有购买、接受新协议、克隆真人或切换默认配置。

## 后续决策

- 本地品质路线：增加可用内存后再进行隔离依赖与短句试音；速度、声线和情绪全部待测。
- 云端品质路线：明确提供方、测试文本外发与试听预算后，才调用新服务；现有 LLM 凭据不能直接当作另一项 TTS 服务授权。
- 角色路线：确认可用的分层/绑定源资产与许可，或确定制作方式和预算，再做真实角色表演样片。
- 当前小模型的三份同文原始音频已核实存在，见 [现有候选对照](D:/workspace/muxiva-avatar/docs/companion-voice-auditions.zh-CN.md)。听评未完成，不能自动判优或替换生产。

总体目标未完成。此前的工程测试、性能数字和研究文档均不能代替声音与角色的最终体验验收。
