# OmniSoul · 万物有灵

> 让身边的物体「活」过来——对准它，召唤它，和它聊天。

OmniSoul 是一个基于 AR 摄像头的「万物有灵」实验性应用。用户用手机或电脑摄像头对准身边的任意物体（多肉、玩偶、马克杯、苦力怕模型……），系统会识别物体并为其召唤出一个专属的灵体形象，进行对话与互动。

---

## 一、产品理念

> **万物皆可有灵，灵亦可有性格。**

我们把「灵体」分成三层，对应三种使用形态：

### 1. 自由生成（Free Spirit）
对**任意物体**都可以即时生成形象并对话。形象由固定工作流随机生成，每次召唤可能会有外观或语气的变化——就像每次遇到都是不同的偶遇。

### 2. 用户固定（Bound Spirit）
用户可以为**自己的物体**固定形象（例如自己养的那盆多肉、自己床头的玩偶），形象、记忆、语气从此被绑定，可进行长期、有上下文的对话。每次再见，它都还记得你。

### 3. IP 联名（Signature Spirit）
与 IP 合作的**官方固有形象**，配套设计的人设、台词、彩蛋。用户扫到联名物体时，会出现该 IP 专属的灵体表现。

---

## 二、核心玩法与实现思路

### ① 标识 / 二维码绑定（私有空间）
- 物体上贴一个标识（类似二维码 / NFC），扫到后即认领进入**私有存储空间**。
- 该空间承载该灵体的对话上下文、记忆与形象设定，并设有大小上限。
- 没有标识的物体走「自由生成」分支。

### ② 无标识识别（图像分析）
- 对于没有标识的物体，通过图像识别判断：
  - 是否命中**已知 IP 固有形象** → 走联名分支；
  - 否则 → 走**随机自由生成**分支。

### ③ 自由生成形象的随机性
- 自主生成走的是固定工作流 + 随机种子，因此每次召唤可能形象、语气有微小变动；
- 这种「不稳定感」本身就是玩法的一部分——它强化「偶遇」感。

### ④ 出场即有人设
- 灵体首次出现时，会有一段**简短而有个性的自我介绍**，立刻建立角色感，而不是冷冰冰的"你好我是 AI 助手"。

### ⑤ 召唤口令（彩蛋玩法）
- 部分灵体设置「**召唤口令**」才会出现，分为三类来源：
  - **个人设计**：用户自己为绑定物体设置的私密口令；
  - **IP 专属**：官方为某类物品设计的统一口令；
  - **AI 随机分配**：由 AI 随机生成口令并把提示词显示给用户，例如：
    > *快说"多肉多肉快出现吧"来召唤我吧！*

---

## 三、技术栈

- **Vue 3**（Composition API, `<script setup>`）
- **Vite 5**
- **Three.js**（GLB 模型加载与 AR 场景渲染）
- **WebRTC / getUserMedia**（实时摄像头采集）
- **火山引擎 TTS**（PCM 流式语音播放，详见 [src/services/volcTts.js](src/services/volcTts.js)）
- 自研实时物体扫描器（详见 [src/composables/useRealtimeObjectScanner.js](src/composables/useRealtimeObjectScanner.js)）

---

## 四、项目结构

```
OmniSoul/
├── public/
│   ├── models/                  # GLB 灵体模型资源
│   └── assets/
├── src/
│   ├── App.vue                  # 主入口：摄像头 + 识别 + 召唤 + 对话编排
│   ├── components/
│   │   ├── ArCameraStage.vue    # AR 摄像头舞台
│   │   ├── ArSoulModel.vue      # 3D 灵体模型渲染
│   │   ├── ArDialog.vue         # AR 浮层对话框
│   │   ├── AiConversation.vue   # AI 对话面板
│   │   ├── CameraIntro.vue      # 首次进入的引导
│   │   ├── ObjectHotspots.vue   # 识别到的物体热区
│   │   ├── RecognitionPanel.vue # 识别结果面板
│   │   └── GlbViewer.vue        # GLB 模型查看器
│   ├── composables/
│   │   ├── useArCamera.js              # 摄像头生命周期管理
│   │   └── useRealtimeObjectScanner.js # 实时物体识别
│   ├── services/
│   │   ├── volcTts.js                  # 火山 TTS 接入
│   │   └── pcmStreamPlayer.js          # PCM 流式播放
│   ├── data/
│   │   └── demoObjects.js              # Demo 物体与灵体配置
│   └── main.js
├── vite.config.js
└── package.json
```

---

## 五、本地运行

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 0.0.0.0:5173）
npm run dev

# 构建生产包
npm run build

# 本地预览构建产物
npm run preview
```

> 摄像头能力依赖 HTTPS 或 `localhost`；如果用局域网 IP 调试，请确保浏览器允许该来源访问摄像头。

---

## 六、Demo 配置示例

当前 Demo 在 [src/data/demoObjects.js](src/data/demoObjects.js) 中预置了一个完整的**多肉精灵**作为参考实现，演示了一个灵体应该具备的全部字段：

| 字段             | 含义                                        |
| ---------------- | ------------------------------------------- |
| `id`             | 物体唯一标识                                |
| `label`          | 显示名                                      |
| `aliases`        | 识别别名（喂给图像识别器）                  |
| `enabledSpirit`  | 是否已启用灵体                              |
| `spiritName`     | 灵体名字                                    |
| `summonPhrase`   | 召唤口令（彩蛋玩法）                        |
| `spawnLine`      | 出场第一句话                                |
| `intro`          | 自我介绍（建立人设）                        |
| `promptStyle`    | 注入到 LLM 的语气/风格指引                  |
| `modelUrl`       | GLB 模型地址                                |
| `theme`          | 主色 / 光晕色                               |
| `demoHints`      | 引导用户的快捷提问                          |

新增一个灵体只需在该文件追加一项配置，并把对应的 `.glb` 放进 `public/models/` 即可。

---

## 七、Roadmap

- [ ] 二维码 / NFC 标识扫码 → 私有空间认领
- [ ] 无标识物体的 IP 形象命中匹配
- [ ] 自由生成形象的工作流接入（随机种子 + 一致性约束）
- [ ] 私有空间记忆持久化与容量上限
- [ ] 召唤口令系统（个人 / IP / AI 随机三类来源）
- [ ] 多灵体共处与互动

---

## 八、License

暂未公开。如需合作或试用请联系项目维护者。
