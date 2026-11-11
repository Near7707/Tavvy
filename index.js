// Tavvy — a tiny companion that lives in your SillyTavern chat room.
// Stage 1: data skeleton & safety rails.
// Stage 2: bed button, life on the floor (breathe / walk / doze), dangling, falling.

import { saveSettings, saveSettingsDebounced, getRequestHeaders, eventSource, event_types } from '../../../../script.js';

const MODULE = 'tavvy';
const FORMAT_VERSION = 1;
const BASE = new URL('.', import.meta.url).href;
const log = (...a) => console.log('[Tavvy]', ...a);
const ctx = () => SillyTavern.getContext();

/* =====================================================================
 * Constants
 * ===================================================================== */

const PERSONALITIES = {
    aegyo:   { name: '애교쟁이', speed: 72, idle: [1.5, 3.5], doze: 0.06, dozeLen: [3, 6],  tap: '♥' },
    saechim: { name: '새침데기', speed: 55, idle: [2, 5],     doze: 0.10, dozeLen: [3, 7],  tap: '?' },
    neugut:  { name: '느긋쟁이', speed: 30, idle: [3, 6],     doze: 0.35, dozeLen: [6, 14], tap: '♪' },
    simsul:  { name: '심술쟁이', speed: 58, idle: [2, 4.5],   doze: 0.08, dozeLen: [3, 6],  tap: '💢' },
    musim:   { name: '무심쟁이', speed: 42, idle: [3, 7],     doze: 0.12, dozeLen: [4, 9],  tap: '…' },
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
const GRAVITY = 2400;           // px/s²
const HOLD_SWING_MAX = 15;      // degrees
const DRAG_THRESHOLD = 8;       // px — bed button: tap vs drag
const PICK_THRESHOLD = 6;       // px — pet: tap vs pick up
const PICK_DELAY = 220;         // ms — press and hold also picks up

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
const stage = { floorY: 0, left: 0, right: 0, vw: 0, vh: 0, ox: 0, oy: 0 };

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
        this.frameT = 0; this.frame = 0;
        this.fxT = 0;
        this.grab = { x: 0, y: 0 };
        this.ptr = { x: 0, y: 0, vx: 0, lastX: 0, lastT: 0 };
        this.w = 64; this.h = 64; this.natW = 64; this.natH = 64;
        this.curSrc = '';
        this.gone = false;
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
        const L = stage.left + this.w / 2, R = stage.right - this.w / 2;
        if (!this.held) this.x = R > L ? clamp(this.x, L, R) : (stage.left + stage.right) / 2;
        if (this.state === 'walk') this.tx = clamp(this.tx, L, R);
        if (this.y > stage.floorY - 4) this.y = Math.max(0, stage.floorY - this.h);   // keep on screen
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
        if (this.y <= 0) { this.y = 0; this.land(0); }
        else { this.air = true; this.next = 'idle'; this.setState('fall'); }
    }

    land(impact) {
        this.air = false;
        this.vy = 0; this.vx = 0;
        this.body.style.transformOrigin = '';
        const soft = (this.rec.look.squish ?? 0.5) * 2;
        if (soft > 0) this.sq = 1 - Math.min(0.32, impact / 3200) * soft;
        const n = this.next || 'idle';
        this.next = null;
        this.setState(n);
    }

    setState(s) {
        this.state = s; this.t = 0;
        if (s === 'idle') { this.until = rand(...this.p.idle); this.tiltT = 0; }
        if (s === 'doze') { this.until = rand(...this.p.dozeLen); this.fxT = 0.6; }
        if (s === 'walk') { this.tiltT = 0; }
    }

    decide() {
        const r = Math.random();
        if (r < this.p.doze) return this.setState('doze');
        if (r < this.p.doze + 0.62) {
            const L = stage.left + this.w / 2, R = stage.right - this.w / 2;
            if (R - L < 10) return this.setState('idle');
            let tx = rand(L, R);
            if (Math.abs(tx - this.x) < 30) tx = clamp(this.x + (Math.random() < 0.5 ? -1 : 1) * rand(40, 140), L, R);
            this.tx = tx;
            const d = tx > this.x ? 1 : -1;
            if (d !== this.dir && this.side) {
                // flip with a little hop
                this.dir = d;
                this.air = true; this.vy = 280; this.vx = 0; this.next = 'walk';
                return;
            }
            this.dir = d;
            return this.setState('walk');
        }
        return this.setState('idle');
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
        } else if (this.air) {
            this.vy -= GRAVITY * dt;
            this.y += this.vy * dt;
            this.x = clamp(this.x + this.vx * dt, L, Math.max(L, R));
            if (this.y <= 0) { const impact = -this.vy; this.y = 0; this.land(impact); }
            pose = this.state === 'fall' ? this.role('fall', 'surprise') : this.role('jump', 'idle');
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
                    if (Math.abs(d) <= sp * dt) { this.x = this.tx; this.setState('idle'); break; }
                    this.x += Math.sign(d) * sp * dt;
                    const rate = sp / 22;
                    bob = Math.abs(Math.sin(this.clock * rate * Math.PI)) * 2 * this.k;
                    waddle = Math.sin(this.clock * rate * Math.PI) * 1.5;
                    const frames = this.role('walk');
                    this.frameT += dt;
                    if (this.frameT > 0.5 / rate * 2) { this.frameT = 0; this.frame++; }
                    pose = frames;
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
        spring(this, 'sq', 'sqv', 1, 260, 0.32, dt);

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
    if (remeasureT > 0.25) { remeasureT = 0; measure(); }
    else {
        const ox = stage.ox, oy = stage.oy;
        measureOrigin();
        if (ox !== stage.ox || oy !== stage.oy) placeBed();
    }
    for (const a of [...actors]) a.step(dt);
    if (actors.length) raf = requestAnimationFrame(tick);
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
    return clampBed(saved && typeof saved.x === 'number' ? saved : defaultBedPos());
}

