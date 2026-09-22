# 沉浸式二次元角色：制作、绑定与交付规范

> 后续用户决策（2026-09-14）：个人本地使用、开源展示，角色自制，不采购。下文为此前路线评估，不再将专业外部资产或 Live2D 作为继续实施的前提。当前进度见 [自制候选 v3](selfmade-character-v3.zh-CN.md)。质量验收标准仍保留，但不能用路线建议替代实际制作。

核查日期：2026-09-14。状态：技术路线与制作 brief，不是成品验收报告，也不是采购授权。

## 1. 结论与范围

正面近距离二次元交流，优先选择 **专业立绘拆分与补绘 + 完整 Live2D Cubism 绑定 + 原生 Web SDK 展示适配**。保留现有语音链路、真实播放时钟和取消协议。品质来自美术、形变设计、表情与动作制作，换 SDK 或增加摆动幅度不会自动补齐这些能力。

如果目标变成走动、转身、空间交互和多视角，则采用专业制作的 VRM 1.0 模型，复用已有 Three.js/three-vrm；不继续在此前不满意的程序造型上堆补丁，也不同时重做两套角色。当前首先验收正面与三分之四脸、胸像交流，随后完善全身。

八层图片版本只保留为链路与交互原型。它验证了本地展示、眼嘴驱动、播放同步与取消，**没有证明高品质角色、真实表情绑定、音素级口型或长期沉浸体验已完成**。

本 brief 只覆盖角色资产与展示。云端音色需另行获得用户批准及声音使用授权；未实测、未获授权的音色不能算交付能力，不得擅自替换生产 TTS。

## 2. 当前环境与原型的真实上限

本轮注册表只读核对到 AMD Ryzen 7 5800H with Radeon Graphics。既有记录为约 13.87 GiB 总物理内存、Radeon 集显、无 CUDA；本轮 WMI 受权限限制，没有重新测定内存/GPU 驱动。此前 AMD/ANGLE/D3D11 浏览器短时约 60 FPS，不能外推为任意专业模型的保证。[硬件记录](D:/workspace/muxiva-avatar/docs/qwen-tts-local-setup.zh-CN.md)、[既有渲染记录](D:/workspace/muxiva-avatar/docs/character-v3.zh-CN.md)

| 当前实现 | 已有能力与代码证据 | 距离成品的缺口 |
| --- | --- | --- |
| 头与脸 | [illustration.mjs:74](D:/workspace/muxiva-avatar/web/illustration.mjs:74) 是矩形纹理网格；[430](D:/workspace/muxiva-avatar/web/illustration.mjs:430) 通过父子变换转动头部 | 转平面不等于侧转脸；鼻、下颌、近远眼和脸轮廓没有按角度制作形变 |
| 眼与嘴 | [illustration.mjs:136](D:/workspace/muxiva-avatar/web/illustration.mjs:136) 合成局部脸、眼白、虹膜、闭眼/张嘴图 | 不是上下眼睑、口腔、牙齿、舌头的完整绑定；图片插值不是完整嘴型 |
| 表情 | [illustration.mjs:590](D:/workspace/muxiva-avatar/web/illustration.mjs:590) 只接受 neutral/portraitSmile，保存权重未驱动完整脸部形变 | 没有真正制作的开心、关切、惊讶等联动；motion smile 只修饰局部嘴贴片 |
| 手臂与手 | 两段网格权重、肘腕矩阵，可有限抬臂 | 无手掌翻转、手指、姿态替换及大幅动作修形 |
| 衣发 | [illustration-motion.mjs:321](D:/workspace/muxiva-avatar/web/illustration-motion.mjs:321) 为低通跟随与周期扰动，左右发层复用一个标量 | 非逐束绑定物理；大幅运动暴露轮廓、遮挡和接缝问题 |
| 动作 | [illustration-motion.mjs:208](D:/workspace/muxiva-avatar/web/illustration-motion.mjs:208) 为有限 greet/acknowledge 程序包络 | 缺动画师编排的准备、跟随、停顿、回位及动作变体 |
| 语音口型 | [animation Node:108](D:/workspace/muxiva-avatar/.muxiva/nodes/avatar_animation/node.py:108) 明确输出 rms_envelope/mouth_open | 响度无法分辨闭唇、圆唇、展唇；嘴张到 0.99 不是准确率 |
| 原型资产 | [illustration-v2.json](D:/workspace/muxiva-avatar/assets/avatar/illustration-v2.json) 为 8 层共享图集，画布 1024×1536 | 绿幕扣色、贴片和颈部淡出是原型边界处理，不应成为正式母版流程 |

