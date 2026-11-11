// Tavvy — a tiny companion that lives in your SillyTavern chat room.
// Stage 1: data skeleton & safety rails.
// Stage 2: bed button, life on the floor (breathe / walk / doze), dangling, falling.
// Stage 3: the whole chat is the stage — message ledges, riding them, climbing up, hopping off the
//          end, falling back in from the top, line borders as ledges, waiting for / watching
//          replies, and a little reaction when you send a message.

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
const PERSONALITIES = {
    aegyo:   { name: '애교쟁이', speed: 72, idle: [1.5, 3.5], doze: 0.06, dozeLen: [3, 6],  tap: '♥',  climb: [0.16, 0.24], perch: [2, 5],   land: '♥',  send: '♥',  bump: '♥' },
    saechim: { name: '새침데기', speed: 55, idle: [2, 5],     doze: 0.10, dozeLen: [3, 7],  tap: '?',  climb: [0.07, 0.12], perch: [2, 5],   land: 'flick', send: 'glance', bump: 'flick' },
    neugut:  { name: '느긋쟁이', speed: 30, idle: [3, 6],     doze: 0.35, dozeLen: [6, 14], tap: '♪',  climb: [0.02, 0.04], perch: 'doze',   land: '하암', send: '♪',  bump: '?' },
    simsul:  { name: '심술쟁이', speed: 58, idle: [2, 4.5],   doze: 0.08, dozeLen: [3, 6],  tap: '💢', climb: [0.07, 0.12], perch: [2, 5],   land: '💢', send: '흥',  bump: '💢' },
    musim:   { name: '무심쟁이', speed: 42, idle: [3, 7],     doze: 0.12, dozeLen: [4, 9],  tap: '…',  climb: [0.08, 0.14], perch: [8, 16],  land: '…',  send: '…',  bump: 'aside' },
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
const BUMP_CHANCE = 0.2;        // the rest just walk past each other
const BUMP_REST = 60;           // seconds — after a bump, the same two pets just pass each other for this long

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
        today: { day: null, eaten: 0 },
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

// Closeness (5단계). Until then everyone starts at "처음 ♡".
const closeness = () => 0;
const byCloseness = (lo, hi) => lo + (hi - lo) * closeness() / 100;

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
        return !this.held && !this.air && !['off', 'tuck', 'wave', 'crouch', 'appear'].includes(this.state);
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
            if (!down || this.held || this.state === 'tuck' || this.state === 'wave') return;
            const left = this.x - this.w / 2;
            const top = stage.floorY - this.y - this.h;
            this.grab.x = clamp(down.x - left, 0, this.w);
            this.grab.y = clamp(down.y - top, 0, this.h);
            this.held = true; this.air = false; this.next = null;
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
            try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            down = { x: e.clientX, y: e.clientY, picked: false };
            timer = setTimeout(() => pick(null), PICK_DELAY);
        });
        this.el.addEventListener('pointermove', (e) => {
            if (!down) return;
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
            clearTimeout(timer);
            if (!down) return;
            const wasPicked = down.picked;
            down = null;
            try { this.el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            if (wasPicked && this.held) this.release();
            else if (!wasPicked && e.type === 'pointerup') this.tap();
        };
        this.el.addEventListener('pointerup', end);
        this.el.addEventListener('pointercancel', end);
    }

    tap() {
        if (this.state === 'tuck' || this.state === 'wave' || this.held) return;
        if (!this.air) { this.air = true; this.vy = 300; this.vx = 0; this.next = 'idle'; }
        fx(this, this.p.tap);
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
        if (this.landReact) {
            this.landReact = false;
            this.after = n;
            return this.startLook(this.p.land, this.x + this.dir * 40);
        }
        if (this.bumpReact) {
            this.bumpReact = false;
            const o = this.bumpWith; this.bumpWith = null;
            const ox = o && !o.gone ? o.x : this.x + this.dir * 40;
            if (this.p.bump === 'aside') {                // 무심쟁이: "…" and steps out of the way
                fx(this, '…');
                const [L, R] = this.range();
                const away = ox >= this.x ? -1 : 1;
                const tx = clamp(this.x + away * rand(50, 90), L, Math.max(L, R));
                if (Math.abs(tx - this.x) > 10) { this.dir = away; this.tx = tx; this.edge = false; return this.setState('walk'); }
                return this.setState(n);
            }
            this.after = n;
            return this.startLook(this.p.bump, ox);
        }
        this.setState(n);
    }

    setState(s) {
        this.state = s; this.t = 0;
        this.sqT = 1;
        if (s === 'idle') { this.until = rand(...this.p.idle); this.tiltT = 0; }
        if (s === 'doze') { this.until = rand(...this.p.dozeLen); this.fxT = 0.6; }
        if (s === 'walk') { this.tiltT = 0; this.walkPh = 0; }
        if (s === 'perch') {
            if (this.p.perch === 'doze') return this.setState('doze');
            this.until = rand(...this.p.perch);
            this.tiltT = 0;
            if (this.rec.personality?.base === 'musim') fx(this, '…');
        }
        if (s === 'wait') { this.fxT = rand(0.4, 1.2); this.scanT = 0.6; }
        if (s === 'watch') { this.fxT = 0; this.until = 2.8; }
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
        if (gen.active && this.waiting) return this.setState('wait');
        const r = Math.random();
        if (r < this.p.doze) return this.setState('doze');
        // hop up onto a message by itself
        if (ledgesOn() && Math.random() < byCloseness(...this.p.climb)) {
            const t = this.pickClimb();
            if (t && this.climbTo(t, 'perch')) return;
        }
        // while a reply is being written, sometimes glance at the chat (more often when curious)
        if (gen.active && Math.random() < (this.fidgety() ? 0.45 : 0.3)) return this.startLook('peek', (stage.left + stage.right) / 2);
        if (r < this.p.doze + 0.62) {
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
        const list = this.reachable();
        if (!list.length) return null;
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
        this.air = true; this.next = 'idle';
        this.scale = 0.3;
        this.setState('appear');
    }

    goToBed(done) {
        if (this.held) { this.held = false; this.el.classList.remove('tavvy-held'); this.body.style.transformOrigin = ''; }
        this.onGone = done;
        this.waiting = false;
        if (this.state === 'off') { this.vanish(); bumpBed(); return; }
        this.plat = null;      // waves where it is, then goes into the bed (doesn't ride a ledge away)
        this.air = false;
        this.setState('wave');
        this.tiltT = 0;
    }

    vanish() {
        if (this.gone) return;
        this.gone = true;
        this.el.remove();
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
                    if (this.t > this.until) this.decide();
                    break;
                case 'walk': {
                    const d = this.tx - this.x;
                    const sp = this.p.speed;
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
        this.body.style.transform = `rotate(${(this.tilt + waddle).toFixed(2)}deg) scale(${(sx * this.scale).toFixed(3)}, ${(sy * this.scale).toFixed(3)})`;
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
    }
    else {
        const ox = stage.ox, oy = stage.oy;
        measureOrigin();
        if (ox !== stage.ox || oy !== stage.oy) placeBed();
    }
    for (const a of [...actors]) a.step(dt);
    if (actors.length > 1) bumpCheck();
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
    bed.innerHTML = '<span class="tavvy-bed-icon">🛏️</span><span class="tavvy-bed-z">z</span>';
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

function refreshBed() {
    const here = residents();
    if (!here.length) { if (bed) bed.hidden = true; return; }
    ensureBed();
    bed.hidden = false;
    bed.classList.toggle('tavvy-awake', actors.length > 0);
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
        for (const rec of here) {
            const a = new Actor(rec);
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
        for (const a of actors) if (!a.waiting && Math.random() < byCloseness(0.3, 0.85)) a.startWait();
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
            if (Math.random() < byCloseness(0.3, 0.85)) a.watchReply(el);
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
            if (!a.free() || Math.random() >= byCloseness(0.3, 0.85)) continue;
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
    if (root?.settings.autoWake && residents().length) wakeAll();
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
      <div id="tavvy-bedreset" class="menu_button">깨우기 버튼 위치 처음으로</div>
      <div id="tavvy-bedfind" class="menu_button">깨우기 버튼 찾기 (화면 가운데로)</div>
      <div id="tavvy-diag" class="tavvy-note tavvy-diag"></div>
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
    $id('tavvy-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-del]');
        if (btn) deletePet(btn.dataset.del);
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

function renderPanel() {
    if (!$id('tavvy-list') || !root) return;
    const warn = $id('tavvy-warn');
    warn.hidden = !readOnly;
    warn.textContent = readOnly ? readOnlyReason : '';
    $id('tavvy-autowake').checked = !!root.settings.autoWake;
    $id('tavvy-stage').value = stageIsChat() ? 'chat' : 'floor';
    $id('tavvy-lines').checked = root.settings.lineLedges !== false;
    $id('tavvy-lines').disabled = !stageIsChat();

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
            return `<div class="tavvy-row">
  <img src="${esc(icon)}" alt="">
  <div class="tavvy-row-main"><b>${esc(p.name)}</b><span>${pers} · ${homeLabel(p)}</span></div>
  <div class="menu_button tavvy-del" data-del="${esc(p.id)}" title="삭제">삭제</div>
  <label class="tavvy-size">
    <span>크기(${dev === 'phone' ? '폰' : 'PC'})</span>
    <input type="number" class="text_pole" inputmode="numeric" min="${SIZE_MIN}" max="${SIZE_MAX}" step="1" value="${size}" data-size="${esc(p.id)}">
    <span class="tavvy-size-val" data-sizeval="${esc(p.id)}">${sizeLabel(p, size)}</span>
  </label>
</div>`;
        }).join('');
        // don't rebuild while a size box is being typed in (the list refreshes on its own every so often)
        if (html !== list.dataset.html && !list.contains(document.activeElement)) {
            list.innerHTML = html;
            list.dataset.html = html;
        }
    }
    const btn = $id('tavvy-create');
    btn.classList.toggle('disabled', !room || readOnly);
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
    // messages added / removed / reloaded → ledges moved
    const ledgesMoved = () => { if (actors.length) requestAnimationFrame(measurePlats); };
    ['MESSAGE_DELETED', 'MORE_MESSAGES_LOADED', 'MESSAGE_SWIPED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED'].forEach(n => on(n, ledgesMoved));
    // the chat scrolling (capture: the chat box scrolls by itself, not the window)
    let st = 0;
    document.addEventListener('scroll', () => {
        if (!actors.length || st) return;
        st = requestAnimationFrame(() => { st = 0; measurePlats(); });
    }, { capture: true, passive: true });
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
