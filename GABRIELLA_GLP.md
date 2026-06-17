# Gabriella Learning Profile for Outfit Manager

这份文档是给 Gabriella（白珈珩）和后续 AI coworker 用的 OM 项目学习/维护 GLP。

它不是 README，也不是完整 API 文档。它的用途是：让第一次接手 Outfit Manager 的人或 AI，先理解这个插件的系统地图、兴趣入口、工程实现，再开始改 bug。

## 0. Gabriella 基础画像

姓名：Gabriella（白珈珩）

背景：

- 计算机硕士
- AI Agent 方向求职中
- 独立开发者
- 重度 AI Role Play 玩家
- 长期研究 AI Agent、RAG、Memory System、SillyTavern、Prompt Engineering、人机关系

学习特点：

- 能快速发现复杂系统的底层逻辑
- 不满足于“这行代码是什么”，更关心“系统为什么这样设计”
- 学代码前需要先看到地图、数据流、模块协作方式
- 如果陷入细节迷宫，需要先拉回整体架构

默认教学比例：

```text
神曜 40%：系统地图、架构、调用链、模块关系
兔兔 30%：兴趣入口、比喻、场景化解释
泡泡 30%：工程实现、代码逻辑、测试、面试表达
```

## 1. OM 一句话模型

Outfit Manager 是一个 SillyTavern 前端扩展。

它做三件事：

```text
管理衣柜 -> 生成/选择当前穿搭 -> 把当前穿搭注入给 AI
```

最重要的系统事实：

```text
衣柜里可以有很多衣服，但只有 activeIds 里的衣服才是“当前穿着”。
普通聊天真正发给 AI 的，是 activeIds 对应的当前穿搭，不应该是整本世界书。
```

## 2. 神曜模式：先看森林

OM 的核心地图：

```text
SillyTavern
  |
  | 提供上下文、角色、人设、聊天记录、世界书、当前主 API
  v
Outfit Manager
  |
  |-- 衣柜系统
  |     |-- 保存 User / char 的衣服
  |     |-- 保存图片、描述、分类、风格、季节、场景
  |
  |-- 世界书系统
  |     |-- 读取 uu现代 / uu内衣 / SFW
  |     |-- 解析穿搭条目
  |     |-- 按场景过滤风格
  |
  |-- AI 生成系统
  |     |-- 读取当前 RP 上下文
  |     |-- 读取 User 人设
  |     |-- 读取 char 作为场景参考
  |     |-- 调用 SillyTavern 当前主 API 生成穿搭
  |
  |-- 当前穿着系统
  |     |-- activeIds 是唯一可信源
  |     |-- virtualOutfits 保存临时生成结果
  |
  |-- 请求注入系统
        |-- 拦截 fetch / XHR
        |-- 剔除穿搭世界书全文
        |-- 注入当前穿搭
```

如果 Gabriella 或 AI coworker 迷路了，先回到这条链：

```text
def() -> load()/save() -> UI -> world book -> AI generation -> activeIds -> tryInjectBody()
```

## 3. 兔兔模式：把 OM 想成什么

可以把 OM 想成一个“RP 造型总监 + 衣帽间管理员”。

如果是 K-pop 舞台：

- 衣柜是后台服装间
- 世界书是 stylist 的造型手册
- 场景按钮是“今天是机场、打歌舞台、约会综艺、宿舍 vlog”
- AI 生成是造型师根据剧情临场搭一套
- activeIds 是“她现在真的穿在身上的那套”
- tryInjectBody 是上台前递给摄像机和导演的最终造型单

如果是《博德之门3》：

- 衣柜像营地箱子
- 世界书像装备图鉴
- 场景按钮像当前任务场景：城市社交、营地休息、战斗、宴会
- activeIds 是角色当前装备栏
- 普通聊天注入就是把当前装备状态写进剧情判定

如果是《赛博朋克2077》：

- 世界书是不同风格的街头品牌库
- AI 生成像夜之城造型算法
- 剧情上下文决定你是去公司谈判、街头约会、还是回公寓睡觉
- 不该把整个品牌库塞进对话，只该告诉 AI：V 此刻穿了什么

这就是 OM 的核心趣味：它不是单纯 roll 衣服，而是让 RP 中的“此刻穿着”变成一个可控的状态系统。

## 4. 泡泡模式：七个控制点

第一次改代码，先认这七个点。

```text
def()
  定义 OM 的数据形状。

load()/save()
  负责读写插件数据。

renderGrid()/renderQuickScenes()
  负责 UI。

refreshWorldBookStyles()
  负责读取并解析世界书。

tryGenerateAIDescription()
  负责场景按钮的 AI 穿搭生成。

activeIds
  负责记录当前真正生效的穿搭。

tryInjectBody()
  负责把当前穿搭塞进普通聊天请求。
```

建议阅读顺序：

```text
1. def()
2. load()/save()
3. getViewOutfits()/getViewActiveIds()/setViewActiveIds()
4. refreshWorldBookStyles()/parseWorldBookEntry()
5. worldBookStyleMatchesScene()
6. renderQuickScenes()/tryGenerateAIDescription()
7. stripWorldBookEntries()/tryInjectBody()
```

