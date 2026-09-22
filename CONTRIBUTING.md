# Contributing

感谢参与 Muxiva Avatar。这个仓库是 Muxiva 的应用层数字人实现，提交前请保持以下边界：

- Muxiva core 只保留通用 Graph/Node 能力；角色、语音人格和桌宠策略留在本仓库。
- Turn 语义只属于既有 VoiceTurnController；Avatar Runtime 仅消费 VAD、Agent 生命周期和真实播放状态。
- 浏览器页面与 Electron 桌宠共用同一套 `web/` Avatar Runtime，不复制会话或动作逻辑。
- 身体、表情、眨眼、视线和口型各有单一写入者；新增动作优先使用配置化 VRMA。
- 不提交 `.env`、API 密钥、模型权重、用户录音、运行日志或许可证不允许再分发的 VRM。

## Development

相邻目录需要存在 `../muxiva` 和 `../muxiva-pi-agent`。使用 Node.js 24+ 与 pnpm：

```powershell
pnpm install --frozen-lockfile
node scripts/doctor.mjs
pnpm test
```

涉及真实语音链路时，再运行 README 中对应的 Python 和端到端测试。提交应聚焦一个问题，说明架构边界、测试证据和仍未验证的风险。

## Pull requests

1. 从最新 `main` 创建分支。
2. 保持提交可审阅，避免把无关格式化或生成资产混入功能修改。
3. 确保 `pnpm test` 通过；缺失的本地专有/退役资产只能以明确 skip 处理。
4. 新增第三方资产必须同时提交来源、固定版本或提交号、SHA-256 和许可证声明。
