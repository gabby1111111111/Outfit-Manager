# Outfit Manager Maintenance Guide

This file is for coding agents taking over the project for the first time.
Read this before editing `index.js`.

## One-Sentence Mental Model

Outfit Manager is a SillyTavern frontend extension that manages wardrobe state, generates outfits from world-book style guides, and injects the currently active outfit into outgoing AI requests.

Think of it as:

```text
wardrobe storage -> UI selection/generation -> activeIds -> request injection
```

The most important idea: the wardrobe can contain many outfits, but only `activeIds` are considered "currently worn" and sent to the model.

## File Layout

The project is intentionally simple:

```text
manifest.json  SillyTavern extension manifest
index.js       Almost all logic lives here
README.md      User-facing docs
AGENTS.md      Maintainer/coding-agent guide
```

There are also old helper/test files such as `_test_api.cjs`, `_test_live.cjs`, `_live_result.txt`, and `_test_result.txt`. Do not delete or commit them unless the user explicitly asks.

## AGENTS.md Maintenance

Keep this file as the stable project memory for future agents. Add only reusable rules that affect later Outfit Manager development, such as project structure, verified commands, SillyTavern loading/API/storage behavior, known pitfalls, files not to change, and acceptance checks.

Do not add one-off chat context, temporary guesses, unverified fixes, private chat content, API keys, cookies, `.env` values, account details, or other local secrets. Put drafts and temporary findings in `.memory/human` or `.memory/skill-candidates` instead.

Classify new lessons before saving them:

```text
Current project only -> AGENTS.md
All SillyTavern plugins -> .memory/skill-candidates
Local machine only -> Local Notes or .memory/skill-candidates
One-time issue -> .memory/human/devlog
```

When changing build, test, plugin loading, storage, navigation, or SillyTavern API integration, check whether this file needs a short update. If it grows too long, move detailed notes to `docs/` or `.memory/` and leave only the index or stable rule here.

## The Seven Control Points

If you get lost, return to these seven concepts:

```text
def()                         Defines the data shape
load()/save()                  Own persistent data
renderGrid()/renderQuickScenes() Own UI
refreshWorldBookStyles()       Loads and parses world books
tryGenerateAIDescription()     Generates scene outfits with AI
activeIds                      Tracks currently worn outfits
tryInjectBody()                Injects active outfits into AI requests
```

Recommended reading order:

```text
1. def()
2. load()/save()
3. getViewOutfits()/getViewActiveIds()/setViewActiveIds()
4. refreshWorldBookStyles()/parseWorldBookEntry()
5. worldBookStyleMatchesScene()
6. renderQuickScenes()/tryGenerateAIDescription()
7. setupInjection()/tryInjectBody()
```

## Data Model

`def()` defines the default shape.

Important fields:

```js
{
  outfits: [],              // User's saved wardrobe
  categories: [],           // User's wardrobe categories
  activeIds: [],            // User's currently worn outfit/item ids
  virtualOutfits: {},       // Runtime outfits generated from world books or AI
  chars: {},                // Character-specific wardrobes and activeIds
  currentView: 'user',      // 'user' or 'char'
  currentChar: '',          // Current character wardrobe view
  selectedWorldBookNames: [],
  mode: 'text',             // text/image/both injection
  injectPosition: 'user',   // user/context/system injection position
  apiVision: {}             // Image-description API settings
}
```

Key distinction:

```text
outfits        = permanently saved wardrobe
virtualOutfits = temporary generated outfit, not necessarily saved
activeIds      = current outfit state, the part sent to AI
```

Batch transfer/copy between User and character wardrobes should operate only on
saved outfits, not `virtualOutfits`. Copy creates new ids and leaves source
`activeIds` unchanged; transfer creates new target ids, removes originals from
the source, and clears matching source `activeIds`. The target wardrobe should
not auto-wear transferred/copied outfits.

## Storage

The plugin stores data in several places:

```text
SillyTavern extensionSettings  shared server-side extension data
IndexedDB                      browser local database
localStorage                   fallback/backup
```

Core functions:

```text
loadFromSharedSettings()
saveToSharedSettings()
loadFromDB()
saveToDB()
load()
save()
ensureDefaults()
```

Do not rewrite the storage layer casually. Several earlier bugs involved data disappearing across devices or browsers.

UI-only layout state, such as the PC floating ball position and popup size, is local machine/browser state. Store it in localStorage (`outfit_mgr_ui_layout_v1`) rather than shared wardrobe data or SillyTavern `extensionSettings`.

