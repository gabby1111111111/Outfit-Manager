// 穿搭管理扩展 v19 - SillyTavern Extension
// ★ v19 改进：
//   1. 合并注入：User+Char穿搭拼成一条文本后统一注入，避免多条system被忽略
//   2. 强化模板：默认模板加入角色扮演指令格式，Gemini/DeepSeek/Claude均能识别
//   3. 默认注入位置改为user（用户消息末尾），Gemini兼容性最佳
//   4. 保留v18全部功能

(function () {

    var SCRIPT_NAME = '穿搭管理';
    var OM_VERSION = '21.3.7';
    var BTN_ID = 'outfit-mgr-ext-btn-v4';
    var DB_NAME = 'outfit_mgr_db';
    var DB_VERSION = 1;
    var STORE_NAME = 'data';
    var DATA_KEY = 'main';
    var SHARED_SETTINGS_KEY = 'Outfit-Manager';
    var SHARED_DATA_KEY = 'wardrobeData';
    var MAX_IMG_WIDTH = 800;
    var IMG_QUALITY = 0.75;
    var FAB_ID = 'om-fab-main';
    var UI_LAYOUT_KEY = 'outfit_mgr_ui_layout_v1';
    var IMAGE_MIGRATION_JOURNAL_KEY = 'outfit_mgr_image_migration_journal_v1';
    var POPUP_MIN_W = 360;
    var POPUP_MIN_H = 440;
    var POPUP_MARGIN = 12;

    var dbInstance = null;
    var dataCache = null;
    var persistentLoadComplete = false;
    var darkMode = false; // 默认浅色
    var popupResizeHandler = null;
    var imageMigrationRun = null;
    var dataMaidSafetyObserver = null;

    function getOutfitManagerAudit() {
        if (typeof window === 'undefined') return null;
        if (!window.__outfitManagerAudit) {
            window.__outfitManagerAudit = {
                run_id: 0,
                image_migration: { status: 'idle', total: 0, processed: 0, migrated: 0, failed: 0, remaining: 0, error: null },
                backup_cleanup: { status: 'idle', count: 0, total_bytes: 0, native_tool_available: false, delete_all_hidden: false, clear_size_split: false, keep_count: 0, recommended_delete_count: 0, recommended_delete_bytes: 0, error: null },
                backup_cleanup_delete: { status: 'idle', deleted_count: 0, deleted_bytes: 0, error: null },
                last_error: null
            };
        }
        return window.__outfitManagerAudit;
    }

    function getViewportSize() {
        return {
            w: window.innerWidth || document.documentElement.clientWidth || 1024,
            h: window.innerHeight || document.documentElement.clientHeight || 768
        };
    }

    function isDesktopPopupLayout() {
        var vp = getViewportSize();
        return vp.w >= 720 && vp.h >= 560;
    }

    function clampNum(v, min, max) {
        v = parseFloat(v);
        if (!isFinite(v)) v = min;
        if (max < min) max = min;
        return Math.max(min, Math.min(max, v));
    }

    function loadUILayout() {
        try {
            var raw = localStorage.getItem(UI_LAYOUT_KEY);
            var data = raw ? JSON.parse(raw) : {};
            return data && typeof data === 'object' ? data : {};
        } catch (e) { return {}; }
    }

    function saveUILayout(patch) {
        var data = loadUILayout();
        patch = patch || {};
        Object.keys(patch).forEach(function (k) {
            if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
                data[k] = Object.assign({}, data[k] || {}, patch[k]);
            } else {
                data[k] = patch[k];
            }
        });
        try { localStorage.setItem(UI_LAYOUT_KEY, JSON.stringify(data)); } catch (e) {}
        return data;
    }

    function getDefaultPopupRect() {
        var vp = getViewportSize();
        var w = Math.min(Math.max(Math.round(vp.w * 0.72), 760), vp.w - POPUP_MARGIN * 2);
        var h = Math.min(Math.max(Math.round(vp.h * 0.82), 560), vp.h - POPUP_MARGIN * 2);
        w = Math.max(POPUP_MIN_W, w);
        h = Math.max(POPUP_MIN_H, h);
        return {
            width: w,
            height: h,
            left: Math.round((vp.w - w) / 2),
            top: Math.round((vp.h - h) / 2)
        };
    }

    function clampPopupRect(rect) {
        var vp = getViewportSize();
        var maxW = Math.max(POPUP_MIN_W, vp.w - POPUP_MARGIN * 2);
        var maxH = Math.max(POPUP_MIN_H, vp.h - POPUP_MARGIN * 2);
        var w = clampNum(rect && rect.width, POPUP_MIN_W, maxW);
        var h = clampNum(rect && rect.height, POPUP_MIN_H, maxH);
        var left = clampNum(rect && rect.left, POPUP_MARGIN, vp.w - w - POPUP_MARGIN);
        var top = clampNum(rect && rect.top, POPUP_MARGIN, vp.h - h - POPUP_MARGIN);
        return { left: Math.round(left), top: Math.round(top), width: Math.round(w), height: Math.round(h) };
    }

    function getPopupRect() {
        return clampPopupRect(Object.assign(getDefaultPopupRect(), loadUILayout().popup || {}));
    }

    function applyPopupRect(ov, rect) {
        if (!ov) return;
        if (!isDesktopPopupLayout()) {
            ov.classList.remove('om-windowed');
            ov.classList.add('om-fullscreen');
            ov.setAttribute('style', 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;width:100vw !important;height:100dvh !important;z-index:2147483647 !important;');
            return;
        }
        rect = clampPopupRect(rect || getPopupRect());
        ov.classList.add('om-windowed');
        ov.classList.remove('om-fullscreen');
        ov.setAttribute('style',
            'position:fixed !important;top:' + rect.top + 'px !important;left:' + rect.left + 'px !important;' +
            'width:' + rect.width + 'px !important;height:' + rect.height + 'px !important;right:auto !important;bottom:auto !important;' +
            'z-index:2147483647 !important;');
    }
    function bringPopupLayerToFront() {
        var ov = document.querySelector('.om-overlay');
        if (!ov || !ov.parentNode) return;
        ov.style.setProperty('z-index', '2147483647', 'important');
        if (ov.parentNode.lastElementChild !== ov) ov.parentNode.appendChild(ov);
    }
    // 获取弹层容器（overlay内部的absolute层，不受overflow:hidden影响因为overlay本身没有overflow）
    function getPopupLayer() {
        // 首选overlay内的slot
        var slot = document.getElementById('om-popup-slot');
        if (slot) return slot;
        // 回退：overlay本身
        var ov = document.querySelector('.om-overlay');
        if (ov) return ov;
        // 最后回退：body
        return document.body;
    }

    // ── SillyTavern shared settings storage ─────────────────────
    // This lives in the server-side settings file, so different browsers
    // connected to the same SillyTavern instance see the same wardrobe.
    function getSTContextSafe() {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) return SillyTavern.getContext();
        } catch (e) {}
        return null;
    }

    function getSTRequestHeaders(ctx) {
        try {
            if (ctx && typeof ctx.getRequestHeaders === 'function') return ctx.getRequestHeaders();
            if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getRequestHeaders === 'function') return SillyTavern.getRequestHeaders();
        } catch (e) {}
        return { 'Content-Type': 'application/json' };
    }

    function getSharedSettingsRoot() {
        try {
            var ctx = getSTContextSafe();
            var settings = (ctx && ctx.extensionSettings) ||
                (typeof SillyTavern !== 'undefined' && SillyTavern.extension_settings);
            if (!settings) return null;
            if (!settings[SHARED_SETTINGS_KEY]) settings[SHARED_SETTINGS_KEY] = {};
            return settings[SHARED_SETTINGS_KEY];
        } catch (e) { return null; }
    }

    function loadFromSharedSettings() {
        var root = getSharedSettingsRoot();
        return root && root[SHARED_DATA_KEY] ? root[SHARED_DATA_KEY] : null;
    }

    function saveToSharedSettings(d, force) {
        var root = getSharedSettingsRoot();
        if (!root) return false;
        d.updatedAt = Date.now();
        root[SHARED_DATA_KEY] = d;
        try {
            var ctx = getSTContextSafe();
            if (force && ctx && ctx.saveSettings) ctx.saveSettings();
            else if (ctx && ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
            else if (ctx && ctx.saveSettings) ctx.saveSettings();
        } catch (e) {}
        return true;
    }

    function hasWardrobeData(d) {
        return !!(d && (
            (Array.isArray(d.outfits) && d.outfits.length > 0) ||
            (Array.isArray(d.categories) && d.categories.length > 0) ||
            (d.chars && Object.keys(d.chars).length > 0) ||
            (Array.isArray(d.presets) && d.presets.length > 0)
        ));
    }

    function cloneData(d) {
        try { return d ? JSON.parse(JSON.stringify(d)) : null; }
        catch (e) { return d || null; }
    }

    function mergeUniqueStrings(target, source) {
        if (!Array.isArray(source)) return target || [];
        target = Array.isArray(target) ? target : [];
        source.forEach(function (v) {
            if (v && target.indexOf(v) === -1) target.push(v);
        });
        return target;
    }

    function mergeOutfitsById(target, source) {
        target = Array.isArray(target) ? target : [];
        if (!Array.isArray(source)) return target;
        var seen = {};
        target.forEach(function (o) { if (o && o.id) seen[o.id] = true; });
        source.forEach(function (o) {
            if (!o) return;
            if (!o.id || !seen[o.id]) {
                target.push(o);
                if (o.id) seen[o.id] = true;
            }
        });
        return target;
    }

    function mergeObjectMap(target, source) {
        target = target && typeof target === 'object' ? target : {};
        source = source && typeof source === 'object' ? source : {};
        Object.keys(source).forEach(function (k) {
            if (target[k] === undefined) target[k] = source[k];
        });
        return target;
    }

    function mergeWardrobeData(primary, secondary) {
        var merged = ensureDefaults(cloneData(primary) || def());
        var extra = ensureDefaults(cloneData(secondary) || null);
        if (!hasWardrobeData(extra)) return merged;
        merged.outfits = mergeOutfitsById(merged.outfits, extra.outfits);
        merged.categories = mergeUniqueStrings(merged.categories, extra.categories);
        merged.presets = mergeOutfitsById(merged.presets, extra.presets);
        merged.selectedWorldBookNames = mergeUniqueStrings(merged.selectedWorldBookNames, extra.selectedWorldBookNames);
        merged.charNames = mergeUniqueStrings(merged.charNames, extra.charNames);
        merged.virtualOutfits = mergeObjectMap(merged.virtualOutfits, extra.virtualOutfits);
        if ((!merged.activeIds || merged.activeIds.length === 0) && Array.isArray(extra.activeIds)) merged.activeIds = extra.activeIds.slice();
        if (!merged.chars) merged.chars = {};
        Object.keys(extra.chars || {}).forEach(function (cn) {
            if (!merged.chars[cn]) merged.chars[cn] = { outfits: [], categories: [], activeIds: [] };
            var mc = merged.chars[cn];
            var ec = extra.chars[cn] || {};
            mc.outfits = mergeOutfitsById(mc.outfits, ec.outfits);
            mc.categories = mergeUniqueStrings(mc.categories, ec.categories);
            if ((!mc.activeIds || mc.activeIds.length === 0) && Array.isArray(ec.activeIds)) mc.activeIds = ec.activeIds.slice();
            if (merged.charNames.indexOf(cn) === -1) merged.charNames.push(cn);
        });
        return ensureDefaults(merged);
    }

    // ── IndexedDB ─────────────────────────────────────────────
    function openDB(cb) {
        if (dbInstance) { cb(dbInstance); return; }
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        req.onsuccess = function (e) { dbInstance = e.target.result; cb(dbInstance); };
        req.onerror = function () { cb(null); };
    }

    function loadFromDB(cb) {
        var runtimeCache = dataCache;
        if (dataCache && persistentLoadComplete) { cb(dataCache); return; }
        var shared = loadFromSharedSettings();
        function finishLoaded(base) {
            dataCache = ensureDefaults(base);
            if (runtimeCache && hasWardrobeData(runtimeCache)) dataCache = mergeWardrobeData(dataCache, runtimeCache);
            persistentLoadComplete = true;
            if (hasWardrobeData(dataCache)) saveToSharedSettings(dataCache);
            cb(dataCache);
        }
        openDB(function (db) {
            if (!db) {
                finishLoaded(shared ? mergeWardrobeData(shared, loadFromLS()) : ensureDefaults(loadFromLS()));
                return;
            }
            var tx = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).get(DATA_KEY);
            req.onsuccess = function () {
                var result = req.result;
                if (!hasWardrobeData(result)) {
                    var backup = loadFromLS();
                    if (hasWardrobeData(backup)) { result = backup; saveToDB(result); }
                }
                finishLoaded(shared ? mergeWardrobeData(shared, result || loadFromLS()) : ensureDefaults(result || loadFromLS()));
            };
            req.onerror = function () {
                finishLoaded(shared ? mergeWardrobeData(shared, loadFromLS()) : ensureDefaults(loadFromLS()));
            };
        });
    }

    function saveToDB(d, cb, opts) {
        opts = opts || {};
        dataCache = d;
        persistentLoadComplete = true;
        d.updatedAt = Date.now();
        if (!opts.skipShared) saveToSharedSettings(d, !!opts.forceShared);
        openDB(function (db) {
            if (!db) {
                if (!opts.skipLocalBackup) { try { localStorage.setItem('outfit_mgr_v4', JSON.stringify(d)); } catch (e) {} }
                if (cb) cb();
                return;
            }
            var tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(d, DATA_KEY);
            tx.oncomplete = function () {
                if (!opts.skipLocalBackup) { try { localStorage.setItem('outfit_mgr_v4_backup', JSON.stringify(d)); } catch (e) {} }
                if (cb) cb();
            };
            tx.onerror = function () { if (cb) cb(); };
        });
    }

    function load() {
        if (dataCache) return dataCache;
        dataCache = ensureDefaults(loadFromSharedSettings() || loadFromLS());
        return dataCache;
    }

    function save(d, opts) { dataCache = d; saveToDB(d, null, opts); try { localStorage.setItem('outfit_mgr_v4_backup', JSON.stringify(d)); } catch (e) {} }

    function loadFromLS() {
        try { var r = localStorage.getItem('outfit_mgr_v4'); if (r) return JSON.parse(r); var b = localStorage.getItem('outfit_mgr_v4_backup'); if (b) return JSON.parse(b); return null; } catch (e) { return null; }
    }

    function ensureDefaults(d) {
        var dd = def();
        if (!d) return dd;
        for (var k in dd) { if (d[k] === undefined) d[k] = dd[k]; }
        migrateOldInjectionTemplates(d, dd);
        if (d.activeId && !d.activeIds) d.activeIds = [d.activeId];
        if (!Array.isArray(d.activeIds)) d.activeIds = [];
        if (!Array.isArray(d.presets)) d.presets = [];
        if (!d.chars) d.chars = {};
        if (!d.virtualOutfits) d.virtualOutfits = {};
        if (!d.selectedWorldBookNames || !Array.isArray(d.selectedWorldBookNames)) d.selectedWorldBookNames = [];
        d.selectedWorldBookNames = d.selectedWorldBookNames.filter(isLikelyOutfitWorldBookName);
        if (d.worldBookSelectionInitialized === undefined) d.worldBookSelectionInitialized = d.selectedWorldBookNames.length > 0;
        if (!d.charNames) d.charNames = [];
        if (!d.apiVision) d.apiVision = def().apiVision;
        else { var dv = def().apiVision; for (var vk in dv) { if (d.apiVision[vk] === undefined) d.apiVision[vk] = dv[vk]; } if (d.apiVision.batchSize && !d.apiVision.concurrency) { d.apiVision.concurrency = Math.min(d.apiVision.batchSize, 5); } delete d.apiVision.batchSize;
        if (d.useMainApi !== false) { d.useMainApi = true; autoDetectApiConfig(d); } }
        // v17→v18迁移：把带owner的穿搭移入chars
        migrateV17(d);
        return d;
    }

    function migrateOldInjectionTemplates(d, dd) {
        var old = {
            singleTemplate: '[User当前穿着]\n{{description}}\n（禁止编造其他服装。严禁集中罗列服装信息，服装细节必须分散融入不同的动作、触感、环境互动中，每次只带出一两个细节。）',
            multiTemplate: '[User的可选穿搭]\n{{wardrobe}}\n（禁止编造以上之外的服装。根据场景标签匹配穿搭，若回复中出现场景转换则对应切换穿搭。严禁集中罗列服装信息，服装细节必须分散融入动作、触感、环境互动中，每次只带出一两个细节。）',
            charSingleTemplate: '[{{charName}}当前穿着]\n{{description}}\n（禁止编造其他服装。严禁集中罗列服装信息，服装细节必须分散融入不同的动作、触感、环境互动中，每次只带出一两个细节。）',
            charMultiTemplate: '[{{charName}}的可选穿搭]\n{{wardrobe}}\n（禁止编造以上之外的服装。根据场景标签匹配穿搭，若回复中出现场景转换则对应切换穿搭。严禁集中罗列服装信息，服装细节必须分散融入动作、触感、环境互动中，每次只带出一两个细节。）',
            imagePrompt: '图中为角色当前穿着，禁止编造其他服装。严禁集中罗列，服装细节必须分散融入动作、触感、环境互动中，每次只带出一两个细节。',
            multiImagePrompt: '以上图片为可选穿搭，根据场景标签匹配，场景转换则切换穿搭，禁止编造其他服装。严禁集中罗列，细节分散融入动作和互动中。'
        };
        Object.keys(old).forEach(function (key) {
            if (d[key] === old[key]) d[key] = dd[key];
        });
        var soft = {
            singleTemplate: '[User当前穿着]\n{{description}}\n以上是当前服装状态，仅作为连续性参考；无需每轮主动描写衣服。',
            multiTemplate: '[User当前穿着参考]\n{{wardrobe}}\n以上是当前服装状态，仅作为连续性参考；根据场景需要选用，不必每轮主动描写衣服。',
            charSingleTemplate: '[{{charName}}当前穿着]\n{{description}}\n以上是当前服装状态，仅作为连续性参考；无需每轮主动描写衣服。',
            charMultiTemplate: '[{{charName}}当前穿着参考]\n{{wardrobe}}\n以上是当前服装状态，仅作为连续性参考；根据场景需要选用，不必每轮主动描写衣服。',
            imagePrompt: '图中为角色当前穿着，仅作为服装连续性参考；无需每轮主动描写衣服。',
            multiImagePrompt: '以上图片为当前穿着参考；根据场景需要选用，保持连续性即可。'
        };
        Object.keys(soft).forEach(function (key) {
            if (d[key] === soft[key]) d[key] = dd[key];
        });
    }

    function def() {
        return {
            // User 数据（预设只管这块）
            outfits: [],
            categories: [],
            activeIds: [],
            virtualOutfits: {},  // runtime-only virtual outfits from world book
            presets: [],
            activePresetId: null,
            // Char 数据（独立存储，不受预设影响）
            chars: {},           // { '角色名': { outfits:[], categories:[], activeIds:[] } }
            charNames: [],       // 角色名列表
            charFavorites: [],   // 收藏的角色名（预留）
            charGroups: {},      // 分组（预留）：{ '组名': ['角色名1','角色名2'] }
            // 界面状态
            currentView: 'user',
            selectedWorldBookNames: [],
            worldBookSelectionInitialized: false,
            currentChar: '',
            showBall: true,
            // 注入配置
            mode: 'text',
            injectPosition: 'user',
            autoRollDisabled: false,  // 关闭自动随机穿搭
            singleTemplate: '[User当前穿着]\n{{description}}',
            multiTemplate: '[User当前穿着参考]\n{{wardrobe}}',
            charSingleTemplate: '[{{charName}}当前穿着]\n{{description}}',
            charMultiTemplate: '[{{charName}}当前穿着参考]\n{{wardrobe}}',
            imagePrompt: '图中为角色当前穿着。',
            multiImagePrompt: '以上图片为当前穿着参考。',            itemSingleTemplate: '[User单品衣柜]\
{{wardrobe}}\
（以上为当前可用的单品库存，禁止编造以上之外的服装单品。）',            itemMultiTemplate: '[User穿搭+单品]\
{{outfits}}\
\
[单品衣柜]\
{{items}}\
（以上为当前穿搭和可用单品库存，禁止编造以上之外的服装。）',
            debug: false,
            // API
            useMainApi: true, apiVision: { endpoint: '', key: '', model: '', concurrency: 1, prompt: '请用中文详细描述这张穿搭图片中的服装。包括：服装类型、颜色、材质、款式细节、搭配方式等。只描述服装本身，不描述人物外貌。每套穿搭的描述控制在100-200字。', overwrite: false, parsePrompt: '请逐件列出图中可见单品。格式：类别：描述。类别包括上装/下装/外套/鞋袜/配饰/包包。只列图中实际可见的。每件一行15-30字。', autoTagPrompt: '分析这张穿搭照片，用以下格式回复（简洁，不要解释）：\n名称：<5-15字>\n类型：套装 或 单品\n风格：选一个（学院/简约/运动/甜美/通勤/休闲/街头/优雅/舒适）\n季节：选一个（春/夏/秋/冬/全年）\n场景：选一个（外出/家居/办公/约会/运动/睡前）\n---\n<描述100-200字>' }
        };
    }

    function autoDetectApiConfig(d) {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                var ctx = SillyTavern.getContext();
                if (ctx.chatCompletionSettings) {
                    var cs = ctx.chatCompletionSettings;
                    if (cs.api_url) d.apiVision.endpoint = cs.api_url;
                    if (cs.api_key) d.apiVision.key = cs.api_key;
                    if (cs.model) d.apiVision.model = cs.model;
                }
            }
        } catch (e) {}
    }

    function parseAutoTagResult(text) {
        var result = { name: '', type: '', style: '', season: '', scene: '', description: '' };
        if (!text || !text.trim()) return result;
        var clean = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^\s*[-*]\s*/gm, '').trim();
        var parts = clean.split(/---+\n*/); var metaPart = parts[0] || '';
        if (parts.length > 1) result.description = parts.slice(1).join('\n').trim();
        else result.description = metaPart;
        function findKey(kp) {
            var m = metaPart.match(new RegExp(kp + '\s*[：:]\s*(.+?)(?:\n|$)', 'im'));
            if (m) return m[1].trim();
            return '';
        }
        result.name = findKey('名称') || findKey('名字');
        if (!result.name) { var fl = metaPart.split('\n')[0].replace(/^[#*\-\s]+/, '').trim(); if (fl && fl.length >= 2 && fl.length <= 30 && fl.indexOf('：') === -1 && fl.indexOf(':') === -1) result.name = fl; }
        var tr = findKey('类型'); if (tr) { if (tr.indexOf('套装') !== -1 || tr.indexOf('搭配') !== -1 || tr.indexOf('整套') !== -1 || tr.indexOf('outfit') !== -1) result.type = 'outfit'; else if (tr.indexOf('单品') !== -1 || tr.indexOf('单件') !== -1 || tr.indexOf('item') !== -1) result.type = 'item'; }
        result.style = findKey('风格');
        result.season = findKey('季节');
        result.scene = findKey('场景');
        if (!result.name && !result.style && !result.season && !result.scene) result.description = text.trim();
        return result;
    }

    function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

    // ── Char数据访问辅助 ────────────────────────────────────────
    function getCharData(d, charName) {
        if (!d.chars) d.chars = {};
        if (!d.virtualOutfits) d.virtualOutfits = {};
        ensureCharName(d, charName);
        if (!d.chars[charName]) d.chars[charName] = { outfits: [], categories: [], activeIds: [] };
        return d.chars[charName];
    }

    function ensureCharName(d, charName) {
        if (!charName) return;
        if (!d.charNames) d.charNames = [];
        if (d.charNames.indexOf(charName) === -1) d.charNames.push(charName);
    }

    // 当前视角是user还是某个角色
    function currentOwner(d) {
        if (d.currentView === 'char' && d.currentChar) return d.currentChar;
        return 'user';
    }

    // 获取当前视角的穿搭列表
    function getViewOutfits(d) {
        if (d.currentView === 'char' && d.currentChar) return getCharData(d, d.currentChar).outfits;
        return d.outfits;
    }

    function isItemType(o) {
        return !!(o && (o.type === 'item' || o.type === '单品'));
    }

    function isOutfitType(o) {
        return !!(o && (!o.type || o.type === 'outfit' || o.type === '套装'));
    }

    // 获取当前视角的分类列表
    function getViewCategories(d) {
        if (d.currentView === 'char' && d.currentChar) return getCharData(d, d.currentChar).categories;
        return d.categories;
    }

    // 获取当前视角的activeIds
    function getViewActiveIds(d) {
        if (d.currentView === 'char' && d.currentChar) return getCharData(d, d.currentChar).activeIds;
        return d.activeIds;
    }

    // 设置当前视角的activeIds
    function setViewActiveIds(d, ids) {
        if (d.currentView === 'char' && d.currentChar) { getCharData(d, d.currentChar).activeIds = ids; }
        else { d.activeIds = ids; }
    }

    // 按id查找穿搭（在所有数据中查找）
    function getById(d, id) {
        for (var i = 0; i < d.outfits.length; i++) { if (d.outfits[i].id === id) return d.outfits[i]; }
        if (d.chars) { for (var cn in d.chars) { var co = d.chars[cn].outfits || []; for (var j = 0; j < co.length; j++) { if (co[j].id === id) return co[j]; } } }
        if (d.virtualOutfits && d.virtualOutfits[id]) return d.virtualOutfits[id];
        return null;
    }

    function findPersistentOutfit(d, id) {
        for (var i = 0; i < d.outfits.length; i++) {
            if (d.outfits[i].id === id) return { outfit: d.outfits[i], owner: 'user' };
        }
        if (d.chars) {
            for (var cn in d.chars) {
                var co = d.chars[cn].outfits || [];
                for (var j = 0; j < co.length; j++) {
                    if (co[j].id === id) return { outfit: co[j], owner: cn };
                }
            }
        }
        return null;
    }

    function currentOwnerKey(d) {
        if (d.currentView === 'char' && d.currentChar) return 'char:' + d.currentChar;
        return 'user';
    }

    function getOwnerStore(d, ownerKey) {
        if (ownerKey === 'user') {
            if (!Array.isArray(d.outfits)) d.outfits = [];
            if (!Array.isArray(d.categories)) d.categories = [];
            if (!Array.isArray(d.activeIds)) d.activeIds = [];
            return { key: 'user', label: 'User', outfits: d.outfits, categories: d.categories, activeIds: d.activeIds };
        }
        if (ownerKey && ownerKey.indexOf('char:') === 0) {
            var charName = ownerKey.slice(5);
            if (!charName) return null;
            var cd = getCharData(d, charName);
            if (!Array.isArray(cd.outfits)) cd.outfits = [];
            if (!Array.isArray(cd.categories)) cd.categories = [];
            if (!Array.isArray(cd.activeIds)) cd.activeIds = [];
            return { key: ownerKey, label: charName, outfits: cd.outfits, categories: cd.categories, activeIds: cd.activeIds };
        }
        return null;
    }

    function getWardrobeOwnerOptions(d) {
        var names = [];
        if (Array.isArray(d.charNames)) {
            d.charNames.forEach(function (name) {
                if (name && names.indexOf(name) === -1) names.push(name);
            });
        }
        if (d.chars) {
            Object.keys(d.chars).forEach(function (name) {
                if (name && names.indexOf(name) === -1) names.push(name);
            });
        }
        if (d.currentView === 'char' && d.currentChar && names.indexOf(d.currentChar) === -1) names.push(d.currentChar);
        return [{ key: 'user', label: 'User' }].concat(names.map(function (name) {
            return { key: 'char:' + name, label: name };
        }));
    }

    function cloneOutfitForOwnerTransfer(o, sameOwnerCopy) {
        var cloned = JSON.parse(JSON.stringify(o || {}));
        cloned.id = genId();
        if (!cloned.createdAt) cloned.createdAt = Date.now();
        if (sameOwnerCopy && cloned.name) cloned.name = cloned.name + ' 副本';
        delete cloned.isVirtual;
        delete cloned.worldBookStyle;
        return cloned;
    }

    function addMissingCategory(targetStore, category) {
        if (!category) return;
        if (targetStore.categories.indexOf(category) === -1) targetStore.categories.push(category);
    }

    function resolveOutfitImage(o) {
        if (!o) return '';
        return o.imageUrl || o.imageRef || o.imageData || '';
    }

    function hasOutfitImage(o) {
        return !!resolveOutfitImage(o);
    }

    function isImageDataUrl(value) {
        return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || ''));
    }

    function isInjectableImageValue(value) {
        var s = String(value || '');
        return isImageDataUrl(s) || /^https?:\/\//i.test(s);
    }

    function hasInjectableOutfitImage(o) {
        return isInjectableImageValue(resolveOutfitImage(o));
    }

    function getImageDataParts(dataUrl) {
        var s = String(dataUrl || '');
        var m = s.match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i);
        if (!m) return null;
        var ext = (m[1] || 'png').toLowerCase();
        if (ext === 'jpeg') ext = 'jpg';
        if (ext === 'svg+xml') ext = 'svg';
        return { format: ext, base64: m[2] || '' };
    }

    function assetNamePart(value) {
        return String(value || '')
            .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 40) || 'outfit';
    }

    function saveOutfitImageAsset(imageData, meta, cb) {
        var parts = getImageDataParts(imageData);
        if (!parts || !parts.base64) {
            cb(null, imageData ? { imageRef: imageData, imageUrl: imageData } : null);
            return;
        }
        var ctx = getSTContextSafe();
        var owner = assetNamePart((meta && meta.owner) || 'wardrobe');
        var name = assetNamePart((meta && meta.name) || 'outfit');
        var filename = 'om_' + owner + '_' + name + '_' + Date.now();
        fetch('/api/images/upload', {
            method: 'POST',
            headers: getSTRequestHeaders(ctx),
            body: JSON.stringify({
                image: parts.base64,
                format: parts.format,
                ch_name: 'Outfit-Manager',
                filename: filename
            })
        }).then(function (res) {
            if (!res.ok) {
                return res.json().catch(function () { return {}; }).then(function (err) {
                    throw new Error(err && err.error ? err.error : '图片上传失败');
                });
            }
            return res.json();
        }).then(function (json) {
            var path = json && json.path ? String(json.path) : '';
            if (!path) throw new Error('图片上传返回路径为空');
            cb(null, { imageRef: path, imageUrl: path });
        }).catch(function (err) {
            cb(err && err.message ? err.message : String(err || '图片上传失败'));
        });
    }

    function normalizeOutfitImageRef(ref) {
        return String(ref || '').replace(/^\/+/, '');
    }

    function verifyOutfitImageAsset(ref, cb) {
        var normalized = normalizeOutfitImageRef(ref);
        if (!/^user\/images\//i.test(normalized)) {
            cb('图片路径不是酒馆本地图片引用');
            return;
        }
        fetch('/' + normalized, { cache: 'no-store' }).then(function (res) {
            if (!res.ok) throw new Error('图片验证失败：HTTP ' + res.status);
            var type = res.headers.get('content-type') || '';
            var size = Number(res.headers.get('content-length')) || 0;
            if (type && !/^image\//i.test(type)) throw new Error('图片验证失败：返回内容不是图片');
            if (size > 0) {
                if (res.body && typeof res.body.cancel === 'function') res.body.cancel().catch(function () {});
                return { size: size, type: type };
            }
            if (res.body && typeof res.body.getReader === 'function') {
                var reader = res.body.getReader();
                return reader.read().then(function (chunk) {
                    reader.cancel().catch(function () {});
                    if (!chunk || chunk.done || !chunk.value || chunk.value.byteLength <= 0) throw new Error('图片验证失败：文件为空');
                    return { size: chunk.value.byteLength, type: type };
                });
            }
            throw new Error('当前浏览器不支持低内存图片验证，已保留原 base64');
        }).then(function (result) {
            cb(null, result);
        }).catch(function (err) {
            cb(err && err.message ? err.message : String(err || '图片验证失败'));
        });
    }

    function deleteOutfitImageAsset(outfit, cb) {
        var ref = outfit && (outfit.imageRef || outfit.imageUrl);
        ref = normalizeOutfitImageRef(ref);
        if (!ref || !/^user\/images\//i.test(ref)) {
            if (cb) cb(null, false);
            return;
        }
        fetch('/api/images/delete', {
            method: 'POST',
            headers: getSTRequestHeaders(getSTContextSafe()),
            body: JSON.stringify({ path: ref })
        }).then(function (res) {
            if (!res.ok) throw new Error('图片删除失败');
            if (cb) cb(null, true);
        }).catch(function (err) {
            if (cb) cb(err && err.message ? err.message : String(err || '图片删除失败'));
        });
    }

    function collectStoredOutfitRecords(d) {
        var records = [];
        function addList(list, owner, source, collectionKey) {
            (list || []).forEach(function (outfit, index) {
                if (outfit && typeof outfit === 'object') records.push({ outfit: outfit, owner: owner, source: source, collectionKey: collectionKey, index: index });
            });
        }
        addList(d && d.outfits, 'User', 'user', 'user');
        Object.keys((d && d.chars) || {}).forEach(function (cn) {
            addList(d.chars[cn] && d.chars[cn].outfits, cn, 'char', 'char:' + cn);
        });
        ((d && d.presets) || []).forEach(function (preset, presetIndex) {
            addList(preset && preset.outfits, '预设：' + ((preset && preset.name) || (presetIndex + 1)), 'preset', 'preset:' + presetIndex);
        });
        Object.keys((d && d.virtualOutfits) || {}).forEach(function (id) {
            var outfit = d.virtualOutfits[id];
            if (outfit && typeof outfit === 'object') records.push({ outfit: outfit, owner: '临时穿搭', source: 'virtual', collectionKey: 'virtual', index: id });
        });
        return records;
    }

    function getLegacyImageMigrationTargets(d) {
        return collectStoredOutfitRecords(d).filter(function (record) {
            return isImageDataUrl(record.outfit && record.outfit.imageData);
        });
    }

    function getLegacyImageMigrationStats(d) {
        var targets = getLegacyImageMigrationTargets(d);
        var base64Chars = 0;
        targets.forEach(function (record) {
            var parts = getImageDataParts(record.outfit.imageData);
            if (parts) base64Chars += parts.base64.length;
        });
        return { count: targets.length, estimatedBytes: Math.floor(base64Chars * 3 / 4) };
    }

    function estimateImageDataBytes(imageData) {
        var parts = getImageDataParts(imageData);
        return parts ? Math.floor(parts.base64.length * 3 / 4) : 0;
    }

    function getImageMigrationSignature(imageData) {
        var text = String(imageData || '');
        var hash = 2166136261;
        var step = Math.max(1, Math.floor(text.length / 256));
        for (var i = 0; i < text.length; i += step) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return text.length + ':' + (hash >>> 0).toString(16);
    }

    function getImageMigrationRecordKey(record) {
        var outfit = record && record.outfit;
        return JSON.stringify([
            String(record && record.source || ''),
            String(record && record.collectionKey || record && record.owner || ''),
            String(record && record.index !== undefined ? record.index : ''),
            String(outfit && outfit.id || '')
        ]);
    }

    function loadImageMigrationJournal() {
        try {
            var raw = localStorage.getItem(IMAGE_MIGRATION_JOURNAL_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) { return []; }
    }

    function saveImageMigrationJournal(entries) {
        try {
            if (!entries || entries.length === 0) localStorage.removeItem(IMAGE_MIGRATION_JOURNAL_KEY);
            else localStorage.setItem(IMAGE_MIGRATION_JOURNAL_KEY, JSON.stringify(entries));
            return true;
        } catch (e) { return false; }
    }

    function appendImageMigrationJournal(target, sourceImage, asset) {
        var entries = loadImageMigrationJournal();
        var key = target.journalKey || getImageMigrationRecordKey(target);
        var next = {
            key: key,
            signature: getImageMigrationSignature(sourceImage),
            imageRef: asset.imageRef || asset.imageUrl,
            imageUrl: asset.imageUrl || asset.imageRef
        };
        var replaced = false;
        entries = entries.map(function (entry) {
            if (entry && entry.key === key) { replaced = true; return next; }
            return entry;
        });
        if (!replaced) entries.push(next);
        return saveImageMigrationJournal(entries);
    }

    function replayImageMigrationJournal(d) {
        var entries = loadImageMigrationJournal();
        if (entries.length === 0) return { replayed: 0, discarded: 0 };
        var records = {};
        collectStoredOutfitRecords(d).forEach(function (record) {
            records[getImageMigrationRecordKey(record)] = record;
        });
        var keep = [];
        var replayed = 0;
        var discarded = 0;
        entries.forEach(function (entry) {
            var record = entry && records[entry.key];
            var outfit = record && record.outfit;
            var ref = normalizeOutfitImageRef(entry && (entry.imageRef || entry.imageUrl));
            if (!outfit || !/^user\/images\//i.test(ref)) { discarded++; return; }
            if (!isImageDataUrl(outfit.imageData)) {
                if (normalizeOutfitImageRef(outfit.imageRef || outfit.imageUrl) !== ref) discarded++;
                return;
            }
            if (getImageMigrationSignature(outfit.imageData) !== entry.signature) { discarded++; return; }
            outfit.imageRef = entry.imageRef || entry.imageUrl;
            outfit.imageUrl = entry.imageUrl || entry.imageRef;
            delete outfit.imageData;
            keep.push(entry);
            replayed++;
        });
        saveImageMigrationJournal(keep);
        return { replayed: replayed, discarded: discarded };
    }

    function formatStorageBytes(bytes) {
        bytes = Number(bytes) || 0;
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MiB';
        return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GiB';
    }

    function deleteUnusedOutfitImageAssets(d, removedOutfits, cb) {
        var usedRefs = {};
        collectStoredOutfitRecords(d).forEach(function (record) {
            var ref = normalizeOutfitImageRef(record.outfit && (record.outfit.imageRef || record.outfit.imageUrl));
            if (ref) usedRefs[ref] = true;
        });
        var pending = [];
        var seen = {};
        (removedOutfits || []).forEach(function (outfit) {
            var ref = normalizeOutfitImageRef(outfit && (outfit.imageRef || outfit.imageUrl));
            if (!/^user\/images\//i.test(ref) || usedRefs[ref] || seen[ref]) return;
            seen[ref] = true;
            pending.push({ imageRef: ref, imageUrl: ref });
        });
        var result = { deleted: 0, failed: 0, skipped: (removedOutfits || []).length - pending.length, errors: [] };
        function next() {
            if (pending.length === 0) {
                if (cb) cb(result);
                return;
            }
            deleteOutfitImageAsset(pending.shift(), function (err, deleted) {
                if (err) { result.failed++; result.errors.push(err); }
                else if (deleted) result.deleted++;
                next();
            });
        }
        next();
    }

    function persistImageMigrationCheckpoint(d, force, cb) {
        var root = getSharedSettingsRoot();
        if (!root) { if (cb) cb('无法访问 SillyTavern 共享设置'); return; }
        d.updatedAt = Date.now();
        root[SHARED_DATA_KEY] = d;
        dataCache = d;
        persistentLoadComplete = true;
        if (!force) { if (cb) cb(null); return; }
        // A legacy wardrobe can be hundreds of MiB. IndexedDB structured clones
        // and localStorage JSON copies can double that memory during migration.
        forceSaveSillyTavernSettings(cb);
    }

    function getImageMigrationDeviceProfile() {
        var nav = typeof navigator !== 'undefined' ? navigator : null;
        var memory = Number(nav && nav.deviceMemory) || 0;
        var ua = String((nav && nav.userAgent) || '');
        var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
        if (memory > 0 && memory <= 2) return { mode: 'extreme', label: '极低内存', countLimit: 10, byteLimit: 8 * 1024 * 1024, yieldMs: 500 };
        if (mobile || (memory > 0 && memory <= 4)) return { mode: 'low', label: '手机 / 低内存', countLimit: 25, byteLimit: 24 * 1024 * 1024, yieldMs: 250 };
        return { mode: 'normal', label: '普通电脑', countLimit: 100, byteLimit: 128 * 1024 * 1024, yieldMs: 100 };
    }

    function hasCriticalImageMigrationMemoryPressure() {
        try {
            var memory = typeof performance !== 'undefined' && performance.memory;
            return !!(memory && memory.jsHeapSizeLimit > 0 && memory.usedJSHeapSize / memory.jsHeapSizeLimit >= 0.88);
        } catch (e) { return false; }
    }

    function forceSaveSillyTavernSettings(cb) {
        var finished = false;
        function done(err) {
            if (finished) return;
            finished = true;
            if (cb) cb(err || null);
        }
        function awaitSaveResult(result) {
            if (result && typeof result.then === 'function') {
                result.then(function () { done(null); }).catch(function (err) {
                    done(err && err.message ? err.message : String(err || '共享设置保存失败'));
                });
            } else done(null);
        }

        var ctx = getSTContextSafe();
        try {
            if (ctx && typeof ctx.saveSettings === 'function') {
                awaitSaveResult(ctx.saveSettings());
                return;
            }
        } catch (e) {
            done(e && e.message ? e.message : String(e || '共享设置保存失败'));
            return;
        }

        import('/script.js').then(function (scriptModule) {
            if (scriptModule && typeof scriptModule.saveSettings === 'function') {
                awaitSaveResult(scriptModule.saveSettings());
                return;
            }
            if (ctx && typeof ctx.saveSettingsDebounced === 'function') {
                ctx.saveSettingsDebounced();
                setTimeout(function () { done(null); }, 2000);
                return;
            }
            done('当前 SillyTavern 未提供可用的设置保存 API');
        }).catch(function (err) {
            if (ctx && typeof ctx.saveSettingsDebounced === 'function') {
                try {
                    ctx.saveSettingsDebounced();
                    setTimeout(function () { done(null); }, 2000);
                    return;
                } catch (e) {}
            }
            done(err && err.message ? err.message : String(err || '无法加载 SillyTavern 设置保存 API'));
        });
    }

    function setImageMigrationAudit(run, status, error) {
        var audit = getOutfitManagerAudit();
        if (!audit) return;
        audit.run_id = run ? run.runId : Date.now();
        var remaining = run && run.running ? Math.max(0, run.total - run.migrated) : getLegacyImageMigrationTargets(load()).length;
        audit.image_migration = {
            status: status,
            total: run ? run.total : remaining,
            processed: run ? run.processed : 0,
            migrated: run ? run.migrated : 0,
            failed: run ? run.failed : 0,
            remaining: remaining,
            low_memory: !!(run && run.profile && run.profile.mode !== 'normal'),
            device_mode: run && run.profile ? run.profile.mode : null,
            checkpoint_count: run ? run.checkpointCount : 0,
            checkpoint_item_limit: run && run.profile ? run.profile.countLimit : 0,
            checkpoint_byte_limit: run && run.profile ? run.profile.byteLimit : 0,
            checkpoint_items: run ? run.batchProcessed : 0,
            checkpoint_bytes: run ? run.batchBytes : 0,
            journal_replayed: run ? run.journalReplayed : 0,
            journal_write_failed: run ? run.journalWriteFailed : 0,
            memory_pressure: !!(run && run.memoryPressure),
            error: error || null
        };
        audit.last_error = error || null;
    }

    function setBackupCleanupAudit(status, count, totalBytes, nativeToolAvailable, error, analysis) {
        var audit = getOutfitManagerAudit();
        if (!audit) return;
        analysis = analysis || {};
        audit.run_id = Date.now();
        audit.backup_cleanup = {
            status: status,
            count: Number(count) || 0,
            total_bytes: Number(totalBytes) || 0,
            native_tool_available: !!nativeToolAvailable,
            delete_all_hidden: true,
            clear_size_split: !!analysis.clearSizeSplit,
            keep_count: Number(analysis.keepCount) || 0,
            recommended_delete_count: Number(analysis.recommendedDeleteCount) || 0,
            recommended_delete_bytes: Number(analysis.recommendedDeleteBytes) || 0,
            error: error || null
        };
        audit.last_error = error || null;
    }

    function setBackupCleanupDeleteAudit(status, deletedCount, deletedBytes, error) {
        var audit = getOutfitManagerAudit();
        if (!audit) return;
        audit.run_id = Date.now();
        audit.backup_cleanup_delete = {
            status: status,
            deleted_count: Number(deletedCount) || 0,
            deleted_bytes: Number(deletedBytes) || 0,
            error: error || null
        };
        audit.last_error = error || null;
    }

    function analyzeSettingsBackups(backups) {
        var items = (Array.isArray(backups) ? backups : []).map(function (item) {
            return {
                name: String((item && item.name) || ''),
                hash: String((item && item.hash) || ''),
                size: Number(item && item.size) || 0,
                mtime: Number(item && item.mtime) || 0
            };
        }).sort(function (a, b) { return b.mtime - a.mtime; });
        var result = {
            items: items,
            latest: items[0] || null,
            preMigrationKeep: null,
            recommendedDelete: [],
            uncertain: items.slice(),
            clearSizeSplit: false,
            keepCount: items.length > 0 ? 1 : 0,
            recommendedDeleteCount: 0,
            recommendedDeleteBytes: 0,
            largeThreshold: 0
        };
        if (items.length < 2 || !result.latest || result.latest.size <= 0) return result;

        // A recommendation is made only when older backups are both at least
        // twice the newest backup and at least 10 MiB larger. This deliberately
        // avoids guessing when ordinary settings growth has no obvious split.
        var threshold = Math.max(result.latest.size * 2, result.latest.size + 10 * 1024 * 1024);
        var olderLarge = items.filter(function (item, index) {
            return index > 0 && item.mtime < result.latest.mtime && item.size >= threshold;
        });
        if (olderLarge.length === 0) return result;

        result.clearSizeSplit = true;
        result.largeThreshold = threshold;
        result.preMigrationKeep = olderLarge[0];
        result.recommendedDelete = olderLarge.slice(1);
        result.recommendedDeleteCount = result.recommendedDelete.length;
        result.recommendedDeleteBytes = result.recommendedDelete.reduce(function (sum, item) { return sum + item.size; }, 0);
        result.keepCount = 2;
        result.uncertain = items.filter(function (item) {
            return item !== result.latest && olderLarge.indexOf(item) < 0;
        });
        return result;
    }

    function formatBackupTime(mtime) {
        if (!mtime) return '时间未知';
        try { return new Date(mtime).toLocaleString(); } catch (e) { return '时间未知'; }
    }

    function backupRecordHtml(item) {
        if (!item) return '';
        return '<code>' + esc(item.name || '未命名备份') + '</code>（' + formatStorageBytes(item.size) + '，' + esc(formatBackupTime(item.mtime)) + '）';
    }

    function buildBackupCleanupGuidance(analysis) {
        if (!analysis || !analysis.latest) return '当前没有需要处理的旧设置备份。';
        if (!analysis.clearSizeSplit) {
            return [
                '<div style="line-height:1.6"><b>没有检测到明确的迁移前/迁移后体积断层，因此 OM 不给删除建议。</b></div>',
                '<div style="line-height:1.6;margin-top:5px">请保留最新备份：' + backupRecordHtml(analysis.latest) + '。其余文件先不要批量删除。</div>'
            ].join('');
        }

        return [
            '<div style="line-height:1.6"><b>建议保留 2 份：</b></div>',
            '<div style="line-height:1.6;margin-top:4px">① 迁移后的最新备份：' + backupRecordHtml(analysis.latest) + '</div>',
            '<div style="line-height:1.6;margin-top:4px">② 迁移前保底备份：' + backupRecordHtml(analysis.preMigrationKeep) + '</div>',
            analysis.uncertain.length > 0 ? '<div style="line-height:1.6;margin-top:4px">另外 ' + analysis.uncertain.length + ' 个无法明确判断的备份也会保留，不会进入批量清理。</div>' : '',
            '<div style="line-height:1.6;margin-top:8px"><b>扫描识别：</b>' + analysis.recommendedDeleteCount + ' 个更早的大备份，共 ' + formatStorageBytes(analysis.recommendedDeleteBytes) + '。这里只提供统计提醒，不会执行删除。</div>'
        ].join('');
    }

    function finalizeDataMaidReport(token) {
        if (!token) return Promise.resolve();
        return fetch('/api/data-maid/finalize', {
            method: 'POST',
            headers: getSTRequestHeaders(getSTContextSafe()),
            body: JSON.stringify({ token: token })
        }).then(function (res) {
            if (!res.ok) throw new Error('结束酒馆清理扫描失败：HTTP ' + res.status);
        });
    }

    function deleteRecommendedSettingsBackups(sheet, triggerButton) {
        if (!sheet || !sheet.parentNode || !triggerButton || triggerButton.disabled) return;
        var statusEl = sheet.querySelector('#om-backup-cleanup-status');
        var reportToken = '';
        var pendingAnalysis = null;
        var deleteCompleted = false;
        triggerButton.disabled = true;
        if (statusEl) statusEl.textContent = '正在重新扫描并核对可安全删除的设置备份…';
        setBackupCleanupDeleteAudit('pending', 0, 0, null);

        fetch('/api/data-maid/report', {
            method: 'POST',
            headers: getSTRequestHeaders(getSTContextSafe())
        }).then(function (res) {
            if (!res.ok) throw new Error('重新扫描设置备份失败：HTTP ' + res.status);
            return res.json();
        }).then(function (json) {
            reportToken = String((json && json.token) || '');
            var backups = json && json.report && Array.isArray(json.report.settingsBackups)
                ? json.report.settingsBackups
                : [];
            pendingAnalysis = analyzeSettingsBackups(backups);
            var candidates = pendingAnalysis.recommendedDelete.filter(function (item) { return !!item.hash; });
            if (!pendingAnalysis.clearSizeSplit || candidates.length === 0 || candidates.length !== pendingAnalysis.recommendedDeleteCount) {
                throw new Error('当前没有能够安全批量删除的旧设置备份');
            }

            var message = [
                '将永久删除 ' + candidates.length + ' 个更早的大型设置备份，预计释放 ' + formatStorageBytes(pendingAnalysis.recommendedDeleteBytes) + '。',
                '',
                '会保留：',
                '1. 最新备份：' + pendingAnalysis.latest.name + '（' + formatStorageBytes(pendingAnalysis.latest.size) + '）',
                '2. 迁移前保底：' + pendingAnalysis.preMigrationKeep.name + '（' + formatStorageBytes(pendingAnalysis.preMigrationKeep.size) + '）',
                '3. 其他无法明确判断的备份：' + pendingAnalysis.uncertain.length + ' 个（全部保留）',
                '',
                '不会删除当前 settings.json、衣柜图片、聊天或其他备份分类。',
                '删除后无法恢复，也不会进入回收站。确定继续吗？'
            ].join('\n');
            if (!confirm(message)) {
                setBackupCleanupDeleteAudit('idle', 0, 0, null);
                return finalizeDataMaidReport(reportToken).catch(function () {}).then(function () {
                    reportToken = '';
                    throw { omCancelled: true };
                });
            }

            return fetch('/api/data-maid/delete', {
                method: 'POST',
                headers: getSTRequestHeaders(getSTContextSafe()),
                body: JSON.stringify({
                    token: reportToken,
                    hashes: candidates.map(function (item) { return item.hash; })
                })
            }).then(function (res) {
                if (!res.ok) throw new Error('批量删除设置备份失败：HTTP ' + res.status);
                return finalizeDataMaidReport(reportToken).catch(function () {}).then(function () {
                    reportToken = '';
                    deleteCompleted = true;
                    setBackupCleanupDeleteAudit('success', candidates.length, pendingAnalysis.recommendedDeleteBytes, null);
                    if (statusEl && sheet.parentNode) statusEl.textContent = '已删除 ' + candidates.length + ' 个旧设置备份，正在重新扫描…';
                    toast('✅ 已删除 ' + candidates.length + ' 个旧设置备份，释放约 ' + formatStorageBytes(pendingAnalysis.recommendedDeleteBytes));
                    scanSettingsBackupSummary(sheet);
                });
            });
        }).catch(function (err) {
            if (reportToken) {
                finalizeDataMaidReport(reportToken).catch(function () {});
                reportToken = '';
            }
            if (err && err.omCancelled) {
                if (statusEl && sheet.parentNode) statusEl.textContent = '已取消删除，没有修改任何备份。';
                return;
            }
            var message = err && err.message ? err.message : String(err || '批量删除失败');
            setBackupCleanupDeleteAudit('fail', 0, 0, message);
            if (statusEl && sheet.parentNode) statusEl.textContent = '批量删除未执行：' + message;
            toast('批量删除未执行：' + message, true);
        }).finally(function () {
            if (triggerButton && triggerButton.parentNode && !deleteCompleted) {
                triggerButton.disabled = !(pendingAnalysis && pendingAnalysis.clearSizeSplit && pendingAnalysis.recommendedDeleteCount > 0);
            }
        });
    }

    function scanSettingsBackupSummary(sheet) {
        if (!sheet || !sheet.parentNode) return;
        if (sheet.getAttribute('data-om-backup-scanning') === '1') return;
        sheet.setAttribute('data-om-backup-scanning', '1');
        var statusEl = sheet.querySelector('#om-backup-cleanup-status');
        var summaryEl = sheet.querySelector('#om-backup-cleanup-summary');
        var scanBtn = sheet.querySelector('#om-backup-cleanup-scan');
        var deleteBtn = sheet.querySelector('#om-backup-cleanup-delete');
        var openBtn = sheet.querySelector('#om-backup-cleanup-open');
        var nativeToolAvailable = !!document.getElementById('data_maid_button');
        if (statusEl) statusEl.textContent = '正在读取酒馆的设置备份报告…';
        if (summaryEl) summaryEl.textContent = '';
        if (scanBtn) scanBtn.disabled = true;
        if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 等待扫描结果'; }
        if (openBtn) openBtn.disabled = !nativeToolAvailable;
        setBackupCleanupAudit('pending', 0, 0, nativeToolAvailable, null);

        var reportToken = '';
        fetch('/api/data-maid/report', {
            method: 'POST',
            headers: getSTRequestHeaders(getSTContextSafe())
        }).then(function (res) {
            if (!res.ok) {
                var err = new Error('当前酒馆不支持设置备份统计：HTTP ' + res.status);
                err.httpStatus = res.status;
                throw err;
            }
            return res.json();
        }).then(function (json) {
            reportToken = String((json && json.token) || '');
            var backups = json && json.report && Array.isArray(json.report.settingsBackups)
                ? json.report.settingsBackups
                : [];
            var totalBytes = backups.reduce(function (sum, item) {
                return sum + (Number(item && item.size) || 0);
            }, 0);
            var analysis = analyzeSettingsBackups(backups);
            return finalizeDataMaidReport(reportToken).then(function () {
                reportToken = '';
                setBackupCleanupAudit('success', backups.length, totalBytes, nativeToolAvailable, null, analysis);
                if (sheet.parentNode) {
                    if (statusEl) statusEl.textContent = backups.length > 0
                        ? '检测到 ' + backups.length + ' 个设置备份，共 ' + formatStorageBytes(totalBytes) + '。'
                        : '没有检测到设置备份。';
                    if (summaryEl) {
                        summaryEl.innerHTML = buildBackupCleanupGuidance(analysis);
                    }
                    if (deleteBtn) {
                        deleteBtn.disabled = !analysis.clearSizeSplit || analysis.recommendedDeleteCount === 0;
                        deleteBtn.innerHTML = analysis.clearSizeSplit && analysis.recommendedDeleteCount > 0
                            ? '<i class="fa-solid fa-trash-can"></i> 一键清理上述 ' + analysis.recommendedDeleteCount + ' 个旧备份'
                            : '<i class="fa-solid fa-shield-halved"></i> 暂无可安全批量删除的备份';
                    }
                }
            });
        }).catch(function (err) {
            if (reportToken) {
                finalizeDataMaidReport(reportToken).catch(function () {});
                reportToken = '';
            }
            var message = err && err.message ? err.message : String(err || '无法读取设置备份报告');
            var unsupported = err && (err.httpStatus === 404 || err.httpStatus === 405);
            if (sheet.parentNode) {
                if (statusEl) statusEl.textContent = unsupported ? '当前酒馆版本没有可用的备份统计接口。' : '设置备份统计失败：' + message;
                if (summaryEl) summaryEl.textContent = '请手动进入：用户设置 → 杂项 → 清理（Clean-Up）→ Scan → Settings Backups。';
                if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> 扫描失败，不能批量删除'; }
            }
            setBackupCleanupAudit(unsupported ? 'unsupported' : 'fail', 0, 0, nativeToolAvailable, message);
        }).finally(function () {
            sheet.removeAttribute('data-om-backup-scanning');
            if (sheet.parentNode && scanBtn) scanBtn.disabled = false;
        });
    }

    function refreshSettingsBackupSummaries() {
        document.querySelectorAll('[data-om-migration-sheet]').forEach(function (sheet) {
            scanSettingsBackupSummary(sheet);
        });
    }

    function removeDataMaidDeleteAllButtons(root) {
        var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        if (scope.matches && scope.matches('.dataMaidDeleteAll')) scope.remove();
        scope.querySelectorAll('.dataMaidDeleteAll').forEach(function (button) { button.remove(); });
    }

    function installDataMaidSafetyGuard() {
        removeDataMaidDeleteAllButtons(document);
        if (dataMaidSafetyObserver || typeof MutationObserver === 'undefined' || !document.body) return;
        dataMaidSafetyObserver = new MutationObserver(function (records) {
            records.forEach(function (record) {
                record.addedNodes.forEach(function (node) {
                    if (node && node.nodeType === 1) removeDataMaidDeleteAllButtons(node);
                });
            });
        });
        dataMaidSafetyObserver.observe(document.body, { childList: true, subtree: true });
    }

    function openNativeDataMaidFromMigration(sheet) {
        var button = document.getElementById('data_maid_button');
        if (!button) {
            var statusEl = sheet && sheet.querySelector('#om-data-maid-open-status');
            if (statusEl) statusEl.textContent = '未找到酒馆清理工具入口，请按下方路径手动打开。';
            var current = getOutfitManagerAudit();
            var currentBackup = current && current.backup_cleanup;
            setBackupCleanupAudit('unsupported', currentBackup && currentBackup.count, currentBackup && currentBackup.total_bytes, false, '未找到 #data_maid_button', {
                clearSizeSplit: currentBackup && currentBackup.clear_size_split,
                keepCount: currentBackup && currentBackup.keep_count,
                recommendedDeleteCount: currentBackup && currentBackup.recommended_delete_count,
                recommendedDeleteBytes: currentBackup && currentBackup.recommended_delete_bytes
            });
            return;
        }
        installDataMaidSafetyGuard();
        closePopup();
        setTimeout(function () { button.click(); }, 0);
    }

    function updateImageMigrationUI() {
        var run = imageMigrationRun;
        var stats = run
            ? { count: Math.max(0, run.total - run.migrated), estimatedBytes: Math.max(0, run.remainingBytes || 0) }
            : getLegacyImageMigrationStats(load());
        document.querySelectorAll('[data-om-migration-sheet]').forEach(function (sheet) {
            var statusEl = sheet.querySelector('#om-migration-status');
            var detailEl = sheet.querySelector('#om-migration-detail');
            var progressEl = sheet.querySelector('#om-migration-progress');
            var startBtn = sheet.querySelector('#om-migration-start');
            var stopBtn = sheet.querySelector('#om-migration-stop');
            if (run) {
                var pct = run.total > 0 ? Math.round(run.processed * 100 / run.total) : 100;
                if (progressEl) progressEl.style.width = pct + '%';
                if (detailEl) detailEl.textContent = '已处理 ' + run.processed + ' / ' + run.total + '，成功 ' + run.migrated + '，失败 ' + run.failed + '；仍有 ' + stats.count + ' 条 base64 记录；已保存 ' + run.checkpointCount + ' 个检查点。';
                if (statusEl) {
                    if (run.checkpointing) statusEl.textContent = '正在保存迁移检查点（第 ' + (run.checkpointCount + 1) + ' 次）…';
                    else if (run.running && run.stopRequested) statusEl.textContent = '正在停止：当前图片完成后保存进度。';
                    else if (run.running) statusEl.textContent = run.profile.label + '模式迁移中：' + (run.currentName || '准备下一张图片…');
                    else if (run.status === 'success') statusEl.textContent = '迁移完成。';
                    else if (run.status === 'save_failed') statusEl.textContent = '图片已迁移，但共享设置强制保存失败；请重试保存。';
                    else if (run.status === 'memory_pressure') statusEl.textContent = '检测到浏览器内存压力，已保存并安全暂停；释放其他页面后可继续。';
                    else if (run.status === 'failure_pause') statusEl.textContent = '连续图片迁移失败，已保存并暂停；请检查服务器或网络后重试。';
                    else if (run.status === 'stopped') statusEl.textContent = '已停止并保存当前进度，可随时继续。';
                    else statusEl.textContent = '本轮部分完成；失败图片保留了原 base64，可重试。';
                }
                if (startBtn) {
                    startBtn.disabled = !!run.running || (stats.count === 0 && run.status !== 'save_failed');
                    startBtn.textContent = run.status === 'save_failed' ? '重试保存迁移结果' : (stats.count > 0 ? '继续 / 重试剩余图片' : '已全部迁移');
                }
                if (stopBtn) { stopBtn.disabled = !run.running || run.stopRequested; stopBtn.style.display = run.running ? '' : 'none'; }
            } else {
                if (progressEl) progressEl.style.width = '0%';
                if (detailEl) detailEl.textContent = '待迁移 ' + stats.count + ' 条 base64 图片记录，估算原图数据 ' + formatStorageBytes(stats.estimatedBytes) + '。';
                if (statusEl) statusEl.textContent = stats.count > 0 ? '尚未开始。失败或中断时不会删除原图。' : '没有需要迁移的历史 base64 图片。';
                if (startBtn) { startBtn.disabled = stats.count === 0; startBtn.textContent = stats.count > 0 ? '开始安全迁移' : '已全部迁移'; }
                if (stopBtn) stopBtn.style.display = 'none';
            }
        });
    }

    function migrateOneLegacyImage(run, target, cb) {
        var outfit = target.outfit;
        var sourceImage = outfit && outfit.imageData;
        if (!isImageDataUrl(sourceImage)) { cb(null, false); return; }

        var reuseKey = target.migrationKey || '';
        if (run.reuseKey !== reuseKey) {
            run.reuseKey = reuseKey;
            run.reuseSignature = null;
            run.reuseAsset = null;
        }
        var sourceSignature = getImageMigrationSignature(sourceImage);

        function applyVerifiedAsset(asset) {
            if (outfit.imageData !== sourceImage) { cb('图片在迁移过程中被修改，已保留新内容'); return; }
            if (!appendImageMigrationJournal(target, sourceImage, asset)) run.journalWriteFailed++;
            outfit.imageRef = asset.imageRef || asset.imageUrl;
            outfit.imageUrl = asset.imageUrl || asset.imageRef;
            delete outfit.imageData;
            cb(null, true);
        }

        if (run.reuseAsset && run.reuseSignature === sourceSignature) {
            applyVerifiedAsset(run.reuseAsset);
            return;
        }

        function uploadFresh() {
            saveOutfitImageAsset(sourceImage, { owner: target.owner, name: outfit.name || outfit.id || 'outfit' }, function (uploadErr, asset) {
                if (uploadErr || !asset || !(asset.imageRef || asset.imageUrl)) { cb(uploadErr || '图片上传失败'); return; }
                var ref = asset.imageRef || asset.imageUrl;
                verifyOutfitImageAsset(ref, function (verifyErr) {
                    if (verifyErr) {
                        deleteOutfitImageAsset(asset, function () { cb(verifyErr); });
                        return;
                    }
                    run.reuseSignature = sourceSignature;
                    run.reuseAsset = asset;
                    applyVerifiedAsset(asset);
                });
            });
        }
        // Legacy imageData is the source of truth. Do not trust a pre-existing
        // imageRef merely because it is readable: old imports may have copied
        // one placeholder ref onto many outfits with different base64 images.
        uploadFresh();
    }

    function resetImageMigrationCheckpoint(run) {
        run.batchProcessed = 0;
        run.batchBytes = 0;
        run.checkpointing = false;
        run.reuseKey = '';
        run.reuseSignature = null;
        run.reuseAsset = null;
    }

    function pauseImageMigrationAfterCheckpoint(run, status, message) {
        run.running = false;
        run.status = status;
        run.currentName = '';
        run.targets = [];
        setImageMigrationAudit(run, status === 'failure_pause' ? 'fail' : status, message || null);
        updateImageMigrationUI();
        refreshSettingsBackupSummaries();
        toast(message || '迁移已安全暂停，可稍后继续', status === 'failure_pause');
    }

    function checkpointAndContinueImageMigration(run, pauseStatus, pauseMessage) {
        if (!run.running || run.checkpointing) return;
        run.checkpointing = true;
        updateImageMigrationUI();
        persistImageMigrationCheckpoint(run.data, true, function (saveErr) {
            run.checkpointing = false;
            if (saveErr) {
                run.running = false;
                run.status = 'save_failed';
                run.errors.push('保存检查点：' + saveErr);
                setImageMigrationAudit(run, 'save_failed', saveErr);
                updateImageMigrationUI();
                toast('迁移检查点保存失败，已暂停：' + saveErr, true);
                return;
            }
            saveImageMigrationJournal([]);
            run.checkpointCount++;
            resetImageMigrationCheckpoint(run);
            if (pauseStatus) {
                pauseImageMigrationAfterCheckpoint(run, pauseStatus, pauseMessage);
                return;
            }
            setImageMigrationAudit(run, 'running', null);
            updateImageMigrationUI();
            setTimeout(function () { continueImageMigration(run); }, run.profile.yieldMs);
        });
    }

    function finishImageMigration(run, status) {
        run.running = false;
        run.status = status;
        run.checkpointing = true;
        updateImageMigrationUI();
        persistImageMigrationCheckpoint(run.data, true, function (saveErr) {
            run.checkpointing = false;
            var remaining = getLegacyImageMigrationTargets(run.data).length;
            function completeFinish(backupErr) {
                var finalSaveErr = saveErr || backupErr;
                var error = finalSaveErr || (run.errors.length > 0 ? run.errors[run.errors.length - 1] : null);
                run.reuseSignature = null;
                run.reuseAsset = null;
                run.targets = [];
                if (finalSaveErr) run.status = 'save_failed';
                else if (remaining === 0 && run.failed === 0 && status !== 'stopped') run.status = 'success';
                else if (status !== 'stopped') run.status = 'partial';
                setImageMigrationAudit(run, run.status === 'partial' ? 'fail' : run.status, error);
                updateImageMigrationUI();
                refreshSettingsBackupSummaries();
                renderGrid();
                if (run.status === 'success') toast('✅ 历史图片迁移完成，共迁移 ' + run.migrated + ' 条记录');
                else if (run.status === 'stopped') toast('已停止迁移并保存当前进度');
                else if (run.status === 'save_failed') toast('图片已迁移，但共享设置保存失败：' + finalSaveErr, true);
                else toast('迁移部分完成：成功 ' + run.migrated + '，失败 ' + run.failed + '；可再次重试', true);
            }
            if (!saveErr) saveImageMigrationJournal([]);
            if (!saveErr && remaining === 0) {
                saveToDB(run.data, function () { completeFinish(null); }, { skipShared: true, skipLocalBackup: false });
            } else completeFinish(null);
        });
    }

    function retryImageMigrationSave() {
        var run = imageMigrationRun;
        if (!run || run.status !== 'save_failed' || run.running) return;
        run.running = true;
        run.status = 'running';
        run.checkpointing = true;
        updateImageMigrationUI();
        persistImageMigrationCheckpoint(run.data, true, function (err) {
            run.checkpointing = false;
            if (err) {
                run.running = false;
                run.status = 'save_failed';
                setImageMigrationAudit(run, 'save_failed', err);
                toast('共享设置保存仍然失败：' + err, true);
            } else {
                saveImageMigrationJournal([]);
                run.checkpointCount++;
                resetImageMigrationCheckpoint(run);
                run.status = 'running';
                setImageMigrationAudit(run, 'running', null);
                toast('✅ 检查点已保存，迁移自动继续');
                setTimeout(function () { continueImageMigration(run); }, run.profile.yieldMs);
            }
            updateImageMigrationUI();
            refreshSettingsBackupSummaries();
        });
    }

    function continueImageMigration(run) {
        if (!run.running) return;
        if (run.stopRequested || run.index >= run.targets.length) {
            finishImageMigration(run, run.stopRequested ? 'stopped' : 'complete');
            return;
        }
        var target = run.targets[run.index++];
        var targetBytes = estimateImageDataBytes(target.outfit && target.outfit.imageData);
        run.currentName = (target.owner ? target.owner + ' / ' : '') + ((target.outfit && target.outfit.name) || '未命名穿搭');
        updateImageMigrationUI();
        migrateOneLegacyImage(run, target, function (err, migrated) {
            run.processed++;
            run.batchProcessed++;
            if (err) {
                run.failed++;
                run.consecutiveFailures++;
                run.errors.push(run.currentName + '：' + err);
            }
            else if (migrated) {
                run.migrated++;
                run.consecutiveFailures = 0;
                run.batchBytes += targetBytes;
                run.remainingBytes = Math.max(0, run.remainingBytes - targetBytes);
            }
            setImageMigrationAudit(run, 'running', err || null);
            updateImageMigrationUI();
            if (run.stopRequested || run.index >= run.targets.length) {
                continueImageMigration(run);
                return;
            }
            run.memoryPressure = hasCriticalImageMigrationMemoryPressure();
            if (run.memoryPressure) {
                checkpointAndContinueImageMigration(run, 'memory_pressure', '检测到浏览器内存压力，当前进度已保存并暂停');
                return;
            }
            if (run.consecutiveFailures >= 3) {
                checkpointAndContinueImageMigration(run, 'failure_pause', '连续 3 张图片迁移失败，当前进度已保存；请检查服务器或网络后重试');
                return;
            }
            if (run.batchProcessed >= run.profile.countLimit || run.batchBytes >= run.profile.byteLimit) {
                checkpointAndContinueImageMigration(run, null, null);
                return;
            }
            setTimeout(function () { continueImageMigration(run); }, 0);
        });
    }

    function startImageMigration() {
        if (imageMigrationRun && imageMigrationRun.running) return;
        var d = load();
        var replay = replayImageMigrationJournal(d);
        var targets = getLegacyImageMigrationTargets(d);
        if (targets.length === 0 && replay.replayed === 0) { toast('没有需要迁移的历史 base64 图片'); updateImageMigrationUI(); return; }
        var remainingBytes = 0;
        targets.forEach(function (target, index) {
            target.migrationKey = target.outfit.id ? 'id:' + target.outfit.id : 'record:' + index;
            target.journalKey = getImageMigrationRecordKey(target);
            remainingBytes += estimateImageDataBytes(target.outfit.imageData);
        });
        targets.sort(function (a, b) { return a.migrationKey < b.migrationKey ? -1 : (a.migrationKey > b.migrationKey ? 1 : 0); });
        var profile = getImageMigrationDeviceProfile();
        imageMigrationRun = {
            runId: Date.now(), data: d, targets: targets, total: targets.length, index: 0,
            processed: 0, migrated: 0, failed: 0, errors: [], currentName: '',
            remainingBytes: remainingBytes, stopRequested: false, running: true, status: 'running', reuseKey: '', reuseSignature: null, reuseAsset: null,
            profile: profile, checkpointing: false, checkpointCount: 0, batchProcessed: 0, batchBytes: 0,
            consecutiveFailures: 0, memoryPressure: false, journalReplayed: replay.replayed, journalWriteFailed: 0
        };
        setImageMigrationAudit(imageMigrationRun, 'running', null);
        updateImageMigrationUI();
        if (replay.replayed > 0) toast('已从迁移日志恢复 ' + replay.replayed + ' 张已上传图片，避免重复上传');
        continueImageMigration(imageMigrationRun);
    }

    function requestStopImageMigration() {
        if (!imageMigrationRun || !imageMigrationRun.running) return;
        imageMigrationRun.stopRequested = true;
        updateImageMigrationUI();
    }

    function setOutfitImageFields(outfit, imageValue, meta, cb) {
        var oldAsset = { imageRef: outfit.imageRef || outfit.imageUrl || '', imageUrl: outfit.imageUrl || outfit.imageRef || '' };
        function cleanupReplacedAsset() {
            var oldRef = normalizeOutfitImageRef(oldAsset.imageRef || oldAsset.imageUrl);
            var newRef = normalizeOutfitImageRef(outfit.imageRef || outfit.imageUrl);
            if (!oldRef || oldRef === newRef) return;
            deleteUnusedOutfitImageAssets(load(), [oldAsset], function (result) {
                if (result.failed > 0) try { console.warn('[OM-IMG] replaced image cleanup failed:', result.errors); } catch (e) {}
            });
        }
        delete outfit.imageData;
        delete outfit.imageRef;
        delete outfit.imageUrl;
        if (!imageValue) {
            cleanupReplacedAsset();
            if (cb) cb(null, false);
            return;
        }
        if (!isImageDataUrl(imageValue)) {
            outfit.imageRef = imageValue;
            outfit.imageUrl = imageValue;
            cleanupReplacedAsset();
            if (cb) cb(null, false);
            return;
        }
        saveOutfitImageAsset(imageValue, meta, function (err, asset) {
            if (!err && asset && (asset.imageRef || asset.imageUrl)) {
                outfit.imageRef = asset.imageRef || asset.imageUrl;
                outfit.imageUrl = asset.imageUrl || asset.imageRef;
                cleanupReplacedAsset();
                if (cb) cb(null, true);
                return;
            }
            outfit.imageData = imageValue;
            cleanupReplacedAsset();
            if (cb) cb(err || null, false);
        });
    }

    function localImageRefToDataUrl(imageRef, cb) {
        var ref = String(imageRef || '');
        if (!ref || isImageDataUrl(ref) || /^https?:\/\//i.test(ref)) {
            cb(null, ref);
            return;
        }
        var url = ref.charAt(0) === '/' ? ref : '/' + ref;
        fetch(url).then(function (res) {
            if (!res.ok) throw new Error('本地图片读取失败：HTTP ' + res.status);
            return res.blob();
        }).then(function (blob) {
            var reader = new FileReader();
            reader.onload = function () { cb(null, reader.result); };
            reader.onerror = function () { cb('本地图片转换失败'); };
            reader.readAsDataURL(blob);
        }).catch(function (err) {
            cb(err && err.message ? err.message : String(err || '本地图片读取失败'));
        });
    }

    function countAllOutfits(d) {
        var count = (d.outfits || []).length;
        if (d.chars) {
            Object.keys(d.chars).forEach(function (cn) {
                count += ((d.chars[cn] && d.chars[cn].outfits) || []).length;
            });
        }
        return count;
    }

    function countAllOutfitImages(d) {
        var count = 0;
        (d.outfits || []).forEach(function (o) { if (hasOutfitImage(o)) count++; });
        if (d.chars) {
            Object.keys(d.chars).forEach(function (cn) {
                ((d.chars[cn] && d.chars[cn].outfits) || []).forEach(function (o) {
                    if (hasOutfitImage(o)) count++;
                });
            });
        }
        return count;
    }

    // 按id查找穿搭（仅当前视角）
    function getViewById(d, id) {
        var list = getViewOutfits(d);
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
        return null;
    }

    // 判断是否激活（当前视角）
    function isActive(d, id) {
        return getViewActiveIds(d).indexOf(id) !== -1;
    }

    // v17兼容：迁移旧数据中带owner字段的穿搭到chars结构
    function migrateV17(d) {
        if (!d.outfits) return;
        var userOutfits = [];
        var moved = {};
        d.outfits.forEach(function (o) {
            if (o.owner && o.owner !== 'user') {
                var cn = o.owner;
                if (!moved[cn]) moved[cn] = [];
                delete o.owner;
                moved[cn].push(o);
            } else {
                delete o.owner;
                userOutfits.push(o);
            }
        });
        d.outfits = userOutfits;
        if (!d.chars) d.chars = {};
        if (!d.virtualOutfits) d.virtualOutfits = {};
        if (!d.charNames) d.charNames = [];
        for (var cn in moved) {
            if (!d.chars[cn]) d.chars[cn] = { outfits: [], categories: [], activeIds: [] };
            d.chars[cn].outfits = d.chars[cn].outfits.concat(moved[cn]);
            if (d.charNames.indexOf(cn) === -1) d.charNames.push(cn);
        }
        // 迁移 charActiveIds
        if (d.charActiveIds) {
            for (var cn2 in d.charActiveIds) {
                if (!d.chars[cn2]) d.chars[cn2] = { outfits: [], categories: [], activeIds: [] };
                d.chars[cn2].activeIds = d.charActiveIds[cn2];
            }
            delete d.charActiveIds;
        }
    }

    // ── 图片压缩 ─────────────────────────────────────────────
    function compressImage(dataUrl, cb) {
        var img = new Image();
        img.onload = function () {
            var w = img.width, h = img.height, canvas = document.createElement('canvas');
            if (w > MAX_IMG_WIDTH) { canvas.width = MAX_IMG_WIDTH; canvas.height = Math.round(h * MAX_IMG_WIDTH / w); }
            else { canvas.width = w; canvas.height = h; }
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            cb(canvas.toDataURL('image/jpeg', IMG_QUALITY));
        };
        img.onerror = function () { cb(dataUrl); };
        img.src = dataUrl;
    }

    function hasChatu8EventBridge() {
        return typeof window.eventEmit === 'function' &&
            typeof window.eventOn === 'function' &&
            typeof window.eventRemoveListener === 'function';
    }

    var chatu8EventSourceBridge = null;

    function resolveChatu8EventBridge(cb) {
        if (hasChatu8EventBridge()) {
            cb(null, {
                on: function (eventName, listener) {
                    var reg = window.eventOn(eventName, listener);
                    return {
                        stop: function () {
                            try { window.eventRemoveListener(eventName, listener); } catch (e) {}
                            try { if (reg && typeof reg.stop === 'function') reg.stop(); } catch (e2) {}
                        }
                    };
                },
                emit: function (eventName, payload) { return window.eventEmit(eventName, payload); }
            });
            return;
        }
        if (chatu8EventSourceBridge) {
            cb(null, chatu8EventSourceBridge);
            return;
        }
        try {
            Promise.resolve(import('/script.js')).then(function (mod) {
                var es = mod && mod.eventSource;
                if (!es || typeof es.on !== 'function' || typeof es.emit !== 'function' || typeof es.removeListener !== 'function') {
                    cb('未检测到智绘姬事件桥。请确认 st-chatu8 正常加载，或启用 JS-Slash-Runner / Tavern Helper。');
                    return;
                }
                chatu8EventSourceBridge = {
                    on: function (eventName, listener) {
                        es.on(eventName, listener);
                        return { stop: function () { es.removeListener(eventName, listener); } };
                    },
                    emit: function (eventName, payload) { return es.emit(eventName, payload); }
                };
                cb(null, chatu8EventSourceBridge);
            }).catch(function (err) {
                cb(err && err.message ? err.message : '未检测到智绘姬事件桥');
            });
        } catch (e) {
            cb(e && e.message ? e.message : '未检测到智绘姬事件桥');
        }
    }

    function normalizeGeneratedImageData(imageData) {
        imageData = String(imageData || '').trim();
        if (!imageData) return '';
        if (/^data:image\//i.test(imageData)) return imageData;
        return 'data:image/png;base64,' + imageData;
    }

    function getStyleTitleFromDescription(desc) {
        var lines = String(desc || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
        if (lines.length === 0) return '';
        var first = lines[0]
            .replace(/^[-*#\s]+/, '')
            .replace(/^风格\s*[：:]\s*/, '')
            .replace(/^名称\s*[：:]\s*/, '')
            .replace(/^<([^>]{1,40})>$/, '$1')
            .replace(/^【([^】]{1,40})】$/, '$1')
            .replace(/^\[([^\]]{1,40})\]$/, '$1')
            .trim();
        if (!first || first.length > 40) return '';
        if (/^(?:上衣|内搭|下装|裙装|外套|外搭|连衣裙|配饰|鞋袜|文胸|内裤)\s*[：:]/.test(first)) return '';
        return first;
    }

    function normalizeOutfitForChatu8(outfit, fallbackScene) {
        var o = Object.assign({}, outfit || {});
        var title = getStyleTitleFromDescription(o.description);
        var defaultNameRe = /^(?:外出|约会|办公|通勤|家居|运动|睡前|随机)?搭配$/;
        if (title) {
            if (!o.name || defaultNameRe.test(o.name) || (fallbackScene && o.name === fallbackScene + '搭配')) o.name = title;
            if (!o.style || o.style !== title) o.style = title;
        } else if (!o.name && fallbackScene) {
            o.name = fallbackScene + '搭配';
        }
        return o;
    }

    function buildChatu8PromptFromOutfit(outfit, owner) {
        outfit = normalizeOutfitForChatu8(outfit, outfit && outfit.sceneTag);
        var lines = [
            '请生成一张纯穿搭展示图，不是剧情插图。',
            '',
            '人物参考：',
            '默认使用美型服装模特，身材匀称，姿态自然。当前没有可靠外貌参考图时，不要露脸。',
            '',
            '当前穿搭：'
        ];
        if (owner) lines.push('归属：' + owner);
        if (outfit.name) lines.push('名称：' + outfit.name);
        if (outfit.style) lines.push('风格：' + outfit.style);
        if (outfit.season) lines.push('季节：' + outfit.season);
        if (outfit.sceneTag) lines.push('适用场景：' + outfit.sceneTag);
        if (outfit.description) lines.push('描述：' + outfit.description);
        lines.push('');
        lines.push('画面要求：');
        lines.push('- 重点展示衣服版型、颜色、材质、层次和配饰。');
        lines.push('- 不要改衣服，不要自行换装，不要加入剧情动作。');
        lines.push('- 构图必须是近景穿搭展示：从脖子以下/下巴以下裁切到膝盖以上或大腿中部，不要全身远景，不要拍到鞋底和大面积地面。');
        lines.push('- 人物和衣服占画面 85% 以上，背景只保留少量环境，不要大面积空白背景。');
        lines.push('- 姿势像专业穿搭模特：自然 S 形站姿、微侧身、手扶包带/整理衣领/扶腰/轻拿配饰，避免僵硬正站和双手垂直。');
        lines.push('- 单人时尚穿搭展示，服装细节清晰，画面类似近距离穿搭自拍/Lookbook。');
        lines.push('- 避免文字、水印、logo。');
        return lines.join('\n');
    }

    function collectActiveChatu8Outfits(d) {
        var out = [];
        (d.activeIds || []).forEach(function (id) {
            var o = getById(d, id);
            if (o) out.push({ id: id, owner: 'User', outfit: o });
        });
        if (d.chars) {
            for (var cn in d.chars) {
                var cd = d.chars[cn];
                (cd.activeIds || []).forEach(function (id) {
                    var o = getById(d, id);
                    if (o) out.push({ id: id, owner: cn, outfit: o });
                });
            }
        }
        return out;
    }

    function buildChatu8PromptFromActive(items) {
        var lines = [
            '请生成一张纯穿搭展示图，不是剧情插图。',
            '',
            '人物参考：',
            '默认使用美型服装模特，身材匀称，姿态自然。当前没有可靠外貌参考图时，不要露脸。',
            '',
            '当前穿搭组合：'
        ];
        items.forEach(function (it, idx) {
            var outfit = normalizeOutfitForChatu8(it.outfit, it.outfit && it.outfit.sceneTag);
            lines.push('');
            lines.push('--- 穿搭 ' + (idx + 1) + ' / ' + it.owner + ' ---');
            if (outfit.name) lines.push('名称：' + outfit.name);
            if (outfit.style) lines.push('风格：' + outfit.style);
            if (outfit.season) lines.push('季节：' + outfit.season);
            if (outfit.sceneTag) lines.push('适用场景：' + outfit.sceneTag);
            if (outfit.description) lines.push('描述：' + outfit.description);
        });
        lines.push('');
        lines.push('画面要求：');
        lines.push('- 重点展示衣服版型、颜色、材质、层次和配饰。');
        lines.push('- 不要改衣服，不要自行换装，不要加入剧情动作。');
        lines.push('- 构图必须是近景穿搭展示：从脖子以下/下巴以下裁切到膝盖以上或大腿中部，不要全身远景，不要拍到鞋底和大面积地面。');
        lines.push('- 人物和衣服占画面 85% 以上，背景只保留少量环境，不要大面积空白背景。');
        lines.push('- 姿势像专业穿搭模特：自然 S 形站姿、微侧身、手扶包带/整理衣领/扶腰/轻拿配饰，避免僵硬正站和双手垂直。');
        lines.push('- 单人或并列模特的近距离时尚穿搭展示，服装细节清晰，画面类似近距离穿搭自拍/Lookbook。');
        lines.push('- 避免文字、水印、logo。');
        return lines.join('\n');
    }

    function requestChatu8Image(promptText, cb) {
        if (!promptText || !String(promptText).trim()) {
            cb('提示词为空');
            return;
        }
        resolveChatu8EventBridge(function (bridgeErr, bridge) {
            if (bridgeErr) { cb(bridgeErr); return; }
            var requestId = 'om-chatu8-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            var done = false;
            var timer = null;
            var reg = null;

            function cleanup() {
                clearTimeout(timer);
                try { if (reg && typeof reg.stop === 'function') reg.stop(); } catch (e) {}
            }

            function finish(err, data) {
                if (done) return;
                done = true;
                cleanup();
                cb(err, data);
            }

            function onResponse(responseData) {
                if (!responseData || responseData.id !== requestId) return;
                if (!responseData.success) {
                    finish(responseData.error || '智绘姬生图失败');
                    return;
                }
                var img = normalizeGeneratedImageData(responseData.imageData);
                if (!img) {
                    finish('智绘姬返回为空图');
                    return;
                }
                finish(null, {
                    imageData: img,
                    prompt: responseData.prompt || promptText,
                    change: responseData.change || ''
                });
            }

            try {
                reg = bridge.on('generate-image-response', onResponse);
                timer = setTimeout(function () {
                    finish('智绘姬生图超时，请检查任务队列或后端连接');
                }, 120000);
                Promise.resolve(bridge.emit('generate-image-request', {
                    id: requestId,
                    prompt: promptText,
                    change: '',
                    width: null,
                    height: null
                })).catch(function (err) {
                    finish(err && err.message ? err.message : String(err || '事件发送失败'));
                });
            } catch (e) {
                finish(e && e.message ? e.message : String(e || '事件发送失败'));
            }
        });
    }

    function saveChatu8ImageToNewOutfit(source, imageData, promptText) {
        var dd = load();
        var base = source && source.outfit ? source.outfit : {};
        var owner = source && source.owner ? source.owner : '';
        var newOutfit = {
            id: genId(),
            name: (base.name ? base.name + ' 生图' : '智绘姬生图'),
            category: base.category || (owner && owner !== 'User' ? '智绘姬' : ''),
            type: base.type || 'outfit',
            style: base.style || '',
            season: base.season || '',
            sceneTag: base.sceneTag || '',
            description: base.description || promptText || '',
            createdAt: Date.now()
        };
        setOutfitImageFields(newOutfit, imageData, { owner: owner || (dd.currentView === 'char' ? dd.currentChar : 'User'), name: newOutfit.name }, function (err) {
            if (dd.currentView === 'char' && dd.currentChar) getCharData(dd, dd.currentChar).outfits.push(newOutfit);
            else dd.outfits.push(newOutfit);
            save(dd);
            renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn();
            toast(err ? '已另存为新穿搭（图片缓存失败，已保留旧格式）' : '已另存为新穿搭');
        });
    }

    function saveChatu8ImageToExisting(source, imageData) {
        if (!source || !source.id) return false;
        var dd = load();
        var hit = findPersistentOutfit(dd, source.id);
        if (!hit) return false;
        setOutfitImageFields(hit.outfit, imageData, { owner: hit.owner || source.owner || 'User', name: hit.outfit.name }, function (err) {
            save(dd);
            renderGrid(); renderBottomStatus(); updateBtn();
            toast(err ? '已保存到这套穿搭（图片缓存失败，已保留旧格式）' : '已保存到这套穿搭');
        });
        return true;
    }

    function openChatu8PreviewSheet(source, result, promptText) {
        var canOverwrite = !!(source && source.id && findPersistentOutfit(load(), source.id));
        var title = source && source.name ? source.name : '当前穿搭';
        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-palette"></i>智绘姬生图预览</div>',
            '<div class="om-field"><label>' + esc(title) + '</label>',
            '<div class="om-imgarea" style="height:260px;cursor:default"><img src="' + esc(result.imageData) + '" /></div></div>',
            '<div class="om-field"><label>发送给智绘姬的提示词</label>',
            '<textarea rows="5" readonly>' + esc(promptText) + '</textarea></div>',
            '<div class="om-btn-row" style="margin-top:10px">',
            canOverwrite ? '<button class="om-btn om-btn-safe" id="om-chatu8-save-existing"><i class="fa-solid fa-floppy-disk"></i> 保存到这套穿搭</button>' : '',
            '<button class="om-btn om-btn-outline" id="om-chatu8-save-new"><i class="fa-solid fa-box"></i> 另存为新穿搭</button>',
            '<button class="om-btn om-btn-outline" id="om-chatu8-close">关闭</button>',
            '</div>'
        ].join(''));

        function withCompressedImage(fn) {
            compressImage(result.imageData, function (compressed) {
                fn(compressed || result.imageData);
                closeSheet(sheet);
            });
        }

        var saveExisting = sheet.querySelector('#om-chatu8-save-existing');
        if (saveExisting) saveExisting.addEventListener('click', function () {
            withCompressedImage(function (img) { saveChatu8ImageToExisting(source, img); });
        });
        sheet.querySelector('#om-chatu8-save-new').addEventListener('click', function () {
            withCompressedImage(function (img) { saveChatu8ImageToNewOutfit(source, img, promptText); });
        });
        sheet.querySelector('#om-chatu8-close').addEventListener('click', function () { closeSheet(sheet); });
    }

    function openChatu8LoadingSheet(source) {
        var title = source && source.name ? source.name : '当前穿搭';
        var state = { userClosed: false };
        var sheet = createSheet([
            '<div class="om-sheet-title om-settings-title">' +
            '<span><i class="fa-solid fa-palette"></i>智绘姬生图中</span>' +
            '<button class="om-sheet-close" id="om-chatu8-loading-exit" type="button" title="退出智绘姬生图中"><i class="fa-solid fa-xmark"></i>退出</button>' +
            '</div>',
            '<div class="om-field"><label>' + esc(title) + '</label>',
            '<div style="padding:34px 10px;text-align:center;line-height:1.8;opacity:.82">' +
            '<i class="fa-solid fa-spinner fa-spin" style="font-size:1.35em;margin-bottom:10px;color:var(--SmartThemeQuoteColor,#7c6daf)"></i>' +
            '<div style="font-weight:700">正在等待智绘姬返回图片...</div>' +
            '<div style="font-size:.82em;opacity:.72">可以稍等一下，生成完成后会自动打开预览。</div>' +
            '</div></div>'
        ].join(''));
        sheet.querySelector('#om-chatu8-loading-exit').addEventListener('click', function () {
            state.userClosed = true;
            closeSheet(sheet);
        });
        state.close = function () {
            try { closeSheet(sheet); } catch (e) {}
        };
        return state;
    }

    function openChatu8PromptConfirmSheet(source, promptText) {
        var title = source && source.name ? source.name : '当前穿搭';
        var sheet = createSheet([
            '<div class="om-sheet-title om-settings-title">' +
            '<span><i class="fa-solid fa-palette"></i>智绘姬文生图</span>' +
            '<button class="om-sheet-close" id="om-chatu8-exit" type="button" title="退出智绘姬文生图"><i class="fa-solid fa-xmark"></i>退出</button>' +
            '</div>',
            '<div class="om-field"><label>' + esc(title) + '</label>',
            '<textarea id="om-chatu8-prompt-edit" rows="14" style="resize:vertical;min-height:260px;line-height:1.65">' + esc(promptText || '') + '</textarea></div>',
            '<div class="om-btn-row" style="margin-top:10px">',
            '<button class="om-btn om-btn-safe" id="om-chatu8-send"><i class="fa-solid fa-paper-plane"></i> 确认发送</button>',
            '<button class="om-btn om-btn-outline" id="om-chatu8-cancel">取消</button>',
            '</div>'
        ].join(''));
        var ta = sheet.querySelector('#om-chatu8-prompt-edit');
        sheet.querySelector('#om-chatu8-send').addEventListener('click', function () {
            var finalPrompt = ta.value.trim();
            if (!finalPrompt) { toast('提示词为空', true); return; }
            var loading = { userClosed: false };
            var content = sheet.querySelector('.om-sheet-content');
            if (content) {
                content.innerHTML = [
                    '<div class="om-sheet-title om-settings-title">',
                    '<span><i class="fa-solid fa-palette"></i>智绘姬生图中</span>',
                    '<button class="om-sheet-close" id="om-chatu8-loading-exit" type="button" title="退出智绘姬生图中"><i class="fa-solid fa-xmark"></i>退出</button>',
                    '</div>',
                    '<div class="om-field"><label>' + esc(title) + '</label>',
                    '<div style="padding:34px 10px;text-align:center;line-height:1.8;opacity:.82">',
                    '<i class="fa-solid fa-spinner fa-spin" style="font-size:1.35em;margin-bottom:10px;color:var(--SmartThemeQuoteColor,#7c6daf)"></i>',
                    '<div style="font-weight:700">智绘姬生图中</div>',
                    '<div style="font-size:.82em;opacity:.72">正在等待图片返回，完成后会自动打开预览。</div>',
                    '</div></div>'
                ].join('');
                content.querySelector('#om-chatu8-loading-exit').addEventListener('click', function () {
                    loading.userClosed = true;
                    closeSheet(sheet);
                });
            }
            toast('已发送智绘姬生图请求');
            requestChatu8Image(finalPrompt, function (err, result) {
                if (loading.userClosed) return;
                closeSheet(sheet);
                if (err) { toast('智绘姬生图失败：' + err, true); return; }
                openChatu8PreviewSheet(source, result, finalPrompt);
            });
        });
        sheet.querySelector('#om-chatu8-exit').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-chatu8-cancel').addEventListener('click', function () { closeSheet(sheet); });
    }

    function generateChatu8ImageForOutfit(outfit, owner) {
        if (!outfit) return;
        var normalized = normalizeOutfitForChatu8(outfit, outfit.sceneTag);
        var source = { id: normalized.id, name: normalized.name, owner: owner || currentOwner(load()), outfit: normalized };
        var promptText = buildChatu8PromptFromOutfit(normalized, source.owner);
        openChatu8PromptConfirmSheet(source, promptText);
    }

    function generateChatu8ImageForActive() {
        var d = load();
        var items = collectActiveChatu8Outfits(d);
        if (items.length === 0) { toast('请先选择当前穿搭', true); return; }
        var promptText = buildChatu8PromptFromActive(items);
        var source = {
            id: items.length === 1 ? items[0].id : null,
            name: items.length === 1 ? items[0].outfit.name : '当前穿搭组合',
            owner: items.length === 1 ? items[0].owner : 'active',
            outfit: items.length === 1 ? items[0].outfit : {
                name: '当前穿搭组合',
                category: '智绘姬',
                type: 'outfit',
                description: promptText
            }
        };
        openChatu8PromptConfirmSheet(source, promptText);
    }

    // ── Toast ─────────────────────────────────────────────────
    function toast(msg, isErr) {
        var el = document.createElement('div');
        el.textContent = msg;
        el.style.cssText = 'position:absolute !important;bottom:96px !important;left:50% !important;' +
            'transform:translateX(-50%) translateY(8px) !important;' +
            'background:' + (isErr ? '#e57373' : 'var(--SmartThemeQuoteColor,#7c6daf)') + ' !important;' +
            'color:#fff !important;padding:8px 20px !important;border-radius:20px !important;' +
            'font-size:13px !important;font-weight:600 !important;z-index:2147483649 !important;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.4) !important;white-space:nowrap !important;' +
            'pointer-events:none !important;opacity:0 !important;transition:all .22s !important;';
        // 优先挂在 overlay 内
        getPopupLayer().appendChild(el);
        setTimeout(function () {
            el.style.setProperty('opacity', '1', 'important');
            el.style.setProperty('transform', 'translateX(-50%) translateY(0)', 'important');
        }, 10);
        setTimeout(function () { el.style.setProperty('opacity', '0', 'important'); }, 2400);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2700);
    }

    // ── CSS ───────────────────────────────────────────────────
    function injectStyles() {
        var old = document.getElementById('om-style-v4');
        if (old) old.parentNode.removeChild(old);
        var s = document.createElement('style');
        s.id = 'om-style-v4';
        s.textContent = [
            /* ══ 全屏主界面 ══ */
            '@keyframes om-fadein{from{opacity:0}to{opacity:1}}',
            '@keyframes om-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}',
            '@keyframes om-popin{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}',

            /* Data Maid safety: keep per-file trash buttons, remove category-wide Delete All broom. */
            '.dataMaidDeleteAll{display:none!important;pointer-events:none!important;}',

            /* 主界面容器：移动端全屏，PC 端可缩放窗口 */
            '.om-light{--om-bg:#f5f5f7;--om-bg2:#ececef;--om-text:#111;--om-border:rgba(0,0,0,.1);--om-card-bg:rgba(0,0,0,.04);--om-head-bg:rgba(255,255,255,.8);}',
            '.om-dark{--om-bg:#16161a;--om-bg2:#1e1e24;--om-text:#eee;--om-border:rgba(255,255,255,.08);--om-card-bg:rgba(255,255,255,.05);--om-head-bg:rgba(0,0,0,.3);}',
            '.om-overlay{position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100dvh;z-index:2147483647;',
            'background:var(--om-bg,var(--SmartThemeBackgroundColor,#16161a));',
            'color:var(--om-text,var(--SmartThemeBodyColor,#eee));',
            'display:flex;flex-direction:column;color:var(--SmartThemeBodyColor,#eee);',
            'animation:om-fadein .18s ease;font-size:14px;box-sizing:border-box;overflow:hidden;}',
            '.om-overlay.om-windowed{border:1px solid rgba(127,127,127,.22);border-radius:14px;',
            'box-shadow:0 18px 60px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.04);}',
            '.om-overlay.om-fullscreen .om-head{padding-top:calc(12px + constant(safe-area-inset-top));',
            'padding-top:calc(12px + env(safe-area-inset-top,0px));}',
            '.om-overlay.om-windowed .om-head{border-radius:14px 14px 0 0;cursor:move;user-select:none;}',
            '.om-overlay.om-windowed .om-head-actions,.om-overlay.om-windowed .om-head-actions *{cursor:auto;}',
            '.om-resize-handle{display:none;position:absolute;width:18px;height:18px;z-index:1200;pointer-events:auto;touch-action:none;}',
            '.om-windowed .om-resize-handle{display:block;}',
            '.om-resize-nw{top:-2px;left:-2px;cursor:nwse-resize;}',
            '.om-resize-ne{top:-2px;right:-2px;cursor:nesw-resize;}',
            '.om-resize-sw{bottom:-2px;left:-2px;cursor:nesw-resize;}',
            '.om-resize-se{bottom:-2px;right:-2px;cursor:nwse-resize;}',
            '.om-resize-size{position:absolute;right:12px;bottom:12px;z-index:1201;padding:4px 8px;border-radius:8px;',
            'background:rgba(0,0,0,.68);color:#fff;font-size:12px;line-height:1;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.28);}',

            /* 主框 全屏填满 */
            '.om-box{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;}',

            /* ══ 顶栏 ══ */
            '.om-head{display:flex;align-items:center;gap:8px;padding:12px 15px;flex-shrink:0;',
            'border-bottom:1px solid rgba(127,127,127,.1);background:rgba(0,0,0,.12);}',
            '.om-head-title{font-weight:700;font-size:1.05em;display:flex;align-items:center;gap:7px;flex:1;min-width:0;}',
            '.om-head-title i{color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-head-actions{display:flex;align-items:center;gap:4px;}',
            '.om-icon-btn{cursor:pointer;background:none;border:none;opacity:.55;font-size:1.15em;',
            'width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
            'transition:.18s;color:inherit;flex-shrink:0;}',
            '.om-icon-btn:hover{opacity:1;background:rgba(127,127,127,.12);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            /* 日夜切换 */
            '.om-theme-btn{cursor:pointer;background:rgba(127,127,127,.1);border:1px solid rgba(127,127,127,.2);',
            'border-radius:14px;padding:4px 10px;font-size:.75em;display:flex;align-items:center;gap:5px;',
            'transition:.2s;color:inherit;flex-shrink:0;height:28px;white-space:nowrap;}',
            '.om-theme-btn:hover{background:rgba(127,127,127,.2);}',,

            /* 搜索框（顶栏下方展开）*/
            '.om-search-bar{display:none;padding:8px 15px;border-bottom:1px solid rgba(127,127,127,.08);',
            'background:rgba(0,0,0,.06);flex-shrink:0;}',
            '.om-search-bar.open{display:flex;align-items:center;gap:8px;}',
            '.om-search-wrap{flex:1;position:relative;display:flex;align-items:center;}',
            '.om-search-wrap i{position:absolute;left:10px;opacity:.4;font-size:.85em;pointer-events:none;}',
            '.om-search-inp{width:100%;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:7px 32px 7px 30px;font-size:.85em;font-family:inherit;box-sizing:border-box;}',
            '.om-search-inp:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-search-clear{background:none;border:none;color:inherit;opacity:.4;cursor:pointer;font-size:.9em;padding:4px;line-height:1;}',
            '.om-search-clear:hover{opacity:.9;}',

            /* ══ 视角切换栏 ══ */
            '.om-viewbar{display:flex;align-items:center;gap:6px;padding:8px 15px;flex-shrink:0;',
            'border-bottom:1px solid rgba(127,127,127,.08);}',
            '.om-viewtab{padding:5px 16px;border-radius:18px;font-size:.78em;cursor:pointer;white-space:nowrap;',
            'border:1px solid rgba(127,127,127,.15);background:rgba(127,127,127,.06);transition:all .15s;color:inherit;font-family:inherit;}',
            '.om-viewtab:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-viewtab.on{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);font-weight:600;}',
            '.om-char-sel{flex:1;min-width:0;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:5px 10px;font-size:.78em;font-family:inherit;}',
            '.om-char-sel:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-char-add-btn{background:none;border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;',
            'cursor:pointer;padding:5px 10px;font-size:.78em;white-space:nowrap;font-family:inherit;}',
            '.om-char-add-btn:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* ══ 角色选择面板 ══ */
            /* viewbar内的角色搜索框 */
            '.om-char-input{flex:1;min-width:0;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:5px 10px;font-size:.78em;font-family:inherit;box-sizing:border-box;}',
            '.om-char-input:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-char-input::placeholder{opacity:.4;}',
            /* 下拉列表容器 */
            '.om-char-dropdown{position:absolute;left:0;right:0;top:100%;z-index:50;',
            'background:var(--om-bg,#1a1a20);border-bottom:1px solid rgba(127,127,127,.15);',
            'max-height:50vh;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,.2);}',
            '.om-light .om-char-dropdown{background:var(--om-bg,#f4f4f6);}',
            /* 分组标题 */
            '.om-char-group-hdr{display:flex;align-items:center;gap:6px;padding:7px 12px 4px;cursor:pointer;font-size:.78em;font-weight:600;opacity:.5;}',
            '.om-char-group-hdr:hover{opacity:.7;}',
            '.om-char-group-hdr i.om-g-arrow{font-size:.7em;transition:transform .15s;width:10px;text-align:center;}',
            '.om-char-group-hdr i.om-g-arrow.collapsed{transform:rotate(-90deg);}',
            '.om-char-group-hdr i.om-g-icon{font-size:.75em;opacity:.6;}',
            /* 角色行 */
            '.om-char-row{display:flex;align-items:center;gap:8px;padding:9px 12px 9px 20px;cursor:pointer;',
            'transition:background .1s;font-size:.9em;}',
            '.om-char-row:hover{background:rgba(127,127,127,.08);}',
            '.om-char-row.active{background:rgba(124,109,175,.1);}',
            '.om-char-star{cursor:pointer;opacity:.25;flex-shrink:0;width:20px;text-align:center;font-size:.85em;}',
            '.om-char-star.on{opacity:.8;color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-char-rname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.om-char-count{font-size:.78em;opacity:.4;flex-shrink:0;min-width:28px;text-align:right;}',
            '.om-char-actions{display:flex;gap:2px;flex-shrink:0;}',
            '.om-char-act{background:none;border:none;color:inherit;cursor:pointer;opacity:.25;font-size:.82em;padding:3px 5px;border-radius:4px;transition:.15s;}',
            '.om-char-act:hover{opacity:.85;background:rgba(127,127,127,.15);}',
            '.om-char-act.om-char-delete:hover{opacity:1;color:#e57373;background:rgba(229,115,115,.12);}',
            '.om-char-empty{text-align:center;opacity:.3;font-size:.85em;padding:18px 15px;}',

            /* ══ 分类栏 ══ */
            '.om-catbar{display:flex;gap:6px;padding:8px 15px;overflow-x:auto;flex-wrap:nowrap;flex-shrink:0;',
            '-webkit-overflow-scrolling:touch;scrollbar-width:none;',
            'border-bottom:1px solid rgba(127,127,127,.08);}',
            '.om-catbar::-webkit-scrollbar{display:none;}',
            '.om-catbtn{padding:5px 14px;border-radius:18px;font-size:.78em;cursor:pointer;white-space:nowrap;flex-shrink:0;',
            'border:1px solid rgba(127,127,127,.15);background:rgba(127,127,127,.06);transition:all .15s;color:inherit;font-family:inherit;}',
            '.om-catbtn:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-catbtn.on{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);font-weight:600;}',

            /* ══ 网格区（独立滚动）══ */
            '.om-grid-area{flex:1;overflow-y:auto;padding:12px 12px 8px;}',
            '.om-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:9px;}',

            /* ══ 添加卡片 ══ */
            '.om-add-card{border:2px dashed rgba(127,127,127,.22);border-radius:10px;',
            'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;',
            'cursor:pointer;opacity:.55;transition:all .2s;font-size:.8em;color:inherit;}',
            '.om-add-card:hover{opacity:1;border-color:var(--SmartThemeQuoteColor,#7c6daf);',
            'color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(127,127,127,.04);}',
            '.om-add-card i{font-size:1.4em;}',
'.om-batch-add-card{border:2px dashed rgba(127,127,127,.22);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;opacity:.55;transition:all .2s;font-size:.8em;color:inherit;background:linear-gradient(135deg,rgba(124,109,175,.04) 0%,rgba(124,109,175,.01) 100%);}',
'.om-batch-add-card:hover{opacity:1;border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(124,109,175,.08);}',
'.om-batch-add-card i{font-size:1.4em;}',
'.om-type-radios{display:flex;gap:12px;}',
'.om-radio-label{display:flex;align-items:center;gap:4px;font-size:.85em;cursor:pointer;opacity:.7;}',
'.om-radio-label:hover{opacity:1;}',
'.om-radio-label input[type=radio]{accent-color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* ══ 穿搭卡片 ══ */
            '.om-card{border-radius:10px;overflow:hidden;position:relative;cursor:pointer;',
            'transition:all .18s;border:2px solid transparent;display:flex;flex-direction:column;}',
            '.om-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.25);}',
            '.om-card.on{border-color:var(--SmartThemeQuoteColor,#7c6daf);',
            'box-shadow:0 0 0 1px var(--SmartThemeQuoteColor,#7c6daf),0 4px 16px rgba(0,0,0,.2);}',
            /* 图片区 */
            '.om-card-img{width:100%;aspect-ratio:3/4;position:relative;background:rgba(127,127,127,.1);',
            'display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;}',
            '.om-card-img img{width:100%;height:100%;object-fit:cover;display:block;}',
            /* 底部渐变文字遮罩 */
            /* 触屏：点击过的卡片菜单常显 */
            '@media (hover:none){.om-card-menu{opacity:.75 !important;}}',
            '.om-card-info{padding:5px 7px 6px;background:var(--om-card-bg,rgba(127,127,127,.06));min-height:36px;box-sizing:border-box;}',
            '.om-card-name{font-size:.8em;font-weight:600;line-height:1.3;',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
            'color:var(--om-text,#eee);}',
            '.om-card-tag{font-size:.68em;line-height:1.2;margin-top:2px;',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
            'color:var(--om-text,#aaa);opacity:.5;}',
            /* 无图片占位 - 显示描述摘要 */
            '.om-card-noimg{display:flex;flex-direction:column;align-items:flex-start;gap:5px;',
            'width:100%;height:100%;justify-content:flex-start;padding:12px 12px 32px 12px;box-sizing:border-box;',
            'background:linear-gradient(135deg,rgba(127,127,127,.08) 0%,rgba(127,127,127,.03) 100%);}',
            '.om-card-noimg .om-noimg-name{font-size:.88em;font-weight:700;line-height:1.3;',
            'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;',
            'word-break:break-all;color:var(--om-text,#eee);}',
            '.om-card-noimg .om-noimg-desc{font-size:.78em;line-height:1.45;opacity:.55;',
            'display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden;',
            'word-break:break-all;color:var(--om-text,#ccc);}',
            '.om-card-noimg .om-noimg-icon{font-size:1.2em;opacity:.2;position:absolute;bottom:8px;right:8px;}',
            /* 有文字描述但无图片时显示背景 */
            '.om-card.no-img{background:var(--om-card-bg,rgba(127,127,127,.06));}',
            '.om-card.no-img .om-card-info{display:none;}',
            '.om-card.no-img .om-card-img{aspect-ratio:unset;flex:1;min-height:0;}',
            /* 选中角标 */
            '.om-badge-on{position:absolute;top:5px;right:5px;',
            'width:20px;height:20px;border-radius:50%;',
            'background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;',
            'display:flex;align-items:center;justify-content:center;font-size:.6em;',
            'box-shadow:0 2px 6px rgba(0,0,0,.3);}',
            /* 批量选择框 */
            '.om-card-check{position:absolute;top:5px;left:5px;',
            'width:20px;height:20px;border-radius:6px;border:2px solid rgba(255,255,255,.7);',
            'background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;',
            'cursor:pointer;transition:.15s;z-index:2;}',
            '.om-card-check.checked{background:var(--SmartThemeQuoteColor,#7c6daf);border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-card-check i{font-size:.65em;color:#fff;opacity:0;transition:.12s;}',
            '.om-card-check.checked i{opacity:1;}',
            '.om-card.batch-sel{border:2px solid var(--SmartThemeQuoteColor,#7c6daf);}',

            /* 卡片菜单按钮 - 右下角，不与对号冲突 */
            '.om-card-menu{position:absolute;bottom:5px;right:5px;',
            'width:20px;height:20px;border-radius:50%;',
            'background:rgba(0,0,0,.5);color:#fff;border:none;cursor:pointer;',
            'display:flex;align-items:center;justify-content:center;font-size:.55em;line-height:1;overflow:hidden;',
            'opacity:0;transition:opacity .18s;z-index:3;pointer-events:auto;',
            'backdrop-filter:blur(4px);box-shadow:0 2px 6px rgba(0,0,0,.3);}',
            '.om-card:hover .om-card-menu,.om-card:active .om-card-menu{opacity:1;}',
            '.om-card-menu:hover{background:rgba(0,0,0,.75);}',

            /* ══ 批量操作栏（网格区顶部，随滚动）══ */
            '.om-batch-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;',
            'background:rgba(124,109,175,.08);border:1px solid rgba(124,109,175,.2);',
            'border-radius:10px;margin-bottom:10px;flex-wrap:nowrap;overflow-x:auto;',
            '-webkit-overflow-scrolling:touch;scrollbar-width:none;}',
            '.om-batch-bar::-webkit-scrollbar{display:none;}',
            '.om-batch-info{font-size:.82em;font-weight:600;color:var(--SmartThemeQuoteColor,#7c6daf);white-space:nowrap;flex-shrink:0;}',
            '.om-batch-acts{display:flex;gap:5px;flex-shrink:0;flex-wrap:nowrap;}',
            '.om-batch-btn{padding:5px 10px;border-radius:6px;border:1px solid rgba(127,127,127,.2);',
            'background:rgba(127,127,127,.07);color:inherit;cursor:pointer;font-size:.78em;',
            'font-family:inherit;transition:.15s;white-space:nowrap;flex-shrink:0;}',
            '.om-batch-btn:hover{background:rgba(127,127,127,.15);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-batch-btn.danger{color:#e57373;border-color:rgba(229,115,115,.35);}',
            '.om-batch-btn.danger:hover{background:#e57373;color:#fff;border-color:#e57373;}',

            /* 空状态 */
            '.om-empty{text-align:center;padding:40px 0;opacity:.45;display:flex;flex-direction:column;gap:10px;align-items:center;font-size:.88em;}',
            '.om-empty i{font-size:2.6em;}',

            /* ══ 底栏 ══ */
            '.om-quick-scenes{display:flex;align-items:center;gap:8px;padding:8px 15px;border-bottom:1px solid rgba(127,127,127,.08);flex-shrink:0;overflow-x:auto;scrollbar-width:none;background:linear-gradient(90deg,rgba(127,127,127,.08),rgba(127,127,127,.02));}.om-quick-scenes::-webkit-scrollbar{display:none;}.om-quick-title{font-size:.76em;opacity:.65;white-space:nowrap;flex:0 0 auto;}.om-quick-panel{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;}.om-quick-scene-btn{font-size:.76em;padding:5px 12px;border-radius:999px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.08);color:inherit;cursor:pointer;white-space:nowrap;transition:all .15s;flex:0 0 auto;}.om-quick-scene-btn:hover{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);transform:translateY(-1px);}.om-bottombar{display:flex !important;align-items:center;gap:6px;padding:10px 14px;flex-shrink:0;',
            'border-top:1px solid rgba(127,127,127,.1);background:rgba(0,0,0,.12);}',
            '.om-bottom-status{flex:1;min-width:0;display:flex;align-items:center;gap:7px;',
            'cursor:pointer;border-radius:8px;padding:5px 7px;transition:.15s;',
            'border:1px solid transparent;}',
            '.om-bottom-status:hover{background:rgba(127,127,127,.08);border-color:rgba(127,127,127,.12);}',
            '.om-status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}',
            '.om-status-dot.gray{background:rgba(127,127,127,.5);}',
            '.om-status-dot.green{background:#4caf50;}',
            '.om-status-dot.orange{background:#ff8c42;}',
            '.om-status-text{font-size:.82em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9;}',
            '.om-status-clear{margin-left:4px;background:none;border:none;font-size:.75em;color:inherit;',
            'opacity:.5;cursor:pointer;white-space:nowrap;padding:2px 5px;border-radius:4px;font-family:inherit;flex-shrink:0;}',
            '.om-status-clear:hover{opacity:1;background:rgba(127,127,127,.1);}',
            '.om-bottom-btn{width:36px;height:36px;border-radius:50%;border:1px solid rgba(127,127,127,.15);',
            'background:rgba(127,127,127,.06);color:inherit;cursor:pointer;',
            'display:flex;align-items:center;justify-content:center;font-size:.9em;',
            'transition:.18s;flex-shrink:0;}',
            '.om-bottom-btn:hover{background:rgba(127,127,127,.15);border-color:var(--SmartThemeQuoteColor,#7c6daf);',
            'color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-batch-toggle-btn{padding:6px 11px;border-radius:18px;border:1px solid rgba(127,127,127,.2);',
            'background:rgba(127,127,127,.07);color:inherit;cursor:pointer;font-size:.75em;',
            'white-space:nowrap;font-family:inherit;transition:.15s;flex-shrink:0;}',
            '.om-batch-toggle-btn:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-batch-toggle-btn.on{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* ══ 选择详情面板（从底栏上方弹出）══ */
            '.om-detail-panel{position:absolute;bottom:0;left:0;right:0;',
            'background:var(--om-bg2,var(--SmartThemeBackgroundColor,rgba(28,28,32,1)));',
            'border-radius:16px 16px 0 0;padding:14px 16px 16px;',
            'box-shadow:0 -4px 24px rgba(0,0,0,.3);',
            'animation:om-sheet-up .22s ease;border-top:1px solid rgba(127,127,127,.15);}',
            '.om-detail-handle{width:32px;height:4px;border-radius:2px;',
            'background:rgba(127,127,127,.25);margin:0 auto 12px;}',
            '.om-detail-title{font-size:.78em;font-weight:700;opacity:.55;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;}',
            '.om-detail-tags{display:flex;flex-wrap:wrap;gap:6px;}',
            '.om-detail-tag{display:inline-flex;align-items:center;gap:5px;',
            'padding:4px 6px 4px 10px;border-radius:14px;',
            'background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;font-size:.78em;font-weight:600;}',
            '.om-detail-tag-x{background:none;border:none;color:#fff;cursor:pointer;',
            'font-size:.9em;line-height:1;padding:0 2px;opacity:.75;font-family:inherit;}',
            '.om-detail-tag-x:hover{opacity:1;}',

            /* ══ Bottom Sheet 通用 ══ */
            '.om-sheet-overlay{position:absolute !important;inset:0 !important;z-index:30 !important;background:rgba(0,0,0,.45) !important;pointer-events:auto !important;}',
            '.om-sheet{position:absolute;bottom:0;left:0;right:0;max-height:88vh;max-height:88dvh;',
            'background:var(--om-bg2,var(--SmartThemeBackgroundColor,#1a1a1e));',
            'color:var(--om-text,var(--SmartThemeBodyColor,#eee));',
            'border-radius:18px 18px 0 0;overflow-y:auto;',
            'animation:om-sheet-up .25s ease;border:1px solid rgba(127,127,127,.15);border-bottom:none;}',
            '.om-sheet-handle{width:36px;height:4px;border-radius:2px;',
            'background:rgba(127,127,127,.25);margin:10px auto 4px;}',
            '.om-sheet-content{padding:4px 20px 32px;}',
            '.om-sheet-title{font-weight:700;font-size:1.05em;padding:10px 0 14px;',
            'display:flex;align-items:center;gap:8px;}',
            '.om-sheet-title i{color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-settings-title{justify-content:space-between;gap:12px;}',
            '.om-settings-title-main{display:flex;align-items:center;gap:8px;min-width:0;}',
            '.om-sheet-close{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(127,127,127,.2);',
            'background:rgba(127,127,127,.08);color:inherit;border-radius:999px;padding:6px 10px;',
            'font-size:.78em;line-height:1;cursor:pointer;font-family:inherit;flex-shrink:0;}',
            '.om-sheet-close:hover{background:rgba(127,127,127,.16);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* ══ 长按操作菜单 Bottom Sheet ══ */
            '.om-ctx-item{display:flex;align-items:center;gap:12px;padding:14px 4px;',
            'cursor:pointer;border-bottom:1px solid rgba(127,127,127,.08);transition:.15s;border-radius:0;}',
            '.om-ctx-item:last-child{border-bottom:none;}',
            '.om-ctx-item:hover{color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-ctx-item i{width:20px;text-align:center;opacity:.75;font-size:1em;}',
            '.om-ctx-item.danger{color:#e57373;}',
            '.om-ctx-item.danger:hover{color:#ef5350;}',
            '.om-ctx-outfit-name{font-size:.85em;opacity:.5;padding:2px 0 10px;',
            'border-bottom:1px solid rgba(127,127,127,.1);margin-bottom:4px;}',

            /* ══ 通用组件 ══ */
            '.om-sec-title{font-size:.75em;font-weight:700;opacity:.55;text-transform:uppercase;',
            'letter-spacing:.07em;padding:10px 0 7px;}',
            '.om-divider{height:1px;background:rgba(127,127,127,.12);margin:6px 0 12px;}',
            '.om-hint{font-size:.76em;opacity:.5;line-height:1.4;}',
            '.om-btn-row{display:flex;gap:8px;flex-wrap:wrap;}',
            '.om-btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;',
            'font-size:.87em;font-weight:600;transition:.18s;font-family:inherit;}',
            '.om-btn-safe{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;}',
            '.om-btn-safe:hover{filter:brightness(1.1);box-shadow:0 3px 10px rgba(0,0,0,.15);}',
            '.om-btn-outline{background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.22);color:inherit;}',
            '.om-btn-outline:hover{background:rgba(127,127,127,.15);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-btn-danger{background:rgba(229,115,115,.1);border:1px solid #e57373;color:#e57373;}',
            '.om-btn-danger:hover{background:#e57373;color:#fff;}',
            /* 输入 */
            '.om-setting-row{display:flex;flex-direction:column;gap:5px;margin-bottom:4px;}',
            '.om-setting-row label{font-size:.8em;opacity:.7;}',
            '.om-setting-row select,.om-setting-row textarea{background:rgba(127,127,127,.08);',
            'border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;',
            'padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;}',
            '.om-setting-row select:focus,.om-setting-row textarea:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-row-inline{flex-direction:row!important;align-items:center;justify-content:space-between;}',
            '.om-row-inline label{opacity:.8;font-size:.88em;}',
            '.om-chk{width:17px;height:17px;accent-color:var(--SmartThemeQuoteColor,#7c6daf);cursor:pointer;}',
            '.om-storage-info{font-size:.72em;opacity:.45;padding:4px 0;}',
            /* 编辑表单 */
            '.om-field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}',
            '.om-field label{font-size:.8em;opacity:.7;font-weight:500;}',
            '.om-field input[type=text],.om-field select,.om-field textarea{',
            'background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:9px 11px;font-size:.9em;width:100%;box-sizing:border-box;font-family:inherit;}',
            '.om-field textarea{resize:none;}',
            '.om-field input:focus,.om-field select:focus,.om-field textarea:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-frow{display:flex;gap:7px;align-items:stretch;}',
            '.om-frow select{flex:1;}',
            '.om-imgarea{width:100%;height:160px;background:rgba(127,127,127,.06);',
            'border:2px dashed rgba(127,127,127,.25);border-radius:10px;',
            'display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;transition:border-color .18s;}',
            '.om-imgarea:hover,.om-imgarea.drag{border-color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(127,127,127,.1);}',
            '.om-imgph{display:flex;flex-direction:column;align-items:center;gap:6px;opacity:.4;font-size:.82em;pointer-events:none;}',
            '.om-imgph i{font-size:1.8em;}',
            '.om-imgarea img{width:100%;height:100%;object-fit:contain;}',
            '.om-img-actions{display:flex;gap:7px;margin-top:7px;}',
            '.om-edit-foot{display:flex;gap:9px;justify-content:flex-end;padding-top:14px;',
            'border-top:1px solid rgba(127,127,127,.1);margin-top:10px;}',
            /* 场景标签建议 */
            '.om-suggest-wrap{position:relative;width:100%;}',
            '.om-suggest-wrap input{width:100%;box-sizing:border-box;}',
            '.om-suggest-list{position:absolute;top:100%;left:0;right:0;',
            'background:var(--om-bg2,var(--SmartThemeBackgroundColor,rgba(40,40,40,.98)));',
            'border:1px solid rgba(127,127,127,.22);border-radius:8px;margin-top:3px;',
            'z-index:200;max-height:160px;overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,.25);}',
            '.om-suggest-item{padding:8px 12px;font-size:.85em;cursor:pointer;transition:.12s;color:var(--SmartThemeBodyColor,inherit);}',
            '.om-suggest-item:hover{background:rgba(127,127,127,.15);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            /* 分类管理 */
            '.om-cat-item{display:flex;align-items:center;gap:8px;padding:9px 12px;',
            'background:rgba(127,127,127,.06);border-radius:9px;',
            'border:1px solid rgba(127,127,127,.1);transition:all .15s;margin-bottom:7px;}',
            '.om-cat-item:hover{background:rgba(127,127,127,.11);}',
            '.om-cat-name{flex:1;font-size:.88em;}',
            '.om-cat-count{font-size:.74em;opacity:.45;}',
            '.om-cat-add-row{display:flex;gap:8px;}',
            '.om-cat-add-row input{flex:1;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:8px 11px;font-size:.88em;font-family:inherit;box-sizing:border-box;}',
            '.om-cat-add-row input:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            /* 预设 */
            '.om-preset-item{display:flex;align-items:center;gap:8px;padding:10px 14px;',
            'background:rgba(127,127,127,.06);border-radius:9px;border:1px solid rgba(127,127,127,.1);',
            'transition:all .15s;cursor:pointer;margin-bottom:7px;}',
            '.om-preset-item:hover{background:rgba(127,127,127,.12);border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-preset-name{flex:1;font-size:.9em;font-weight:600;}',
            '.om-preset-count{font-size:.74em;opacity:.5;white-space:nowrap;}',
            '.om-preset-item.current{border-color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(124,109,175,.08);}',
            /* 通用小按钮 */
            '.om-btn-sm{padding:5px 7px;border-radius:6px;cursor:pointer;font-size:.78em;',
            'background:rgba(127,127,127,.07);border:1px solid rgba(127,127,127,.14);',
            'transition:all .15s;color:inherit;font-family:inherit;}',
            '.om-btn-sm:hover{background:rgba(127,127,127,.15);}',
            /* 导出/导入 modal */
            '.om-modal{position:absolute;inset:0;z-index:2;background:rgba(0,0,0,.45);pointer-events:auto;',
            'display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}',
            '.om-modal-box{background:var(--om-bg2,var(--SmartThemeBackgroundColor,rgba(30,30,30,1)));',
            'color:var(--om-text,var(--SmartThemeBodyColor,#eee));border-radius:16px;padding:22px 20px 26px;',
            'width:100%;max-width:400px;max-height:85vh;overflow-y:auto;',
            'display:flex;flex-direction:column;gap:10px;',
            'box-shadow:0 8px 32px rgba(0,0,0,.4);margin:auto;border:1px solid rgba(127,127,127,.15);}',
            '.om-modal-title{font-weight:700;font-size:1em;margin-bottom:4px;}',
            '.om-modal-btn{padding:10px 14px;border-radius:9px;border:1px solid rgba(127,127,127,.2);',
            'background:rgba(127,127,127,.07);color:inherit;cursor:pointer;font-size:.88em;text-align:left;',
            'font-family:inherit;transition:.15s;}',
            '.om-modal-btn:hover{background:rgba(127,127,127,.16);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-modal-cancel{padding:9px;border-radius:9px;border:none;background:none;',
            'color:inherit;cursor:pointer;font-size:.85em;opacity:.5;font-family:inherit;margin-top:4px;}',
            '.om-modal-cancel:hover{opacity:1;}',
            '.om-checkrow{display:flex;gap:8px;align-items:center;font-size:.84em;line-height:1.35;}',
            '.om-checkrow input{margin-top:2px;flex:0 0 auto;}',
            /* 全屏 lightbox */
            '.om-lightbox{position:absolute;inset:0;z-index:3;background:rgba(0,0,0,.92);pointer-events:auto;',
            'display:flex;align-items:center;justify-content:center;animation:om-popin .18s ease;}',
            '.om-lb-img{max-width:92vw;max-height:88vh;object-fit:contain;border-radius:10px;',
            'box-shadow:0 8px 40px rgba(0,0,0,.6);user-select:none;}',
            '.om-lb-close{position:absolute;top:18px;right:20px;background:rgba(255,255,255,.12);',
            'border:none;color:#fff;font-size:1.3em;width:40px;height:40px;border-radius:50%;',
            'cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;z-index:2147483647;}',
            '.om-lb-close:hover{background:rgba(255,255,255,.25);}',
            '.om-lb-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.12);',
            'border:none;color:#fff;font-size:1.2em;width:42px;height:42px;border-radius:50%;',
            'cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;z-index:2147483647;}',
            '.om-lb-nav:hover{background:rgba(255,255,255,.25);}',
            '.om-lb-prev{left:14px;} .om-lb-next{right:14px;}',
            '.om-lb-counter{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);',
            'color:rgba(255,255,255,.6);font-size:.82em;background:rgba(0,0,0,.4);',
            'padding:4px 14px;border-radius:20px;z-index:2147483647;}',
            '.om-lb-name{position:absolute;top:20px;left:50%;transform:translateX(-50%);',
            'color:#fff;font-size:.9em;font-weight:600;background:rgba(0,0,0,.4);',
            'padding:5px 16px;border-radius:20px;max-width:60vw;white-space:nowrap;',
            'overflow:hidden;text-overflow:ellipsis;z-index:2147483647;}',
        ].join('');
        document.head.appendChild(s);
    }

    // ── 弹窗状态 ──────────────────────────────────────────────
    var curCat = '__all__';
    var wbMode = false;
    
    var worldBookStyleCache = {};
    var worldBookStylesLoaded = false;
    var worldBookNameCache = [];
    var worldBookNameListLoaded = false;
    var worldBookNameListLoading = false;
    var worldBookNameListCallbacks = [];
    var worldBookClothingPattern = /(?:名称|风格|季节|场景|描述|核心风格|生成规则|定义|单品|配色|妆容搭配|可选配饰|可选鞋履|搭配技巧|搭配示例)\s*[：:]/;
    var worldBookClothingPartPattern = /^\s*(?:[-*]\s*)?(上衣|内搭|下装|裙装|外搭|外套|连衣裙|旗袍|礼服|服装|配饰|鞋袜|鞋子|袜子|假发|角色|文胸|内裤|配件|文胸与内裤一体|内裤部分|单品|可选配饰|可选鞋履|搭配示例)\s*[：:]/m;
    function getWorldBookStyles(names) {
        var all = [];
        var keys = Array.isArray(names) && names.length ? names : Object.keys(worldBookStyleCache);
        keys.forEach(function (k) { if (worldBookStyleCache[k]) all = all.concat(worldBookStyleCache[k]); });
        return all;
    }
    function getActiveWorldBookNames(ctx, d) {
        var names = [];
        function add(name) { if (name && names.indexOf(name) === -1) names.push(name); }
        try {
            if (ctx && ctx.chatMetadata && ctx.chatMetadata.world_info) {
                if (Array.isArray(ctx.chatMetadata.world_info)) ctx.chatMetadata.world_info.forEach(add);
                else add(ctx.chatMetadata.world_info);
            }
            if (typeof document !== 'undefined') {
                var allNames = ctx && ctx.getWorldInfoNames ? ctx.getWorldInfoNames() : [];
                document.querySelectorAll('#world_info option:checked').forEach(function (opt) {
                    var idx = parseInt(opt.value, 10);
                    add(allNames[idx] || opt.textContent || opt.value);
                });
            }
            if (names.length === 0 && d && Array.isArray(d.selectedWorldBookNames)) d.selectedWorldBookNames.forEach(add);
        } catch (e) {}
        return names;
    }
    function getKnownWorldBookNames(ctx) {
        var names = [];
        try { (ctx && ctx.getWorldInfoNames ? ctx.getWorldInfoNames().filter(Boolean) : []).forEach(function (name) { addUniqueName(names, name); }); }
        catch (e) {}
        worldBookNameCache.forEach(function (name) { addUniqueName(names, name); });
        return names;
    }
    function isLikelyOutfitWorldBookName(name) {
        return /uu|sfw/i.test(String(name || ''));
    }
    function addUniqueName(list, name) {
        if (name && list.indexOf(name) === -1) list.push(name);
    }
    function refreshKnownWorldBookNames(cb) {
        if (cb) worldBookNameListCallbacks.push(cb);
        if (worldBookNameListLoaded) {
            var callbacksNow = worldBookNameListCallbacks.splice(0);
            callbacksNow.forEach(function (fn) { try { fn(worldBookNameCache.slice()); } catch (e) {} });
            return;
        }
        if (worldBookNameListLoading) return;
        worldBookNameListLoading = true;
        var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        fetch('/api/worldinfo/list', {
            method: 'POST',
            headers: getSTRequestHeaders(ctx),
            body: JSON.stringify({}),
            cache: 'no-cache'
        }).then(function (r) {
            if (!r.ok) throw new Error('worldinfo/list failed: ' + r.status);
            return r.json();
        }).then(function (list) {
            var names = [];
            if (Array.isArray(list)) {
                list.forEach(function (item) {
                    if (typeof item === 'string') addUniqueName(names, item);
                    else if (item) {
                        addUniqueName(names, item.file_id || item.name);
                    }
                });
            }
            worldBookNameCache = names;
            try { console.log('[OM-WB] backend world book list:', names.filter(isLikelyOutfitWorldBookName).join(', ')); } catch (e) {}
        }).catch(function (err) {
            try { console.warn('[OM-WB] backend world book list failed:', err); } catch (e) {}
        }).finally(function () {
            worldBookNameListLoaded = true;
            worldBookNameListLoading = false;
            var callbacksDone = worldBookNameListCallbacks.splice(0);
            callbacksDone.forEach(function (fn) { try { fn(worldBookNameCache.slice()); } catch (e) {} });
        });
    }
    function getDefaultSelectedWorldBookNames(ctx, d) {
        var names = [];
        getActiveWorldBookNames(ctx, d).filter(isLikelyOutfitWorldBookName).forEach(function (name) { addUniqueName(names, name); });
        getKnownWorldBookNames(ctx).filter(isLikelyOutfitWorldBookName).forEach(function (name) { addUniqueName(names, name); });
        return names;
    }
    function getSelectedWorldBookNames(ctx, d) {
        var selected = [];
        if (d && d.worldBookSelectionInitialized === false) {
            return getDefaultSelectedWorldBookNames(ctx, d);
        }
        (d && Array.isArray(d.selectedWorldBookNames) ? d.selectedWorldBookNames : []).filter(isLikelyOutfitWorldBookName).forEach(function (name) { addUniqueName(selected, name); });
        return selected;
    }
    function getVisibleWorldBookNames(ctx, d) {
        var names = [];
        (d && Array.isArray(d.selectedWorldBookNames) ? d.selectedWorldBookNames : []).filter(isLikelyOutfitWorldBookName).forEach(function (name) { addUniqueName(names, name); });
        getActiveWorldBookNames(ctx, d).filter(isLikelyOutfitWorldBookName).forEach(function (name) { addUniqueName(names, name); });
        getKnownWorldBookNames(ctx).filter(isLikelyOutfitWorldBookName).forEach(function (name) { addUniqueName(names, name); });
        return names;
    }
    function createWorldBookOutfit(ws, idPrefix, idx) {
        var mw = materializeWorldBookStyle(ws);
        var scenes = getWorldBookStyleSceneKeys(ws) || [];
        return { id: (idPrefix || 'wb_dyn') + '_' + idx, name: mw.name, category: '世界书', type: 'outfit', style: mw.style || mw.name || '', season: mw.season || '', sceneTag: scenes.join(','), description: mw.desc, imageData: null, isVirtual: true, worldBookStyle: ws, source: mw.source || ws.source || '' };
    }
    function getWorldBookStyleSceneKeys(ws) {
        var name = String((ws && (ws.name || ws.style)) || '').replace(/[💫🚫]/g, '').trim();
        var map = {
            '纯欲风': ['外出', '约会'],
            '甜酷风': ['外出', '约会'],
            '休闲风': ['外出'],
            '千禧y2k风': ['外出', '约会'],
            '运动风(街头潮牌版)': ['运动'],
            '日系软甜风': ['外出', '约会'],
            '日系复古风': ['外出', '约会'],
            '日系保暖': ['外出', '约会'],
            '办公室海妖风': ['外出', '约会'],
            '通勤休闲风': ['外出', '办公'],
            '学院风': ['外出'],
            '韩系日常风': ['外出', '办公', '约会'],
            '韩系女团风': ['外出', '约会'],
            '现代哥特风': ['外出', '约会'],
            '旗袍': ['外出', '约会'],
            '新中式': ['外出', '约会'],
            '御姐辣妹风': ['外出', '约会'],
            '财阀千金风': ['外出', '约会'],
            '小香风': ['外出', '约会'],
            '轻熟职场风': ['外出', '办公', '约会'],
            '多巴胺风': ['外出', '约会'],
            '欧美风': ['外出', '约会'],
            'bm风': ['外出', '约会'],
            '轻亚风': ['外出', '约会'],
            '睡衣': ['家居', '睡前'],
            '基础纯棉': ['外出', '运动'],
            '蕾丝性感': ['约会'],
            '法式三角杯': ['约会'],
            '聚拢调整': ['外出', '约会'],
            '少女可爱': ['外出', '约会'],
            '丝绸奢华': ['约会'],
            '抹胸式': ['外出', '约会']
        };
        return map[name] || null;
    }
    function worldBookStyleMatchesScene(ws, scene) {
        if (!scene) return true;
        var mappedScenes = getWorldBookStyleSceneKeys(ws);
        var text = [ws.name, ws.style, ws.scene, ws.desc, ws.raw, ws.source].join('\n');
        var titleText = [ws.name, ws.style].join('\n');
        var sceneKey = /通勤|上班|办公|职场/.test(scene) ? '办公' : scene;
        if (mappedScenes) return mappedScenes.indexOf(sceneKey) !== -1;
        if (sceneKey === '外出') return !/内衣|睡衣|睡前|家居|基础纯棉|Cos装|高定礼服|办公室/.test(text);
        if (sceneKey === '办公') return /通勤|职场|办公|上班|韩系日常/.test(text) && !/非(?:日常)?通勤|非.*办公|非.*职场/.test(text) && !/洛丽塔|Lolita|Cos装|高定礼服|旗袍|新中式|财阀|御姐|辣妹|女团|哥特|多巴胺|欧美|bm风|轻亚|纯欲|学院/.test(titleText);
        if (sceneKey === '约会' && /非.*约会|仅适用于.*(?:办公|职场|运动|睡前|家居)/.test(text)) return false;
        if (sceneKey === '家居' && /非.*家居|仅适用于.*(?:办公|职场|晚宴|漫展|茶会)/.test(text)) return false;
        if (sceneKey === '运动' && /非.*运动|仅适用于.*(?:办公|职场|晚宴|漫展|茶会)/.test(text)) return false;
        if (sceneKey === '睡前' && /非.*睡前|仅适用于.*(?:办公|职场|晚宴|漫展|茶会)/.test(text)) return false;
        var map = {
            '约会': /约会|纯欲|财阀|千金|韩系|女团|御姐|辣妹|旗袍|新中式|小香|欧美|轻熟|多巴胺|优雅|名媛|钓系|芭蕾|清透|性感|御姐|恶女|老钱|静奢|轻奢|千禧|亚比|洛丽塔|哥特|甜欲/,
            '办公': /办公|职场|通勤|上班|轻熟|韩系日常|休闲|极简高级通勤|禁欲系/,
            '家居': /家居|睡衣|休闲|基础纯棉|内衣|松弛|慵懒|舒适|棉麻|海滨奶奶/,
            '运动': /运动|机能|街头/,
            '睡前': /睡衣|睡前|内衣|基础纯棉/
        };
        return map[sceneKey] ? map[sceneKey].test(text) : false;
    }
    function refreshWorldBookStyles(names, cb) {
        if (typeof names === 'function') { cb = names; names = null; }
        try {
            var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
            names = Array.isArray(names) ? names : getActiveWorldBookNames(ctx, load());
            names = names.filter(function (name, idx) { return name && names.indexOf(name) === idx; });
            if (names.length === 0) { worldBookStylesLoaded = true; if (cb) cb(); return; }
            var loaded = 0;
            if (typeof toast !== 'undefined') toast('正在加载 ' + names.length + ' 个世界书...', false, 2000);
            names.forEach(function (name) {
                loadWorldBookByName(ctx, name).then(function (data) {
                    worldBookStyleCache[name] = parseWorldBookStyles(data, name);
                }).catch(function () {
                    worldBookStyleCache[name] = worldBookStyleCache[name] || [];
                }).finally(function () {
                    loaded++;
                    if (loaded >= names.length) {
                        worldBookStylesLoaded = true;
                        if (typeof toast !== 'undefined') toast('已加载 ' + getWorldBookStyles(names).length + ' 套世界书穿搭', false, 3000);
                        if (cb) cb();
                    }
                });
            });
        } catch (e) { worldBookStylesLoaded = true; if (cb) cb(); }
    }
    function loadWorldBookByName(ctx, name) {
        function headers() {
            try {
                if (ctx && typeof ctx.getRequestHeaders === 'function') return ctx.getRequestHeaders();
                if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getRequestHeaders === 'function') return SillyTavern.getRequestHeaders();
            } catch (e) {}
            return { 'Content-Type': 'application/json' };
        }
        return fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ name: name }),
            cache: 'no-cache'
        }).then(function (r) {
            if (!r.ok) throw new Error('worldinfo/get failed: ' + r.status);
            return r.json();
        }).catch(function (err) {
            try { console.warn('[OM-WB] direct load failed, fallback to ctx.loadWorldInfo:', name, err); } catch (e) {}
            if (ctx && typeof ctx.loadWorldInfo === 'function') return Promise.resolve(ctx.loadWorldInfo(name));
            throw err;
        });
    }
    function extractWorldBookEntries(data) {
        if (!data) return [];
        if (typeof data === 'string') {
            try { return extractWorldBookEntries(JSON.parse(data)); }
            catch (e) { return [{ content: data, comment: '' }]; }
        }
        if (Array.isArray(data)) return data;
        if (data.entries) {
            if (Array.isArray(data.entries)) return data.entries;
            if (typeof data.entries === 'object') return Object.keys(data.entries).map(function (k) { return data.entries[k]; });
        }
        if (data.content || data.comment || data.key) return [data];
        var containers = ['worldInfo', 'world_info', 'data', 'result', 'book'];
        for (var i = 0; i < containers.length; i++) {
            var v = data[containers[i]];
            if (!v || v === data) continue;
            var found = extractWorldBookEntries(v);
            if (found.length > 0) return found;
        }
        var numericKeys = Object.keys(data).filter(function (k) { return /^\d+$/.test(k) && data[k] && typeof data[k] === 'object'; });
        if (numericKeys.length > 0) return numericKeys.map(function (k) { return data[k]; });
        return [];
    }
    function splitPackedWorldBookEntry(entry) {
        if (!entry || typeof entry.content !== 'string') return [entry];
        var content = entry.content;
        var blocks = [];
        var re = /<([^\/<>\n]{1,80})>([\s\S]*?)<\/\1>/g;
        var m;
        while ((m = re.exec(content))) {
            var block = m[0];
            if (!worldBookClothingPattern.test(block) && block.indexOf('睡衣') === -1) continue;
            blocks.push({
                comment: m[1].replace(/穿搭刻画|穿搭指导|内衣刻画|睡衣刻画/g, '').trim(),
                key: entry.key,
                content: block,
                disable: entry.disable,
                enabled: entry.enabled
            });
        }
        return blocks.length > 1 ? blocks : [entry];
    }
    function parseWorldBookStyles(data, sourceName) {
        var entries = [];
        extractWorldBookEntries(data).forEach(function (entry) {
            splitPackedWorldBookEntry(entry).forEach(function (one) { entries.push(one); });
        });
        var parsed = entries.map(function (entry) {
            if (!entry || entry.disable === true || entry.enabled === false) return null;
            var comment = entry.comment || '';
            var key = Array.isArray(entry.key) ? entry.key.join(' / ') : (entry.key || '');
            var full = entry.content || comment || key || '';
            if ((full + '\n' + comment + '\n' + key).length < 8) return null;
            var haystack = full + '\n' + comment + '\n' + key;
            if (isWorldBookMetaEntry(haystack)) return null;
            if (!worldBookClothingPattern.test(haystack) && haystack.indexOf('睡衣') === -1) return null;
            if (!worldBookClothingPartPattern.test(full) && haystack.indexOf('睡衣') === -1) return null;
            return parseWorldBookEntry(full, comment, key, sourceName);
        }).filter(Boolean);
        try { console.log('[OM-WB] parsed', sourceName, 'entries:', entries.length, 'outfits:', parsed.length); } catch (e) {}
        return parsed;
    }
    function isWorldBookMetaEntry(text) {
        var firstLine = (text || '').split('\n').filter(function (l) { return l.trim(); })[0] || '';
        if (/更新必看|不要开|省tk|省token/i.test(text || '')) return true;
        if (/🚫/.test(text || '')) return true;
        if (/^<随机(?:穿搭|内衣|服饰|服装)/.test(firstLine)) return true;
        if (/^随机(?:穿搭|内衣)/.test(firstLine)) return true;
        return false;
    }
    function parseWorldBookEntry(full, comment, key, sourceName) {
        var result = { name: comment || key || '未命名', style: '', season: '', scene: '世界书', desc: full, raw: full, source: sourceName };
        function extract(label) {
            var labels = ['名称', '分类', '风格', '季节', '场景', '描述', '定义', '单品', '配色', '妆容搭配', '可选配饰', '可选鞋履', '搭配技巧', '搭配示例'];
            var stops = labels.filter(function (k) { return k !== label; }).map(function (k) { return '(?:^|\\n)\\s*(?:[-*]\\s*)?' + k + '\\s*[：:]'; }).join('|');
            var m = full.match(new RegExp('(?:^|\\n)\\s*(?:[-*]\\s*)?' + label + '\\s*[：:]\\s*([\\s\\S]*?)(?=' + stops + '|$)', 'm'));
            return m ? m[1].trim() : '';
        }
        result.name = extract('名称') || result.name;
        result.style = extract('风格') || result.style;
        result.season = extract('季节') || result.season;
        result.scene = extract('场景') || result.scene;
        result.desc = extract('描述') || result.desc;
        if (!result.name) result.name = full.split('\n').filter(function (l) { return l.trim(); })[0] || '未命名';
        if (!result.style) result.style = result.name;
        if (!result.desc || result.desc === full) result.desc = full;
        return result;
    }
    function materializeWorldBookStyle(ws) {
        var copy = {};
        for (var k in ws) copy[k] = ws[k];
        copy.desc = generateWorldBookConcreteOutfit(ws.raw || ws.desc || '', ws.name || ws.style || '世界书穿搭') || ws.desc || '';
        return copy;
    }
    function generateWorldBookConcreteOutfit(text, styleName) {
        var buckets = {};
        String(text || '').split('\n').forEach(function (line) {
            var m = line.match(/^\s*(?:[-*]\s*)?(上衣|内搭|下装|裙装|外搭|外套|连衣裙|旗袍|礼服|服装|配饰|鞋袜|鞋子|袜子|假发|角色|文胸|内裤|配件|文胸与内裤一体|内裤部分)\s*[：:]\s*(.+?)\s*$/);
            if (!m) return;
            var label = m[1], value = m[2].replace(/\s+/g, ' ').trim();
            if (!value || /仅供|参考|禁止|不得|生成规则/.test(value)) return;
            if (!buckets[label]) buckets[label] = [];
            if (buckets[label].indexOf(value) === -1) buckets[label].push(value);
        });
        function pick(label) {
            var arr = buckets[label] || [];
            return arr.length ? arr[Math.floor(Math.random() * arr.length)] : '';
        }
        function pickAny(labels) {
            for (var i = 0; i < labels.length; i++) {
                var v = pick(labels[i]);
                if (v) return { label: labels[i], value: v };
            }
            return null;
        }
        var lines = [];
        var dress = pickAny(['裙装', '连衣裙', '旗袍', '礼服', '服装']);
        var bra = pickAny(['文胸与内裤一体', '文胸']);
        var panty = pickAny(['内裤', '内裤部分']);
        if (bra || panty) {
            if (bra) lines.push(bra.label + '：' + bra.value);
            if (panty) lines.push(panty.label + '：' + panty.value);
            var lingerieExtra = pickAny(['配件', '配饰', '鞋袜']);
            if (lingerieExtra) lines.push(lingerieExtra.label + '：' + lingerieExtra.value);
            return lines.length > 0 ? lines.join('\n') : '';
        }
        if (dress) lines.push(dress.label + '：' + dress.value);
        else {
            var top = pickAny(['上衣', '内搭']);
            var bottom = pick('下装');
            if (top) lines.push(top.label + '：' + top.value);
            if (bottom) lines.push('下装：' + bottom);
        }
        var outer = pickAny(['外搭', '外套']);
        var accessories = pick('配饰');
        var shoes = pickAny(['鞋袜', '鞋子', '袜子']);
        var wig = pick('假发');
        var role = pick('角色');
        if (outer) lines.push(outer.label + '：' + outer.value);
        if (role) lines.push('角色：' + role);
        if (wig) lines.push('假发：' + wig);
        if (accessories) lines.push('配饰：' + accessories);
        if (shoes) lines.push(shoes.label + '：' + shoes.value);
        if (lines.length === 0) {
            var examples = [];
            var inExamples = false;
            String(text || '').split('\n').forEach(function (l) {
                var t = l.trim();
                if (/^搭配示例\s*[：:]/.test(t)) { inExamples = true; return; }
                if (inExamples && /^<\/.+>$/.test(t)) inExamples = false;
                if (inExamples) {
                    t = t.replace(/^\s*(?:[-*]\s*)?/, '').trim();
                    if (t && t.indexOf('+') !== -1) examples.push(t);
                }
            });
            if (examples.length > 0) return '搭配：' + examples[Math.floor(Math.random() * examples.length)].replace(/\+/g, '、');
        }
        if (lines.length === 0 && /睡衣/i.test(styleName)) {
            var parts = [];
            String(text || '').split('\n').forEach(function (l) {
                var t = l.replace(/^\s*(?:[-*]\s*)(?:\d+\.\s*)?/, '').trim();
                if (t.length > 20 && !/不可以|例子|仅供参考|指导|刻画|禁止/i.test(t)) {
                    parts.push(t);
                }
            });
            if (parts.length > 0) return parts[Math.floor(Math.random() * parts.length)];
        }
        return lines.length > 0 ? lines.join('\n') : '';
    }
    var curType = '__all__';
    var batchMode = false;
    var batchSelected = [];
    var searchQuery = '';
    var searchOpen = false;
    var detailPanelOpen = false;

    function showPopupSizeBadge(ov, rect) {
        if (!ov || !rect) return;
        var badge = ov.querySelector('.om-resize-size');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'om-resize-size';
            ov.appendChild(badge);
        }
        badge.textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height);
        badge.style.display = 'block';
        clearTimeout(showPopupSizeBadge._timer);
        showPopupSizeBadge._timer = setTimeout(function () {
            if (badge && badge.parentNode) badge.style.display = 'none';
        }, 700);
    }

    function setupPopupResize(ov) {
        if (!ov) return;
        if (popupResizeHandler) window.removeEventListener('resize', popupResizeHandler);
        popupResizeHandler = function () {
            var rect = getPopupRect();
            applyPopupRect(ov, rect);
            if (isDesktopPopupLayout()) saveUILayout({ popup: rect });
        };
        window.addEventListener('resize', popupResizeHandler);

        ov.querySelectorAll('.om-resize-handle').forEach(function (handle) {
            handle.addEventListener('pointerdown', function (e) {
                if (!isDesktopPopupLayout()) return;
                e.preventDefault();
                e.stopPropagation();
                var dir = handle.getAttribute('data-dir') || 'se';
                var start = ov.getBoundingClientRect();
                var startX = e.clientX;
                var startY = e.clientY;
                var currentRect = clampPopupRect({
                    left: start.left,
                    top: start.top,
                    width: start.width,
                    height: start.height
                });

                function onMove(ev) {
                    ev.preventDefault();
                    var dx = ev.clientX - startX;
                    var dy = ev.clientY - startY;
                    var w = start.width;
                    var h = start.height;
                    var left = start.left;
                    var top = start.top;

                    if (dir.indexOf('e') !== -1) w = start.width + dx;
                    if (dir.indexOf('s') !== -1) h = start.height + dy;
                    if (dir.indexOf('w') !== -1) w = start.width - dx;
                    if (dir.indexOf('n') !== -1) h = start.height - dy;

                    var vp = getViewportSize();
                    w = clampNum(w, POPUP_MIN_W, vp.w - POPUP_MARGIN * 2);
                    h = clampNum(h, POPUP_MIN_H, vp.h - POPUP_MARGIN * 2);
                    if (dir.indexOf('w') !== -1) left = start.right - w;
                    if (dir.indexOf('n') !== -1) top = start.bottom - h;

                    currentRect = clampPopupRect({ left: left, top: top, width: w, height: h });
                    applyPopupRect(ov, currentRect);
                    showPopupSizeBadge(ov, currentRect);
                }

                function onUp() {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    document.removeEventListener('pointercancel', onUp);
                    saveUILayout({ popup: currentRect });
                }

                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
                document.addEventListener('pointercancel', onUp);
            });
        });
    }

    function setupPopupDrag(ov) {
        if (!ov) return;
        var head = ov.querySelector('.om-head');
        if (!head) return;
        head.addEventListener('pointerdown', function (e) {
            if (!isDesktopPopupLayout()) return;
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target && e.target.closest && e.target.closest('button,input,select,textarea,.om-head-actions')) return;
            e.preventDefault();
            var start = ov.getBoundingClientRect();
            var startX = e.clientX;
            var startY = e.clientY;
            var currentRect = clampPopupRect({
                left: start.left,
                top: start.top,
                width: start.width,
                height: start.height
            });

            function onMove(ev) {
                ev.preventDefault();
                currentRect = clampPopupRect({
                    left: start.left + ev.clientX - startX,
                    top: start.top + ev.clientY - startY,
                    width: start.width,
                    height: start.height
                });
                applyPopupRect(ov, currentRect);
            }

            function onUp() {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
                saveUILayout({ popup: currentRect });
            }

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
    }

    // ── 打开全屏主界面 ────────────────────────────────────────
    function openPopup() {
        if (document.querySelector('.om-overlay')) return;
        // 防止悬浮球点击事件穿透到面板下方的元素
        var shield = document.createElement('div');
        shield.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;');
        shield.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
        shield.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
        document.body.appendChild(shield);
        setTimeout(function () { if (shield.parentNode) shield.parentNode.removeChild(shield); }, 400);

        injectStyles();
        batchMode = false; batchSelected = []; searchQuery = ''; searchOpen = false; detailPanelOpen = false;

        var ov = document.createElement('div');
        ov.className = 'om-overlay ' + (darkMode ? 'om-dark' : 'om-light');
        applyPopupRect(ov, getPopupRect());

        ov.innerHTML =
            '<div class="om-box">' +
            // 顶栏
            '<div class="om-head">' +
            '<div class="om-head-title"><i class="fa-solid fa-shirt"></i>' + SCRIPT_NAME + '</div>' +
            '<div class="om-head-actions">' +
            '<button class="om-icon-btn" id="om-search-toggle" title="搜索"><i class="fa-solid fa-magnifying-glass"></i></button>' +
            '<button class="om-theme-btn" id="om-theme-toggle"><i class="fa-solid fa-circle-half-stroke"></i></button>' +
            '<button class="om-icon-btn" id="om-x" title="关闭"><i class="fa-solid fa-xmark"></i></button>' +
            '</div></div>' +
            // 搜索栏（默认隐藏）
            '<div class="om-search-bar" id="om-search-bar">' +
            '<div class="om-search-wrap"><i class="fa-solid fa-magnifying-glass"></i>' +
            '<input class="om-search-inp" id="om-search-inp" type="text" placeholder="搜索名称或标签…" autocomplete="off" /></div>' +
            '<button class="om-search-clear" id="om-search-clear" title="关闭搜索"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>' +
            // 视角切换栏（User / Char）
            '<div class="om-viewbar" id="om-viewbar"></div>' +
            // 分类栏
            '<div class="om-catbar" id="om-catbar"></div>' +
            // 场景快捷栏
            '<div class="om-quick-scenes" id="om-quick-scenes"></div>' +
            // 网格区
            '<div class="om-grid-area" id="om-grid-area"></div>' +
            // 底栏
            '<div class="om-bottombar" id="om-bottombar" style="position:relative;">' +
            '<div class="om-bottom-status" id="om-bottom-status"></div>' +
            '<button class="om-batch-toggle-btn" id="om-wardrobe-random">衣柜随机</button>' +
            '<button class="om-batch-toggle-btn" id="om-batch-toggle">多选</button>' +
            '<button class="om-bottom-btn" id="om-bottom-presets" title="预设"><i class="fa-solid fa-bookmark"></i></button>' +
            '<button class="om-bottom-btn" id="om-bottom-roll" title="随机搭配"><i class="fa-solid fa-dice"></i></button>' +
            '<button class="om-bottom-btn" id="om-bottom-settings" title="设置"><i class="fa-solid fa-sliders"></i></button>' +
            '</div>' +
            '</div>' +
            '<div id="om-popup-slot" style="position:absolute;inset:0;z-index:999;pointer-events:none;"></div>' +
            '<div class="om-resize-handle om-resize-nw" data-dir="nw" title="拖拽调整大小"></div>' +
            '<div class="om-resize-handle om-resize-ne" data-dir="ne" title="拖拽调整大小"></div>' +
            '<div class="om-resize-handle om-resize-sw" data-dir="sw" title="拖拽调整大小"></div>' +
            '<div class="om-resize-handle om-resize-se" data-dir="se" title="拖拽调整大小"></div>';

        document.body.appendChild(ov);
        setupPopupResize(ov);
        setupPopupDrag(ov);
        renderQuickScenes(load());

        // 绑定顶栏
        ov.querySelector('#om-x').addEventListener('click', closePopup);
        ov.querySelector('#om-theme-toggle').addEventListener('click', function () {
            darkMode = !darkMode;
            var overlay = document.querySelector('.om-overlay');
            if (overlay) {
                overlay.classList.toggle('om-dark', darkMode);
                overlay.classList.toggle('om-light', !darkMode);
            }
            var btn = ov.querySelector('#om-theme-toggle');
            if (btn) btn.innerHTML = darkMode
                ? '<i class="fa-solid fa-circle-half-stroke"></i>'
                : '<i class="fa-regular fa-sun"></i>';
        });
        ov.querySelector('#om-search-toggle').addEventListener('click', function () {
            searchOpen = !searchOpen;
            var bar = document.getElementById('om-search-bar');
            bar.classList.toggle('open', searchOpen);
            if (searchOpen) { setTimeout(function () { var i = document.getElementById('om-search-inp'); if (i) i.focus(); }, 50); }
            else { searchQuery = ''; renderGrid(); }
        });
        ov.querySelector('#om-search-clear').addEventListener('click', function () {
            searchOpen = false;
            searchQuery = '';
            var bar = document.getElementById('om-search-bar');
            bar.classList.remove('open');
            renderGrid();
        });
        var sinp = ov.querySelector('#om-search-inp');
        sinp.addEventListener('input', function () { searchQuery = sinp.value; renderGrid(); });
        sinp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { searchOpen = false; searchQuery = ''; ov.querySelector('#om-search-bar').classList.remove('open'); renderGrid(); } });

        // 绑定底栏
        ov.querySelector('#om-bottom-status').addEventListener('click', function () { toggleDetailPanel(); });
        ov.querySelector('#om-wardrobe-random').addEventListener('click', function () { applyRandomWardrobeOutfit(); });
        ov.querySelector('#om-batch-toggle').addEventListener('click', function () {
            batchMode = !batchMode; batchSelected = [];
            ov.querySelector('#om-batch-toggle').classList.toggle('on', batchMode);
            renderGrid();
        });
        ov.querySelector('#om-bottom-presets').addEventListener('click', function () { openPresetsSheet(); });
        ov.querySelector('#om-bottom-settings').addEventListener('click', function () { openSettingsSheet(); });
        ov.querySelector('#om-bottom-roll').addEventListener('click', function () { openRandomRoll(); });

        renderViewbar();
        renderCatbar();
        renderGrid();
        renderBottomStatus();
        setTimeout(function () { renderQuickScenes(load()); }, 300);
        setTimeout(function () { renderQuickScenes(load()); }, 1200);
        closeFab();
    }

    function closePopup() {
        if (popupResizeHandler) {
            window.removeEventListener('resize', popupResizeHandler);
            popupResizeHandler = null;
        }
        var ov = document.querySelector('.om-overlay'); if (ov) ov.parentNode.removeChild(ov);
        injectFab();
    }

    function applyRandomWardrobeOutfit() {
        var d = load();
        var outfits = getViewOutfits(d).filter(function (o) {
            return isOutfitType(o);
        });
        if (outfits.length === 0) {
            toast('当前衣柜还没有可随机的套装', true);
            return;
        }
        var pick = outfits[Math.floor(Math.random() * outfits.length)];
        setViewActiveIds(d, [pick.id]);
        save(d);
        renderGrid();
        renderBottomStatus();
        updateBtn();
        toast('衣柜随机：' + pick.name);
        if (hasOutfitImage(pick)) openLightbox([pick], pick.id);
    }


    var charPanelExpanded = false;
    var collapsedGroups = {};

    function renderViewbar() {
        var vbar = document.getElementById('om-viewbar'); if (!vbar) return;
        var d = load();
        var isUser = d.currentView !== 'char';
        vbar.style.position = 'relative';

        var html = '<button class="om-viewtab' + (isUser ? ' on' : '') + '" data-v="user"><i class="fa-solid fa-user" style="margin-right:4px"></i>User</button>' +
            '<button class="om-viewtab' + (!isUser ? ' on' : '') + '" data-v="char"><i class="fa-solid fa-masks-theater" style="margin-right:4px"></i>角色</button>' +
            '<button class="om-viewtab" id="om-wb-toggle" title="混合世界书风格"><i class="fa-solid fa-book" style="margin-right:4px"></i>世界书</button>';

        if (!isUser) {
            html += '<input type="text" class="om-char-input" id="om-char-input" placeholder="' + (d.currentChar ? esc(d.currentChar) : '搜索角色…') + '" autocomplete="off" />' +
                '<button class="om-char-add-btn" id="om-char-add" title="添加角色">+</button>';
        }

        vbar.innerHTML = html;

        vbar.querySelectorAll('.om-viewtab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                var dd = load();
                dd.currentView = tab.dataset.v;
                save(dd);
                charPanelExpanded = false;
                renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
            });
        });

        var wbBtn = vbar.querySelector('#om-wb-toggle'); if (wbBtn) { wbBtn.classList.toggle('on', wbMode); wbBtn.addEventListener('click', function() { wbMode = !wbMode; vbar.querySelector('#om-wb-toggle').classList.toggle('on', wbMode); renderGrid(); }); }

        if (!isUser) {
            var inp = vbar.querySelector('#om-char-input');
            inp.addEventListener('focus', function () {
                charPanelExpanded = true;
                renderCharDropdown(vbar, load(), '');
            });
            inp.addEventListener('input', function () {
                charPanelExpanded = true;
                renderCharDropdown(vbar, load(), this.value.trim().toLowerCase());
            });
            vbar.querySelector('#om-char-add').addEventListener('click', function () { addCharPrompt(); });
            if (charPanelExpanded) renderCharDropdown(vbar, d, '');
        }
    }

    function renderCharDropdown(vbar, d, query) {
        var old = vbar.querySelector('.om-char-dropdown');
        if (old) old.parentNode.removeChild(old);

        var favs = d.charFavorites || [];
        var groups = d.charGroups || {};
        var allNames = d.charNames || [];
        var matchedGroupKeys = {};
        if (query) { for (var gg in groups) { if (gg.toLowerCase().indexOf(query) !== -1) matchedGroupKeys[gg] = true; } }

        function visible(cn) {
            if (!query) return true;
            if (cn.toLowerCase().indexOf(query) !== -1) return true;
            for (var gg2 in matchedGroupKeys) { if ((groups[gg2] || []).indexOf(cn) !== -1) return true; }
            return false;
        }

        var inGroup = {};
        for (var gn in groups) { (groups[gn] || []).forEach(function (n) { inGroup[n] = true; }); }

        function makeRow(cn) {
            if (!visible(cn)) return '';
            var isFav = favs.indexOf(cn) !== -1;
            var isActive = d.currentChar === cn;
            var cd = d.chars && d.chars[cn] ? d.chars[cn] : { outfits: [] };
            var count = (cd.outfits || []).length;
            return '<div class="om-char-row' + (isActive ? ' active' : '') + '" data-cn="' + esc(cn) + '">' +
                '<i class="fa-' + (isFav ? 'solid' : 'regular') + ' fa-star om-char-star' + (isFav ? ' on' : '') + '" data-cn="' + esc(cn) + '"></i>' +
                '<span class="om-char-rname">' + esc(cn) + '</span>' +
                '<span class="om-char-count">' + count + '套</span>' +
                '<div class="om-char-actions">' +
                '<button class="om-char-act om-char-rename" data-cn="' + esc(cn) + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="om-char-act om-char-move-group" data-cn="' + esc(cn) + '" title="分组"><i class="fa-solid fa-folder"></i></button>' +
                '<button class="om-char-act om-char-delete" data-cn="' + esc(cn) + '" title="删除" style="color:#e57373"><i class="fa-solid fa-trash"></i></button>' +
                '</div></div>';
        }

        function makeSection(title, iconClass, names, gkey) {
            var visNames = names.filter(visible);
            if (visNames.length === 0) return '';
            var isCollapsed = collapsedGroups[gkey];
            var html = '<div class="om-char-group-hdr" data-gkey="' + esc(gkey) + '">' +
                '<i class="fa-solid fa-chevron-down om-g-arrow' + (isCollapsed ? ' collapsed' : '') + '"></i>' +
                '<i class="' + iconClass + ' om-g-icon"></i> ' + esc(title) +
                ' <span style="opacity:.4">(' + visNames.length + ')</span></div>';
            if (!isCollapsed) { visNames.forEach(function (cn) { html += makeRow(cn); }); }
            return html;
        }

        var listHtml = '';
        var favNames = allNames.filter(function (n) { return favs.indexOf(n) !== -1; });
        listHtml += makeSection('收藏', 'fa-solid fa-star', favNames, '__fav__');
        for (var gn2 in groups) {
            var gNames = (groups[gn2] || []).filter(function (n) { return allNames.indexOf(n) !== -1; });
            listHtml += makeSection(gn2, 'fa-solid fa-folder', gNames, 'g_' + gn2);
        }
        var ungrouped = allNames.filter(function (n) { return !inGroup[n] && favs.indexOf(n) === -1; });
        if (ungrouped.length > 0) {
            var ugLabel = (favNames.length > 0 || Object.keys(groups).length > 0) ? '未分组' : '全部角色';
            listHtml += makeSection(ugLabel, 'fa-regular fa-folder-open', ungrouped, '__ungrouped__');
        }
        if (allNames.length === 0) listHtml = '<div class="om-char-empty">还没有角色，点 + 添加</div>';

        var dropdown = document.createElement('div');
        dropdown.className = 'om-char-dropdown';
        dropdown.innerHTML = listHtml;
        vbar.appendChild(dropdown);

        // 分组折叠
        dropdown.querySelectorAll('.om-char-group-hdr').forEach(function (hdr) {
            hdr.addEventListener('click', function () {
                collapsedGroups[hdr.dataset.gkey] = !collapsedGroups[hdr.dataset.gkey];
                renderCharDropdown(vbar, load(), query);
            });
        });
        // 选中角色
        dropdown.querySelectorAll('.om-char-row').forEach(function (row) {
            row.addEventListener('click', function (e) {
                if (e.target.closest('.om-char-star') || e.target.closest('.om-char-actions')) return;
                var dd = load(); dd.currentChar = row.dataset.cn; save(dd);
                charPanelExpanded = false;
                renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
            });
        });
        // 收藏
        dropdown.querySelectorAll('.om-char-star').forEach(function (star) {
            star.addEventListener('click', function (e) {
                e.stopPropagation();
                var dd = load(); if (!dd.charFavorites) dd.charFavorites = [];
                var cn = star.dataset.cn; var idx = dd.charFavorites.indexOf(cn);
                if (idx !== -1) dd.charFavorites.splice(idx, 1); else dd.charFavorites.push(cn);
                save(dd); renderCharDropdown(vbar, load(), query);
            });
        });
        // 重命名
        dropdown.querySelectorAll('.om-char-rename').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation(); var cn = btn.dataset.cn;
                var nw = prompt('重命名角色「' + cn + '」：', cn);
                if (!nw || !nw.trim() || nw.trim() === cn) return; nw = nw.trim();
                var dd = load();
                if (dd.charNames.indexOf(nw) !== -1) { toast('角色「' + nw + '」已存在', true); return; }
                var idx = dd.charNames.indexOf(cn); if (idx !== -1) dd.charNames[idx] = nw;
                if (dd.chars && dd.chars[cn]) { dd.chars[nw] = dd.chars[cn]; delete dd.chars[cn]; }
                if (dd.charFavorites) { var fi = dd.charFavorites.indexOf(cn); if (fi !== -1) dd.charFavorites[fi] = nw; }
                if (dd.charGroups) { for (var g in dd.charGroups) { var gi = dd.charGroups[g].indexOf(cn); if (gi !== -1) dd.charGroups[g][gi] = nw; } }
                if (dd.currentChar === cn) dd.currentChar = nw;
                save(dd); renderViewbar(); renderCatbar(); renderGrid(); toast('已重命名为「' + nw + '」');
            });
        });
        // 分组移动
        dropdown.querySelectorAll('.om-char-move-group').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation(); var cn = btn.dataset.cn; var dd = load();
                if (!dd.charGroups) dd.charGroups = {};
                var gNamesList = Object.keys(dd.charGroups);
                if (gNamesList.length === 0) {
                    var gname = prompt('还没有分组，输入新分组名称：');
                    if (!gname || !gname.trim()) return;
                    dd.charGroups[gname.trim()] = [cn]; save(dd); renderCharDropdown(vbar, load(), query);
                    toast('已创建分组并移入'); return;
                }
                var currentGroup = '';
                for (var g in dd.charGroups) { if ((dd.charGroups[g] || []).indexOf(cn) !== -1) { currentGroup = g; break; } }
                var msg = '将「' + cn + '」移到：\n0. 不分组' + (currentGroup ? '（当前：' + currentGroup + '）' : '') + '\n';
                gNamesList.forEach(function (g, i) { msg += (i + 1) + '. ' + g + '\n'; });
                msg += (gNamesList.length + 1) + '. 新建分组';
                var choice = prompt(msg); if (choice === null) return;
                var ci = parseInt(choice);
                for (var g2 in dd.charGroups) { var ri = dd.charGroups[g2].indexOf(cn); if (ri !== -1) dd.charGroups[g2].splice(ri, 1); }
                if (ci > 0 && ci <= gNamesList.length) { dd.charGroups[gNamesList[ci - 1]].push(cn); toast('已移入「' + gNamesList[ci - 1] + '」'); }
                else if (ci === gNamesList.length + 1) { var ng = prompt('新分组名称：'); if (ng && ng.trim()) { dd.charGroups[ng.trim()] = [cn]; toast('已创建分组并移入'); } }
                else { toast('已移出分组'); }
                save(dd); renderCharDropdown(vbar, load(), query);
            });
        });
        // 删除
        dropdown.querySelectorAll('.om-char-delete').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation(); var cn = btn.dataset.cn;
                if (!confirm('删除角色「' + cn + '」及其所有穿搭？')) return;
                var dd = load();
                var removedOutfits = dd.chars && dd.chars[cn] ? (dd.chars[cn].outfits || []).slice() : [];
                if (dd.chars) delete dd.chars[cn];
                var idx = dd.charNames.indexOf(cn); if (idx !== -1) dd.charNames.splice(idx, 1);
                if (dd.charFavorites) { var fi = dd.charFavorites.indexOf(cn); if (fi !== -1) dd.charFavorites.splice(fi, 1); }
                if (dd.charGroups) { for (var g in dd.charGroups) { var gi = dd.charGroups[g].indexOf(cn); if (gi !== -1) dd.charGroups[g].splice(gi, 1); } }
                if (dd.currentChar === cn) dd.currentChar = '';
                save(dd); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus(); toast('已删除角色「' + cn + '」');
                deleteUnusedOutfitImageAssets(dd, removedOutfits, function (result) {
                    if (result.failed > 0) toast('角色已删除，但有 ' + result.failed + ' 张服务器图片清理失败', true);
                });
            });
        });
        // 点击外部关闭
        function closeOnOutside(e) {
            if (!vbar.contains(e.target)) {
                charPanelExpanded = false;
                var dd2 = vbar.querySelector('.om-char-dropdown');
                if (dd2) dd2.parentNode.removeChild(dd2);
                document.removeEventListener('click', closeOnOutside, true);
            }
        }
        setTimeout(function () { document.addEventListener('click', closeOnOutside, true); }, 50);
    }

    function addCharPrompt() {
        var name = prompt('输入角色名：');
        if (!name || !name.trim()) return; name = name.trim();
        var dd = load();
        if (!dd.charNames) dd.charNames = [];
        if (dd.charNames.indexOf(name) !== -1) { toast('角色「' + name + '」已存在', true); return; }
        dd.charNames.push(name); dd.currentChar = name; save(dd);
        charPanelExpanded = false;
        renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
        toast('✅ 已添加角色「' + name + '」');
    }

    function renderCharPanel() { /* 兼容 */ }

    function performBatchOwnerMoveCopy(action, selectedIds, targetKey, sheet) {
        var dd = load();
        var sourceKey = currentOwnerKey(dd);
        var sourceStore = getOwnerStore(dd, sourceKey);
        var targetStore = getOwnerStore(dd, targetKey);
        if (!sourceStore || !targetStore) { toast('找不到目标衣柜', true); return; }
        if (action === 'move' && sourceKey === targetKey) { toast('不能转移给当前衣柜', true); return; }

        var selectedMap = {};
        selectedIds.forEach(function (id) { selectedMap[id] = true; });
        var selectedOutfits = sourceStore.outfits.filter(function (o) { return selectedMap[o.id]; });
        if (selectedOutfits.length === 0) {
            toast('所选内容里没有可操作的已保存穿搭', true);
            return;
        }

        var sameOwnerCopy = action === 'copy' && sourceKey === targetKey;
        selectedOutfits.forEach(function (o) {
            var cloned = cloneOutfitForOwnerTransfer(o, sameOwnerCopy);
            targetStore.outfits.push(cloned);
            addMissingCategory(targetStore, cloned.category);
        });

        if (action === 'move') {
            for (var i = sourceStore.outfits.length - 1; i >= 0; i--) {
                if (selectedMap[sourceStore.outfits[i].id]) sourceStore.outfits.splice(i, 1);
            }
            for (var j = sourceStore.activeIds.length - 1; j >= 0; j--) {
                if (selectedMap[sourceStore.activeIds[j]]) sourceStore.activeIds.splice(j, 1);
            }
        }

        save(dd);
        if (sheet) closeSheet(sheet);
        var skipped = selectedIds.length - selectedOutfits.length;
        var actionText = action === 'move' ? '转移' : '复制';
        toast('已' + actionText + ' ' + selectedOutfits.length + ' 套到「' + targetStore.label + '」' + (skipped > 0 ? '，跳过 ' + skipped + ' 个临时项' : ''));
        batchSelected = [];
        renderCatbar();
        renderGrid();
        renderBottomStatus();
        updateBtn();
    }

    function openBatchTransferCopySheet(action, selectedIds) {
        var d = load();
        var sourceKey = currentOwnerKey(d);
        var sourceStore = getOwnerStore(d, sourceKey);
        var options = getWardrobeOwnerOptions(d);
        var actionText = action === 'move' ? '转移' : '复制';
        if (action === 'move') options = options.filter(function (opt) { return opt.key !== sourceKey; });
        if (options.length === 0) {
            toast('暂无可转移目标，请先创建角色衣柜', true);
            return;
        }
        var btns = options.map(function (opt) {
            return '<button class="om-btn om-btn-outline om-owner-target" data-owner="' + esc(opt.key) + '" style="width:100%;justify-content:flex-start;margin-bottom:6px">' +
                '<i class="fa-solid ' + (opt.key === 'user' ? 'fa-user' : 'fa-user-tag') + '"></i> ' + esc(opt.label) +
                '</button>';
        }).join('');
        var sheet = createSheet([
            '<div class="om-sheet-title om-settings-title">',
            '<span><i class="fa-solid ' + (action === 'move' ? 'fa-arrow-right-arrow-left' : 'fa-copy') + '"></i>' + actionText + '穿搭</span>',
            '<button class="om-sheet-close" id="om-owner-transfer-close" type="button" title="退出"><i class="fa-solid fa-xmark"></i>退出</button>',
            '</div>',
            '<div class="om-field"><label>来源</label><div class="om-storage-info">' + esc(sourceStore ? sourceStore.label : '当前衣柜') + ' · 已选 ' + selectedIds.length + ' 套</div></div>',
            '<div class="om-field"><label>选择目标衣柜</label>' + btns + '</div>',
            '<div class="om-hint">目标衣柜不会自动穿上这些衣服；' + (action === 'move' ? '来源当前穿着会清理被转移的旧衣服。' : '复制会生成新 ID，原衣柜保持不变。') + '</div>'
        ].join(''));
        sheet.querySelector('#om-owner-transfer-close').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelectorAll('.om-owner-target').forEach(function (btn) {
            btn.addEventListener('click', function () {
                performBatchOwnerMoveCopy(action, selectedIds, btn.dataset.owner, sheet);
            });
        });
    }

    // ── 分类栏渲染 ────────────────────────────────────────────
    function renderCatbar() {
        var catbar = document.getElementById('om-catbar'); if (!catbar) return;
        var d = load(); var cats = getViewCategories(d); var allOutfits = getViewOutfits(d);
        var outfitCats = {}; var itemCats = {};
        allOutfits.forEach(function (o) { var c = o.category || ''; if (isOutfitType(o)) { if (c) outfitCats[c] = true; } else { if (c) itemCats[c] = true; } });
        if (cats.length === 0) { catbar.style.display = 'none'; return; }
        catbar.style.display = '';
        var html = '<button class="om-catbtn om-typebtn"' + (curType === '__all__' ? ' on' : '') + ' data-t="__all__">全部</button>';
        html += '<button class="om-catbtn om-typebtn"' + (curType === 'outfit' ? ' on' : '') + ' data-t="outfit"><i class="fa-solid fa-shirt"></i> 套装</button>';
        html += '<button class="om-catbtn om-typebtn"' + (curType === 'item' ? ' on' : '') + ' data-t="item"><i class="fa-solid fa-box"></i> 单品</button>';
        html += '<span style="width:1px;height:20px;background:rgba(127,127,127,.2);flex-shrink:0;margin:0 2px;align-self:center"></span>';
        cats.forEach(function (c) {
            var show = true;
            if (curType === 'outfit' && !outfitCats[c]) show = false;
            if (curType === 'item' && !itemCats[c]) show = false;
            if (show) html += '<button class="om-catbtn"' + (curCat === c ? ' on' : '') + ' data-c="' + esc(c) + '">' + esc(c) + '</button>';
        });
        catbar.innerHTML = html;
        catbar.querySelectorAll('.om-typebtn').forEach(function (btn) { btn.addEventListener('click', function () { curType = btn.dataset.t; curCat = '__all__'; renderCatbar(); renderGrid(); }); });
        catbar.querySelectorAll('.om-catbtn:not(.om-typebtn)').forEach(function (btn) { btn.addEventListener('click', function () { curCat = btn.dataset.c; renderCatbar(); renderGrid(); }); });
        if (!catbar._wheelBound) {
            catbar.addEventListener('wheel', function (e) { if (Math.abs(e.deltaY) > 0) { e.preventDefault(); catbar.scrollLeft += e.deltaY; } }, { passive: false });
            var _drag = { down: false, startX: 0, scrollL: 0 };
            catbar.addEventListener('mousedown', function (e) { _drag.down = true; _drag.startX = e.pageX; _drag.scrollL = catbar.scrollLeft; catbar.style.cursor = 'grabbing'; catbar.style.userSelect = 'none'; });
            document.addEventListener('mousemove', function (e) { if (!_drag.down) return; catbar.scrollLeft = _drag.scrollL - (e.pageX - _drag.startX); });
            document.addEventListener('mouseup', function () { if (_drag.down) { _drag.down = false; catbar.style.cursor = ''; catbar.style.userSelect = ''; } });
            catbar._wheelBound = true;
        }
    }

    // ── 网格区渲染 ────────────────────────────────────────────
    function renderGrid() {
        var area = document.getElementById('om-grid-area'); if (!area) return;
        var d = load();

        // 如果是角色视角但没选角色，显示提示
        if (d.currentView === 'char' && !d.currentChar) {
            area.innerHTML = '<div class="om-empty"><i class="fa-solid fa-masks-theater"></i><span>请先选择或添加一个角色</span></div>';
            return;
        }

        // 当前视角的穿搭
        var allOutfits = getViewOutfits(d);

        // 按分类过滤
        var list = curCat === '__all__' ? allOutfits : allOutfits.filter(function (o) { return o.category === curCat; });
        if (curType !== '__all__') list = list.filter(function (o) { return curType === 'outfit' ? isOutfitType(o) : isItemType(o); });
        if (searchQuery) {
            var q = searchQuery.toLowerCase();
            list = list.filter(function (o) {
                return (o.name && o.name.toLowerCase().indexOf(q) !== -1) ||
                    (o.category && o.category.toLowerCase().indexOf(q) !== -1) ||
                    (o.sceneTag && o.sceneTag.toLowerCase().indexOf(q) !== -1) ||
                    (o.description && o.description.toLowerCase().indexOf(q) !== -1);
            });
        }
        var imgOutfits = list.filter(function (o) { return hasOutfitImage(o); });

        var html = '';

        // 批量操作栏
        if (batchMode) {
            html += '<div class="om-batch-bar">' +
                '<span class="om-batch-info">已选&nbsp;<b id="om-batch-count">' + batchSelected.length + '</b>&nbsp;套</span>' +
                '<div class="om-batch-divider" style="width:1px;height:16px;background:rgba(127,127,127,.25);flex-shrink:0;margin:0 2px;"></div>' +
                '<div class="om-batch-acts">' +
                '<button class="om-batch-btn" id="om-batch-selall">全选</button>' +
                '<button class="om-batch-btn" id="om-batch-none">取消</button>' +
                '<button class="om-batch-btn" id="om-batch-transfer"><i class="fa-solid fa-arrow-right-arrow-left"></i> 转移</button>' +
                '<button class="om-batch-btn" id="om-batch-copy"><i class="fa-solid fa-copy"></i> 复制</button>' +
                '<button class="om-batch-btn" id="om-batch-cat"><i class="fa-solid fa-folder"></i> 分类</button>' +
                '<button class="om-batch-btn" id="om-batch-tag"><i class="fa-solid fa-tag"></i> 标签</button>' +
                '<button class="om-batch-btn" id="om-batch-aidesc"><i class="fa-solid fa-wand-magic-sparkles"></i> AI描述</button>' +
                '<button class="om-batch-btn" id="om-batch-paste"><i class="fa-solid fa-paste"></i> 批量粘贴</button>' +
                '<button class="om-batch-btn" id="om-batch-parse"><i class="fa-solid fa-list-check"></i> 单品解析</button>' +
                '<button class="om-batch-btn" id="om-batch-autotag"><i class="fa-solid fa-wand-magic-sparkles"></i> 一键识别</button>' +
                '<button class="om-batch-btn danger" id="om-batch-del"><i class="fa-solid fa-trash"></i> 删除</button>' +
                '</div></div>';
        }

        html += '<div class="om-grid">';

        // 添加卡（仅非批量模式）
        if (!batchMode) {
            html += '<div class="om-add-card" id="om-addcard"><i class="fa-solid fa-plus"></i><span>添加穿搭</span></div>';
            html += '<div class="om-batch-add-card" id="om-batchaddcard"><i class="fa-solid fa-images"></i><span>批量添加</span></div>';
        }

        
        // 世界书模式：混入虚拟穿搭
        if (wbMode && curCat !== '__all__') {
            // Only mix in when viewing a specific category, not ''all''
            var wbMatching = getWorldBookStyles().filter(function(ws) {
                return ws.scene === curCat || ws.style === curCat;
            });
            wbMatching.forEach(function(ws, wi) {
                list.push({ id: 'wb_grid_' + wi, name: ws.name, category: curCat, type: 'outfit', style: ws.style, season: ws.season, sceneTag: ws.scene, description: ws.desc, imageData: null, isVirtual: true });
            });
        }
        if (list.length === 0) {
            html += '</div><div class="om-empty"><i class="fa-solid fa-shirt"></i><span>' +
                (searchQuery ? '没有匹配「' + esc(searchQuery) + '」的穿搭' : (curCat !== '__all__' ? '该分类暂无穿搭' : '还没有穿搭，点击左上角添加')) +
                '</span></div>';
        } else {
            list.forEach(function (o) {
                var on = isActive(d, o.id);
                var bsel = batchSelected.indexOf(o.id) !== -1;
                var checkBox = batchMode ? '<div class="om-card-check' + (bsel ? ' checked' : '') + '" data-id="' + o.id + '"><i class="fa-solid fa-check"></i></div>' : '';
                var badge = (on && !batchMode) ? '<div class="om-badge-on"><i class="fa-solid fa-check"></i></div>' : '';

                var imgContent = '';
                var imgSrc = resolveOutfitImage(o);
                if (imgSrc) {
                    imgContent = '<img src="' + esc(imgSrc) + '" alt="' + esc(o.name) + '" />';
                } else {
                    var descPreview = (o.description && o.description.trim()) ? o.description.trim() : '';
                    imgContent = '<div class="om-card-noimg">' +
                        '<div class="om-noimg-name">' + esc(o.name) + '</div>' +
                        (descPreview ? '<div class="om-noimg-desc">' + esc(descPreview) + '</div>' : '') +
                        '<i class="fa-regular fa-file-lines om-noimg-icon"></i>' +
                        '</div>';
                }

                var menuBtn = batchMode ? '' : '<button class="om-card-menu" data-id="' + o.id + '" title="操作"><i class="fa-solid fa-ellipsis-vertical"></i></button>';
                var tagText = (o.sceneTag && o.sceneTag.trim()) ? o.sceneTag.trim() : '';
                html += '<div class="om-card' + (on ? ' on' : '') + (bsel ? ' batch-sel' : '') + (imgSrc ? '' : ' no-img') + '" data-id="' + o.id + '">' +
                    '<div class="om-card-img">' +
                    checkBox + imgContent + badge + menuBtn +
                    '</div>' +
                    '<div class="om-card-info">' +
                    '<div class="om-card-name">' + esc(o.name) + '</div>' +
                    (tagText ? '<div class="om-card-tag">' + esc(tagText) + '</div>' : '') +
                    '</div>' +
                    '</div>';
            });
            html += '</div>';
        }

        area.innerHTML = html;

        // 添加卡点击
        var ac = area.querySelector('#om-addcard');
        if (ac) ac.addEventListener('click', function () { openEditSheet(null, curCat !== '__all__' ? curCat : ''); });
        var bac = area.querySelector('#om-batchaddcard');
        if (bac) bac.addEventListener('click', function () { openBatchAddSheet(curCat !== '__all__' ? curCat : ''); });

        // 批量操作
        if (batchMode) {
            var selall = area.querySelector('#om-batch-selall');
            var selnone = area.querySelector('#om-batch-none');
            var btagBtn = area.querySelector('#om-batch-tag');
            var bdelBtn = area.querySelector('#om-batch-del');
            var btransferBtn = area.querySelector('#om-batch-transfer');
            var bcopyBtn = area.querySelector('#om-batch-copy');

            if (selall) selall.addEventListener('click', function () { batchSelected = list.map(function (o) { return o.id; }); renderGrid(); });
            if (selnone) selnone.addEventListener('click', function () { batchSelected = []; renderGrid(); });
            if (btransferBtn) btransferBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                openBatchTransferCopySheet('move', batchSelected.slice());
            });
            if (bcopyBtn) bcopyBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                openBatchTransferCopySheet('copy', batchSelected.slice());
            });
            var bcatBtn = area.querySelector('#om-batch-cat');
            if (bcatBtn) bcatBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                var dd = load();
                var cats = getViewCategories(dd);
                if (cats.length === 0) { toast('还没有分类，请先在设置中添加', true); return; }
                var msg = '选择分类（输入序号）：\n' + cats.map(function (n, i) { return (i + 1) + '. ' + n; }).join('\n');
                var choice = prompt(msg);
                if (choice === null) return;
                var ci = parseInt(choice) - 1;
                if (ci < 0 || ci >= cats.length) { toast('无效选择', true); return; }
                var targetCat = cats[ci];
                dd.outfits.forEach(function (o) { if (batchSelected.indexOf(o.id) !== -1) o.category = targetCat; });
                save(dd); toast('✅ 已将 ' + batchSelected.length + ' 套移到「' + targetCat + '」'); batchSelected = []; renderGrid();
            });
            if (btagBtn) btagBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                var tag = prompt('为所选 ' + batchSelected.length + ' 套穿搭设置场景标签：'); if (tag === null) return; tag = tag.trim();
                var dd = load(); dd.outfits.forEach(function (o) { if (batchSelected.indexOf(o.id) !== -1) o.sceneTag = tag; });
                save(dd); toast('✅ 已设置标签：' + (tag || '（已清空）')); batchSelected = []; renderGrid();
            });
            if (bdelBtn) bdelBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                if (!confirm('确定删除已选 ' + batchSelected.length + ' 套穿搭？')) return;
                var dd = load();
                var removedOutfits = collectStoredOutfitRecords(dd).filter(function (record) {
                    return (record.source === 'user' || record.source === 'char') && batchSelected.indexOf(record.outfit.id) !== -1;
                }).map(function (record) { return record.outfit; });
                dd.outfits = dd.outfits.filter(function (o) { return batchSelected.indexOf(o.id) === -1; });
                if (dd.chars) { for (var cn in dd.chars) { dd.chars[cn].outfits = (dd.chars[cn].outfits || []).filter(function (o) { return batchSelected.indexOf(o.id) === -1; }); } }
                batchSelected.forEach(function (id) {
                    var ai = (dd.activeIds || []).indexOf(id); if (ai !== -1) dd.activeIds.splice(ai, 1);
                    if (dd.chars) { for (var cn2 in dd.chars) { var cai = (dd.chars[cn2].activeIds || []).indexOf(id); if (cai !== -1) dd.chars[cn2].activeIds.splice(cai, 1); } }
                });
                save(dd); updateBtn(); renderBottomStatus(); toast('已删除 ' + batchSelected.length + ' 套穿搭'); batchSelected = []; renderGrid();
                deleteUnusedOutfitImageAssets(dd, removedOutfits, function (result) {
                    if (result.failed > 0) toast('穿搭已删除，但有 ' + result.failed + ' 张服务器图片清理失败', true);
                });
            });

            var bpasteBtn = area.querySelector('#om-batch-paste');
            if (bpasteBtn) bpasteBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                var modal = document.createElement('div'); modal.className = 'om-modal';
                var bg = darkMode ? '#1e1e24' : '#ececef'; var fg = darkMode ? '#eee' : '#111';
                modal.innerHTML = '<div class="om-modal-box" style="max-width:600px;background:' + bg + ';color:' + fg + '"><div class="om-modal-title"><i class="fa-solid fa-paste"></i> 批量粘贴描述</div><div style="font-size:.78em;opacity:.6;margin-bottom:8px">将 AI 返回的所有描述一起粘贴到下方，按 <code>--- 第N套 ---</code> 自动分割分配给已选 ' + batchSelected.length + ' 套穿搭</div><textarea id="om-paste-area" rows="14" style="width:100%;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:10px;font-size:.85em;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea><div id="om-paste-result" style="margin-top:8px;font-size:.8em"></div><div class="om-btn-row" style="margin-top:10px"><button class="om-btn om-btn-safe" id="om-paste-go">分配并保存</button><button class="om-btn om-btn-outline" id="om-paste-copyprompt" style="font-size:.75em;padding:3px 8px;margin-right:4px"><i class="fa-solid fa-copy"></i> 复制提示词</button><button class="om-btn om-btn-outline" id="om-paste-cancel">取消</button></div></div>';
                var mp = getPopupLayer(); modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
                mp.appendChild(modal); modal.addEventListener('click', function (e) { if (e.target === modal) mp.removeChild(modal); });
                modal.querySelector('#om-paste-cancel').addEventListener('click', function () { mp.removeChild(modal); });
                modal.querySelector('#om-paste-copyprompt').addEventListener('click', function (e) { e.stopPropagation(); var prompt = '请逐一分析以下穿搭照片，对每张照片严格按以下格式返回（不要额外解释，直接输出）：\n\n--- 第1套 ---\n名称：<5-15字简短名称>\n分类：<睡衣/制服/常服/外出服>\n风格：<学院/简约/运动/甜美/通勤/休闲/街头/优雅/舒适>\n季节：<春/夏/秋/冬/全年>\n场景：<外出/家居/办公/约会/运动/睡前>\n描述：<100-200字服装描述>\n\n--- 第2套 ---\n...'; navigator.clipboard.writeText(prompt).then(function() { toast('提示词已复制！粘贴到外部AI对话框即可'); }).catch(function() { toast('复制失败，请手动复制', true); }); });
                modal.querySelector('#om-paste-go').addEventListener('click', function () {
                    var text = modal.querySelector('#om-paste-area').value.trim();
                    if (!text) { toast('请先粘贴内容', true); return; }
                    var blocks = text.split(/---\s*第\s*\d+\s*套\s*---/i).filter(function(b) { return b.trim(); });
                    if (blocks.length === 0) { blocks = text.split(/\n\s*\n\s*\n/).filter(function(b) { return b.trim(); }); }
                    if (blocks.length === 0) { blocks = [text]; }
                    var dd = load(); var updated = 0;
                    var ids = batchSelected.slice();
                    for (var i = 0; i < Math.min(blocks.length, ids.length); i++) {
                        var o = getById(dd, ids[i]); if (!o) continue;
                        var block = blocks[i].trim();
                        function findKey(kp) { var allKeys = ['名称','分类','类型','风格','季节','场景','描述']; var stopKeys = allKeys.filter(function(k){ return k !== kp; }); var stopPat = stopKeys.map(function(k){ return k + '\\s*[\\uff1a：]'; }).join('|'); var m = block.match(new RegExp(kp + '\\s*[\\uff1a：]\\s*([\\s\\S]*?)(?=' + stopPat + '|---|$)', 'i')); return m ? m[1].trim() : ''; }
                        var nm = findKey('名称'); if (nm) o.name = nm;
                        var cat = findKey('分类'); if (cat) { o.category = cat; var vcl = getViewCategories(dd); if (vcl.indexOf(cat) === -1) vcl.push(cat); }
                        var st = findKey('风格'); if (st) o.style = st;
                        var sn = findKey('季节'); if (sn) o.season = sn;
                        var sc = findKey('场景'); if (sc) o.sceneTag = sc;
                        var desc = findKey('描述'); if (desc) o.description = desc;
                        if (!nm && !cat && !st && !sn && !sc && !desc) { o.description = block; }
                        updated++;
                    }
                    save(dd); mp.removeChild(modal); renderGrid(); renderCatbar(); toast('✅ 已更新 ' + updated + ' 套');
                });
            });
            var bparseBtn2 = area.querySelector('#om-batch-parse');
            if (bparseBtn2) bparseBtn2.addEventListener('click', function () { if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; } var ddx = load(); if (!ddx.apiVision.endpoint || !ddx.apiVision.key || !ddx.apiVision.model) { toast('请先配置 API', true); return; } openBatchParseModal(batchSelected.slice()); });
            var bautotagBtn2 = area.querySelector('#om-batch-autotag');
            if (bautotagBtn2) bautotagBtn2.addEventListener('click', function () { if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; } var ddx2 = load(); if (!ddx2.apiVision.endpoint || !ddx2.apiVision.key || !ddx2.apiVision.model) { toast('请先配置 API', true); return; } openBatchAutoTagModal(batchSelected.slice()); });
            var baidescBtn = area.querySelector('#om-batch-aidesc');
            if (baidescBtn) baidescBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                var dd = load();
                if (!dd.apiVision.endpoint || !dd.apiVision.key || !dd.apiVision.model) {
                    toast('请先在设置中配置"描述生成 API"', true); return;
                }
                var hasImg = batchSelected.some(function (id) { var o = getById(dd, id); return o && hasOutfitImage(o); });
                if (!hasImg) { toast('所选穿搭中没有带图片的', true); return; }
                openBatchDescModal(batchSelected.slice());
            });

            area.querySelectorAll('.om-card').forEach(function (card) {
                card.addEventListener('click', function (e) {
                    if (e.target.closest('.om-card-check')) return;
                    var id = card.dataset.id;
                    var chk = card.querySelector('.om-card-check');
                    var idx = batchSelected.indexOf(id);
                    if (idx !== -1) batchSelected.splice(idx, 1); else batchSelected.push(id);
                    if (chk) chk.classList.toggle('checked', batchSelected.indexOf(id) !== -1);
                    card.classList.toggle('batch-sel', batchSelected.indexOf(id) !== -1);
                    var cnt = area.querySelector('#om-batch-count');
                    if (cnt) cnt.textContent = batchSelected.length;
                });
            });
            area.querySelectorAll('.om-card-check').forEach(function (chk) {
                chk.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var id = chk.dataset.id;
                    var idx = batchSelected.indexOf(id);
                    if (idx !== -1) batchSelected.splice(idx, 1); else batchSelected.push(id);
                    chk.classList.toggle('checked', batchSelected.indexOf(id) !== -1);
                    var card = chk.closest('.om-card');
                    if (card) card.classList.toggle('batch-sel', batchSelected.indexOf(id) !== -1);
                    var cnt = area.querySelector('#om-batch-count');
                    if (cnt) cnt.textContent = batchSelected.length;
                });
            });
        } else {
            // 非批量：单击 = 选择/取消，点击⋯按钮 = 操作菜单
            area.querySelectorAll('.om-card').forEach(function (card) {
                var id = card.dataset.id;

                card.addEventListener('click', function (e) {
                    if (e.target.closest('.om-card-menu') || e.target.closest('.om-badge-on')) return;
                    var dd = load();
                    var aids = getViewActiveIds(dd);
                    var idx = aids.indexOf(id);
                    if (idx !== -1) aids.splice(idx, 1); else aids.push(id);
                    setViewActiveIds(dd, aids);
                    save(dd); updateBtn(); renderBottomStatus();


                    save(dd); updateBtn(); renderBottomStatus();
                    // 更新卡片样式
                    card.classList.toggle('on', isActive(dd, id));
                    var badge = card.querySelector('.om-badge-on');
                    if (isActive(dd, id)) {
                        if (!badge) { var b = document.createElement('div'); b.className = 'om-badge-on'; b.innerHTML = '<i class="fa-solid fa-check"></i>'; card.querySelector('.om-card-img').appendChild(b); }
                    } else {
                        if (badge) badge.parentNode.removeChild(badge);
                    }
                    closeDetailPanel();
                    var n = aids.length;
                    var o = getById(dd, id);
                    if (idx !== -1) toast('已取消：' + (o ? o.name : ''));
                    else if (n === 1) toast('✅ 已选：' + (o ? o.name : ''));
                    else toast('✅ 衣柜模式，共' + n + '套');
                });
            });

            // 菜单按钮点击事件（独立绑定，stopPropagation防止触发卡片选择）
            area.querySelectorAll('.om-card-menu').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var id = btn.dataset.id;
                    var o = getById(load(), id);
                    openContextMenu(o, imgOutfits);
                });
            });
        }
    }

    // ── 底栏状态 ─────────────────────────────────────────────
    
        // ?? AI Outfit Generation ?????????????????????
                function _isLingerieStyle(ws) {
        return /内衣/.test(String((ws && ws.source) || '')) || /内衣|文胸|内裤|抹胸|蕾丝性感|法式三角杯|聚拢|丝绸奢华|基础纯棉|少女可爱/.test(String((ws && ws.name) || ''));
    }

    function _cleanStoryText(text) {
        return String(text || '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/\.[\w-]+\s*\{[\s\S]*?\}/g, '')
            .replace(/#[\w-]+\s*\{[\s\S]*?\}/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\{\{[\s\S]*?\}\}/g, '')
            .replace(/^\s*(?:text-align|font-size|font-weight|margin|letter-spacing|white-space|opacity|display|color|background|padding|border|width|height|line-height|position)\s*:[^;\n]+;?\s*$/gmi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function _getChatContext(ctx) {
        var chat = ctx && ctx.chat ? ctx.chat : [];
        var recent = chat.slice(-15);
        var lines = [];
        for (var i = 0; i < recent.length; i++) {
            var msg = recent[i];
            var role = msg && msg.is_user ? "用户" : (msg && msg.name ? msg.name : "角色");
            var text = msg && msg.mes ? _cleanStoryText(msg.mes) : '';
            if (text.length > 800) text = text.slice(0, 800) + '...';
            if (text) lines.push(role + "：" + text);
        }
        return lines.join("\n");
    }

    function _getPendingUserInput() {
        try {
            var input = document.querySelector('#send_textarea');
            return input ? _cleanStoryText(input.value) : '';
        } catch (e) {
            return '';
        }
    }

    function _cleanOutfitResult(text) {
        return String(text || '')
            .replace(/<horae[\s\S]*?(?:<\/horae>|$)/gi, '')
            .replace(/<content[\s\S]*?(?:<\/content>|$)/gi, '')
            .replace(/<details[\s\S]*?(?:<\/details>|$)/gi, '')
            .replace(/<status[\s\S]*?(?:<\/status>|$)/gi, '')
            .replace(/\n?<\s*(?:horae?|content|details|status)[\s\S]*$/i, '')
            .replace(/<[^>\n]+>\s*$/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function _getCharacterInfo(ctx) {
        try {
            var chId = ctx && ctx.this_chid;
            var chars = ctx && ctx.characters;
            if (chars && chId !== undefined && chId !== null && chars[chId]) {
                var c = chars[chId];
                return "角色名：" + (c.name || '') + "\n角色描述：" + (c.description || '').slice(0, 200);
            }
        } catch(e) {}
        return "";
    }

    function _getUserInfo(ctx) {
        var name = '';
        var desc = '';
        try {
            name = (ctx && (ctx.name1 || ctx.userName || ctx.user_name)) || '';
            if (!name && typeof name1 !== 'undefined') name = name1;
        } catch(e) {}
        try {
            if (ctx && ctx.powerUserSettings && ctx.powerUserSettings.persona_description) desc = ctx.powerUserSettings.persona_description;
            if (!desc && ctx && ctx.power_user && ctx.power_user.persona_description) desc = ctx.power_user.persona_description;
            if (!desc && typeof power_user !== 'undefined' && power_user && power_user.persona_description) desc = power_user.persona_description;
            if (!desc && ctx && ctx.persona_description) desc = ctx.persona_description;
            if (!desc && ctx && ctx.personaDescription) desc = ctx.personaDescription;
            if (!desc && typeof document !== 'undefined') {
                var ta = document.querySelector('#persona_description');
                if (ta && ta.value) desc = ta.value;
            }
        } catch(e2) {}
        var lines = [];
        lines.push('穿搭生成目标：User');
        if (name) lines.push('User名称：' + name);
        if (desc) lines.push('User人设：' + _cleanStoryText(desc).slice(0, 800));
        return lines.join('\n');
    }

                function tryGenerateAIDescription(scene, callback) {
        console.log("[OM-AI] tryGenerateAIDescription start, scene:", scene);
        var ctx = typeof SillyTavern !== "undefined" && SillyTavern.getContext ? SillyTavern.getContext() : null;
        var genFn = null;
        if (ctx && typeof ctx.generateRaw === "function") genFn = ctx.generateRaw;
        if (!genFn) { console.log("[OM-AI] generateRaw not found, fallback"); callback(null); return; }
        console.log("[OM-AI] generateRaw OK, loading world books...");

        var d = load();
        var selectedWBNames = [];
        try { selectedWBNames = getSelectedWorldBookNames(ctx, d); } catch (e) {}
        console.log("[OM-AI] selectedWBNames:", selectedWBNames.length, selectedWBNames);
        console.log("[OM-AI] cache counts:", selectedWBNames.map(function (name) { return name + "=" + ((worldBookStyleCache[name] || []).length); }).join(", "));
        var modernRefs = [];
        var lingerieRefs = [];
        if (selectedWBNames.length > 0) {
            var allStyles = getWorldBookStyles(selectedWBNames);
            modernRefs = allStyles.filter(function(ws) { return !_isLingerieStyle(ws) && worldBookStyleMatchesScene(ws, scene); });
            lingerieRefs = allStyles.filter(function(ws) { return _isLingerieStyle(ws) && worldBookStyleMatchesScene(ws, scene); });
        }
        console.log("[OM-AI] styles filtered: modern=" + modernRefs.length + ", lingerie=" + lingerieRefs.length);
        
        var styleGuide = "";
        if (modernRefs.length > 0) {
            styleGuide += "【外穿参考风格指导】\n"
            modernRefs.forEach(function(entry) {
                var raw = entry.raw || entry.desc || "";
                styleGuide += raw + "\n";
            });
        }
        if (lingerieRefs.length > 0) {
            styleGuide += "\n【内衣参考风格指导】\n"
            lingerieRefs.forEach(function(entry) {
                var raw = entry.raw || entry.desc || "";
                styleGuide += raw + "\n";
            });
        }
        if (!styleGuide) { console.log("[OM-AI] styleGuide empty, fallback"); callback(null); return; }
        console.log("[OM-AI] styleGuide built, len=" + styleGuide.length);
        var onlyLingerieRefs = modernRefs.length === 0 && lingerieRefs.length > 0;
        var onlyModernRefs = modernRefs.length > 0 && lingerieRefs.length === 0;
        
        // System prompt: rules + format + example
        var outputScopeRule = "";
        var outputExample = "";
        if (onlyLingerieRefs) {
            outputScopeRule = "- 本次提供的参考资料只包含内衣/贴身衣物指导，因此只能生成User的内衣/贴身衣物，不得生成外穿服装。\n- 禁止输出这些外穿字段：上衣、下装、裙装、连衣裙、外套、外搭、鞋袜、鞋子、袜子。\n- 输出字段优先使用：文胸、内裤、配件；如果参考资料有“一体式/抹胸式”等结构，也必须保持内衣语境。";
            outputExample = "输出例子：<基础纯棉>\n文胸：浅灰色纯棉运动背心式文胸（工字背设计，固定杯垫，亲肤透气）\n内裤：同色纯棉中腰平角内裤（腰头柔软，包裹感稳定）";
        } else if (onlyModernRefs) {
            outputScopeRule = "- 本次提供的参考资料只包含外穿搭配指导，因此只能生成User的外穿搭配，不得生成内衣。\n- 禁止输出这些内衣字段：文胸、内裤、情趣内衣、内衣套装。";
            outputExample = "输出例子：<甜酷风>\n上衣：黑色露肩印花短款T恤（露锁骨设计）\n下装：灰紫色层层蛋糕蓬蓬短裙（不规则蕾丝纱质裙摆）\n配饰：黑色猫耳发箍、骷髅元素链条choker、金属多层手链、黑色链条腋下包\n鞋袜：黑灰条纹过膝堆堆长袜、厚底黑色圆头松糕鞋";
        } else {
            outputScopeRule = "- 本次提供的参考资料同时包含外穿搭配指导和内衣/贴身衣物指导，因此需要分别生成外穿与内衣；外穿只能参考外穿指导，内衣只能参考内衣指导。\n- 不要把内衣风格写成外穿，也不要把外穿风格写成内衣。";
            outputExample = "输出例子：<甜酷风 + 基础纯棉>\n外穿：\n上衣：黑色露肩印花短款T恤（露锁骨设计）\n下装：灰紫色层层蛋糕蓬蓬短裙（不规则蕾丝纱质裙摆）\n配饰：黑色猫耳发箍、黑色链条腋下包\n鞋袜：黑灰条纹过膝堆堆长袜、厚底黑色圆头松糕鞋\n内衣：\n文胸：浅灰色纯棉运动背心式文胸（工字背设计，固定杯垫）\n内裤：同色纯棉中腰平角内裤（柔软包裹，适合日常活动）";
        }
        var sysPrompt = "你是穿搭助手，必须遵循以下规则：\n- 本次生成对象固定是 User，不是 char。\n- 要根据正文以及前文故事情节判断此时User是否需要更换服饰。\n- 根据User的性格人设，随机生成User的穿搭服饰，需遵循各个风格的穿搭指导，并符合当前人物所处的情境，季节（冬秋季时需要在原来的基础上增衣保暖，春夏季需保持清凉），职业（避免出现在工作时穿着不当的情况）和喜好，避免ooc。发挥想象即可，但只能从本次提供的参考风格类型中生成。\n- char的人设和聊天记录只作为剧情/关系/场合参考，不要给char生成穿搭。\n" + outputScopeRule + "\n- 严禁照抄例子，例子仅供穿搭参考。\n- 只输出User穿搭结果，禁止输出或续写任何 <horae>、<content>、<details>、<status> 等状态标签或剧情标签。\n输出格式：第一行只输出风格名（从上述参考风格中选一个最符合的），然后换行输出具体穿搭描述，不能抄已有的例子，不要额外说明。\n" + outputExample;
        
        // User prompt: style guide section + context section
        var userInfo = _getUserInfo(ctx);
        var charInfo = _getCharacterInfo(ctx);
        var pendingInput = _getPendingUserInput();
        var chatCtx = _getChatContext(ctx);
        var userPrompt = "=========穿搭风格指导=========\n" + styleGuide + "\n";
        userPrompt += "=========当前正文和故事情节=========\n";
        if (pendingInput) userPrompt += "当前用户输入：\n" + pendingInput + "\n";
        if (userInfo) userPrompt += userInfo + "\n";
        if (charInfo) userPrompt += "当前聊天char信息（仅作场景参考，不是生成对象）：\n" + charInfo + "\n";
        if (chatCtx) userPrompt += chatCtx + "\n";
        userPrompt += "\n场景：" + scene + "\n请根据上述规则生成User的穿搭。";
        
        console.log("[OM-AI] ===== SYSTEM PROMPT =====");
        console.log(sysPrompt);
        console.log("[OM-AI] ===== USER PROMPT =====");
        console.log(userPrompt);
        console.log("[OM-AI] calling generateRaw, prompt len=" + (sysPrompt.length + userPrompt.length));
        
        var done = false;
        var tid = setTimeout(function() {
            if (!done) { done = true; console.log("[OM-AI] TIMEOUT 30s, fallback"); callback(null); }
        }, 30000);
        
        genFn({ prompt: userPrompt, systemPrompt: sysPrompt, quietToLoud: false, responseLength: 1200 }).then(function(result) {
            if (done) return; done = true; clearTimeout(tid);
            console.log("[OM-AI] generateRaw resolved, result len=" + (result ? result.length : 0));
            if (!result || typeof result !== "string" || result.trim().length < 5) { console.log("[OM-AI] result too short, fallback"); callback(null); return; }
            var desc = _cleanOutfitResult(result);
            if (!desc || desc.length < 5) { console.log("[OM-AI] cleaned result too short, fallback"); callback(null); return; }
            if (onlyLingerieRefs && /(?:^|\n)\s*(?:[-*]\s*)?(上衣|下装|裙装|连衣裙|外套|外搭|鞋袜|鞋子|袜子)\s*[：:]/.test(desc)) {
                console.log("[OM-AI] lingerie-only result contains outerwear fields, fallback");
                callback(null);
                return;
            }
            if (onlyModernRefs && /(?:^|\n)\s*(?:[-*]\s*)?(文胸|内裤|情趣内衣|内衣套装)\s*[：:]/.test(desc)) {
                console.log("[OM-AI] outerwear-only result contains lingerie fields, fallback");
                callback(null);
                return;
            }
            var outfit = { id: genId(), name: scene + "搭配", category: "世界书", type: "outfit", description: desc, style: "", season: "", sceneTag: scene, imageData: null, createdAt: Date.now() };
            console.log("[OM-AI] success, outfit desc len=" + desc.length);
            callback([outfit]);
        }).catch(function(err) {
            if (done) return; done = true; clearTimeout(tid);
            console.log("[OM-AI] generateRaw rejected:", err);
            callback(null);
        });
    }

function renderQuickScenes(d) {
        var el = document.getElementById('om-quick-scenes');
        if (!el) return;
        el.innerHTML = '<span class="om-quick-title">场景</span><div class="om-quick-panel"><span style="font-size:.76em;opacity:.62;white-space:nowrap">加载中</span></div>';
        var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        if (!worldBookNameListLoaded) {
            refreshKnownWorldBookNames(function () { renderQuickScenes(load()); });
            return;
        }
        var selectedWBNames = [];
        try {
            selectedWBNames = getSelectedWorldBookNames(ctx, d);
        } catch (err) {
            var errPanel = el.querySelector('.om-quick-panel');
            if (errPanel) errPanel.innerHTML = '<span style="font-size:.76em;opacity:.7;white-space:nowrap">世界书读取失败</span>';
            console.warn('[OutfitManager] quick scenes failed to read world books', err);
            return;
        }
        if (d.worldBookSelectionInitialized === false && selectedWBNames.length > 0) {
            d.selectedWorldBookNames = selectedWBNames.slice();
            d.worldBookSelectionInitialized = true;
            save(d);
        }
        var missingWB = selectedWBNames.some(function (name) { return !worldBookStyleCache[name]; });
        if (missingWB && renderQuickScenes._loadingKey !== selectedWBNames.join('|')) {
            renderQuickScenes._loadingKey = selectedWBNames.join('|');
            refreshWorldBookStyles(selectedWBNames, function () {
                try {
                    console.log('[OM-WB] quick scenes world books ready:', selectedWBNames.map(function (name) {
                        return name + '=' + ((worldBookStyleCache[name] || []).length);
                    }).join(', '));
                } catch (e) {}
                renderQuickScenes(load());
            });
            return;
        }
        if (missingWB) {
            return;
        }
        function isLingerieStyle(ws) {
        return /\u5185\u8863/.test(String((ws && ws.source) || '')) || /\u5185\u8863|\u6587\u80f8|\u5185\u88e4|\u62b9\u80f8|\u857e\u4e1d\u6027\u611f|\u6cd5\u5f0f\u4e09\u89d2\u676f|\u805a\u62e2|\u4e1d\u7ef8\u5962\u534e|\u57fa\u7840\u7eaf\u68c9|\u5c11\u5973\u53ef\u7231/.test(String((ws && ws.name) || ''));
    }
        function modernMatches(scene, namesForRoll) {
            return getWorldBookStyles(namesForRoll || selectedWBNames).filter(function(ws) { return !isLingerieStyle(ws) && worldBookStyleMatchesScene(ws, scene); });
        }
        function lingerieMatches(scene, namesForRoll) {
            if (scene === '家居' || scene === '睡前') return [];
            return getWorldBookStyles(namesForRoll || selectedWBNames).filter(function(ws) { return isLingerieStyle(ws) && worldBookStyleMatchesScene(ws, scene); });
        }
        var sceneDefs = [
            { key: '外出', label: '外出' },
            { key: '约会', label: '约会' },
            { key: '办公', label: '通勤' },
            { key: '家居', label: '家居' },
            { key: '运动', label: '运动' },
            { key: '睡前', label: '睡前' }
        ];


        var panelHtml = sceneDefs.length === 0
            ? '<span style="font-size:.76em;opacity:.62;white-space:nowrap">暂无场景</span>'
            : sceneDefs.map(function(def) {
            return '<button class="om-quick-scene-btn" data-scene="' + esc(def.key) + '">' + esc(def.label) + '</button>';
        }).join('');
        el.innerHTML = '<span class="om-quick-title">场景</span><div class="om-quick-panel">' + panelHtml + '</div>';
        el.querySelectorAll('.om-quick-scene-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var scene = this.dataset.scene;
                // Create modal with loading state first
                var modal2 = document.createElement("div"); modal2.className = "om-modal";
                var bgg = typeof darkMode !== "undefined" && darkMode ? "#1e1e24" : "#ececef"; var fgg = typeof darkMode !== "undefined" && darkMode ? "#eee" : "#111";
                modal2.innerHTML = '<div class="om-modal-box" style="max-width:500px;background:' + bgg + ';color:' + fgg + '"><div class="om-modal-title" style="font-size:1.1em"><i class="fa-solid fa-shirt"></i> User · ' + esc(scene) + '</div><div id="om-roll-progress" style="padding:30px 0;text-align:center;opacity:.7"><i class="fa-solid fa-spinner fa-spin" style="margin-right:8px"></i>AI \u751f\u6210\u4e2d...</div><div class="om-btn-row" style="margin-top:12px;gap:10px" id="om-roll-actions"><button class="om-btn om-btn-outline" id="om-roll-close">\u5173\u95ed</button></div></div>';
                var mp2 = getPopupLayer(); modal2.style.cssText = "position:absolute !important;inset:0 !important;z-index:2 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;";
                mp2.appendChild(modal2);
                modal2.querySelector("#om-roll-close").addEventListener("click", function() { mp2.removeChild(modal2); });
                modal2.addEventListener("click", function(e) { if (e.target === modal2) mp2.removeChild(modal2); });
                // Helper to populate modal with outfits
                function showOutfits(sc, outfits) {
                    var bodyHtml = outfits.length === 0
                        ? '<div style="padding:20px;text-align:center;opacity:.6">\u6ca1\u6709\u53ef\u7528\u7684\u7a7f\u642d</div>'
                        : outfits.map(function (o, idx) {
                            var label = isLingerieStyle(o) ? "\u5185\u8863" : "\u5916\u7a7f";
                            return '<div style="margin-bottom:12px"><div style="font-weight:700;margin-bottom:6px">' + label + "\uff1a" + esc(o.name) + '</div><textarea class="om-roll-desc" data-idx="' + idx + '" style="width:100%;min-height:100px;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:12px;font-size:.9em;line-height:1.75;color:' + fgg + ';resize:vertical;font-family:inherit">' + esc(o.description || "") + '</textarea><div class="om-btn-row" style="margin-top:8px;justify-content:flex-start"><button class="om-btn om-btn-outline om-roll-chatu8" data-idx="' + idx + '" style="font-size:.8em;padding:6px 10px"><i class="fa-solid fa-palette"></i> 智绘姬文生图</button></div></div>';
                        }).join("");
                    var titleEl = modal2.querySelector(".om-modal-title");
                    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-shirt"></i> User · ' + esc(sc) + "\u642d\u914d\u7ed3\u679c";
                    var progEl = document.getElementById("om-roll-progress");
                    if (progEl) progEl.outerHTML = '<div style="max-height:360px;overflow-y:auto;margin-top:12px">' + bodyHtml + '</div>';
                     function syncRollDescriptions() {
                         var textareas = modal2.querySelectorAll(".om-roll-desc");
                         textareas.forEach(function(ta) {
                             var i = parseInt(ta.dataset.idx);
                             if (i >= 0 && i < outfits.length) {
                                 outfits[i].description = ta.value;
                                 var normalized = normalizeOutfitForChatu8(outfits[i], sc);
                                 outfits[i].name = normalized.name;
                                 outfits[i].style = normalized.style;
                                 outfits[i].sceneTag = normalized.sceneTag || sc;
                             }
                         });
                     }
                    modal2.querySelectorAll(".om-roll-chatu8").forEach(function(chatu8Btn) {
                        chatu8Btn.addEventListener("click", function(e) {
                            e.stopPropagation();
                             var idx = parseInt(chatu8Btn.dataset.idx);
                             if (idx < 0 || idx >= outfits.length) return;
                             syncRollDescriptions();
                             var src = normalizeOutfitForChatu8(outfits[idx], sc);
                             src.sceneTag = src.sceneTag || sc;
                             generateChatu8ImageForOutfit(src, "User");
                         });
                    });
                    // Add action buttons
                    var acts = document.getElementById("om-roll-actions");
                    if (acts) {
                        acts.innerHTML = '<button class="om-btn om-btn-safe" id="om-roll-confirm"><i class="fa-solid fa-check"></i> \u786e\u8ba4</button><button class="om-btn" id="om-roll-wardrobe" style="background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff"><i class="fa-solid fa-box"></i> \u4fdd\u5b58\u5230\u8863\u6a71</button><button class="om-btn om-btn-outline" id="om-roll-close2">\u5173\u95ed</button>';
                        modal2.querySelector("#om-roll-confirm").addEventListener("click", function() {
                            syncRollDescriptions();
                            var dd = load(); dd.activeIds = [];
                            if (dd.chars) for (var cn in dd.chars) dd.chars[cn].activeIds = [];
                            outfits.forEach(function (p) { var rid = genId(); p.id = rid; dd.virtualOutfits[rid] = p; dd.activeIds.push(rid); });
                            save(dd); renderGrid(); renderBottomStatus(); updateBtn(); toast("\u5df2\u6362\u4e0a " + outfits.length + " \u5957\uff08" + sc + "\uff09");
                            mp2.removeChild(modal2);
                        });
                        modal2.querySelector("#om-roll-wardrobe").addEventListener("click", function() {
                            syncRollDescriptions();
                            var dd3 = load();
                            outfits.forEach(function(p) {
                                var saved = { id: genId(), name: p.name, category: "\u4e16\u754c\u4e66", type: "outfit", style: p.style || "", season: p.season || "", sceneTag: p.sceneTag || "", description: p.description || "", imageData: null, createdAt: Date.now() };
                                dd3.outfits.push(saved);
                            });
                            save(dd3); renderGrid(); updateBtn(); mp2.removeChild(modal2); toast("\u5df2\u4fdd\u5b58\u5230\u8863\u6a71");
                        });
                        modal2.querySelector("#om-roll-close2").addEventListener("click", function() { mp2.removeChild(modal2); });
                    }
                }
                // Try AI generation, fallback to world book
                var clickSelectedWBNames = getSelectedWorldBookNames(ctx, load());
                var clickMissingWB = clickSelectedWBNames.some(function (name) { return !worldBookStyleCache[name]; });
                function startSceneRoll() {
                    tryGenerateAIDescription(scene, function(aiOutfits) {
                        var liveSelectedWBNames = getSelectedWorldBookNames(ctx, load());
                        var outfits = [];
                        if (aiOutfits && aiOutfits.length > 0) {
                            outfits = aiOutfits;
                        } else {
                            var modernPool = modernMatches(scene, liveSelectedWBNames);
                            var lingeriePool = lingerieMatches(scene, liveSelectedWBNames);
                            try { console.log('[OM-WB] quick scene fallback pool:', scene, liveSelectedWBNames, 'modern=' + modernPool.length, 'lingerie=' + lingeriePool.length); } catch (e) {}
                            if (modernPool.length > 0) outfits.push(createWorldBookOutfit(modernPool[Math.floor(Math.random() * modernPool.length)], "wb_qs_" + scene + "_modern", 0));
                            if (lingeriePool.length > 0) outfits.push(createWorldBookOutfit(lingeriePool[Math.floor(Math.random() * lingeriePool.length)], "wb_qs_" + scene + "_inner", 1));
                        }
                        showOutfits(scene, outfits);
                    });
                }
                if (clickMissingWB) {
                    var progressEl = modal2.querySelector("#om-roll-progress");
                    if (progressEl) progressEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:8px"></i>读取世界书中...';
                    refreshWorldBookStyles(clickSelectedWBNames, function () {
                        try { console.log('[OM-WB] quick scene click refreshed:', clickSelectedWBNames.join(', ')); } catch (e) {}
                        startSceneRoll();
                    });
                } else {
                    startSceneRoll();
                }
            });
        });
    }

        function renderBottomStatus() {
        var el = document.getElementById('om-bottom-status'); if (!el) return;
        var d = load();

        // 收集所有owner的激活穿搭
        var allActive = [];
        // User
        (d.activeIds || []).forEach(function (id) { var o = getById(d, id); if (o) allActive.push({ owner: 'User', name: o.name, id: id }); });
        // Chars
        if (d.chars) {
            for (var cn in d.chars) {
                var cd = d.chars[cn];
                (cd.activeIds || []).forEach(function (id) {
                    var o = null; for (var k = 0; k < (cd.outfits || []).length; k++) { if (cd.outfits[k].id === id) { o = cd.outfits[k]; break; } }
                    if (o) allActive.push({ owner: cn, name: o.name, id: id });
                });
            }
        }

        var dotClass, text;
        if (allActive.length === 0) { dotClass = 'gray'; text = '未选择穿搭'; }
        else {
            dotClass = 'green';
            var parts = [];
            var userCount = allActive.filter(function (a) { return a.owner === 'User'; }).length;
            if (userCount > 0) parts.push('User ' + userCount + '套');
            if (d.chars) {
                for (var cn2 in d.chars) {
                    var cnt = allActive.filter(function (a) { return a.owner === cn2; }).length;
                    if (cnt > 0) parts.push(cn2 + ' ' + cnt + '套');
                }
            }
            text = parts.join(' · ');
            if (allActive.length > 1) dotClass = 'orange';
        }

        var clearBtn = allActive.length > 0 ? '<button class="om-status-clear" id="om-status-clearall">全部取消</button>' : '';
        var activeName = allActive.length === 1 ? allActive[0].name : '';
        var statusDisplay = activeName ? '穿着：' + esc(activeName) : text;
        el.innerHTML = '<div class="om-status-dot ' + dotClass + '"></div><span class="om-status-text" title="' + esc(activeName) + '">' + esc(statusDisplay) + '</span>' + clearBtn;
        renderQuickScenes(load());

        var clr = el.querySelector('#om-status-clearall');
        if (clr) clr.addEventListener('click', function (e) {
            e.stopPropagation();
            var dd = load(); dd.activeIds = [];
            if (dd.chars) { for (var cn3 in dd.chars) { dd.chars[cn3].activeIds = []; } }
            save(dd);
            updateBtn(); renderBottomStatus(); renderGrid(); closeDetailPanel();
            toast('已取消全部选择');
        });
    }

    // ── 选择详情面板 ─────────────────────────────────────────
    function toggleDetailPanel() {
        if (detailPanelOpen) { closeDetailPanel(); return; }
        var d = load();

        // 收集所有owner的激活穿搭，按owner分组
        var groups = [];
        var userNames = [];
        (d.activeIds || []).forEach(function (id) { var o = getById(d, id); if (o) userNames.push({ id: id, name: o.name }); });
        if (userNames.length > 0) groups.push({ owner: 'User', items: userNames });
        if (d.chars) {
            for (var cn in d.chars) {
                var cd = d.chars[cn];
                var charNames = [];
                (cd.activeIds || []).forEach(function (id) {
                    for (var k = 0; k < (cd.outfits || []).length; k++) { if (cd.outfits[k].id === id) { charNames.push({ id: id, name: cd.outfits[k].name }); break; } }
                });
                if (charNames.length > 0) groups.push({ owner: cn, items: charNames });
            }
        }
        if (groups.length === 0) return;
        openDetailPanel(groups, d);
    }

    function openDetailPanel(groups, d) {
        closeDetailPanel();
        var bottombar = document.getElementById('om-bottombar'); if (!bottombar) return;
        detailPanelOpen = true;
        var panel = document.createElement('div');
        panel.id = 'om-detail-panel';
        panel.className = 'om-detail-panel';
        panel.style.cssText = 'position:absolute;bottom:100%;left:0;right:0;z-index:10;';

        var html = '<div class="om-detail-handle"></div>';
        groups.forEach(function (g) {
            html += '<div class="om-detail-title" style="margin-top:4px">' + esc(g.owner) + '</div>';
            html += '<div class="om-detail-tags">';
            g.items.forEach(function (w) {
                html += '<span class="om-detail-tag" data-id="' + w.id + '">' + esc(w.name) +
                    '<button class="om-detail-tag-x" data-id="' + w.id + '">&#x2715;</button></span>';
            });
            html += '</div>';
        });
        html += '<div class="om-btn-row" style="margin-top:12px"><button class="om-btn om-btn-outline" id="om-detail-chatu8"><i class="fa-solid fa-palette"></i> 当前穿搭生图</button></div>';
        panel.innerHTML = html;
        bottombar.appendChild(panel);
        var chatu8DetailBtn = panel.querySelector('#om-detail-chatu8');
        if (chatu8DetailBtn) chatu8DetailBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            closeDetailPanel();
            generateChatu8ImageForActive();
        });
        panel.querySelectorAll('.om-detail-tag-x').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var dd = load(); var id = btn.dataset.id;
                // 从所有owner中查找并移除
                var ai1 = (dd.activeIds || []).indexOf(id); if (ai1 !== -1) dd.activeIds.splice(ai1, 1);
                if (dd.chars) { for (var cn in dd.chars) { var cai = (dd.chars[cn].activeIds || []).indexOf(id); if (cai !== -1) dd.chars[cn].activeIds.splice(cai, 1); } }
                save(dd); updateBtn(); renderBottomStatus(); renderGrid();
                closeDetailPanel();
            });
        // 点击标签弹出可编辑框
        panel.querySelectorAll('.om-detail-tag').forEach(function (tag) {
            tag.addEventListener('click', function (e) {
                e.stopPropagation();
                if (e.target.closest('.om-detail-tag-x')) return;
                var id = tag.dataset.id;
                var dd = load(); var o = getById(dd, id); if (!o) return;
                closeDetailPanel();
                // remove any stale modals before creating new one
                var mp_check = getPopupLayer(); var existings = mp_check.querySelectorAll('.om-modal'); existings.forEach(function(el) { el.remove(); });
                var modal = document.createElement('div'); modal.className = 'om-modal';
                var bg = typeof darkMode !== 'undefined' && darkMode ? '#1e1e24' : '#ececef'; var fg = typeof darkMode !== 'undefined' && darkMode ? '#eee' : '#111';
                modal.innerHTML = '<div class="om-modal-box" style="max-width:500px;background:' + bg + ';color:' + fg + '"><div class="om-modal-title" style="font-size:1.1em"><i class="fa-solid fa-pen-to-square"></i> ' + esc('编辑：' + o.name) + '</div>' +
                    '<textarea id="om-edit-desc" style="width:100%;min-height:180px;margin-top:12px;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:12px;font-size:.9em;line-height:1.75;color:' + fg + ';resize:vertical;font-family:inherit">' + (o.description || '') + '</textarea>' +
                    '<div class="om-btn-row" style="margin-top:12px;gap:10px"><button class="om-btn om-btn-safe" id="om-edit-save"><i class="fa-solid fa-check"></i> 确认</button><button class="om-btn" id="om-edit-wardrobe" style="background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff"><i class="fa-solid fa-box"></i> 保存到衣橱</button><button class="om-btn om-btn-outline" id="om-edit-close">关闭</button></div></div>';
                var mp = getPopupLayer(); modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
                mp.appendChild(modal);
                modal.addEventListener('click', function(ev) { if (ev.target === modal) modal.remove(); });
                modal.querySelector('#om-edit-save').addEventListener('click', function(e) {                     e.stopPropagation();                     var newDesc = modal.querySelector('#om-edit-desc').value;                     var dd2 = load(); var o2 = getById(dd2, id);                     if (o2) { o2.description = newDesc; save(dd2); }                     modal.remove();                     if (o2) { renderGrid(); renderBottomStatus(); updateBtn(); }                     toast('穿搭描述已更新');                 });
                modal.querySelector('#om-edit-close').addEventListener('click', function(e) { e.stopPropagation(); modal.remove(); });
                modal.querySelector('#om-edit-wardrobe').addEventListener('click', function(e) {                     e.stopPropagation();                     var newDesc = modal.querySelector('#om-edit-desc').value;                     var dd2 = load(); var o2 = getById(dd2, id);                     if (o2) {                         var saved = { id: genId(), name: o2.name, category: '世界书', type: 'outfit', style: o2.style || '', season: o2.season || '', sceneTag: o2.sceneTag || '', description: newDesc, imageData: resolveOutfitImage(o2) || null, createdAt: Date.now() };                         dd2.outfits.push(saved);                         save(dd2); renderGrid(); updateBtn();                     }                     modal.remove(); toast('已保存到衣橱');                 });
            });
        });
        });
        // 点击底栏外关闭
        setTimeout(function () {
            document.addEventListener('click', outsideDetailClick, true);
        }, 10);
    }

    function outsideDetailClick(e) {
        var panel = document.getElementById('om-detail-panel');
        var statusEl = document.getElementById('om-bottom-status');
        if (panel && !panel.contains(e.target) && statusEl && !statusEl.contains(e.target)) {
            closeDetailPanel();
        }
    }

    function closeDetailPanel() {
        detailPanelOpen = false;
        var p = document.getElementById('om-detail-panel'); if (p && p.parentNode) p.parentNode.removeChild(p);
        document.removeEventListener('click', outsideDetailClick, true);
    }

    // ── 长按操作菜单 Bottom Sheet ─────────────────────────────
    function openContextMenu(outfit, imgOutfits) {
        if (!outfit) return;
        var d = load();
        var isOn = isActive(d, outfit.id);

        var sheet = createSheet([
            '<div class="om-ctx-outfit-name"><i class="fa-solid fa-shirt" style="margin-right:6px;opacity:.5;"></i>' + esc(outfit.name) + '</div>',
            isOn
                ? '<div class="om-ctx-item" id="om-ctx-wear"><i class="fa-solid fa-circle-xmark"></i>取消选择</div>'
                : '<div class="om-ctx-item" id="om-ctx-wear"><i class="fa-solid fa-circle-check"></i>选择穿搭</div>',
            hasOutfitImage(outfit) ? '<div class="om-ctx-item" id="om-ctx-view"><i class="fa-solid fa-expand"></i>查看大图</div>' : '',
            '<div class="om-ctx-item" id="om-ctx-chatu8"><i class="fa-solid fa-palette"></i>智绘姬生图</div>',
            '<div class="om-ctx-item" id="om-ctx-edit"><i class="fa-solid fa-pen"></i>编辑</div>',
            hasOutfitImage(outfit) ? '<div class="om-ctx-item" id="om-ctx-aidesc"><i class="fa-solid fa-wand-magic-sparkles"></i>AI 生成描述</div>' : '',
            '<div class="om-ctx-item danger" id="om-ctx-del"><i class="fa-solid fa-trash"></i>删除</div>',
        ].join(''));

        var wearEl = sheet.querySelector('#om-ctx-wear');
        if (wearEl) wearEl.addEventListener('click', function () {
            closeSheet(sheet);
            var dd = load();
            var aids = getViewActiveIds(dd);
            var idx = aids.indexOf(outfit.id);
            if (idx !== -1) aids.splice(idx, 1); else aids.push(outfit.id);
            setViewActiveIds(dd, aids);
            save(dd); updateBtn(); renderBottomStatus(); renderGrid();
            closeDetailPanel();
        });

        var viewEl = sheet.querySelector('#om-ctx-view');
        if (viewEl) viewEl.addEventListener('click', function () {
            closeSheet(sheet);
            openLightbox(imgOutfits, outfit.id);
        });

        var chatu8El = sheet.querySelector('#om-ctx-chatu8');
        if (chatu8El) chatu8El.addEventListener('click', function () {
            closeSheet(sheet);
            generateChatu8ImageForOutfit(outfit, currentOwner(load()));
        });

        var editEl = sheet.querySelector('#om-ctx-edit');
        if (editEl) editEl.addEventListener('click', function () {
            closeSheet(sheet);
            openEditSheet(outfit, outfit.category || '');
        });

        var aidescEl = sheet.querySelector('#om-ctx-aidesc');
        if (aidescEl) aidescEl.addEventListener('click', function () {
            var dd = load();
            if (!dd.apiVision.endpoint || !dd.apiVision.key || !dd.apiVision.model) {
                toast('请先在设置中配置"描述生成 API"', true); closeSheet(sheet); return;
            }
            aidescEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>生成中...';
            aidescEl.style.pointerEvents = 'none';
            generateSingleDescription(outfit, function (err, desc) {
                closeSheet(sheet);
                if (err) { toast('生成失败：' + err, true); return; }
                var dd2 = load(); var o = getById(dd2, outfit.id);
                if (o) { o.description = desc; save(dd2); }
                toast('✅ 描述已生成：' + outfit.name);
                renderGrid();
            });
        });

        var delEl = sheet.querySelector('#om-ctx-del');
        if (delEl) delEl.addEventListener('click', function () {
            closeSheet(sheet);
            if (!confirm('确定删除「' + outfit.name + '」？')) return;
            var dd = load();
            var removedHit = findPersistentOutfit(dd, outfit.id);
            var removedOutfits = removedHit ? [removedHit.outfit] : [];
            dd.outfits = dd.outfits.filter(function (o) { return o.id !== outfit.id; });
            // 也从chars中查找并删除
            if (dd.chars) { for (var cn in dd.chars) { dd.chars[cn].outfits = (dd.chars[cn].outfits || []).filter(function (o) { return o.id !== outfit.id; }); var cai = (dd.chars[cn].activeIds || []).indexOf(outfit.id); if (cai !== -1) dd.chars[cn].activeIds.splice(cai, 1); } }
            var ai = (dd.activeIds || []).indexOf(outfit.id); if (ai !== -1) dd.activeIds.splice(ai, 1);
            save(dd); updateBtn(); renderBottomStatus(); renderGrid(); toast('已删除');
            deleteUnusedOutfitImageAssets(dd, removedOutfits, function (result) {
                if (result.failed > 0) toast('穿搭已删除，但服务器图片清理失败', true);
            });
        });
    }

    // ── 编辑 Bottom Sheet ─────────────────────────────────────
    function getAllTagSuggestions(d) {
        var tags = [];
        d.outfits.forEach(function (o) { if (o.sceneTag && o.sceneTag.trim()) { var t = o.sceneTag.trim(); if (tags.indexOf(t) === -1) tags.push(t); } });
        return tags;
    }

    function batchParseItems(outfitIds, prompt, progressCb, doneCb) {
        var d = load(); var apiCfg = d.apiVision; if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { doneCb('API 未配置'); return; }
        var targets = []; outfitIds.forEach(function (id) { var o = getById(d, id); if (!o || !hasOutfitImage(o)) return; targets.push(o); });
        if (targets.length === 0) { doneCb('没有需要解析的穿搭'); return; }
        var done = 0; var total = targets.length; var errors = []; var queue = targets.slice();
        var CONCURRENCY = 2;
        function processNext() { if (queue.length === 0) return; var o = queue.shift(); callVisionAPI(apiCfg, { name: o.name, dataUrl: resolveOutfitImage(o) }, prompt, function (err, text) { done++; if (err) errors.push({ name: o.name, error: err }); else if (text) o.description = text; else errors.push({ name: o.name, error: '返回为空' }); progressCb(done, total, '已完成 ' + done + '/' + total); if (done >= total) { save(d); doneCb(errors.length > 0 ? '完成，但有 ' + errors.length + ' 个错误' : null, done, errors); } else processNext(); }); }
        progressCb(0, total, '开始（并发' + CONCURRENCY + '）'); for (var i = 0; i < Math.min(CONCURRENCY, total); i++) processNext();
    }

    function openBatchParseModal(ids) {
        var d = load(); var withImg = ids.filter(function (id) { var o = getById(d, id); return o && hasOutfitImage(o); });
        if (withImg.length === 0) { toast('所选穿搭中没有带图片的', true); return; }
        var bg = darkMode ? '#1e1e24' : '#ececef'; var fg = darkMode ? '#eee' : '#111';
        var modal = document.createElement('div'); modal.className = 'om-modal';
        modal.innerHTML = '<div class="om-modal-box" style="background:' + bg + ';color:' + fg + '"><div class="om-modal-title">AI 批量单品解析</div><div style="font-size:.82em;opacity:.7;margin-bottom:8px">共 ' + withImg.length + ' 套</div><div id="om-bp-progress" style="display:none;margin:10px 0"><div id="om-bp-prog-text" style="font-size:.82em;margin-bottom:6px"></div><div style="height:6px;background:rgba(127,127,127,.15);border-radius:3px"><div id="om-bp-prog-bar" style="height:100%;width:0%;background:var(--SmartThemeQuoteColor,#7c6daf);border-radius:3px;transition:width .3s"></div></div></div><div id="om-bp-result" style="display:none;margin:8px 0;font-size:.82em;max-height:120px;overflow-y:auto"></div><div class="om-btn-row" id="om-bp-actions"><button class="om-btn om-btn-safe" id="om-bp-start">开始</button><button class="om-btn om-btn-outline" id="om-bp-close">取消</button></div></div>';
        var mp = getPopupLayer(); modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
        mp.appendChild(modal); modal.addEventListener('click', function (e) { if (e.target === modal && !modal.dataset.running) mp.removeChild(modal); });
        modal.querySelector('#om-bp-close').addEventListener('click', function () { if (!modal.dataset.running) mp.removeChild(modal); });
        modal.querySelector('#om-bp-start').addEventListener('click', function () { modal.dataset.running = '1'; modal.querySelector('#om-bp-progress').style.display = 'block'; modal.querySelector('#om-bp-start').disabled = true;
            var prompt = d.apiVision.parsePrompt || '请逐件列出单品'; batchParseItems(ids, prompt, function (done, total, msg) { var pct = total > 0 ? Math.round(done / total * 100) : 0; modal.querySelector('#om-bp-prog-bar').style.width = pct + '%'; modal.querySelector('#om-bp-prog-text').textContent = msg; },
            function (err, doneCount, errors) { delete modal.dataset.running; modal.querySelector('#om-bp-prog-bar').style.width = '100%'; var re = modal.querySelector('#om-bp-result'); re.style.display = 'block'; var sc = (doneCount || 0) - (errors ? errors.length : 0); var errDetail = errors && errors.length > 0 ? '<div style="color:#ff8c42;margin-top:4px">' + errors.length + ' 个失败：' + errors.map(function(e){return e.name+': '+e.error;}).join('<br>') + '</div>' : ''; re.innerHTML = '<div style="color:#4caf50;font-weight:600">成功 ' + sc + ' 条</div>' + errDetail; modal.querySelector('#om-bp-actions').innerHTML = '<button class="om-btn om-btn-safe" id="om-bp-done">完成</button>'; modal.querySelector('#om-bp-done').addEventListener('click', function () { mp.removeChild(modal); renderGrid(); }); }); });
    }

    function batchAutoTagItems(outfitIds, prompt, progressCb, doneCb) {
        var d = load(); var apiCfg = d.apiVision; if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { doneCb('API 未配置'); return; }
        var targets = []; outfitIds.forEach(function (id) { var o = getById(d, id); if (!o || !hasOutfitImage(o)) return; targets.push(o); });
        if (targets.length === 0) { doneCb('没有需要识别的穿搭'); return; }
        var done = 0; var total = targets.length; var errors = []; var queue = targets.slice();
        var ITEM_DELAY = 800;
        function processNext() { if (queue.length === 0) return; var o = queue.shift(); callVisionAPI(apiCfg, { name: o.name, dataUrl: resolveOutfitImage(o) }, prompt, function (err, text) { done++; if (err) { errors.push({ name: o.name, error: err }); } else if (text) { var parsed = parseAutoTagResult(text); if (parsed.name) o.name = parsed.name; if (parsed.type) o.type = parsed.type; if (parsed.style) o.style = parsed.style; if (parsed.season) o.season = parsed.season; if (parsed.scene) o.sceneTag = parsed.scene; if (parsed.description) o.description = parsed.description; if (!parsed.name && !parsed.style && !parsed.season && !parsed.scene) { o.description = text; } } else { errors.push({ name: o.name, error: '返回为空' }); } progressCb(done, total, '已完成 ' + done + '/' + total + (errors.length > 0 ? ' (' + errors.length + '失败)' : '')); if (done >= total) { save(d); doneCb(errors.length > 0 ? '完成，但有 ' + errors.length + ' 个错误' : null, done, errors); } else { setTimeout(processNext, ITEM_DELAY); } }); }
        progressCb(0, total, '开始处理 ' + total + ' 套（遇限速自动重试）'); processNext();
    }

    function openBatchAutoTagModal(ids) {
        var d = load(); var withImg = ids.filter(function (id) { var o = getById(d, id); return o && hasOutfitImage(o); });
        if (withImg.length === 0) { toast('所选穿搭中没有带图片的', true); return; }
        var bg = darkMode ? '#1e1e24' : '#ececef'; var fg = darkMode ? '#eee' : '#111';
        var modal = document.createElement('div'); modal.className = 'om-modal';
        modal.innerHTML = '<div class="om-modal-box" style="background:' + bg + ';color:' + fg + '"><div class="om-modal-title">AI 批量一键识别</div><div style="font-size:.82em;opacity:.7;margin-bottom:8px">共 ' + withImg.length + ' 套</div><div id="om-at-progress" style="display:none;margin:10px 0"><div id="om-at-prog-text" style="font-size:.82em;margin-bottom:6px"></div><div style="height:6px;background:rgba(127,127,127,.15);border-radius:3px"><div id="om-at-prog-bar" style="height:100%;width:0%;background:var(--SmartThemeQuoteColor,#7c6daf);border-radius:3px;transition:width .3s"></div></div></div><div id="om-at-result" style="display:none;margin:8px 0;font-size:.82em;max-height:120px;overflow-y:auto"></div><div class="om-btn-row" id="om-at-actions"><button class="om-btn om-btn-safe" id="om-at-start">开始</button><button class="om-btn om-btn-outline" id="om-at-close">取消</button></div></div>';
        var mp = getPopupLayer(); modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
        mp.appendChild(modal); modal.addEventListener('click', function (e) { if (e.target === modal && !modal.dataset.running) mp.removeChild(modal); });
        modal.querySelector('#om-at-close').addEventListener('click', function () { if (!modal.dataset.running) mp.removeChild(modal); });
        modal.querySelector('#om-at-start').addEventListener('click', function () { modal.dataset.running = '1'; modal.querySelector('#om-at-progress').style.display = 'block'; modal.querySelector('#om-at-start').disabled = true;
            var prompt = d.apiVision.autoTagPrompt || '请分析'; batchAutoTagItems(ids, prompt, function (done, total, msg) { var pct = total > 0 ? Math.round(done / total * 100) : 0; modal.querySelector('#om-at-prog-bar').style.width = pct + '%'; modal.querySelector('#om-at-prog-text').textContent = msg; },
            function (err, doneCount, errors) { delete modal.dataset.running; modal.querySelector('#om-at-prog-bar').style.width = '100%'; var re = modal.querySelector('#om-at-result'); re.style.display = 'block'; var sc = (doneCount || 0) - (errors ? errors.length : 0); var errDetail = errors && errors.length > 0 ? '<div style="color:#ff8c42;margin-top:4px">' + errors.length + ' 个失败：' + errors.map(function(e){return e.name+': '+e.error;}).join('<br>') + '</div>' : ''; re.innerHTML = '<div style="color:#4caf50;font-weight:600">成功 ' + sc + ' 条</div>' + errDetail; modal.querySelector('#om-at-actions').innerHTML = '<button class="om-btn om-btn-safe" id="om-at-done">完成</button>'; modal.querySelector('#om-at-done').addEventListener('click', function () { mp.removeChild(modal); renderGrid(); }); }); });
    }

    function generateSingleParse(outfit, parsePrompt, cb) {
        var d = load(); var apiCfg = d.apiVision;
        if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { cb('API 未配置'); return; }
        var img = resolveOutfitImage(outfit);
        if (!img) { cb('没有图片'); return; }
        callVisionAPI(apiCfg, { name: outfit.name, dataUrl: img }, parsePrompt, function (err, text) { if (err) { cb(err); return; } cb(null, text); });
    }


    function openBatchAddSheet(defaultCat) {
        var d = load(); var viewCats = getViewCategories(d);
        var catOpts = '<option value="">无分类</option>' + viewCats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
        if (defaultCat) catOpts = catOpts.replace('value="' + esc(defaultCat) + '"', 'value="' + esc(defaultCat) + '" selected');
        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-images"></i>批量添加穿搭</div>',
            '<div class="om-field"><label>名称前缀</label><input type="text" id="om-ba-prefix" placeholder="如：睡衣 -> 睡衣 1、睡衣 2..." /></div>',
            '<div class="om-field"><label>类型</label><div class="om-type-radios"><label class="om-radio-label"><input type="radio" name="om-ba-type" value="outfit" checked /> 套装</label><label class="om-radio-label"><input type="radio" name="om-ba-type" value="item" /> 单品</label></div></div>',
            '<div class="om-field"><label>分类</label><div class="om-frow"><select id="om-ba-cat">' + catOpts + '</select><button class="om-btn om-btn-outline" id="om-ba-newcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
            '<div class="om-field"><label>风格</label><input type="text" id="om-ba-style" placeholder="学院 / 简约 / 运动" /></div>',
            '<div class="om-field"><label>季节</label><input type="text" id="om-ba-season" placeholder="春 / 夏 / 秋 / 冬 / 全年" /></div>',
            '<div class="om-field"><label>场景标签</label><input type="text" id="om-ba-scene" placeholder="家居 / 外出 / 睡觉" /></div>',
            '<div class="om-field"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><label style="margin:0">粘贴AI描述 <span class="om-hint">可选：按 --- 第N套 --- 分割，与照片顺序一一对应</span></label><button class="om-btn om-btn-outline" id="om-ba-copyprompt" style="font-size:.75em;padding:4px 10px;flex-shrink:0" title="复制提示词到剪贴板"><i class="fa-solid fa-copy"></i> 复制提示词</button></div><textarea id="om-ba-desctext" rows="8" placeholder="将外部AI返回的描述粘贴到这里...&#10;格式示例：&#10;--- 第1套 ---&#10;名称：粉色睡裙&#10;分类：睡衣&#10;风格：甜美&#10;季节：夏&#10;场景：睡前&#10;描述：粉色丝绸吊带睡裙...&#10;&#10;--- 第2套 ---&#10;..." style="width:100%;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:10px;font-size:.8em;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea></div>',
            '<div class="om-field"><label>选择照片</label><div class="om-imgarea" id="om-ba-dropzone" style="min-height:120px;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;padding:12px"><div class="om-imgph" id="om-ba-placeholder"><i class="fa-regular fa-images"></i><span>点击或拖拽多张照片</span></div></div><input type="file" id="om-ba-file" accept="image/*" multiple style="display:none" /></div>',
            '<div class="om-field" id="om-ba-preview-area" style="display:none"><label>已选择 <span id="om-ba-count">0</span> 张</label><div id="om-ba-preview" style="display:flex;flex-wrap:wrap;gap:6px;max-height:120px;overflow-y:auto"></div></div>',
            '<div class="om-btn-row"><button class="om-btn om-btn-safe" id="om-ba-create">创建 <span id="om-ba-btn-count">0</span> 套</button><button class="om-btn om-btn-outline" id="om-ba-cancel">取消</button></div>'
        ].join(''));
        var batchFiles = []; var batchDataUrls = [];
        function updatePreview() {
            var cnt = batchFiles.length; sheet.querySelector('#om-ba-count').textContent = cnt; sheet.querySelector('#om-ba-btn-count').textContent = cnt;
            sheet.querySelector('#om-ba-preview-area').style.display = cnt > 0 ? '' : 'none';
            sheet.querySelector('#om-ba-placeholder').style.display = cnt > 0 ? 'none' : '';
            sheet.querySelector('#om-ba-create').disabled = cnt === 0;
            sheet.querySelector('#om-ba-preview').innerHTML = batchDataUrls.map(function (url) { return '<img src="' + url + '" style="width:40px;height:40px;object-fit:cover;border-radius:4px" />'; }).join('');
        }
        function addFiles(files) { for (var i = 0; i < files.length; i++) { var f2 = files[i]; if (!f2 || f2.type.indexOf('image') !== 0) continue; batchFiles.push(f2); } var loaded = 0; var total = batchFiles.length; batchDataUrls = new Array(total); for (var j = 0; j < batchFiles.length; j++) { (function (idx) { var reader = new FileReader(); reader.onload = function (e) { compressImage(e.target.result, function (c) { batchDataUrls[idx] = c; loaded++; if (loaded >= total) updatePreview(); }); }; reader.readAsDataURL(batchFiles[idx]); })(j); } if (total === 0) updatePreview(); }
        sheet.querySelector('#om-ba-dropzone').addEventListener('click', function () { sheet.querySelector('#om-ba-file').click(); });
        sheet.querySelector('#om-ba-file').addEventListener('change', function () { if (this.files.length > 0) addFiles(this.files); });
        sheet.querySelector('#om-ba-dropzone').addEventListener('dragover', function (e) { e.preventDefault(); });
        sheet.querySelector('#om-ba-dropzone').addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files); });
        sheet.querySelector('#om-ba-create').addEventListener('click', function () {
            var prefix = sheet.querySelector('#om-ba-prefix').value.trim();
            var cat = sheet.querySelector('#om-ba-cat').value;
            var typeEl = sheet.querySelector('input[name="om-ba-type"]:checked');
            var baType = typeEl ? typeEl.value : 'outfit';
            var style = sheet.querySelector('#om-ba-style').value.trim();
            var season = sheet.querySelector('#om-ba-season').value.trim();
            var scene = sheet.querySelector('#om-ba-scene').value.trim();
            var descText = sheet.querySelector('#om-ba-desctext') ? sheet.querySelector('#om-ba-desctext').value.trim() : '';
            var descBlocks = [];
            if (descText) {
                descBlocks = descText.split(/---\s*第\s*\d+\s*套\s*---/i).filter(function(b) { return b.trim(); });
                if (descBlocks.length === 0) { descBlocks = descText.split(/\n\s*\n\s*\n/).filter(function(b) { return b.trim(); }); }
                if (descBlocks.length === 0) { descBlocks = [descText]; }
            }
            var dd = load(); var created = 0; var pendingImages = 0; var imageErrors = 0;
            function finishBatchCreate() {
                save(dd); closeSheet(sheet); renderCatbar(); renderGrid(); renderBottomStatus();
                toast('已创建 ' + created + ' 套' + (imageErrors > 0 ? '（' + imageErrors + ' 张图片缓存失败，已保留旧格式）' : ''));
            }
            batchDataUrls.forEach(function (url, i) {
                var name = prefix ? prefix + ' ' + (i + 1) : ('穿搭 ' + (i + 1));
                var desc = '', nm = name, oc = cat, ost = style, osn = season, osc = scene, otype = baType;
                if (descBlocks[i]) {
                    var block = descBlocks[i].trim();
                    function findKey(kp) { var allKeys = ['名称','分类','类型','风格','季节','场景','描述']; var stopKeys = allKeys.filter(function(k){ return k !== kp; }); var stopPat = stopKeys.map(function(k){ return k + '\\s*[\\uff1a：]'; }).join('|'); var m = block.match(new RegExp(kp + '\\s*[\\uff1a：]\\s*([\\s\\S]*?)(?=' + stopPat + '|---|$)', 'i')); return m ? m[1].trim() : ''; }
                    var pn = findKey('名称'); if (pn) nm = pn;
                    var pcat = findKey('分类'); if (pcat) oc = pcat;
                    var ptype = findKey('类型'); if (ptype && (ptype === '套装' || ptype === '单品')) otype = ptype;
                    var pst = findKey('风格'); if (pst) ost = pst;
                    var psn = findKey('季节'); if (psn) osn = psn;
                    var psc = findKey('场景'); if (psc) osc = psc;
                    var pdesc = findKey('描述'); if (pdesc) desc = pdesc;
                }
                var vcs = getViewCategories(dd); if (oc && vcs.indexOf(oc) === -1) vcs.push(oc); var o = { id: genId(), name: nm, category: oc, type: otype, style: ost, season: osn, sceneTag: osc, description: desc, createdAt: Date.now() };
                if (dd.currentView === 'char' && dd.currentChar) getCharData(dd, dd.currentChar).outfits.push(o);
                else dd.outfits.push(o);
                created++;
                pendingImages++;
                setOutfitImageFields(o, url, { owner: dd.currentView === 'char' && dd.currentChar ? dd.currentChar : 'User', name: nm }, function (err) {
                    if (err) imageErrors++;
                    pendingImages--;
                    if (pendingImages <= 0) finishBatchCreate();
                });
            });
            if (pendingImages === 0) finishBatchCreate();
        });
        sheet.querySelector('#om-ba-cancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-ba-copyprompt').addEventListener('click', function (e) { e.stopPropagation(); var prompt = '请逐一分析以下穿搭照片，对每张照片严格按以下格式返回（不要额外解释，直接输出）：\n\n--- 第1套 ---\n名称：<5-15字简短名称>\n分类：<睡衣/制服/常服/外出服>\n风格：<学院/简约/运动/甜美/通勤/休闲/街头/优雅/舒适>\n季节：<春/夏/秋/冬/全年>\n场景：<外出/家居/办公/约会/运动/睡前>\n描述：<100-200字服装描述>\n\n--- 第2套 ---\n...'; navigator.clipboard.writeText(prompt).then(function() { toast('提示词已复制！粘贴到外部AI对话框即可'); }).catch(function() { toast('复制失败，请手动复制', true); }); });
        sheet.querySelector('#om-ba-newcat').addEventListener('click', function () {
            var name = prompt('新分类名称：'); if (!name || !name.trim()) return; name = name.trim();
            var dd = load(); var vc = getViewCategories(dd); if (vc.indexOf(name) === -1) { vc.push(name); save(dd); renderCatbar(); }
            var sel = sheet.querySelector('#om-ba-cat'); var ex = false;
            for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === name) { ex = true; break; } }
            if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel.appendChild(opt); }
            sel.value = name;
        });
    }

    function openRandomRoll() {
        var d = load(); var allOutfits = getViewOutfits(d);
        var rollCtx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        if (!worldBookNameListLoaded) {
            toast('正在读取世界书列表...', false, 1500);
            refreshKnownWorldBookNames(function () { openRandomRoll(); });
            return;
        }
        var selectedWBNames = getSelectedWorldBookNames(rollCtx, d);
        if (d.worldBookSelectionInitialized === false && selectedWBNames.length > 0) {
            d.selectedWorldBookNames = selectedWBNames.slice();
            d.worldBookSelectionInitialized = true;
            save(d);
        }
        if (allOutfits.length === 0 && selectedWBNames.length === 0) { toast('还没有任何穿搭，也没有选择世界书', true); return; }
        var styles = []; var seasons = []; var scenes = [];
        allOutfits.forEach(function (o) { if (o.style && o.style.trim() && styles.indexOf(o.style.trim()) === -1) styles.push(o.style.trim()); if (o.season && o.season.trim() && seasons.indexOf(o.season.trim()) === -1) seasons.push(o.season.trim()); if (o.sceneTag && o.sceneTag.trim() && scenes.indexOf(o.sceneTag.trim()) === -1) scenes.push(o.sceneTag.trim()); });
        ['外出', '约会', '办公', '家居', '运动', '睡前'].forEach(function (s) { if (scenes.indexOf(s) === -1) scenes.push(s); });
        var sopts = styles.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        var seopts = seasons.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        var scopts = scenes.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        var sheet = createSheet([
            '<div class="om-sheet-title om-settings-title">' +
            '<span class="om-settings-title-main"><i class="fa-solid fa-dice"></i>随机搭配</span>' +
            '<button class="om-sheet-close" id="om-roll-close-sheet" type="button" title="退出随机搭配"><i class="fa-solid fa-xmark"></i>退出</button>' +
            '</div>',
            '<div class="om-field"><label style="font-weight:600;font-size:.85em;margin-bottom:4px">世界书风格</label>',
            '<div style="display:flex;flex-direction:column;gap:4px;font-size:.82em">',
            '<div id="om-roll-wb-list" style="display:flex;flex-direction:column;gap:4px;font-size:.82em"><i class="fa-solid fa-spinner fa-spin"></i> 加载世界书...</div>',
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:2px"><input type="checkbox" id="om-roll-wb-only" checked /> 仅roll世界书（不含衣柜）</label>',
            '</div></div>',
            '<div class="om-field"><label>风格</label><select id="om-roll-style"><option value="">不限</option>' + sopts + '</select></div>',
            '<div class="om-field"><label>季节</label><select id="om-roll-season"><option value="">不限</option>' + seopts + '</select></div>',
            '<div class="om-field"><label>场景</label><select id="om-roll-scene"><option value="">不限</option>' + scopts + '</select></div>',
            '<div class="om-field"><label>搭配模式</label><select id="om-roll-mode"><option value="mixed">套装优先 + 单品填充</option><option value="outfit">仅套装</option><option value="items">仅单品随机组合</option></select></div>',
            '<div class="om-field" id="om-roll-result-area" style="display:none;margin-top:12px"><div style="font-weight:600;font-size:.95em;margin-bottom:8px;color:var(--SmartThemeQuoteColor,#7c6daf)">搭配结果</div><div id="om-roll-result" style="background:rgba(127,127,127,.08);border-radius:10px;padding:14px;font-size:.85em;line-height:1.7;white-space:pre-wrap"></div><div class="om-btn-row" style="margin-top:10px"><button class="om-btn om-btn-safe" id="om-roll-apply">应用这套搭配</button></div></div>',
            '<div class="om-btn-row" style="margin-top:10px"><button class="om-btn om-btn-safe" id="om-roll-go">随机搭配！</button><button class="om-btn om-btn-outline" id="om-roll-cancel">取消</button></div>'
        ].join(''));
        var lastResult = null;
        var rollWorldBooksReady = false;
        function setSelectOptions(sel, values, placeholder) {
            if (!sel) return;
            var current = sel.value;
            var seen = {};
            var html = '<option value="">' + placeholder + '</option>';
            values.forEach(function (v) {
                v = String(v || '').trim();
                if (!v || seen[v]) return;
                seen[v] = true;
                html += '<option value="' + esc(v) + '">' + esc(v) + '</option>';
            });
            sel.innerHTML = html;
            if (current && seen[current]) sel.value = current;
        }
        function refreshRollFilterOptions(wbNamesForFilters) {
            var styleVals = [], seasonVals = [], sceneVals = [];
            function addUnique(arr, v) { v = String(v || '').trim(); if (v && arr.indexOf(v) === -1) arr.push(v); }
            allOutfits.forEach(function (o) {
                addUnique(styleVals, o.style);
                addUnique(seasonVals, o.season);
                String(o.sceneTag || '').split(/[,，/、\s]+/).forEach(function (s) { addUnique(sceneVals, s); });
            });
            getWorldBookStyles(wbNamesForFilters || []).forEach(function (ws) {
                addUnique(styleVals, ws.style || ws.name);
                addUnique(seasonVals, ws.season);
                (getWorldBookStyleSceneKeys(ws) || []).forEach(function (s) { addUnique(sceneVals, s); });
            });
            ['外出', '约会', '办公', '家居', '运动', '睡前'].forEach(function (s) { addUnique(sceneVals, s); });
            setSelectOptions(sheet.querySelector('#om-roll-style'), styleVals, '不限');
            setSelectOptions(sheet.querySelector('#om-roll-season'), seasonVals, '不限');
            setSelectOptions(sheet.querySelector('#om-roll-scene'), sceneVals, '不限');
        }
        // Populate world book checkboxes dynamically
        (function populateWBList() {
            var container = sheet.querySelector('#om-roll-wb-list');
            if (!container) return;
            try {
                var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
                var dd = load();
                var savedSelected = Array.isArray(dd.selectedWorldBookNames) ? dd.selectedWorldBookNames.filter(isLikelyOutfitWorldBookName) : [];
                var selectedDefaults = getSelectedWorldBookNames(ctx, dd);
                var wbNames = getVisibleWorldBookNames(ctx, dd);
                if (wbNames.length === 0) {
                    container.innerHTML = '<span style="opacity:.5">没有找到可用穿搭世界书，请先在酒馆中创建、启用或选择世界书。</span>';
                    return;
                }
                var selected = dd.worldBookSelectionInitialized === false ? selectedDefaults.slice() : savedSelected.slice();
                if (dd.worldBookSelectionInitialized === false) {
                    dd.selectedWorldBookNames = selected.slice();
                    dd.worldBookSelectionInitialized = true;
                    save(dd);
                }
                var h = '';
                wbNames.forEach(function(name, idx) {
                    var checked = selected.indexOf(name) !== -1 ? ' checked' : '';
                    h += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" class="om-roll-wb-book" value="' + name.replace(/"/g,'&quot;') + '"' + checked + ' /> ' + name.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</label>';
                });
                container.innerHTML = h;
                var goBtn = sheet.querySelector('#om-roll-go');
                if (goBtn) { goBtn.disabled = true; goBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 加载世界书...'; }
                function getCheckedBookNames() {
                    var names = [];
                    container.querySelectorAll('.om-roll-wb-book:checked').forEach(function(c) { names.push(c.value); });
                    return names;
                }
                function updateWorldBookCountLabels() {
                    container.querySelectorAll('.om-roll-wb-book').forEach(function(cb) {
                        var labelText = cb.parentElement.lastChild;
                        var baseText = (labelText && labelText.nodeType === 3 ? labelText.nodeValue : '').replace(/\s*\(\d+套\)\s*$/, '');
                        if (worldBookStyleCache[cb.value]) {
                            var count = worldBookStyleCache[cb.value].length;
                            if (labelText && labelText.nodeType === 3) {
                                labelText.nodeValue = baseText + ' (' + count + '套)';
                            } else {
                                cb.parentElement.appendChild(document.createTextNode(' (' + count + '套)'));
                            }
                        }
                    });
                }
                function loadCheckedWorldBooks() {
                    var checkedNames = getCheckedBookNames();
                    rollWorldBooksReady = false;
                    var btn = sheet.querySelector('#om-roll-go');
                    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 加载世界书...'; }
                    if (checkedNames.length === 0) {
                        rollWorldBooksReady = true;
                        refreshRollFilterOptions([]);
                        updateWorldBookCountLabels();
                        if (btn) { btn.disabled = false; btn.innerHTML = '随机搭配！'; }
                        try { console.log('[OM-WB] roll world books ready: none selected'); } catch (e) {}
                        return;
                    }
                    refreshWorldBookStyles(checkedNames, function() {
                        rollWorldBooksReady = true;
                        updateWorldBookCountLabels();
                        refreshRollFilterOptions(checkedNames);
                        try {
                            console.log('[OM-WB] roll selected world books ready:', checkedNames.map(function (name) {
                                return name + '=' + ((worldBookStyleCache[name] || []).length);
                            }).join(', '));
                        } catch (e) {}
                        var goBtn2 = sheet.querySelector('#om-roll-go');
                        if (goBtn2) { goBtn2.disabled = false; goBtn2.innerHTML = '随机搭配！'; }
                    });
                }
                // Save selection on change
                container.querySelectorAll('.om-roll-wb-book').forEach(function(cb) {
                    cb.addEventListener('change', function() {
                        var dd2 = load();
                        dd2.selectedWorldBookNames = getCheckedBookNames();
                        dd2.worldBookSelectionInitialized = true;
                        save(dd2);
                        loadCheckedWorldBooks();
                    });
                });
                loadCheckedWorldBooks();
            } catch(e) {
                container.innerHTML = '<span style="opacity:.5">加载世界书失败</span>';
                var goBtn3 = sheet.querySelector('#om-roll-go');
                if (goBtn3) { goBtn3.disabled = false; goBtn3.innerHTML = '随机搭配！'; }
            }
        })();
        function openRollResultModal(resultHtml) {
            var mp = getPopupLayer();
            var old = mp.querySelector('#om-roll-result-modal');
            if (old) old.remove();
            var modal = document.createElement('div');
            modal.className = 'om-modal';
            modal.id = 'om-roll-result-modal';
            modal.innerHTML = '<div class="om-modal-box" style="max-width:560px"><div class="om-modal-title"><i class="fa-solid fa-dice"></i> 随机搭配结果</div><div style="max-height:56vh;overflow:auto;margin-top:8px">' + resultHtml + '</div><div class="om-btn-row" style="margin-top:12px"><button class="om-btn om-btn-safe" id="om-roll-modal-apply">应用这套搭配</button><button class="om-btn om-btn-outline" id="om-roll-modal-close">继续调整</button></div></div>';
            modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
            mp.appendChild(modal);
            modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
            modal.querySelector('#om-roll-modal-close').addEventListener('click', function () { modal.remove(); });
            modal.querySelector('#om-roll-modal-apply').addEventListener('click', function () {
                modal.remove();
                var applyBtn = sheet.querySelector('#om-roll-apply');
                if (applyBtn) applyBtn.click();
            });
        }
        function doRoll() {
            var ss = sheet.querySelector('#om-roll-style').value;
            var sn = sheet.querySelector('#om-roll-season').value;
            var sc = sheet.querySelector('#om-roll-scene').value;
            var sm = sheet.querySelector('#om-roll-mode').value;
            var useWBOnly = sheet.querySelector('#om-roll-wb-only') ? sheet.querySelector('#om-roll-wb-only').checked : false;
            var pool = useWBOnly ? [] : allOutfits.slice();
            var wbList = sheet.querySelector('#om-roll-wb-list');
            var checkedBooks = [];
            if (wbList) {
                wbList.querySelectorAll('input[type=checkbox].om-roll-wb-book:checked').forEach(function(cb) {
                    checkedBooks.push(cb.value);
                });
            }
            if (useWBOnly && checkedBooks.length === 0) {
                toast('请先选择世界书', true);
                return;
            }
            if (checkedBooks.length > 0 && !rollWorldBooksReady) {
                toast('世界书还在加载，请稍等一下', true);
                return;
            }
            checkedBooks.forEach(function(wbName) {
                (worldBookStyleCache[wbName] || []).forEach(function(ws, wi) {
                    pool.push(createWorldBookOutfit(ws, 'wb_dyn_' + wbName.replace(/[^a-zA-Z0-9]/g,'_'), wi));
                });
            });
            if (useWBOnly && checkedBooks.length > 0 && pool.length === 0) {
                toast('世界书还没有加载出穿搭，请刷新后重试', true);
                return;
            }
            var f = pool.filter(function (o) {
                if (ss && (!o.style || o.style.trim() !== ss)) return false;
                if (sn && (!o.season || o.season.trim() !== sn)) return false;
                if (sc) {
                    if (o.isVirtual && o.worldBookStyle) {
                        if (!worldBookStyleMatchesScene(o.worldBookStyle, sc)) return false;
                    } else {
                        var sceneTags = String(o.sceneTag || '').split(/[,，/、\s]+/).filter(Boolean);
                        if (sceneTags.indexOf(sc) === -1) return false;
                    }
                }
                return true;
            });
            try {
                console.log('[OM-WB] roll pool:', {
                    checkedBooks: checkedBooks,
                    worldBookCounts: checkedBooks.map(function (name) { return name + '=' + ((worldBookStyleCache[name] || []).length); }),
                    totalPool: pool.length,
                    matched: f.length,
                    filters: { style: ss || '不限', season: sn || '不限', scene: sc || '不限', mode: sm, worldBookOnly: useWBOnly }
                });
            } catch (e) {}
            if (f.length === 0) { toast('没有匹配的穿搭', true); return; }
            var r = { outfits: [], items: [] };
            var fo = f.filter(function (o) { return isOutfitType(o); });
            var fi = f.filter(function (o) { return isItemType(o); });
            if (sm === 'outfit') {
                if (fo.length === 0) { toast('没有匹配的套装', true); return; }
                r.outfits = [fo[Math.floor(Math.random() * fo.length)]];
            } else if (sm === 'items') {
                var g = {};
                fi.forEach(function (it) {
                    var c = it.category || '其他';
                    if (!g[c]) g[c] = [];
                    g[c].push(it);
                });
                for (var k in g) r.items.push(g[k][Math.floor(Math.random() * g[k].length)]);
            } else {
                if (fo.length > 0) r.outfits = [fo[Math.floor(Math.random() * fo.length)]];
                var g2 = {};
                fi.forEach(function (it) {
                    var c2 = it.category || '其他';
                    if (!g2[c2]) g2[c2] = [];
                    g2[c2].push(it);
                });
                for (var k2 in g2) r.items.push(g2[k2][Math.floor(Math.random() * g2[k2].length)]);
            }
            lastResult = r;
            var h = '<div>';
            if (r.outfits.length > 0) {
                h += '<div style="font-weight:600;margin-bottom:8px">套装</div>';
                r.outfits.forEach(function (o) {
                    h += '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px;padding:8px;background:rgba(127,127,127,.06);border-radius:8px">';
                    var oImg = resolveOutfitImage(o);
                    if (oImg) h += '<img src="' + esc(oImg) + '" style="width:80px;height:106px;object-fit:cover;border-radius:6px;flex-shrink:0" />';
                    h += '<div style="min-width:0"><div style="font-weight:600;margin-bottom:2px">' + esc(o.name) + '</div>';
                    if (o.style) h += '<div style="font-size:.8em;opacity:.7">风格：' + esc(o.style) + '</div>';
                    if (o.season) h += '<div style="font-size:.8em;opacity:.7">季节：' + esc(o.season) + '</div>';
                    if (o.sceneTag) h += '<div style="font-size:.8em;opacity:.7">场景：' + esc(o.sceneTag) + '</div>';
                    if (o.description) h += '<div style="font-size:.82em;opacity:.85;margin-top:6px;line-height:1.6;padding:8px;background:rgba(127,127,127,.05);border-radius:6px;white-space:pre-wrap">' + esc(o.description) + '</div>';
                    h += '</div></div>';
                });
            }
            if (r.items.length > 0) {
                h += '<div style="font-weight:600;margin:8px 0">单品</div>';
                r.items.forEach(function (o) {
                    h += '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;padding:6px 8px;background:rgba(127,127,127,.04);border-radius:6px">';
                    var oImg2 = resolveOutfitImage(o);
                    if (oImg2) h += '<img src="' + esc(oImg2) + '" style="width:60px;height:80px;object-fit:cover;border-radius:4px;flex-shrink:0" />';
                    h += '<div><span style="font-size:.75em;opacity:.5">' + esc(o.category || '其他') + '</span><br>' + esc(o.name) + '</div>';
                    if (o.description) h += '<div style="font-size:.75em;opacity:.7;margin-top:2px;line-height:1.4">' + esc(o.description) + '</div>';
                    h += '</div></div>';
                });
            }
            h += '</div>';
            sheet.querySelector('#om-roll-result').innerHTML = h;
            sheet.querySelector('#om-roll-result-area').style.display = '';
            openRollResultModal(h);
        }
        sheet.querySelector('#om-roll-close-sheet').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-roll-go').addEventListener('click', doRoll);
        sheet.querySelector('#om-roll-cancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-roll-apply').addEventListener('click', function () { if (!lastResult) return; var dd = load(); dd.activeIds = []; if (dd.chars) for (var cn in dd.chars) dd.chars[cn].activeIds = []; var ids = []; lastResult.outfits.forEach(function (o) { if (o.isVirtual) { var no = { id: genId(), name: o.name, category: o.category || '', type: 'outfit', style: o.style || '', season: o.season || '', sceneTag: o.sceneTag || '', description: o.description || '', imageData: null, createdAt: Date.now(), isVirtual: true }; dd.virtualOutfits[no.id] = no; ids.push(no.id); } else { ids.push(o.id); } }); lastResult.items.forEach(function (o) { ids.push(o.id); }); if (dd.currentView === 'char' && dd.currentChar) getCharData(dd, dd.currentChar).activeIds = ids; else dd.activeIds = ids; save(dd); closeSheet(sheet); toast('已应用！(' + ids.length + '件)'); renderGrid(); renderBottomStatus(); updateBtn(); });

    }

    function openEditSheet(outfit, defaultCat) {
        var d = load();
        var editImgData = outfit ? (resolveOutfitImage(outfit) || null) : null;
        var viewCats = getViewCategories(d);
        var catOpts = '<option value="">无分类</option>' +
            viewCats.map(function (c) { return '<option value="' + esc(c) + '"' + (outfit && outfit.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');

        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-' + (outfit ? 'pen' : 'plus') + '"></i>' + (outfit ? '编辑穿搭' : '添加穿搭') + '</div>',
            '<div class="om-field"><label>穿搭名称 *</label><input type="text" id="om-dn" placeholder="如：白色蕾丝连衣裙" value="' + esc(outfit ? outfit.name : '') + '" /></div>',
            '<div class="om-field"><label>分类</label><div class="om-frow"><select id="om-dcat">' + catOpts + '</select><button class="om-btn om-btn-outline" id="om-dnewcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
            '<div class="om-field"><label>类型</label><div class="om-type-radios"><label class="om-radio-label"><input type="radio" name="om-dtype" value="套装"' + (!outfit || isOutfitType(outfit) ? ' checked' : '') + ' /> 套装</label><label class="om-radio-label" style="margin-left:16px"><input type="radio" name="om-dtype" value="单品"' + (outfit && isItemType(outfit) ? ' checked' : '') + ' /> 单品</label></div></div>',
            '<div class="om-field"><label>风格</label><input type="text" id="om-dstyle" placeholder="学院 / 简约 / 运动 / 甜美 / 通勤 / 休闲 / 街头 / 优雅 / 舒适" value="' + esc(outfit ? outfit.style || '' : '') + '" /></div>',
            '<div class="om-field"><label>季节</label><input type="text" id="om-dseason" placeholder="春 / 夏 / 秋 / 冬 / 全年" value="' + esc(outfit ? outfit.season || '' : '') + '" /></div>',
            '<div class="om-field"><label>文字描述 <span class="om-hint">AI 注入用，越详细越好</span></label><textarea id="om-ddesc" rows="4" placeholder="如：白色蕾丝镂空连衣裙，领口略低，裙摆及膝……">' + esc(outfit ? outfit.description || '' : '') + '</textarea>' +
            '<button class="om-btn om-btn-outline" id="om-daidesc" style="font-size:.78em;margin-top:5px;align-self:flex-start"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述</button>' +
            '<button class="om-btn om-btn-outline" id="om-dautotag" style="font-size:.78em;margin-top:5px;align-self:flex-start"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 一键识别</button></div>',
            '<div class="om-field"><label>场景标签 <span class="om-hint">多套时 AI 据此选穿搭，如：外出 / 家居 / 睡前</span></label>',
            '<div class="om-suggest-wrap"><input type="text" id="om-dscene" placeholder="外出 / 家居 / 睡前 / 运动" value="' + esc(outfit ? outfit.sceneTag || '' : '') + '" autocomplete="off" />',
            '<div class="om-suggest-list" id="om-scene-suggest" style="display:none"></div></div></div>',
            '<div class="om-field"><label>参考图片 <span class="om-hint">可选，自动压缩</span></label>',
            '<div class="om-imgarea" id="om-dimgarea">' + (editImgData ? '<img src="' + editImgData + '" />' : '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传</span></div>') + '</div>',
            '<input type="file" id="om-dfile" accept="image/*" style="display:none" />',
            '<div class="om-img-actions"><button class="om-btn om-btn-outline" id="om-dpick" style="font-size:.8em"><i class="fa-solid fa-image"></i> 选择图片</button>' + (editImgData ? '<button class="om-btn om-btn-danger" id="om-dclr" style="font-size:.8em">删除图片</button>' : '') + '</div></div>',
            '<div class="om-edit-foot"><button class="om-btn om-btn-outline" id="om-dcancel">取消</button><button class="om-btn om-btn-safe" id="om-dsave">保存</button></div>',
        ].join(''));

        // 设置默认分类
        if (defaultCat) {
            var sel = sheet.querySelector('#om-dcat'); if (sel) sel.value = defaultCat;
        }

        // 场景标签建议
        var sceneInput = sheet.querySelector('#om-dscene');
        var suggestList = sheet.querySelector('#om-scene-suggest');
        var allTags = getAllTagSuggestions(d);
        function showSuggestions(val) {
            var v = val.trim().toLowerCase();
            var filtered = v ? allTags.filter(function (t) { return t.toLowerCase().indexOf(v) !== -1 && t.toLowerCase() !== v; }) : allTags;
            if (filtered.length === 0) { suggestList.style.display = 'none'; return; }
            suggestList.innerHTML = filtered.map(function (t) { return '<div class="om-suggest-item" data-val="' + esc(t) + '">' + esc(t) + '</div>'; }).join('');
            suggestList.style.display = 'block';
        }
        sceneInput.addEventListener('focus', function () { showSuggestions(this.value); });
        sceneInput.addEventListener('input', function () { showSuggestions(this.value); });
        sceneInput.addEventListener('blur', function () { setTimeout(function () { suggestList.style.display = 'none'; }, 150); });
        suggestList.addEventListener('mousedown', function (e) {
            var item = e.target.closest('.om-suggest-item');
            if (item) { sceneInput.value = item.dataset.val; suggestList.style.display = 'none'; }
        });

        // 图片处理
        var fileInp = sheet.querySelector('#om-dfile');
        var imgArea = sheet.querySelector('#om-dimgarea');
        function setImg(data) {
            editImgData = data;
            imgArea.innerHTML = data ? '<img src="' + data + '" />' : '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传</span></div>';
            var clrOld = sheet.querySelector('#om-dclr'); var acts = sheet.querySelector('.om-img-actions');
            if (data && !clrOld && acts) {
                var b2 = document.createElement('button'); b2.className = 'om-btn om-btn-danger'; b2.id = 'om-dclr'; b2.style.fontSize = '.8em'; b2.textContent = '删除图片';
                b2.addEventListener('click', function () { setImg(null); }); acts.appendChild(b2);
            } else if (!data && clrOld) clrOld.parentNode.removeChild(clrOld);
        }
        function handleFile(f) {
            if (!f || f.type.indexOf('image') !== 0) return;
            var r = new FileReader(); r.onload = function (e) { compressImage(e.target.result, function (c) { setImg(c); }); }; r.readAsDataURL(f);
        }
        sheet.querySelector('#om-dpick').addEventListener('click', function () { fileInp.click(); });
        imgArea.addEventListener('click', function () { fileInp.click(); });
        fileInp.addEventListener('change', function () { if (fileInp.files[0]) handleFile(fileInp.files[0]); });
        imgArea.addEventListener('dragover', function (e) { e.preventDefault(); imgArea.classList.add('drag'); });
        imgArea.addEventListener('dragleave', function () { imgArea.classList.remove('drag'); });
        imgArea.addEventListener('drop', function (e) { e.preventDefault(); imgArea.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
        var clr = sheet.querySelector('#om-dclr'); if (clr) clr.addEventListener('click', function () { setImg(null); });

        // AI 生成描述按钮
        sheet.querySelector('#om-daidesc').addEventListener('click', function () {
            var imgData = editImgData;
            if (!imgData) { toast('请先上传图片', true); return; }
            var dd = load();
            if (!dd.apiVision.endpoint || !dd.apiVision.key || !dd.apiVision.model) { toast('请先在设置中配置"描述生成 API"', true); return; }
            var btn = sheet.querySelector('#om-daidesc');
            btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
            var tmpOutfit = { name: sheet.querySelector('#om-dn').value || '穿搭', imageData: imgData };
            generateSingleDescription(tmpOutfit, function (err, desc) {
                btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述';
                if (err) { toast('生成失败：' + err, true); return; }
                sheet.querySelector('#om-ddesc').value = desc;
                toast('✅ 描述已生成');
            });
        });

        sheet.querySelector('#om-dautotag').addEventListener('click', function () { var imgData = editImgData; if (!imgData) { toast('请先上传图片', true); return; } var ddx = load(); if (!ddx.apiVision.endpoint || !ddx.apiVision.key || !ddx.apiVision.model) { toast('请先配置 API', true); return; } var btnx = this; btnx.disabled = true; btnx.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 识别中...'; callVisionAPI(ddx.apiVision, { name: sheet.querySelector('#om-dn').value || '穿搭', dataUrl: imgData }, ddx.apiVision.autoTagPrompt, function (err, text) { btnx.disabled = false; btnx.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI 一键识别'; if (err) { toast('识别失败：' + err, true); return; } var parsed = parseAutoTagResult(text); if (parsed.name) sheet.querySelector('#om-dn').value = parsed.name; if (parsed.type) { var radios = sheet.querySelectorAll('input[name="om-dtype"]'); radios.forEach(function (r) { r.checked = r.value === parsed.type; }); } if (parsed.style) sheet.querySelector('#om-dstyle').value = parsed.style; if (parsed.season) sheet.querySelector('#om-dseason').value = parsed.season; if (parsed.scene) sheet.querySelector('#om-dscene').value = parsed.scene; if (parsed.description) sheet.querySelector('#om-ddesc').value = parsed.description; toast('一键识别完成'); }); });
        sheet.querySelector('#om-dnewcat').addEventListener('click', function () {
            var name = prompt('新分类名称：'); if (!name || !name.trim()) return; name = name.trim();
            var dd = load(); var vc = getViewCategories(dd); if (vc.indexOf(name) === -1) { vc.push(name); save(dd); renderCatbar(); }
            var sel = sheet.querySelector('#om-dcat'); var ex = false;
            for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === name) { ex = true; break; } }
            if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel.appendChild(opt); }
            sel.value = name; toast('分类「' + name + '」已添加');
        });

        sheet.querySelector('#om-dcancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-dsave').addEventListener('click', function () {
            var name = sheet.querySelector('#om-dn').value.trim();
            if (!name) { toast('请输入穿搭名称', true); return; }
            var cat = sheet.querySelector('#om-dcat').value;
            var desc = sheet.querySelector('#om-ddesc').value.trim();
            var scene = sheet.querySelector('#om-dscene').value.trim();
            var otype = (sheet.querySelector('input[name="om-dtype"]:checked') || {}).value || '套装';
            var style = sheet.querySelector('#om-dstyle') ? sheet.querySelector('#om-dstyle').value.trim() : '';
            var season = sheet.querySelector('#om-dseason') ? sheet.querySelector('#om-dseason').value.trim() : '';
            var dd = load();
            var imageTarget = null;
            var ownerLabel = dd.currentView === 'char' && dd.currentChar ? dd.currentChar : 'User';
            if (outfit) {
                // 编辑已有穿搭 - 在所有数据中查找
                var found = false;
                for (var i = 0; i < dd.outfits.length; i++) {
                    if (dd.outfits[i].id === outfit.id) {
                        Object.assign(dd.outfits[i], { name: name, category: cat, type: otype, style: style, season: season, description: desc, sceneTag: scene });
                        imageTarget = dd.outfits[i]; ownerLabel = 'User'; found = true; break;
                    }
                }
                if (!found && dd.chars) {
                    for (var cn in dd.chars) {
                        var co = dd.chars[cn].outfits || [];
                        for (var j = 0; j < co.length; j++) {
                            if (co[j].id === outfit.id) {
                                Object.assign(co[j], { name: name, category: cat, type: otype, style: style, season: season, description: desc, sceneTag: scene });
                                imageTarget = co[j]; ownerLabel = cn; found = true; break;
                            }
                        }
                        if (found) break;
                    }
                }
            } else {
                // 新增穿搭 - 放入当前视角
                var newOutfit = { id: genId(), name: name, category: cat, type: otype, style: style, season: season, description: desc, sceneTag: scene, createdAt: Date.now() };
                imageTarget = newOutfit;
                if (dd.currentView === 'char' && dd.currentChar) {
                    getCharData(dd, dd.currentChar).outfits.push(newOutfit);
                } else {
                    dd.outfits.push(newOutfit);
                }
            }
            setOutfitImageFields(imageTarget || {}, editImgData, { owner: ownerLabel, name: name }, function (err) {
                save(dd); closeSheet(sheet); toast(err ? '✨ 已保存：' + name + '（图片缓存失败，已保留旧格式）' : '✨ 已保存：' + name); renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn();
            });
        });
    }

    // ── 预设 Bottom Sheet ─────────────────────────────────────
    function openPresetsSheet() {
        var d = load();
        var activePresetId = d.activePresetId || null;
        var presetListHtml = (!d.presets || d.presets.length === 0)
            ? '<div class="om-empty"><i class="fa-solid fa-bookmark"></i><span>还没有预设</span></div>'
            : d.presets.map(function (p, idx) {
                var isCurrent = (activePresetId && p.id === activePresetId);
                return '<div class="om-preset-item' + (isCurrent ? ' current' : '') + '" data-idx="' + idx + '">' +
                    '<div class="om-preset-name">' + esc(p.name) + (isCurrent ? ' <span style="font-size:.7em;opacity:.5;font-weight:400">（当前）</span>' : '') + '</div>' +
                    '<div class="om-preset-count">包含 ' + (p.outfits || []).length + ' 套穿搭</div>' +
                    '<button class="om-btn-sm om-preset-ren" data-idx="' + idx + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="om-btn-sm om-preset-del" data-idx="' + idx + '" title="删除"><i class="fa-solid fa-trash"></i></button>' +
                    '</div>';
            }).join('');

        // 保存区：如果有当前预设，显示"覆盖保存"按钮
        var currentPreset = null;
        if (activePresetId && d.presets) {
            for (var pi = 0; pi < d.presets.length; pi++) {
                if (d.presets[pi].id === activePresetId) { currentPreset = d.presets[pi]; break; }
            }
        }
        var saveSection = '';
        if (currentPreset) {
            saveSection =
                '<div class="om-sec-title">保存</div>' +
                '<div class="om-btn-row" style="margin-bottom:10px">' +
                '<button class="om-btn om-btn-safe" id="om-preset-overwrite" style="flex:1"><i class="fa-solid fa-floppy-disk"></i> 保存到「' + esc(currentPreset.name) + '」</button>' +
                '</div>' +
                '<div class="om-divider"></div>' +
                '<div class="om-sec-title">另存为新预设</div>' +
                '<div class="om-cat-add-row"><input type="text" id="om-preset-name-inp" placeholder="新预设名称…" /><button class="om-btn om-btn-outline" id="om-preset-save">保存</button></div>';
        } else {
            saveSection =
                '<div class="om-sec-title">保存当前状态为预设</div>' +
                '<div class="om-hint" style="margin-bottom:8px">将当前所有穿搭数据 + 分类一起打包保存</div>' +
                '<div class="om-cat-add-row"><input type="text" id="om-preset-name-inp" placeholder="预设名称…" /><button class="om-btn om-btn-safe" id="om-preset-save">保存</button></div>';
        }

        var sheet = createSheet([
            '<div class="om-sheet-title om-settings-title">' +
            '<span class="om-settings-title-main"><i class="fa-solid fa-bookmark"></i>预设管理</span>' +
            '<button class="om-sheet-close" id="om-presets-close" type="button" title="退出预设管理"><i class="fa-solid fa-xmark"></i>退出</button>' +
            '</div>',
            '<div class="om-sec-title">已保存的预设 <span class="om-hint">点击名称加载</span></div>',
            presetListHtml,
            '<div class="om-divider"></div>',
            saveSection,
        ].join(''));

        sheet.querySelector('#om-presets-close').addEventListener('click', function () { closeSheet(sheet); });

        // 覆盖保存到当前预设
        var overwriteBtn = sheet.querySelector('#om-preset-overwrite');
        if (overwriteBtn) overwriteBtn.addEventListener('click', function () {
            var dd = load();
            var replacedPresetOutfits = [];
            for (var i = 0; i < dd.presets.length; i++) {
                if (dd.presets[i].id === activePresetId) {
                    replacedPresetOutfits = (dd.presets[i].outfits || []).slice();
                    dd.presets[i].outfits = JSON.parse(JSON.stringify(dd.outfits));
                    dd.presets[i].categories = JSON.parse(JSON.stringify(dd.categories));
                    dd.presets[i].activeIds = JSON.parse(JSON.stringify(dd.activeIds));
                    dd.presets[i].updatedAt = Date.now();
                    break;
                }
            }
            save(dd); closeSheet(sheet); toast('✅ 已保存到「' + currentPreset.name + '」'); openPresetsSheet();
            deleteUnusedOutfitImageAssets(dd, replacedPresetOutfits, function (result) {
                if (result.failed > 0) toast('预设已更新，但有 ' + result.failed + ' 张旧服务器图片清理失败', true);
            });
        });

        // 保存为新预设
        var inp = sheet.querySelector('#om-preset-name-inp');
        sheet.querySelector('#om-preset-save').addEventListener('click', function () {
            var name = inp.value.trim(); if (!name) { toast('请输入预设名称', true); return; }
            var dd = load();
            if (!Array.isArray(dd.presets)) dd.presets = [];
            var newId = genId();
            dd.presets.push({ id: newId, name: name, createdAt: Date.now(), outfits: JSON.parse(JSON.stringify(dd.outfits)), categories: JSON.parse(JSON.stringify(dd.categories)), activeIds: JSON.parse(JSON.stringify(dd.activeIds)) });
            save(dd); dd = load(); dd.activePresetId = newId; save(dd); inp.value = ''; closeSheet(sheet); toast('✨ 预设「' + name + '」已保存'); openPresetsSheet();
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sheet.querySelector('#om-preset-save').click(); });

        // 加载预设
        sheet.querySelectorAll('.om-preset-item').forEach(function (item) {
            item.addEventListener('click', function (e) {
                if (e.target.closest('.om-preset-ren') || e.target.closest('.om-preset-del')) return;
                var dd = load(); var p = dd.presets[parseInt(item.dataset.idx)]; if (!p) return;
                if (!confirm('加载预设「' + p.name + '」？这将覆盖当前所有穿搭数据。')) return;
                var replacedUserOutfits = (dd.outfits || []).slice();
                dd.outfits = JSON.parse(JSON.stringify(p.outfits || []));
                dd.categories = JSON.parse(JSON.stringify(p.categories || []));
                dd.activeIds = JSON.parse(JSON.stringify(p.activeIds || []));
                dd.activePresetId = p.id;
                save(dd); closeSheet(sheet); renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn(); toast('✅ 已加载「' + p.name + '」');
                deleteUnusedOutfitImageAssets(dd, replacedUserOutfits, function (result) {
                    if (result.failed > 0) toast('预设已加载，但有 ' + result.failed + ' 张旧服务器图片清理失败', true);
                });
            });
        });
        sheet.querySelectorAll('.om-preset-ren').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var dd = load(); var p = dd.presets[parseInt(btn.dataset.idx)]; if (!p) return;
                var nw = prompt('重命名：', p.name); if (!nw || !nw.trim()) return;
                p.name = nw.trim(); save(dd); closeSheet(sheet); openPresetsSheet(); toast('已重命名');
            });
        });
        sheet.querySelectorAll('.om-preset-del').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var dd = load(); var p = dd.presets[parseInt(btn.dataset.idx)]; if (!p) return;
                if (!confirm('删除预设「' + p.name + '」？')) return;
                var removedPresetOutfits = (p.outfits || []).slice();
                if (p.id === activePresetId) { dd.activePresetId = null; }
                dd.presets.splice(parseInt(btn.dataset.idx), 1); save(dd); closeSheet(sheet); openPresetsSheet(); toast('已删除');
                deleteUnusedOutfitImageAssets(dd, removedPresetOutfits, function (result) {
                    if (result.failed > 0) toast('预设已删除，但有 ' + result.failed + ' 张服务器图片清理失败', true);
                });
            });
        });
    }

    // ── 设置 Bottom Sheet ─────────────────────────────────────
    function getOutfitRepairSignature(outfit) {
        return JSON.stringify([
            String((outfit && outfit.name) || ''),
            String((outfit && outfit.description) || ''),
            String((outfit && outfit.category) || ''),
            String((outfit && outfit.type) || '')
        ]);
    }

    function findDuplicateCharacterImageRepairCandidate(d) {
        var chars = (d && d.chars) || {};
        var names = Object.keys(chars);
        var best = null;
        names.forEach(function (targetName) {
            var targetOutfits = (chars[targetName] && chars[targetName].outfits) || [];
            if (targetOutfits.length < 10) return;
            var refCounts = {};
            targetOutfits.forEach(function (outfit) {
                var ref = normalizeOutfitImageRef(outfit && (outfit.imageRef || outfit.imageUrl));
                if (ref) refCounts[ref] = (refCounts[ref] || 0) + 1;
            });
            var dominant = Object.keys(refCounts).map(function (ref) { return { ref: ref, count: refCounts[ref] }; })
                .sort(function (a, b) { return b.count - a.count; })[0];
            if (!dominant || dominant.count < 10 || dominant.count / targetOutfits.length < 0.8) return;

            names.forEach(function (donorName) {
                if (donorName === targetName) return;
                var donorOutfits = (chars[donorName] && chars[donorName].outfits) || [];
                if (donorOutfits.length < dominant.count) return;
                var donorRefs = {};
                donorOutfits.forEach(function (outfit) {
                    var ref = normalizeOutfitImageRef(outfit && (outfit.imageRef || outfit.imageUrl));
                    if (ref) donorRefs[ref] = true;
                });
                if (Object.keys(donorRefs).length < Math.min(donorOutfits.length, dominant.count) * 0.8) return;

                var pairs = [];
                var max = Math.min(targetOutfits.length, donorOutfits.length);
                for (var i = 0; i < max; i++) {
                    var target = targetOutfits[i];
                    var donor = donorOutfits[i];
                    var targetRef = normalizeOutfitImageRef(target && (target.imageRef || target.imageUrl));
                    var donorRef = donor && (donor.imageRef || donor.imageUrl);
                    if (targetRef !== dominant.ref || !donorRef) continue;
                    if (getOutfitRepairSignature(target) !== getOutfitRepairSignature(donor)) continue;
                    pairs.push({ target: target, donor: donor, index: i });
                }
                if (pairs.length < 10 || pairs.length / dominant.count < 0.95) return;
                var candidate = {
                    targetName: targetName,
                    donorName: donorName,
                    dominantRef: dominant.ref,
                    dominantCount: dominant.count,
                    pairs: pairs
                };
                if (!best || candidate.pairs.length > best.pairs.length) best = candidate;
            });
        });
        return best;
    }

    function repairDuplicateCharacterImageRefs(candidate, cb) {
        if (!candidate || !candidate.pairs || candidate.pairs.length === 0) { cb('没有可修复的图片映射'); return; }
        var d = load();
        var liveCandidate = findDuplicateCharacterImageRepairCandidate(d);
        if (!liveCandidate || liveCandidate.targetName !== candidate.targetName || liveCandidate.donorName !== candidate.donorName) {
            cb('衣柜数据已变化，请重新打开迁移面板后再试');
            return;
        }
        liveCandidate.pairs.forEach(function (pair) {
            var ref = pair.donor.imageRef || pair.donor.imageUrl;
            pair.target.imageRef = ref;
            pair.target.imageUrl = pair.donor.imageUrl || pair.donor.imageRef;
            delete pair.target.imageData;
        });
        persistImageMigrationCheckpoint(d, true, function (err) {
            var audit = getOutfitManagerAudit();
            if (audit) {
                audit.run_id = Date.now();
                audit.image_repair = {
                    status: err ? 'fail' : 'success',
                    target: liveCandidate.targetName,
                    donor: liveCandidate.donorName,
                    repaired: liveCandidate.pairs.length,
                    error: err || null
                };
                audit.last_error = err || null;
            }
            if (err) { cb(err); return; }
            deleteUnusedOutfitImageAssets(d, [{ imageRef: liveCandidate.dominantRef, imageUrl: liveCandidate.dominantRef }], function () {
                cb(null, liveCandidate.pairs.length);
            });
        });
    }

    function openImageMigrationSheet() {
        var stats = getLegacyImageMigrationStats(load());
        var repairCandidate = findDuplicateCharacterImageRepairCandidate(load());
        if (!imageMigrationRun && stats.count === 0) {
            var audit = getOutfitManagerAudit();
            if (audit) {
                audit.run_id = Date.now();
                audit.image_migration = { status: 'success', total: 0, processed: 0, migrated: 0, failed: 0, remaining: 0, error: null };
                audit.last_error = null;
            }
        }
        var repairHtml = repairCandidate ? [
            '<div class="om-divider"></div>',
            '<div class="om-sec-title"><i class="fa-solid fa-triangle-exclamation" style="margin-right:5px"></i>检测到异常重复图片</div>',
            '<div class="om-hint" style="line-height:1.6;margin-bottom:8px">角色「' + esc(repairCandidate.targetName) + '」有 ' + repairCandidate.dominantCount + ' 件衣服共用同一图片；已找到内容和顺序一致的正常衣柜「' + esc(repairCandidate.donorName) + '」，可安全恢复其中 ' + repairCandidate.pairs.length + ' 件图片映射。</div>',
            '<button class="om-btn om-btn-safe" id="om-migration-repair" style="width:100%"><i class="fa-solid fa-screwdriver-wrench"></i> 修复「' + esc(repairCandidate.targetName) + '」的重复图片</button>',
            '<div id="om-migration-repair-status" class="om-hint" style="margin-top:7px"></div>'
        ].join('') : '';
        var sheet = createSheet([
            '<div class="om-sheet-title om-settings-title">' +
            '<span class="om-settings-title-main"><i class="fa-solid fa-images"></i>历史图片安全迁移</span>' +
            '<button class="om-sheet-close" id="om-migration-close" type="button"><i class="fa-solid fa-xmark"></i>退出</button>' +
            '</div>',
            '<div class="om-hint" style="line-height:1.6;margin-bottom:10px">逐张上传到 <code>user/images/Outfit-Manager</code>，验证成功后立即释放该条 <code>imageData</code>。迁移会根据设备内存和已释放字节自动保存检查点、让出事件循环并继续；通常只需点击一次。失败图片仍保留原 base64。</div>',
            '<div class="om-storage-info" id="om-migration-summary">待迁移 ' + stats.count + ' 条记录，估算原图数据 ' + formatStorageBytes(stats.estimatedBytes) + '。</div>',
            '<div style="height:8px;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden;margin:12px 0 8px"><div id="om-migration-progress" style="height:100%;width:0;background:#4caf50;transition:width .2s"></div></div>',
            '<div id="om-migration-status" style="font-size:.86em;font-weight:600;margin-bottom:5px"></div>',
            '<div id="om-migration-detail" class="om-hint" style="line-height:1.5"></div>',
            '<div class="om-divider"></div>',
            '<div class="om-hint" style="line-height:1.5;margin-bottom:10px">建议先导出一份“包含图片 base64”的完整备份。迁移期间不要编辑、删除或导入衣服。</div>',
            '<div class="om-btn-row">',
            '<button class="om-btn om-btn-safe" id="om-migration-start"><i class="fa-solid fa-play"></i> 开始安全迁移</button>',
            '<button class="om-btn om-btn-danger" id="om-migration-stop" style="display:none"><i class="fa-solid fa-stop"></i> 停止并保存</button>',
            '</div>',
            repairHtml,
            '<div class="om-divider"></div>',
            '<div class="om-sec-title"><i class="fa-solid fa-magnifying-glass" style="margin-right:5px"></i>② 重新扫描旧设置备份</div>',
            '<div id="om-backup-cleanup-status" class="om-storage-info">等待统计设置备份…</div>',
            '<div id="om-backup-cleanup-summary" class="om-hint" style="line-height:1.5;margin-top:7px"></div>',
            '<button class="om-btn om-btn-outline" id="om-backup-cleanup-scan" style="width:100%;margin-top:10px"><i class="fa-solid fa-rotate"></i> 重新扫描</button>',
            '<button class="om-btn om-btn-danger" id="om-backup-cleanup-delete" style="width:100%;margin-top:6px" disabled><i class="fa-solid fa-shield-halved"></i> 等待扫描结果</button>',
            '<div class="om-divider"></div>',
            '<div class="om-sec-title"><i class="fa-solid fa-shield-halved" style="margin-right:5px"></i>③ 打开酒馆清理工具</div>',
            '<div class="om-storage-info" style="line-height:1.65;border-color:#dc2626;background:rgba(220,38,38,.12);color:#ef4444;font-weight:700">严重警告：建议只处理 Settings Backups！！酒馆清理工具中的删除无法恢复！！</div>',
            '<button class="om-btn om-btn-safe" id="om-backup-cleanup-open" style="width:100%;margin-top:10px"><i class="fa-solid fa-screwdriver-wrench"></i> 打开酒馆清理工具</button>',
            '<div id="om-data-maid-open-status" class="om-hint" style="line-height:1.5;margin-top:8px"></div>'
        ].join(''));
        sheet.setAttribute('data-om-migration-sheet', '1');
        sheet.querySelector('#om-migration-close').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-migration-start').addEventListener('click', function () {
            if (imageMigrationRun && imageMigrationRun.status === 'save_failed') {
                retryImageMigrationSave();
                return;
            }
            var current = getLegacyImageMigrationStats(load());
            if (current.count === 0) { updateImageMigrationUI(); return; }
            var profile = getImageMigrationDeviceProfile();
            var batchNotice = '\n\n当前模式：' + profile.label + '；每 ' + profile.countLimit + ' 张或释放 ' + formatStorageBytes(profile.byteLimit) + ' 自动保存检查点并继续。';
            if (!confirm('开始迁移 ' + current.count + ' 条历史图片记录？\n\n每张图片只有在上传并读取验证成功后才会删除 base64。' + batchNotice)) return;
            startImageMigration();
        });
        sheet.querySelector('#om-migration-stop').addEventListener('click', requestStopImageMigration);
        var repairBtn = sheet.querySelector('#om-migration-repair');
        if (repairBtn) repairBtn.addEventListener('click', function () {
            if (!confirm('确认使用角色「' + repairCandidate.donorName + '」的对应图片，修复「' + repairCandidate.targetName + '」的 ' + repairCandidate.pairs.length + ' 件衣服？\n\n只会修改图片引用，不会改变名称、描述、分类或当前穿着。')) return;
            repairBtn.disabled = true;
            var statusEl = sheet.querySelector('#om-migration-repair-status');
            if (statusEl) statusEl.textContent = '正在修复并保存共享设置…';
            repairDuplicateCharacterImageRefs(repairCandidate, function (err, count) {
                if (err) {
                    repairBtn.disabled = false;
                    if (statusEl) statusEl.textContent = '修复失败：' + err;
                    toast('图片映射修复失败：' + err, true);
                    return;
                }
                if (statusEl) statusEl.textContent = '已修复 ' + count + ' 件图片映射。刷新后仍会保持。';
                repairBtn.textContent = '修复完成';
                renderGrid();
                refreshSettingsBackupSummaries();
                toast('✅ 已修复「' + repairCandidate.targetName + '」的 ' + count + ' 件图片');
            });
        });
        sheet.querySelector('#om-backup-cleanup-scan').addEventListener('click', function () {
            scanSettingsBackupSummary(sheet);
        });
        sheet.querySelector('#om-backup-cleanup-delete').addEventListener('click', function () {
            deleteRecommendedSettingsBackups(sheet, this);
        });
        sheet.querySelector('#om-backup-cleanup-open').addEventListener('click', function () {
            openNativeDataMaidFromMigration(sheet);
        });
        updateImageMigrationUI();
        scanSettingsBackupSummary(sheet);
    }

    function openSettingsSheet() {
        var d = load();
        var outfitCount = countAllOutfits(d);
        var imgCount = countAllOutfitImages(d);

        var sheet = createSheet([
            '<div class="om-sheet-title om-settings-title">' +
            '<span class="om-settings-title-main"><i class="fa-solid fa-sliders"></i>设置</span>' +
            '<button class="om-sheet-close" id="om-settings-close" type="button" title="退出设置"><i class="fa-solid fa-xmark"></i>退出</button>' +
            '</div>',

            '<div class="om-sec-title">发送内容</div>',
            '<div class="om-setting-row"><label>发送给 AI 的内容类型</label><select id="om-mode">',
            '<option value="text"' + (d.mode === 'text' ? ' selected' : '') + '>仅文字描述</option>',
            '<option value="image"' + (d.mode === 'image' ? ' selected' : '') + '>仅图片</option>',
            '<option value="both"' + (d.mode === 'both' ? ' selected' : '') + '>文字 + 图片</option>',
            '</select></div>',

            '<div class="om-setting-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="om-auto-roll"' + (!d.autoRollDisabled ? ' checked' : '') + ' /> 启动时自动随机穿搭（从世界书）</label></div>' +
            '<div class="om-setting-row"><label>注入位置 <span class="om-hint">Gemini/DeepSeek 建议选\"用户消息\"</span></label><select id="om-inject-pos">',
            '<option value="system"' + (d.injectPosition === 'system' ? ' selected' : '') + '>系统提示末尾</option>',
            '<option value="context"' + (d.injectPosition === 'context' ? ' selected' : '') + '>上下文末尾</option>',
            '<option value="user"' + (d.injectPosition === 'user' || !d.injectPosition ? ' selected' : '') + '>用户消息末尾（推荐）</option>',
            '</select></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">单套模式模板 <span class="om-hint">（User选了1套时生效）</span></div>',
            '<div class="om-hint" style="margin-bottom:6px">{{description}} → 替换为穿搭的文字描述</div>',
            '<div class="om-setting-row"><textarea id="om-tpl-single" rows="3">' + esc(d.singleTemplate) + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">衣柜模式模板 <span class="om-hint">（User选了多套时生效）</span></div>',
            '<div class="om-hint" style="margin-bottom:6px">{{wardrobe}} → 替换为所有已选穿搭的列表</div>',
            '<div class="om-setting-row"><textarea id="om-tpl-multi" rows="5">' + esc(d.multiTemplate) + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">角色单套模板 <span class="om-hint">（角色选了1套时生效）</span></div>',
            '<div class="om-hint" style="margin-bottom:6px">{{charName}} → 角色名 / {{description}} → 描述</div>',
            '<div class="om-setting-row"><textarea id="om-tpl-char-single" rows="3">' + esc(d.charSingleTemplate || '【{{charName}}的穿搭】\n{{description}}') + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">角色衣柜模板 <span class="om-hint">（角色选了多套时生效）</span></div>',
            '<div class="om-hint" style="margin-bottom:6px">{{charName}} → 角色名 / {{wardrobe}} → 穿搭列表</div>',
            '<div class="om-setting-row"><textarea id="om-tpl-char-multi" rows="5">' + esc(d.charMultiTemplate || '【{{charName}}的穿搭】\n{{wardrobe}}') + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">图片模式补充提示</div>',
            '<div class="om-setting-row"><label>单套+图片</label><textarea id="om-imgprompt" rows="2">' + esc(d.imagePrompt) + '</textarea></div>',
            '<div class="om-setting-row" style="margin-top:6px"><label>衣柜+图片</label><textarea id="om-multi-imgprompt" rows="2">' + esc(d.multiImagePrompt) + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title"><i class="fa-solid fa-wand-magic-sparkles" style="margin-right:4px"></i>描述生成 API <span class="om-hint">（用于批量生成穿搭文字描述，需要 Vision 模型）</span></div>',
            '<div class="om-setting-row om-row-inline"><label>使用酒馆主 API（推荐）</label><input type="checkbox" class="om-chk" id="om-use-main-api"' + (d.useMainApi !== false ? ' checked' : '') + ' /></div>',
            '<div id="om-custom-api-fields" style="display:' + (d.useMainApi !== false ? 'none' : 'block') + '">',
            '<div class="om-setting-row"><label>API 地址</label><input type="text" id="om-api-v-endpoint" placeholder="https://api.openai.com 或中转站地址" value="' + esc(d.apiVision.endpoint) + '" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit" /></div>',
            '<div class="om-setting-row"><label>API Key</label><input type="password" id="om-api-v-key" placeholder="sk-..." value="' + esc(d.apiVision.key) + '" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit" /></div>',
            '<div class="om-setting-row"><label>模型名称</label><div style="display:flex;gap:6px;align-items:center"><input type="text" id="om-api-v-model" placeholder="gpt-4o / gemini-2.0-flash / claude-sonnet-4-20250514" value="' + esc(d.apiVision.model) + '" style="flex:1;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;box-sizing:border-box;font-family:inherit" /><button class="om-btn om-btn-outline" id="om-api-v-model-fetch" style="font-size:.75em;white-space:nowrap;padding:7px 10px;flex-shrink:0"><i class="fa-solid fa-rotate"></i> 拉取</button></div></div>',
            '<div class="om-setting-row"><label>并发数 <span class="om-hint">同时发送的请求数，越大越快但可能触发限速（1-5）</span></label><input type="number" id="om-api-v-batch" min="1" max="5" value="' + (d.apiVision.concurrency || 3) + '" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:80px;box-sizing:border-box;font-family:inherit" /></div>',
            '<div class="om-setting-row"><label>描述生成 Prompt</label><textarea id="om-api-v-prompt" rows="3" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">' + esc(d.apiVision.prompt) + '</textarea></div>',
            '<div class="om-setting-row om-row-inline"><label>覆盖已有描述</label><input type="checkbox" class="om-chk" id="om-api-v-overwrite"' + (d.apiVision.overwrite ? ' checked' : '') + ' /></div>',
            '</div>',
            '<div class="om-btn-row" style="margin-top:6px"><button class="om-btn om-btn-outline" id="om-api-v-test" style="font-size:.8em"><i class="fa-solid fa-flask-vial"></i> 测试连接</button></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">分类管理</div>',
            '<button class="om-btn om-btn-outline" id="om-open-cats" style="width:100%;text-align:left"><i class="fa-solid fa-tags" style="margin-right:7px"></i>管理分类…</button>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">数据</div>',
            '<div class="om-storage-info">' + outfitCount + ' 套穿搭 / ' + imgCount + ' 张图片 / ' + (d.presets ? d.presets.length : 0) + ' 个预设 | 酒馆共享存储</div>',
            '<button class="om-btn om-btn-outline" id="om-migrate-images" style="width:100%;text-align:left;margin-top:8px"><i class="fa-solid fa-images" style="margin-right:7px"></i>迁移历史 base64 图片…</button>',
            '<div class="om-btn-row" style="margin-top:8px">',
            '<button class="om-btn om-btn-outline" id="om-exp"><i class="fa-solid fa-download"></i> 导出</button>',
            '<button class="om-btn om-btn-outline" id="om-imp"><i class="fa-solid fa-upload"></i> 导入</button>',
            '<button class="om-btn om-btn-danger" id="om-clear">清空穿搭</button>',
            '</div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">悬浮球</div>',
            '<div class="om-setting-row om-row-inline"><label>显示悬浮球</label><input type="checkbox" class="om-chk" id="om-show-ball"' + (d.showBall !== false ? ' checked' : '') + ' /></div>',
            '<div class="om-divider"></div>',
            '<div class="om-sec-title">调试</div>',
            '<div class="om-setting-row om-row-inline"><label>注入时显示 Toast 提示</label><input type="checkbox" class="om-chk" id="om-debug"' + (d.debug ? ' checked' : '') + ' /></div>',
        ].join(''));

        sheet.querySelector('#om-settings-close').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-mode').addEventListener('change', function () { var dd = load(); dd.mode = this.value; save(dd); });
        sheet.querySelector('#om-inject-pos').addEventListener('change', function () { var dd = load(); dd.injectPosition = this.value; save(dd); });
        sheet.querySelector('#om-auto-roll').addEventListener('change', function () { var dd = load(); dd.autoRollDisabled = !this.checked; save(dd); });
        sheet.querySelector('#om-tpl-single').addEventListener('input', function () { var dd = load(); dd.singleTemplate = this.value; save(dd); });
        sheet.querySelector('#om-tpl-multi').addEventListener('input', function () { var dd = load(); dd.multiTemplate = this.value; save(dd); });
        sheet.querySelector('#om-tpl-char-single').addEventListener('input', function () { var dd = load(); dd.charSingleTemplate = this.value; save(dd); });
        sheet.querySelector('#om-tpl-char-multi').addEventListener('input', function () { var dd = load(); dd.charMultiTemplate = this.value; save(dd); });
        sheet.querySelector('#om-imgprompt').addEventListener('input', function () { var dd = load(); dd.imagePrompt = this.value; save(dd); });
        sheet.querySelector('#om-multi-imgprompt').addEventListener('input', function () { var dd = load(); dd.multiImagePrompt = this.value; save(dd); });

        // API Vision 配置
        sheet.querySelector('#om-api-v-endpoint').addEventListener('input', function () { var dd = load(); dd.apiVision.endpoint = this.value.trim(); save(dd); });
        sheet.querySelector('#om-api-v-key').addEventListener('input', function () { var dd = load(); dd.apiVision.key = this.value.trim(); save(dd); });
        sheet.querySelector('#om-api-v-model').addEventListener('input', function () { var dd = load(); dd.apiVision.model = this.value.trim(); save(dd); });
        sheet.querySelector('#om-api-v-batch').addEventListener('change', function () { var dd = load(); dd.apiVision.concurrency = Math.max(1, Math.min(5, parseInt(this.value) || 3)); save(dd); });
        sheet.querySelector('#om-api-v-prompt').addEventListener('input', function () { var dd = load(); dd.apiVision.prompt = this.value; save(dd); });
        sheet.querySelector('#om-api-v-overwrite').addEventListener('change', function () { var dd = load(); dd.apiVision.overwrite = this.checked; save(dd); });
        sheet.querySelector('#om-use-main-api').addEventListener('change', function () { var dd = load(); dd.useMainApi = this.checked; if (this.checked) { autoDetectApiConfig(dd); } save(dd); var fields = sheet.querySelector('#om-custom-api-fields'); if (fields) fields.style.display = this.checked ? 'none' : 'block'; });
        sheet.querySelector('#om-api-v-test').addEventListener('click', function () {
            var dd = load();
            if (!dd.apiVision.endpoint || !dd.apiVision.key || !dd.apiVision.model) { toast('请先填写 API 地址、Key 和模型名称', true); return; }
            toast('正在测试...');
            fetch(normalizeEndpoint(dd.apiVision.endpoint, 'chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dd.apiVision.key },
                body: JSON.stringify({ model: dd.apiVision.model, messages: [{ role: 'user', content: '回复OK' }], max_tokens: 10 })
            }).then(function (r) {
                if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status); });
                return r.json();
            }).then(function () { toast('✅ 描述 API 连接成功！'); })
            .catch(function (e) { toast('❌ 连接失败：' + e.message, true); });
        });
        // Vision 模型拉取按钮
        var vModelFetch = sheet.querySelector('#om-api-v-model-fetch');
        if (vModelFetch) vModelFetch.addEventListener('click', function () {
            var dd = load();
            if (!dd.apiVision.endpoint || !dd.apiVision.key) { toast('请先填写 API 地址和 Key', true); return; }
            openModelPicker(dd.apiVision, function (model) {
                dd = load(); dd.apiVision.model = model; save(dd);
                var inp = sheet.querySelector('#om-api-v-model'); if (inp) inp.value = model;
            });
        });

        sheet.querySelector('#om-show-ball').addEventListener('change', function () {
            var dd = load(); dd.showBall = this.checked; save(dd);
            var oldFab = document.getElementById(FAB_ID); if (oldFab) oldFab.parentNode.removeChild(oldFab);
            if (dd.showBall) injectFab();
        });
        sheet.querySelector('#om-debug').addEventListener('change', function () { var dd = load(); dd.debug = this.checked; save(dd); });
        sheet.querySelector('#om-exp').addEventListener('click', function () {
            closeSheet(sheet);
            setTimeout(exportData, 0);
        });
        sheet.querySelector('#om-imp').addEventListener('click', function () {
            closeSheet(sheet);
            setTimeout(importData, 0);
        });
        sheet.querySelector('#om-migrate-images').addEventListener('click', function () {
            closeSheet(sheet);
            setTimeout(openImageMigrationSheet, 0);
        });
        sheet.querySelector('#om-clear').addEventListener('click', function () {
            var dd = load();
            var label = dd.currentView === 'char' && dd.currentChar ? '「' + dd.currentChar + '」的穿搭' : 'User 的穿搭';
            if (!confirm('确定清空' + label + '？（其他数据不受影响）')) return;
            var removedOutfits = getViewOutfits(dd).slice();
            if (dd.currentView === 'char' && dd.currentChar) {
                var cd = getCharData(dd, dd.currentChar);
                cd.outfits = []; cd.categories = []; cd.activeIds = [];
            } else {
                dd.outfits = []; dd.categories = []; dd.activeIds = [];
            }
            save(dd); closeSheet(sheet); renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn(); toast('已清空');
            deleteUnusedOutfitImageAssets(dd, removedOutfits, function (result) {
                if (result.failed > 0) toast('衣柜已清空，但有 ' + result.failed + ' 张服务器图片清理失败', true);
            });
        });
        sheet.querySelector('#om-open-cats').addEventListener('click', function () {
            closeSheet(sheet); openCatsSheet();
        });
    }

    // ── 分类管理 Bottom Sheet ─────────────────────────────────
    function openCatsSheet() {
        var d = load();
        var cats = getViewCategories(d);
        var viewOutfits = getViewOutfits(d);
        var viewLabel = d.currentView === 'char' && d.currentChar ? d.currentChar + '的' : 'User的';
        var listHTML = cats.length === 0
            ? '<div class="om-empty"><i class="fa-solid fa-tags"></i><span>还没有分类</span></div>'
            : cats.map(function (cat, idx) {
                var n = viewOutfits.filter(function (o) { return o.category === cat; }).length;
                return '<div class="om-cat-item"><span class="om-cat-name">' + esc(cat) + '</span><span class="om-cat-count">' + n + '套</span>' +
                    '<button class="om-btn-sm om-cat-ren" data-idx="' + idx + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="om-btn-sm om-cat-del" data-idx="' + idx + '" title="删除"><i class="fa-solid fa-trash"></i></button></div>';
            }).join('');

        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-tags"></i>' + esc(viewLabel) + '分类管理</div>',
            listHTML,
            '<div class="om-divider"></div>',
            '<div class="om-cat-add-row"><input type="text" id="om-newcat" placeholder="新分类名称…" /><button class="om-btn om-btn-safe" id="om-newadd">添加</button></div>',
        ].join(''));

        var inp = sheet.querySelector('#om-newcat');
        sheet.querySelector('#om-newadd').addEventListener('click', function () {
            var name = inp.value.trim(); if (!name) return;
            var dd = load(); var vc = getViewCategories(dd);
            if (vc.indexOf(name) === -1) { vc.push(name); save(dd); inp.value = ''; closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('分类「' + name + '」已添加'); }
            else toast('分类已存在', true);
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sheet.querySelector('#om-newadd').click(); });

        sheet.querySelectorAll('.om-cat-ren').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var dd = load(); var vc = getViewCategories(dd); var vo = getViewOutfits(dd);
                var idx = parseInt(btn.dataset.idx); var old = vc[idx];
                var nw = prompt('重命名（原：' + old + '）：', old); if (!nw || !nw.trim() || nw.trim() === old) return;
                nw = nw.trim(); vc[idx] = nw;
                vo.forEach(function (o) { if (o.category === old) o.category = nw; });
                save(dd); closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('已重命名');
            });
        });
        sheet.querySelectorAll('.om-cat-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var dd = load(); var vc = getViewCategories(dd); var vo = getViewOutfits(dd);
                var idx = parseInt(btn.dataset.idx); var name = vc[idx];
                if (!confirm('删除分类「' + name + '」？（穿搭不会被删除）')) return;
                vc.splice(idx, 1);
                vo.forEach(function (o) { if (o.category === name) o.category = ''; });
                if (curCat === name) curCat = '__all__';
                save(dd); closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('已删除');
            });
        });
    }

    // ── Bottom Sheet 通用创建/关闭 ───────────────────────────
    function createSheet(contentHtml) {
        bringPopupLayerToFront();
        var ov = document.createElement('div');
        ov.className = 'om-sheet-overlay';
        ov.innerHTML = '<div class="om-sheet"><div class="om-sheet-handle"></div><div class="om-sheet-content">' + contentHtml + '</div></div>';
        getPopupLayer().appendChild(ov);
        ov.addEventListener('click', function (e) { if (e.target === ov) closeSheet(ov); });
        return ov;
    }

    function closeSheet(ov) {
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }

    // ── 全屏 Lightbox ─────────────────────────────────────────
    function openLightbox(outfits, startId) {
        if (!outfits || outfits.length === 0) return;
        var idx = 0;
        for (var i = 0; i < outfits.length; i++) { if (outfits[i].id === startId) { idx = i; break; } }

        var lb = document.createElement('div');
        lb.id = 'om-lightbox';
        lb.className = 'om-lightbox';
        lb.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2 !important;pointer-events:auto !important;background:rgba(0,0,0,.92) !important;display:flex !important;align-items:center !important;justify-content:center !important;';

        function render() {
            var o = outfits[idx];
            var img = resolveOutfitImage(o);
            lb.innerHTML =
                '<button class="om-lb-close" id="om-lb-close"><i class="fa-solid fa-xmark"></i></button>' +
                '<div class="om-lb-name">' + esc(o.name) + '</div>' +
                (outfits.length > 1 ? '<button class="om-lb-nav om-lb-prev" id="om-lb-prev"><i class="fa-solid fa-chevron-left"></i></button>' : '') +
                '<img class="om-lb-img" src="' + esc(img) + '" draggable="false" />' +
                (outfits.length > 1 ? '<button class="om-lb-nav om-lb-next" id="om-lb-next"><i class="fa-solid fa-chevron-right"></i></button>' : '') +
                (outfits.length > 1 ? '<div class="om-lb-counter">' + (idx + 1) + ' / ' + outfits.length + '</div>' : '');
            lb.querySelector('#om-lb-close').addEventListener('click', closeLb);
            var prev = lb.querySelector('#om-lb-prev'); var next = lb.querySelector('#om-lb-next');
            if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx - 1 + outfits.length) % outfits.length; render(); });
            if (next) next.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx + 1) % outfits.length; render(); });
        }
        lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
        function closeLb() { if (lb.parentNode) lb.parentNode.removeChild(lb); document.removeEventListener('keydown', keyH); }
        function keyH(e) {
            if (e.key === 'Escape') closeLb();
            else if (e.key === 'ArrowLeft' && outfits.length > 1) { idx = (idx - 1 + outfits.length) % outfits.length; render(); }
            else if (e.key === 'ArrowRight' && outfits.length > 1) { idx = (idx + 1) % outfits.length; render(); }
        }
        document.addEventListener('keydown', keyH);
        render();
        getPopupLayer().appendChild(lb);
        lb.style.setProperty('pointer-events', 'auto', 'important');
    }

    // ── 导出 ──────────────────────────────────────────────────
    function doExport(data, filename) {
        try {
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = filename; document.body.appendChild(a); a.click();
            setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
        } catch (e) { toast('导出失败：' + e.message, true); }
    }

    function cloneExportPayload(data, includeInlineImages) {
        var cloned = JSON.parse(JSON.stringify(data || {}));
        if (includeInlineImages) return cloned;
        function stripInlineImages(obj) {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach(stripInlineImages);
                return;
            }
            if (Object.prototype.hasOwnProperty.call(obj, 'imageData')) delete obj.imageData;
            Object.keys(obj).forEach(function (k) { stripInlineImages(obj[k]); });
        }
        stripInlineImages(cloned);
        return cloned;
    }

    function exportData() {
        var d = load();
        var isCharView = d.currentView === 'char' && d.currentChar;
        var modal = document.createElement('div');
        modal.className = 'om-modal ' + (darkMode ? 'om-dark' : 'om-light');
        modal.style.setProperty('z-index', '2147483647', 'important');

        var charBtns = '';
        if (isCharView) {
            charBtns =
                '<button class="om-modal-btn" id="om-exp-char-one"><i class="fa-solid fa-user" style="margin-right:8px"></i>导出「' + esc(d.currentChar) + '」<br><small style="opacity:.6;font-weight:400">当前角色的穿搭+分类</small></button>';
        }
        if (d.charNames && d.charNames.length > 0) {
            charBtns +=
                '<button class="om-modal-btn" id="om-exp-char-all"><i class="fa-solid fa-users" style="margin-right:8px"></i>导出全部角色<br><small style="opacity:.6;font-weight:400">所有角色的穿搭+分类</small></button>';
        }

        modal.innerHTML = '<div class="om-modal-box">' +
            '<div class="om-modal-title"><i class="fa-solid fa-download" style="margin-right:6px"></i>导出数据</div>' +
            '<label class="om-checkrow" style="align-items:flex-start;margin-bottom:4px"><input type="checkbox" id="om-exp-images" checked><span><b>包含图片 base64</b><br><small style="opacity:.6">取消后只保留 imageRef/imageUrl；旧格式 base64 图片不会写进导出 JSON。</small></span></label>' +
            '<button class="om-modal-btn" id="om-exp-all"><i class="fa-solid fa-database" style="margin-right:8px"></i>导出完整备份<br><small style="opacity:.6;font-weight:400">User+角色+预设+设置</small></button>' +
            '<button class="om-modal-btn" id="om-exp-user"><i class="fa-solid fa-shirt" style="margin-right:8px"></i>仅导出 User 穿搭<br><small style="opacity:.6;font-weight:400">User的穿搭+分类</small></button>' +
            charBtns +
            '<button class="om-modal-cancel" id="om-exp-cancel">取消</button></div>';
        var _mp = getPopupLayer();
        modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2147483647 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
        _mp.appendChild(modal);
        modal.addEventListener('click', function (e) { if (e.target === modal) _mp.removeChild(modal); });
        modal.querySelector('#om-exp-cancel').addEventListener('click', function () { _mp.removeChild(modal); });

        // 导出完整备份
        document.getElementById('om-exp-all').addEventListener('click', function () {
            var includeImages = !!(document.getElementById('om-exp-images') || {}).checked;
            _mp.removeChild(modal);
            doExport(cloneExportPayload(d, includeImages), 'outfit-mgr-backup-' + new Date().toISOString().slice(0, 10) + '.json');
            toast('✅ 已导出完整数据');
        });

        // 导出User穿搭
        document.getElementById('om-exp-user').addEventListener('click', function () {
            var includeImages = !!(document.getElementById('om-exp-images') || {}).checked;
            _mp.removeChild(modal);
            doExport(cloneExportPayload({ type: 'user', outfits: d.outfits, categories: d.categories }, includeImages), 'outfit-mgr-user-' + new Date().toISOString().slice(0, 10) + '.json');
            toast('✅ 已导出 User 穿搭');
        });

        // 导出当前角色
        var expCharOne = document.getElementById('om-exp-char-one');
        if (expCharOne) expCharOne.addEventListener('click', function () {
            var includeImages = !!(document.getElementById('om-exp-images') || {}).checked;
            _mp.removeChild(modal);
            var cd = getCharData(d, d.currentChar);
            doExport(cloneExportPayload({ type: 'char', charName: d.currentChar, outfits: cd.outfits, categories: cd.categories }, includeImages), 'outfit-mgr-char-' + d.currentChar + '-' + new Date().toISOString().slice(0, 10) + '.json');
            toast('✅ 已导出「' + d.currentChar + '」');
        });

        // 导出全部角色
        var expCharAll = document.getElementById('om-exp-char-all');
        if (expCharAll) expCharAll.addEventListener('click', function () {
            var includeImages = !!(document.getElementById('om-exp-images') || {}).checked;
            _mp.removeChild(modal);
            var charExport = { type: 'chars_all', charNames: d.charNames, chars: {} };
            (d.charNames || []).forEach(function (cn) { charExport.chars[cn] = getCharData(d, cn); });
            doExport(cloneExportPayload(charExport, includeImages), 'outfit-mgr-all-chars-' + new Date().toISOString().slice(0, 10) + '.json');
            toast('✅ 已导出全部角色（' + d.charNames.length + '个）');
        });
    }

    function importData() {
        var d0 = load();
        var currentLabel = d0.currentView === 'char' && d0.currentChar ? '「' + d0.currentChar + '」衣柜' : 'User 衣柜';
        var modal = document.createElement('div');
        modal.className = 'om-modal';
        modal.style.setProperty('z-index', '2147483647', 'important');
        modal.innerHTML = '<div class="om-modal-box">' +
            '<div class="om-modal-title"><i class="fa-solid fa-upload" style="margin-right:6px"></i>导入数据</div>' +
            '<div class="om-hint" style="margin-bottom:10px">选择之前导出的 .json 文件。当前目标：' + esc(currentLabel) + '</div>' +
            '<button class="om-modal-btn" id="om-imp-current-merge"><i class="fa-solid fa-code-merge" style="margin-right:8px"></i>合并到当前衣柜<br><small style="opacity:.6;font-weight:400">把文件里的衣服追加到 ' + esc(currentLabel) + '</small></button>' +
            '<button class="om-modal-btn" id="om-imp-current-replace"><i class="fa-solid fa-arrows-rotate" style="margin-right:8px"></i>覆盖当前衣柜<br><small style="opacity:.6;font-weight:400">用文件里的衣服替换 ' + esc(currentLabel) + '</small></button>' +
            '<div class="om-hint" style="margin:10px 0 6px">也可以按文件原来的归属导入：</div>' +
            '<button class="om-modal-btn" id="om-imp-file-merge"><i class="fa-solid fa-file-import" style="margin-right:8px"></i>按文件归属合并<br><small style="opacity:.6;font-weight:400">User文件进User，角色文件进原角色</small></button>' +
            '<button class="om-modal-btn" id="om-imp-file-replace"><i class="fa-solid fa-database" style="margin-right:8px"></i>按文件归属覆盖<br><small style="opacity:.6;font-weight:400">替换文件对应的衣柜（预设保留）</small></button>' +
            '<input type="file" id="om-imp-file" accept=".json" style="display:none" />' +
            '<button class="om-modal-cancel" id="om-imp-cancel">取消</button></div>';
        var _mp2 = getPopupLayer();
        modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2147483647 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
        _mp2.appendChild(modal);
        modal.addEventListener('click', function (e) { if (e.target === modal) _mp2.removeChild(modal); });
        modal.querySelector('#om-imp-cancel').addEventListener('click', function () { _mp2.removeChild(modal); });
        var fileInp = document.getElementById('om-imp-file');
        var importMode = 'merge';
        var importTarget = 'current';
        function triggerImport(mode, target) { importMode = mode; importTarget = target || 'current'; fileInp.click(); }
        document.getElementById('om-imp-current-merge').addEventListener('click', function () { triggerImport('merge', 'current'); });
        document.getElementById('om-imp-current-replace').addEventListener('click', function () { triggerImport('replace', 'current'); });
        document.getElementById('om-imp-file-merge').addEventListener('click', function () { triggerImport('merge', 'file'); });
        document.getElementById('om-imp-file-replace').addEventListener('click', function () { triggerImport('replace', 'file'); });
        fileInp.addEventListener('change', function () {
            var file = fileInp.files[0]; if (!file) return;
            var reader = new FileReader();
            reader.onload = function (e) {
                try { var imported = JSON.parse(e.target.result); _mp2.removeChild(modal); processImport(imported, importMode, importTarget); }
                catch (err) { toast('文件解析失败，请确认是有效的 JSON 文件', true); }
            };
            reader.onerror = function () { toast('文件读取失败', true); };
            reader.readAsText(file, 'utf-8');
        });
    }

    function getImportWardrobePayload(imported) {
        if (!imported) return null;
        if (Array.isArray(imported.outfits)) {
            return { outfits: imported.outfits, categories: imported.categories || [], presets: imported.presets || [] };
        }
        return null;
    }

    function importPayloadIntoCurrentWardrobe(dd, payload, mode) {
        var srcOutfits = (payload.outfits || []).map(function (o) { return Object.assign({}, o, { id: genId() }); });
        var srcCats = payload.categories || [];
        var targetLabel = dd.currentView === 'char' && dd.currentChar ? '「' + dd.currentChar + '」' : 'User';

        if (dd.currentView === 'char' && dd.currentChar) {
            var cd = getCharData(dd, dd.currentChar);
            if (mode === 'replace') {
                cd.outfits = srcOutfits;
                cd.categories = srcCats.slice();
                cd.activeIds = [];
            } else {
                srcOutfits.forEach(function (o) { cd.outfits.push(o); });
                srcCats.forEach(function (c) { if (cd.categories.indexOf(c) === -1) cd.categories.push(c); });
            }
        } else {
            if (mode === 'replace') {
                dd.outfits = srcOutfits;
                dd.categories = srcCats.slice();
                dd.activeIds = [];
            } else {
                srcOutfits.forEach(function (o) { dd.outfits.push(o); });
                srcCats.forEach(function (c) { if (dd.categories.indexOf(c) === -1) dd.categories.push(c); });
                if ((payload.presets || []).length > 0) {
                    if (!Array.isArray(dd.presets)) dd.presets = [];
                    payload.presets.forEach(function (p2) { if (p2) dd.presets.push(Object.assign({}, p2, { id: genId() })); });
                }
            }
        }
        return { count: srcOutfits.length, targetLabel: targetLabel };
    }

    function processImport(imported, mode, target) {
        var dd = load();
        try {
            function saveImportData() {
                save(dd, { forceShared: true });
            }
            // 1. 预设导入
            if (imported.type === 'preset' && imported.preset) {
                var p = imported.preset; p.id = genId();
                if (!Array.isArray(dd.presets)) dd.presets = [];
                dd.presets.push(p); saveImportData(); renderGrid(); toast('✅ 已导入预设：' + p.name); return;
            }

            // 2. 导入到当前衣柜：用于 User ↔ 角色之间搬运衣服
            if (target === 'current') {
                var payload = getImportWardrobePayload(imported);
                if (!payload) { toast('这个文件不能直接导入到当前衣柜，请改用“按文件归属导入”', true); return; }
                var result = importPayloadIntoCurrentWardrobe(dd, payload, mode);
                saveImportData(); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn();
                toast('✅ 已导入到' + result.targetLabel + '：' + result.count + ' 套穿搭');
                return;
            }

            // 3. 单个角色导入
            if (imported.type === 'char' && imported.charName) {
                var cn = imported.charName;
                if (!dd.chars) dd.chars = {};
                if (!dd.charNames) dd.charNames = [];
                var srcO = (imported.outfits || []).map(function (o) { return Object.assign({}, o, { id: genId() }); });
                var srcC = imported.categories || [];
                if (mode === 'replace') {
                    dd.chars[cn] = { outfits: srcO, categories: srcC, activeIds: [] };
                } else {
                    var cd = getCharData(dd, cn);
                    srcO.forEach(function (o) { cd.outfits.push(o); });
                    srcC.forEach(function (c) { if (cd.categories.indexOf(c) === -1) cd.categories.push(c); });
                }
                if (dd.charNames.indexOf(cn) === -1) dd.charNames.push(cn);
                saveImportData(); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
                toast('✅ 已导入角色「' + cn + '」（' + srcO.length + '套穿搭）');
                return;
            }

            // 4. 全部角色导入
            if (imported.type === 'chars_all' && imported.chars) {
                if (!dd.chars) dd.chars = {};
                if (!dd.charNames) dd.charNames = [];
                var importedNames = imported.charNames || Object.keys(imported.chars);
                var totalOutfits = 0;
                importedNames.forEach(function (cn) {
                    var src = imported.chars[cn]; if (!src) return;
                    var srcO2 = (src.outfits || []).map(function (o) { return Object.assign({}, o, { id: genId() }); });
                    var srcC2 = src.categories || [];
                    if (mode === 'replace') {
                        dd.chars[cn] = { outfits: srcO2, categories: srcC2, activeIds: [] };
                    } else {
                        var cd2 = getCharData(dd, cn);
                        srcO2.forEach(function (o) { cd2.outfits.push(o); });
                        srcC2.forEach(function (c) { if (cd2.categories.indexOf(c) === -1) cd2.categories.push(c); });
                    }
                    if (dd.charNames.indexOf(cn) === -1) dd.charNames.push(cn);
                    totalOutfits += srcO2.length;
                });
                saveImportData(); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
                toast('✅ 已导入 ' + importedNames.length + ' 个角色（共 ' + totalOutfits + ' 套穿搭）');
                return;
            }

            // 5. User穿搭导入（type='user' 或旧格式无type）
            var srcOutfits = imported.outfits || [], srcCats = imported.categories || [], srcPresets = imported.presets || [];
            if (mode === 'replace') {
                dd.outfits = srcOutfits.map(function (o) { return Object.assign({}, o, { id: genId() }); });
                dd.categories = srcCats.slice(); dd.activeIds = [];
            } else {
                srcOutfits.forEach(function (o) { dd.outfits.push(Object.assign({}, o, { id: genId() })); });
                srcCats.forEach(function (c) { if (dd.categories.indexOf(c) === -1) dd.categories.push(c); });
                if (srcPresets.length > 0) {
                    if (!Array.isArray(dd.presets)) dd.presets = [];
                    srcPresets.forEach(function (p2) { if (p2) dd.presets.push(Object.assign({}, p2, { id: genId() })); });
                }
            }

            // 如果是完整备份（含chars），也导入角色数据
            if (imported.chars) {
                if (!dd.chars) dd.chars = {};
                if (!dd.charNames) dd.charNames = [];
                var impNames = imported.charNames || Object.keys(imported.chars);
                impNames.forEach(function (cn) {
                    var src2 = imported.chars[cn]; if (!src2) return;
                    dd.chars[cn] = {
                        outfits: (src2.outfits || []).map(function (o) { return Object.assign({}, o, { id: genId() }); }),
                        categories: src2.categories || [],
                        activeIds: []
                    };
                    if (dd.charNames.indexOf(cn) === -1) dd.charNames.push(cn);
                });
            }

            saveImportData(); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn();
            toast('✅ 导入成功：' + dd.outfits.length + ' 套穿搭');
        } catch (err) { toast('导入处理失败：' + err.message, true); }
    }

    // ── FAB（悬浮球）────────────────────────────────────────
    var fabResizeHandler = null;

    function injectFab() {
        if (document.querySelector('.om-overlay')) return;
        if (document.getElementById(FAB_ID)) return;
        var d = load(); if (d.showBall === false) return;
        var container = document.createElement('div'); container.id = FAB_ID;
        var MAIN_SIZE = 38;
        var accent = 'var(--SmartThemeQuoteColor,#7c6daf)';

        function getDefaultFabPos() {
            var vh = window.innerHeight || document.documentElement.clientHeight;
            var vw = window.innerWidth || document.documentElement.clientWidth;
            var mainTop = vh - 80 - MAIN_SIZE; var mainLeft = vw - 16 - MAIN_SIZE;
            if (mainTop < 10) mainTop = 10; if (mainLeft < 10) mainLeft = 10;
            return { left: mainLeft, top: mainTop };
        }

        function clampFabPos(left, top) {
            var vh = window.innerHeight || document.documentElement.clientHeight;
            var vw = window.innerWidth || document.documentElement.clientWidth;
            return {
                left: Math.round(clampNum(left, 0, vw - MAIN_SIZE)),
                top: Math.round(clampNum(top, 0, vh - MAIN_SIZE))
            };
        }

        function setFabPos(left, top, persist) {
            var pos = clampFabPos(left, top);
            container.setAttribute('style',
                'position:fixed !important;top:' + pos.top + 'px !important;left:' + pos.left + 'px !important;' +
                'z-index:2147483647 !important;display:flex !important;align-items:center !important;' +
                'pointer-events:none !important;margin:0 !important;padding:0 !important;');
            if (persist) saveUILayout({ fab: pos });
        }

        function posFab() {
            var saved = loadUILayout().fab || {};
            var def = getDefaultFabPos();
            var hasSaved = isFinite(parseFloat(saved.left)) && isFinite(parseFloat(saved.top));
            setFabPos(hasSaved ? saved.left : def.left, hasSaved ? saved.top : def.top, hasSaved);
        }

        var mainBtn = document.createElement('div'); mainBtn.id = 'om-fab-main-btn';
        mainBtn.innerHTML = '<i class="fa-solid fa-shirt" style="pointer-events:none;font-size:1.1em;"></i>';

        function styleMainBtn() {
            mainBtn.setAttribute('style',
                'width:' + MAIN_SIZE + 'px !important;height:' + MAIN_SIZE + 'px !important;border-radius:50% !important;' +
                'background:' + accent + ' !important;color:#fff !important;border:none !important;cursor:pointer !important;' +
                'display:flex !important;align-items:center !important;justify-content:center !important;' +
                'font-size:1.2em !important;box-shadow:0 4px 16px rgba(0,0,0,.35) !important;opacity:.9 !important;' +
                'visibility:visible !important;pointer-events:auto !important;margin:0 !important;padding:0 !important;' +
                'flex-shrink:0 !important;transition:transform .2s !important;position:relative !important;z-index:1 !important;');
        }
        styleMainBtn();

        container.appendChild(mainBtn);

        // 拖拽 + 点击判断
        var _dragState = { sx: 0, sy: 0, ox: 0, oy: 0, moved: false, handled: false };
        function beginFabDrag(clientX, clientY) {
            _dragState.sx = clientX; _dragState.sy = clientY;
            var rect = container.getBoundingClientRect();
            _dragState.ox = rect.left; _dragState.oy = rect.top;
            _dragState.moved = false;
            _dragState.handled = false;
        }
        function moveFabDrag(clientX, clientY) {
            var dx = clientX - _dragState.sx, dy = clientY - _dragState.sy;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) _dragState.moved = true;
            if (_dragState.moved) setFabPos(_dragState.ox + dx, _dragState.oy + dy, false);
        }
        function persistFabDrag() {
            var rect = container.getBoundingClientRect();
            setFabPos(rect.left, rect.top, true);
        }
        mainBtn.addEventListener('touchstart', function (e) {
            var t = e.touches[0];
            beginFabDrag(t.clientX, t.clientY);
        }, { passive: true });
        mainBtn.addEventListener('touchmove', function (e) {
            var t = e.touches[0];
            moveFabDrag(t.clientX, t.clientY);
        }, { passive: true });
        mainBtn.addEventListener('touchend', function (e) {
            if (!_dragState.moved) {
                _dragState.handled = true;
                e.preventDefault(); // 阻止后续 click 事件
                // 延迟打开，等触摸事件完全结束
                setTimeout(function () { openPopup(); }, 50);
            } else {
                persistFabDrag();
            }
        });
        mainBtn.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            beginFabDrag(e.clientX, e.clientY);
            function onMove(ev) {
                ev.preventDefault();
                moveFabDrag(ev.clientX, ev.clientY);
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (_dragState.moved) persistFabDrag();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        // PC端点击
        mainBtn.addEventListener('click', function (e) {
            if (_dragState.handled) { _dragState.handled = false; return; }
            if (_dragState.moved) { _dragState.moved = false; return; }
            openPopup();
        });

        posFab();
        if (fabResizeHandler) window.removeEventListener('resize', fabResizeHandler);
        fabResizeHandler = posFab;
        window.addEventListener('resize', fabResizeHandler);
        document.body.appendChild(container);
    }

    function closeFab() {
        var fab = document.getElementById(FAB_ID);
        if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
    }

    // ── 批量 AI 生成描述弹窗 ──────────────────────────────────
    function openBatchDescModal(ids) {
        var d = load();
        var withImg = ids.filter(function (id) { var o = getById(d, id); return o && hasOutfitImage(o); });
        var skipCount = ids.length - withImg.length;
        var willSkipDesc = withImg.filter(function (id) { var o = getById(d, id); return o && o.description && o.description.trim() && !d.apiVision.overwrite; }).length;

        var modal = document.createElement('div');
        modal.className = 'om-modal';
        modal.style.setProperty('z-index', '2147483647', 'important');
        modal.innerHTML = '<div class="om-modal-box" style="background:' + (darkMode ? '#1e1e24' : '#ececef') + ';color:' + (darkMode ? '#eee' : '#111') + '">' +
            '<div class="om-modal-title"><i class="fa-solid fa-wand-magic-sparkles" style="margin-right:6px;color:var(--SmartThemeQuoteColor,#7c6daf)"></i>AI 批量生成描述</div>' +
            '<div style="font-size:.82em;opacity:.7;margin-bottom:8px">' +
            '共选中 ' + ids.length + ' 套，其中 ' + withImg.length + ' 套有图片' +
            (skipCount > 0 ? '，' + skipCount + ' 套无图片将跳过' : '') +
            (willSkipDesc > 0 ? '<br>' + willSkipDesc + ' 套已有描述将跳过（可在设置中开启覆盖）' : '') +
            '</div>' +
            '<div style="font-size:.78em;opacity:.5;margin-bottom:6px">逐张发送，并发 ' + (d.apiVision.concurrency || 3) + ' 个请求，共需 ' + (withImg.length - willSkipDesc) + ' 次 API 调用</div>' +
            '<div id="om-batch-progress" style="display:none;margin:10px 0">' +
            '<div style="font-size:.82em;margin-bottom:6px" id="om-batch-prog-text">准备中...</div>' +
            '<div style="height:6px;background:rgba(127,127,127,.15);border-radius:3px;overflow:hidden">' +
            '<div id="om-batch-prog-bar" style="height:100%;width:0%;background:var(--SmartThemeQuoteColor,#7c6daf);border-radius:3px;transition:width .3s"></div></div></div>' +
            '<div id="om-batch-result" style="display:none;margin:8px 0;font-size:.82em;max-height:120px;overflow-y:auto"></div>' +
            '<div class="om-btn-row" style="margin-top:10px" id="om-batch-actions">' +
            '<button class="om-btn om-btn-safe" id="om-batch-start"><i class="fa-solid fa-play"></i> 开始生成</button>' +
            '<button class="om-btn om-btn-outline" id="om-batch-close">取消</button></div></div>';

        var _mp = getPopupLayer();
        modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
        _mp.appendChild(modal);
        modal.addEventListener('click', function (e) { if (e.target === modal && !modal.dataset.running) { _mp.removeChild(modal); } });
        modal.querySelector('#om-batch-close').addEventListener('click', function () { if (!modal.dataset.running) _mp.removeChild(modal); });

        modal.querySelector('#om-batch-start').addEventListener('click', function () {
            modal.dataset.running = '1';
            modal.querySelector('#om-batch-progress').style.display = 'block';
            modal.querySelector('#om-batch-start').disabled = true;
            modal.querySelector('#om-batch-start').textContent = '生成中...';
            modal.querySelector('#om-batch-close').textContent = '请等待...';

            batchGenerateDescriptions(ids,
                function (done, total, msg) {
                    // 进度回调
                    var pct = total > 0 ? Math.round(done / total * 100) : 0;
                    var bar = modal.querySelector('#om-batch-prog-bar');
                    var txt = modal.querySelector('#om-batch-prog-text');
                    if (bar) bar.style.width = pct + '%';
                    if (txt) txt.textContent = msg;
                },
                function (err, doneCount, errors) {
                    // 完成回调
                    delete modal.dataset.running;
                    var bar = modal.querySelector('#om-batch-prog-bar');
                    if (bar) bar.style.width = '100%';
                    var resultEl = modal.querySelector('#om-batch-result');
                    resultEl.style.display = 'block';
                    if (err && !doneCount) {
                        resultEl.innerHTML = '<div style="color:#e57373"><i class="fa-solid fa-circle-exclamation"></i> ' + esc(err) + '</div>';
                    } else {
                        var successCount = (doneCount || 0) - (errors ? errors.length : 0);
                        var html2 = '<div style="color:#4caf50;font-weight:600">✅ 成功生成 ' + successCount + ' 条描述</div>';
                        if (errors && errors.length > 0) {
                            html2 += '<div style="color:#ff8c42;margin-top:4px">⚠️ ' + errors.length + ' 个失败：</div>';
                            errors.forEach(function (e) {
                                html2 += '<div style="opacity:.6;font-size:.9em;margin-left:8px">· ' + esc(e.name) + '：' + esc(e.error) + '</div>';
                            });
                        }
                        resultEl.innerHTML = html2;
                    }
                    var actionsEl = modal.querySelector('#om-batch-actions');
                    actionsEl.innerHTML = '<button class="om-btn om-btn-safe" id="om-batch-done">完成</button>';
                    modal.querySelector('#om-batch-done').addEventListener('click', function () {
                        _mp.removeChild(modal);
                        renderGrid();
                    });
                }
            );
        });
    }

    // ── API 调用核心 ───────────────────────────────────────────
    // 统一处理 API 地址，兼容各种填法
    function normalizeEndpoint(raw, path) {
        // path: 'chat' | 'models'
        var url = raw.replace(/\/+$/, '');
        // 去掉已有的 /v1/chat/completions 或 /v1/models 后缀
        url = url.replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/v1\/models\/?$/, '');
        // 去掉末尾的 /v1（用户可能多写了）
        url = url.replace(/\/v1\/?$/, '');
        if (path === 'models') return url + '/v1/models';
        return url + '/v1/chat/completions';
    }

    // 拉取模型列表
    function fetchModelList(apiCfg, cb) {
        if (!apiCfg.endpoint || !apiCfg.key) { cb('请先填写 API 地址和 Key'); return; }
        var url = normalizeEndpoint(apiCfg.endpoint, 'models');
        fetch(url, {
                method: 'GET',
                headers: { 'Authorization': 'Bearer ' + apiCfg.key }
            }).then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status); });
                return r.json();
            }).then(function (data) {
            var models = [];
            var list = data.data || data.models || data;
            if (Array.isArray(list)) {
                list.forEach(function (m) {
                    var id = m.id || m.name || m;
                    if (typeof id === 'string' && id) models.push(id);
                });
            }
            models.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
            cb(null, models);
        }).catch(function (e) { cb(e.message || String(e)); });
    }

    // 模型选择下拉弹窗
    function openModelPicker(apiCfg, onSelect) {
        toast('正在拉取模型列表...');
        fetchModelList(apiCfg, function (err, models) {
            if (err) { toast('拉取失败：' + err, true); return; }
            if (!models || models.length === 0) { toast('未获取到模型列表', true); return; }
            var modal = document.createElement('div');
            modal.className = 'om-modal';
            modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
            var searchHtml = '<input type="text" id="om-model-search" placeholder="搜索模型..." style="width:100%;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:8px 10px;font-size:.85em;box-sizing:border-box;font-family:inherit;margin-bottom:8px" />';
            var listHtml = models.map(function (m) {
                return '<div class="om-model-item" data-model="' + esc(m) + '" style="padding:10px 12px;cursor:pointer;border-radius:8px;font-size:.85em;transition:.12s;word-break:break-all">' + esc(m) + '</div>';
            }).join('');
            modal.innerHTML = '<div class="om-modal-box" style="background:' + (darkMode ? '#1e1e24' : '#ececef') + ';color:' + (darkMode ? '#eee' : '#111') + ';max-height:75vh">' +
                '<div class="om-modal-title"><i class="fa-solid fa-list" style="margin-right:6px"></i>选择模型 <span style="font-weight:400;font-size:.75em;opacity:.5">（共 ' + models.length + ' 个）</span></div>' +
                searchHtml +
                '<div id="om-model-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:2px">' + listHtml + '</div>' +
                '<button class="om-modal-cancel" id="om-model-cancel">取消</button></div>';
            var _mp = getPopupLayer();
            _mp.appendChild(modal);
            modal.addEventListener('click', function (e) { if (e.target === modal) _mp.removeChild(modal); });
            modal.querySelector('#om-model-cancel').addEventListener('click', function () { _mp.removeChild(modal); });
            // 搜索过滤
            modal.querySelector('#om-model-search').addEventListener('input', function () {
                var q = this.value.toLowerCase();
                modal.querySelectorAll('.om-model-item').forEach(function (item) {
                    item.style.display = item.dataset.model.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
                });
            });
            setTimeout(function () { modal.querySelector('#om-model-search').focus(); }, 50);
            // 选择模型
            modal.querySelectorAll('.om-model-item').forEach(function (item) {
                item.addEventListener('mouseenter', function () { item.style.background = 'rgba(127,127,127,.12)'; });
                item.addEventListener('mouseleave', function () { item.style.background = ''; });
                item.addEventListener('click', function () {
                    _mp.removeChild(modal);
                    onSelect(item.dataset.model);
                    toast('✅ 已选择：' + item.dataset.model);
                });
            });
        });
    }

    function callVisionAPI(apiCfg, image, systemPrompt, cb, retryCount) {
        // image: {name, dataUrl} → 单张图片单个请求
        retryCount = retryCount || 0;
        var maxRetries = 4;
        if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { cb('API 未配置完整'); return; }
        var endpoint = normalizeEndpoint(apiCfg.endpoint, 'chat');
        localImageRefToDataUrl(image.dataUrl, function (imgErr, dataUrl) {
            if (imgErr) { cb(imgErr); return; }
            var content = [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: '请描述这套穿搭：' + image.name }
            ];
            var body = {
                model: apiCfg.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: content }
                ],
                max_tokens: 1024
            };
            try {
                fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiCfg.key },
                    body: JSON.stringify(body)
                }).then(function (r) {
                    if (!r.ok) { if (r.status === 429 && retryCount < maxRetries) { var delay = (retryCount + 1) * 5000; setTimeout(function () { callVisionAPI(apiCfg, image, systemPrompt, cb, retryCount + 1); }, delay); return; } return r.text().then(function (t) { cb('HTTP ' + r.status + ': ' + (t || '').substring(0, 200)); }); }
                    return r.json();
                }).then(function (data) {
                var text = '';
                if (data.choices && data.choices[0]) {
                    var msg = data.choices[0].message;
                    text = msg ? (msg.content || '') : '';
                } else if (data.candidates && data.candidates[0]) {
                    var parts = data.candidates[0].content && data.candidates[0].content.parts;
                    if (parts) text = parts.map(function (p) { return p.text || ''; }).join('');
                }
                cb(null, text.trim());
                }).catch(function (e) { cb('请求失败：' + (e.message || '网络错误')); });
            } catch (e) { cb('请求异常：' + e.message); }
        });
    }

    function batchGenerateDescriptions(outfitIds, progressCb, doneCb) {
        var d = load();
        var apiCfg = d.apiVision;
        if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { doneCb('请先在设置中配置"描述生成 API"'); return; }
        var targets = [];
        outfitIds.forEach(function (id) {
            var o = getById(d, id);
            if (!o || !hasOutfitImage(o)) return;
            if (!apiCfg.overwrite && o.description && o.description.trim()) return;
            targets.push(o);
        });
        if (targets.length === 0) { doneCb('没有需要生成描述的穿搭（可能都已有描述或无图片）'); return; }

        var concurrency = Math.max(1, Math.min(5, apiCfg.concurrency || 3));
        var done = 0; var total = targets.length; var errors = [];
        var queue = targets.slice(); // 待处理队列

        function processNext() {
            if (queue.length === 0) return;
            var o = queue.shift();
            var image = { name: o.name, dataUrl: resolveOutfitImage(o) };
            callVisionAPI(apiCfg, image, apiCfg.prompt, function (err, text) {
                done++;
                if (err) {
                    errors.push({ name: o.name, error: err });
                } else if (text) {
                    o.description = text;
                } else {
                    errors.push({ name: o.name, error: '返回内容为空' });
                }
                progressCb(done, total, '已完成 ' + done + '/' + total);
                if (done >= total) {
                    save(d);
                    doneCb(errors.length > 0 ? '完成，但有 ' + errors.length + ' 个错误' : null, done, errors);
                } else {
                    processNext();
                }
            });
        }

        progressCb(0, total, '开始生成，并发数 ' + concurrency + '...');
        // 启动 N 个并发
        for (var i = 0; i < Math.min(concurrency, total); i++) {
            processNext();
        }
    }

    // 单个穿搭生成描述
    function generateSingleDescription(outfit, cb) {
        var d = load();
        var apiCfg = d.apiVision;
        if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { cb('请先在设置中配置"描述生成 API"'); return; }
        var img = resolveOutfitImage(outfit);
        if (!img) { cb('该穿搭没有图片'); return; }
        callVisionAPI(apiCfg, { name: outfit.name, dataUrl: img }, apiCfg.prompt, function (err, text) {
            if (err) { cb(err); return; }
            cb(null, text);
        });
    }

    // ── API 注入核心 ──────────────────────────────────────────
    // position: 'system' | 'context' | 'user'
    //   system  = 追加到第一条 system message 末尾（原有行为）
    //   context = 在最后一条 user message 之前插入一条 system message（类似 author's note）
    //   user    = 追加到最后一条 user message 文本末尾
    function injectText(p, text, position) {
        if (!p.messages || !Array.isArray(p.messages)) {
            // 兼容 prompt 模式
            if (typeof p.prompt === 'string') p.prompt = text + '\n\n' + p.prompt;
            return;
        }

        if (position === 'user') {
            // 追加到最后一条 user 消息末尾
            for (var j = p.messages.length - 1; j >= 0; j--) {
                if (p.messages[j].role === 'user') {
                    var c = p.messages[j].content;
                    if (typeof c === 'string') p.messages[j].content = c + '\n\n' + text;
                    else if (Array.isArray(c)) c.push({ type: 'text', text: '\n\n' + text });
                    break;
                }
            }
        } else if (position === 'context') {
            // 在最后一条 user 消息之前插入 system 消息
            var lastUserIdx = -1;
            for (var k = p.messages.length - 1; k >= 0; k--) {
                if (p.messages[k].role === 'user') { lastUserIdx = k; break; }
            }
            var sysMsg = { role: 'system', content: text };
            if (lastUserIdx > 0) p.messages.splice(lastUserIdx, 0, sysMsg);
            else if (lastUserIdx === 0) p.messages.unshift(sysMsg);
            else p.messages.push(sysMsg);
        } else {
            // system: 追加到第一条 system message 末尾
            var si = -1; for (var i = 0; i < p.messages.length; i++) { if (p.messages[i].role === 'system') { si = i; break; } }
            if (si !== -1) {
                var sm = p.messages[si];
                if (typeof sm.content === 'string') sm.content += '\n\n' + text;
                else if (Array.isArray(sm.content)) sm.content.push({ type: 'text', text: '\n\n' + text });
            } else { p.messages.unshift({ role: 'system', content: text }); }
        }
    }

    function injectImages(p, imgs) {
        if (!p.messages || !Array.isArray(p.messages)) return;
        for (var j = p.messages.length - 1; j >= 0; j--) {
            if (p.messages[j].role === 'user') {
                var c = p.messages[j].content;
                var blocks = imgs.map(function (img) { return { type: 'image_url', image_url: { url: img } }; });
                if (typeof c === 'string') p.messages[j].content = [{ type: 'text', text: c }].concat(blocks);
                else if (Array.isArray(c)) blocks.forEach(function (b) { c.push(b); });
                break;
            }
        }
    }

    // ★ v19新增：按owner交错注入 文字标签+图片，让AI知道每张图属于谁
    // ★ v21改进：在末尾注入图片提示词模板（风格引导）
    function injectImageBlocks(p, ownerImageGroups, imgPrompt, multiImgPrompt) {
        if (!p.messages || !Array.isArray(p.messages)) return;
        for (var j = p.messages.length - 1; j >= 0; j--) {
            if (p.messages[j].role === 'user') {
                var c = p.messages[j].content;
                // 确保content是数组格式
                if (typeof c === 'string') {
                    c = [{ type: 'text', text: c }];
                    p.messages[j].content = c;
                }

                // 添加总标题
                if (ownerImageGroups.length > 1) {
                    c.push({ type: 'text', text: '\n\n=== 穿搭图片参考 ===' });
                }

                var hasMulti = false;
                ownerImageGroups.forEach(function (grp) {
                    if (grp.isMulti) {
                        hasMulti = true;
                        // 同一owner多套衣柜
                        c.push({ type: 'text', text: '\n[' + grp.name + '的可选穿搭 - 共' + grp.outfits.length + '套]' });
                        grp.outfits.forEach(function (o, i) {
                            c.push({ type: 'text', text: '\n(' + (i + 1) + ') ' + o.name + (o.sceneTag ? ' [场景：' + o.sceneTag + ']' : '') + '：' });
                            c.push({ type: 'image_url', image_url: { url: resolveOutfitImage(o) } });
                        });
                    } else {
                        // 单套
                        var o = grp.outfits[0];
                        c.push({ type: 'text', text: '\n[' + grp.name + '当前穿着]' });
                        c.push({ type: 'image_url', image_url: { url: resolveOutfitImage(o) } });
                    }
                });

                // 注入图片提示词模板（风格引导）
                var prompt = hasMulti ? multiImgPrompt : imgPrompt;
                if (prompt) {
                    c.push({ type: 'text', text: '\n' + prompt });
                }

                if (ownerImageGroups.length > 1) {
                    c.push({ type: 'text', text: '\n=== 穿搭图片结束 ===' });
                }
                break;
            }
        }
    }

    function setupInjection() {
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
            try {
                if (init && init.body && typeof init.body === 'string') {
                    var nb = tryInjectBody(init.body);
                    if (nb) { init = Object.assign({}, init, { body: nb }); return origFetch.call(this, input, init); }
                }
            } catch (e) {}
            return origFetch.apply(this, arguments);
        };
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
            try { if (body && typeof body === 'string') { var nb = tryInjectBody(body); if (nb) return origSend.call(this, nb); } } catch (e) {}
            return origSend.apply(this, arguments);
        };
    }

    function tryInjectBody(bodyStr) {
        var p; try { p = JSON.parse(bodyStr); } catch (e) { return null; }
        if (!p || (!p.messages && p.prompt === undefined)) return null;
        var d = load();
        var pos = d.injectPosition || 'user';
        var useImg = (d.mode === 'image' || d.mode === 'both');
        var useText = (d.mode === 'text' || d.mode === 'both');

        // 收集所有owner及其激活穿搭
        var owners = [];
        // User
        var userOutfits = [];
        (d.activeIds || []).forEach(function (id) { var found = false; for (var i = 0; i < d.outfits.length; i++) { if (d.outfits[i].id === id) { userOutfits.push(d.outfits[i]); found = true; break; } } if (!found && d.virtualOutfits && d.virtualOutfits[id]) { var vo = d.virtualOutfits[id]; vo.id = id; userOutfits.push(vo); } });
        if (userOutfits.length > 0) owners.push({ name: 'User', outfits: userOutfits, tplSingle: d.singleTemplate, tplMulti: d.multiTemplate });
        // Chars
        if (d.chars) {
            for (var cn in d.chars) {
                var cd = d.chars[cn];
                var cos = [];
                (cd.activeIds || []).forEach(function (id) { for (var k = 0; k < (cd.outfits || []).length; k++) { if (cd.outfits[k].id === id) { cos.push(cd.outfits[k]); break; } } });
                if (cos.length > 0) owners.push({ name: cn, outfits: cos, tplSingle: d.charSingleTemplate, tplMulti: d.charMultiTemplate });
            }
        }

        if (owners.length === 0) return null;


        // ★ v19核心改动：先收集所有文本和图片，合并成一条再注入
        var allTextParts = [];
        // 图片模式：按owner收集，保留归属信息
        var ownerImageGroups = []; // [{ name, outfits: [{name, imageData, sceneTag}], isMulti }]

        owners.forEach(function (ow) {
            var active = ow.outfits;
            var isMulti = active.length > 1;

            if (isMulti) {
                var lines = active.map(function (o, i) {
                    var scene = o.sceneTag ? '【场景：' + o.sceneTag + '】' : '';
                    var desc = (o.description && o.description.trim()) ? o.description.trim() : o.name;
                    return '[' + (i + 1) + '] ' + o.name + ' ' + scene + '\n描述：' + desc;
                });
                if (useText) {
                    var wt = (ow.tplMulti || '[服装信息]\n{{charName}}的穿搭：\n{{wardrobe}}')
                        .replace(/\{\{charName\}\}/g, ow.name)
                        .replace('{{wardrobe}}', lines.join('\n\n'));
                    allTextParts.push(wt);
                }
                if (useImg) {
                    var imgOutfits = active.filter(function (o) { return hasInjectableOutfitImage(o); });
                    if (imgOutfits.length > 0) ownerImageGroups.push({ name: ow.name, outfits: imgOutfits, isMulti: true });
                }
            } else {
                var o = active[0];
                if (useText) {
                    var desc2 = (o.description && o.description.trim()) ? o.description.trim() : o.name;
                    var st = (ow.tplSingle || '[服装信息]\n{{charName}}当前穿着：\n{{description}}')
                        .replace(/\{\{charName\}\}/g, ow.name)
                        .replace('{{description}}', desc2);
                    allTextParts.push(st);
                }
                if (useImg && hasInjectableOutfitImage(o)) { ownerImageGroups.push({ name: ow.name, outfits: [o], isMulti: false }); }
            }
        });

        var injected = false;

        // 合并所有文本为一条，用分隔线隔开
        if (allTextParts.length > 0) {
            var mergedText;
            if (allTextParts.length === 1) {
                mergedText = allTextParts[0];
            } else {
                // 多个owner时加总包裹
                mergedText = '=== 当前服装状态参考 ===\n\n' + allTextParts.join('\n\n---\n\n') + '\n\n=== 服装状态参考结束 ===';
            }
            injectText(p, mergedText, pos);
            injected = true;
        }

        // ★ 图片注入：按owner交错注入文字标签+图片，让AI知道哪张图属于谁
        if (ownerImageGroups.length > 0) {
            var imgPrompt = d.imagePrompt || '';
            var multiImgPrompt = d.multiImagePrompt || '';
            injectImageBlocks(p, ownerImageGroups, imgPrompt, multiImgPrompt);
            injected = true;
        }

        if (d.debug) {
            var summary = owners.map(function (ow) { return ow.name + ':' + ow.outfits.length + '套'; }).join(' + ');
            toast('👗 ' + summary + ' [' + d.mode + '|' + pos + ']');
        }

        var finalStr = JSON.stringify(p); return finalStr;
    }

    // ── 侧栏按钮 ──────────────────────────────────────────────
    function updateBtn() {
        var btn = document.getElementById(BTN_ID); if (!btn) return;
        var d = load();
        var names = []; d.activeIds.forEach(function (id) { var o = getById(d, id); if (o) names.push(o.name); });
        var span = btn.querySelector('span');
        if (span) {
            if (names.length === 0) span.textContent = SCRIPT_NAME;
            else if (names.length === 1) span.textContent = names[0];
            else span.textContent = '衣柜(' + names.length + '套)';
        }
        btn.style.color = names.length > 0 ? 'var(--SmartThemeQuoteColor)' : '';
    }

    function findMenu() {
        var m = document.getElementById('extensionsMenu'); if (m) return m;
        m = document.getElementById('extensions_menu'); if (m) return m;
        var items = document.querySelectorAll('.list-group-item.interactable');
        for (var i = 0; i < items.length; i++) { var t = items[i].textContent || ''; if (t.indexOf('CSS') !== -1 || t.indexOf('头像框') !== -1 || t.indexOf('变量管理') !== -1) return items[i].parentElement; }
        return null;
    }

    function injectBtn() {
        if (document.getElementById(BTN_ID)) return;
        var menu = findMenu(); if (!menu) return;
        var d = load(); var names = []; d.activeIds.forEach(function (id) { var o = getById(d, id); if (o) names.push(o.name); });
        var btn = document.createElement('div');
        btn.id = BTN_ID; btn.className = 'list-group-item flex-container flexGap5 interactable'; btn.title = SCRIPT_NAME;
        if (names.length > 0) btn.style.color = 'var(--SmartThemeQuoteColor)';
        btn.innerHTML = '<i class="fa-solid fa-shirt"></i><span>' + esc(names.length === 1 ? names[0] : names.length > 1 ? '衣柜(' + names.length + '套)' : SCRIPT_NAME) + '</span>';
        btn.addEventListener('click', openPopup);
        menu.appendChild(btn);
    }

    // ── 启动 ──────────────────────────────────────────────────
    injectStyles();
    setupInjection();
    setTimeout(injectBtn, 500);
    setInterval(injectBtn, 2000);
    setTimeout(injectFab, 1500);
    setInterval(function () { if (!document.getElementById(FAB_ID)) injectFab(); }, 3000);

    loadFromDB(function (d) {
        try { console.log('[OM] v' + OM_VERSION + ' 已加载 - 世界书随机池修复已启用'); } catch (e) {}
        var finishStartup = function () {
            dataCache = d;
            if (d.useMainApi !== false) autoDetectApiConfig(d);
            var lsData = loadFromLS();
            if (lsData && lsData.outfits && lsData.outfits.length > 0 && (!d.outfits || d.outfits.length === 0)) {
                dataCache = ensureDefaults(lsData);
                saveToDB(dataCache, function () { try { localStorage.removeItem('outfit_mgr_v4'); } catch (e) {} });
            }
            updateBtn();
        };
        // Auto-roll: if nothing active, pick from selected world books after they are loaded.
        var startupCtx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        var startupWorldBooks = getSelectedWorldBookNames(startupCtx, d);
        if (d.worldBookSelectionInitialized === false && startupWorldBooks.length > 0) {
            d.selectedWorldBookNames = startupWorldBooks.slice();
            d.worldBookSelectionInitialized = true;
            save(d);
        }
        var hasExistingData = (d.virtualOutfits && Object.keys(d.virtualOutfits).length > 0) || (d.outfits && d.outfits.length > 0);
        if ((!d.activeIds || d.activeIds.length === 0) && !d.autoRollDisabled && startupWorldBooks.length > 0 && !hasExistingData) {
            refreshWorldBookStyles(startupWorldBooks, function () {
                var allWB = getWorldBookStyles(startupWorldBooks);
                if (allWB.length > 0) {
                    var pick = allWB[Math.floor(Math.random() * allWB.length)];
                    var o = createWorldBookOutfit(pick, 'wb_startup', Date.now());
                    o.id = genId();
                    o.createdAt = Date.now();
                    d.virtualOutfits[o.id] = o;
                    d.activeIds = [o.id];
                    save(d);
                    if (typeof toast !== 'undefined') setTimeout(function() { toast('今日穿搭：「' + pick.name + '」（' + (pick.style || '') + '·' + (pick.scene || '') + '）', false, 4000); }, 3500);
                }
                finishStartup();
            });
            return;
        } else if (d.activeIds && d.activeIds.length > 0) {
            // Show existing active outfit on restart
            var names = [];
            d.activeIds.forEach(function (id) {
                var o = getById(d, id);
                if (o) names.push(o.name);
            });
            if (names.length > 0 && typeof toast !== 'undefined') setTimeout(function() { toast('今日穿搭：「' + names.join('、') + '」', false, 4000); }, 3500);
        }
        finishStartup();
        updateBtn();
        if (startupWorldBooks.length > 0) {
            setTimeout(function () { refreshWorldBookStyles(startupWorldBooks); }, 0);
        }
    });

})();
