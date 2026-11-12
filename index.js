// Tavvy — a tiny companion that lives in your SillyTavern chat room.
// Stage 1: data skeleton & safety rails.
// Stage 2: bed button, life on the floor (breathe / walk / doze), dangling, falling.
// Stage 3: the whole chat is the stage — message ledges, riding them, climbing up, hopping off the
//          end, falling back in from the top, line borders as ledges, waiting for / watching
//          replies, and a little reaction when you send a message.
// Stage 4: food — new messages fill the bowl, sparkles fly in and get eaten, four meal sizes,
//          a nap after a big meal, being full, a number on the bed, daily backups.
// Stage 5: closeness — growing closer by eating and being patted, hearts, looking at you,
//          the reunion when woken (by personality), "it's been N days" by the bed,
//          a little party when closeness goes up, and a journal per pet.
// Stage 6-1: a pet info window (journal + edit), and new things it learns as you grow closer —
//          peeking at the input box, following your hand, leaning into a pat, a wiggling bed,
//          liking your messages, not wanting to go to bed, dozing off while you're away,
//          pressing against the screen, softer reactions, and little gifts.

import { saveSettings, saveSettingsDebounced, getRequestHeaders, eventSource, event_types } from '../../../../script.js';

const MODULE = 'tavvy';
const FORMAT_VERSION = 1;
const BASE = new URL('.', import.meta.url).href;
const log = (...a) => console.log('[Tavvy]', ...a);
const ctx = () => SillyTavern.getContext();

/* =====================================================================
 * Constants
 * ===================================================================== */

// climb: chance to hop up onto a message on its own (closeness 0 → 100), per "what next?" moment
// perch: how long it sits after climbing ('doze' = falls asleep up there)
// land:  reaction after falling back in from the top of the screen
// send:  reaction when you send a message ('glance' = look, then turn away)
// bump:  reaction after bumping into another pet ('flick' = turn away, 'aside' = "…" and step aside)
// me:    chance to stop and react to you (the person in front of the screen), closeness 0 → 100
//        (used × ME_SCALE when it decides by itself)
// eat:   meal speed after waking (< 1 = gobbles it up, > 1 = slowly)
// fussy: dislikes rapid taps (💢, closeness is never lost)
const PERSONALITIES = {
    aegyo:   { name: '애교', speed: 72, idle: [1.5, 3.5], doze: 0.06, dozeLen: [3, 6],  tap: '♥',  climb: [0.16, 0.24], perch: [2, 5],   land: '♥',  send: '♥',  bump: '♥',     me: [0.60, 0.95], eat: 0.7 },
    saechim: { name: '새침', speed: 55, idle: [2, 5],     doze: 0.10, dozeLen: [3, 7],  tap: '?',  climb: [0.07, 0.12], perch: [2, 5],   land: 'flick', send: 'glance', bump: 'flick', me: [0.15, 0.60], eat: 1, fussy: true },
    neugut:  { name: '느긋', speed: 30, idle: [3, 6],     doze: 0.35, dozeLen: [6, 14], tap: '♪',  climb: [0.02, 0.04], perch: 'doze',   land: '하암', send: '♪',  bump: '?',     me: [0.15, 0.50], eat: 1.3 },
    simsul:  { name: '심술', speed: 58, idle: [2, 4.5],   doze: 0.08, dozeLen: [3, 6],  tap: '💢', climb: [0.07, 0.12], perch: [2, 5],   land: '💢', send: '흥',  bump: '💢',    me: [0.20, 0.60], eat: 1, fussy: true },
    musim:   { name: '무심', speed: 42, idle: [3, 7],     doze: 0.12, dozeLen: [4, 9],  tap: '…',  climb: [0.08, 0.14], perch: [8, 16],  land: '…',  send: '…',  bump: 'aside', me: [0.05, 0.25], eat: 1 },
};

// Built-in pets (original characters made for this project).
// baseline = transparent rows under the feet in the source image (source px).
const BUILTIN = {
    kongtteok: {
        name: '콩떡', facing: 'front', baseline: 2,
        roles: {
            idle: ['idle.png'], sleep: ['sleep.png'], happy: ['happy.png'],
            walk: ['walk1.png', 'walk2.png'], cry: ['cry.png'], surprise: ['surprise.png'],
            eat: ['eat1.png', 'eat2.png'],
        },
    },
    bori: {
        name: '보리', facing: 'right', baseline: 4,
        roles: {
            idle: ['idle.png'], sleep: ['sleep.png'], happy: ['happy.png'],
            walk: ['walk1.png', 'walk2.png'], cry: ['cry.png'], surprise: ['surprise.png'],
            eat: ['eat1.png', 'eat2.png'], sit: ['sit.png'],
        },
    },
    danchu: {
        name: '단추', facing: 'front', baseline: 2,
        roles: {
            idle: ['idle.png'], sleep: ['sleep.png'], happy: ['happy.png'],
            walk: ['walk1.png', 'walk2.png'], cry: ['cry.png'], surprise: ['surprise.png'],
            eat: ['eat1.png', 'eat2.png'],
        },
    },
};

const DEFAULT_SIZE = { phone: 64, pc: 96 };
const PHONE_MAX_WIDTH = 1000;   // same breakpoint SillyTavern uses for its mobile layout
const GRAVITY = 1900;           // px/s² (a bit floaty)
const MAX_FALL = 620;           // px/s — falls ease into this speed (plush toy, not a brick)
const SIZE_MIN = 32, SIZE_MAX = 192;   // px — per-pet size slider
const HOLD_SWING_MAX = 15;      // degrees
const DRAG_THRESHOLD = 8;       // px — bed button: tap vs drag
const PICK_THRESHOLD = 6;       // px — pet: tap vs pick up
const PICK_DELAY = 220;         // ms — press and hold also picks up
const CLIMB_MAX = 5;            // × pet height — highest ledge it can hop up to
const OFF_DELAY = [1.2, 2.6];   // s — gone with a ledge that left the top of the screen, then falls back in
const EDGE_CHANCE = 0.2;        // on a ledge: chance a walk goes to the end (then hops / drops off)
const WATCH_MIN_CHARS = 150;    // a reply this long is worth climbing up to look at
const LONG_WAIT = 20;           // s — a reply taking this long makes everyone glance at the chat more ("?")
const BUMP_DIST = 0.42;         // × (sum of both widths) — how close two pets get before they bump
const BUMP_CHANCE = 0.05;       // the rest just walk past each other
const BUMP_REST = 300;          // seconds — after a bump, the same two pets just pass each other for this long

// food (stage 4)
const COUNT_TYPES = ['normal', 'command', '', undefined];   // new replies / command messages count; regenerate, swipe, continue… don't
const MEAL_TIERS = [            // by number of messages waiting in the bowl
    { key: 'snack', min: 1 },   // 간식
    { key: 'meal', min: 10 },   // 한 끼
    { key: 'bowl', min: 50 },   // 고봉밥
    { key: 'feast', min: 200 }, // 잔칫상
];
const FULL_AT = 100;            // messages eaten in one day → full (resets at 6 a.m.)
const DAY_START_H = 6;          // the day changes at 6 a.m.
const SPARK_MAX = 40;           // sparkles in one meal at most
const SPARK_CHARS = 12;         // a message gives one sparkle per this many characters (2 … 14)
const BACKUP_KEEP = 7;          // daily backups kept on the server

// closeness (stage 5): points = messages eaten (mine + theirs) + pat points.
// The thresholds sit at closeness 0 / 25 / 50 / 75 / 100, straight lines in between. Never saved — always worked out.
const LEVELS = [
    { name: '처음', min: 0,   hearts: '♡' },
    { name: '관심', min: 30,  hearts: '♥' },
    { name: '친구', min: 100, hearts: '♥♥' },
    { name: '단짝', min: 220, hearts: '♥♥♥' },
    { name: '내편', min: 400, hearts: '♥♥♥♥' },
];
const CLOSE = 50;               // closeness from which "친하면" reactions show (friends)
const ME_SCALE = 0.5;           // "react to you" chance × this when it decides by itself
const ME_REST = 6;              // s — not twice in a row within this
const RAPID_TAPS = 3, RAPID_WINDOW = 1.5;   // this many taps within this many seconds = 연타
const REVISIT_DAYS = 3;         // away this long → a little bubble by the bed
const TEARY_DAYS = 7, TEARY_CLOSE = 60;     // away this long and this close → teary when it sees you
const RECENT_H = 12;            // woken again within this many hours = "just saw you"
const REVISIT_LINES = {
    aegyo:   (n) => `${n}일이나 기다렸어…! 보고 싶었어 ♥`,
    saechim: (n) => `…${n}일 만이네. 딱히 기다린 건 아니야.`,
    neugut:  (n) => `하암… 벌써 ${n}일 지났어?`,
    simsul:  (n) => `${n}일이나 어디 갔었어 💢`,
    musim:   (n) => `…${n}일.`,
};

// unlocked behaviours (stage 6-1). lv = closeness level needed (1 관심 · 2 친구 · 3 단짝 · 4 내편).
// only / not = personality. Never saved — worked out from the level every time.
const UNLOCKS = [
    { key: 'peekInput', lv: 1, name: '입력창 기웃' },
    { key: 'follow',    lv: 1, name: '손 따라 보기' },
    { key: 'lean',      lv: 1, name: '쓰다듬기에 기대기' },
    { key: 'bedWiggle', lv: 2, name: '침대 들썩' },
    { key: 'myBubble',  lv: 2, name: '내 말풍선 좋아하기' },
    { key: 'resist',    lv: 3, name: '배웅 투정' },
    { key: 'dozeWait',  lv: 3, name: '기다리다 졸기' },
    { key: 'press',     lv: 4, name: '화면에 붙기' },
    { key: 'soft',      lv: 4, name: '마음이 풀린 반응', not: 'aegyo' },
    { key: 'gift',      lv: 4, name: '선물 주기', only: 'aegyo' },
];
const PEEKIN_CHANCE = 0.6;      // starting to write → peeks at the input box
const PEEKIN_AGAIN = 0.3;       // still writing → now and then again
const PEEKIN_GAP = [8, 14];     // s between peeks while writing
const TYPING_GAP = 4;           // s without typing → the next keystroke is "starting to write"
const FOLLOW_NEAR = 2.2;        // × pet height (at least 110px) — how close your hand / finger must come
const FOLLOW_CHANCE = 0.5;      // hand comes near → looks at it
const FOLLOW_REST = [6, 12];    // s after looking before it does it again
const FOLLOW_STEP = 0.3;        // takes a step or two toward it (심술; 애교 0.5; 새침·느긋·무심 only look)
const LEAN_CHANCE = 0.7;        // a pat → leans into it (otherwise the little hop)
const WIGGLE_GAP = [4, 9];      // s — the bed wiggles while food piles up
const MY_BUBBLE = 0.65;         // climbing up by itself → picks one of your messages
const RESIST_CHANCE = 0.6;      // put to bed → digs its feet in for a second
const IDLE_DOZE = 90;           // s with nothing from you → climbs onto your last message and nods off
const IDLE_DOZE_CHANCE = 0.75;
const PRESS_CHANCE = 0.4;       // reacting to you → presses against the screen
const PRESS_SCALE = 1.5, PRESS_HOLD = 2.4;
const PRESS_HOLD_BY = { aegyo: 1.4, saechim: 0.6, neugut: 1.5, simsul: 1, musim: 0.9 };
const BONK_CHANCE = 0.2;        // hits the glass too hard → dizzy, cries a little
const TEAR_COLOR = '#6fc3ff', TEAR_ANGLE = 30;   // degrees (0 = sideways)
const GIFT_CHANCE = 0.25;       // 애교 only, when reacting to you
const GIFTS = ['🌼', '🍀', '🍬', '⭐', '🎁'];

/* =====================================================================
 * Storage (format version + safety rails)
 * ===================================================================== */

let root = null;          // our settings object
let attached = false;     // is `root` inside extensionSettings yet?
let readOnly = false;     // true → never write (bad/newer data found)
let readOnlyReason = '';
let ready = false;        // true after SillyTavern says the app is ready

function defaultSettings() {
    return {
        autoWake: false,                       // wake pets automatically when entering a room
        bedPos: { phone: null, pc: null },     // floating bed button position per device
        stageMode: 'chat',                     // 'chat' = whole chat (messages are ledges) / 'floor' = floor only
        lineLedges: true,                      // flat / document chat style: borders between messages are ledges
        badge: true,                           // number of waiting messages on the bed
        heartMode: 'both',                     // closeness shown as 'both' (♥♥ 친구) / 'hearts' / 'name' / 'hide'
        backup: { lastDay: null, files: [] },  // daily backups: [{ day, path, pets }]
    };
}

function newRoot() {
    return { formatVersion: FORMAT_VERSION, settings: defaultSettings(), pets: [] };
}

function newPetRecord({ id, name, personality, look }) {
    const now = Date.now();
    return {
        id,
        name,
        createdAt: now,
        look,                                         // images, facing, size, softness
        personality: { base: personality, traits: [] },
        lines: [],                                    // optional speech lines
        dates: [],                                    // special days
        sounds: {},                                   // per-moment sound files (empty = default)
        home: null,                                   // { chatId, integrity } or null = homeless
        bowl: { me: 0, them: 0, tokens: 0 },          // food waiting
        eaten: { me: 0, them: 0, tokens: 0 },         // lifetime eaten
        pats: { score: 0, lastDay: null },
        today: { day: null, eaten: 0, full: false },
        lastVisit: now,
        journal: { talkDays: 0, lastTalkDay: null, moments: [] },
    };
}

// Fill in missing keys without ever removing unknown ones.
function fillDefaults(target, defaults) {
    for (const [k, v] of Object.entries(defaults)) {
        if (target[k] === undefined) {
            target[k] = structuredClone(v);
        } else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
            fillDefaults(target[k], v);
        }
    }
}

function migrate(r) {
    fillDefaults(r.settings ??= {}, defaultSettings());
    for (const p of r.pets) {
        if (!p || typeof p !== 'object') continue;
        const blank = newPetRecord({ id: p.id, name: p.name, personality: 'aegyo', look: {} });
        delete blank.createdAt; delete blank.lastVisit; delete blank.home;
        fillDefaults(p, blank);
        p.look ??= {};
        fillDefaults(p.look, { kind: 'single', facing: 'front', roles: {}, baseline: 0, size: DEFAULT_SIZE, squish: 0.5 });
    }
    // future: if (r.formatVersion < 2) { ...; r.formatVersion = 2; }
}

function loadRoot() {
    const es = ctx().extensionSettings;
    const cur = es[MODULE];
    if (cur === undefined) {
        // Nothing saved yet. Keep it in memory only until the user actually creates something.
        root = newRoot();
        attached = false;
        return;
    }
    const valid = cur && typeof cur === 'object' && Array.isArray(cur.pets) && typeof cur.formatVersion === 'number';
    if (!valid) {
        readOnly = true;
        readOnlyReason = '저장된 Tavvy 기록의 모양이 이상해서, 덮어쓰지 않도록 저장을 멈췄어요.';
        root = newRoot();
        attached = false;
        return;
    }
    if (cur.formatVersion > FORMAT_VERSION) {
        readOnly = true;
        readOnlyReason = '더 새로운 버전의 Tavvy가 저장한 기록이에요. 기록을 지키려고 저장을 멈췄어요. 확장을 업데이트해 주세요.';
        root = structuredClone(cur);       // work on a copy so nothing leaks into saved settings
        attached = false;
        migrate(root);
        return;
    }
    root = cur;
    attached = true;
    migrate(root);
}

function canSave() {
    return ready && !readOnly;
}

function attach() {
    if (attached || readOnly) return;
    const es = ctx().extensionSettings;
    if (es[MODULE] !== undefined) {
        // Something appeared meanwhile — never overwrite it.
        readOnly = true;
        readOnlyReason = 'Tavvy 기록을 다시 확인해야 해요. 페이지를 새로고침해 주세요.';
        return;
    }
    es[MODULE] = root;
    attached = true;
}

/** Batched save (ordinary changes). */
function saveSoon() {
    if (!canSave()) return;
    attach();
    if (readOnly) return;
    saveSettingsDebounced();
}

/** Immediate save (important moments: create / delete / move home). */
async function saveNow() {
    if (!canSave()) return false;
    attach();
    if (readOnly) return false;
    try {
        await saveSettings();
        return true;
    } catch (e) {
        console.error('[Tavvy] save failed', e);
        return false;
    }
}

/* =====================================================================
 * Rooms & homes
 * ===================================================================== */

let room = null;  // { chatId, integrity, branch }
const prevVisit = new Map();   // pet id → last visit before entering (runtime only, used later for greetings)

function readRoom() {
    const c = ctx();
    const chatId = typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() : c.chatId;
    if (!chatId) return null;
    const md = c.chatMetadata || {};
    return { chatId: String(chatId), integrity: md.integrity ? String(md.integrity) : '', branch: !!md.main_chat };
}

/**
 * Does this pet live in room `r`? May repair the address (rename / new integrity).
 * Returns true/false and whether the record changed.
 */
function checkHome(pet, r) {
    const h = pet.home;
    if (!h || !r) return { here: false, changed: false };
    const sameI = !!h.integrity && !!r.integrity && h.integrity === r.integrity;
    const sameN = h.chatId === r.chatId;
    if (sameI && sameN) return { here: true, changed: false };
    if (sameI && !sameN) {
        if (r.branch) return { here: false, changed: false };    // a branch — don't follow automatically
        h.chatId = r.chatId;                                      // the chat was renamed
        return { here: true, changed: true };
    }
    if (sameN) {
        if (r.integrity && h.integrity !== r.integrity) {
            h.integrity = r.integrity;
            return { here: true, changed: true };
        }
        return { here: true, changed: false };
    }
    return { here: false, changed: false };
}

function residents() {
    if (!room || !root) return [];
    return root.pets.filter(p => p.home && checkHome(p, room).here);
}

/* =====================================================================
 * Images
 * ===================================================================== */

function imgUrl(path) {
    if (!path) return '';
    if (path.startsWith('builtin:')) return BASE + 'assets/pets/' + path.slice(8);
    if (/^(https?:|data:|\/)/.test(path)) return path;
    return '/' + path;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('image load failed: ' + src));
        im.src = src;
    });
}

function builtinLook(key) {
    const b = BUILTIN[key];
    const roles = {};
    for (const [role, files] of Object.entries(b.roles)) roles[role] = files.map(f => `builtin:${key}/${f}`);
    return { kind: b.roles.walk?.length > 1 ? 'frames' : 'single', facing: b.facing, roles, baseline: b.baseline, size: { ...DEFAULT_SIZE }, squish: 0.5 };
}

/** Read a user PNG, optionally crop transparent margins, limit size. Returns { base64, w, h }. */
async function preparePng(file, crop) {
    const url = URL.createObjectURL(file);
    try {
        const im = await loadImage(url);
        let sx = 0, sy = 0, sw = im.naturalWidth, sh = im.naturalHeight;
        const cv = document.createElement('canvas');
        cv.width = sw; cv.height = sh;
        const g = cv.getContext('2d');
        g.drawImage(im, 0, 0);
        if (crop) {
            const d = g.getImageData(0, 0, sw, sh).data;
            let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
            for (let y = 0; y < sh; y++) {
                for (let x = 0; x < sw; x++) {
                    if (d[(y * sw + x) * 4 + 3] > 8) {
                        if (x < x0) x0 = x; if (x > x1) x1 = x;
                        if (y < y0) y0 = y; if (y > y1) y1 = y;
                    }
                }
            }
            if (x1 >= 0) { sx = x0; sy = y0; sw = x1 - x0 + 1; sh = y1 - y0 + 1; }
        }
        const MAX = 384;
        const k = Math.min(1, MAX / Math.max(sw, sh));
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(sw * k));
        out.height = Math.max(1, Math.round(sh * k));
        const og = out.getContext('2d');
        og.imageSmoothingEnabled = k < 1;
        og.drawImage(cv, sx, sy, sw, sh, 0, 0, out.width, out.height);
        const dataUrl = out.toDataURL('image/png');
        return { base64: dataUrl.split(',')[1], dataUrl, w: out.width, h: out.height };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function uploadFile(name, base64) {
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name, data: base64 }),
    });
    if (!res.ok) throw new Error('upload failed: ' + res.status);
    const j = await res.json();
    if (!j.path) throw new Error('upload returned no path');
    return j.path;
}

async function deleteFile(path) {
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
    } catch (e) {
        console.warn('[Tavvy] could not delete file', path, e);
    }
}

function petFiles(pet) {
    const out = [];
    for (const list of Object.values(pet.look?.roles || {})) {
        for (const p of list || []) if (p && !p.startsWith('builtin:')) out.push(p);
    }
    for (const p of Object.values(pet.sounds || {})) if (typeof p === 'string') out.push(p);
    return out;
}

/* =====================================================================
 * Stage geometry
 * ===================================================================== */

const isPhone = () => window.innerWidth <= PHONE_MAX_WIDTH;
const device = () => (isPhone() ? 'phone' : 'pc');
const stage = { floorY: 0, left: 0, right: 0, vw: 0, vh: 0, ox: 0, oy: 0, chatTop: 0 };