Import/restore flows can be followed immediately by refreshes or browser switches. After importing wardrobes, especially character-only wardrobes, force a shared settings save (`save(..., { forceShared: true })`) instead of relying only on debounced settings persistence.

Mobile full-screen UI must respect iOS safe areas. Keep top actions such as the main close button inside `env(safe-area-inset-top)` padding, and do not apply that padding to the PC windowed layout.

Do not autofocus large textareas when opening bottom sheets. On mobile and some ST layouts it can move the viewport/keyboard and make the whole panel visibly jump.

## UI Overview

The UI is plain JavaScript string-built DOM, no framework.

Main UI functions:

```text
openPopup()          Builds the wardrobe overlay
renderViewbar()      User/character wardrobe switcher
renderCatbar()       Category/type filters
renderGrid()         Wardrobe card grid
renderQuickScenes()  Scene buttons: 外出/约会/通勤/家居/运动/睡前
renderBottomStatus() Bottom active-outfit status
openRandomRoll()     Advanced random panel
```

There are two different random features:

```text
衣柜随机
  Bottom bar button left of 多选.
  Directly picks one saved outfit from the current view's wardrobe.
  Does not use world books.
  Does not call AI.
  If the outfit has imageData, opens the lightbox.

随机搭配
  Dice button.
  Opens an advanced panel with world-book checkboxes, style/season/scene filters, and roll mode.
  Can mix wardrobe outfits and parsed world-book outfits.
```

Do not confuse these two.

## World Book Pipeline

World-book support is centered around:

```text
worldBookStyleCache
refreshWorldBookStyles(names, cb)
loadWorldBookByName(ctx, name)
parseWorldBookStyles(data, sourceName)
parseWorldBookEntry(full, comment, key, sourceName)
createWorldBookOutfit(ws, idPrefix, idx)
materializeWorldBookStyle(ws)
worldBookStyleMatchesScene(ws, scene)
```

Pipeline:

```text
selected world-book names
-> loadWorldBookByName()
-> parseWorldBookStyles()
-> parseWorldBookEntry()
-> worldBookStyleCache[name]
-> scene filter
-> random/AI generation pool
```

Recognized world-book entries usually contain these labels:

```text
名称 / 风格 / 季节 / 场景 / 描述 / 核心风格 / 生成规则
```

Recognized clothing parts include:

```text
上衣 / 内搭 / 下装 / 裙装 / 外搭 / 外套 / 连衣裙 / 旗袍 / 礼服 / 配饰 / 鞋袜 / 文胸 / 内裤
```

Recommended entry shape:

```text
<某某风穿搭刻画>
[某某风穿搭刻画指导]

- 核心风格：...
- 生成规则：...
- 禁止行为：...

例子：
- 上衣：...
- 下装：...
- 配饰：...
- 鞋袜：...
</某某风穿搭刻画>
```

## Expanding World Book Compatibility

The current code still favors `uu` world books in discovery.

The relevant functions are:

```text
getDefaultSelectedWorldBookNames(ctx, d)
getSelectedWorldBookNames(ctx, d)
getWorldBookStyleSceneKeys(ws)
worldBookStyleMatchesScene(ws, scene)
parseWorldBookStyles(data, sourceName)
```

Current compatibility behavior:

1. User-selected world books are respected as-is.

```js
function getSelectedWorldBookNames(ctx, d) {
    var selected = d && Array.isArray(d.selectedWorldBookNames)
        ? d.selectedWorldBookNames.filter(Boolean)
        : [];
    if (selected.length > 0) return selected;
    return getDefaultSelectedWorldBookNames(ctx, d);
}
```

2. Default discovery prefers active ST world books, then names that look wardrobe-related:

```js
function getDefaultSelectedWorldBookNames(ctx, d) {
    var activeNames = getActiveWorldBookNames(ctx, d);
    if (activeNames.length > 0) return activeNames;

    var allNames = getKnownWorldBookNames(ctx);
    return allNames.filter(function (name) {
        return /uu|穿搭|服装|衣柜|outfit|wardrobe/i.test(name);
    });
}
```

3. To support a new style reliably, add style-to-scene mappings.

Update `getWorldBookStyleSceneKeys(ws)`:

```js
'暗黑学院风': ['外出', '约会'],
'温柔家居风': ['家居', '睡前'],
'练习室舞蹈风': ['运动'],
```

If an entry format is already clean, `parseWorldBookStyles()` usually does not need changes.

### SFW-style world books

