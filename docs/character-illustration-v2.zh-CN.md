# 分层互动立绘 v2：实现、使用与验收边界

更新日期：2026-09-14。v2 已设为默认角色，完成本机分层视觉检查、自动回归及两次真实文字语聊验证。具体证据与未覆盖范围见文末；不把短时验证等同于长期稳定性或商业顶级美术验收。

v2 是正面限定的分层 2.5D 展示：图层有独立网格、父子支点和局部变形，但不是完整 Live2D Cubism 工程，也不是可以自由绕看的三维人物。升级发生在前端展示和角色素材中，没有新增 Agent、Turn 实体或第二条对话循环。

## 正常预览与测试页面

在本地应用已经启动、端口为 4174 时，可在浏览器输入以下地址。若服务配置了其他端口，应替换端口号；本说明不自动启动或重启服务。

```text
正常语聊应用，明确选择 v2：
http://127.0.0.1:4174/?character=character-illustration-v2

原 v1 的独立预览：
http://127.0.0.1:4174/?character=character-illustration-v1

仅供素材和姿态检查的实验页：
http://127.0.0.1:4174/illustration-lab.html
```

正常预览使用同一个 [app.mjs](D:/workspace/muxiva-avatar/web/app.mjs)，可以在原有权限和配置下连接真实语聊。移动鼠标、轻触角色画布以及互动按钮本身不需要连接会话；它们不会启用麦克风、发送模型请求或让 Agent 生成动作。

[实验页](D:/workspace/muxiva-avatar/web/illustration-lab.html) 与其 [脚本](D:/workspace/muxiva-avatar/web/illustration-lab.mjs) 只运行本地渲染器。其“招手定格”“点头定格”“看向左边/右边”等按钮会人工推进动画，并停在选定姿态用于检查接缝。**这些定格不是实际语聊，也不是语音同步或端到端性能的证据。** 实验页不连接 Agent、不启用麦克风；传给渲染器的播放状态为 false。白色、深灰和棋盘背景用于检查抠图边缘，不是原始素材的透明通道。