/* ---------- ledges (top edges of chat messages) ---------- */
// Measured on scroll / new messages / resize / every ~0.25s while awake — not every frame.
// A pet standing on one reads only its own ledge each frame, so it rides along smoothly.
const plats = [];   // { el, top, left, right, user }

const stageIsChat = () => root?.settings?.stageMode !== 'floor';
const isBubbleChat = () => document.body.classList.contains('bubblechat');
const ledgesOn = () => stageIsChat() && (isBubbleChat() || root?.settings?.lineLedges !== false);

function chatEl() { return document.getElementById('chat'); }

function measurePlats() {
    plats.length = 0;
    const chat = chatEl();
    if (!chat) { stage.chatTop = 0; return; }
    stage.chatTop = Math.max(0, chat.getBoundingClientRect().top);
    if (!ledgesOn()) return;
    const els = chat.querySelectorAll(':scope > .mes, .typing_indicator');
    for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        const r = el.getBoundingClientRect();
        if (r.height <= 0 || r.width < 40) continue;
        if (r.bottom < stage.chatTop) break;               // everything before this is above the view
        if (r.top < stage.chatTop || r.top > stage.floorY - 6) continue;
        plats.push({
            el, top: r.top,
            left: Math.max(r.left, stage.left), right: Math.min(r.right, stage.right),
            user: el.getAttribute('is_user') === 'true',
        });
    }
}

/** Live position of one ledge, or null if it is gone / hidden. */
function liveRect(el) {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0) return null;
    return r;
}

const platOf = (el) => plats.find(p => p.el === el) || null;

/* ---------- closeness (stage 5) ---------- */
const petPoints = (rec) => (rec?.eaten?.me || 0) + (rec?.eaten?.them || 0) + (rec?.pats?.score || 0);

function levelOf(rec) {
    const pts = petPoints(rec);
    let k = 0;
    LEVELS.forEach((l, i) => { if (pts >= l.min) k = i; });
    return k;
}

/** 0 … 100 */
function closenessOf(rec) {
    const k = levelOf(rec);
    if (k >= LEVELS.length - 1) return 100;
    const a = LEVELS[k].min, b = LEVELS[k + 1].min;
    return k * 25 + 25 * (petPoints(rec) - a) / (b - a);
}

/** Highest level already celebrated (kept as moments "level1" … "level4"). */
function celebratedLevel(rec) {
    let k = 0;
    for (const m of rec?.journal?.moments || []) {
        const r = /^level(\d)$/.exec(m?.kind || '');
        if (r) k = Math.max(k, Number(r[1]));
    }
    return k;
}

/** A chance that grows with this pet's closeness: lo at 0, hi at 100. */
const byCloseness = (who, lo, hi) => lo + (hi - lo) * closenessOf(who?.rec || who) / 100;

/** "♥♥ 친구" — as the 친밀도 표시 setting says. */
function levelLabel(rec, k = levelOf(rec)) {
    const L = LEVELS[k];
    const mode = root?.settings?.heartMode || 'both';
    if (mode === 'hearts') return L.hearts;
    if (mode === 'name') return L.name;
    if (mode === 'hide') return '';
    return `${L.hearts} ${L.name}`;
}

/** The unlockable behaviours that exist for this pet's personality. */
function unlocksFor(rec) {
    const k = rec?.personality?.base;
    return UNLOCKS.filter(u => (!u.only || u.only === k) && (!u.not || u.not !== k));
}

/** Has this pet (actor or record) learned behaviour `key`? */
function can(who, key) {
    const rec = who?.rec || who;
    const u = unlocksFor(rec).find(x => x.key === key);
    return !!u && levelOf(rec) >= u.lv;
}

/* ---------- you: typing, idle time, where your hand is ---------- */
const typing = { last: -1e9, session: 0 };
const hand = { x: 0, y: 0, t: -1e9 };
let lastAct = performance.now();

/** You did something (typed, sent, scrolled, touched a pet, tapped the bed). */
function noteUserAct() {
    lastAct = performance.now();
    for (const a of actors) a.idleTried = false;
}

/** Pat (tap): one point a day (the day starts at 6 a.m.). */
function patPet(rec) {
    const day = dayKey();
    rec.pats ??= { score: 0, lastDay: null };
    if (rec.pats.lastDay === day) return false;
    rec.pats.score = (rec.pats.score || 0) + 1;
    rec.pats.lastDay = day;
    saveSoon();
    return true;
}

/**
 * Where the overlay's (0,0) actually sits on screen. Normally (0,0), but on some phones the page
 * shifts (e.g. when the keyboard opens) and the overlay moves with it. Everything is drawn in
 * screen coordinates minus this offset.
 */
function measureOrigin() {
    if (!layer) return;
    const r = layer.getBoundingClientRect();
    stage.ox = r.left; stage.oy = r.top;
}

function measure() {
    const vv = window.visualViewport;
    const vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
    const vw = window.innerWidth;
    let floor = vh, left = 0, right = vw;
    const sf = document.getElementById('send_form');
    if (sf) {
        const r = sf.getBoundingClientRect();
        if (r.height > 0 && r.top > 0 && r.top <= vh + 1) {
            floor = r.top;
            if (r.width >= 120) { left = r.left; right = r.right; }
        }
    }
    stage.floorY = Math.min(floor, vh);
    stage.left = left; stage.right = right; stage.vw = vw; stage.vh = vh;
    measureOrigin();
    measurePlats();
    for (const a of actors) a.fitStage();
    placeBed();
}

/* =====================================================================
 * Layer, effects
 * ===================================================================== */

let layer = null;

function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = 'tavvy-layer';
    document.body.appendChild(layer);
    return layer;
}

function fx(actor, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'tavvy-fx ' + cls;
    el.textContent = text;
    const top = stage.floorY - actor.y - actor.h * actor.scale;
    el.style.left = (actor.x + (Math.random() - 0.5) * actor.w * 0.4 - stage.ox) + 'px';
    el.style.top = (top - stage.oy) + 'px';
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 2000);
}

/* =====================================================================
 * Pet actor (runtime only — nothing here is saved)
 * ===================================================================== */

const actors = [];
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function spring(o, key, vkey, target, k, z, dt) {
    const a = k * (target - o[key]) - 2 * Math.sqrt(k) * z * o[vkey];
    o[vkey] += a * dt;
    o[key] += o[vkey] * dt;
}

class Actor {
    constructor(rec) {
        this.rec = rec;
        this.p = PERSONALITIES[rec.personality?.base] || PERSONALITIES.aegyo;
        this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
        this.dir = 1;
        this.state = 'idle'; this.t = 0; this.until = rand(...this.p.idle);
        this.air = false; this.next = null;
        this.held = false;
        this.tilt = 0; this.tiltv = 0; this.tiltT = 0;
        this.sq = 1; this.sqv = 0;
        this.scale = 1;
        this.clock = Math.random() * 10;
        this.frameT = 0; this.frame = 0; this.walkPh = 0;
        this.fxT = 0;
        this.grab = { x: 0, y: 0 };
        this.ptr = { x: 0, y: 0, vx: 0, lastX: 0, lastT: 0 };
        this.w = 64; this.h = 64; this.natW = 64; this.natH = 64;
        this.curSrc = '';
        this.gone = false;
        this.plat = null;            // the message element it stands on (null = floor)
        this.pr = null;              // that ledge's live rect this frame
        this.sqT = 1;                // squish target (crouch / sit)
        this.edge = false;           // walking to the end of a ledge
        this.after = 'idle';         // state after a reaction / climb
        this.landReact = false;      // react when landing (fell back in from the top)
        this.look = null;            // { kind, x } for the 'look' state
        this.waiting = false;        // waiting for a reply (chosen when generation started)
        this.scanT = 0;
        this.tried = new WeakSet();  // ledges it couldn't reach while waiting
        this.restless = false;       // was picked up while waiting → goes on with its day, glancing "?" now and then
        this.bumpReact = false;      // react when landing after a bump
        this.bumpWith = null;        // the pet it bumped into
        this.passing = new Set();    // pets it decided to walk past (no bump until they part)
        this.bumpedAt = new Map();   // other pet → time of our last bump (rest time)
        this.food = 0;               // sparkles on their way to it
        this.eatT = 0;               // eating pose shown a moment after each sparkle (when not in 'eat')
        this.eatIdle = 0;            // 'eat' with nothing left coming → done after a beat
        this.mealPending = false;    // just woke up with food in the bowl → sniff, then eat
        this.meal = null;            // { post: 'nod' | 'feast' | null, big }
        this.afterMeal = null;       // a reply to climb up and look at once it has eaten
        this.fullNow = false;        // became full during this meal → nods off afterwards
        this.slowT = 0;              // s — walking slowly after a big meal
        this.spin = 0;               // deg — rolling over (full)
        this.reunion = null;         // { away, skip, long, teary } — the greeting after being woken
        this.gq = null; this.gi = 0; this.gfx = false;   // greeting steps / which one / its effect shown
        this.reunionMeal = false;    // this meal is the one right after waking (personality touches after it)
        this.taps = [];              // recent tap times (연타)
        this.lastMe = -1e9;          // last "react to you" (ms)
        this.peekInNext = 0;         // ms — no peeking at the input box again before this (while still writing)
        this.peekInSession = -1;     // 무심 peeks only once per bit of writing
        this.followNext = 0;         // ms — no looking at your hand again before this
        this.followedOnce = false;   // 무심 looks at your hand only the first time
        this.fstep = false;          // will take a step or two toward your hand
        this.leanD = 1;              // which way it leans into a pat
        this.pk = null;              // { d } — peeking at the input box
        this.big = null;             // { kind: 'press' | 'gift', … } — growing toward you
        this.glass = null;           // reflection / breath on the screen while pressed against it
        this.meHeart = false;        // 무심 (내편): a ♥ this time
        this.idleTried = false;      // already rolled for "dozing off while you're away" this quiet spell
        this.build();
    }

    build() {
        const el = document.createElement('div');
        el.className = 'tavvy-pet';
        const body = document.createElement('div');
        body.className = 'tavvy-body';
        const img = document.createElement('img');
        img.draggable = false;
        img.alt = '';
        body.appendChild(img);
        el.appendChild(body);
        this.el = el; this.body = body; this.img = img;
        this.bindPointer();
    }

    async load() {
        const first = this.rec.look?.roles?.idle?.[0];
        if (!first) throw new Error('pet has no base image');
        const im = await loadImage(imgUrl(first));
        this.natW = im.naturalWidth; this.natH = im.naturalHeight;
        // preload the rest quietly
        for (const list of Object.values(this.rec.look.roles)) for (const p of list) if (p !== first) loadImage(imgUrl(p)).catch(() => {});
        this.resize();
        ensureLayer().appendChild(this.el);
    }

    /** The picture was changed in the info window: measure the new one, keep everything else. */
    async reloadLook() {
        try {
            const im = await loadImage(imgUrl(this.rec.look.roles.idle[0]));
            if (this.gone) return;
            this.natW = im.naturalWidth; this.natH = im.naturalHeight;
            this.curSrc = '';
            this.frame = 0;
            this.fitStage();
        } catch (e) { console.warn('[Tavvy] could not load the new picture', e); }
    }

    resize() {
        const size = this.rec.look.size?.[device()] || DEFAULT_SIZE[device()];
        const m = Math.max(this.natW, this.natH) || 1;
        this.w = Math.round(size * this.natW / m);
        this.h = Math.round(size * this.natH / m);
        this.k = this.h / (this.natH || 1);                  // display px per source px
        this.basePx = (this.rec.look.baseline || 0) * this.k;
        this.el.style.width = this.w + 'px';
        this.el.style.height = this.h + 'px';
        this.el.classList.toggle('tavvy-pixel', Math.max(this.natW, this.natH) <= size);
    }

    fitStage() {
        this.resize();
        if (this.held || this.state === 'off') return;
        if (this.air) {
            const L = stage.left + this.w / 2, R = stage.right - this.w / 2;
            this.x = R > L ? clamp(this.x, L, R) : (stage.left + stage.right) / 2;
            return;
        }
        const [L, R] = this.range(this.state === 'edge' || (this.state === 'walk' && this.edge) ? 0.2 : 0.5);
        this.x = R > L ? clamp(this.x, L, R) : (L + R) / 2;
        if (this.state === 'walk') { const [l2, r2] = this.range(this.edge ? 0.2 : 0.5); this.tx = clamp(this.tx, l2, Math.max(l2, r2)); }
        if (!this.plat && this.y > stage.floorY - 4) this.y = Math.max(0, stage.floorY - this.h);   // keep on screen
    }

    /** Where its centre may go on what it stands on. inset = fraction of its width kept from each end. */
    range(inset = 0.5) {
        let l = stage.left, r = stage.right;
        if (this.plat && this.pr) { l = Math.max(l, this.pr.left); r = Math.min(r, this.pr.right); }
        return [l + this.w * inset, r - this.w * inset];
    }

    foot() { return stage.floorY - this.y; }   // screen y of its feet

    /** Free to react to things (not held, flying, hidden, leaving…). */
    free() {
        return !this.held && !this.air && !['off', 'tuck', 'wave', 'crouch', 'appear', 'greet', 'sniff', 'eat', 'nod', 'dance', 'roll', 'resist', 'press', 'gift', 'sleepy'].includes(this.state);
    }

    /** Can a sparkle reaching it be eaten right now? (dozing → piled beside it; held / flying → waits nearby) */
    canEat() {
        return !this.held && !this.air && !this.gone && EATABLE.includes(this.state);
    }

    isFull() {
        const t = rollToday(this.rec);
        return t.full || t.eaten >= FULL_AT;
    }

    /** A sparkle got eaten. */
    onAbsorb(big) {
        this.frame++;
        this.eatT = 0.35;
        this.sq = Math.min(this.sq, big ? 0.82 : 0.93);
    }

    /** Woke up, sniffed the air: everything in the bowl comes flying in. */
    startMeal() {
        this.mealPending = false;
        const take = takeBowl(this.rec);
        saveNow();
        refreshBed();
        renderPanel();
        if (!take.n) return this.setState('idle');
        const tier = mealTier(take.n);
        this.meal = { post: tier === 'feast' ? 'feast' : tier === 'bowl' ? 'nod' : null, big: false,
            nap: this.p.perch === 'doze' && (tier === 'bowl' || tier === 'feast') };   // 느긋: nods off halfway, then finishes
        this.reunionMeal = true;
        if (take.becameFull) this.fullNow = true;
        spawnMeal(this, take, tier, this.p.eat || 1);
        this.setState('eat');
    }

    /** Nothing left coming in. */
    finishMeal() {
        const m = this.meal;
        if (m?.post === 'feast' && !m.big) { m.big = true; spawnBig(this); this.eatIdle = 0; return; }   // the big one, last
        this.meal = null;
        if (m?.post) { this.after = m.post === 'feast' ? 'dance' : 'idle'; return this.setState('nod'); }
        this.mealDone();
    }

    /** After eating (and any nap / dance): closeness went up → a little party; full → doze off; a reply waiting → go look. */
    mealDone() {
        if (this.levelPending()) return this.startCheer();          // comes back here after the dance
        if (this.reunionMeal) { this.reunionMeal = false; if (this.afterReunionMeal()) return; }
        if (this.fullNow) { this.fullNow = false; fx(this, '♪', 'tavvy-fx-small'); return this.setState('doze'); }
        const el = this.afterMeal; this.afterMeal = null;
        this.setState('idle');
        if (el && el.isConnected && !this.waiting) this.watchReply(el);
    }

    /** The end of the first meal after waking, by personality. true = it set what happens next. */
    afterReunionMeal() {
        const k = this.rec.personality?.base;
        const mid = (stage.left + stage.right) / 2;
        if (k === 'saechim') {                                  // done eating → a sly look at you
            this.after = this.fullNow ? 'doze' : 'idle';
            this.fullNow = false;
            this.startLook('glance', mid);
            return true;
        }
        if (k === 'simsul') { fx(this, '♥'); return false; }    // softened up by the food
        if (k === 'musim') {
            if (closenessOf(this.rec) >= CLOSE && !this.fullNow) { this.setState('perch'); return true; }   // stays sitting there ("…")
            fx(this, '…');
        }
        return false;
    }

    levelPending() { return levelOf(this.rec) > celebratedLevel(this.rec); }

    /** Closeness went up: "친밀도 상승!", coloured ✦, a dance. Two levels at once → one party. */
    startCheer() {
        const from = celebratedLevel(this.rec), to = levelOf(this.rec);
        const day = dayKey();
        for (let k = from + 1; k <= to; k++) this.rec.journal.moments.push({ kind: `level${k}`, day });
        saveNow();
        renderPanel();
        showCheer(this, from, to);
        this.after = 'idle';
        this.setState('dance');
    }

    /** Stop and react to you (the person in front of the screen). */
    startMe() {
        const mid = (stage.left + stage.right) / 2;
        if (this.side && Math.abs(mid - this.x) > 8) this.dir = mid >= this.x ? 1 : -1;
        this.lastMe = performance.now();
        if (can(this, 'press') && Math.random() < PRESS_CHANCE) return this.startPress();   // 내편: up against the screen
        if (can(this, 'gift') && Math.random() < GIFT_CHANCE) return this.startGift();      // 내편 애교: a little present
        this.meHeart = Math.random() < 0.55;
        this.setState('me');
    }

    endMe() {
        const k = this.rec.personality?.base;
        if (k === 'neugut') return this.setState('doze');                     // ♪ … and nods off
        if (k === 'musim' && !can(this, 'soft') && this.stepAside((stage.left + stage.right) / 2)) return;   // "…" and backs off a few steps
        this.setState('idle');
    }

    /* ---------- 내편: pressing against the screen / a gift ---------- */

    startPress() {
        const k = this.rec.personality?.base;
        const bonk = Math.random() < BONK_CHANCE;
        this.setState('press');
        this.big = { kind: 'press', bonk, hold: bonk ? 1.7 : PRESS_HOLD * (PRESS_HOLD_BY[k] || 1), hit: false, n: 0, cryT: 0 };
        const g = document.createElement('div');
        g.className = 'tavvy-glass';
        this.body.appendChild(g);
        this.glass = g;
    }

    startGift() {
        this.setState('gift');
        this.big = { kind: 'gift', shown: false, item: GIFTS[Math.floor(Math.random() * GIFTS.length)] };
    }

    /**
     * One frame of pressing against the screen: grows toward you and a little down → bump on the
     * glass (wide and flat) → shine + breath on the glass → slowly back to normal size.
     * Sometimes (bonk) it hits too hard: stars, then a little cry while it shrinks back.
     */
    pressStep(dt, b) {
        const k = this.rec.personality?.base, d = this.side ? this.dir : 1;
        const GROW = 0.35, t = this.t;
        let pose = this.role('press', 'happy', 'idle'), bob = 0;
        if (t < GROW) {
            const f = t / GROW, e = 1 - (1 - f) * (1 - f);
            this.scale = 1 + (PRESS_SCALE - 1) * e;
            bob = -6 * e * this.k;                                   // a little down
            this.tiltT = 0;
            return { pose: this.role('look', 'idle'), bob };
        }
        bob = -6 * this.k;
        if (t < GROW + b.hold) {
            const s = t - GROW;
            this.scale = PRESS_SCALE;
            this.sqT = 0.87;                                         // squashed against the glass
            if (!b.hit) {
                b.hit = true;
                this.sq = b.bonk ? 0.6 : 0.78;
                this.glass?.classList.add('tavvy-glass-on');
                fx(this, b.bonk ? '쿵' : '톡', b.bonk ? '' : 'tavvy-fx-small');
            }
            if (b.bonk) {
                if (s < 0.8) {                                       // dizzy ★
                    this.tiltT = Math.sin(s * 9) * 8;
                    pose = this.role('surprise', 'idle');
                    if (b.n === 0 && s > 0.1) { b.n = 1; fx(this, '★', 'tavvy-fx-star'); }
                    if (b.n === 1 && s > 0.45) { b.n = 2; fx(this, '★', 'tavvy-fx-star'); }
                } else {                                             // ouch… 촥촥
                    this.tiltT = 0;
                    pose = this.role('cry', 'surprise', 'idle');
                    b.cryT -= dt;
                    if (b.cryT <= 0) { b.cryT = 0.5; tearBurst(this); }
                }
                return { pose, bob };
            }
            const every = (gap, i, fn) => { if (s > 0.15 + b.n * gap && b.n < i) { b.n++; fn(b.n); } };
            if (k === 'aegyo') {                                     // 톡톡 ♥, the longest
                pose = this.role('press', 'happy', 'idle');
                this.tiltT = Math.sin(s * 3) * 3;
                every(0.55, 99, (n) => fx(this, n % 2 ? '톡' : '♥', n % 2 ? 'tavvy-fx-small' : ''));
            } else if (k === 'saechim') {                            // a moment… 홱 + small ♥
                this.tiltT = s > b.hold * 0.55 ? -d * 9 : 0;
                if (b.n === 0 && s > b.hold * 0.75) { b.n = 1; fx(this, '♥', 'tavvy-fx-small'); }
            } else if (k === 'neugut') {                             // falls asleep stuck there
                pose = this.role('sleep', 'idle');
                this.tiltT = d * 4;
                every(1.2, 99, () => fx(this, 'Z', 'tavvy-fx-z'));
            } else if (k === 'simsul') {                             // 톡톡 쿵쿵 — then ♥, no 💢
                this.tiltT = 0;
                if (s < b.hold * 0.7) every(0.45, 99, (n) => fx(this, n % 2 ? '톡' : '쿵', 'tavvy-fx-small'));
                else if (b.n < 100) { b.n = 100; fx(this, '♥'); }
            } else {                                                 // 무심: "…" — and its first ♥
                this.tiltT = 0;
                if (b.n === 0 && s > 0.2) { b.n = 1; fx(this, '…'); }
                if (b.n === 1 && s > b.hold * 0.7) { b.n = 2; fx(this, '♥'); }
            }
            return { pose, bob };
        }
        // slowly back to normal size (crying all the way after a bonk)
        this.sqT = 1;
        this.tiltT = 0;
        this.glass?.classList.remove('tavvy-glass-on');
        if (b.bonk) {
            pose = this.role('cry', 'surprise', 'idle');
            b.cryT -= dt;
            if (b.cryT <= 0) { b.cryT = 0.5; tearBurst(this); }
        }
        this.scale += (1 - this.scale) * (1 - Math.exp(-dt * (b.bonk ? 1.8 : 3.5)));
        if (this.scale - 1 < 0.015) { this.scale = 1; this.setState('idle'); }
        return { pose, bob: bob * (this.scale - 1) / (PRESS_SCALE - 1) };
    }