`SFW.json`-style entries are supported by the parser when they contain labels such as:

```text
definition-style labels:
定义 / 单品 / 配色 / 妆容搭配 / 可选配饰 / 可选鞋履 / 搭配技巧 / 搭配示例
```

This format usually stores a full style guide in `content` and uses plus-separated example outfits under `搭配示例`.
The parser should keep the full `raw` entry for AI scene generation, while `materializeWorldBookStyle()` can fall back to one `搭配示例` line for non-AI random rolls.

When adding another non-uu world book format, first check:

```text
worldBookClothingPattern
worldBookClothingPartPattern
parseWorldBookEntry()
generateWorldBookConcreteOutfit()
worldBookStyleMatchesScene()
```

## Scene AI Generation

Scene buttons call:

```text
renderQuickScenes()
-> tryGenerateAIDescription(scene, callback)
```

`tryGenerateAIDescription()` does this:

```text
1. Get SillyTavern context
2. Use ctx.generateRaw
3. Read selected world books
4. Filter matching modern/lingerie style entries for the scene
5. Build styleGuide from raw world-book entries
6. Read pending user input from #send_textarea
7. Read recent chat messages from ctx.chat
8. Read current character name/description
9. Build systemPrompt and userPrompt
10. Call generateRaw
11. Clean model output with _cleanOutfitResult()
12. Return a virtual outfit
```

Prompt structure:

```text
SYSTEM:
你是穿搭助手...
Rules:
- judge whether user needs changing based on current story
- generate according to user persona, scene, season, job, preferences
- do not copy examples
- do not output <horae>, <content>, <details>, <status>
- first line must be style name

USER:
=========穿搭风格指导=========
matching world-book entries

=========当前正文和故事情节=========
pending user input
character info
recent chat context

场景：约会
请根据上述规则生成user的穿搭。
```

Important helper functions:

```text
_cleanStoryText()      Removes CSS/HTML noise from chat context
_getPendingUserInput() Reads unsent ST input
_getChatContext()      Reads recent chat messages
_getCharacterInfo()    Reads current character name/description
_cleanOutfitResult()   Removes leaked <horae>/<content>/<status> blocks
```

Use `ctx.generateRaw`, not `generateQuietPrompt`. `generateQuietPrompt` previously entered ST's full generation pipeline and could hang.

Scene result actions can call the Chatu8 image bridge from the generated text.
Before sending, sync the editable `.om-roll-desc` textarea back into the outfit
object, derive `name` / `style` from the edited description's first style line
when applicable, then use the existing Chatu8 preview-first save flow.

## Prompt Injection Into Normal Chat

Generation and injection are separate.

Scene generation creates or applies an outfit. Normal chat injection tells the model what is currently worn.

Injection starts with:

```text
setupInjection()
```

It monkey-patches:

```text
window.fetch
XMLHttpRequest.prototype.send
```

Then every outgoing request body goes through:

```text
tryInjectBody(bodyStr)
```

`tryInjectBody()`:

```text
1. JSON.parse request body
2. load current Outfit Manager data
3. collect User activeIds
4. collect Char activeIds
5. return without changes if no active outfits exist
6. build outfit text templates
7. inject text into user/context/system position
8. inject images if mode is image/both
9. JSON.stringify modified body
```

This is why `activeIds` is the current-clothing source of truth.

## World Books And Normal Chat

OM should not strip or parse XML/world-book text from outgoing chat requests.
Users should import OM style world books for OM to read directly, but should not
enable those books globally in SillyTavern. Then normal chat prompts contain
only the current active outfit injection, not the full style books.

If no active outfit exists, `tryInjectBody()` must return `null` and leave the
request unchanged. If any active User or character outfit exists, OM injects it
without judging the current preset, world book, or plugin prompt type. Do not add
preset-specific skip logic, prompt-builder detection, or request-layer XML
cleanup.

Default injection templates should be plain state blocks: title plus outfit
content only. Do not add explanation lines such as "continuity reference",
"no need to describe clothes every turn", "must mention clothing", or repeated
strict clothing narration rules.

## Image Features

Image-description features use:

```text
callVisionAPI(apiCfg, image, systemPrompt, cb)
batchGenerateDescriptions()
generateSingleDescription()
batchParseItems()
batchAutoTagItems()
```

These are separate from scene AI generation.

Scene generation uses `ctx.generateRaw`.
Image analysis uses OpenAI-compatible `chat/completions` with image content.