## 5. 文件结构

当前项目很集中：

```text
manifest.json
  SillyTavern 插件清单。

index.js
  主代码，几乎所有逻辑都在这里。

README.md
  用户安装和使用说明。

AGENTS.md
  给 AI coding agent 的维护说明。

GABRIELLA_GLP.md
  本文件，给 Gabriella 和 AI coworker 的学习/协作说明。
```

不要随便提交这些临时文件：

```text
_live_result.txt
_test_api.cjs
_test_live.cjs
_test_result.txt
```

## 6. 数据模型：OM 的“记忆系统”

`def()` 是数据结构源头。

核心字段：

```js
{
  outfits: [],              // User 的正式衣柜
  categories: [],           // 分类
  activeIds: [],            // User 当前穿着
  virtualOutfits: {},       // AI/世界书临时生成的衣服
  chars: {},                // 各 char 的独立衣柜
  currentView: 'user',      // 当前看 User 还是 char
  currentChar: '',          // 当前角色衣柜
  selectedWorldBookNames: [],
  mode: 'text',
  injectPosition: 'user'
}
```

三个概念必须分清：

```text
outfits
  正式保存进衣柜的衣服。

virtualOutfits
  临时生成的衣服，可以当前生效，但不一定永久保存。

activeIds
  当前真正穿着的衣服 ID。
```

最常见 bug：

```text
用户以为“生成了”等于“穿上了”，但代码没有写入 activeIds。
用户以为“保存了”等于“当前生效”，但代码只写入 outfits。
用户以为“世界书启用”等于“应该发给 AI”，但 OM 设计是不让整本穿搭世界书进入普通聊天。
```

## 7. UI 系统：用户看到什么

主要 UI 函数：

```text
openPopup()
  打开 OM 主面板。

renderGrid()
  渲染衣柜卡片。

renderQuickScenes()
  渲染外出/约会/通勤/家居/运动/睡前按钮。

renderBottomStatus()
  渲染左下角当前穿搭标签。

openRandomRoll()
  打开随机搭配面板。
```

两个“随机”不要混：

```text
衣柜随机
  只从已有衣柜里抽。
  不读世界书。
  不调用 AI。
  有图片会弹图。

随机搭配
  打开随机搭配页。
  可以从衣柜和世界书里抽。
  可以按风格/季节/场景过滤。
```

场景按钮也不是普通随机：

```text
外出 / 约会 / 通勤 / 家居 / 运动 / 睡前
  会读取世界书条目。
  会读取当前 RP 上下文。
  会调用 SillyTavern 当前主 API。
  会让 AI 给 User 生成一套新穿搭。
```

## 8. 世界书系统：uu / SFW 怎么进 OM

OM 当前推荐识别：

```text
uu现代
uu内衣
SFW
```

世界书不一定要挂全局。只要导入 ST，OM 能读到，就可以在 OM 内使用。

如果用户把它们挂全局，普通聊天时 OM 应该剔除这些穿搭条目，避免发给 AI：

```text
普通聊天：只发当前穿搭
场景生成：才把相关世界书条目作为风格指导发给 AI
```

世界书核心链路：

```text
getSelectedWorldBookNames()
  选出 OM 要读的世界书名。

refreshWorldBookStyles()
  读取这些世界书。

parseWorldBookStyles()
  把世界书 JSON 拆成风格条目。

parseWorldBookEntry()
  解析每一个风格。

worldBookStyleMatchesScene()
  判断某风格能不能用于当前场景。

materializeWorldBookStyle()
  普通随机时从风格条目里抽一套具体描述。
```

## 9. 场景按钮：AI 生成穿搭的真实流程

点击“约会”这类按钮时，流程应该是：

```text
1. 读取 SillyTavern 上下文
2. 读取 OM 选中的 uu/SFW 世界书
3. 按“约会”过滤相关风格
4. 拼接这些风格的完整世界书条目
5. 读取当前 user 输入
6. 读取最近聊天记录
7. 读取 User 人设
8. 读取 char 信息作为剧情参考
9. 组装 prompt
10. 调用 ctx.generateRaw，也就是 ST 当前主 API
11. 清理 AI 输出里的 <horae>/<content>/<status> 等泄漏
12. 弹窗展示，可编辑、确认、保存到衣橱
13. 确认后写入 activeIds
```

目标对象：

```text
默认固定给 User 生成穿搭。
char 只作为剧情上下文参考，不是生成目标。
```

## 10. AI prompt 结构

场景生成时，用户期望的 prompt 大结构是：