    /** Leaving the press / gift: back to normal size, glass gone. */
    endBig() {
        this.big = null;
        if (this.glass) { this.glass.remove(); this.glass = null; }
        if (this.scale > 1) this.scale = 1;
    }

    /* ---------- 관심: the input box, your hand, a pat ---------- */

    /** You started writing (or are still at it): a peek at the input box. */
    startPeekIn() {
        const k = this.rec.personality?.base;
        const r = $id('send_textarea')?.getBoundingClientRect();
        const x = r && r.width > 0 ? (r.left + r.right) / 2 : (stage.left + stage.right) / 2;
        const d = Math.abs(x - this.x) < 30 ? (this.side ? this.dir : 1) : x > this.x ? 1 : -1;
        if (this.side) this.dir = d;
        if (k === 'saechim') { this.after = 'idle'; return this.startLook('glance', this.x + d * 40); }   // 힐끔 → 홱
        if (k === 'musim') { this.after = 'idle'; return this.startLook('…', this.x + d * 40); }        // one look, "…"
        if (this.state === 'doze') { fx(this, '!', 'tavvy-fx-small'); this.sq = 0.9; }                 // 느긋: wakes from a doze
        this.pk = { d };
        this.setState('peekin');
    }

    /** Your hand (mouse / finger) came near: worth a look? */
    wantsFollow() {
        if (!can(this, 'follow')) return false;
        const now = performance.now();
        if (now - hand.t > 250 || now < this.followNext) return false;
        const cy = this.foot() - this.h / 2;
        const near = Math.max(110, this.h * FOLLOW_NEAR);
        if (Math.hypot(hand.x - this.x, hand.y - cy) > near) return false;
        if (Math.abs(hand.x - this.x) < this.w / 2 && hand.y > this.foot() - this.h && hand.y < this.foot()) return false;   // on the pet itself (a pat)
        if (this.rec.personality?.base === 'musim' && this.followedOnce) return false;          // 무심: only the first time
        this.followNext = now + 3000;
        return Math.random() < FOLLOW_CHANCE;
    }

    startFollow() {
        const k = this.rec.personality?.base;
        this.followedOnce = true;
        this.fstep = Math.random() < (k === 'aegyo' ? 0.5 : k === 'simsul' ? FOLLOW_STEP : 0);   // 새침·느긋·무심 only look
        this.setState('follow');
    }

    /* ---------- 단짝: dozing off while you're away ---------- */

    /** Nothing from you for a while: up onto your last message, and nod off there. */
    startSleepy() {
        const p = plats.find(q => q.user);          // plats are listed newest first
        if (p && this.plat === p.el) return this.setState('sleepy');
        if (p && this.climbTo(p, 'sleepy')) return;
        this.setState('sleepy');
    }

    /** A few steps away from x. false if there is no room. */
    stepAside(ox) {
        const [L, R] = this.range();
        const away = ox >= this.x ? -1 : 1;
        const tx = clamp(this.x + away * rand(50, 90), L, Math.max(L, R));
        if (Math.abs(tx - this.x) <= 10) return false;
        this.dir = away; this.tx = tx; this.edge = false;
        this.setState('walk');
        return true;
    }

    /** Woken up: look around, spot you "!", greet you by personality — then the food. */
    startGreet() {
        const plan = this.reunion || {};
        this.reunion = null;
        const k = this.rec.personality?.base;
        const q = [];
        const greets = k !== 'musim' && !plan.skip;             // 무심 never greets; lots of food soon after → straight to it
        if (greets) q.push({ k: 'scan', d: 0.7 });
        if (greets || plan.teary) q.push({ k: 'found', d: 0.4 });
        if (plan.teary) q.push({ k: 'teary', d: 1.6 });          // so glad it is teary
        if (greets) {
            const g = { aegyo: [['wave', 0.7], ['bounce', 0.8]], saechim: [['flick', 1.0]], neugut: [['yawn', 1.1], ['wave', 0.7]], simsul: [['grumpy', 1.0]] }[k] || [];
            for (let r = 0; r < (plan.long ? 2 : 1); r++) for (const [kk, d] of g) q.push({ k: kk, d });   // long apart, little food → longer
        }
        if (!q.length) return this.afterGreet();
        const mid = (stage.left + stage.right) / 2;
        if (this.side && Math.abs(mid - this.x) > 8) this.dir = mid >= this.x ? 1 : -1;
        this.gq = q; this.gi = 0; this.gfx = false;
        this.setState('greet');
    }

    afterGreet() {
        this.gq = null;
        this.setState(this.mealPending ? 'sniff' : 'idle');
    }

    get side() { return this.rec.look.facing === 'left' || this.rec.look.facing === 'right'; }

    role(...names) {
        const roles = this.rec.look.roles || {};
        for (const n of names) if (roles[n]?.length) return roles[n];
        return roles.idle;
    }