Read outfit images through `resolveOutfitImage(outfit)` / `hasOutfitImage()`,
not by checking `outfit.imageData` directly. `imageData` is the current legacy
inline/base64 field; future server-cached images should use lightweight
references such as `imageRef` / `imageUrl` while old data keeps working.

## External Frontend / Chatu8 Bridge

智绘姬 / st-chatu8 front-end integration is event-based, not a direct OM API.
OM should prefer JS-Slash-Runner / Tavern Helper globals when available:

```js
eventEmit
eventOn
eventRemoveListener
```

Before adding OM features that call 智绘姬, detect all three functions and fail
gracefully if they are missing. Since st-chatu8 also listens on SillyTavern's
`eventSource`, OM may fall back to dynamically importing `/script.js` and using
`eventSource.on/emit/removeListener`.

Known 智绘姬 image generation events:

```text
request  generate-image-request
response generate-image-response
```

Request payload:

```js
{ id, prompt, change, width, height }
```

Response payload includes:

```js
{ id, success, imageData, error, prompt, change }
```

`imageData` is a base64/data URL image. For OM, prefer preview-first behavior
and only write it into wardrobe data after explicit user confirmation, because
base64 images can bloat shared settings.

Before emitting `generate-image-request`, show the full Chatu8 prompt in an
editable confirmation sheet. Send to Chatu8 only after the user confirms, and
pass the edited prompt through to the generated-image preview/save sheet.

OM's default Chatu8 prompt is for pure outfit display / wardrobe cover images,
not story illustrations. Keep it short, centered on clothing shape, color,
material, layering, and accessories. Without a reliable appearance reference,
default to a no-face / neck-down composition. Prefer close outfit framing from
neck/chin below to above the knees or mid-thigh, with the model and clothing
filling most of the image and a natural professional fashion pose.

When st-chatu8 also inserts its generated chat image into the page, that image
can use a max z-index and cover OM sheets. Before opening OM preview/save sheets,
keep `.om-overlay` at `2147483647` and re-append it to the end of `body` so the
sheet remains visible and clickable.

OM sheets may also open from inside `.om-modal` result dialogs. Keep sheet
overlays above modal layers so Chatu8 preview/save controls remain clickable.

Known 智绘姬 character/outfit import events:

```text
request  ch-char-data-import-request
response ch-char-data-import-response
```

Use this only for explicit OM -> 智绘姬 export/import workflows. It supports
`mode: "text"` with `<人物>` / `<服装>` blocks and `mode: "structured"` with
`data.characters` / `data.outfits`. `nameCN` is required by 智绘姬.

智绘姬 "陪玩" is a composed workflow, not one OM-facing API. Relevant UI files:

```text
settings.html                         智绘姬AI panel: API, preset role, ASR/TTS
html/settings/llm.html                LLM presets; 智绘姬助手 uses this when preset role is 自定义 (LLM预设)
html/settings/knowledgeBase.html      资料库, 人设管理, user管理, persona/user injection
html/settings/character.html          角色设定, 服装管理, 角色启用列表
html/settings/fab.html                悬浮球, 视频形象, 独立窗口
```

For OM integration, prefer focused bridges: send outfit text/images to 生图 or
export OM outfits into 智绘姬 服装管理. Do not try to control the whole 陪玩 flow
unless the feature explicitly needs persona/user injection, voice, or screen
sharing.

## Common Change Requests

## Bug Intake Mode

When Gabriella says `提交bug模式`, `bug模式`, or gives a bug report for this
project, do not edit code immediately. First read this file and
`GABRIELLA_GLP.md`, then produce a short bug intake note.

The intake note should include:

```text
1. Bug summary
2. Reproduction path as understood
3. Expected vs actual behavior
4. Affected control points:
   def/load/save/UI/worldBook/AI generation/activeIds/tryInjectBody
5. Likely call chain
6. Reproduction plan:
   - What Codex can reproduce locally
   - What needs SillyTavern/browser/user state
7. Minimal fix plan
8. Verification plan
```

Only after the intake note should the agent make code changes, unless the user
explicitly says to investigate only.

Preferred reproduction order:

```text
1. Static trace in index.js
2. node --check index.js
3. Local script/smoke test when the bug can be isolated
4. Browser/SillyTavern reproduction when a running ST session is available
5. User-provided console logs/screenshots when the issue depends on private
   role, world-book, browser, or current chat state
```

For bugs involving the live SillyTavern UI, ask for or inspect:

```text
clicked button or workflow
selected User/character view
selected world books
current active outfit state
browser console errors, especially [OM-AI]
whether a page refresh or ST restart changes the behavior
```