应保留的工程成果：安全加载/资源释放、会话水位、实际播放采样时钟、停止清口型、用户指针交互和减少动态效果选项。美术路线改变不意味着这些需要重建。

## 3. 官方路线与本机适用性

| 路线 | 本需求中的定位 | 前提 |
| --- | --- | --- |
| Live2D Cubism Web | 正面插画质感、精细表情和视线的首选 | 真正分层并补全遮挡的 PSD、完整绑定和动作；SDK 不自动制作 |
| VRM 1.0 + three-vrm | 全身空间动作、多视角的备选 | 专业网格/材质/蒙皮/表情/动画；按集显优化 |
| Spine Web | 成熟二维骨骼动画备选 | 同样需要专业资产和修形，并有独立 Editor/Runtime 授权；不是精细脸部捷径 |
| 继续扩八层 shader | 不作为高品质交付路线 | 会持续增加遮挡、修形、动作编辑与维护工作，仍缺成熟制作流程 |

Cubism Web 官方支持 Windows 主流浏览器，使用 WebGL/TypeScript；参数化渲染不要求 CUDA。[SDK 平台说明](https://www.live2d.com/en/sdk/about/) 当前 Web Framework 有 R5 正式版，R5 系列改用 WebGL2；实施时锁定匹配的 Core/Framework/模型导出版本，不使用永远变化的 latest CDN。[R5 发布](https://github.com/Live2D/CubismWebFramework/releases/tag/5-r.5)、[WebGL2 变更](https://github.com/Live2D/CubismWebFramework/releases/tag/5-r.5-beta.1)

这表示有可行运行路径，不表示本机已跑过专业 Cubism 模型。Editor 与浏览器 Runtime 负载不同；官方 Editor 要求 OpenGL 并提醒集显可能有兼容问题，先验证，不直接购买 PRO。[Editor 系统要求](https://www.live2d.com/en/cubism/download/spec/5_3_00_b1/)

VRM 标准化表情、视线、材质与 SpringBone，但格式不会自动产生漂亮脸与动作。[VRM 能力](https://vrm.dev/en/vrm/vrm_features/) 本仓库现用 Three.js 0.180.0、three-vrm 3.5.3；可复用 GLTFLoader/VRMLoaderPlugin。three-vrm 代码是 MIT，模型版权另算。[官方项目](https://github.com/pixiv/three-vrm)

Spine 提供 Web 等运行时；源码可见不等于无条件免费，需按 Editor/Runtime 协议实施。[运行时](https://esotericsoftware.com/spine-runtimes)、[许可证](https://en.esotericsoftware.com/spine-runtimes-license)

## 4. 视觉母版：先锁定，再绑定

以下是本项目制作要求，不是软件官方最低配置。

- 保持用户认可的脸与“成年银紫双马尾”方向。以 [中性立绘](D:/workspace/muxiva-avatar/assets/avatar/illustration-neutral-v1.png) 中已接受的脸作为比例/画风参考，由用户确认专业重绘静态样张；不要把误差较大的后续图集头部当成新审美母版。
- 角色明确为成年女性。保持轻盈自然体态、银紫发色与双马尾辨识度；服装沿白衬衫、酒红领结、深灰短开衫、自然 A 字百褶裙方向，不夸大胸腰臀，不因动态制作擅改比例。
- 先交正面中性/轻微微笑的头肩与全身确认图，再交小幅左右转头关键帧。分别确认脸、眼距、鼻口、下颌、肩宽、头身比和裙腰线，不能用一张海报代替可动设计验收。
- 明媚与活力来自眉眼嘴、姿态与节奏，不靠持续摇头、招手或单纯幼态化。
- 静态批准后冻结带版本母版。脸型、肤色、衣服和体态变化需复核；补绘应解决遮挡，不重新设计角色。
- 正式素材须真实 alpha、背景分离；不能交白底、绿幕或假棋盘，也不能白色键抠除衣服。

## 5. PSD 分层与遮挡补全

交付可编辑源工程及可导入 Cubism 的 PSD：RGB、8 bit/channel、sRGB，名称唯一；每个最终部件整理好线稿/颜色/必要阴影，导出时应用图层 mask，不依赖无法复现的编辑器效果。[官方 PSD 要求](https://docs.live2d.com/en/cubism-editor-manual/precautions-for-psd-data/)

| 区域 | 独立控制/分层要求 | 必须补全的遮挡 |
| --- | --- | --- |
| 脸颈 | 脸底/轮廓、耳、鼻与随角度变化的明暗，颈与衣领分离 | 刘海后额头、脸侧耳根、下颌颈交界、领口内完整颈部 |
| 每只眼 | 眼白、虹膜/瞳孔、高光、上下眼睑/睫毛及必要眼线 | 完整虹膜；转眼/半闭眼不露空、不残留第二瞳孔 |
| 眉与修饰 | 左右眉独立，腮红及约定的情绪修饰可控 | 眉移动后的皮肤，眉不能画死在脸底 |
| 嘴 | 上下唇/口线、口腔、牙齿、舌头、闭口与笑口修形 | 张口/圆唇/咬合结构；不是黑色椭圆放大 |
| 头发 | 刘海/侧发按运动拆分，左右马尾分段或分束，发饰独立 | 发束互相遮挡后的连续轮廓，发根无矩形裁口 |
| 躯干衣物 | 衬衫、领口、领结、开衫前后遮挡、裙头/腰带 | 手移开后完整胸腰衣物，领结后补全，衬衫底收进裙腰 |
| 双臂双手 | 肩、上臂、前臂、袖口与手；手掌/手指或姿态替换方案 | 袖内、肩窝、肘弯；抬臂无裂口，换手型不闪跳 |
| 裙腿 | 裙腰/褶裥/下摆、完整内衬，腿袜鞋按需要拆分 | 裙摆侧移不露缺失区域，双腿交界连续 |

不以层数多证明质量：拆分粒度必须支持约定动作，避免无意义资源负担。不能仅裁出完成图中的可见像素，运动后显露的部位需要提前补绘。[官方素材拆分流程](https://docs.live2d.com/en/cubism-editor-manual/divide-the-material/)

母版可高于现有 1024×1536；运行图集按最大近景清晰度和集显预算导出。先尝试适当数量的 2048 级图集，4096 是否必要由显示尺寸和实测决定。报告图集数量/尺寸、网格/参数数量、解码资源开销，不预先强推多张 4K。

## 6. 绑定、参数、表情与物理

交付真正的 ArtMesh、Warp/Rotation Deformer、关键形变、遮罩、绘制顺序、表情与物理绑定。参数组合须有修形，重点检查“转头 + 侧看 + 微笑 + 说话/眨眼”，不能只看单个滑杆。

| 功能 | 交付期望 | 参数/实现约定 |
| --- | --- | --- |
| 头角度 | 正面、小幅左右转头、抬低头/侧倾，近远眼/鼻/轮廓联动 | 优先 ParamAngleX/Y/Z；参数数字不代表保证的真实转角 |
| 视线 | 双眼共同目标、合理限幅，视线先动头后跟，目标离开缓回 | ParamEyeBallX/Y，眼睑/眼白遮罩完整 |
| 眨眼 | 双眼独立开合，正常/笑眼完整闭合，非整脸换图 | ParamEyeLOpen/ROpen、眼笑参数；明确表情覆盖关系 |
| 眉 | 左右上下/倾斜/弯曲，能表达关注、思考、轻惊讶 | 优先标准眉参数；未制作的形变不能只在 JSON 声明 |
| 嘴 | 连续开合与嘴角，闭唇、展唇、圆唇有可验收形态 | ParamMouthOpenY/ParamMouthForm；更细 viseme 为明确扩展 |
| 表情 | 中性、温和微笑、开心、关切、思考、轻惊讶 | 真正眉眼嘴联动和淡入淡出，非只改 mouth_open |
| 身体 | 呼吸、轻重心移动、头肩配合，可静止而不僵硬 | ParamBodyAngleX/Y/Z、ParamBreath 及必要自定义参数 |
| 手部 | 放松休止、单侧招手、轻说明手势，另一手可休止 | 关节/换手型方案明确，姿态替换连续 |
| 衣发 | 多发束、发饰跟随，衣物/裙摆小幅次级动作 | physics3.json；阻尼、限幅、层级与静止恢复可检查 |

标准 ID 改善兼容性，不自动创造未制作形变。读取模型真实 min/default/max 并限幅，标准表范围也不是本角色的强制幅度。[标准参数表](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/)

不把 360° 头部、真实背面列为当前二维交付项。若需要空间转身，转向 VRM，不用极端平面扭曲替代。

## 7. 动作包与表演节奏

以下是动画师动作方向与初始规格，需实看调整，不是扩大当前正弦动作。

| 动作 | 应有表现 | 不接受 |
| --- | --- | --- |
| idle | 多个自然变体，呼吸、偶发视线/姿态调整，有停顿 | 永久左右摆头、固定周期全身摇摆 |
| listening | 温和注视、克制点头 | 按用户麦克风响度让角色张嘴 |
| thinking | 短暂视线/眉形变化，结束自然回到用户 | 持续夸张困惑或机械重复 |
| greeting | 准备、抬臂、腕/手型招呼、回位，单侧可执行 | 直杆摇摆、手先朝裙内折、肩部撕裂 |
| acknowledge | 简短点头/目光回应，可轻微微笑 | 每次输入都重复完整招手 |
| speaking | 有节奏的轻微重音/手势变体，口型独立驱动 | 一段循环覆盖所有句子，停音还说话 |
| interrupt/recover | 口型停止，表现动作平滑回位 | 旧回答动作迟到复活或全关节瞬间归零 |

每个 motion3.json 标注用途、可中断性、淡入/淡出、是否循环和参数覆盖范围。明确动作、表情、眨眼、口型的求值顺序，动作中的嘴曲线不得抢写真实语音口型。

互动话术、亲密程度和记忆留在应用业务分支与已有 Pi Agent 工具/事件组合，不进入 renderer，不增加 Agent loop、Turn engine 或角色专属主骨架。

## 8. 文件交付清单

| 类别 | 必须交付 | 目的 |
| --- | --- | --- |
| 美术源 | 分层 PSD、原生绘画工程（如有）、批准角度图/色板 | 可继续修图，不反复对压平 PNG 生图 |
| 绑定源 | 完整 .cmo3、Editor 版本、插件说明 | 可维护地修形、调参数/物理 |
| 动画源 | .can3 或实际可编辑工程、动作清单 | 可调整表演，不只交演示视频 |
| 运行包 | .model3.json/.moc3/纹理 PNG/.physics3.json/.exp3.json/.motion3.json；使用时含 .pose3.json 等 | 引用完整且由真实 SDK 加载 |
| 接口清单 | 参数 ID/min/default/max、表情/动作分组、覆盖顺序、hit areas | 通过配置适配，不硬编码角色名字 |
| 验收资料 | 参数组合/动作录屏、近景帧、资源统计、已知限制 | 对照规格验收，不以可加载代替效果 |
| 权利链 | 作者/署名、来源、授权正文、修改/嵌入/分发/商用范围 | 资产与运行库许可分别审查 |

.cmo3/.can3 是制作源文件，.moc3 等是运行导出；只有运行包不等于有可维护源工程。[官方文件类型](https://docs.live2d.com/en/cubism-editor-manual/file-type-and-extension/) 不伪造 .moc3，不把八层 JSON 改名后宣称 Live2D。

若改走 VRM，对应交付完整 .blend/其他 DCC 工程、原贴图/纹理工程、蒙皮与表情源数据、动作/重定向说明、VRM 1.0 导出、SpringBone/碰撞/材质设置与许可证。单独 .vrm 同样不等于完整制作源工程。

## 9. 沿现有边界适配，不重造链路

现有 [app.mjs](D:/workspace/muxiva-avatar/web/app.mjs)、[avatar.mjs](D:/workspace/muxiva-avatar/web/avatar.mjs)、[illustration.mjs](D:/workspace/muxiva-avatar/web/illustration.mjs) 已有展示对象边界。后续只需薄 Cubism 展示适配器：

- 沿用 load、queue、reset、update、setView、setExpression、dispose；setPointer/setAttention、setActivity、interact、setReducedMotion 仍是展示输入。
- app 唯一 requestAnimationFrame 调用 update；SDK 在此帧内更新参数/动作/物理并绘制。不新增内部音频播放器、第二播放时钟或轮询 Agent。
- 保留 [AvatarTimeline](D:/workspace/muxiva-avatar/web/avatar-timeline.mjs) 与 AudioWorklet 实际消费采样位置。首阶段把 mouth_open 映射 ParamMouthOpenY 接通，明确叫能量口型，不当最终品质。
- 下一阶段由已有 animation Node 或同职责 Adapter 输出 sample_offset 对齐的多嘴型权重，兼容旧帧；协议确定后扩 timeline 取样结果。不按 TTS 文本到达、生成开始或墙钟驱动嘴。
- 参数/范围、表情、motion group 与语义动作映射放角色配置。未知参数/表情报错，不静默假支持；只引用可信本地文件，渲染核心不理解银紫、女友、小智等业务。
- app 当前读 renderer.renderer.getContext()、renderer.asset 判断能力，接第三种展示前改成小型 capabilities/diagnostics 返回值即可，避免要求 Cubism 伪造 Three.js 内部对象；不需大型新管理器。
- reset 延用 stream_id/sequence 水位；清口型与已取消回答动作，不重置新回答、不复活旧事件。用户独立点击动作与语音取消范围须清晰。
- 加载失败保留旧角色且语音可继续；来源/体积/纹理/时限有界，正确释放 SDK、模型和纹理；处理 context lost/恢复，不让换角色拖垮会话。

官方 Web 音量口型样例本身也是 RMS，不等于音素识别。[官方 RMS 样例](https://docs.live2d.com/en/cubism-sdk-tutorials/native-lipsync-from-wav-web/) MotionSync 有官方 Web 插件可后续评估许可与实测，中文口型及本机时延未知，本轮不下载/接入。[MotionSync Web](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-motionsync-plugin-for-web/)

## 10. 授权：固定模型与可扩展应用必须区分

以下是实施前核对清单，不是法律意见或已获许可声明。

1. SDK 与角色分开授权。Cubism Core 不在官方 GitHub 开源仓库中，官网下载需接受协议，不从第三方镜像绕过。Framework 源码可见不意味着 Core、样例或美术都可随意打包。[SDK 说明](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/)、[下载协议入口](https://www.live2d.com/en/sdk/download/web/)
2. 固定模型发布：固定有限角色、不提供不定模型扩展的应用，按实际主体/规模/发布方式确认 Publication License。官方对部分个人/小型企业的非扩展应用有豁免，但“本地/免费”不能自动决定最终发布资格。[发布许可](https://www.live2d.com/en/sdk/license/)
3. 可扩展应用：官方分类涉及通过外部文件/数据增加不定数量模型的 avatar 应用，发布前须审查与特别许可；个人/小企业通常的豁免不能直接套用。未来允许任意 Cubism 导入明显存在分类风险，须向 Live2D 说明真实功能确认，不靠藏按钮规避。[Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/)
4. 角色版权：“可直播”不自动等于可在 AI 陪伴应用嵌入、缓存、修改或分发。核对设计、绘画、rig、配件/字体/外购素材权利，区分个人本地使用与未来发布；AI 相关使用限制逐项澄清，训练许可与展示许可也不能混淆。
5. 源文件与保密：合同明确源文件交付范围；拿到源文件不代表可公开到代码仓库。按许可分离私有源资产、嵌入运行包和通用代码。
6. VRM 同样查模型条款。格式开放、three-vrm MIT 不覆盖作者设定的用途/再分发限制，核对元信息与完整许可证。[VRM Public License 1.0](https://vrm.dev/licenses/1.0/pdf/en.pdf)

本轮没有下载需同意协议的 SDK/模型，没有购买、联系画师下单、发布应用或代理接受许可。专业资产与权利确认是下一阶段真实依赖，不能靠代码测试替代。

## 11. 验收表与停止条件

以下为拟定标准，不是已完成成绩。先在本机、实际浏览器与最终画布尺寸建立基线，再冻结性能阈值。

| 项目 | 验收方法 | 通过标准 |
| --- | --- | --- |
| 视觉母版 | 胸像/全身与批准参考并排 | 用户认可脸、体态/衣服，不随调试漂移 |
| 面部连续性 | 角度/视线/闭眼/嘴形组合扫参数、录屏 | 无双眼线、重影、露空、鼻口漂移、轮廓跳变 |
| 遮挡 | 头转、抬手、回位、衣发极限组合 | 发根/颈肩/腋下/腰带无裂口、色键边、穿帮；内衬完整 |
| 手与表演 | 胸像/全身看完整动作 | 关节自然、手型清晰、有停顿/回位，非直杆循环 |
| 听说状态 | 听、想、回答、中断、再次回答 | 克制可读，听/想不假说话，旧动作不复活 |
| 唇形 | 中文闭唇/圆唇/展唇词句、数字、轻声/停顿 | 最终可辨主要嘴型，逐帧对实际音频；不按 RMS 峰值/事件数评分 |
| 同步 | 记录实际播放、口型事件、屏幕/音频 | 核对可感知错位；可先以约 80 ms 内为工程目标，不称已达到 |
| 性能 | 冷/热加载、30 分钟真实语音同跑；p50/p95 帧耗时、长帧、内存 | 目标近 60 FPS，平均值不掩盖停顿；不影响音频。不足先缩资源/特效，不偷换静态图 |
| 取消 | 播放中连续停止/插话、注入迟到事件 | 停音口型关闭、旧音频不回流，新回答正常 |
| 生命周期 | 反复加载/取消/替换、资源失败、页面隐藏恢复 | 无持续内存增长、重复时钟/遗留模型；失败不使语音崩溃 |
| 权利/维护 | 核对运行包、源工程、版本、授权 | 依赖完整可重建，权限与实际发布功能相符 |

若静态脸或主要动作仍不符合审美，停止继续默认切换，保留候选对比；自动化全部通过不能覆盖美术否决。能加载、会动、短时 60 FPS、口型有数值，都不能单独判为沉浸成品。

## 12. 执行顺序

1. 用户确认母版与首期“正面高品质”范围，取得已有合规模型或专业制作资产的交付/使用条件，不以无限制免费下载代替授权。
2. 用真实、已获许可 Cubism 运行包验证 WebGL2、加载、既有时钟/取消，固定候选预览，不立即替换生产默认。
3. 静态批准 → 头脸参数 → 胸像互动 → 全身动作/物理 → 性能优化；每阶段保留源工程和批准记录。
4. 既有 RMS 先接通，再在同职责 Node/Adapter 验证细口型；声音任务独立完成音色自然度、授权、首音与中断验收。
5. 真实普通问答与情绪性交流联合验收，通过才切默认。通用代码、专有 SDK/模型与业务配置按架构/许可分别管理。

交付原则：让真实资产与声音达到目标，再让通用接口承载它们；不加 Agent/Turn 实体，不假造专业模型，不用短时数值代替体验验收。