    /* ---------- pointer: tap / pick up / dangle ---------- */
    bindPointer() {
        let down = null, timer = 0;
        const pick = (e) => {
            clearTimeout(timer);
            if (!down || this.held || ['tuck', 'wave', 'resist'].includes(this.state)) return;
            const left = this.x - this.w / 2;
            const top = stage.floorY - this.y - this.h;
            this.grab.x = clamp(down.x - left, 0, this.w);
            this.grab.y = clamp(down.y - top, 0, this.h);
            this.held = true; this.air = false; this.next = null;
            this.spin = 0;
            this.setState('held');
            this.ptr.x = e?.clientX ?? down.x; this.ptr.y = e?.clientY ?? down.y;
            this.ptr.lastX = this.ptr.x; this.ptr.lastT = performance.now(); this.ptr.vx = 0;
            this.body.style.transformOrigin = `${this.grab.x}px ${this.grab.y}px`;
            this.el.classList.add('tavvy-held');
            down.picked = true;
        };
        this.el.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            noteUserAct();
            if (down) return;                                   // one finger at a time — a second finger is ignored
            if (this.held) { this.release(); return; }          // held with no finger on it = stuck → a tap frees it
            try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            down = { id: e.pointerId, x: e.clientX, y: e.clientY, picked: false };
            timer = setTimeout(() => pick(null), PICK_DELAY);
        });
        this.el.addEventListener('pointermove', (e) => {
            if (!down || e.pointerId !== down.id) return;
            if (!down.picked && Math.hypot(e.clientX - down.x, e.clientY - down.y) > PICK_THRESHOLD) pick(e);
            if (this.held) {
                const now = performance.now();
                const dt = Math.max(1, now - this.ptr.lastT) / 1000;
                const v = (e.clientX - this.ptr.lastX) / dt;
                this.ptr.vx = this.ptr.vx * 0.6 + v * 0.4;
                this.ptr.lastX = e.clientX; this.ptr.lastT = now;
                this.ptr.x = e.clientX; this.ptr.y = e.clientY;
            }
        });
        const end = (e) => {
            if (!down || e.pointerId !== down.id) return;
            clearTimeout(timer);
            const wasPicked = down.picked;
            down = null;
            try { this.el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            if (wasPicked && this.held) this.release();
            else if (!wasPicked && e.type === 'pointerup') this.tap(e.clientX);
        };
        this.el.addEventListener('pointerup', end);
        this.el.addEventListener('pointercancel', end);
        this.el.addEventListener('lostpointercapture', end);   // finger lost without a pointerup → still let go
    }

    /** Tap = a pat: a little hop and a reaction. Counts once a day toward closeness. */
    tap(px) {
        if (['tuck', 'wave', 'resist', 'press', 'gift'].includes(this.state) || this.held) return;
        const now = performance.now();
        this.taps = this.taps.filter(t => now - t < RAPID_WINDOW * 1000);
        this.taps.push(now);
        const k = this.rec.personality?.base;
        const close = closenessOf(this.rec) >= CLOSE;
        const soft = can(this, 'soft');
        const rapid = this.p.fussy && this.taps.length >= RAPID_TAPS;
        // 관심: leans into the pat instead of the little hop (심술 that isn't close yet still backs off)
        const lean = !rapid && can(this, 'lean') && this.free() && !this.air && !(k === 'simsul' && !close) && Math.random() < LEAN_CHANCE;
        if (!lean && !this.air) { this.air = true; this.vy = 300; this.vx = 0; this.next = 'idle'; }
        if (rapid) return fx(this, '💢');   // 연타 싫어! (closeness is not lost)
        patPet(this.rec);
        if (lean) {
            this.leanD = px == null || Math.abs(px - this.x) < this.w * 0.12 ? (Math.random() < 0.5 ? -1 : 1) : px > this.x ? 1 : -1;
            this.setState('lean');
        }
        fx(this, k === 'simsul' && soft ? '♥' : this.p.tap);                                // 내편 심술: no 💢, just ♥
        const later = (fn) => setTimeout(() => { if (!this.gone && !this.held) fn(); }, 650);
        if (k === 'saechim' && close) later(() => fx(this, '♥', 'tavvy-fx-small'));      // 친하면 작은 ♥
        if (k === 'simsul' && !soft) {
            if (close) later(() => fx(this, '♥'));                                          // 💢 … then softens
            else later(() => { if (this.free() && !this.air) this.stepAside(this.x + (Math.random() < 0.5 ? -1 : 1)); });   // not close yet → moves away
        }
    }

    release() {
        this.held = false;
        this.el.classList.remove('tavvy-held');
        this.vx = 0; this.vy = 0;
        this.plat = null;
        if (this.waiting && gen.active) this.restless = true;   // put down mid-wait: no more waiting, but still curious
        this.waiting = false;
        if (this.y <= 0) { this.y = 0; this.land(0); }
        else { this.air = true; this.next = 'idle'; this.setState('fall'); }
    }

    land(impact) {
        this.air = false;
        this.leftPlat = null;
        this.vy = 0; this.vx = 0;
        this.body.style.transformOrigin = '';
        const soft = (this.rec.look.squish ?? 0.5) * 2;
        if (soft > 0) this.sq = 1 - Math.min(0.22, impact / 4200) * soft;
        // a big landing bounces once, lightly
        if (impact > 500) { this.air = true; this.plat = null; this.vy = impact * 0.18; return; }
        if (this.plat) this.pr = liveRect(this.plat);
        const n = this.next || 'idle';
        this.next = null;
        if (n === 'greet') return this.startGreet();
        if (this.landReact) {
            this.landReact = false;
            this.after = n;
            return this.startLook(this.p.land, this.x + this.dir * 40);
        }
        if (this.bumpReact) {
            this.bumpReact = false;
            const o = this.bumpWith; this.bumpWith = null;
            const ox = o && !o.gone ? o.x : this.x + this.dir * 40;
            if (this.p.bump === 'aside') {                // 무심: "…" and steps out of the way
                fx(this, '…');
                if (this.stepAside(ox)) return;
                return this.setState(n);
            }
            this.after = n;
            return this.startLook(this.p.bump, ox);
        }
        this.setState(n);
    }

    setState(s) {
        if (this.big && s !== this.state) this.endBig();
        this.state = s; this.t = 0;
        this.sqT = 1;
        if (s === 'idle') { this.until = rand(...this.p.idle); this.tiltT = 0; }
        if (s === 'doze') { this.until = rand(...this.p.dozeLen) * (this.isFull() ? 1.4 : 1); this.fxT = 0.6; }
        if (s === 'sniff') { this.fxT = 0; this.tiltT = 0; this.until = 0.75; }
        if (s === 'eat') { this.eatIdle = 0; this.tiltT = 0; if (this.side && this.eatFrom != null && Math.abs(this.eatFrom - this.x) > 8) this.dir = this.eatFrom > this.x ? 1 : -1; }
        if (s === 'nod') { this.until = 2.6; this.fxT = 0.5; }
        if (s === 'dance') { this.until = 1.9; this.fxT = 0; }
        if (s === 'roll') {
            const [L, R] = this.range();
            this.until = 0.9;
            if (this.x + this.dir * 45 > R || this.x + this.dir * 45 < L) this.dir = -this.dir;
            this.body.style.transformOrigin = '50% 55%';
        }
        if (s === 'walk') { this.tiltT = 0; this.walkPh = 0; }
        if (s === 'perch') {
            if (this.p.perch === 'doze') return this.setState('doze');
            this.until = rand(...this.p.perch);
            this.tiltT = 0;
            if (this.rec.personality?.base === 'musim') fx(this, '…');
        }
        if (s === 'wait') { this.fxT = rand(0.4, 1.2); this.scanT = 0.6; }
        if (s === 'watch') { this.fxT = 0; this.until = 2.8; }
        if (s === 'me') {
            this.fxT = 0;
            const close = closenessOf(this.rec) >= CLOSE;
            this.until = can(this, 'soft')
                ? { saechim: 1.2, neugut: 1.5, simsul: 1.1, musim: 1.1 }[this.rec.personality?.base] || 1.0
                : { aegyo: 1.0, saechim: close ? 1.9 : 1.1, neugut: 1.4, simsul: close ? 1.5 : 1.0, musim: 0.8 }[this.rec.personality?.base] || 1.2;
        }
        const k = this.rec.personality?.base;
        if (s === 'peekin') { this.fxT = 0; this.until = { aegyo: 1.5, neugut: 1.8, simsul: 1.7 }[k] || 1.4; }
        if (s === 'follow') { this.fxT = 0; this.fstepped = false; this.until = { saechim: 1.3, simsul: 1.6, musim: 0.9 }[k] || 3; }
        if (s === 'lean') { this.until = k === 'neugut' ? 1.8 : 1.2; }
        if (s === 'resist') { this.fxT = 0; this.until = 1.0; this.tiltT = 0; }
        if (s === 'sleepy') { this.fxT = 0.8; }
        if (s === 'press' || s === 'gift') { this.fxT = 0; this.tiltT = 0; }
    }

    /** Walk somewhere on what it stands on (floor or ledge). toEdge = walk to the very end of a ledge. */
    walkTo(tx, toEdge = false) {
        this.tx = tx; this.edge = toEdge;
        const d = tx > this.x ? 1 : -1;
        if (d !== this.dir && this.side) {
            // flip with a little hop
            this.dir = d;
            this.air = true; this.vy = 280; this.vx = 0; this.next = 'walk';   // lands back on the same ledge
            return;
        }
        this.dir = d;
        this.setState('walk');
    }

    decide() {
        if (this.mealPending) return this.setState('sniff');
        if (this.food > 0) return this.setState('eat');
        if (this.levelPending()) return this.startCheer();          // e.g. a pat tipped it over
        if (this.afterMeal) { const el = this.afterMeal; this.afterMeal = null; if (el.isConnected && !this.waiting) { this.watchReply(el); if (this.state !== 'idle') return; } }
        if (gen.active && this.waiting) return this.setState('wait');
        const full = this.isFull();
        const r = Math.random();
        const dz = this.p.doze + (full ? 0.25 : 0);
        if (r < dz) return this.setState('doze');
        // stop and react to you now and then (friendlier = more often)
        if (performance.now() - this.lastMe > ME_REST * 1000 && Math.random() < byCloseness(this, ...this.p.me) * ME_SCALE) return this.startMe();
        if (full && !this.plat && Math.random() < 0.12) return this.setState('roll');   // 데굴데굴
        // hop up onto a message by itself
        if (ledgesOn() && Math.random() < byCloseness(this, ...this.p.climb)) {
            const t = this.pickClimb();
            if (t && this.climbTo(t, 'perch')) return;
        }
        // while a reply is being written, sometimes glance at the chat (more often when curious)
        if (gen.active && Math.random() < (this.fidgety() ? 0.45 : 0.3)) return this.startLook('peek', (stage.left + stage.right) / 2);
        if (r < dz + (full ? 0.45 : 0.62)) {
            const [L, R] = this.range();
            if (this.plat && Math.random() < EDGE_CHANCE) {
                const [l2, r2] = this.range(0.2);
                return this.walkTo(Math.random() < 0.5 ? l2 : r2, true);
            }
            if (R - L < 10) return this.setState('idle');
            let tx = rand(L, R);
            if (Math.abs(tx - this.x) < 30) tx = clamp(this.x + (Math.random() < 0.5 ? -1 : 1) * rand(40, 140), L, R);
            return this.walkTo(tx);
        }
        return this.setState('idle');
    }

    /* ---------- ledges: climbing, hopping off, going off the top ---------- */

    /** Ledges it could hop up to from here. */
    reachable() {
        const foot = this.foot();
        return plats.filter(p => p.el !== this.plat && foot - p.top >= 8 && foot - p.top <= CLIMB_MAX * this.h
            && p.right - p.left >= this.w * 0.8);
    }

    pickClimb() {
        let list = this.reachable();
        if (!list.length) return null;
        // 친구: likes your messages
        if (can(this, 'myBubble') && Math.random() < MY_BUBBLE) {
            const mine = list.filter(p => p.user);
            if (mine.length) list = mine;
        }
        // 무심쟁이 likes the highest one; the rest pick one at random
        if (this.rec.personality?.base === 'musim') return list.reduce((a, b) => (b.top < a.top ? b : a));
        return list[Math.floor(Math.random() * list.length)];
    }

    /** Crouch, then one big hop up onto ledge `p`. Returns false if it can't. */
    climbTo(p, after = 'perch') {
        if (!p || !this.free()) return false;
        const dH = this.foot() - p.top;
        if (dH < 8 || dH > CLIMB_MAX * this.h) return false;
        const lo = p.left + this.w * 0.5, hi = p.right - this.w * 0.5;
        if (hi < lo) return false;
        this.climb = { el: p.el, tx: clamp(this.x + rand(-40, 40), lo, hi) };
        this.after = after;
        const d = this.climb.tx >= this.x ? 1 : -1;
        if (this.side) this.dir = d;
        this.setState('crouch');
        return true;
    }

    launch() {
        const c = this.climb; this.climb = null;
        const r = c && liveRect(c.el);
        const dH = r ? this.foot() - r.top : 0;
        if (!r || dH < 8 || dH > CLIMB_MAX * this.h * 1.2 || !ledgesOn()) return this.setState('idle');
        const extra = Math.max(14, this.h * 0.35);
        const vy = Math.sqrt(2 * GRAVITY * (dH + extra));
        const T = vy / GRAVITY + Math.sqrt(2 * extra / GRAVITY) * 1.05;
        const tx = clamp(c.tx, r.left + this.w * 0.5, Math.max(r.left + this.w * 0.5, r.right - this.w * 0.5));
        this.plat = null;
        this.air = true; this.vy = vy; this.vx = (tx - this.x) / T;
        this.next = this.after || 'perch';
        this.after = 'idle';
        this.sq = 1.08;
        this.setState('jump');
    }

    /** Its ledge disappeared (deleted / swiped / chat reloaded) → falls. */
    dropOff() {
        this.plat = null; this.pr = null;
        this.air = true; this.vy = 0; this.vx = 0; this.next = 'idle';
        this.setState('fall');
    }

    /** Its ledge left the top of the screen → gone with it, back in a moment from above. */
    goOff() {
        this.plat = null; this.pr = null;
        this.el.style.visibility = 'hidden';
        this.setState('off');
        this.until = rand(...OFF_DELAY);
    }

    fallFromTop() {
        this.el.style.visibility = '';
        const [L, R] = [stage.left + this.w / 2, stage.right - this.w / 2];
        this.x = R > L ? clamp(this.x + rand(-50, 50), L, R) : (stage.left + stage.right) / 2;
        this.y = stage.floorY - stage.chatTop + this.h + 10;   // feet just above the top of the chat
        this.air = true; this.vy = 0; this.vx = 0; this.next = 'idle';
        this.landReact = true;
        this.setState('fall');
    }

    /** Called every frame while standing on a ledge: ride along, step down, fall or go off. */
    trackPlat() {
        if (!this.plat) return true;
        if (!ledgesOn()) { this.dropOff(); return false; }
        const r = liveRect(this.plat);
        if (!r) { this.dropOff(); return false; }
        if (r.top < stage.chatTop - 1) { this.goOff(); return false; }
        if (r.top >= stage.floorY - 1) { this.plat = null; this.pr = null; this.y = 0; return true; }   // scrolled down to the floor
        this.pr = r;
        this.y = stage.floorY - r.top;
        const [L, R] = this.range(this.state === 'walk' && this.edge ? 0.2 : 0.5);
        if (this.state !== 'edge') this.x = R > L ? clamp(this.x, L, R) : (L + R) / 2;
        return true;
    }

    /** Off the end of a ledge: a little hop, or just stepping off. */
    hopOff() {
        const d = this.dir;
        this.leftPlat = this.plat;      // don't get caught by the ledge it is leaving
        this.plat = null; this.pr = null;
        this.air = true; this.next = 'idle';
        if (Math.random() < 0.6) { this.vy = 260; this.vx = d * rand(70, 110); this.setState('jump'); }
        else { this.x += d * this.w * 0.3; this.vy = 0; this.vx = d * 40; this.setState('fall'); }
    }

    /* ---------- looking at things (reactions) ---------- */

    /** kind: an effect text ('♥', '…'), 'glance', 'flick', 'peek', 'up'. tx = screen x it looks toward. */
    startLook(kind, tx) {
        const d = tx >= this.x ? 1 : -1;
        if (this.side && Math.abs(tx - this.x) > 8) this.dir = d;
        this.look = { kind, d };
        this.setState('look');
        this.until = kind === 'glance' || kind === 'flick' ? 1.1 : kind === 'peek' ? rand(1.2, 2) : 1.4;
        if (kind === 'peek') { if (this.fidgety() || Math.random() < 0.4) fx(this, '?', 'tavvy-fx-small'); }
        else if (kind === 'up') fx(this, '!');
        else if (kind !== 'glance' && kind !== 'flick') fx(this, kind);
    }

    /* ---------- waiting for a reply / watching it ---------- */

    startWait() {
        this.waiting = true;
        this.tried = new WeakSet();
        if (this.free()) this.setState('wait');
    }

    endWait() {
        if (!this.waiting) return;
        this.waiting = false;
        if (!this.free() && this.state !== 'wait') return;
        if (this.plat && this.plat === gen.target) return this.setState('watch');
        if (this.state === 'wait' || this.state === 'doze') this.startLook('up', this.x);
    }

    /** Curious about the reply: put down while waiting, or the reply is taking long. */
    fidgety() {
        return gen.active && (this.restless || (performance.now() - gen.t0) / 1000 > LONG_WAIT);
    }

    /** Bumped into another pet: a squish, a little hop back, "!" — then a reaction on landing. */
    bump(d, other) {
        const woke = ['doze', 'perch'].includes(this.state);
        const n = this.waiting && gen.active ? 'wait' : 'idle';
        this.edge = false; this.look = null;
        this.sq = 0.8;
        fx(this, '!');
        this.bumpWith = other; this.bumpReact = true;
        this.air = true; this.vy = woke ? 340 : 220; this.vx = d * rand(50, 75);
        this.next = n;
        this.setState('jump');
    }

    /** A long reply arrived: climb up and look at it, or look up at it from below. */
    watchReply(el) {
        if (!this.free() || this.waiting) return;
        if (this.plat === el) return this.setState('watch');
        const p = platOf(el);
        if (p && this.climbTo(p, 'watch')) return;
        const r = liveRect(el);
        this.startLook('up', r ? (r.left + r.right) / 2 : this.x);
    }

    /* ---------- wake / sleep ---------- */
    hopOutFrom(bx, by) {
        this.x = bx;
        this.y = Math.max(0, stage.floorY - by - this.h / 2);
        const mid = (stage.left + stage.right) / 2;
        this.dir = mid >= bx ? 1 : -1;
        this.vx = this.dir * rand(60, 130);
        this.vy = 420;
        this.air = true; this.next = 'greet';
        this.scale = 0.3;
        this.setState('appear');
    }

    goToBed(done) {
        if (['resist', 'wave', 'tuck'].includes(this.state)) return;   // already on its way (keeps the first callback)
        // 단짝: doesn't want to go yet — digs its feet in for a second
        const resist = can(this, 'resist') && !this.held && !this.air && this.state !== 'off' && Math.random() < RESIST_CHANCE;
        if (this.held) { this.held = false; this.el.classList.remove('tavvy-held'); this.body.style.transformOrigin = ''; }
        this.onGone = done;
        this.waiting = false;
        if (this.state === 'off') { this.vanish(); bumpBed(); return; }
        this.plat = null;      // waves where it is, then goes into the bed (doesn't ride a ledge away)
        this.air = false;
        this.setState(resist ? 'resist' : 'wave');
        this.tiltT = 0;
    }

    vanish() {
        if (this.gone) return;
        this.gone = true;
        this.el.remove();
        for (const sp of sparkles.filter(x => x.a === this)) sp.remove(false);   // eaten already (record) — just the show stops
        const i = actors.indexOf(this);
        if (i >= 0) actors.splice(i, 1);
        this.onGone?.();
    }

    /* ---------- per-frame ---------- */
    step(dt) {
        this.t += dt; this.clock += dt;
        const L = stage.left + this.w / 2, R = stage.right - this.w / 2;
        let shiver = 0, bob = 0, waddle = 0, breath = 0;
        let pose = this.role('idle');

        if (this.state !== 'tuck' && this.scale < 1) this.scale = Math.min(1, this.scale + dt * 4);
        if (this.slowT > 0) this.slowT -= dt;
        if (this.eatT > 0) this.eatT -= dt;

        if (this.held) {
            const left = this.ptr.x - this.grab.x;
            const top = this.ptr.y - this.grab.y;
            this.x = left + this.w / 2;
            this.y = stage.floorY - top - this.h;
            this.ptr.vx *= Math.pow(0.08, dt);                      // pointer stopped → swing settles
            this.tiltT = clamp(-this.ptr.vx * 0.07, -HOLD_SWING_MAX, HOLD_SWING_MAX);
            shiver = Math.sin(this.clock * 55) * 0.6;
            this.fxT -= dt;
            if (this.fxT <= 0) { this.fxT = rand(2.2, 4); if (Math.random() < 0.6) fx(this, '💦', 'tavvy-fx-small'); }
            pose = this.role('held', 'surprise');
        } else if (this.state === 'off') {
            if (this.t > this.until) this.fallFromTop();
            return;
        } else if (this.air) {
            this.plat = null;
            const prevFoot = this.foot();
            if (this.vy > 0) this.vy -= GRAVITY * dt;
            else this.vy = Math.max(-MAX_FALL, this.vy - GRAVITY * dt * Math.max(0, 1 - (this.vy / MAX_FALL) ** 2));
            this.y += this.vy * dt;
            this.x = clamp(this.x + this.vx * dt, L, Math.max(L, R));
            let landed = false;
            if (this.vy < 0 && plats.length) {
                // falling past the top edge of a message → caught there
                const foot = this.foot();
                let hit = null;
                for (const p of plats) {
                    if (p.el === this.leftPlat) continue;
                    if (p.top < prevFoot - 0.5 || p.top > foot) continue;
                    if (this.x < p.left + this.w * 0.2 || this.x > p.right - this.w * 0.2) continue;
                    if (!hit || p.top < hit.top) hit = p;
                }
                if (hit && hit.el.isConnected) {
                    const impact = -this.vy;
                    this.y = stage.floorY - hit.top;
                    this.plat = hit.el;
                    landed = true;
                    this.land(impact);
                }
            }
            if (!landed && this.y <= 0) { const impact = -this.vy; this.y = 0; this.land(impact); }
            pose = this.state === 'fall' ? this.role('fall', 'surprise') : this.role('jump', 'idle');
        } else if (!this.trackPlat()) {
            // its ledge went away this frame (falling or gone off the top)
            if (this.state === 'off') return;
        } else {
            switch (this.state) {
                case 'idle':
                case 'appear':
                    breath = 1;
                    if (this.state === 'idle' && (this.food > 0 || this.mealPending)) { this.decide(); break; }   // food coming → stop and eat
                    if (this.state === 'idle' && this.t > 0.3 && this.wantsFollow()) { this.startFollow(); break; }   // 관심: your hand
                    if (this.t > this.until) this.decide();
                    break;
                case 'peekin': {                       // 관심: you are writing — a peek at the input box
                    const k = this.rec.personality?.base, d = this.pk?.d || 1;
                    breath = 1;
                    pose = this.role('look', 'idle');
                    if (k === 'aegyo') {                                 // 폴짝폴짝, can't wait
                        pose = this.role('happy', 'idle');
                        bob = Math.abs(Math.sin(this.t * Math.PI * 3)) * 7 * this.k;
                        this.tiltT = d * 6;
                        if (this.fxT === 0 && this.t > 0.15) { this.fxT = 1; fx(this, '♪'); }
                    } else if (k === 'neugut') {                         // just woke up, a slow look
                        this.tiltT = d * Math.min(6, this.t * 5);
                        if (this.fxT === 0 && this.t > 0.8) { this.fxT = 1; fx(this, '?', 'tavvy-fx-small'); }
                    } else if (k === 'simsul') {                         // waits… 💢
                        this.tiltT = d * 6;
                        if (this.fxT === 0 && this.t > 1.0) { this.fxT = 1; fx(this, '💢'); }
                    } else {
                        this.tiltT = d * 6;
                        if (this.fxT === 0 && this.t > 0.2) { this.fxT = 1; fx(this, '?', 'tavvy-fx-small'); }
                    }
                    if (this.t > this.until) { this.pk = null; this.setState('idle'); }
                    break;
                }
                case 'follow': {                       // 관심: looking at your hand / finger
                    const k = this.rec.personality?.base;
                    const d = hand.x >= this.x ? 1 : -1;
                    const now = performance.now();
                    breath = 1;
                    pose = this.role('look', 'idle');
                    if (this.side && k !== 'neugut' && Math.abs(hand.x - this.x) > 12) this.dir = d;
                    if (k === 'saechim') this.tiltT = this.t < 0.6 ? d * 6 : -d * 9;           // 힐끔 → 홱
                    else if (k === 'neugut') this.tiltT = d * Math.min(5, this.t * 3);          // only the head, slowly
                    else if (k === 'simsul') { this.tiltT = d * 5; if (this.fxT === 0 && this.t > 1.0) { this.fxT = 1; fx(this, '💢'); } }
                    else if (k === 'aegyo') { pose = this.role('happy', 'idle'); this.tiltT = d * 5; bob = Math.abs(Math.sin(this.t * Math.PI * 2.5)) * 4 * this.k; }
                    else this.tiltT = d * 4;
                    const gone = now - hand.t > 1500 || Math.hypot(hand.x - this.x, hand.y - (this.foot() - this.h / 2)) > Math.max(110, this.h * FOLLOW_NEAR) * 1.5;
                    if (this.fstep && !this.fstepped && this.t > 0.5 && !gone) {          // a step or two toward it
                        this.fstepped = true;
                        const [L, R] = this.range();
                        const tx = clamp(this.x + d * rand(25, 50), L, Math.max(L, R));
                        if (Math.abs(tx - this.x) > 8 && Math.abs(hand.x - this.x) > 20) {
                            this.followNext = now + (k === 'aegyo' ? 600 : 2500);
                            this.tx = tx; this.edge = false; this.dir = d;
                            this.setState('walk');
                            break;
                        }
                    }
                    if (this.t > this.until || (gone && this.t > 0.8)) {
                        this.followNext = now + rand(...FOLLOW_REST) * 1000;
                        this.setState('idle');
                    }
                    break;
                }
                case 'lean':                           // 관심: leaning into a pat
                    breath = 1;
                    this.tiltT = this.leanD * 12;
                    this.sqT = 0.95;
                    pose = this.rec.personality?.base === 'aegyo' ? this.role('happy', 'idle') : this.role('idle');
                    if (this.t > this.until) this.setState('idle');
                    break;
                case 'resist': {                       // 단짝: doesn't want to go to bed yet (도리도리)
                    const k = this.rec.personality?.base, d = this.side ? this.dir : 1;
                    this.sqT = 0.92;
                    if (k === 'saechim') this.tiltT = this.t < 0.15 ? 0 : -d * 10;              // 홱
                    else if (k === 'musim') this.tiltT = Math.sin(this.t * 10) * 4;
                    else this.tiltT = Math.sin(this.t * 16) * 9;
                    if (this.fxT === 0 && this.t > 0.05) {
                        this.fxT = 1;
                        fx(this, { aegyo: '💦', neugut: '💦', simsul: '💢', musim: '…' }[k] || '!', k === 'aegyo' || k === 'neugut' ? 'tavvy-fx-small' : '');
                    }
                    if (k === 'aegyo' && this.fxT === 1 && this.t > 0.55) { this.fxT = 2; fx(this, '♥'); }
                    if (this.t > this.until) { this.tiltT = 0; this.setState('wave'); }
                    break;
                }
                case 'sleepy':                         // 단짝: you've been away a while — nodding off on your message
                    breath = 0.6;
                    this.sqT = 0.94;
                    pose = this.role('nod', 'sleep', 'idle');
                    this.tiltT = (this.side ? this.dir : 1) * (7 + Math.max(0, Math.sin(this.t * 2.6)) * 8);
                    this.fxT -= dt;
                    if (this.fxT <= 0) { this.fxT = 1.6; fx(this, 'Z', 'tavvy-fx-z'); }
                    break;
                case 'press': {                        // 내편: up against the screen
                    const b = this.big;
                    if (!b) { this.setState('idle'); break; }
                    const r = this.pressStep(dt, b);
                    pose = r.pose; bob = r.bob;
                    break;
                }
                case 'gift': {                         // 내편 애교: here, for you
                    const b = this.big;
                    if (!b) { this.setState('idle'); break; }
                    breath = 1;
                    if (this.t < 0.7) {                                  // 꼼지락 (getting it out)
                        this.tiltT = Math.sin(this.t * 22) * 5; this.sqT = 0.93;
                    } else if (this.t < 2.4) {
                        if (!b.shown) { b.shown = true; showGift(this, b.item); fx(this, '♥'); }
                        pose = this.role('gift', 'happy', 'idle');
                        this.tiltT = 0;
                        this.scale += (1.18 - this.scale) * Math.min(1, dt * 6);   // leans out toward you
                    } else {
                        this.scale += (1 - this.scale) * Math.min(1, dt * 6);
                        pose = this.role('happy', 'idle');
                        if (this.t > 2.9) { this.scale = 1; this.setState('idle'); }
                    }
                    break;
                }
                case 'walk': {
                    if (this.food > 0) { this.edge = false; this.setState('eat'); break; }
                    const d = this.tx - this.x;
                    const sp = this.p.speed * (this.isFull() ? 0.6 : 1) * (this.slowT > 0 ? 0.6 : 1);
                    if (Math.abs(d) <= sp * dt) {
                        this.x = this.tx;
                        if (this.edge && this.plat) { this.edge = false; this.setState('edge'); this.until = rand(0.6, 1.1); }
                        else { this.edge = false; this.setState('idle'); }
                        break;
                    }
                    this.x += Math.sign(d) * sp * dt;
                    const rate = sp / 22;                  // steps per second
                    const before = Math.floor(this.walkPh);
                    this.walkPh += rate * dt;
                    const ph = this.walkPh % 1;
                    // little hop on every step (light, springy walk)
                    bob = Math.pow(Math.sin(ph * Math.PI), 0.7) * 4 * this.k;
                    waddle = Math.sin(this.walkPh * Math.PI) * 1.5;
                    if (Math.floor(this.walkPh) !== before) {
                        // foot touches down: next frame + a tiny squish
                        this.frame++;
                        const soft = (this.rec.look.squish ?? 0.5) * 2;
                        if (soft > 0) this.sq = Math.min(this.sq, 1 - 0.05 * soft);
                    }
                    pose = this.role('walk');
                    break;
                }
                case 'doze':
                    breath = 0.6;
                    this.tiltT = 5 * (this.side ? this.dir : 1);
                    this.fxT -= dt;
                    if (this.fxT <= 0) { this.fxT = 1.5; fx(this, 'Z', 'tavvy-fx-z'); }
                    pose = this.role('sleep', 'idle');
                    if (this.t > this.until) this.setState('idle');
                    break;
                case 'crouch':                         // gathering itself for a big hop
                    this.sqT = 0.8;
                    breath = 0;
                    if (this.t > 0.35) this.launch();
                    break;
                case 'perch':                          // sitting on a message
                    this.sqT = 0.94;
                    breath = 0.8;
                    pose = this.role('sit', 'idle');
                    if (this.t > this.until) this.decide();
                    break;
                case 'edge':                           // at the end of a ledge: stop, look down… then off
                    this.tiltT = (this.side ? this.dir : 1) * 7;
                    if (this.t > 0.25 && !this.edgeFx) { this.edgeFx = true; if (Math.random() < 0.5) fx(this, '?', 'tavvy-fx-small'); }
                    if (this.t > this.until) { this.edgeFx = false; this.tiltT = 0; this.hopOff(); }
                    break;
                case 'look': {                         // a short reaction toward something
                    const k = this.look?.kind, d = this.look?.d || 1;
                    breath = 1;
                    pose = this.role('look', 'idle');
                    if (k === 'glance') { this.tiltT = this.t < 0.6 ? d * 6 : -d * 9; }           // look… then turn away
                    else if (k === 'flick') { this.tiltT = this.t < 0.15 ? 0 : -d * 9; }
                    else if (k === 'up' || k === 'peek') { this.tiltT = d * 4; }
                    else if (k === '♥') { this.tiltT = 0; pose = this.role('happy', 'idle'); }
                    else this.tiltT = d * 4;
                    if (this.t > this.until) {
                        this.look = null;
                        let n = this.after || 'idle';
                        this.after = 'idle';
                        if (n === 'wait' && !(gen.active && this.waiting)) n = 'idle';
                        if (n === 'perch' && !this.plat) n = 'idle';
                        this.setState(n);
                    }
                    break;
                }
                case 'wait': {                         // a reply is being written: wait for it, on it if possible
                    breath = 1;
                    pose = this.role('look', 'idle');
                    const onIt = !!this.plat && this.plat === gen.target;
                    this.tiltT = onIt ? (this.side ? this.dir : 1) * 6 : -3;                  // look down at it / up toward it
                    this.fxT -= dt;
                    if (this.fxT <= 0) { this.fxT = rand(2.4, 3.6); fx(this, '?', 'tavvy-fx-small'); }
                    this.scanT -= dt;
                    if (this.scanT <= 0 && !onIt) {
                        this.scanT = 0.5;
                        const el = genTarget();
                        if (el && !this.tried.has(el)) {
                            const p = platOf(el);
                            if (p && this.climbTo(p, 'wait')) break;
                            if (p) this.tried.add(el);        // in view but out of reach → wait from below
                        }
                    }
                    if (!this.waiting || !gen.active) { this.waiting = false; this.setState('idle'); break; }
                    if (this.p.perch === 'doze' && this.t > 6) this.setState('doze');   // 느긋쟁이 nods off while waiting
                    break;
                }
                case 'watch':                          // looking at the reply from on top of it
                    breath = 1;
                    pose = this.role('look', 'idle');
                    this.tiltT = (this.side ? this.dir : 1) * 6;
                    if (this.fxT === 0 && this.t > 0.2) { this.fxT = 1; fx(this, '?'); }
                    if (this.fxT === 1 && this.t > 1.4) { this.fxT = 2; fx(this, '!'); }
                    if (this.t > this.until) this.setState('idle');
                    break;
                case 'sniff': {                        // a look toward the chat, "!" → food
                    breath = 1;
                    pose = this.role('look', 'idle');
                    const d = (stage.left + stage.right) / 2 >= this.x ? 1 : -1;
                    this.tiltT = d * 4;
                    if (this.fxT === 0 && this.t > 0.2) { this.fxT = 1; fx(this, '!'); this.sq = 0.9; }
                    if (this.t > this.until) this.startMeal();
                    break;
                }
                case 'eat':                            // sparkles flying in
                    breath = 1;
                    pose = this.role('eat', 'idle');
                    if (this.meal?.nap && this.t > 1.6 && this.food > 3) {      // 느긋: a nap halfway through, then the rest
                        this.meal.nap = false;
                        this.setState('doze'); this.until = rand(2, 3);
                        break;
                    }
                    if (this.food > 0) this.eatIdle = 0;
                    else if ((this.eatIdle += dt) > 0.45) this.finishMeal();
                    break;
                case 'nod':                            // after a big meal: leaning over, nodding, Z
                    breath = 0.6;
                    pose = this.role('nod', 'sleep', 'idle');
                    this.tiltT = (this.side ? this.dir : 1) * (11 + Math.max(0, Math.sin(this.t * 3.4)) * 7);
                    this.fxT -= dt;
                    if (this.fxT <= 0) { this.fxT = 1.1; fx(this, 'Z', 'tavvy-fx-z'); }
                    if (this.t > this.until) {
                        this.slowT = 8;
                        const n = this.after || 'idle'; this.after = 'idle';
                        if (n === 'dance') this.setState('dance'); else this.mealDone();
                    }
                    break;
                case 'dance': {                        // feast finished: a happy little dance
                    pose = this.role('dance', 'happy', 'idle');
                    const beat = Math.floor(this.t * 2.2);
                    bob = Math.abs(Math.sin(this.t * Math.PI * 2.2)) * 7 * this.k;
                    this.tiltT = (beat % 2 ? 1 : -1) * 10;
                    if (this.fxT === 0) { this.fxT = 1; fx(this, '♪'); }
                    if (this.fxT === 1 && this.t > 0.95) { this.fxT = 2; fx(this, '♪'); }
                    if (this.t > this.until) this.mealDone();
                    break;
                }
                case 'me': {                           // reacting to you
                    breath = 1;
                    const k = this.rec.personality?.base, close = closenessOf(this.rec) >= CLOSE, d = this.side ? this.dir : 1;
                    pose = this.role('look', 'idle');
                    if (k !== 'aegyo' && can(this, 'soft')) {           // 내편: one layer softer
                        if (k === 'saechim') {                           // no turning away — a small ♥ right away
                            this.tiltT = d * 4;
                            if (this.fxT === 0 && this.t > 0.2) { this.fxT = 1; fx(this, '♥', 'tavvy-fx-small'); }
                        } else if (k === 'simsul') {                     // no 💢 — just ♥
                            this.tiltT = 0; pose = this.role('happy', 'idle');
                            if (this.fxT === 0 && this.t > 0.1) { this.fxT = 1; fx(this, '♥'); }
                        } else if (k === 'musim') {                      // stays, sometimes a ♥
                            this.tiltT = d * 3;
                            if (this.fxT === 0 && this.t > 0.1) { this.fxT = 1; fx(this, '…'); }
                            if (this.meHeart && this.fxT === 1 && this.t > 0.6) { this.fxT = 2; fx(this, '♥', 'tavvy-fx-small'); }
                        } else {                                         // 느긋: ♪, a small ♥, then a happy doze
                            this.tiltT = d * 3;
                            if (this.fxT === 0 && this.t > 0.2) { this.fxT = 1; fx(this, '♪'); }
                            if (this.fxT === 1 && this.t > 0.75) { this.fxT = 2; fx(this, '♥', 'tavvy-fx-small'); }
                        }
                    } else if (k === 'aegyo') {                                 // ♥♥ 통통
                        pose = this.role('happy', 'idle'); this.tiltT = 0;
                        bob = Math.abs(Math.sin(this.t * Math.PI * 2.5)) * 6 * this.k;
                        if (this.fxT === 0 && this.t > 0.05) { this.fxT = 1; fx(this, '♥'); }
                        if (this.fxT === 1 && this.t > 0.45) { this.fxT = 2; fx(this, '♥'); }
                    } else if (k === 'saechim') {                        // looks… turns away (close: looks back, small ♥)
                        this.tiltT = this.t < 0.6 ? d * 5 : close && this.t > 1.2 ? d * 4 : -d * 9;
                        if (close && this.fxT === 0 && this.t > 1.3) { this.fxT = 1; fx(this, '♥', 'tavvy-fx-small'); }
                    } else if (k === 'neugut') {                         // looks, ♪ (then dozes off)
                        this.tiltT = d * 3;
                        if (this.fxT === 0 && this.t > 0.2) { this.fxT = 1; fx(this, '♪'); }
                    } else if (k === 'simsul') {                         // 💢 (close: then ♥)
                        if (this.fxT === 0 && this.t > 0.1) { this.fxT = 1; fx(this, '💢'); }
                        if (close && this.fxT === 1 && this.t > 0.9) { this.fxT = 2; fx(this, '♥'); }
                        this.tiltT = this.fxT === 2 ? 0 : -d * 4;
                        if (this.fxT === 2) pose = this.role('happy', 'idle');
                    } else {                                             // 무심: "…" (then backs off)
                        this.tiltT = 0;
                        if (this.fxT === 0 && this.t > 0.1) { this.fxT = 1; fx(this, '…'); }
                    }
                    if (this.t > this.until) this.endMe();
                    break;
                }
                case 'greet': {                        // just woken: look around, spot you, say hello
                    const g = this.gq?.[this.gi];
                    if (!g) { this.afterGreet(); break; }
                    breath = 1;
                    const d = this.side ? this.dir : 1;
                    const first = !this.gfx; this.gfx = true;
                    pose = this.role('look', 'idle');
                    switch (g.k) {
                        case 'scan': this.tiltT = Math.sin(this.t * 8) * 7; break;                       // 두리번
                        case 'found': this.tiltT = 0; if (first) { fx(this, '!'); this.sq = 0.9; } break;
                        case 'teary':                                                                   // 울먹
                            this.tiltT = 0; pose = this.role('cry', 'surprise', 'idle');
                            if (first || (this.t % 0.55) < dt) fx(this, '💧', 'tavvy-fx-small');
                            break;
                        case 'wave': this.tiltT = Math.sin(this.t * 12) * 9; pose = this.role('wave', 'happy', 'idle'); break;
                        case 'bounce':
                            this.tiltT = 0; pose = this.role('happy', 'idle');
                            bob = Math.abs(Math.sin(this.t * Math.PI * 2.5)) * 6 * this.k;
                            if (first) fx(this, '♥');
                            break;
                        case 'flick': this.tiltT = this.t < 0.15 ? d * 4 : -d * 9; break;              // 밥 못 본 척 고개 홱
                        case 'yawn': this.tiltT = -d * 3; pose = this.role('idle'); if (first) fx(this, '하암'); break;
                        case 'grumpy': this.tiltT = -d * 4; if (first) fx(this, '💢'); break;          // 왜 이제 와
                        default: break;
                    }
                    if (this.t > g.d) { this.gi++; this.t = 0; this.gfx = false; }
                    break;
                }
                case 'roll': {                         // full: 데굴데굴
                    const f = Math.min(1, this.t / this.until);
                    const [L, R] = this.range();
                    this.x = clamp(this.x + this.dir * (45 / this.until) * dt, L, Math.max(L, R));
                    this.spin = 360 * this.dir * f;
                    if (f >= 1) { this.spin = 0; this.body.style.transformOrigin = ''; this.setState('idle'); }
                    break;
                }
                case 'wave':
                    this.tiltT = Math.sin(this.t * 12) * 9;
                    pose = this.role('wave', 'happy');
                    if (this.t > 0.9) {
                        this.state = 'tuck'; this.t = 0;
                        this.from = { x: this.x, y: this.y };
                        this.tiltT = 0;
                    }
                    break;
                case 'tuck': {
                    const b = bedCenter();
                    const f = Math.min(1, this.t / 0.35);
                    const e = f * f;
                    this.x = this.from.x + (b.x - this.from.x) * e;
                    this.y = this.from.y + ((stage.floorY - b.y - this.h / 2) - this.from.y) * e;
                    this.scale = 1 - 0.85 * f;
                    if (f >= 1) { this.vanish(); bumpBed(); return; }
                    break;
                }
                default:
                    break;
            }
        }

        // a sparkle just eaten while doing something else → eating face for a moment
        if (this.eatT > 0 && ['wait', 'watch', 'perch', 'look', 'edge'].includes(this.state)) pose = this.role('eat', 'idle');

        // springs — BOTH branches (held / not held)
        if (this.held) spring(this, 'tilt', 'tiltv', this.tiltT, 55, 0.14, dt);   // loose: keeps swinging a while
        if (this.held) this.tilt = clamp(this.tilt, -25, 25);
        else spring(this, 'tilt', 'tiltv', this.tiltT, 170, 0.42, dt);
        spring(this, 'sq', 'sqv', this.sqT, 260, 0.32, dt);

        this.render(pose, { shiver, bob, waddle, breath });
    }

    render(pose, { shiver, bob, waddle, breath }) {
        const soft = (this.rec.look.squish ?? 0.5) * 2;
        const br = breath ? 1 + Math.sin(this.clock * (breath < 1 ? 1.4 : 2.2)) * 0.022 * soft : 1;
        const sy = this.sq * br;
        const sx = 1 + (1 - sy) * 0.7;
        const left = this.x - this.w / 2 + shiver;
        const top = stage.floorY - this.y - this.h + this.basePx - bob;
        this.el.style.transform = `translate3d(${(left - stage.ox).toFixed(1)}px, ${(top - stage.oy).toFixed(1)}px, 0)`;
        this.body.style.transform = `rotate(${(this.tilt + waddle + this.spin).toFixed(2)}deg) scale(${(sx * this.scale).toFixed(3)}, ${(sy * this.scale).toFixed(3)})`;
        const list = pose && pose.length ? pose : this.rec.look.roles.idle;
        const src = imgUrl(list[this.frame % list.length]);
        if (src !== this.curSrc) { this.img.src = src; this.curSrc = src; }
        const flip = this.side && ((this.rec.look.facing === 'right') ? this.dir < 0 : this.dir > 0);
        this.img.classList.toggle('tavvy-flip', flip);
    }
}