During bug mode, keep the scope narrow:

```text
Do not rewrite storage.
Do not change saved data shape unless explicitly required.
Do not change prompt injection behavior unless the bug is about injection.
Do not add temporary test files to git.
Run node --check index.js after code edits.
```

### Bug report format Gabriella can use

```text
提交bug模式

现象：
点击【】后，出现【】。

复现：
1.
2.
3.

预期：

实际：

console / [OM-AI]：

约束：
```

### Add a bottom-bar button

Edit the HTML inside `openPopup()` where `.om-bottombar` is built.
Then bind the click handler in the "绑定底栏" block.

Example recently added:

```text
id="om-wardrobe-random"
applyRandomWardrobeOutfit()
```

### Open modal actions from settings

When a settings sheet button opens another modal flow, such as export/import,
close the settings sheet first or give the modal a higher layer than
`.om-sheet-overlay`; otherwise the new modal can appear behind the sheet.

### Change scene buttons

Edit `sceneDefs` inside `renderQuickScenes()`.

### Change which styles belong to which scene

Edit `getWorldBookStyleSceneKeys(ws)`.

### Make a scene button use AI differently

Edit `tryGenerateAIDescription(scene, callback)`.

### Change outgoing chat injection

Edit `tryInjectBody()`, `injectText()`, or the default templates in `def()`.

### Fix repeated or unwanted world-book text in actual API requests

Do not fix this by stripping XML in OM. Ask the user to import OM style world
books without enabling them globally, then check `tryInjectBody(bodyStr)` only
for active outfit injection behavior.

### Fix model output leaking RP status blocks

Start at `_cleanOutfitResult(text)` and the system prompt in `tryGenerateAIDescription()`.

## Testing Checklist

After editing, test manually in SillyTavern:

```text
1. Open Outfit Manager panel
2. Confirm bottom buttons render
3. Click 衣柜随机 with an image outfit
4. Confirm current outfit changes and image lightbox opens
5. Click 外出/约会 scene button
6. Confirm console logs SYSTEM/USER prompt
7. Confirm AI result has style name first
8. Confirm no <horae>/<content>/<status> leaks into result
9. Send a normal chat message
10. Confirm outgoing prompt contains active outfit but not all uu world-book entries
```

Useful console log prefix:

```text
[OM-AI]
```

## Git Notes

The repo may contain unrelated untracked helper files:

```text
_live_result.txt
_test_api.cjs
_test_live.cjs
_test_result.txt
```

Do not add them unless explicitly requested.

Some pushes may show a PowerShell `RemoteException` while still succeeding. Confirm with `git log --oneline -3` or remote status if unsure.

### 最近推送记录

- 2026-06-27：中文提交 `补充预设管理和随机搭配退出按钮`，为预设管理和随机搭配 bottom sheet 复用右上角“退出”按钮；验证命令：`node --check index.js`。

## Local Notes

Private/local context. Do not generalize to public docs.

On this machine, SillyTavern world books are stored at:

```text
E:\SillyTaven\SillyTavern\data\default-user\worlds
```

Local text-to-image world books to inspect before improving OM -> 智绘姬 prompts:

```text
电影大师初心2.0第一视角进阶版 (1).json
新版通用角色变量世界书(2).json
Grok文生图提示词.json
```

On this machine, JS-Slash-Runner / Tavern Helper is installed at:

```text
E:\SillyTaven\SillyTavern\data\default-user\extensions\JS-Slash-Runner
```

Its manifest currently loads `dist/index.js` / `dist/index.css` and reports
version `4.8.13`. Relevant local references:

```text
@types/iframe/event.d.ts
src/function/event.ts
src/function/index.ts
```

Use these files to verify `eventEmit`, `eventOn`, and `eventRemoveListener`
behavior before implementing or debugging OM -> 智绘姬 event bridge features.

## High-Risk Areas

Be careful with:

```text
storage migration and save/load behavior
fetch/XHR monkey-patching
world-book stripping regex
scene-to-style mapping
activeIds vs virtualOutfits
User wardrobe vs character wardrobe
AI output cleanup
```

Do not "simplify" these areas without testing the full ST flow.

## Practical Rule

When modifying this project, always ask:

```text
Am I changing saved wardrobe data?
Am I changing current worn state?
Am I changing world-book parsing?
Am I changing scene AI generation?
Am I changing outgoing prompt injection?
```

Most bugs come from mixing these responsibilities.
