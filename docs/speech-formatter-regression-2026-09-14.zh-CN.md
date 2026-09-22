# 通用语音切句：Windows 实机回归记录

2026-09-14。此阶段修正内容完整性、分段和播放链路，不包含新声线、美术、绑定或表演资产。总体体验目标仍未完成。

## 本轮修改

修改位于现有 Muxiva `builtin.speech_formatter`，不增加 Node、Agent loop、Turn 实体、配置字段或业务词表：

- ASCII 句末点采用下一字符/完成事件判断，避免把流式 `26.` + `25°C` 提前提交为两句；连续标点也不能吞掉下一句 `.5` 的小数点。
- 已到达的句号不能绕过原始文本最大长度。长句优先在短语标点、空白以及较短 ASCII 词元边界提交，避免硬切普通单词、温度和百分比。
- 不以 ASCII 冒号切开网址协议；短网址词元受保护，超长网址沿用既有省略状态跨片处理。
- URL 省略之前尊重原文本边缘的空白终止符，修复分片后把网址后面的正常正文一并吞掉的问题。
- 一次收集字符索引、游标前进、最后移除已消费前缀，避免同一大输入每发一段就复制整个余串。

Agent 原始文本继续走聊天分支；格式化纯文本继续走 TTS 分支。VoiceTurnController 的有效 ASR 判定与取消语义均未修改。

这不是完整的自然语言分词：无边界超长词元仍需上限兜底，缩写等语言歧义未全面解决；上限统计 Markdown 替换前的 Unicode 标量值，不限制替换提示展开后的长度。没有添加人为定时等待，小数点只等待后续数据或完成（到达上限时仍可能强切）。

## 分层验证

- graph-json 库：38 项通过，其中本轮新增 24 项切句/真实 Node 输出测试。
- graph_v1：10 项通过，覆盖 Factory、Graph 配置、Port 与运行时取消契约。
- 混合中英、温度、百分比、千分位、时间、UTF-8、长文本、最小/最大长度与所有碎片尺寸回归；原始切句检查字节守恒及上限。
- 新测试调用真实 `Node::on_process → emit_chunks → format_chunk`，断言 TTS 分支发出的 Text、Port 与 sequence；不仅检查内部切句。
- 真实 Node 的短/长 URL 全碎片尺寸测试首次失败：省略 URL 时误吞后面的 `and`。修复空白终止符后全部通过，没有弱化断言。
- Windows CLI 离线构建成功；`git diff --check` 无空白错误（Git 有既有 LF/CRLF 提示）。

### 本机端到端

使用现有 `tests/e2e.mjs`，显式设置刚构建的 `MUXIVA_BINARY`，三种场景均通过：

| 场景 | 文字发送到首 PCM 包 | 验证 |
| --- | ---: | --- |
| 新增可选 formatter 样本 | 4184ms | 流式小数/网址原文留在聊天，真实音频和动作事件正常 |
| 原默认样本 | 3161ms | 原有真实链路回归保持通过 |
| 原长语音样本 | 4504ms | 连续 25.14 秒、633 包 PCM，无样本缺口/重复，符合媒体限速；播放中取消回执 61ms |

每次使用独立临时应用端口和同一个真实会话内的两次 Agent 请求。模型响应来自 **本机确定性 HTTP 夹具**，不是生产 LLM 质量验证；清除测试进程的模型密钥和 workspace id，并断言夹具没有收到 Authorization。真实 Muxiva、ASR、Kokoro、Avatar 与传输参与测试。

ASR 输入来自已有本地合成录音，通过麦克风传输接口按实时速度注入，未开启物理麦克风。三轮均识别出预期内容，有效中间识别触发取消早于 ASR final；取消后旧 PCM 不复活。音频/动作 sequence、采样率和起始 offset 一致。

这些数值不是声学首音、热会话分位数、主观自然度或音画视觉同步评分。25 秒稳定性不等于 30 分钟整机验收。首包 3–4.5 秒仍有明显等待，未达到总体响应目标。

端到端测试没有直接截获 TTS 输入文本；数值与网址省略正确性由真实 Rust Node 出口测试验证，不能从显示文字或 ASR 回读推断音色质量。

## 构建与部署边界

构建路径：`D:\workspace\.build\muxiva-windows\debug\muxiva.exe`，文件时间 2026-09-14 02:55:00 +08:00，大小 117180416 字节。

SHA-256：`932092492B6150600B57BD1817A0BCAA204C8E9461B16E02349BD568D2D50987`。

当前文件配置与启动脚本默认指向此路径，按新会话启动 runtime。未重启 4174 服务；无法仅由公开状态排除它启动时继承了另一个二进制路径，因此不声称已观察到生产会话加载新 exe。回归明确指定了上述二进制。

Muxiva 仓库原有 `node_library.rs`、`typescript_host.mjs`、`docs/nodes/python.md` 未提交修改均保留，未编辑；完整重建也包含其中编译所用的现有变更，不把整个二进制描述为只有切句差异。未提交、push 或改动其他运行中的 Muxiva 服务。

复验：

```powershell
# 先使用本机已有 GNU/LLVM Rust 环境配置
cargo test --offline --locked -p muxiva-graph-json --lib
cargo test --offline --locked -p muxiva-graph-json --test graph_v1

# 在 D:\workspace\muxiva-avatar 下
$env:MUXIVA_BINARY = 'D:\workspace\.build\muxiva-windows\debug\muxiva.exe'
node tests/e2e.mjs --formatter
node tests/e2e.mjs
node tests/e2e.mjs --long
```

## 尚未完成

Kokoro 声线、专业角色与动作资产没有升级；没有采购、开通新语音云服务、克隆真人声音或接受新 SDK/素材许可。本阶段的测试数量不能证明“世界一流”或陪伴自然度。后续优先级仍是声线同文盲听、专业角色纵向样片与真实声学/长时验收。