/* ---------- animation loop (stops when nobody is awake) ---------- */
let raf = 0, lastT = 0, remeasureT = 0;

function ensureLoop() {
    if (raf || !actors.length) return;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
}

function tick(t) {
    raf = 0;
    const dt = Math.min(1 / 30, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    // keep geometry fresh: floor every ~0.25s (keyboard, toolbar changes), overlay origin every frame
    remeasureT += dt;
    if (remeasureT > 0.25) {
        remeasureT = 0; measure();
        // missed "generation ended" signal (stopped / error) → stop waiting
        if (gen.active && document.body.dataset.generating !== 'true' && t - gen.t0 > 3000) onGenEnd();
        checkIdle();
    }
    else {
        const ox = stage.ox, oy = stage.oy;
        measureOrigin();
        if (ox !== stage.ox || oy !== stage.oy) placeBed();
    }
    for (const a of [...actors]) a.step(dt);
    if (actors.length > 1) bumpCheck();
    if (sparkles.length) stepSparkles(dt);
    if (actors.length) raf = requestAnimationFrame(tick);
}

/* ---------- two pets meeting on the same floor / ledge ---------- */
const BUMPABLE = ['idle', 'walk', 'doze', 'perch', 'look', 'wait', 'watch', 'edge'];

function bumpCheck() {
    for (let i = 0; i < actors.length; i++) {
        for (let j = i + 1; j < actors.length; j++) {
            const a = actors[i], b = actors[j];
            const ok = (x) => !x.held && !x.air && !x.gone && BUMPABLE.includes(x.state);
            const dist = Math.abs(a.x - b.x);
            const near = (a.w + b.w) * BUMP_DIST;
            if (!ok(a) || !ok(b) || a.plat !== b.plat) { a.passing.delete(b); b.passing.delete(a); continue; }
            if (dist > near * 1.4) { a.passing.delete(b); b.passing.delete(a); continue; }
            if (dist > near || a.passing.has(b)) continue;
            // only when one of them walks into the other
            const into = (x, y) => x.state === 'walk' && Math.sign(x.tx - x.x) === Math.sign(y.x - x.x);
            if (!into(a, b) && !into(b, a)) continue;
            const last = a.bumpedAt.get(b);
            const resting = last !== undefined && (performance.now() - last) / 1000 < BUMP_REST;
            if (resting || Math.random() >= BUMP_CHANCE) { a.passing.add(b); b.passing.add(a); continue; }
            const d = a.x < b.x ? -1 : a.x > b.x ? 1 : (Math.random() < 0.5 ? -1 : 1);
            a.bump(d, b); b.bump(-d, a);
            const t = performance.now(); a.bumpedAt.set(b, t); b.bumpedAt.set(a, t);
            a.passing.add(b); b.passing.add(a);    // no second bump until they have parted
        }
    }
}

/* =====================================================================
 * Food (stage 4) — counting, the bowl, sparkles, backups
 * ===================================================================== */

const EATABLE = ['idle', 'walk', 'eat', 'look', 'wait', 'watch', 'perch', 'edge', 'me', 'peekin', 'follow', 'lean'];

/** "2026-11-12" — the day starts at 6 a.m. */
function dayKey(t = Date.now()) {
    const d = new Date(t - DAY_START_H * 3600e3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The pet's "today" record, reset when the day has changed. */
function rollToday(rec) {
    const day = dayKey();
    rec.today ??= { day: null, eaten: 0, full: false };
    if (rec.today.day !== day) { rec.today.day = day; rec.today.eaten = 0; rec.today.full = false; }
    return rec.today;
}

function addMoment(rec, kind) {
    const j = rec.journal;
    if (!j || !Array.isArray(j.moments) || j.moments.some(m => m.kind === kind)) return;
    j.moments.push({ kind, day: dayKey() });
}

const bowlCount = (rec) => (rec.bowl?.me || 0) + (rec.bowl?.them || 0);

/** A new message: into every resident's bowl (asleep or awake). */
function addToBowl(rec, kind, tokens) {
    rec.bowl[kind] = (rec.bowl[kind] || 0) + 1;
    rec.bowl.tokens = (rec.bowl.tokens || 0) + tokens;
    const day = dayKey(), j = rec.journal;
    if (j && j.lastTalkDay !== day) { j.talkDays = (j.talkDays || 0) + 1; j.lastTalkDay = day; }
}

/** Starting to eat: the whole bowl moves to "eaten" in one go. The animation after this is only a show. */
function takeBowl(rec) {
    const b = rec.bowl, e = rec.eaten;
    const take = { me: b.me || 0, them: b.them || 0, tokens: b.tokens || 0 };
    take.n = take.me + take.them;
    if (!take.n && !take.tokens) return take;
    e.me = (e.me || 0) + take.me; e.them = (e.them || 0) + take.them; e.tokens = (e.tokens || 0) + take.tokens;
    b.me = 0; b.them = 0; b.tokens = 0;
    const t = rollToday(rec);
    const wasFull = t.full || t.eaten >= FULL_AT;
    t.eaten += take.n;
    if (mealTier(take.n) === 'feast') { t.full = true; addMoment(rec, 'firstFeast'); }
    const full = t.full || t.eaten >= FULL_AT;
    if (full && !wasFull) { take.becameFull = true; addMoment(rec, 'firstFull'); }
    return take;
}

function mealTier(n) {
    let k = null;
    for (const t of MEAL_TIERS) if (n >= t.min) k = t.key;
    return k;
}

function msgTokens(m) {
    const t = Number(m?.extra?.token_count);
    if (Number.isFinite(t) && t > 0) return Math.round(t);
    return Math.ceil(String(m?.mes || '').length / 3.35);     // no stored count → guess from length
}

/** A message that counts arrived (mine or theirs). */
function onCounted(id, fromUser) {
    if (!ready || !room || !root) return;
    const here = residents();
    if (!here.length) return;
    const m = ctx().chat?.[id];
    if (!m) return;
    const kind = (fromUser ?? m.is_user) ? 'me' : 'them';
    const tokens = msgTokens(m);
    for (const rec of here) addToBowl(rec, kind, tokens);
    // awake pets eat it right away (a pet that just woke up eats it with the rest of its bowl)
    const eaters = [];
    for (const a of actors) {
        if (a.gone || a.mealPending || !here.includes(a.rec)) continue;
        const t = takeBowl(a.rec);
        if (t.n) eaters.push(a);
        if (t.becameFull) a.fullNow = true;
    }
    saveSoon();
    refreshBed();
    renderPanel();
    if (!eaters.length) return eaters;
    maybeBackup();
    const chars = String(m.mes || '').length;
    const n = clamp(Math.round(chars / SPARK_CHARS), 2, 14);
    setTimeout(() => {                         // after the message is drawn (and after a quick "seeing off" look)
        const el = msgEl(id);
        for (const a of eaters) if (!a.gone) spawnNibble(a, el, kind, n);
    }, kind === 'me' ? 600 : 250);
    return eaters;
}

/* ---------- sparkles ---------- */
const sparkles = [];
const SPARK_COLOR = { me: '#7cc8ff', them: '#ffc94d' };

class Sparkle {
    constructor(actor, x, y, kind, { delay = 0, size = 1, big = false } = {}) {
        this.a = actor; this.kind = kind; this.size = size; this.big = big;
        this.x = x; this.y = y;
        this.delay = delay;
        this.mode = 'pending';
        this.off = { x: rand(-0.8, 0.8), y: rand(0, 1), ph: rand(0, 6.3), side: Math.random() < 0.5 ? -1 : 1 };
        this.el = document.createElement('div');
        this.el.className = 'tavvy-spark' + (big ? ' tavvy-spark-big' : '');
        this.el.textContent = '✦';
        this.el.style.color = SPARK_COLOR[kind] || SPARK_COLOR.them;
        this.el.style.visibility = 'hidden';
        ensureLayer().appendChild(this.el);
        actor.food++;
        sparkles.push(this);
    }

    mouth() {
        const a = this.a;
        return { x: a.x + (a.side ? a.dir * a.w * 0.15 : 0), y: a.foot() - a.h * 0.5 + 6 };
    }

    /** Where it goes while the pet can't eat: piled beside a dozing pet, or floating nearby. */
    restSpot() {
        const a = this.a;
        if (a.state === 'doze' || a.state === 'sleepy') return { x: a.x + this.off.side * a.w * (0.55 + this.off.y * 0.4), y: a.foot() - 6 - this.off.y * 6, pile: true };
        return { x: a.x + this.off.x * a.w, y: a.foot() - a.h - 14 - this.off.y * 18, pile: false };
    }

    fly(dur) {
        this.mode = 'fly';
        this.t = 0;
        this.from = { x: this.x, y: this.y };
        this.ctrl = { x: rand(-50, 50), y: -rand(40, 110) };
        this.dur = dur;
    }

    remove(pop) {
        const i = sparkles.indexOf(this);
        if (i >= 0) sparkles.splice(i, 1);
        if (pop) { this.el.classList.add('tavvy-spark-pop'); setTimeout(() => this.el.remove(), 260); }
        else this.el.remove();
        this.a.food = Math.max(0, this.a.food - 1);
    }

    step(dt, clock) {
        const a = this.a;
        if (a.gone || a.state === 'off' || a.state === 'tuck' || a.state === 'wave') return this.remove(false);
        if (this.mode === 'pending') {
            this.delay -= dt;
            if (this.delay > 0) return;
            this.el.style.visibility = '';
            const m = this.mouth();
            this.fly(clamp(Math.hypot(m.x - this.x, m.y - this.y) / 260, 0.8, 1.5));
        }
        let sway = 0;
        if (this.mode === 'fly') {
            this.t += dt / this.dur;
            const eat = a.canEat();
            const to = eat ? this.mouth() : this.restSpot();
            const f = Math.min(1, this.t);
            const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;    // ease in-out ("둥실")
            const cx = (this.from.x + to.x) / 2 + this.ctrl.x, cy = Math.min(this.from.y, to.y) + this.ctrl.y;
            this.x = (1 - e) ** 2 * this.from.x + 2 * (1 - e) * e * cx + e * e * to.x;
            this.y = (1 - e) ** 2 * this.from.y + 2 * (1 - e) * e * cy + e * e * to.y;
            sway = Math.sin(clock * 5 + this.off.ph) * 7 * (1 - f);
            if (f >= 1) {
                if (eat) { a.onAbsorb(this.big); return this.remove(true); }
                this.mode = 'rest';
            }
        } else if (this.mode === 'rest') {
            if (a.canEat()) return this.fly(this.big ? 0.7 : 0.45);
            const r = this.restSpot();
            const k = Math.min(1, dt * 6);
            this.x += (r.x - this.x) * k; this.y += (r.y - this.y) * k;
            if (!r.pile) sway = Math.sin(clock * 2.4 + this.off.ph) * 4;
        }
        const tw = 0.85 + Math.sin(clock * 9 + this.off.ph) * 0.15;
        this.el.style.transform = `translate3d(${(this.x + sway - stage.ox).toFixed(1)}px, ${(this.y - stage.oy).toFixed(1)}px, 0) translate(-50%, -50%) scale(${(this.size * tw).toFixed(2)})`;
    }
}

let sparkClock = 0;
function stepSparkles(dt) {
    sparkClock += dt;
    for (const s of [...sparkles]) s.step(dt, sparkClock);
}

/** A point inside element `el` that is on screen (or somewhere in the chat if it isn't). */
function pointIn(el) {
    const r = liveRect(el);
    const top = stage.chatTop + 12, bottom = stage.floorY - 12;
    if (r && r.bottom > top && r.top < bottom) {
        return { x: rand(Math.max(r.left, stage.left) + 20, Math.min(r.right, stage.right) - 20), y: clamp(rand(r.top + 10, r.bottom - 10), top, bottom) };
    }
    return { x: rand(stage.left + 30, stage.right - 30), y: rand(top, Math.max(top, top + (bottom - top) * 0.5)) };
}

/** One new message while awake. */
function spawnNibble(a, el, kind, n) {
    const p = pointIn(el);
    a.eatFrom = p.x;
    for (let i = 0; i < n; i++) new Sparkle(a, p.x + rand(-24, 24), p.y + rand(-10, 10), kind, { delay: i * 0.07 });
}

/** The waiting bowl, after waking up. Sizes: 간식 / 한 끼 (2–3 waves) / 고봉밥 (with clumps) / 잔칫상. */
function spawnMeal(a, take, tier, speed = 1) {
    const n = take.n;
    let count, waves = 1, span, clumps = 0;
    if (tier === 'snack') { count = clamp(Math.round(2 + n * 1.2), 3, 12); span = 0.5 + n * 0.1; }
    else if (tier === 'meal') { count = Math.round(14 + (n - 10) / 39 * 10); waves = n < 25 ? 2 : 3; span = 0.5; }
    else if (tier === 'bowl') { count = Math.round(26 + Math.min(1, (n - 50) / 150) * 8); span = 3.5; clumps = 4; }
    else { count = SPARK_MAX; span = 3.2; clumps = 6; }
    span *= speed;                     // 애교 gobbles it up, 느긋 takes its time
    count = Math.min(count, SPARK_MAX);
    // colours split by the number of my / their messages in this meal
    const mine = Math.round(count * take.me / Math.max(1, n));
    const kinds = Array.from({ length: count }, (_, i) => (i < mine ? 'me' : 'them')).sort(() => Math.random() - 0.5);
    // where they come from: my / their messages on screen when there are some
    const from = { me: plats.filter(p => p.user).map(p => p.el), them: plats.filter(p => !p.user).map(p => p.el) };
    const src = (k) => { const l = from[k].length ? from[k] : [...from.me, ...from.them]; return l.length ? l[Math.floor(Math.random() * l.length)] : null; };
    const big = new Set();
    while (big.size < Math.min(clumps, count)) big.add(Math.floor(Math.random() * count));
    let sx = 0;
    for (let i = 0; i < count; i++) {
        const w = waves > 1 ? Math.floor(i * waves / count) : 0;
        const inWave = waves > 1 ? (i - Math.ceil(w * count / waves)) / Math.ceil(count / waves) : i / count;
        const delay = w * 1.3 * speed + inWave * span;
        const p = pointIn(src(kinds[i]));
        sx += p.x;
        new Sparkle(a, p.x, p.y, kinds[i], { delay, size: big.has(i) ? 1.6 : 1 });
    }
    a.eatFrom = sx / count;
}

/** The last, big sparkle of a feast. */
function spawnBig(a) {
    const p = { x: (stage.left + stage.right) / 2, y: stage.chatTop + (stage.floorY - stage.chatTop) * 0.3 };
    new Sparkle(a, p.x, p.y, 'them', { size: 2.6, big: true });
}

/* ---------- daily backup (one a day, the last 7 kept on the server) ---------- */
let backingUp = false;

function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

async function maybeBackup() {
    if (backingUp || !canSave() || !attached || !root?.pets.length) return;
    const b = root.settings.backup;
    const day = dayKey();
    if (b.lastDay === day) return;
    backingUp = true;
    try {
        const data = JSON.stringify({ tavvyBackup: 1, formatVersion: FORMAT_VERSION, day, savedAt: Date.now(), pets: root.pets });
        const path = await uploadFile(`tavvy_backup_${day}.json`, toBase64(data));
        b.files = b.files.filter(f => f && f.day !== day);
        b.files.push({ day, path, pets: root.pets.length });
        b.files.sort((x, y) => (x.day < y.day ? -1 : 1));
        while (b.files.length > BACKUP_KEEP) { const old = b.files.shift(); if (old?.path) deleteFile(old.path); }
        b.lastDay = day;
        saveSoon();
        renderPanel();
        log('backup', day);
    } catch (e) {
        console.warn('[Tavvy] backup failed', e);
    } finally {
        backingUp = false;
    }
}

async function restoreBackup(day) {
    if (readOnly) return say(readOnlyReason);
    const f = root?.settings.backup.files.find(x => x.day === day);
    if (!f) return say('백업을 골라 주세요.');
    if (!(await confirmBox(`${day} 백업으로 되돌릴까요? 지금 펫 기록이 그날 기록으로 바뀌어요.`))) return;
    let data;
    try {
        const res = await fetch(imgUrl(f.path), { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        data = await res.json();
    } catch (e) {
        return say('백업 파일을 읽지 못했어요: ' + (e.message || e));
    }
    if (!data || data.tavvyBackup !== 1 || !Array.isArray(data.pets) || typeof data.formatVersion !== 'number' || data.formatVersion > FORMAT_VERSION) {
        return say('백업 파일 모양이 이상해서 되돌리지 않았어요.');
    }
    sleepInstant();
    root.pets = data.pets;
    migrate(root);
    const ok = await saveNow();
    refreshBed();
    renderPanel();
    say(ok ? `${day} 백업으로 되돌렸어요.` : '되돌렸지만 저장하지 못했어요. 페이지를 새로고침하기 전에 다시 시도해 주세요.');
}

/* =====================================================================
 * Bed button (wake / sleep / drag)
 * ===================================================================== */

let bed = null;
let bedBusy = false;
const BED_SIZE = 46;

function ensureBed() {
    if (bed) return bed;
    bed = document.createElement('div');
    bed.id = 'tavvy-bed';
    bed.title = 'Tavvy — 톡: 깨우기/재우기 · 끌기: 옮기기';
    bed.innerHTML = '<span class="tavvy-bed-icon">🛏️</span><span class="tavvy-bed-z">z</span><span class="tavvy-bed-badge" hidden></span>';
    ensureLayer().appendChild(bed);

    let down = null;
    bed.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        try { bed.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        const r = bed.getBoundingClientRect();
        down = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, drag: false };
    });
    bed.addEventListener('pointermove', (e) => {
        if (!down) return;
        if (!down.drag && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_THRESHOLD) {
            down.drag = true; bed.classList.add('tavvy-dragging');
        }
        if (down.drag) setBedPos(e.clientX - down.ox, e.clientY - down.oy, false);
    });
    const end = (e) => {
        if (!down) return;
        const d = down; down = null;
        try { bed.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        bed.classList.remove('tavvy-dragging');
        if (d.drag) { setBedPos(e.clientX - d.ox, e.clientY - d.oy, true); return; }
        if (e.type === 'pointerup') toggleWake();
    };
    bed.addEventListener('pointerup', end);
    bed.addEventListener('pointercancel', end);
    return bed;
}

function defaultBedPos() {
    return { x: stage.vw - BED_SIZE - 12, y: Math.max(8, stage.floorY - BED_SIZE - 14) };
}

function clampBed(p) {
    return {
        x: clamp(p.x, 4, Math.max(4, stage.vw - BED_SIZE - 4)),
        y: clamp(p.y, 4, Math.max(4, stage.vh - BED_SIZE - 4)),
    };
}

function currentBedPos() {
    const saved = root?.settings?.bedPos?.[device()];
    if (saved && typeof saved.x === 'number') {
        // lower half: remembered as "this far above the input bar" → rises with it when the keyboard opens
        if (typeof saved.dy === 'number') return clampBed({ x: saved.x, y: stage.floorY - saved.dy });
        if (typeof saved.y === 'number') return clampBed(saved);
    }
    return clampBed(defaultBedPos());
}

function setBedPos(x, y, save) {
    const p = clampBed({ x, y });
    bed.style.transform = `translate3d(${p.x - stage.ox}px, ${p.y - stage.oy}px, 0)`;
    if (save && root) {
        const lower = p.y + BED_SIZE / 2 > stage.floorY / 2;
        root.settings.bedPos[device()] = lower
            ? { x: Math.round(p.x), dy: Math.round(stage.floorY - p.y) }
            : { x: Math.round(p.x), y: Math.round(p.y) };
        saveSoon();
    }
}

function placeBed() {
    if (!bed) return;
    const p = currentBedPos();
    bed.style.transform = `translate3d(${p.x - stage.ox}px, ${p.y - stage.oy}px, 0)`;
    placeBubble();
}

function bedCenter() {
    const p = currentBedPos();
    return { x: p.x + BED_SIZE / 2, y: p.y + BED_SIZE / 2 };
}

function bumpBed() {
    if (!bed) return;
    bed.classList.remove('tavvy-bump');
    void bed.offsetWidth;
    bed.classList.add('tavvy-bump');
}

/* ---------- a little bubble by the bed ("it's been N days") ---------- */
let bubble = null, bubbleT = 0;

function hideBubble() {
    clearTimeout(bubbleT);
    if (bubble) { bubble.remove(); bubble = null; }
}

function showBubble(text, ms = 7000) {
    hideBubble();
    if (!bed || bed.hidden) return;
    bubble = document.createElement('div');
    bubble.className = 'tavvy-bubble';
    bubble.textContent = text;
    bubble.addEventListener('pointerdown', (e) => { e.stopPropagation(); hideBubble(); });
    ensureLayer().appendChild(bubble);
    placeBubble();
    bubbleT = setTimeout(hideBubble, ms);
}

/** Next to the bed, opening toward the middle of the screen. */
function placeBubble() {
    if (!bubble || !bed) return;
    const b = currentBedPos();
    const w = bubble.offsetWidth, h = bubble.offsetHeight;
    const rightSide = b.x + BED_SIZE / 2 > stage.vw / 2;
    let x = rightSide ? b.x - w - 6 : b.x + BED_SIZE + 6;
    let y = b.y + BED_SIZE / 2 - h / 2;
    x = clamp(x, 4, Math.max(4, stage.vw - w - 4));
    y = clamp(y, 4, Math.max(4, stage.vh - h - 4));
    bubble.classList.toggle('tavvy-bubble-left', rightSide);
    bubble.style.transform = `translate3d(${x - stage.ox}px, ${y - stage.oy}px, 0)`;
}

/** Entering a room after REVISIT_DAYS or more: the one that waited longest says so. */
function revisitBubble() {
    if (actors.length) return;
    const now = Date.now();
    let best = null, bestAway = 0;
    for (const p of residents()) {
        const prev = prevVisit.get(p.id);
        if (typeof prev !== 'number') continue;
        const away = now - prev;
        if (away >= REVISIT_DAYS * 86400e3 && away > bestAway) { best = p; bestAway = away; }
    }
    if (!best) return;
    const n = Math.floor(bestAway / 86400e3);
    const line = (REVISIT_LINES[best.personality?.base] || REVISIT_LINES.aegyo)(n);
    showBubble(residents().length > 1 ? `${best.name}: ${line}` : line);
}

/* ---------- closeness went up: banner + coloured ✦ ---------- */
const CHEER_COLORS = ['#ff7eb6', '#ffd23f', '#6fc3ff', '#8be07a'];

function showCheer(a, from, to) {
    const top = stage.floorY - a.y - a.h;
    const el = document.createElement('div');
    el.className = 'tavvy-cheer';
    const mode = root?.settings?.heartMode || 'both';
    const fresh = unlocksFor(a.rec).filter(u => u.lv > from && u.lv <= to);
    el.innerHTML = '<b>친밀도 상승!</b>' + (mode === 'hide' ? '' : `<span>${esc(levelLabel(a.rec, from))} → ${esc(levelLabel(a.rec, to))}</span>`)
        + (fresh.length ? `<span class="tavvy-cheer-new">새로운 행동을 할 수 있게 되었어요!</span><small>${fresh.map(u => esc(u.name)).join(' · ')}</small>` : '');
    ensureLayer().appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    const x = clamp(a.x - w / 2, 4, Math.max(4, stage.vw - w - 4));
    const y = clamp(top - h - 22, 4, Math.max(4, stage.vh - h - 4));
    el.style.left = (x - stage.ox) + 'px';
    el.style.top = (y - stage.oy) + 'px';
    setTimeout(() => el.remove(), 4200);
    for (let i = 0; i < 14; i++) {
        const s = document.createElement('div');
        s.className = 'tavvy-burst';
        s.textContent = '✦';
        const ang = (i / 14) * Math.PI * 2 + rand(-0.2, 0.2), dist = rand(40, 80);
        s.style.color = CHEER_COLORS[i % CHEER_COLORS.length];
        s.style.left = (a.x - stage.ox) + 'px';
        s.style.top = (top + a.h * 0.4 - stage.oy) + 'px';
        s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
        s.style.setProperty('--dy', `${Math.sin(ang) * dist - 20}px`);
        s.style.animationDelay = `${(i % 3) * 0.08}s`;
        ensureLayer().appendChild(s);
        setTimeout(() => s.remove(), 1600);
    }
}

/** Tears flying out from both sides of the head (cartoon style), once. */
function tearBurst(a) {
    const s = a.scale || 1;
    const top = a.foot() - a.h * s;
    let cx = a.x, hy = top + a.h * s * 0.28;
    if (a.side) cx = a.x + a.dir * a.w * s * 0.12;          // side view: the head is toward where it looks
    const ang = TEAR_ANGLE * Math.PI / 180;
    for (const side of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
            const t = document.createElement('div');
            t.className = 'tavvy-tear';
            t.style.background = TEAR_COLOR;
            t.style.left = (cx + side * a.w * s * 0.28 - stage.ox) + 'px';
            t.style.top = (hy - stage.oy) + 'px';
            const dist = rand(26, 40) * s;
            t.style.setProperty('--dx', `${side * Math.cos(ang) * dist}px`);
            t.style.setProperty('--dy', `${-Math.sin(ang) * dist}px`);
            t.style.setProperty('--r', `${side * 35}deg`);
            t.style.animationDelay = `${i * 0.12}s`;
            ensureLayer().appendChild(t);
            setTimeout(() => t.remove(), 1100);
        }
    }
}

/** 내편 애교: holds a little present out toward you (it grows as it comes closer). */
function showGift(a, item) {
    const el = document.createElement('div');
    el.className = 'tavvy-gift';
    el.textContent = item;
    el.style.left = (a.x + (a.side ? a.dir * a.w * 0.25 : 0) - stage.ox) + 'px';
    el.style.top = (a.foot() - a.h * 0.45 - stage.oy) + 'px';
    ensureLayer().appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

/* ---------- 친구: the bed wiggles while food piles up ---------- */
let wiggleAt = 0;

function bedWiggle() {
    if (!bed || bed.hidden || actors.length || document.hidden) return;
    const now = performance.now();
    if (now < wiggleAt) return;
    if (!residents().some(p => bowlCount(p) > 0 && can(p, 'bedWiggle'))) return;
    wiggleAt = now + rand(...WIGGLE_GAP) * 1000;
    const icon = bed.querySelector('.tavvy-bed-icon');
    icon.classList.remove('tavvy-wiggle');
    void icon.offsetWidth;
    icon.classList.add('tavvy-wiggle');
}

/* ---------- you: writing, your hand, being away a while ---------- */

/** A keystroke in the input box. */
function onTyping() {
    noteUserAct();
    wakeSleepy();
    if (!actors.length) return;
    const now = performance.now();
    const start = now - typing.last > TYPING_GAP * 1000;
    if (start) typing.session++;
    typing.last = now;
    for (const a of actors) {
        if (!can(a, 'peekInput') || a.held || a.air || a.waiting) continue;
        if (!start && now < a.peekInNext) continue;
        a.peekInNext = now + rand(...PEEKIN_GAP) * 1000;
        const k = a.rec.personality?.base;
        const okState = ['idle', 'walk', 'perch'].includes(a.state) || (a.state === 'doze' && k === 'neugut');
        if (!okState || Math.random() >= (start ? PEEKIN_CHANCE : PEEKIN_AGAIN)) continue;
        if (k === 'musim') { if (a.peekInSession === typing.session) continue; a.peekInSession = typing.session; }
        a.startPeekIn();
    }
}

/** You wrote or sent something: anyone nodding off on your message wakes up — "!" */
function wakeSleepy() {
    for (const a of actors) {
        if (a.state !== 'sleepy') continue;
        fx(a, '!');
        a.sq = 0.88;
        a.setState('idle');
    }
}

/** Nothing from you for IDLE_DOZE seconds (checked a few times a second while awake). */
function checkIdle() {
    if (gen.active || !actors.length) return;
    if (performance.now() - lastAct < IDLE_DOZE * 1000) return;
    for (const a of actors) {
        // one roll per quiet spell; a pet busy right then (eating, held…) gets its roll a little later
        if (a.idleTried || !can(a, 'dozeWait') || !a.free() || a.waiting || !['idle', 'walk', 'perch', 'doze'].includes(a.state)) continue;
        a.idleTried = true;
        if (Math.random() >= IDLE_DOZE_CHANCE) continue;
        measurePlats();
        a.startSleepy();
    }
}

function refreshBed() {
    const here = residents();
    if (!here.length) { if (bed) bed.hidden = true; return; }
    ensureBed();
    bed.hidden = false;
    bed.classList.toggle('tavvy-awake', actors.length > 0);
    // number of messages waiting in the bowl (while asleep)
    const n = here.reduce((t, p) => t + bowlCount(p), 0);
    const badge = bed.querySelector('.tavvy-bed-badge');
    const show = !actors.length && n > 0 && root?.settings.badge !== false;
    badge.hidden = !show;
    if (show) badge.textContent = n > 999 ? '999+' : String(n);
    placeBed();
}

/* =====================================================================
 * Wake / sleep
 * ===================================================================== */

async function wakeAll() {
    if (bedBusy) return;
    const here = residents().filter(p => !actors.some(a => a.rec === p));
    if (!here.length) return;
    bedBusy = true;
    try {
        measure();
        const b = bedCenter();
        bumpBed();
        let i = 0;
        hideBubble();
        const now = Date.now();
        for (const rec of here) {
            const a = new Actor(rec);
            a.mealPending = bowlCount(rec) > 0;
            // how long since we last met (before entering this room) → how the reunion goes
            const prev = prevVisit.get(rec.id);
            const away = typeof prev === 'number' ? Math.max(0, now - prev) : 0;
            const n = bowlCount(rec);
            a.reunion = {
                away,
                skip: away < RECENT_H * 3600e3 && n >= MEAL_TIERS[1].min,                    // just saw you, lots of food → straight to it
                long: away >= REVISIT_DAYS * 86400e3 && n < MEAL_TIERS[1].min,             // long apart, little food → a longer hello
                teary: away >= TEARY_DAYS * 86400e3 && closenessOf(rec) >= TEARY_CLOSE,
            };
            prevVisit.set(rec.id, now);              // waking again during this visit = "just saw you"
            try { await a.load(); } catch (e) { console.warn('[Tavvy] could not load pet image', e); continue; }
            actors.push(a);
            a.hopOutFrom(b.x, b.y);
            a.render(a.role('idle'), {});
            if (i++) await new Promise(r => setTimeout(r, 150));
            ensureLoop();
        }
    } finally {
        bedBusy = false;
        refreshBed();
    }
}

function sleepAll() {
    if (!actors.length) return;
    let left = actors.length;
    for (const a of actors) {
        a.goToBed(() => { if (--left <= 0) refreshBed(); });
    }
    ensureLoop();
}

/** Leaving the room: put everyone away at once. */
function sleepInstant() {
    for (const a of [...actors]) { a.onGone = null; a.vanish(); }
    actors.length = 0;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
}

function toggleWake() {
    noteUserAct();
    if (actors.length) sleepAll();
    else wakeAll();
}

/* =====================================================================
 * Replies: waiting, watching, seeing off my message
 * ===================================================================== */

// target = the message being written ("…" box / streaming reply), when there is one on screen
const gen = { active: false, type: '', startLen: 0, t0: 0, firstToken: false, target: null };
const watched = new Set();   // replies already looked at ("같은 답은 한 번만")

function chatMsgs() {
    const chat = chatEl();
    return chat ? chat.querySelectorAll(':scope > .mes') : [];
}

/** The reply being written right now, if it is on screen. */
function genTarget() {
    const chat = chatEl();
    if (!chat) return null;
    const ms = chatMsgs();
    const last = ms[ms.length - 1];
    let el = null;
    if (last && last.getAttribute('is_user') !== 'true') {
        const id = Number(last.getAttribute('mesid'));
        // swipe / continue write into the last message; otherwise it is a newer one
        if (['swipe', 'continue'].includes(gen.type) || (Number.isFinite(id) && id >= gen.startLen - (gen.type === 'regenerate' ? 1 : 0))) el = last;
    }
    if (!el) el = chat.querySelector('.typing_indicator');      // a "typing…" box from another extension
    gen.target = el;
    return el;
}

function onGenStart(type, opts, dryRun) {
    if (dryRun || type === 'quiet' || type === 'impersonate' || opts?.quiet_prompt) return;
    gen.active = true;
    gen.type = type || 'normal';
    gen.startLen = ctx().chat?.length ?? 0;
    gen.t0 = performance.now();
    gen.firstToken = false;
    gen.target = null;
    for (const a of actors) a.restless = false;
    // regenerate removes the old reply right after this signal → look a moment later
    setTimeout(() => {
        if (!gen.active) return;
        measurePlats();
        for (const a of actors) if (!a.waiting && Math.random() < byCloseness(a, 0.3, 0.85)) a.startWait();
    }, 500);
}

function onStreamToken() {
    if (!gen.active || gen.firstToken) return;
    gen.firstToken = true;
    for (const a of actors) if (a.waiting && a.state === 'wait') fx(a, '!');
}

function onGenEnd() {
    if (!gen.active) return;
    genTarget();
    measurePlats();
    gen.active = false;
    for (const a of actors) { a.endWait(); a.restless = false; }
    gen.target = null;
}

function msgEl(id) {
    return chatEl()?.querySelector(`:scope > .mes[mesid="${CSS.escape(String(id))}"]`) || null;
}

function onReplyReceived(id, type) {
    if (gen.active) onGenEnd();
    const eaters = COUNT_TYPES.includes(type) ? (onCounted(id) || []) : [];
    if (!actors.length || !['normal', undefined, '', 'regenerate', 'swipe'].includes(type)) return;
    const m = ctx().chat?.[id];
    if (!m || m.is_user || String(m.mes || '').length < WATCH_MIN_CHARS) return;
    const key = `${id}:${m.swipe_id ?? 0}:${String(m.mes).length}`;
    if (watched.has(key)) return;
    watched.add(key);
    setTimeout(() => {                      // after it is drawn
        const el = msgEl(id);
        if (!el) return;
        measurePlats();
        for (const a of actors) {
            if (a.state === 'watch' && a.plat === el) continue;           // already up there
            if (Math.random() >= byCloseness(a, 0.3, 0.85)) continue;
            if (eaters.includes(a)) a.afterMeal = el;                      // eat it first, then go and look
            else a.watchReply(el);
        }
    }, 250);
}

/** I sent a message: a short look toward my new message. */
function onMySend(id) {
    if (!actors.length) return;
    setTimeout(() => {
        const el = msgEl(id);
        const r = liveRect(el);
        const x = r ? (r.left + r.right) / 2 : (stage.left + stage.right) / 2;
        measurePlats();
        for (const a of actors) {
            if (!a.free() || Math.random() >= byCloseness(a, 0.3, 0.85)) continue;
            a.after = a.state === 'perch' ? 'idle' : a.waiting ? 'wait' : 'idle';
            a.startLook(a.p.send, x);
        }
    }, 120);
}

/* =====================================================================
 * Room changes
 * ===================================================================== */

const sameRoom = (a, b) => !!a && !!b && a.chatId === b.chatId && a.integrity === b.integrity;
let roomRetry = 0;

async function onChatChanged() {
    const next = readRoom();
    // SillyTavern sometimes reports a chat change without really leaving (e.g. after the app was in the
    // background). Same room → keep pets as they are.
    if (sameRoom(next, room)) { measure(); refreshBed(); renderPanel(); return; }
    // A change to "no chat" can be a passing moment while the chat reloads → look again shortly.
    clearTimeout(roomRetry);
    if (!next) roomRetry = setTimeout(recheckRoom, 800);

    sleepInstant();
    gen.active = false; gen.target = null;
    watched.clear();
    room = next;
    let changed = false;
    if (room && root) {
        const now = Date.now();
        for (const p of root.pets) {
            const res = checkHome(p, room);
            if (res.changed) changed = true;
            if (res.here) { prevVisit.set(p.id, p.lastVisit); p.lastVisit = now; }
        }
    }
    if (changed) await saveNow(); else if (residents().length) saveSoon();
    measure();
    refreshBed();
    renderPanel();
    hideBubble();
    if (root?.settings.autoWake && residents().length) wakeAll();
    else revisitBubble();
}

/** Look at the current chat again; only acts if it differs from what we think. */
function recheckRoom() {
    if (!ready) return;
    const next = readRoom();
    if (sameRoom(next, room) || (!next && !room)) return;
    onChatChanged();
}

/* =====================================================================
 * Settings panel
 * ===================================================================== */

const $id = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function panelHtml() {
    const pers = Object.entries(PERSONALITIES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    const pets = Object.entries(BUILTIN).map(([k, v]) =>
        `<label class="tavvy-pick"><input type="radio" name="tavvy-look" value="${k}"><img src="${BASE}assets/pets/${k}/idle.png" alt=""><span>${v.name}</span></label>`).join('');
    return `
<div class="tavvy-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Tavvy (태비)</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div id="tavvy-warn" class="tavvy-warn" hidden></div>

      <div class="tavvy-sec">이 방</div>
      <div id="tavvy-room" class="tavvy-note"></div>

      <div class="tavvy-sec">펫 목록</div>
      <div id="tavvy-list"></div>

      <div class="tavvy-sec">새 펫 만들기 <small>(지금 열려 있는 채팅방이 집이 돼요)</small></div>
      <div class="tavvy-form">
        <label>이름 <input id="tavvy-name" class="text_pole" maxlength="20" placeholder="이름"></label>
        <div class="tavvy-looks">
          ${pets}
          <label class="tavvy-pick"><input type="radio" name="tavvy-look" value="mine"><img id="tavvy-mine-prev" alt=""><span>내 그림</span></label>
        </div>
        <div id="tavvy-mine" class="tavvy-mine" hidden>
          <input id="tavvy-file" type="file" accept="image/png">
          <div class="tavvy-filerow"><div id="tavvy-filebtn" class="menu_button">그림 고르기</div><span id="tavvy-filename" class="tavvy-note">아직 안 골랐어요</span></div>
          <label class="checkbox_label"><input id="tavvy-crop" type="checkbox" checked> 투명 여백 자르기</label>
          <label>그림 방향
            <select id="tavvy-facing" class="text_pole">
              <option value="front">정면</option>
              <option value="right">옆모습 (오른쪽을 봄)</option>
              <option value="left">옆모습 (왼쪽을 봄)</option>
            </select>
          </label>
          <div class="tavvy-note">투명 배경 PNG 한 장이면 돼요.</div>
        </div>
        <label>성격 <select id="tavvy-pers" class="text_pole">${pers}</select></label>
        <div id="tavvy-create" class="menu_button">만들기</div>
        <div id="tavvy-msg" class="tavvy-note"></div>
      </div>

      <div class="tavvy-sec">설정</div>
      <label class="checkbox_label"><input id="tavvy-autowake" type="checkbox"> 방에 들어올 때 자동으로 깨우기</label>
      <label>무대
        <select id="tavvy-stage" class="text_pole">
          <option value="chat">채팅창 전체 (말풍선 위에도 올라가요)</option>
          <option value="floor">바닥만 (입력창 위에서만 지내요)</option>
        </select>
      </label>
      <label class="checkbox_label"><input id="tavvy-lines" type="checkbox"> 줄 모양 채팅에서 메시지 사이 경계선도 발판으로 쓰기</label>
      <label class="checkbox_label"><input id="tavvy-badge" type="checkbox"> 재워 둔 동안 침대에 쌓인 밥 수 보기</label>
      <label>친밀도 표시
        <select id="tavvy-hearts" class="text_pole">
          <option value="both">하트 + 이름 (♥♥ 친구)</option>
          <option value="hearts">하트만</option>
          <option value="name">이름만</option>
          <option value="hide">숨기기</option>
        </select>
      </label>
      <div id="tavvy-bedreset" class="menu_button">깨우기 버튼 위치 처음으로</div>
      <div id="tavvy-bedfind" class="menu_button">깨우기 버튼 찾기 (화면 가운데로)</div>
      <div id="tavvy-diag" class="tavvy-note tavvy-diag"></div>

      <div class="tavvy-sec">백업 <small>(하루 한 번 자동, 최근 ${BACKUP_KEEP}개)</small></div>
      <div class="tavvy-filerow">
        <select id="tavvy-backups" class="text_pole"></select>
        <div id="tavvy-restore" class="menu_button">이 백업으로 되돌리기</div>
      </div>
      <div class="tavvy-note">되돌리면 모든 펫의 기록(먹은 양 등)이 그날 기록으로 바뀌어요. 그 뒤에 지운 펫의 내 그림은 돌아오지 않아요.</div>
    </div>
  </div>
</div>`;
}

let mineFile = null;

function bindPanel() {
    const host = $id('extensions_settings2') || $id('extensions_settings');
    if (!host) return;
    host.insertAdjacentHTML('beforeend', panelHtml());

    const looks = document.querySelectorAll('input[name="tavvy-look"]');
    looks.forEach(r => r.addEventListener('change', () => {
        $id('tavvy-mine').hidden = r.value !== 'mine' || !r.checked;
        const nameEl = $id('tavvy-name');
        if (r.checked && BUILTIN[r.value] && (!nameEl.value || Object.values(BUILTIN).some(b => b.name === nameEl.value))) {
            nameEl.value = BUILTIN[r.value].name;
        }
    }));
    // SillyTavern hides every file input (input[type=file] { display:none }) → our own button opens it
    $id('tavvy-filebtn').addEventListener('click', () => $id('tavvy-file').click());
    $id('tavvy-file').addEventListener('change', async (e) => {
        mineFile = e.target.files?.[0] || null;
        const prev = $id('tavvy-mine-prev');
        $id('tavvy-filename').textContent = mineFile ? mineFile.name : '아직 안 골랐어요';
        if (!mineFile) { prev.removeAttribute('src'); return; }
        try {
            const out = await preparePng(mineFile, $id('tavvy-crop').checked);
            prev.src = out.dataUrl;
        } catch { prev.removeAttribute('src'); }
    });
    $id('tavvy-create').addEventListener('click', createPetFromForm);
    $id('tavvy-autowake').addEventListener('change', (e) => {
        if (!root) return;
        root.settings.autoWake = e.target.checked;
        saveSoon();
    });
    $id('tavvy-stage').addEventListener('change', (e) => {
        if (!root) return;
        root.settings.stageMode = e.target.value === 'floor' ? 'floor' : 'chat';
        saveSoon();
        measure();
        renderPanel();
    });
    $id('tavvy-lines').addEventListener('change', (e) => {
        if (!root) return;
        root.settings.lineLedges = e.target.checked;
        saveSoon();
        measure();
    });
    $id('tavvy-bedreset').addEventListener('click', () => {
        if (!root) return;
        root.settings.bedPos = { phone: null, pc: null };
        saveSoon();
        placeBed();
        say('깨우기 버튼을 처음 자리로 옮겼어요.');
    });
    $id('tavvy-bedfind').addEventListener('click', findBed);
    $id('tavvy-badge').addEventListener('change', (e) => {
        if (!root) return;
        root.settings.badge = e.target.checked;
        saveSoon();
        refreshBed();
    });
    $id('tavvy-hearts').addEventListener('change', (e) => {
        if (!root) return;
        root.settings.heartMode = ['both', 'hearts', 'name', 'hide'].includes(e.target.value) ? e.target.value : 'both';
        saveSoon();
        renderPanel();
    });
    $id('tavvy-restore').addEventListener('click', () => restoreBackup($id('tavvy-backups').value));
    $id('tavvy-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-del]');
        if (btn) return deletePet(btn.dataset.del);
        const ib = e.target.closest('[data-info]');
        if (ib) openInfo(ib.dataset.info);
    });
    $id('tavvy-list').addEventListener('input', (e) => {
        if (e.target.matches?.('[data-size]')) onSizeInput(e.target, false);
    });
    $id('tavvy-list').addEventListener('change', (e) => {
        if (e.target.matches?.('[data-size]')) onSizeInput(e.target, true);
    });
}

/** Diagnostic: bring the bed to the middle of the screen and report what the page sees. */
function findBed() {
    measure();
    refreshBed();
    const lines = [];
    lines.push(`준비: ${ready ? '됨' : '안 됨'} · 이 방 펫: ${residents().length}`);
    lines.push(`화면 ${Math.round(stage.vw)}×${Math.round(stage.vh)} · 바닥 ${Math.round(stage.floorY)} · ${device()}`);
    lines.push(`채팅 윗선 ${Math.round(stage.chatTop)} · 보이는 발판 ${plats.length} · ${isBubbleChat() ? '말풍선' : '줄 모양'} · 무대 ${stageIsChat() ? '채팅창 전체' : '바닥만'}`);
    // room / home keys, shortened so character names are not shown
    const key = (chatId, integ) => {
        const id = String(chatId || '');
        const tail = id.includes(' - ') ? id.slice(id.lastIndexOf(' - ') + 3) : id.slice(-20);
        return `…${tail || '(없음)'} / ${integ ? String(integ).slice(0, 6) : '(번호 없음)'}`;
    };
    const live = readRoom();
    lines.push(`지금 방: ${live ? key(live.chatId, live.integrity) + (live.branch ? ' · 분기' : '') : '없음'}`);
    lines.push(`기억한 방: ${room ? key(room.chatId, room.integrity) : '없음'}`);
    for (const p of root?.pets || []) lines.push(`${p.name}의 집: ${p.home ? key(p.home.chatId, p.home.integrity) : '집 없음'}`);
    if (!bed) {
        lines.push('침대 버튼: 만들어지지 않음');
    } else {
        const x = Math.round(stage.vw / 2 - BED_SIZE / 2), y = Math.round(stage.vh / 2 - BED_SIZE / 2);
        bed.style.transform = `translate3d(${x - stage.ox}px, ${y - stage.oy}px, 0)`;   // temporary, not saved
        bumpBed();
        const r = bed.getBoundingClientRect();
        const cs = getComputedStyle(bed);
        const ls = getComputedStyle(layer);   // layer is a 0×0 anchor on purpose
        lines.push(`침대 버튼: ${bed.hidden ? '숨김' : '보임'} · ${cs.display} · 투명도 ${cs.opacity} · 위치 ${Math.round(r.left)},${Math.round(r.top)} 크기 ${Math.round(r.width)}×${Math.round(r.height)}`);
        const lr = layer.getBoundingClientRect();
        lines.push(`무대: ${ls.display} · z ${ls.zIndex} · ${Math.round(lr.left)},${Math.round(lr.top)} ${Math.round(lr.width)}×${Math.round(lr.height)} · 부모 ${layer.parentElement?.tagName}`);
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const desc = top ? (top.id ? '#' + top.id : top.tagName.toLowerCase() + (top.className && typeof top.className === 'string' ? '.' + top.className.split(' ')[0] : '')) : '없음';
        lines.push(`그 자리 맨 위: ${desc}`);
        lines.push('설정 창을 닫고 화면 가운데에 🛏️ 가 보이는지 확인해 주세요.');
    }
    const d = $id('tavvy-diag');
    if (d) d.textContent = lines.join('\n');
}

function say(text) {
    const m = $id('tavvy-msg');
    if (m) m.textContent = text;
}

function homeLabel(p) {
    if (!p.home) return '집 없음';
    if (room && checkHome(p, room).here) return '이 방';
    return '다른 방';
}

/* ---------- per-pet size (phone / PC kept apart) ---------- */
function petSize(p, dev = device()) {
    return p.look?.size?.[dev] || DEFAULT_SIZE[dev];
}

/** Built-in pets are 32-cell dot art drawn at 64px → sizes in steps of 32 keep every dot even. */
function isSharp(p, size) {
    const first = p.look?.roles?.idle?.[0] || '';
    return first.startsWith('builtin:') && size % 32 === 0;
}

function sizeLabel(p, size) {
    return `px${isSharp(p, size) ? ' ✦선명' : ''}${size === DEFAULT_SIZE[device()] ? ' (기본)' : ''} · ${SIZE_MIN}~${SIZE_MAX}`;
}

function onSizeInput(input, done) {
    const pet = root?.pets.find(p => p.id === input.dataset.size);
    if (!pet) return;
    let v = Math.round(Number(input.value));
    if (!Number.isFinite(v) || v < SIZE_MIN || v > SIZE_MAX) {
        // half-typed (e.g. "4" on the way to "48") → wait; on leaving the box, fix it into range
        if (!done) return;
        v = Number.isFinite(v) && input.value !== '' ? clamp(v, SIZE_MIN, SIZE_MAX) : petSize(pet);
    }
    pet.look.size = { ...DEFAULT_SIZE, ...(pet.look.size || {}), [device()]: v };
    const label = document.querySelector(`[data-sizeval="${CSS.escape(pet.id)}"]`);
    if (label) label.textContent = sizeLabel(pet, v);
    for (const a of actors) if (a.rec === pet) a.fitStage();
    if (done) { input.value = v; saveSoon(); }
}

/* ---------- journal (기록장) — what happened, never changes behaviour ---------- */

/** Days between two day keys ("2026-11-12"). */
function daysBetween(a, b) {
    const t = (k) => { const [y, m, d] = String(k).split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 86400e3);
}

function addDays(key, n) {
    const [y, m, d] = String(key).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

const MOMENT_NAMES = { firstFeast: '첫 잔칫상', firstFull: '첫 배부름', moved: '이사한 날' };

function journalHtml(p) {
    const today = dayKey();
    const met = dayKey(p.createdAt || Date.now());
    const together = daysBetween(met, today) + 1;
    const e = p.eaten || {}, j = p.journal || {};
    const label = levelLabel(p);
    const moments = [{ day: met, name: '만난 날' }];
    for (const m of j.moments || []) {
        const r = /^level(\d)$/.exec(m?.kind || '');
        if (r) moments.push({ day: m.day, name: `${josa(LEVELS[Number(r[1])]?.name || '?', '이', '가')} 된 날` });
        else if (MOMENT_NAMES[m?.kind]) moments.push({ day: m.day, name: MOMENT_NAMES[m.kind] });
    }
    if (together >= 100) moments.push({ day: addDays(met, 99), name: '만난 지 100일' });
    for (let y = 1; y < 100; y++) {                                   // every year on the day we met
        const ann = met.replace(/^\d+/, (v) => String(Number(v) + y));
        if (ann > today) break;
        moments.push({ day: ann, name: `만난 지 ${y}년` });
    }
    moments.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const rows = [
        label ? ['친밀도', label] : null,
        ['함께한 지', `${together}일째`],
        ['대화한 날', `${j.talkDays || 0}일`],
        ['주고받은 메시지', `나 ${e.me || 0} · 상대 ${e.them || 0} · 합계 ${(e.me || 0) + (e.them || 0)}`],
        ['먹은 토큰', `약 ${(e.tokens || 0).toLocaleString()}`],
    ].filter(Boolean);
    return `<div class="tavvy-journal">
  ${rows.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
  <div class="tavvy-journal-sec">기념 순간</div>
  ${moments.map(m => `<div><span>${esc(m.day)}</span><b>${esc(m.name)}</b></div>`).join('')}
  <div class="tavvy-journal-sec">할 수 있는 행동</div>
  ${abilitiesHtml(p)}
</div>`;
}

/** Behaviours learned so far by name; the rest stay "???". */
function abilitiesHtml(p) {
    const lv = levelOf(p);
    const hide = (root?.settings?.heartMode || 'both') === 'hide';
    return unlocksFor(p).map(u => {
        const open = lv >= u.lv;
        return `<div class="${open ? '' : 'tavvy-locked'}"><span>${hide ? '' : LEVELS[u.lv].hearts}</span><b>${open ? esc(u.name) : '???'}</b></div>`;
    }).join('');
}

/* =====================================================================
 * Pet info window (기록장 | 수정) — opened from the wand menu or the pet list
 * ===================================================================== */

let info = null;   // { el, id, tab, file, base: {…} } while open

function infoBase(p) {
    return { name: p.name, pers: p.personality?.base || 'aegyo', facing: p.look?.facing || 'front', squish: String(p.look?.squish ?? 0.5) };
}

function ensureInfoEl() {
    let el = $id('tavvy-info');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'tavvy-info';
    el.className = 'tavvy-modal';
    el.hidden = true;
    el.innerHTML = '<div class="tavvy-modal-box tavvy-settings" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(el);
    el.addEventListener('pointerdown', (e) => { if (e.target === el) closeInfo(); });
    el.addEventListener('click', onInfoClick);
    el.addEventListener('input', onInfoInput);
    el.addEventListener('change', onInfoInput);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && info) closeInfo(); });
    return el;
}

/** From the wand menu: one pet in this room → its window; several → pick one first. */
function openInfoFromMenu() {
    const here = residents();
    if (here.length === 1) return openInfo(here[0].id);
    const el = ensureInfoEl();
    const box = el.querySelector('.tavvy-modal-box');
    info = { el, id: null, chooser: true };
    box.innerHTML = `<div class="tavvy-info-head"><div class="tavvy-info-title"><b>펫 정보</b><span>${here.length ? '어떤 펫을 볼까요?' : (room ? '이 방에는 아직 펫이 없어요.' : '열려 있는 채팅방이 없어요.')}</span></div><div class="tavvy-x fa-solid fa-xmark" data-close title="닫기"></div></div>
  <div class="tavvy-choose">${here.map(p => `<div class="tavvy-choice" data-pick="${esc(p.id)}"><img src="${esc(imgUrl(p.look?.roles?.idle?.[0]))}" alt=""><b>${esc(p.name)}</b></div>`).join('')}</div>
  ${here.length ? '' : '<div class="tavvy-note">확장 설정의 Tavvy에서 새 펫을 만들 수 있어요.</div>'}`;
    el.hidden = false;
}

function openInfo(id, tab = 'journal') {
    const p = root?.pets.find(x => x.id === id);
    if (!p) return;
    const el = ensureInfoEl();
    info = { el, id, tab, file: null, prep: null, base: infoBase(p) };
    const box = el.querySelector('.tavvy-modal-box');
    const pers = Object.entries(PERSONALITIES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    box.innerHTML = `
  <div class="tavvy-info-head">
    <img class="tavvy-info-img" alt="">
    <div class="tavvy-info-title"><b class="tavvy-info-name"></b><span class="tavvy-info-sub"></span></div>
    <div class="tavvy-x fa-solid fa-xmark" data-close title="닫기"></div>
  </div>
  <div class="tavvy-tabs">
    <div class="tavvy-tab" data-tab="journal">기록장</div>
    <div class="tavvy-tab" data-tab="edit">수정</div>
  </div>
  <div class="tavvy-pane" data-pane="journal"></div>
  <div class="tavvy-pane tavvy-form" data-pane="edit">
    <label>이름 <input class="text_pole" data-f="name" maxlength="20"></label>
    <label>성격 <select class="text_pole" data-f="pers">${pers}</select></label>
    <div class="tavvy-note">성격을 바꾸면 행동은 바로 바뀌어요. 친밀도와 기록은 그대로예요.</div>
    <label>그림이 보는 쪽
      <select class="text_pole" data-f="facing">
        <option value="front">정면</option>
        <option value="right">오른쪽을 봄</option>
        <option value="left">왼쪽을 봄</option>
      </select>
    </label>
    <div class="tavvy-note">그림 한 장이 어느 쪽을 보는지예요. 반대쪽은 자동으로 뒤집어서 써요.</div>
    <label><span>말랑 정도 <span class="tavvy-squish-val"></span></span>
      <input type="range" data-f="squish" min="0" max="1" step="0.1">
    </label>
    <div class="tavvy-sub">그림 바꾸기</div>
    <input type="file" accept="image/png" data-f="file">
    <div class="tavvy-filerow">
      <div class="menu_button" data-act="pick">그림 고르기</div>
      <span class="tavvy-note tavvy-info-filename">바꾸지 않아요</span>
    </div>
    <div class="tavvy-info-prevrow" hidden><img class="tavvy-info-prev" alt=""><label class="checkbox_label"><input type="checkbox" data-f="crop" checked> 투명 여백 자르기</label></div>
    <div class="tavvy-note">투명 배경 PNG 한 장이에요. 저장하면 지금 그림 대신 이 그림을 써요.</div>
    <div class="tavvy-filerow tavvy-info-save">
      <div class="menu_button" data-act="save">저장</div>
      <span class="tavvy-note tavvy-info-msg"></span>
    </div>
  </div>`;
    fillInfoForm(p);
    el.hidden = false;
    showInfoTab(tab);
    refreshInfo();
}

function fillInfoForm(p) {
    const box = info.el;
    const b = info.base = infoBase(p);
    box.querySelector('[data-f="name"]').value = b.name;
    box.querySelector('[data-f="pers"]').value = b.pers;
    box.querySelector('[data-f="facing"]').value = b.facing;
    box.querySelector('[data-f="squish"]').value = b.squish;
    box.querySelector('[data-f="file"]').value = '';
    info.file = null; info.prep = null;
    box.querySelector('.tavvy-info-filename').textContent = '바꾸지 않아요';
    box.querySelector('.tavvy-info-prevrow').hidden = true;
    showSquish();
}

function showSquish() {
    const v = Number(info.el.querySelector('[data-f="squish"]').value);
    info.el.querySelector('.tavvy-squish-val').textContent = v <= 0 ? '(안 말랑)' : `(${Math.round(v * 100)}%)`;
}

function showInfoTab(tab) {
    info.tab = tab;
    info.el.querySelectorAll('.tavvy-tab').forEach(t => t.classList.toggle('tavvy-tab-on', t.dataset.tab === tab));
    info.el.querySelectorAll('.tavvy-pane').forEach(pn => { pn.hidden = pn.dataset.pane !== tab; });
    refreshInfo();
}

/** Header and journal follow the pet live (it may be eating while the window is open). */
function refreshInfo() {
    if (!info || info.chooser || info.el.hidden) return;
    const p = root?.pets.find(x => x.id === info.id);
    if (!p) { info.el.hidden = true; info = null; return; }
    const img = info.el.querySelector('.tavvy-info-img');
    const src = imgUrl(p.look?.roles?.idle?.[0]);
    if (img.getAttribute('src') !== src) img.src = src;
    info.el.querySelector('.tavvy-info-name').textContent = p.name;
    const lv = levelLabel(p);
    info.el.querySelector('.tavvy-info-sub').textContent = `${PERSONALITIES[p.personality?.base]?.name || '?'}${lv ? ' · ' + lv : ''} · ${homeLabel(p)}`;
    if (info.tab === 'journal') {
        const pane = info.el.querySelector('[data-pane="journal"]');
        const html = journalHtml(p);
        if (pane.dataset.html !== html) { pane.innerHTML = html; pane.dataset.html = html; }
    }
}

function infoDirty() {
    if (!info || info.chooser) return false;
    const box = info.el, b = info.base;
    return !!info.file
        || box.querySelector('[data-f="name"]').value !== b.name
        || box.querySelector('[data-f="pers"]').value !== b.pers
        || box.querySelector('[data-f="facing"]').value !== b.facing
        || String(Number(box.querySelector('[data-f="squish"]').value)) !== String(Number(b.squish));
}

let closingInfo = false;
async function closeInfo() {
    if (!info || closingInfo) return;
    if (infoDirty()) {
        closingInfo = true;
        try { if (!(await confirmBox('저장 안 한 내용이 있어요. 닫을까요?'))) return; } finally { closingInfo = false; }
    }
    if (!info) return;
    info.el.hidden = true;
    info = null;
}

function infoMsg(text) {
    const m = info?.el.querySelector('.tavvy-info-msg');
    if (m) m.textContent = text;
}

function onInfoClick(e) {
    if (!info) return;
    if (e.target.closest('[data-close]')) return closeInfo();
    const pick = e.target.closest('[data-pick]');
    if (pick) return openInfo(pick.dataset.pick);
    const tab = e.target.closest('[data-tab]');
    if (tab) return showInfoTab(tab.dataset.tab);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'pick') info.el.querySelector('[data-f="file"]').click();   // SillyTavern hides file inputs → our button
    if (act === 'save') saveInfo();
}

async function onInfoInput(e) {
    if (!info) return;
    const f = e.target.dataset?.f;
    if (f === 'squish') showSquish();
    if (f === 'file' || (f === 'crop' && info.file)) {
        if (e.type !== 'change') return;
        if (f === 'file') info.file = e.target.files?.[0] || null;
        const row = info.el.querySelector('.tavvy-info-prevrow');
        info.el.querySelector('.tavvy-info-filename').textContent = info.file ? info.file.name : '바꾸지 않아요';
        info.prep = null;
        if (!info.file) { row.hidden = true; return; }
        const file = info.file;
        try {
            const out = await preparePng(file, info.el.querySelector('[data-f="crop"]').checked);
            if (!info || info.file !== file) return;
            info.prep = out;
            info.el.querySelector('.tavvy-info-prev').src = out.dataUrl;
            row.hidden = false;
        } catch {
            if (info?.file === file) { infoMsg('그림을 읽지 못했어요. 다른 PNG를 골라 주세요.'); row.hidden = true; }
        }
    }
}

/** Only image files of our own (never the built-in pets' pictures). */
function imageFiles(p) {
    const out = [];
    for (const list of Object.values(p.look?.roles || {})) for (const f of list || []) if (f && !f.startsWith('builtin:')) out.push(f);
    return out;
}

let savingInfo = false;
async function saveInfo() {
    if (!info || info.chooser || savingInfo) return;
    if (readOnly) return infoMsg(readOnlyReason);
    if (!ready) return infoMsg('실리태번이 아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요.');
    const p = root.pets.find(x => x.id === info.id);
    if (!p) return;
    const box = info.el;
    const name = box.querySelector('[data-f="name"]').value.trim();
    if (!name) return infoMsg('이름을 적어 주세요.');
    if (!infoDirty()) return infoMsg('바뀐 게 없어요.');
    const pers = PERSONALITIES[box.querySelector('[data-f="pers"]').value] ? box.querySelector('[data-f="pers"]').value : p.personality.base;
    const facing = ['front', 'left', 'right'].includes(box.querySelector('[data-f="facing"]').value) ? box.querySelector('[data-f="facing"]').value : 'front';
    const squish = clamp(Number(box.querySelector('[data-f="squish"]').value) || 0, 0, 1);
    savingInfo = true;
    let newPath = null;
    try {
        if (info.file) {
            if (info.file.size > 8 * 1024 * 1024) return infoMsg('그림이 너무 커요 (8MB 이하).');
            infoMsg('그림 올리는 중…');
            const img = info.prep || await preparePng(info.file, box.querySelector('[data-f="crop"]').checked);
            newPath = await uploadFile(`tavvy_${p.id}_idle_${Date.now().toString(36)}.png`, img.base64);
        }
        const oldFiles = newPath ? imageFiles(p) : [];
        p.name = name;
        p.personality = { ...(p.personality || {}), base: pers };
        p.look.facing = facing;
        p.look.squish = Math.round(squish * 10) / 10;
        if (newPath) { p.look.roles = { idle: [newPath] }; p.look.kind = 'single'; p.look.baseline = 0; }
        const ok = await saveNow();
        if (ok) for (const f of oldFiles) deleteFile(f);      // old picture only after the record is safely saved
        else saveSoon();
        for (const a of actors) if (a.rec === p) { a.p = PERSONALITIES[pers]; if (newPath) a.reloadLook(); }
        refreshBed();
        renderPanel();
        if (info?.id === p.id) { fillInfoForm(p); refreshInfo(); }
        infoMsg(ok ? '저장했어요.' : '바꿨지만 저장이 늦어지고 있어요. 잠시 뒤 다시 저장돼요.');
    } catch (e) {
        console.error('[Tavvy] edit failed', e);
        if (newPath) deleteFile(newPath);
        infoMsg('저장하지 못했어요: ' + (e.message || e));
    } finally {
        savingInfo = false;
    }
}

/* ---------- the wand menu (✨ left of the input box) ---------- */
function addWandItem() {
    if ($id('tavvy-wand')) return true;
    const menu = $id('extensionsMenu');
    if (!menu) return false;
    const item = document.createElement('div');
    item.id = 'tavvy-wand';
    item.className = 'list-group-item flex-container flexGap5';
    item.innerHTML = '<div class="fa-solid fa-paw extensionsMenuExtensionButton"></div><span>펫 정보</span>';
    item.addEventListener('click', openInfoFromMenu);
    menu.appendChild(item);
    return true;
}

function renderPanel() {
    if (!$id('tavvy-list') || !root) return;
    const warn = $id('tavvy-warn');
    warn.hidden = !readOnly;
    warn.textContent = readOnly ? readOnlyReason : '';
    $id('tavvy-autowake').checked = !!root.settings.autoWake;
    $id('tavvy-stage').value = stageIsChat() ? 'chat' : 'floor';
    $id('tavvy-lines').checked = root.settings.lineLedges !== false;
    $id('tavvy-lines').disabled = !stageIsChat();
    $id('tavvy-badge').checked = root.settings.badge !== false;
    $id('tavvy-hearts').value = root.settings.heartMode || 'both';
    const files = [...(root.settings.backup?.files || [])].reverse();
    const bhtml = files.length
        ? files.map(f => `<option value="${esc(f.day)}">${esc(f.day)} · 펫 ${Number(f.pets) || 0}마리</option>`).join('')
        : '<option value="">아직 백업이 없어요</option>';
    const sel = $id('tavvy-backups');
    if (sel.dataset.html !== bhtml) { sel.innerHTML = bhtml; sel.dataset.html = bhtml; }
    $id('tavvy-restore').classList.toggle('disabled', !files.length || readOnly);

    const here = residents();
    $id('tavvy-room').textContent = !room
        ? '열려 있는 채팅방이 없어요.'
        : here.length ? `이 방에 사는 펫: ${here.map(p => p.name).join(', ')}` : '이 방에는 아직 펫이 없어요.';

    const list = $id('tavvy-list');
    if (!root.pets.length) {
        list.innerHTML = '<div class="tavvy-note">아직 펫이 없어요.</div>';
        list.dataset.html = '';
    } else {
        const html = root.pets.map(p => {
            const pers = PERSONALITIES[p.personality?.base]?.name || '?';
            const icon = imgUrl(p.look?.roles?.idle?.[0]);
            const dev = device();
            const size = petSize(p);
            const lv = levelLabel(p);
            return `<div class="tavvy-row">
  <img src="${esc(icon)}" alt="">
  <div class="tavvy-row-main"><b>${esc(p.name)}</b><span>${pers} · ${homeLabel(p)}${lv ? ' · ' + esc(lv) : ''}</span></div>
  <div class="menu_button tavvy-jbtn" data-info="${esc(p.id)}">정보</div>
  <div class="menu_button tavvy-del" data-del="${esc(p.id)}" title="삭제">삭제</div>
  <label class="tavvy-size">
    <span>크기(${dev === 'phone' ? '폰' : 'PC'})</span>
    <input type="number" class="text_pole" inputmode="numeric" min="${SIZE_MIN}" max="${SIZE_MAX}" step="1" value="${size}" data-size="${esc(p.id)}">
    <span class="tavvy-size-val" data-sizeval="${esc(p.id)}">${sizeLabel(p, size)}</span>
  </label>
</div>`;
        }).join('');
        // don't rebuild while a size box is being typed in (the list refreshes on its own every so often).
        // Only the size box: SillyTavern makes every .menu_button focusable, so a pressed button keeps focus.
        const ae = document.activeElement;
        const typingSize = !!ae && list.contains(ae) && !!ae.matches?.('[data-size]');
        if (html !== list.dataset.html && !typingSize) {
            list.innerHTML = html;
            list.dataset.html = html;
        }
    }
    const btn = $id('tavvy-create');
    btn.classList.toggle('disabled', !room || readOnly);
    refreshInfo();
}

/** Korean particle: josa('보리','이','가') → '보리가', josa('콩떡','이','가') → '콩떡이'. */
function josa(word, withFinal, withoutFinal) {
    const c = word.charCodeAt(word.length - 1);
    if (c < 0xAC00 || c > 0xD7A3) return `${word}${withFinal}(${withoutFinal})`;
    return word + ((c - 0xAC00) % 28 ? withFinal : withoutFinal);
}

function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

let creating = false;

async function createPetFromForm() {
    if (creating) return;
    if (readOnly) return say(readOnlyReason);
    if (!ready) return say('실리태번이 아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요.');
    if (!room) return say('먼저 펫이 살 채팅방을 열어 주세요.');
    const choice = document.querySelector('input[name="tavvy-look"]:checked')?.value;
    if (!choice) return say('모습을 골라 주세요.');
    const name = $id('tavvy-name').value.trim() || (BUILTIN[choice]?.name ?? '');
    if (!name) return say('이름을 적어 주세요.');
    const personality = $id('tavvy-pers').value;

    creating = true;
    const uploaded = [];
    try {
        const id = newId();
        let look;
        if (choice === 'mine') {
            if (!mineFile) return say('PNG 그림을 골라 주세요.');
            if (mineFile.size > 8 * 1024 * 1024) return say('그림이 너무 커요 (8MB 이하).');
            say('그림 올리는 중…');
            const img = await preparePng(mineFile, $id('tavvy-crop').checked);
            const path = await uploadFile(`tavvy_${id}_idle_0.png`, img.base64);
            uploaded.push(path);
            look = { kind: 'single', facing: $id('tavvy-facing').value, roles: { idle: [path] }, baseline: 0, size: { ...DEFAULT_SIZE }, squish: 0.5 };
        } else {
            look = builtinLook(choice);
        }
        const rec = newPetRecord({ id, name, personality, look });
        rec.home = { chatId: room.chatId, integrity: room.integrity };
        root.pets.push(rec);
        const ok = await saveNow();
        if (!ok && readOnly) {
            root.pets.pop();
            for (const p of uploaded) deleteFile(p);
            return say(readOnlyReason);
        }
        say(ok ? `${josa(name, '이', '가')} 이 방에 왔어요! 🛏️ 버튼을 눌러 깨워 보세요.` : `${josa(name, '을', '를')} 만들었지만 저장이 늦어지고 있어요. 잠시 뒤 다시 저장돼요.`);
        if (!ok) saveSoon();
        $id('tavvy-name').value = '';
        refreshBed();
        renderPanel();
    } catch (e) {
        console.error('[Tavvy] create failed', e);
        for (const p of uploaded) deleteFile(p);
        say('펫을 만들지 못했어요: ' + (e.message || e));
    } finally {
        creating = false;
    }
}

async function confirmBox(text) {
    const c = ctx();
    if (typeof c.callGenericPopup === 'function' && c.POPUP_TYPE) {
        return !!(await c.callGenericPopup(text, c.POPUP_TYPE.CONFIRM));
    }
    return window.confirm(text);
}

async function deletePet(id) {
    if (readOnly) return say(readOnlyReason);
    const i = root.pets.findIndex(p => p.id === id);
    if (i < 0) return;
    const pet = root.pets[i];
    if (!(await confirmBox(`${josa(pet.name, '을', '를')} 정말 지울까요? 기록과 그림도 함께 사라져요.`))) return;
    for (const a of [...actors]) if (a.rec === pet) { a.onGone = null; a.vanish(); }
    root.pets.splice(i, 1);
    const ok = await saveNow();
    if (ok) for (const p of petFiles(pet)) deleteFile(p);   // files only after the record is safely saved
    else saveSoon();
    refreshBed();
    renderPanel();
    say(`${josa(pet.name, '을', '를')} 지웠어요.`);
}

/* =====================================================================
 * Boot
 * ===================================================================== */

function onReady() {
    if (ready) return;
    ready = true;
    log('ready', { pets: root?.pets.length ?? 0, readOnly });
    onChatChanged();
    setTimeout(maybeBackup, 8000);
    setInterval(maybeBackup, 15 * 60 * 1000);     // also when the day changes while open
}

(function init() {
    loadRoot();
    bindPanel();
    ensureLayer();
    measure();

    eventSource.on(event_types.CHAT_CHANGED, () => { if (ready) onChatChanged(); });
    eventSource.on(event_types.APP_READY, onReady);
    const on = (name, fn) => { if (event_types[name]) eventSource.on(event_types[name], fn); };
    on('GENERATION_STARTED', (type, opts, dryRun) => { if (ready) onGenStart(type, opts, dryRun); });
    on('STREAM_TOKEN_RECEIVED', () => onStreamToken());
    on('GENERATION_ENDED', () => onGenEnd());
    on('GENERATION_STOPPED', () => onGenEnd());
    on('MESSAGE_RECEIVED', (id, type) => { if (ready) onReplyReceived(id, type); });
    on('USER_MESSAGE_RENDERED', (id) => { if (ready) onMySend(id); });
    on('MESSAGE_SENT', (id) => { noteUserAct(); wakeSleepy(); onCounted(id, true); });
    // messages added / removed / reloaded → ledges moved
    const ledgesMoved = () => { if (actors.length) requestAnimationFrame(measurePlats); };
    ['MESSAGE_DELETED', 'MORE_MESSAGES_LOADED', 'MESSAGE_SWIPED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED'].forEach(n => on(n, ledgesMoved));
    // the chat scrolling (capture: the chat box scrolls by itself, not the window)
    let st = 0;
    document.addEventListener('scroll', () => {
        if (!actors.length) return;
        noteUserAct();
        if (st) return;
        st = requestAnimationFrame(() => { st = 0; measurePlats(); });
    }, { capture: true, passive: true });
    // you: writing in the input box, where your hand / finger is
    document.addEventListener('input', (e) => { if (e.target?.id === 'send_textarea') onTyping(); }, true);
    const seeHand = (e) => { if (!actors.length) return; hand.x = e.clientX; hand.y = e.clientY; hand.t = performance.now(); };
    document.addEventListener('pointermove', seeHand, { capture: true, passive: true });
    document.addEventListener('pointerdown', seeHand, { capture: true, passive: true });
    setInterval(bedWiggle, 500);
    // "펫 정보" in the wand menu (the menu may be built a little after us)
    if (!addWandItem()) { let n = 0; const w = setInterval(() => { if (addWandItem() || ++n > 30) clearInterval(w); }, 1000); }
    // Safety net for versions where APP_READY already fired before we loaded.
    setTimeout(() => { if (!ready && document.getElementById('send_form')) onReady(); }, 4000);

    let mt = 0;
    const remeasure = () => { cancelAnimationFrame(mt); mt = requestAnimationFrame(measure); };
    window.addEventListener('resize', remeasure);
    window.addEventListener('orientationchange', () => setTimeout(measure, 250));
    window.visualViewport?.addEventListener('resize', remeasure);
    window.visualViewport?.addEventListener('scroll', remeasure);
    window.addEventListener('scroll', remeasure, { passive: true });
    document.addEventListener('focusin', () => setTimeout(measure, 350));
    document.addEventListener('focusout', () => setTimeout(measure, 350));
    // coming back from another app (iPhone may shift or resize the page while we were away)
    const onReturn = () => {
        if (document.hidden) return;
        measure(); recheckRoom();
        setTimeout(() => { measure(); recheckRoom(); }, 300);
        setTimeout(() => { measure(); recheckRoom(); }, 1200);
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onReturn);
    window.addEventListener('focus', onReturn);
    // cheap safety net while everyone is asleep (the awake loop already re-measures)
    setInterval(() => {
        if (document.hidden) return;
        recheckRoom();
        if (!actors.length && bed && !bed.hidden) measure();
    }, 2000);
    const sf = document.getElementById('send_form');
    if (sf && 'ResizeObserver' in window) new ResizeObserver(remeasure).observe(sf);

    // keep "last visit" fresh while staying in a room
    setInterval(() => {
        if (!document.hidden && room) {
            const here = residents();
            if (here.length) { const now = Date.now(); here.forEach(p => { p.lastVisit = now; }); saveSoon(); }
        }
    }, 5 * 60 * 1000);

    renderPanel();
})();