function setBedPos(x, y, save) {
    const p = clampBed({ x, y });
    bed.style.transform = `translate3d(${p.x - stage.ox}px, ${p.y - stage.oy}px, 0)`;
    if (save && root) {
        root.settings.bedPos[device()] = { x: Math.round(p.x), y: Math.round(p.y) };
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
 * Room changes
 * ===================================================================== */

async function onChatChanged() {
    sleepInstant();
    room = readRoom();
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
    $id('tavvy-file').addEventListener('change', async (e) => {
        mineFile = e.target.files?.[0] || null;
        const prev = $id('tavvy-mine-prev');
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
}

/** Diagnostic: bring the bed to the middle of the screen and report what the page sees. */
function findBed() {
    measure();
    refreshBed();
    const lines = [];
    lines.push(`준비: ${ready ? '됨' : '안 됨'} · 이 방 펫: ${residents().length}`);
    lines.push(`화면 ${Math.round(stage.vw)}×${Math.round(stage.vh)} · 바닥 ${Math.round(stage.floorY)} · ${device()}`);
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

function renderPanel() {
    if (!$id('tavvy-list') || !root) return;
    const warn = $id('tavvy-warn');
    warn.hidden = !readOnly;
    warn.textContent = readOnly ? readOnlyReason : '';
    $id('tavvy-autowake').checked = !!root.settings.autoWake;

    const here = residents();
    $id('tavvy-room').textContent = !room
        ? '열려 있는 채팅방이 없어요.'
        : here.length ? `이 방에 사는 펫: ${here.map(p => p.name).join(', ')}` : '이 방에는 아직 펫이 없어요.';

    const list = $id('tavvy-list');
    if (!root.pets.length) {
        list.innerHTML = '<div class="tavvy-note">아직 펫이 없어요.</div>';
    } else {
        list.innerHTML = root.pets.map(p => {
            const pers = PERSONALITIES[p.personality?.base]?.name || '?';
            const icon = imgUrl(p.look?.roles?.idle?.[0]);
            return `<div class="tavvy-row">
  <img src="${esc(icon)}" alt="">
  <div class="tavvy-row-main"><b>${esc(p.name)}</b><span>${pers} · ${homeLabel(p)}</span></div>
  <div class="menu_button tavvy-del" data-del="${esc(p.id)}" title="삭제">삭제</div>
</div>`;
        }).join('');
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
    const onReturn = () => { if (!document.hidden) { measure(); setTimeout(measure, 300); setTimeout(measure, 1000); } };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onReturn);
    window.addEventListener('focus', onReturn);
    // cheap safety net while everyone is asleep (the awake loop already re-measures)
    setInterval(() => { if (!actors.length && bed && !bed.hidden && !document.hidden) measure(); }, 2000);
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