不带预览参数的[默认页面](http://127.0.0.1:4174/)由 [character.json](D:/workspace/muxiva-avatar/assets/avatar/character.json) 决定，现与 illustration-2.0.0 的发布配置完全一致。旧网址若带 character=character-illustration-v1，仍明确选择旧版，刷新不会切换版本。原 [v1 配置](D:/workspace/muxiva-avatar/assets/avatar/character-illustration-v1.json)、[v1 素材清单](D:/workspace/muxiva-avatar/assets/avatar/illustration-v1.json) 和已有 VRM 版本保留；本地 VRM 导入仍采用完整加载成功后再替换画布、失败保留旧角色的方式。

## 素材与八个独立部件

- [character-illustration-v2.json](D:/workspace/muxiva-avatar/assets/avatar/character-illustration-v2.json)：角色名称、版本、取景和动作强度。
- [illustration-v2.json](D:/workspace/muxiva-avatar/assets/avatar/illustration-v2.json)：图像来源、局部区域、图层裁切、显示范围、支点、父子关系和绘制顺序。
- [illustration-parts-v2.png](D:/workspace/muxiva-avatar/assets/avatar/illustration-parts-v2.png)：imagegen 生成的部件图集，当前为 1254 × 1254 的 RGB PNG。
- [illustration-eye-white-v2.png](D:/workspace/muxiva-avatar/assets/avatar/illustration-eye-white-v2.png)：imagegen 生成的眼白补全来源，当前为 1024 × 1536 的 RGB PNG。
- [原中性图](D:/workspace/muxiva-avatar/assets/avatar/illustration-neutral-v1.png)、[原闭眼图](D:/workspace/muxiva-avatar/assets/avatar/illustration-blink-v1.png)、[原开口图](D:/workspace/muxiva-avatar/assets/avatar/illustration-speaking-v1.png)：保留作为同源面部、眼部与嘴部合成来源，而不是将整个人在三个状态间切换。

当前图集对应八个独立 mesh。父子关系与前后遮挡顺序分别由 manifest 配置；“挂在头部下面”表示跟随头部变换，并不意味着画在脸前面。

| 部件 | 父级 | 当前作用 |
| --- | --- | --- |
| body | 根节点 | 躯干呼吸、轻微重心变化 |
| head | body | 小幅头部侧倾、俯仰和正面限定偏转 |
| leftHair | head | 左马尾跟随头部，并叠加有界迟随 |
| rightHair | head | 右马尾跟随头部，并叠加有界迟随 |
| leftArm | body | 左肩支点运动与肘腕局部弯折 |
| rightArm | body | 右肩支点运动与肘腕局部弯折 |
| skirt | body | 裙部跟随躯干与轻微摆动 |
| legs | 根节点 | 独立腿鞋素材，当前不做行走或逐腿关节动画 |

手臂不是整块图片只围着肩膀旋转：manifest 还提供 elbow、wrist 坐标，网格按局部权重应用肘部和腕部矩阵。它仍是一张绘制好的手臂图像发生有限弯折，**没有独立手指骨骼，也没有真实掌面翻转、抓握或任意手势生成**。大腿与小腿使用新部件图小幅收窄，腿鞋部件独立定位；不压窄整个角色，也不做动态瘦腿。静态轮廓采样显示较旧图约缩窄 5–7%，这是部分截面的近似值，不是每个部位的精确比例承诺。

完整生成提示词、来源与最终素材路径见[美术提示词记录](D:/workspace/muxiva-avatar/docs/illustration-v2-art-prompts.zh-CN.md)。imagegen 用于补绘可独立运动的身体、头发、手臂及眼白；未使用带假棋盘的中间输出作为透明素材。

### RGB 绿幕不是 PNG alpha

图集是带明确绿色背景的 RGB 原图，不含真正的 alpha 通道。manifest 显式声明 chromaKey 和容差，运行时 shader 根据色键生成遮罩并处理绿色溢色；不是宣称图片原本透明，也不是把绘进图片的棋盘当成透明。

渲染器会检查部件裁切范围是否同时包含可剔除背景及可见主体。白衬衫和银发不作为白色色键剔除。绿色边缘、发丝细节、相邻图集区域串色以及合成接缝仍需在不同背景上目视验收，不能只依据配置校验通过就认定干净。

## 眼神与面部合成

[IllustrationRenderer](D:/workspace/muxiva-avatar/web/illustration.mjs) 在头部图层上按配置区域合成原中性图中的面部，减少重新生成图集造成的五官变化；这不等于逐像素复刻保证。

有眼白与虹膜配置时，眼神由补全眼白、原图局部虹膜采样和眼部区域遮罩组合；虹膜小幅移动，闭眼时再合成原闭眼图。眼部跟随头部父变换，不是把整块脸或眼眶一起平移来假装看向鼠标。嘴部局部使用原闭口和开口来源，微笑只是有限的嘴角变形与合成，不是任意情绪生成。

素材仍只提供正面信息。眼球移动后暴露的眼白、头部偏转后的颈肩接缝、袖子与身体的遮挡都依赖已绘制内容；单图中原来被遮挡的结构无法靠数学准确恢复。幅度过大仍可能露出不完整补绘、拉伸或二维纸片感，不支持真实侧脸、背面或自由视角。

## 本地互动与状态

[IllustrationMotion](D:/workspace/muxiva-avatar/web/illustration-motion.mjs) 只接收有界输入并输出归一化动作，不持有自己的渲染循环，也不理解回答语义。

- 鼠标位置通过稳定展示容器进入 renderer，再结合当前相机、头部位置转换为注视目标。眼神先响应，头部较慢跟随；鼠标离开、指针取消、窗口失焦和页面隐藏时释放注视并缓回中间。
- 轻触角色画布或“打招呼”触发 greet；“点头回应”触发 acknowledge。它们是预设的本地反馈，不是 Agent 工具调用。互动序号只消费一次，重复或迟到的旧序号不能重新触发动作。
- 默认分层角色首次加载成功时也会回应一次 greet，之后回到自然待机；不会循环机械招手，也不因此连接语音或打开麦克风。
- idle、listening、thinking 是展示状态：应用已有会话和麦克风状态每帧传入，不由渲染器发起识别、调用模型或决定打断。它们不会自行制造说话口型。
- 导入不支持这些接口的 VRM 后，互动按钮禁用、提示隐藏，稳定容器上的监听不会继续调用已销毁的立绘对象。

减少动态效果由操作系统 prefers-reduced-motion、角色的 reducedMotion 配置或实验页开关控制。启用后禁用可见手势并降低头身、头发和眼神移动幅度，但不关闭真实语音口型。motion.enabled=false 则关闭整个动作输出，包括口型；这两个选项含义不同。

## 语音同步与架构边界

原 [avatar_animation Node](D:/workspace/muxiva-avatar/.muxiva/nodes/avatar_animation/node.py) 从 TTS PCM 生成能量动画事件；前端继续复用 [AvatarTimeline](D:/workspace/muxiva-avatar/web/avatar-timeline.mjs)。应用将 [本地音频播放器](D:/workspace/muxiva-avatar/web/audio.mjs) 的实际播放流、序号、已消费样本位置和采样率交给 renderer，由 timeline 采样对应的嘴形强度。

因此，驱动嘴形的是对应音频的真实播放位置，不是文本到达、模型思考状态或点击反馈。停止与取消关闭嘴部，手势平滑释放；取消水位继续拒绝较旧音频。新会话显式清理语音序号状态，UI 互动的已消费序号不会因此回退。

**当前仍是音频能量驱动的开合，不是中文音素级 viseme、唇读或语义表情。** 分层升级不选择或更换 TTS 后端，不要求新 Agent loop，不给 Muxiva 核心添加角色姓名、服装、图片坐标或语音业务策略。

## 已执行的局部回归

这里只记录本说明编写前已实际执行的两组独立测试；不是完整套件或最终 UI 验收结论。

- [character-import.test.mjs](D:/workspace/muxiva-avatar/tests/character-import.test.mjs)：23 项通过。执行实际 app 源码，注入 fake DOM、renderer、音频和传输接口；覆盖加载失败保留、并发导入、画布恢复、pending 释放、稳定容器事件、互动不发送模型请求、失焦释放及 VRM 控件禁用。音频与网络为进程内替身，没有打开真实设备或调用真实模型。
- [illustration-interaction.test.mjs](D:/workspace/muxiva-avatar/tests/illustration-interaction.test.mjs)：17 项通过。覆盖注视响应顺序、退出缓回、一次性交互、重复/过期序号、取消与重连、单手组合动作、有限值、减少动态效果及真实播放口型边界。

可单独重跑上述两组，不启动语聊或模型：

```powershell
node --test D:/workspace/muxiva-avatar/tests/character-import.test.mjs D:/workspace/muxiva-avatar/tests/illustration-interaction.test.mjs
```

参数测试不能证明素材质量、绿幕边缘、手臂遮挡或真实首音时延；这些要以实际渲染和真实链路分别确认。

## 最终集成验收（2026-09-14）

- 默认配置已切至 illustration-2.0.0。仅重启了已核实且无活动会话的本地数字人服务；服务重新报告 avatarAvailable=true、speechReady=true、pipeline=muxiva-graph。
- 最后一次完整 JavaScript 套件：在 D:/workspace/muxiva-avatar 运行 `node --test tests/*.test.mjs`，220/220 通过，零失败、零跳过，约 60 秒。随后新增的 [面部配置与生产资源测试](D:/workspace/muxiva-avatar/tests/illustration-face-config.test.mjs) 单独运行 7/7 通过；合计 227 项，不把这 7 项描述为已包含在前一次全套运行中。
- 实际浏览器检查全身与近景、左右注视、招手姿态、白/深灰/棋盘背景，以及约 645 像素宽的正常应用布局。发现并修复绿色边缘、重复眼眶、相邻图集碎片、手臂向内折、外露发根裁切口与颈部硬接缝；腿部小幅收窄并保持全身可见。
- 手臂中段定格显示左手动作约 0.76、右手 0，肩肘腕联合向外抬起；减少动态效果后相同触发两手均为 0。实验页结果只用于姿态检查，不作为真实语音证据。
- 正常页面实际渲染短时约 60 FPS；启动本地会话时一次观察约 45 FPS，随后恢复。浏览器 warn/error 记录为空。这不是长时压力或所有硬件性能保证。
- 真实语聊验证一：从正常 UI 连接既有 Graph，发送“用两句话说说保持好心情的小建议。”；收到真实模型回答及 TTS 音频。播放完观测已播放 247692 个样本、260 个动画事件、口型峰值 0.96，结束后嘴形和播放缓冲均为 0。
- 真实语聊验证二：请求一段花园描写。播放中 UI 显示口型 0.78、峰值 0.99、播放缓冲 131ms、已播放样本 246528；点击“停止回答”后嘴形、缓冲、样本位置均归零，随后正常结束会话。未开启或测试物理麦克风，本次不把 ASR/VAD 打断声明为重新实测。
- Graph 与本地 TTS 实现文件 SHA-256 相较本轮开始未变；本次没有更换音色、加载 Qwen、改 Agent / Turn 逻辑或创建另一条语聊链路。

剩余边界：仍非完整 Live2D 制作，没有独立手指、真实掌面翻转、任意表情或音素级嘴型；大幅转头与肢体遮挡受二维补绘限制。当前完成了可用的分层互动升级，不宣称已达到世界一流商业角色质量，也不保证任意场景或长期高可用。