```text
=========穿搭风格指导=========
（插入与当前场景相关的世界书条目）

=========当前正文和故事情节=========
（插入 user 当前输入）
（插入最近聊天上下文）
（插入 User 人设）
（插入 char 场景参考）

你是穿搭助手，必须遵循以下规则：
- 要根据正文以及前文故事情节判断此时 user 是否需要更换服饰。
- 根据 user 的性格人设，随机生成 user 的穿搭服饰。
- 需遵循各个风格的穿搭指导。
- 符合当前人物所处情境、季节、职业和喜好，避免 OOC。
- 严禁照抄例子，例子仅供参考。

输出格式：
第一行只输出风格名。
后面输出具体穿搭描述。
不要额外说明。
不要输出 <horae>、<content>、<details>、<status>。
```

调试时重点看控制台：

```text
[OM-AI]
```

如果 AI 返回 RP 状态栏、horae、content，优先查：

```text
tryGenerateAIDescription()
_cleanOutfitResult()
system prompt 约束是否太弱
max tokens 是否太低
```

## 11. 普通聊天注入：为什么不是世界书全文

OM 有两个完全不同的阶段：

```text
生成阶段
  可以读取世界书。
  可以调用 AI。
  目的是得到一套当前穿搭。

普通聊天阶段
  不应该再发送整本穿搭世界书。
  只应该发送当前 activeIds 对应的衣服。
```

发送普通聊天时：

```text
setupInjection()
  patch window.fetch 和 XMLHttpRequest。

tryInjectBody()
  解析请求 body。
  剔除 uu/SFW 穿搭世界书条目。
  读取 activeIds。
  把当前穿搭注入 user/context/system。
```

如果用户说“提示词查看器里还有 uu/SFW 世界书”，先查：

```text
stripWorldBookEntries()
tryInjectBody()
console 是否出现剔除日志
世界书条目格式是否超出正则覆盖
请求字段是不是不在 messages/content 里
```

## 12. 常见需求应该改哪里

加底部按钮：

```text
openPopup()
绑定底栏事件的代码块
```

改外出/约会/通勤按钮：

```text
renderQuickScenes()
tryGenerateAIDescription()
```

改哪个风格属于哪个场景：

```text
getWorldBookStyleSceneKeys()
worldBookStyleMatchesScene()
```

新增世界书格式：

```text
isLikelyOutfitWorldBookName()
parseWorldBookStyles()
parseWorldBookEntry()
worldBookClothingPattern
worldBookClothingPartPattern
generateWorldBookConcreteOutfit()
stripWorldBookEntries()
```

修“世界书全文还发给 AI”：

```text
stripWorldBookEntries()
tryInjectBody()
```

修“AI 生成一直转圈/超时”：

```text
tryGenerateAIDescription()
ctx.generateRaw 调用方式
timeout
prompt 长度
max tokens
```

修“按确认不生效/要按两次”：

```text
弹窗事件绑定
activeIds 写入
save()
renderGrid()
renderBottomStatus()
updateBtn()
```

修“刷新后又 roll 一套”：

```text
启动 auto roll 逻辑
activeIds 是否已存在
hasExistingData 判断
```

## 13. AI coworker 接手工作流

每次让 AI 改 OM，建议这样下任务：

```text
你先读 GABRIELLA_GLP.md 和 AGENTS.md。
不要直接改代码。
先告诉我这次需求会影响哪几个控制点：
def/load/save/UI/worldBook/AI生成/activeIds/tryInjectBody。
然后再改。
改完必须 node --check index.js。
如果涉及世界书解析，要写本地文本测试。
如果涉及 ST 发送，要说明怎么在浏览器 console 验证。
不要提交 _test_api.cjs/_live_result.txt 这类临时文件。
```

如果 AI 开始胡说，拉回这三个问题：

```text
1. 这次改动是否影响保存数据？
2. 这次改动是否影响当前穿着 activeIds？
3. 这次改动是否影响发给 AI 的最终 prompt？
```

## 14. 面试表达版本

如果 Gabriella 要把 OM 讲成工程项目，可以这样说：

```text
这是一个 SillyTavern 前端扩展，用来管理 Role Play 场景中的服装状态。
我把它拆成了衣柜数据层、世界书解析层、AI 生成层、UI 交互层、请求注入层。
核心状态是 activeIds，它代表当前真正生效的穿搭。
世界书只在生成阶段作为风格指导使用，普通聊天阶段会被剔除，只注入当前穿搭，避免 token 浪费和上下文污染。
场景按钮会结合 User 人设、当前输入、最近聊天和相关世界书条目，通过 SillyTavern 当前主 API 生成符合场景的新穿搭。
```

可强调的技术点：

```text
前端插件架构
状态管理
localStorage / IndexedDB / extensionSettings 多层存储
世界书 JSON 解析
prompt assembly
fetch/XHR monkey patch
AI 输出清洗
用户可编辑的 AI 生成结果闭环
```

## 15. 最后记忆点

OM 最容易出 bug 的地方，不是“衣服描述写错”，而是责任边界混了。

牢记：

```text
世界书 = 候选风格指导
AI 生成 = 生成当前穿搭
衣柜 = 保存资产
activeIds = 当前穿着
tryInjectBody = 发给 AI 的最终关口
```

如果不知道该改哪里，先不要开刀。

先画地图，再找调用链，再写最小补丁，再测真实流程。
