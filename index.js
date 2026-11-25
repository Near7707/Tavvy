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
//          softer reactions, and little gifts.
// 0.6.0: one Tavvy window (pet list, journal, behaviours, looks, settings) + saved looks.
// 0.7.0: the window fits above the phone keyboard, "작별하기", a night-sky window colour;
//        pictures for each action (several frames, speed, which way each one faces),
//        speech lines for little moments (optionally filled in by AI), and special days.
// 0.7.3: no more pressing against the screen; squishing only as much as 말랑 정도 says;
//        a gentler lean, no shiver while held, the window stays whole while the keyboard goes down.
// 0.7.4: no leaning into a pat; moving a pet to this room, copying it here, pet files and PNG cards.
// 0.7.5: cut a picture by hand when uploading; split a sheet into frames (find them, or rows × columns).
// 0.7.6: share one sheet out to several actions; frames move both ways.
// 0.7.8: 벽 오르기 · 화면 산책 — goes up a side of the chat and strolls anywhere on the screen.
// 0.7.9: a full tummy no longer means sleeping the day away (and doesn't stop 벽 오르기);
//        two new speech moments — when a reply comes in, when I send a message.
// 0.7.10: 벽 오르기 much more often for now (to watch it) — to be tuned.
// 0.7.11: on the screen it climbs (mostly straight up and down, pull by pull) instead of walking around;
//         a full tummy is just cute now (pats its tummy ♪, rolls) — no extra naps, no slow walking.
// 0.7.12: no more going up a side wall — it starts climbing the screen right where it stands and climbs
//         back down the same way; never naps up on the screen (only on the floor / a message); a smaller bed.
// 0.7.13: ways to get about on the screen, chosen per pet — 오르기 (climb) / 날기 (float in soft curves) /
//         휙휙 (dart, stop, dart, leaving afterimages); closeness stages renamed.
// 0.7.14: the ways to get about save as soon as they're ticked; 행동 tab switches to turn behaviours on / off per pet.
// 0.8.0: the personality is a preset — 빈도 (끔/드물게/보통/자주) per behaviour, 걸음 빠르기, and which personality's reaction shows at each moment.
// 0.7.7: less standing and staring — little things on the spot, livelier waiting on a message,
//        longer naps that sending / a reply no longer cut short, a much smaller lean at the input box.

import { saveSettings, saveSettingsDebounced, getRequestHeaders, eventSource, event_types } from '../../../../script.js';

const MODULE = 'tavvy';
const FORMAT_VERSION = 1;
const BASE = new URL('.', import.meta.url).href;
const log = (...a) => console.log('[Tavvy]', ...a);
const ctx = () => SillyTavern.getContext();

/* 0.11.0 언어 (Language): 'ko' / 'en'. ⚙ 설정의 자동/한국어/English — 바꾸면 새로고침 뒤에 적용.
 * 자동 = 실리태번 화면 언어나 브라우저 언어가 한국어면 한국어, 아니면 English. */
const LANG = (() => {
    try {
        const pick = SillyTavern.getContext().extensionSettings?.[MODULE]?.settings?.lang;
        if (pick === 'ko' || pick === 'en') return pick;
        const st = String(localStorage.getItem('language') || ''), nav = String(navigator.language || '');
        return /^ko/i.test(st) || /^ko/i.test(nav) ? 'ko' : 'en';
    } catch { return 'ko'; }
})();
const LX = (ko, en) => (LANG === 'ko' ? ko : en);
const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 날짜 글자: 5월 3일 / May 3 (올해가 아니면 연도도). */
function dateText(y, m, d) {
    const other = y !== new Date().getFullYear();
    return LX(`${other ? `${y}년 ` : ''}${m}월 ${d}일`, `${EN_MON[m - 1] || m} ${d}${other ? `, ${y}` : ''}`);
}

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
// wall:  chance to go up a wall and stroll on the screen (벽 오르기 · 화면 산책) when it decides by itself
const PERSONALITIES = {
    aegyo:   { name: LX('애교', 'Sweet'), speed: 72, idle: [0.8, 2],   doze: 0.06, dozeLen: [6, 12], tap: '♥',  climb: [0.16, 0.24], perch: [2, 5],   land: '♥',  send: '♥',  bump: '♥',     me: [0.60, 0.95], eat: 0.7, wall: 0.4 },
    saechim: { name: LX('새침', 'Prim'), speed: 55, idle: [1.2, 3],   doze: 0.10, dozeLen: [6, 12], tap: '?',  climb: [0.07, 0.12], perch: [2, 5],   land: 'flick', send: 'glance', bump: 'flick', me: [0.15, 0.60], eat: 1, fussy: true, wall: 0.4 },
    neugut:  { name: LX('느긋', 'Easygoing'), speed: 30, idle: [2, 4],     doze: 0.35, dozeLen: [12, 24], tap: '♪',  climb: [0.02, 0.04], perch: 'doze',   land: 'yawn', send: '♪',  bump: '?',     me: [0.15, 0.50], eat: 1.3, wall: 0.4 },
    simsul:  { name: LX('심술', 'Grumpy'), speed: 58, idle: [1.2, 3],   doze: 0.08, dozeLen: [6, 11], tap: '💢', climb: [0.07, 0.12], perch: [2, 5],   land: '💢', send: 'hmph',  bump: '💢',    me: [0.20, 0.60], eat: 1, fussy: true, wall: 0.4 },
    musim:   { name: LX('무심', 'Aloof'), speed: 42, idle: [2, 4.5],   doze: 0.12, dozeLen: [8, 16], tap: '…',  climb: [0.08, 0.14], perch: [8, 16],  land: '…',  send: '…',  bump: 'aside', me: [0.05, 0.25], eat: 1, wall: 0.4 },
};

// Built-in pets (original characters made for this project).
// baseline = transparent rows under the feet in the source image (source px).
const BUILTIN = {
    kongtteok: {
        name: LX('콩떡', 'Mochi'), facing: 'front', baseline: 2,
        roles: {
            idle: ['idle.png'], sleep: ['sleep.png'], happy: ['happy.png'],
            walk: ['walk1.png', 'walk2.png'], cry: ['cry.png'], surprise: ['surprise.png'],
            eat: ['eat1.png', 'eat2.png'],
        },
    },
    bori: {
        name: LX('보리', 'Barley'), facing: 'right', baseline: 4,
        roles: {
            idle: ['idle.png'], sleep: ['sleep.png'], happy: ['happy.png'],
            walk: ['walk1.png', 'walk2.png'], cry: ['cry.png'], surprise: ['surprise.png'],
            eat: ['eat1.png', 'eat2.png'], sit: ['sit.png'],
        },
    },
    danchu: {
        name: LX('단추', 'Button'), facing: 'front', baseline: 2,
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
const LATE_WAIT = 60;           // s — 0.10.6: still not a word of the reply after this long → "답이 늦어질 때" line (once per reply)
const BUMP_DIST = 0.42;         // × (sum of both widths) — how close two pets get before they bump
const BUMP_CHANCE = 0.15;       // × 빈도 (부딪히기, the lower of the two) — the rest just walk past each other (0.10.9: was 0.05)
const BUMP_REST = 120;          // seconds — after a bump, the same two pets just pass each other for this long (0.10.9: was 300)

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
    { name: LX('아는 사이', 'Acquaintance'), min: 0,   hearts: '♡' },
    { name: LX('친구', 'Friend'), min: 30,  hearts: '♥' },
    { name: LX('친한 친구', 'Close friend'), min: 100, hearts: '♥♥' },
    { name: LX('단짝', 'Best friend'), min: 220, hearts: '♥♥♥' },
    { name: LX('내편', 'Always yours'), min: 400, hearts: '♥♥♥♥' },
];
const CLOSE = 50;               // closeness from which "친하면" reactions show (friends)
const ME_SCALE = 0.3;           // "react to you" chance × this when it decides by itself
const ME_REST = 30;             // s — not twice in a row within this (0.11.7: was 15)
const ME_LOOK = 1.2;            // s — 0.11.7: it just looks at you this long before reacting
const ME_HOLD = 0.6;            // s — 0.11.7: and stays like that a little after
// 0.9.0: everyday behaviours of their own (no new pictures needed). Chance each time it decides what's next (× 빈도).
const NEW_ACTS = { hum: 0.07, scan: 0.08, sit: 0.07, peek: 0.04, roll: 0.04 };
// 0.10.0 선물 주기: pictures you give a pet — now and then it takes one out
const PRESENT_ACTS = [
    { key: 'pr_look', name: LX('구경하기', 'Looking at it') },
    { key: 'pr_roll', name: LX('굴리며 놀기', 'Rolling it around') },
    { key: 'pr_toss', name: LX('던졌다 받기', 'Toss and catch') },
    { key: 'pr_show', name: LX('자랑하기', 'Showing it off') },
    { key: 'pr_give', name: LX('나에게 내밀기', 'Holding it out to you') },
    { key: 'pr_hug',  name: LX('끼고 자기', 'Sleeping with it') },
];
const GIFT_FAV_P = 0.5;         // 0.10.13 가장 좋아하는 선물: 꺼낼 때 이만큼은 그 선물 (나머지는 다 같이 고르게)
const LEDGE_ROLL_ROOM = 150;    // 0.10.13 px — 말풍선 위 굴리기: 펫·선물 말고 이만큼 더 넓어야 굴려요
const PRESENT_P = { pr_look: 0.04, pr_roll: 0.025, pr_toss: 0.025, pr_show: 0.025, pr_give: 0.025, pr_hug: 0.35 };   // × 빈도 (처음엔 드물게)
const GIFT_MAX = 6;
const GIFT_MEMO = 100;                               // 0.10.2 선물 메모
const GIFT_SIZES = [['s', LX('작게', 'Small'), 0.32], ['m', LX('보통', 'Normal'), 0.45], ['l', LX('크게', 'Large'), 0.6]];   // × the pet's height
const TOY_G = 1600;                         // a present's gravity (px/s²)
const isPres = (key) => PRESENT_ACTS.some(a => a.key === key);
const giftK = (g) => (GIFT_SIZES.find(x => x[0] === g?.size) || GIFT_SIZES[1])[2];
const READ_ON = 0.25, READ_CLIMB = 0.04;    // 글 읽는 척: on a message / hop up onto one to read it
const RUN_WALK = 0.12;                      // a walk that's a sudden run
const RUN_X = 3;                            // run = 3× the walking speed
const TILT_K = 0.5;                         // 0.9.1: every lean / tilt at half the angle
const EAT_MIN = 1.5;                        // 0.9.1: eats at least this long (s), even a short message
// 0.9.0: attitudes toward you (처음엔 끔 — switched on per pet)
const ATTITUDES = [
    { key: 'cling',  name: LX('졸졸 따라다니기', 'Tagging along') },   // 0.9.3: tap somewhere → walks over that way
    { key: 'where',  name: LX('…어디 갔었어?', '…where did you go?') },    // you were away a while → comes and stares, "…어디 갔었어?"
    { key: 'stare',  name: LX('글 쓰면 빤히', 'Staring while you type') },      // you start writing → comes over and looks up at it
];
const CLING_TAP = 0.6;          // 0.9.3: a tap → walks toward it (드물게 30% / 보통 60% / 자주 ~90%)
const TAP_MS = 350, TAP_MOVE = 10;   // a short touch that didn't move = a tap (not a scroll / a long press)
const WHERE_AWAY = 5;           // min away from this screen
const WHERE_CHANCE = 0.6;
const STARE_CHANCE = 0.5;       // starting to write → comes over to look
const WAIT_FIDGET = [7, 12];    // s — waiting for a reply: a little something this often (0.11.6: was 3.5–6)
const IDLE_SLOW = 1.3;          // 0.11.6: × each personality's idle pause
const AFTER_FIDGET = [1.5, 3];   // s — rest after a fidget (0.11.6: was 0.4–1.2)
const STROLL_TIME = [8, 20];    // s — climbing about on the screen this long
const RAPID_TAPS = 3, RAPID_WINDOW = 1.5;   // this many taps within this many seconds = 연타
const REVISIT_DAYS = 3;         // away this long → a little bubble by the bed
const TEARY_DAYS = 7, TEARY_CLOSE = 60;     // away this long and this close → teary when it sees you
const RECENT_H = 12;            // woken again within this many hours = "just saw you"
const REVISIT_LINES = {
    aegyo:   (n) => LX(`${n}일이나 기다렸어…! 보고 싶었어 ♥`, `I waited ${n} whole days…! I missed you ♥`),
    saechim: (n) => LX(`…${n}일 만이네. 딱히 기다린 건 아니야.`, `…${n} days, huh. Not that I was waiting.`),
    neugut:  (n) => LX(`하암… 벌써 ${n}일 지났어?`, `Yawn… ${n} days already?`),
    simsul:  (n) => LX(`${n}일이나 어디 갔었어 💢`, `${n} days! Where were you 💢`),
    musim:   (n) => LX(`${n}일 만이네. …어서 와.`, `${n} days, huh. …Welcome back.`),
};

// unlocked behaviours (stage 6-1). lv = closeness level needed (1 친구 · 2 친한 친구 · 3 단짝 · 4 내편).
// only / not = personality. Never saved — worked out from the level every time.
const UNLOCKS = [
    { key: 'peekInput', lv: 1, name: LX('입력창 기웃', 'Peeking at the input box') },
    { key: 'follow',    lv: 1, name: LX('손 따라 보기', 'Watching your hand') },
    { key: 'bedWiggle', lv: 2, name: LX('침대 들썩', 'Wiggling bed') },
    { key: 'myBubble',  lv: 2, name: LX('내 말풍선 좋아하기', 'Liking your messages') },
    { key: 'resist',    lv: 3, name: LX('배웅 투정', 'Fussing at bedtime') },
    { key: 'dozeWait',  lv: 3, name: LX('기다리다 졸기', 'Dozing off while waiting') },
    { key: 'soft',      lv: 4, name: LX('마음이 풀린 반응', 'Softer reactions'), not: 'aegyo' },
    { key: 'gift',      lv: 4, name: LX('행운 빌기', 'Wishing you luck'), only: 'aegyo' },
];
const PEEKIN_CHANCE = 0.6;      // starting to write → peeks at the input box
const PEEKIN_AGAIN = 0.3;       // still writing → now and then again
const PEEKIN_GAP = [8, 14];     // s between peeks while writing
const TYPING_GAP = 4;           // s without typing → the next keystroke is "starting to write"
const FOLLOW_NEAR = 2.2;        // × pet height (at least 110px) — how close your hand / finger must come
const FOLLOW_CHANCE = 0.5;      // hand comes near → looks at it
const FOLLOW_REST = [6, 12];    // s after looking before it does it again
const FOLLOW_STEP = 0.3;        // takes a step or two toward it (심술; 애교 0.5; 새침·느긋·무심 only look)
const WIGGLE_GAP = [4, 9];      // s — the bed wiggles while food piles up
const MY_BUBBLE = 0.65;         // climbing up by itself → picks one of your messages
const RESIST_CHANCE = 0.6;      // put to bed → digs its feet in for a second
const IDLE_DOZE = 90;           // s with nothing from you → climbs onto your last message and nods off
const IDLE_DOZE_CHANCE = 0.75;
const TEAR_COLOR = '#6fc3ff', TEAR_ANGLE = 30;   // degrees (0 = sideways)
const GIFT_CHANCE = 0.15;       // 애교 only, when reacting to you
const BIG_REST = 180;           // s — after a present, not again for this long
const bigAt = new Map();        // pet id → when it last grew big (kept across sleep / wake)
const GIFTS = ['🍀'];          // 0.10.0: 행운 빌기 — a clover, wishing you luck (was 선물 주기, random items)

// pictures per action (6-2). key = role name in look.roles; fb = the picture used when this one is empty.
// Every role here is actually used by some behaviour.
const ROLE_GROUPS = [
    { key: 'main', name: LX('자주 쓰는 동작', 'Common actions'), roles: [
        { key: 'idle', name: LX('기본', 'Basic'), note: LX('숨쉬기 · 꼭 필요해요', 'Breathing · required') },
        { key: 'walk', name: LX('걷기', 'Walk'), fb: 'idle' },
        { key: 'held', name: LX('들림', 'Held'), fb: 'surprise' },
        { key: 'dance', name: LX('춤추기', 'Dance'), fb: 'happy' },
        { key: 'sleep', name: LX('졸기', 'Doze'), fb: 'idle' },
        { key: 'cry', name: LX('울기', 'Cry'), fb: 'surprise' },
    ] },
    { key: 'move', name: LX('움직이기 더 보기', 'More movement'), roles: [
        { key: 'jump', name: LX('점프·착지', 'Jump · land'), fb: 'idle' },
        { key: 'fall', name: LX('떨어짐', 'Fall'), fb: 'surprise' },
        { key: 'climb', name: LX('말풍선 오르기', 'Climb messages'), fb: 'jump' },
        { key: 'roll', name: LX('구르기', 'Roll'), fb: 'idle' },
        { key: 'wall', name: LX('화면 오르기', 'Climb the screen'), fb: 'walk' },
        { key: 'fly', name: LX('날기', 'Fly'), fb: 'jump' },
        { key: 'dash', name: LX('휙휙', 'Dash'), fb: 'fly' },
    ] },
    { key: 'react', name: LX('반응', 'Reactions'), roles: [
        { key: 'happy', name: LX('기쁨', 'Happy'), fb: 'idle' },
        { key: 'angry', name: LX('화남', 'Angry'), fb: 'idle' },
        { key: 'surprise', name: LX('놀람', 'Surprised'), fb: 'idle' },
        { key: 'curious', name: LX('궁금', 'Curious'), fb: 'look' },
        { key: 'look', name: LX('바라보기', 'Looking'), fb: 'idle' },
        { key: 'flick', name: LX('고개 홱', 'Head turn'), fb: 'look' },
        { key: 'aside', name: LX('등 돌리기', 'Turn away'), fb: 'walk' },
        { key: 'fluster', name: LX('당황', 'Flustered'), fb: 'idle' },
        { key: 'wave', name: LX('손 흔들기', 'Wave'), fb: 'happy' },
        { key: 'pat', name: LX('톡톡', 'Tap tap'), fb: 'jump', note: LX('클릭·탭하면 폴짝 뛰는 동안 나와요', 'Shown while it hops after a click or tap') },
    ] },
    { key: 'rest', name: LX('쉬기·먹기', 'Rest · eat'), roles: [
        { key: 'sit', name: LX('앉기', 'Sit'), fb: 'idle' },
        { key: 'eat', name: LX('먹기', 'Eat'), fb: 'idle' },
        { key: 'nod', name: LX('식후 꾸벅', 'After-meal nod'), fb: 'sleep' },
        { key: 'full', name: LX('배부름', 'Full'), fb: 'idle' },
    ] },
    { key: 'special', name: LX('특별 순간', 'Special moments'), roles: [
        { key: 'appear', name: LX('등장', 'Entrance'), fb: 'jump' },
        { key: 'gift', name: LX('행운 빌기', 'Wishing you luck'), fb: 'happy' },
        { key: 'cheer', name: LX('축하', 'Celebrate'), fb: 'dance' },
    ] },
];
const ROLE_DEFS = Object.fromEntries(ROLE_GROUPS.flatMap(g => g.roles).map(r => [r.key, r]));
const STEP_ROLES = { walk: LX('걸음에 맞춰 넘어가요', 'changes with each step'), eat: LX('한 입 먹을 때마다 넘어가요', 'changes with each bite') };   // frames follow steps / bites, not a clock
const FRAME_FPS = { slow: 2.5, normal: 5, fast: 9 };
const SPEED_NAMES = { slow: LX('느리게', 'Slow'), normal: LX('보통', 'Normal'), fast: LX('빠르게', 'Fast') };
const FRAMES_MAX = 8;            // pictures in one action at most
// 키 맞추기 (0.8.1): a picture fitted to the 기본 picture carries three almost-invisible pixels in its top-left
// corner (alpha 7, 11, then m). Such a picture is drawn at the 기본 picture's scale ÷ m instead of being
// squeezed into its box. Kept inside the picture so pet files, cards and copies keep it with no extra data.
const FIT_MARK = [7, 11];
const FIT_M_MAX = 8;
const FIT_MAX_PX = 1600;

// speech lines (6-2)
const TALK_MOMENTS = [
    { key: 'wake', name: LX('깨울 때', 'When woken'), ex: LX('좋은 아침!', 'Good morning!') },
    { key: 'sleep', name: LX('재울 때', 'When put to bed'), ex: LX('잘 자…', 'Good night…') },
    { key: 'pat', name: LX('쓰다듬을 때', 'When patted'), ex: LX('헤헤, 간지러워', 'Hehe, that tickles') },
    { key: 'meal', name: LX('밥 다 먹고', 'After a meal'), ex: LX('잘 먹었다!', 'That was yummy!') },
    { key: 'play', name: LX('혼자 놀 때', 'Playing alone'), ex: LX('흥얼흥얼~', 'La la la~') },
    { key: 'wait', name: LX('답 기다릴 때', 'Waiting for a reply'), ex: LX('언제 와?', 'When is it coming?') },
    { key: 'late', name: LX('답이 늦어질 때', 'When a reply is late'), ex: LX('왜 이렇게 오래 걸려…', 'Why is it taking so long…') },
    { key: 'level', name: LX('단계 오를 때', 'Growing closer'), ex: LX('우리 더 친해졌다!', 'We got closer!') },
    { key: 'reunion', name: LX('오랜만에 만났을 때', 'Reunion after a while'), ex: LX('{{user}}, 보고 싶었어!', '{{user}}, I missed you!') },
    { key: 'reply', name: LX('답이 왔을 때', 'When a reply arrives'), ex: LX('오, 왔다!', 'Oh, it’s here!') },
    { key: 'sent', name: LX('내가 보냈을 때', 'When you send'), ex: LX('잘 보냈어?', 'Sent it okay?') },
    { key: 'greet', name: LX('다른 펫에게 말 걸 때', 'Talking to another pet'), ex: LX('{{pet}}야, 뭐 해?', '{{pet}}, what are you doing?') },     // 0.10.8 펫끼리 말하기
    { key: 'answer', name: LX('다른 펫이 말 걸어 오면', 'When another pet talks to it'), ex: LX('응? 왜 불러~', 'Hm? You called?') },
    { key: 'night', name: LX('다른 펫이 졸 때', 'When another pet dozes'), ex: LX('잘 자, {{pet}}', 'Sleep well, {{pet}}') },              // 0.10.12
    // 0.11.17 알아보고 말하기: things you do in SillyTavern. Empty → the personality's default lines (NOTICE_LINES)
    { key: 'retype', name: LX('썼다 지웠다', 'Writing and erasing') },
    { key: 'long', name: LX('아주 긴 글 보내기', 'Sending a very long message') },
    { key: 'swipe', name: LX('스와이프', 'Swiping') },
    { key: 'regen', name: LX('다시 생성', 'Regenerating') },
    { key: 'edit', name: LX('메시지 고치기', 'Editing a message') },
    { key: 'del', name: LX('메시지 지우기', 'Deleting a message') },
    { key: 'old', name: LX('옛날 대화 보기', 'Reading old messages') },
    { key: 'menu', name: LX('메뉴 열기 (모든 메뉴)', 'Opening a menu (any menu)') },
    { key: 'back', name: LX('다른 방 갔다 돌아오기', 'Back from another chat') },
    { key: 'menuChar', name: LX('캐릭터 목록', 'Character list') },
    { key: 'menuWorld', name: LX('월드인포', 'World Info') },
    { key: 'menuAi', name: LX('AI 설정', 'AI settings') },
    { key: 'menuApi', name: LX('연결', 'Connections') },
    { key: 'menuPersona', name: LX('페르소나', 'Persona') },
    { key: 'menuBg', name: LX('배경', 'Background') },
    { key: 'menuFormat', name: LX('서식', 'Formatting') },
];
// 0.11.17 대사 탭 묶음 (접는 칸, 한 번에 하나만 펼침). rows: [작은 줄 이름 or '', keys]
const TALK_GROUPS = [
    { key: 'daily', name: LX('평소', 'Everyday'), rows: [['', ['wake', 'sleep', 'pat', 'meal', 'play']]] },
    { key: 'msg', name: LX('메시지', 'Messages'), rows: [
        [LX('쓰기', 'Writing'), ['retype']], [LX('보내기', 'Sending'), ['sent', 'long']], [LX('기다리기', 'Waiting'), ['wait', 'late']],
        [LX('답', 'Replies'), ['reply', 'swipe', 'regen']], [LX('그 뒤', 'Afterwards'), ['edit', 'del', 'old']]] },
    { key: 'look', name: LX('둘러보기', 'Looking around'), rows: [['', ['menu', 'back']]],
        fold: { key: 'menuEach', name: LX('메뉴마다', 'Per menu'), keys: ['menuChar', 'menuWorld', 'menuAi', 'menuApi', 'menuPersona', 'menuBg', 'menuFormat'] } },
    { key: 'pets', name: LX('다른 펫과', 'With other pets'), rows: [['', ['greet', 'answer', 'night']]], duets: true },
    { key: 'special', name: LX('특별한 순간', 'Special moments'), rows: [['', ['level', 'reunion']]] },
];
// what each menu is called in {{menu}}; drawer id in SillyTavern's top bar → moment key
const MENU_DRAWERS = { rightNavHolder: 'menuChar', 'WI-SP-button': 'menuWorld', 'ai-config-button': 'menuAi', 'sys-settings-button': 'menuApi',
    'persona-management-button': 'menuPersona', 'backgrounds-button': 'menuBg', 'advanced-formatting-button': 'menuFormat' };
const NOTICE_REST = 60;          // s — the same thing isn't remarked on again sooner than this
const LONG_SEND = 500;           // characters — "아주 긴 글"
const OLD_SCREENS = 3;           // scrolled up more than this many screens from the bottom → 옛날 대화 보기
const RETYPE_DEL = 20;           // characters erased within RETYPE_WIN s → 썼다 지웠다
const RETYPE_WIN = 3;
const RETYPE_LONG = 60;          // s writing without sending → 썼다 지웠다 too
const BACK_MIN = 10;             // min — back in the room within this → 돌아오기 (longer → the usual hello)
// default lines by personality (used only while that moment's box is empty)
const NOTICE_LINES = {
    swipe: {
        aegyo: LX(['다른 것도 궁금해?', '이번 건 어떨까~'], ['Curious about another one?', 'How about this one~']),
        saechim: LX(['…그게 맘에 안 들었구나', '까다롭긴.'], ['…you didn’t like that one', 'So picky.']),
        neugut: LX(['천천히 골라~', '다음 것도 괜찮을걸…'], ['Take your time picking~', 'The next one might be fine too…']),
        simsul: LX(['내가 봐도 별로였어.', '잠깐, 나 못봤어!'], ['Even I thought that was bad.', 'Wait, I didn’t see it!']),
        musim: LX(['다음 거 보는구나.', '…아까 것도 괜찮던데.'], ['Looking at the next one.', '…The last one was fine too.']),
    },
    regen: {
        aegyo: LX(['다시 써 달라고 하자!', '이번엔 더 좋을 거야'], ['Let’s ask for a new one!', 'This one will be even better']),
        saechim: LX(['처음부터 다시? 흥', '이번엔 잘 쓰라고 해'], ['From scratch? Hmph', 'Tell it to write well this time']),
        neugut: LX(['다시 기다리면 되지~', '하암… 또 기다려야겠다'], ['We can just wait again~', '*yawn*… more waiting']),
        simsul: LX(['또 처음부터야?', '또? 질리지도 않냐.'], ['From the start again?', 'Again? Don’t you ever get tired?']),
        musim: LX(['다시 쓰게 하는구나.', '…이번 건 마음에 들면 좋겠네.'], ['Having it write again.', '…Hope you like this one.']),
    },
    edit: {
        aegyo: LX(['고쳐 주는 거야?', '{{user}} 꼼꼼해~'], ['Fixing it up?', '{{user}}, so careful~']),
        saechim: LX(['…틀린 거 봤어', '이제야 고치네'], ['…I saw the mistake', 'Fixing it only now']),
        neugut: LX(['천천히 고쳐~', '그 정도면 괜찮았는데…'], ['Fix it slowly~', 'It was fine as it was…']),
        simsul: LX(['처음부터 잘 쓰지.', '또 고쳐?'], ['Should’ve written it right the first time.', 'Fixing it again?']),
        musim: LX(['고쳤네. 그게 낫겠다.', '…손보는 중이구나.'], ['You fixed it. That’s better.', '…Touching it up.']),
    },
    del: {
        aegyo: LX(['안녕… 잘 가', '없던 걸로 하자!'], ['Bye-bye… farewell', 'Let’s pretend it never happened!']),
        saechim: LX(['…못 본 걸로 할게', '지우는 게 낫겠어'], ['…I’ll act like I didn’t see it', 'Better off deleted']),
        neugut: LX(['사라졌네~', '하암… 없어졌다'], ['It’s gone~', '*yawn*… vanished']),
        simsul: LX(['아깝게 왜 지워', '흥, 지워 버렸네'], ['Why delete it, what a waste', 'Hmph, you deleted it']),
        musim: LX(['지웠구나. 뭐, 괜찮아.', '…없어졌네.'], ['Deleted it. Well, that’s fine.', '…It’s gone.']),
    },
    long: {
        aegyo: LX(['와, 열심히 썼다!', '{{user}} 대단해!'], ['Wow, you wrote so much!', '{{user}}, amazing!']),
        saechim: LX(['…꽤 길게 썼네', '흥, 공들였구나'], ['…that’s pretty long', 'Hmph, you put work into it']),
        neugut: LX(['길다… 읽다 졸겠다', '수고했어~'], ['So long… I’ll doze off reading', 'Good work~']),
        simsul: LX(['뭘 이렇게 길게 써', '손 안 아파?'], ['Why write so much?', 'Don’t your hands hurt?']),
        musim: LX(['길게 썼네. 다 읽어 볼게.', '…공들였구나.'], ['That’s a long one. I’ll read it all.', '…You put work into that.']),
    },
    menu: {
        aegyo: LX(['{{menu}} 보는 거야? 나도!', '뭐 바꿔?'], ['Looking at {{menu}}? Me too!', 'Changing something?']),
        saechim: LX(['…{{menu}} 만지는구나', '괜히 망가뜨리지 마'], ['…fiddling with {{menu}}', 'Don’t go breaking things']),
        neugut: LX(['천천히 둘러봐~', '뭐 찾는 거야…'], ['Look around slowly~', 'What are you looking for…']),
        simsul: LX(['또 뭘 건드려', '{{menu}}? 귀찮게'], ['What are you poking now', '{{menu}}? What a bother']),
        musim: LX(['{{menu}} 보는구나.', '…볼일 보고 와.'], ['Looking at {{menu}}.', '…Go do your thing.']),
    },
    menuChar: { aegyo: LX(['다른 애 보러 가는 거 아니지?'], ['You’re not going to see someone else, right?']), saechim: LX(['…나 말고 누구 찾아?'], ['…who are you looking for, if not me?']), neugut: LX(['누구 보러 가~?'], ['Who are we visiting~?']), simsul: LX(['딴 애 찾냐?'], ['Looking for someone else?']), musim: LX(['누구 보러 가는지는 안 물을게.'], ['I won’t ask who you’re going to see.']) },
    menuWorld: { aegyo: LX(['세계 설정 보는 거야?'], ['Looking at the world settings?']), saechim: LX(['…설정 또 바꿔?'], ['…changing the settings again?']), neugut: LX(['이야기 속 세상이구나~'], ['The world inside the story~']), simsul: LX(['설정 함부로 건드리지 마'], ['Don’t mess with the setting']), musim: LX(['세계 설정이구나. 천천히 봐.'], ['The world settings. Take your time.']) },
    menuAi: { aegyo: LX(['똑똑하게 만들어 줘!'], ['Make it smart!']), saechim: LX(['…숫자 만지는 거야?'], ['…playing with numbers?']), neugut: LX(['어려운 거 한다~'], ['Doing hard stuff~']), simsul: LX(['괜히 망치지 마'], ['Don’t go ruining it']), musim: LX(['숫자 만지는구나. 난 잘 몰라.'], ['Fiddling with numbers. I wouldn’t know.']) },
    menuApi: { aegyo: LX(['누구랑 연결해?'], ['Who are we connecting to?']), saechim: LX(['…이번엔 뭘로 하는데?'], ['…what are you using this time?']), neugut: LX(['연결 잘 되려나~'], ['Hope it connects~']), simsul: LX(['또 끊겼냐?'], ['Cut off again?']), musim: LX(['연결 바꾸는구나. 잘 되면 좋겠네.'], ['Changing the connection. Hope it works.']) },
    menuPersona: { aegyo: LX(['{{user}} 변신해?'], ['{{user}}, transforming?']), saechim: LX(['…이번엔 누구야?'], ['…who are you this time?']), neugut: LX(['다른 사람 되는 거야~'], ['Becoming someone else~']), simsul: LX(['누가 되든 너지'], ['Whoever you become, it’s still you']), musim: LX(['오늘은 누구로 할지 고르는구나.'], ['Picking who to be today.']) },
    menuBg: { aegyo: LX(['이사 가는 거야?'], ['Are we moving?']), saechim: LX(['…분위기 바꾸게?'], ['…changing the mood?']), neugut: LX(['여기 좋은데~'], ['I like it here~']), simsul: LX(['아까 게 나았어'], ['The old one was better']), musim: LX(['배경 바꾸게? 난 아무 데나 괜찮아.'], ['New background? Anywhere’s fine with me.']) },
    menuFormat: { aegyo: LX(['예쁘게 꾸며?'], ['Making it pretty?']), saechim: LX(['…글씨 바꾸는 거야?'], ['…changing the text?']), neugut: LX(['꾸미는구나~'], ['Decorating~']), simsul: LX(['또 뭘 만져'], ['What are you touching now']), musim: LX(['글 모양 손보는구나.'], ['Tidying up how the text looks.']) },
    back: {
        aegyo: LX(['어디 갔다 왔어? 기다렸어!', '돌아왔다!'], ['Where did you go? I waited!', 'You’re back!']),
        saechim: LX(['…금방 올 거면서', '흥, 왔네'], ['…knew you’d be right back', 'Hmph, you’re here']),
        neugut: LX(['다녀왔어~', '하암… 왔구나'], ['Welcome back~', '*yawn*… you’re back']),
        simsul: LX(['기다리게 할래?', '늦었잖아'], ['Gonna keep me waiting?', 'You’re late']),
        musim: LX(['왔네. 어서 와.', '…생각보다 빨리 왔네.'], ['You’re back. Welcome.', '…That was quicker than I thought.']),
    },
    old: {
        aegyo: LX(['그때 생각난다~', '어디 보고 있어?'], ['That brings back memories~', 'Where are you looking?']),
        saechim: LX(['…옛날 거 보는 거야?', '재밌긴 했지'], ['…reading old stuff?', 'It was fun, I guess']),
        neugut: LX(['옛날 얘기구나~', '천천히 봐…'], ['Old stories~', 'Take your time…']),
        simsul: LX(['스크롤 어디까지 올라가', '부끄럽게 뭘 봐'], ['How far up are you going?', 'Stop looking, it’s embarrassing']),
        musim: LX(['옛날 얘기 보는구나.', '…그때 거 아직 기억나.'], ['Looking at old times.', '…I still remember that one.']),
    },
    retype: {
        aegyo: LX(['천천히 해도 돼!', '뭐라고 쓸지 고민돼?'], ['Take your time!', 'Not sure what to write?']),
        saechim: LX(['…뭘 그렇게 망설여', '다 보이거든'], ['…why so hesitant?', 'I can see everything, you know']),
        neugut: LX(['급할 거 없어~', '생각 중이구나…'], ['No need to rush~', 'Thinking it over…']),
        simsul: LX(['그냥 써!', '아까 거 좋았는데'], ['Just write it!', 'The last one was good']),
        musim: LX(['천천히 써도 돼.', '…고민되는구나.'], ['Take your time writing.', '…Hard to decide, huh.']),
    },
};
const menuName = (key) => TALK_MOMENTS.find(m => m.key === key)?.name || '';
/** Lines for a moment: what you wrote, else the personality's default (0.11.17 moments only). */
function linesFor(rec, key) {
    const mine = (rec?.lines?.[key] || []).filter(x => typeof x === 'string' && x.trim());
    if (mine.length) return mine;
    const d = NOTICE_LINES[key];
    return d ? (d[rec?.personality?.base] || d.aegyo || []) : [];
}
const TALK_FREQ = { off: LX('끔', 'Off'), some: LX('가끔', 'Sometimes'), often: LX('자주', 'Often') };
const TALK_CHANCE = { some: 0.35, often: 0.7 };          // a moment comes → says something
const TALK_PLAY = { some: 0.05, often: 0.12 };           // each "what next?" while playing alone
const TALK_ALWAYS = ['level', 'reunion', 'late'];        // these always speak (unless 끔) — 'late' comes rarely
const TALK_HALF = ['reply', 'sent'];                     // messages come often → half the usual chance
const FULL_DOZE = 0;             // full tummy: no extra naps (it was sleeping the day away) …
const FULL_DOZE_LEN = 1;         // … nor longer ones
const FULL_TUMMY = 0.1;          // full tummy: pats its tummy ♪ now and then
const CLIMB_PULL = 0.55;         // s — one pull up the screen (moving, then a short hold)
const CLIMB_SLIP = 0.05;         // chance per pull to slip down a little

// 0.7.13: ways to get about on the screen (펫마다 고름; several → one of them each time)
const MOVES = { wall: LX('오르기', 'Climb'), fly: LX('날기', 'Fly'), dash: LX('휙휙', 'Dash'), portal: LX('차원문', 'Portal') };
const PORTAL_OPEN = 0.3;         // s — 0.11.3 차원문: a door opening / closing (same as the CSS)
const PORTAL_IN = 0.35;          // s — shrinking into it / growing out of the other one
const PORTAL_GAP = 0.5;          // s — out of sight in between
const PORTAL_SOFT = 0.3;         // 0.11.9: soft edge where it walks into the door (× its width)
const PORTAL_WOB = 0.06;         // 0.11.9: a little wobble going through (± height)
const FLY_TILT = 12;             // ° — leaning into where it floats
const DASH_SPEED = 650;          // px/s — 휙휙
const DASH_HOLD = [0.4, 1.1];    // s — a stop between darts
const GHOST_GAP = 0.045;         // s — one afterimage this often while darting

/** 0.11.3 차원문 (0.11.4: a glowing blue ring, dark inside): a door standing on (x = centre, y = feet height above the floor), sized to the pet. */
function openDoor(a, x, y) {
    if (!layer) return null;
    const el = document.createElement('div');
    el.className = 'tavvy-portal';
    const w = Math.max(16, a.h * 0.47), h = Math.max(28, a.h * 0.9);    // 0.11.4: 55% / 105% of its height → 0.11.12: 90% tall, same shape
    Object.assign(el.style, { width: w + 'px', height: h + 'px', left: (x - w / 2 - stage.ox) + 'px', top: (stage.floorY - y - h + a.basePx - stage.oy) + 'px' });
    layer.insertBefore(el, a.el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('tavvy-portal-on')));
    return el;
}
/** 0.11.9: the door lights up while it is walked through (g = 0 … 1). 0.11.11: only a little (¼ of before, no white rim). */
function glowDoor(el, g) {
    if (!el) return;
    const b = 10 + g * 3.5, sp = 3 + g * 1;
    el.style.boxShadow = g > 0.01 ? `0 0 ${b.toFixed(1)}px ${sp.toFixed(1)}px #6f86ff, inset 0 0 ${b.toFixed(1)}px ${sp.toFixed(1)}px #6f86ff` : '';
}
function shutDoor(el) {
    if (!el) return;
    el.classList.remove('tavvy-portal-on');
    setTimeout(() => el.remove(), PORTAL_OPEN * 1000 + 80);
}

/** The ways this pet gets about on the screen (0.8.2: may be none — each one is 끔 in the 행동 tab). */
function movesOf(rec) {
    if (!Array.isArray(rec?.moves)) return ['wall'];
    return Object.keys(MOVES).filter(k => rec.moves.includes(k));
}
const SCREEN_SCALE = 0.3;        // 0.8.4: getting about on the screen less often than before (p.wall × this; 0.8.2 had 0.8, 0.8.3 0.5)
const RESTS = [[1, LX('1분', '1 min')], [3, LX('3분', '3 min')], [5, LX('5분', '5 min')], [10, LX('10분', '10 min')]];   // 0.8.5: 쉬는 시간 after getting about on the screen
const REST_DEF = 3;
const restOf = (rec) => (RESTS.some(x => x[0] === rec?.screenRest) ? rec.screenRest : REST_DEF);
const screenAt = new Map();      // pet id → when it last came down from the screen (Date.now; not saved)
const STUCK_EXTRA = 30;          // 0.8.4: still up on the screen this long past its time → lets go and drops
const TALK_GAP = 8;              // s — ordinary lines not closer together than this
const SAY_MS = 2600;             // how long a speech bubble stays
const LINE_MAX = 40;             // characters in one line
const LINES_MAX = 10;            // lines per moment
// 0.10.8 펫끼리 말하기: talks two pets in the same room share (root.duets)
const DUET_MAX = 30;             // talks kept per two pets
const DUET_LINES = 4;            // lines in one talk
const DUET_ADD = 10;             // talks the AI writes per press
const DUET_STEP = 1.3;           // s between two lines of a talk
const MEET_DIST = 1.2;           // × (sum of both widths) — close enough to talk (0.10.9: was 0.9)
const MEET_REST = 60;            // s — the same two pets don't talk again sooner than this
const VISIT_P = 0.06;            // × 빈도 — each "what next?"; missed (not on the same floor) → it tries again at the next ones
const VISIT_TO = ['idle', 'fidget', 'look', 'perch', 'read', 'walk'];   // what the other one may be doing
const VISIT_WAIT = 8;
// 0.10.12 여러 마리 더 · 멍 — each "× 빈도" is the 행동 탭 setting (끔 / 드물게 / 보통 / 자주)
const ZONE_P = { musim: 0.09, neugut: 0.07, aegyo: 0.03, saechim: 0.035, simsul: 0.03 };   // 멍 (로딩 중): × 빈도, each "what next?"
const ZONE_LEN = { musim: [6, 10], neugut: [4.5, 9], aegyo: [3, 5], saechim: [3, 5], simsul: [3, 4.5] };   // s (0.11.6: 1.5× longer)
const ZONE_GEN = 3;              // × while a reply is being written (같이 로딩 중)
const NIGHT_FROM = ['idle', 'walk', 'perch', 'fidget', 'look', 'read', 'watch'];   // awake and not busy
const NIGHT_P = 0.6;             // 잘 자: × 빈도 — a pet close by starts dozing
const NIGHT_REST = 120;          // s — the same two, not again sooner
const NIGHT_FX = { aegyo: '♥', saechim: '', neugut: '', simsul: '💢', musim: '…' };   // no line written → this
const NAP_P = { neugut: 0.5, aegyo: 0.4, saechim: 0.15, simsul: 0.15, musim: 0.08 };   // 같이 졸기: × 빈도
const NAP_NEAR = 320;            // px — how far away it still walks over to doze next to it
const TAG_P = { simsul: 0.04, aegyo: 0.025, saechim: 0.015, neugut: 0.01, musim: 0.006 };   // 쫓아가기 장난: × 빈도, each "what next?"
const TAG_CHASE = { aegyo: 0.9, simsul: 0.9, saechim: 0.7, neugut: 0.5, musim: 0.2 };   // the one tapped runs after it
const TAG_END = { aegyo: '♥', saechim: '', neugut: '♪', simsul: '💢', musim: '…' };    // caught up
const TAG_NEAR = 260;            // px
const TAG_REST = 90;             // s
const RACE_P = 0.35;             // 먼저 달려가기: × 빈도 (the lower one) — two or more go to look at a new reply
const RACE_LATE = { aegyo: '♥', saechim: '', neugut: '?', simsul: '💢', musim: '…' };  // got there second
const SHARE_P = 0.5;             // 나눠 먹기: × 빈도 — done eating, another one still eating close by
const SHARE_NEAR = 300;          // px
const SHARE_REST = 120;          // s
const SHARE_MINE = { aegyo: '♥', neugut: '♪', saechim: '', musim: '…', simsul: '💢' };   // the eater (심술: turns its back)            // s the other one stays put while it comes over
const PERS_DESC = {
    aegyo: LX('애교 많고 다정해요', 'Affectionate and sweet'), saechim: LX('새침하고 쑥스러움을 잘 타요', 'Prim and easily shy'), neugut: LX('느긋하고 늘 졸려요', 'Laid-back and always sleepy'),
    simsul: LX('툴툴대지만 속은 다정해요', 'Grumbles, but kind inside'), musim: LX('말수가 적고 무심해요', 'Quiet and aloof'),
};

// special days (6-2). Every year on the month/day. kind: me = 내 생일, char = 캐릭터 생일, anniv = 기념일, met = 만난 날
const DATE_KINDS = { me: LX('내 생일', 'My birthday'), char: LX('캐릭터 생일', 'Character’s birthday'), anniv: LX('기념일', 'Anniversary') };
const LATE_DAYS = 7;             // missed the day → a "늦었지만…" version within this many days (the day itself counts)
const SPECIAL_LINES = {
    me: { aegyo: LX('생일 축하해 ♥', 'Happy birthday ♥'), saechim: LX('…생일이라며. 축하해 줄게', '…Your birthday, huh. Happy birthday, I guess'), neugut: LX('하암… 생일이구나. 축하해~', 'Yawn… it’s your birthday. Happy birthday~'), simsul: LX('생일이라고? …축하해 💢', 'Your birthday? …Happy birthday 💢'), musim: LX('생일이구나. …축하해, 진심으로.', 'It’s your birthday. …Happy birthday. I mean it.') },
    char: { aegyo: LX('오늘 내 생일이야! 축하해 줘 ♥', 'It’s my birthday today! Celebrate me ♥'), saechim: LX('…오늘 내 생일인 거 알지?', '…You know it’s my birthday, right?'), neugut: LX('오늘 내 생일이래… 하암', 'Apparently it’s my birthday… yawn'), simsul: LX('내 생일인데 선물은? 💢', 'It’s my birthday. Where’s my present? 💢'), musim: LX('…오늘 내 생일이래. 별건 아니고.', '…Apparently it’s my birthday. No big deal.') },
    anniv: { aegyo: LX('오늘 우리 기념일이야 ♥', 'It’s our anniversary today ♥'), saechim: LX('…기념일인 거 기억했어?', '…Did you remember our anniversary?'), neugut: LX('기념일이네~ 느긋하게 보내자', 'Anniversary~ let’s take it easy'), simsul: LX('기념일 잊은 거 아니지? 💢', 'You didn’t forget our anniversary, right? 💢'), musim: LX('기념일이네. …같이 있어 줘서 고마워.', 'It’s our anniversary. …Thanks for staying with me.') },
    met: { aegyo: LX('만난 지 {n}년! 고마워 ♥', '{n} years together! Thank you ♥'), saechim: LX('…만난 지 {n}년이네. 나쁘지 않았어.', '…{n} years, huh. Not bad.'), neugut: LX('벌써 {n}년이야? 하암…', '{n} years already? Yawn…'), simsul: LX('{n}년이나 같이 있었네 💢 …앞으로도.', '{n} whole years 💢 …and more to come.'), musim: LX('벌써 {n}년이네. …앞으로도 옆에 있을게.', '{n} years already. …I’ll stay by your side.') },
};

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
        stroll: true,                          // 화면 오르기
        badge: true,                           // number of waiting messages on the bed
        heartMode: 'both',                     // closeness shown as 'both' (♥♥ 친구) / 'hearts' / 'name' / 'hide'
        winTheme: 'theme',                     // the Tavvy window: 'theme' (follow SillyTavern) / 'cream' / 'white' / 'night'
        talkProfile: '',                       // connection profile used to write speech lines with AI ('' = the current connection)
        soundOn: false,                        // 0.10.5 소리 (off by default) — 0.10.11부터 펫 소리만 (♥·깨우기·재우기·축하)
        replyOn: false,                        // 0.10.11 답 도착 알림 (따로 켜고 끔)
        replyOff: [],                          // 0.10.11 답 도착 소리 중 끈 것 (기본 소리 key / 내 파일 id)
        replyFiles: [],                        // 0.10.11 답 도착 내 소리 파일: [{ id, path, name }]
        soundVol: 60,                          // 0..100
        replyVol: null,                        // 0.11.8 답 도착 음량 0..100 (null = same as soundVol until moved)
        soundFeel: 'clear',                    // 0.11.19 소리 느낌: 'clear' 또렷하게 / 'soft' 부드럽게
        lang: 'auto',                          // 0.11.0 'auto' / 'ko' / 'en' (applies after a reload)
        backup: { lastDay: null, files: [] },  // daily backups: [{ day, path, pets }]
    };
}

function newRoot() {
    return { formatVersion: FORMAT_VERSION, settings: defaultSettings(), pets: [], looks: [], duets: {} };
}

function newPetRecord({ id, name, personality, look }) {
    const now = Date.now();
    return {
        id,
        name,
        callMe: '',
        chatVoice: 'ungeol',                          // 0.11.15: its voice when pets chat (CHAT_VOICES)
        heartSound: 'byong',                          // 0.11.16: its ♥ sound (HEART_SOUNDS)                                   // 0.11.14: what it calls you ({{user}}); empty = your SillyTavern name
        createdAt: now,
        acts090: true,                                // 0.9.0 rows (흥얼·두리번·앉기 out of 제자리 놀기) already in place
        look,                                         // images, facing, size, softness
        personality: { base: personality, traits: [], react: {} },   // react: moment → which personality's reaction (missing = base)
        lines: {},                                    // speech lines per moment: { wake: ['…'], … }
        talkFreq: 'some',                             // how often it speaks: 'off' / 'some' / 'often'
        moves: ['wall'],                              // how it gets about on the screen (MOVES keys)
        screenRest: REST_DEF,                         // 0.8.5: minutes off the screen after getting about on it
        off: [],                                      // (kept as is) switched off = 끔 in the 행동 tab
        freq: {},                                     // how often, per behaviour: 'rare' / 'often' (missing = 보통)
        pace: 'norm',                                 // walking pace: 'slow' / 'norm' / 'fast'                                      // behaviours switched off in the 행동 tab (BASIC_ACTS / UNLOCKS keys)
        dates: [],                                    // special days: [{ id, kind, md: 'MM-DD', msg }]
        metOn: true,                                  // celebrate the day we met every year
        celebrated: {},                               // date id ('met' for the day we met) → the day it was last celebrated
        sounds: {},                                   // per-moment sound files (empty = default)
        gifts: [],                                    // 0.10.0 선물: [{ id, src, name, memo?, size 's'|'m'|'l', at, fresh? }]
        home: null,                                   // { chatId, integrity } or null = homeless
        bowl: { me: 0, them: 0, tokens: 0 },          // food waiting
        eaten: { me: 0, them: 0, tokens: 0 },         // lifetime eaten
        pats: { score: 0, lastDay: null },
        today: { day: null, eaten: 0, full: false },
        lastVisit: now,
        journal: { talkDays: 0, lastTalkDay: null, moments: [] },
        places: [],                                   // 0.10.9 함께한 곳: [{ id, name, grp, from, to, n, memo, at: { chatId, integrity } | null, hide? }]
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

/** 0.8.2: the one '화면 돌아다니기' setting ('screen') becomes 오르기 / 날기 / 휙휙 rows — the ways it had keep its 빈도. */
function splitScreen(p) {
    if (!p || typeof p !== 'object') return;
    const off = Array.isArray(p.off) && p.off.includes('screen');
    const f = p.freq && typeof p.freq === 'object' ? p.freq.screen : undefined;
    if (!off && f === undefined) return;
    const on = movesOf(p);
    if (off) { p.moves = []; p.off = p.off.filter(k => k !== 'screen'); }
    else { p.moves = on; for (const m of on) if (p.freq[m] === undefined) p.freq[m] = f; }
    if (p.freq) delete p.freq.screen;
}

/** 0.9.0: 흥얼·두리번·앉기 left 제자리 놀기 for rows of their own — a pet that had 제자리 놀기 off / rare / often keeps that for them. */
function splitFidget(p) {
    if (!p || typeof p !== 'object' || p.acts090) return;
    p.acts090 = true;
    const keys = ['hum', 'scan', 'sit'];
    if (Array.isArray(p.off) && p.off.includes('fidget')) p.off = [...new Set([...p.off, ...keys])];
    const f = p.freq && typeof p.freq === 'object' ? p.freq.fidget : undefined;
    if (f === 'rare' || f === 'often') for (const k of keys) if (p.freq[k] === undefined) p.freq[k] = f;
}

function migrate(r) {
    r.settings ??= {};
    if (r.settings.replyOn === undefined && r.settings.soundOn !== undefined) r.settings.replyOn = !!r.settings.soundOn;   // 0.10.11: 나누기 전에 켜 뒀으면 둘 다 켜짐
    fillDefaults(r.settings, defaultSettings());
    if (!Array.isArray(r.settings.replyOff)) r.settings.replyOff = [];
    if (!Array.isArray(r.settings.replyFiles)) r.settings.replyFiles = [];
    for (const p of r.pets) {
        if (!p || typeof p !== 'object') continue;
        splitScreen(p);
        splitFidget(p);
        if (Array.isArray(p.lines)) p.lines = p.lines.length ? { play: p.lines.filter(x => typeof x === 'string') } : {};   // was a plain list (always empty)
        const blank = newPetRecord({ id: p.id, name: p.name, personality: 'aegyo', look: {} });
        delete blank.createdAt; delete blank.lastVisit; delete blank.home;
        fillDefaults(p, blank);
        p.look ??= {};
        fillDefaults(p.look, { kind: 'single', facing: 'front', roles: {}, roleOpts: {}, baseline: 0, size: DEFAULT_SIZE, squish: 0.5 });
        if (!Array.isArray(p.dates)) p.dates = [];
    }
    // saved looks (내가 올린 외형): pictures uploaded once can be picked again for new pets.
    // Pictures pets already wear go in on their own (once — they are found by their file).
    if (!Array.isArray(r.looks)) r.looks = [];
    for (const p of r.pets) {
        const first = p?.look?.roles?.idle?.[0];
        if (!first || first.startsWith('builtin:')) continue;
        if (r.looks.some(l => l?.roles?.idle?.[0] === first)) continue;
        r.looks.push({
            id: 'l' + Math.random().toString(36).slice(2, 10),
            name: String(p.name || LX('내 그림', 'My picture')),
            kind: p.look.kind || 'single',
            facing: p.look.facing || 'front',
            squish: p.look.squish ?? 0.5,
            roles: structuredClone(p.look.roles),
            roleOpts: structuredClone(p.look.roleOpts || {}),
            baseline: p.look.baseline || 0,
            createdAt: p.createdAt || Date.now(),
        });
    }
    for (const l of r.looks) if (l && typeof l === 'object' && (!l.roleOpts || typeof l.roleOpts !== 'object')) l.roleOpts = {};
    if (!r.duets || typeof r.duets !== 'object' || Array.isArray(r.duets)) r.duets = {};   // 0.10.8: 'idA+idB' → [[[id, line], …], …]
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
        readOnlyReason = LX('저장된 Tavvy 기록의 모양이 이상해서, 덮어쓰지 않도록 저장을 멈췄어요.', 'The saved Tavvy data looks wrong, so saving is paused to avoid overwriting it.');
        root = newRoot();
        attached = false;
        return;
    }
    if (cur.formatVersion > FORMAT_VERSION) {
        readOnly = true;
        readOnlyReason = LX('더 새로운 버전의 Tavvy가 저장한 기록이에요. 기록을 지키려고 저장을 멈췄어요. 확장을 업데이트해 주세요.', 'This data was saved by a newer version of Tavvy. Saving is paused to protect it. Please update the extension.');
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
        readOnlyReason = LX('Tavvy 기록을 다시 확인해야 해요. 페이지를 새로고침해 주세요.', 'Tavvy needs to check its data again. Please reload the page.');
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
        if (r.branch || h.branch) return { here: false, changed: false };   // a branch (here or at home) — don't follow automatically
        // 0.11.5: an imported chat keeps the old one's integrity too. Follow only when the old chat is gone (= renamed).
        if (copyCheck.get(copyKey(h, r)) !== 'renamed') return { here: false, changed: false };
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

/* 0.11.5: same integrity, different name — renamed, or a copy (대화 불러오기)?
 * Asked once per pair: is the pet's old chat still in this character's / group's chat list?
 * Still there → a copy, the pet stays home. Gone → renamed, it follows. Can't tell → stays (safe). */
const copyCheck = new Map();   // copyKey → 'copy' | 'renamed' (runtime only)
const copyKey = (h, r) => `${h.chatId}\u0000${r.chatId}`;

/** Chat names of the open character or group, or null if they can't be read. */
async function chatNames() {
    const c = ctx();
    try {
        if (c.groupId) {
            const g = (c.groups || []).find(x => String(x.id) === String(c.groupId));
            return Array.isArray(g?.chats) ? new Set(g.chats.map(String)) : null;
        }
        const ch = c.characters?.[c.characterId];
        if (!ch?.avatar) return null;
        const res = await fetch('/api/characters/chats', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ avatar_url: ch.avatar, simple: true }) });
        if (!res.ok) return null;
        const list = await res.json();
        if (!Array.isArray(list)) return null;
        return new Set(list.map(x => String(x?.file_name || '').replace(/\.jsonl$/i, '')));
    } catch { return null; }
}

async function checkCopies(r) {
    if (!r?.integrity || r.branch || !root) return;
    const todo = root.pets.filter(p => p.home && !p.home.branch && p.home.integrity === r.integrity
        && p.home.chatId !== r.chatId && !copyCheck.has(copyKey(p.home, r)));
    if (!todo.length) return;
    const names = await chatNames();
    if (!names) return;                                           // can't tell → not remembered, asked again next visit
    for (const p of todo) copyCheck.set(copyKey(p.home, r), names.has(p.home.chatId) ? 'copy' : 'renamed');
}

/** The address of the open room, to keep as a pet's home. */
const homeOf = (r) => (r.branch ? { chatId: r.chatId, integrity: r.integrity, branch: true } : { chatId: r.chatId, integrity: r.integrity });

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

/** Is this picture a 키 맞추기 one? { w, h, m } once known, null if not (or not yet — it is checked once, in the background). */
const fits = new Map();
function fitOf(src) {
    if (!src) return null;
    if (fits.has(src)) return fits.get(src);
    fits.set(src, null);
    if (src.startsWith(BASE)) return null;                                  // built-in pets never are
    loadImage(src).then((im) => {
        const n = FIT_MARK.length + 1;
        if (im.naturalWidth < n) return;
        const cv = document.createElement('canvas');
        cv.width = n; cv.height = 1;
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0, n, 1, 0, 0, n, 1);
        const d = g.getImageData(0, 0, n, 1).data;
        const m = d[(n - 1) * 4 + 3];
        if (FIT_MARK.every((a, i) => d[i * 4 + 3] === a) && m >= 1 && m <= FIT_M_MAX) fits.set(src, { w: im.naturalWidth, h: im.naturalHeight, m });
    }).catch(() => { /* stays a normal picture */ });
    return null;
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
    return { kind: b.roles.walk?.length > 1 ? 'frames' : 'single', facing: b.facing, roles, roleOpts: {}, baseline: b.baseline, size: { ...DEFAULT_SIZE }, squish: 0.5 };
}

/** The box around the visible (non-transparent) part of an image, or null if it is empty. */
function opaqueBox(g, w, h) {
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > 8) {
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
    }
    return x1 >= 0 ? { sx: x0, sy: y0, sw: x1 - x0 + 1, sh: y1 - y0 + 1 } : null;
}

const READ_MAX = 1200;           // big photos are shrunk to this first (the pet ends up ≤ 384 anyway)
const BG_TOL = 28;              // "배경 지우기" default strength (how different a colour may be and still count as background)

async function loadFileImage(file) {
    const url = URL.createObjectURL(file);
    try {
        return await loadImage(url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * One piece of a picture on a canvas. box = { sx, sy, sw, sh } in the picture's own pixels (null = all of it).
 * The piece is cut from the full-size picture first and only then shrunk, so a small piece of a big photo stays sharp.
 */
function imageCanvas(im, box) {
    const W = im.naturalWidth, H = im.naturalHeight;
    let sx = 0, sy = 0, sw = W, sh = H;
    if (box) {
        sx = clamp(Math.round(box.sx), 0, W - 1); sy = clamp(Math.round(box.sy), 0, H - 1);
        sw = clamp(Math.round(box.sw), 1, W - sx); sh = clamp(Math.round(box.sh), 1, H - sy);
    }
    const k = Math.min(1, READ_MAX / Math.max(sw, sh));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(sw * k)); cv.height = Math.max(1, Math.round(sh * k));
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return { cv, g, w: cv.width, h: cv.height, box: { sx, sy, sw, sh }, k };
}

async function fileCanvas(file, box = null) {
    return imageCanvas(await loadFileImage(file), box);
}

/** A sheet piece that was widened to the common size: wipe what lies outside its own picture (bits of the neighbours). */
function keepOnly(c, keep) {
    if (!keep) return;
    const x0 = Math.round((keep.sx - c.box.sx) * c.k), y0 = Math.round((keep.sy - c.box.sy) * c.k);
    const x1 = Math.round((keep.sx + keep.sw - c.box.sx) * c.k), y1 = Math.round((keep.sy + keep.sh - c.box.sy) * c.k);
    if (x0 > 0) c.g.clearRect(0, 0, x0, c.h);
    if (x1 < c.w) c.g.clearRect(x1, 0, c.w - x1, c.h);
    if (y0 > 0) c.g.clearRect(0, 0, c.w, y0);
    if (y1 < c.h) c.g.clearRect(0, y1, c.w, c.h - y1);
}

/**
 * Plain background → transparent. Looks at the picture's edge: if it is mostly one solid colour,
 * that colour is wiped out starting from the edge (so the same colour INSIDE the character, which
 * isn't connected to the edge, stays). The rim gets softened so no hard white fringe is left.
 * Does nothing for pictures that are already transparent or have a busy background. Returns true if it erased.
 */
function removeBg(g, w, h, tol = BG_TOL) {
    if (w < 3 || h < 3 || tol <= 0) return false;
    const img = g.getImageData(0, 0, w, h), d = img.data;
    const edge = [];
    for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
    // already see-through around the edge → nothing to do
    let clear = 0;
    for (const i of edge) if (d[i * 4 + 3] < 128) clear++;
    if (clear > edge.length * 0.5) return false;
    // the most common edge colour (in coarse buckets), averaged
    const buckets = new Map();
    for (const i of edge) {
        const o = i * 4;
        if (d[o + 3] < 128) continue;
        const key = (d[o] >> 4) << 8 | (d[o + 1] >> 4) << 4 | (d[o + 2] >> 4);
        const b = buckets.get(key) || buckets.set(key, { n: 0, r: 0, g: 0, b: 0 }).get(key);
        b.n++; b.r += d[o]; b.g += d[o + 1]; b.b += d[o + 2];
    }
    let top = null;
    for (const b of buckets.values()) if (!top || b.n > top.n) top = b;
    if (!top || top.n < edge.length * 0.35) return false;                      // edge isn't one plain colour
    const br = top.r / top.n, bgc = top.g / top.n, bb = top.b / top.n;
    const dist = (o) => Math.max(Math.abs(d[o] - br), Math.abs(d[o + 1] - bgc), Math.abs(d[o + 2] - bb));
    // flood from the edge through background-coloured pixels
    const seen = new Uint8Array(w * h);                                         // 1 = background
    const stack = [];
    for (const i of edge) if (!seen[i] && d[i * 4 + 3] > 8 && dist(i * 4) <= tol) { seen[i] = 1; stack.push(i); }
    while (stack.length) {
        const i = stack.pop(), x = i % w;
        const near = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
        for (const j of near) {
            if (j < 0 || j >= w * h || seen[j]) continue;
            const o = j * 4;
            if (d[o + 3] > 8 && dist(o) <= tol) { seen[j] = 1; stack.push(j); }
        }
    }
    let wiped = 0;
    for (let i = 0; i < w * h; i++) if (seen[i]) { d[i * 4 + 3] = 0; wiped++; }
    if (!wiped) return false;
    // soften the rim: pixels touching the background that are still close to its colour fade out,
    // and lose the background tint they picked up (otherwise a pale halo shows on dark themes)
    const soft = tol * 2.5;
    for (let i = 0; i < w * h; i++) {
        if (seen[i]) continue;
        const x = i % w;
        if (!((x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1]) || (i >= w && seen[i - w]) || (i < w * (h - 1) && seen[i + w]))) continue;
        const o = i * 4, dd = dist(o);
        if (dd >= soft) continue;
        const a = Math.max(0.05, (dd - tol) / (soft - tol));
        d[o] = clamp((d[o] - br * (1 - a)) / a, 0, 255);
        d[o + 1] = clamp((d[o + 1] - bgc * (1 - a)) / a, 0, 255);
        d[o + 2] = clamp((d[o + 2] - bb * (1 - a)) / a, 0, 255);
        d[o + 3] = Math.round(d[o + 3] * a);
    }
    g.putImageData(img, 0, 0);
    return true;
}

/**
 * Several pictures for one action (frames): cropped with ONE shared box when they are the same size,
 * so the frames don't jump around. Returns [{ base64, dataUrl, w, h }] in the given order.
 */
async function prepareFrames(files, crop, bgTol = 0, cuts = null) {
    let cvs;
    if (cuts?.length) {                                   // one picture cut by hand, or a sheet split into pieces
        const im = await loadFileImage(files[0]);
        cvs = cuts.map(b => imageCanvas(im, b));
    } else {
        cvs = await Promise.all(files.map(f => fileCanvas(f)));
    }
    if (bgTol > 0) for (const c of cvs) removeBg(c.g, c.w, c.h, bgTol);
    if (cuts?.length) cvs.forEach((c, i) => keepOnly(c, cuts[i].keep));     // after the background is gone
    const same = cvs.every(c => c.w === cvs[0].w && c.h === cvs[0].h);
    let shared = null;
    if (crop && same) {
        for (const c of cvs) {
            const b = opaqueBox(c.g, c.w, c.h);
            if (!b) continue;
            if (!shared) { shared = { ...b }; continue; }
            const x1 = Math.max(shared.sx + shared.sw, b.sx + b.sw), y1 = Math.max(shared.sy + shared.sh, b.sy + b.sh);
            shared.sx = Math.min(shared.sx, b.sx); shared.sy = Math.min(shared.sy, b.sy);
            shared.sw = x1 - shared.sx; shared.sh = y1 - shared.sy;
        }
    }
    return cvs.map(c => finishPng(c, crop && !same, shared));
}

/** Read a user PNG, optionally crop transparent margins, limit size. Returns { base64, w, h }. */
async function preparePng(file, crop, bgTol = 0, box = null) {
    const c = await fileCanvas(file, box);
    if (bgTol > 0) removeBg(c.g, c.w, c.h, bgTol);
    return finishPng(c, crop, null);
}

function finishPng({ cv, g, w, h }, crop, box) {
    let sx = 0, sy = 0, sw = w, sh = h;
    const b = box || (crop ? opaqueBox(g, w, h) : null);
    if (b) ({ sx, sy, sw, sh } = b);
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

/** Which action a picture list belongs to (lists are compared by identity). */
function roleKeyOf(look, list) {
    for (const k in look.roles || {}) if (look.roles[k] === list) return k;
    return null;
}

/** {{user}} → what this pet calls you (0.11.14), else your name. */
function fillUser(text, rec) {
    return fillName(text, 'user', String(rec?.callMe || '').trim() || ctx().name1 || LX('나', 'you')).trim();
}

/* 0.10.10 이름 뒤 조사 맞추기: 적힌 조사가 받침과 안 맞으면 바꿈. [받침 있을 때, 없을 때] */
const JOSA_PAIRS = [['이라도', '라도'], ['이에요', '예요'], ['이랑', '랑'], ['이나', '나'], ['이야', '야'], ['으로', '로'],
    ['은', '는'], ['이', '가'], ['을', '를'], ['과', '와'], ['아', '야']];
const JOSA_OF = {};   // 적힌 조사 → 짝 (앞에 있는 짝이 우선: '야'는 부르는 말 '아/야'로)
for (const pr of JOSA_PAIRS.slice().reverse()) for (const w of pr) JOSA_OF[w] = pr;
const JOSA_RE = new RegExp(`^(${Object.keys(JOSA_OF).sort((a, b) => b.length - a.length).join('|')})`);
JOSA_OF['야'] = ['아', '야'];

/** {{tag}} → name, and fix the particle right after it to match the name's last syllable. */
function fillName(text, tag, name) {
    const parts = String(text || '').split(new RegExp(`\\{\\{${tag}\\}\\}`, 'i'));
    const c = name ? name.charCodeAt(name.length - 1) : 0;
    const hangul = c >= 0xAC00 && c <= 0xD7A3;   // 영어·숫자로 끝나는 이름은 적힌 그대로
    const jong = hangul ? (c - 0xAC00) % 28 : 0;
    let out = parts[0];
    for (let i = 1; i < parts.length; i++) {
        let rest = parts[i];
        const j = hangul && rest.match(JOSA_RE)?.[1];
        if (j) {
            const pr = JOSA_OF[j];
            const want = pr[0] === '으로' ? (jong && jong !== 8 ? '으로' : '로') : pr[jong ? 0 : 1];
            rest = want + rest.slice(j.length);
        }
        out += name + rest;
    }
    return out;
}

function petFiles(pet) {
    const out = [];
    for (const list of Object.values(pet.look?.roles || {})) {
        for (const p of list || []) if (p && !p.startsWith('builtin:')) out.push(p);
    }
    for (const p of Object.values(pet.sounds || {})) if (typeof p === 'string') out.push(p);
    for (const g of pet.gifts || []) if (typeof g?.src === 'string') out.push(g.src);   // 0.10.0 선물
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
    measurePanels(chat);
}

// 0.11.17 같은 화면의 창: another extension's panel above the input box, a floating window over the chat…
// Their top edges are ledges too. Only the part inside the chat column counts; a window that hides most of the chat
// (a menu laid over it) is skipped.
const PANEL_SEL = '#form_sheld > :not(#send_form), #movingDivs > *, #sheld > :not(#chat):not(#form_sheld)';
const PANEL_COVER = 0.6;         // covers more than this share of the chat → in front of it, not a ledge
function measurePanels(chat) {
    const cr = chat.getBoundingClientRect();
    const area = Math.max(1, cr.width * cr.height);
    for (const el of document.querySelectorAll(PANEL_SEL)) {
        if (el.id?.startsWith('tavvy') || el.closest('#chat')) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 24) continue;
        const left = Math.max(r.left, stage.left), right = Math.min(r.right, stage.right);
        if (right - left < 60) continue;                     // beside the chat column, not in it
        if (r.top < stage.chatTop || r.top > stage.floorY - 6) continue;
        const ow = Math.min(r.right, cr.right) - Math.max(r.left, cr.left), oh = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);
        if (ow > 0 && oh > 0 && ow * oh / area > PANEL_COVER) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.1) continue;
        plats.push({ el, top: r.top, left, right, user: false, panel: true });
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
    // 선물 = an 애교 "나 보며 반응"; 마음이 풀린 반응 = needs at least one reaction that isn't 애교
    const meK = kindOf(rec, 'me');
    const allAegyo = REACT_MOMENTS.every(m => kindOf(rec, m.key) === 'aegyo');
    return UNLOCKS.filter(u => (u.only !== 'aegyo' || meK === 'aegyo') && (u.not !== 'aegyo' || !allAegyo));
}

/** Everyday behaviours with an 끔 / 드물게 / 보통 / 자주 choice in the 행동 tab (walking and eating always stay). */
const BASIC_ACTS = [
    { key: 'wall',   name: LX('화면 오르기', 'Climb the screen') },     // 0.8.2: was one row '화면 돌아다니기' ('screen') + chips in 꾸미기
    { key: 'fly',    name: LX('날기', 'Fly') },
    { key: 'dash',   name: LX('휙휙', 'Dash') },
    { key: 'portal', name: LX('차원문', 'Portal') },              // 0.11.3: into a door, out of another one somewhere else
    { key: 'climb',  name: LX('말풍선 오르기', 'Climb messages') },
    { key: 'doze',   name: LX('졸기', 'Doze') },
    { key: 'hum',    name: LX('흥얼거리기', 'Humming') },       // 0.9.0
    { key: 'scan',   name: LX('두리번거리기', 'Looking around') },
    { key: 'sit',    name: LX('앉기', 'Sit'), needs: 'sit' },   // only with a 앉기 picture
    { key: 'read',   name: LX('글 읽는 척', 'Pretending to read') },
    { key: 'run',    name: LX('갑자기 달리기', 'Sudden runs') },
    { key: 'peek',   name: LX('빼꼼 숨기', 'Peekaboo') },
    { key: 'roll',   name: LX('구르기', 'Roll') },
    { key: 'me',     name: LX('나 보며 반응', 'Reacting to you') },
    { key: 'zone',   name: LX('멍 (로딩 중)', 'Spacing out (loading)') },           // 0.10.12: a little wheel spins over its head
    { key: 'visit',  name: LX('말 걸러 가기', 'Going over to talk'), many: true },   // 0.10.9: walks over to another pet to talk
    { key: 'bump',   name: LX('부딪히기', 'Bumping'), many: true },       // 0.10.9: was always rare
    { key: 'night',  name: LX('잘 자', 'Good night'), many: true },          // 0.10.12: another one nods off close by
    { key: 'napwith', name: LX('같이 졸기', 'Napping together'), many: true },     // 0.10.12
    { key: 'tag',    name: LX('쫓아가기 장난', 'Chase game'), many: true },  // 0.10.12
    { key: 'race',   name: LX('먼저 달려가기', 'Racing there first'), many: true },  // 0.10.12: up to a new reply first
    { key: 'share',  name: LX('나눠 먹기', 'Sharing food'), many: true },      // 0.10.12: a bite of the other one's meal (a show only)
];
// 0.8.0: the personality is a preset — how often each thing happens and which reaction shows can be set freely.
const FREQS = [['off', LX('끔', 'Off')], ['rare', LX('드물게', 'Rarely')], ['norm', LX('보통', 'Normal')], ['often', LX('자주', 'Often')]];
const FREQ_X = { rare: 0.5, norm: 1, often: 2 };
const NO_FREQ = ['soft'];       // on / off only (it changes how a reaction looks, not how often)
const PACES = [['slow', LX('느리게', 'Slow'), 0.7], ['norm', LX('보통', 'Normal'), 1], ['fast', LX('빠르게', 'Fast'), 1.35]];
const REACT_MOMENTS = [         // moments whose reaction may come from another personality
    { key: 'wake', name: LX('깨울 때', 'When woken') },
    { key: 'pat',  name: LX('쓰다듬을 때', 'When patted') },
    { key: 'me',   name: LX('나 보며 반응', 'Reacting to you') },
    { key: 'eat',  name: LX('밥 먹을 때', 'When eating') },
    { key: 'land', name: LX('착지·부딪힐 때', 'Landing · bumping') },
    { key: 'send', name: LX('내가 보낼 때', 'When you send') },
    { key: 'bed',  name: LX('재울 때', 'When put to bed') },
];

/** Which personality's reaction this pet uses at moment m (who = actor or record). */
function kindOf(who, m) {
    const rec = who?.rec || who;
    const r = rec?.personality?.react?.[m];
    if (PERSONALITIES[r]) return r;
    const b = rec?.personality?.base;
    return PERSONALITIES[b] ? b : 'aegyo';
}
const persOf = (who, m) => PERSONALITIES[kindOf(who, m)];

/** How often: 0 (끔) / 0.5 / 1 / 2. */
function fr(who, key) {
    const rec = who?.rec || who;
    if (isOff(rec, key)) return 0;
    if (isPres(key)) return FREQ_X[rec?.freq?.[key]] ?? FREQ_X.rare;   // 0.10.0 선물: 처음엔 드물게
    if (isAtt(key)) return FREQ_X[rec?.freq?.[key]] ?? 0;      // attitudes: nothing until you pick one
    return FREQ_X[rec?.freq?.[key]] ?? 1;
}
const isAtt = (key) => ATTITUDES.some(a => a.key === key);
/** A chance p scaled by the behaviour's 빈도 (never quite certain unless it already was). */
const chance = (who, key, p) => (p >= 1 ? p * Math.min(1, fr(who, key)) : Math.min(0.95, p * fr(who, key)));
// 0.11.23: a wide stage (PC chat ~960px vs phone ~390px) made every walk 2–3× longer → felt like half speed. Faster on wide screens only.
const WIDE_BASE = 600, WIDE_MAX = 1.6;   // stage px where speeding up starts · most it speeds up
const wideK = () => clamp((stage.right - stage.left) / WIDE_BASE, 1, WIDE_MAX) || 1;
const paceOf = (rec) => (PACES.find(x => x[0] === rec?.pace) || PACES[1])[2] * wideK();

/** Anything changed from the preset (빈도, 반응, 걸음)? */
function customised(rec) {
    const r = rec?.personality?.react || {};
    return (rec?.off?.length || 0) > 0 || Object.keys(rec?.freq || {}).length > 0 || (rec?.pace && rec.pace !== 'norm') || movesOf(rec).join() !== 'wall' || restOf(rec) !== REST_DEF
        || Object.values(r).some(k => PERSONALITIES[k]);
}

/** Switched off for this pet in the 행동 tab? */
function isOff(who, key) {
    const rec = who?.rec || who;
    return Array.isArray(rec?.off) && rec.off.includes(key);
}

/** Has this pet (actor or record) learned behaviour `key` (and not had it switched off)? */
function can(who, key) {
    const rec = who?.rec || who;
    const u = unlocksFor(rec).find(x => x.key === key);
    return !!u && levelOf(rec) >= u.lv && !isOff(rec, key);
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
    if (!text) return;   // '' = no mark (only a gesture)
    const el = document.createElement('div');
    el.className = 'tavvy-fx ' + cls;
    el.textContent = text;
    const top = stage.floorY - actor.y - actor.h * actor.scale;
    el.style.left = (actor.x + (Math.random() - 0.5) * actor.w * 0.4 - stage.ox) + 'px';
    el.style.top = (top - stage.oy) + 'px';
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 2000);
    if (text === '♥') playSound('heart', cls ? 0.6 : 1, false, actor.rec);
}

/* ---------- 0.10.5 소리: short sounds made in code (no files). Off unless turned on in ⚙ 설정. ---------- */

const SND_GAP = 0.8;          // seconds before the same sound can play again
const SND_MASTER = 0.6 * 3.3; // 0.11.13: loudness at 100% (was 0.6 — too quiet next to the phone's own sounds)
let sndCtx = null, sndOut = null, sndTouched = false, sndBusyTill = 0, sndNoise = null;
const sndLast = {};

function sndTone(f, d, o = {}) {
    const c = sndCtx, t = c.currentTime + (o.at || 0);
    const os = c.createOscillator(), g = c.createGain();
    os.type = o.type || 'sine';
    os.frequency.setValueAtTime(f, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + d);
    const v = (o.v || 0.5) * (o.k || 1), a = o.atk || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    let n = os;
    if (o.lp) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp; os.connect(lp); n = lp; }
    n.connect(g); g.connect(sndOut);
    os.start(t); os.stop(t + d + 0.02);
}

// [length in seconds, play(k = loudness 0..1)]
const SOUNDS = {
    heart: [0.16, (k) => sndTone(600, 0.14, { to: 1200, v: 0.4, k })],                                         // 뿅
    wake: [0.62, (k) => { sndTone(1046, 0.4, { v: 0.3, k }); sndTone(1568, 0.5, { v: 0.25, k, at: 0.12 }); }],   // 띠링
    sleep: [0.62, (k) => sndTone(600, 0.6, { to: 300, v: 0.2, k, atk: 0.05 })],                                // 스르르
    reply: [0.7, (k) => {                                                                                      // 딩동 (0.10.7 답 도착)
        sndTone(988, 0.35, { type: 'triangle', v: 0.3, k });
        sndTone(784, 0.5, { type: 'triangle', v: 0.3, k, at: 0.18 });
    }],
    cheer: [0.76, (k) => {                                                                                      // 빰빠밤
        sndTone(392, 0.12, { type: 'square', v: 0.1, k, lp: 2000 });
        sndTone(392, 0.12, { type: 'square', v: 0.1, k, lp: 2000, at: 0.14 });
        for (const f of [523, 659, 784]) sndTone(f, 0.45, { type: 'square', v: 0.07, k, lp: 2000, at: 0.3 });
    }],
    bump: [0.15, (k) => sndTone(720, 0.13, { to: 360, type: 'triangle', v: 0.35, k })],                       // 0.10.13 부딪힐 때 콩
    chat: [0.3, (k) => [470, 560, 500].forEach((f, i) => sndTone(f, 0.08, { to: f * 1.1, type: 'triangle', v: 0.36, k, at: i * 0.1 }))],   // 0.10.13 펫끼리 말할 때 웅얼 (0.11.11: ×2, was too quiet)
};

// 0.11.15 펫마다 대화 목소리 (펫끼리 말할 때). [이름, 길이(초), play(k)] — 'ungeol' is SOUNDS.chat
const CHAT_VOICES = {
    ungeol: [LX('웅얼', 'Mumble'), 0.3, (k) => SOUNDS.chat[1](k)],
    byorong: [LX('뾰롱', 'Boing'), 0.24, (k) => { sndTone(700, 0.1, { to: 1100, v: 0.3, k }); sndTone(950, 0.12, { v: 0.28, k, at: 0.1 }); }],
};

// 0.11.16 펫마다 하트 소리. [이름, 길이(초), play(k)] — 'byong' is SOUNDS.heart
const HEART_SOUNDS = {
    byong: [LX('뿅', 'Pop'), 0.16, (k) => SOUNDS.heart[1](k)],
    chorong: [LX('초롱', 'Glint'), 0.33, (k) => { sndTone(1568, 0.22, { v: 0.22, k }); sndTone(2093, 0.25, { v: 0.2, k, at: 0.06 }); }],
    tokbell: [LX('톡방울', 'Tink'), 0.25, (k) => { sndTone(1318, 0.18, { type: 'triangle', v: 0.3, k }); sndTone(1760, 0.16, { type: 'triangle', v: 0.22, k, at: 0.07 }); }],
    byuing: [LX('쀼잉', 'Boing-up'), 0.23, (k) => { sndTone(900, 0.1, { to: 1400, v: 0.3, k }); sndTone(1400, 0.12, { to: 1100, v: 0.26, k, at: 0.09 }); }],
};
// pet field + choices, per sound slot that has a pick-your-own row
const PICK_SOUNDS = { chat: ['chatVoice', CHAT_VOICES, 'ungeol', LX('목소리', 'Voice')], heart: ['heartSound', HEART_SOUNDS, 'byong', LX('하트 소리', 'Heart sound')] };

// 0.10.11 답 도착 소리: 체크한 것만 답이 올 때마다 돌아가며. [key, 이름, 길이(초), play(k)]
const REPLY_SOUNDS = [
    ['dingdong', LX('딩동', 'Ding-dong'), 0.7, (k) => SOUNDS.reply[1](k)],
    ['bell', LX('방울', 'Bell'), 0.72, (k) => { sndTone(1318, 0.7, { v: 0.3, k }); sndTone(2637, 0.4, { v: 0.08, k }); }],
    ['tok', LX('톡톡', 'Tap tap'), 0.21, (k) => { sndTone(1200, 0.07, { v: 0.35, k }); sndTone(1200, 0.07, { v: 0.3, k, at: 0.12 }); }],
    ['boing', LX('뽀롱', 'Pop'), 0.32, (k) => { sndTone(500, 0.15, { to: 900, v: 0.35, k }); sndTone(900, 0.18, { to: 1400, v: 0.3, k, at: 0.12 }); }],
    ['marimba', LX('마림바', 'Marimba'), 0.46, (k) => { sndTone(659, 0.22, { v: 0.4, k }); sndTone(523, 0.3, { v: 0.4, k, at: 0.14 }); }],
    ['arrive', LX('도착', 'Arrival'), 0.37, (k) => { sndTone(1047, 0.1, { type: 'square', v: 0.26, k, lp: 1800 }); sndTone(1319, 0.25, { type: 'square', v: 0.26, k, lp: 1800, at: 0.1 }); }],   // 0.11.8: was 0.08 (too quiet)
    ['orgel', LX('오르골', 'Music box'), 1.14, (k) => { sndTone(1568, 0.6, { v: 0.32, k }); sndTone(2093, 0.6, { v: 0.27, k, at: 0.16 }); sndTone(1760, 0.8, { v: 0.27, k, at: 0.32 }); }],   // 0.11.8: ×1.8
    ['letter', LX('편지 종', 'Letter bell'), 1.02, (k) => {
        sndTone(880, 0.6, { v: 0.25, k }); sndTone(1760, 0.3, { v: 0.06, k });
        sndTone(660, 0.7, { v: 0.25, k, at: 0.3 }); sndTone(1320, 0.3, { v: 0.05, k, at: 0.3 });
    }],
    // 0.11.8: 도착·피리릭·반짝 3~4×, 오르골 1.8×, 휘파람 1.5× — they were much quieter than the rest
    ['trill', LX('피리릭', 'Flute'), 0.25, (k) => { [1568, 1760, 2093].forEach((f, i) => sndTone(f, 0.09, { type: 'square', v: 0.26, k, lp: 2400, at: i * 0.07 })); }],
    ['sparkle', LX('반짝', 'Twinkle'), 0.34, (k) => { [2093, 2637, 3136].forEach((f, i) => sndTone(f, 0.18, { v: 0.32, k, at: i * 0.07 })); }],
    // 0.11.13: 휘파람·뾱 out, 실로폰·풍경 in
    ['xylo', LX('실로폰', 'Xylophone'), 0.54, (k) => { [784, 988, 1175].forEach((f, i) => { sndTone(f, 0.3, { v: 0.3, k, at: i * 0.11 }); sndTone(f * 4, 0.08, { v: 0.05, k, at: i * 0.11 }); }); }],
    ['chime', LX('풍경', 'Wind chime'), 1.3, (k) => { [2349, 1976, 2637, 2093].forEach((f, i) => sndTone(f, 0.9, { v: 0.21, k, at: i * 0.13 })); }],
];
const REPLY_FILES_MAX = 10;
let replyLast = '';

/* ---------- 0.11.19 소리 느낌: 부드럽게 — sine tones that fade in, ring a little longer, top cut, a touch of echo ---------- */
const SOFT_S = 0.88;             // 부드러움 0..1 (slower start, longer fade, darker)
const SOFT_R = 0.11;             // 울림 0..1 (echo)
let sndRev = null, sndRevCtx = null;
function sndReverb() {
    if (sndRevCtx !== sndCtx) {
        const c = sndCtx, L = Math.floor(c.sampleRate * 1.8), b = c.createBuffer(2, L, c.sampleRate);
        for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < L; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / L, 3.2); }
        sndRev = c.createConvolver(); sndRev.buffer = b; sndRev.connect(sndOut);
        sndRevCtx = c;
    }
    return sndRev;
}
/** A soft tone. o: at, v, k, to (glide), atk, p (an overtone × f) + pv (its loudness). */
function sndSoft(f, d, o = {}) {
    const c = sndCtx, t = c.currentTime + (o.at || 0), v = (o.v || 0.4) * (o.k || 1);
    const a = o.atk ?? (0.008 + SOFT_S * 0.035), D = d * (1 + SOFT_S * 0.6);
    const g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.max(f * 1.6, 7000 - SOFT_S * 5200); lp.Q.value = 0.4;
    const o1 = c.createOscillator();
    o1.type = 'sine'; o1.frequency.setValueAtTime(f, t);
    if (o.to) o1.frequency.exponentialRampToValueAtTime(o.to, t + d * 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + D);
    o1.connect(g);
    if (o.p) {
        const o2 = c.createOscillator(), g2 = c.createGain();
        o2.type = 'sine'; o2.frequency.value = f * o.p;
        g2.gain.setValueAtTime(0.0001, t); g2.gain.linearRampToValueAtTime(v * (o.pv || 0.15), t + a); g2.gain.exponentialRampToValueAtTime(0.0001, t + D * 0.35);
        o2.connect(g2); g2.connect(g); o2.start(t); o2.stop(t + D + 0.05);
    }
    g.connect(lp); lp.connect(sndOut);
    if (SOFT_R > 0) { const rs = c.createGain(); rs.gain.value = SOFT_R * 0.7; lp.connect(rs); rs.connect(sndReverb()); }
    o1.start(t); o1.stop(t + D + 0.05);
}
const softLen = (d, at = 0) => +(at + d * (1 + SOFT_S * 0.6) + 0.05).toFixed(2);
// soft versions: sound key, 'heart:<pick>' (PICK_SOUNDS) or 'reply:<id>'. Not listed → plays as it is.
const SOFT_SOUNDS = {
    heart: [softLen(0.22), (k) => sndSoft(700, 0.22, { to: 1050, v: 0.42, k, p: 2 })],
    wake: [softLen(0.8, 0.14), (k) => { sndSoft(784, 0.6, { v: 0.38, k, p: 2, pv: 0.1 }); sndSoft(1175, 0.8, { v: 0.32, k, at: 0.14, p: 2, pv: 0.08 }); }],
    sleep: [softLen(1.1, 0.35), (k) => { sndSoft(523, 0.9, { to: 392, v: 0.3, k, atk: 0.12 }); sndSoft(392, 1.1, { v: 0.22, k, at: 0.35, atk: 0.15 }); }],
    cheer: [softLen(0.7, 0.27), (k) => [523, 659, 784, 1047].forEach((f, i) => sndSoft(f, 0.7, { v: 0.26, k, at: i * 0.09, p: 2, pv: 0.1 }))],
    bump: [softLen(0.2), (k) => sndSoft(330, 0.2, { to: 220, v: 0.6, k, atk: 0.006 })],
    chat: [softLen(0.13, 0.22), (k) => [392, 466, 415].forEach((f, i) => sndSoft(f, 0.13, { v: 0.42, k, at: i * 0.11, atk: 0.02 }))],
    'heart:chorong': [softLen(0.5, 0.07), (k) => { sndSoft(1568, 0.4, { v: 0.26, k, p: 2.4, pv: 0.08 }); sndSoft(2093, 0.5, { v: 0.22, k, at: 0.07, p: 2.4, pv: 0.06 }); }],
    'heart:tokbell': [softLen(0.3, 0.08), (k) => { sndSoft(1318, 0.3, { v: 0.34, k, p: 3, pv: 0.12, atk: 0.006 }); sndSoft(1760, 0.3, { v: 0.28, k, at: 0.08, p: 3, pv: 0.1, atk: 0.006 }); }],
    'reply:dingdong': [softLen(1, 0.22), (k) => { sndSoft(988, 0.7, { v: 0.34, k, p: 2.76, pv: 0.08 }); sndSoft(784, 1, { v: 0.34, k, at: 0.22, p: 2.76, pv: 0.08 }); }],
    'reply:bell': [softLen(1.1), (k) => sndSoft(1318, 1.1, { v: 0.32, k, p: 2.4, pv: 0.12 })],
    'reply:tok': [softLen(0.12, 0.13), (k) => { sndSoft(1050, 0.12, { v: 0.42, k, atk: 0.004, p: 2, pv: 0.1 }); sndSoft(1050, 0.12, { v: 0.36, k, at: 0.13, atk: 0.004, p: 2, pv: 0.1 }); }],
    'reply:marimba': [softLen(0.5, 0.16), (k) => { sndSoft(659, 0.4, { v: 0.45, k, p: 4, pv: 0.2, atk: 0.006 }); sndSoft(523, 0.5, { v: 0.45, k, at: 0.16, p: 4, pv: 0.2, atk: 0.006 }); }],
    'reply:arrive': [softLen(0.5, 0.12), (k) => { sndSoft(1047, 0.25, { v: 0.36, k, p: 2, pv: 0.12 }); sndSoft(1319, 0.5, { v: 0.36, k, at: 0.12, p: 2, pv: 0.12 }); }],
    'reply:orgel': [softLen(1.2, 0.36), (k) => { sndSoft(1568, 0.9, { v: 0.3, k, p: 3, pv: 0.06 }); sndSoft(2093, 0.9, { v: 0.25, k, at: 0.18, p: 3, pv: 0.05 }); sndSoft(1760, 1.2, { v: 0.25, k, at: 0.36, p: 3, pv: 0.05 }); }],
    'reply:trill': [softLen(0.16, 0.16), (k) => [1568, 1760, 2093].forEach((f, i) => sndSoft(f, 0.16, { v: 0.32, k, at: i * 0.08, atk: 0.01 }))],
    'reply:xylo': [softLen(0.4, 0.24), (k) => [784, 988, 1175].forEach((f, i) => sndSoft(f, 0.4, { v: 0.38, k, at: i * 0.12, p: 4, pv: 0.15, atk: 0.005 }))],
};
// loudness match: highest point at 100% ≈ 0.78 like the crisp ones (measured; never past 1.0)
const SOFT_K = { heart: 0.86, wake: 0.85, cheer: 0.83, bump: 0.67, chat: 0.93, 'reply:dingdong': 0.94, 'reply:tok': 0.85, 'reply:marimba': 0.78, 'reply:arrive': 0.9, 'reply:orgel': 0.96, 'reply:xylo': 0.8 };
for (const [id, x] of Object.entries(SOFT_K)) { const f = SOFT_SOUNDS[id][1]; SOFT_SOUNDS[id][1] = (k) => f(k * x); }
const softOn = () => root?.settings?.soundFeel === 'soft';
/** The soft version of a sound when 부드럽게 is chosen (and there is one). */
const feel = (id, len, play) => (softOn() && SOFT_SOUNDS[id] ? SOFT_SOUNDS[id] : [len, play]);

/** One answer sound by id (built-in key or my file id): { id, len, play } or { id, path }. */
function replyById(id) {
    const b = REPLY_SOUNDS.find(x => x[0] === id);
    if (b) { const [len, play] = feel(`reply:${id}`, b[2], b[3]); return { id, len, play }; }   // 0.11.19 부드럽게
    const f = (root?.settings?.replyFiles || []).find(x => x?.id === id);
    return f && typeof f.path === 'string' ? { id, path: f.path } : null;
}

/** The next answer sound: a checked one, not the same as last time when there are others. */
function pickReply() {
    const s = root?.settings || {}, off = Array.isArray(s.replyOff) ? s.replyOff : [];
    const ids = [...REPLY_SOUNDS.map(x => x[0]), ...(s.replyFiles || []).map(x => x?.id)].filter(id => id && !off.includes(id));
    const pool = ids.length > 1 ? ids.filter(id => id !== replyLast) : ids;
    const r = pool.length ? replyById(pool[Math.floor(Math.random() * pool.length)]) : null;
    return r || replyById('dingdong');     // 다 꺼 두면 딩동
}

function sndReady() {
    if (sndCtx?.state === 'closed') sndCtx = null;
    if (!sndCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        try { sndCtx = new AC(); sndOut = sndCtx.createGain(); sndOut.connect(sndCtx.destination); } catch { sndCtx = null; return false; }
    }
    // 0.10.8: iPhone also has 'interrupted' (after another app / the screen going off) — wake it from any not-running state
    if (sndCtx.state !== 'running') sndCtx.resume().catch(() => {});
    return true;
}

/** 0.11.8: the reply sound has its own volume (starts at the pet-sound volume). */
function volOf(key) {
    const s = root?.settings || {};
    const v = key === 'reply' ? (s.replyVol ?? s.soundVol ?? 60) : (s.soundVol ?? 60);
    return clamp(Number(v) || 0, 0, 100);
}

let sndStuck = false;     // a wake-up during a touch did not work, or 0.11.10: we came back from away → next touch makes a new one

/** During a real touch / click: wake the sound up (iPhone: a stuck one is thrown away and made again). */
function sndWake() {
    if (sndCtx && (sndStuck || sndCtx.state === 'interrupted')) {
        try { sndCtx.close(); } catch { /* already gone */ }
        sndCtx = null; sndStuck = false; sndBufs.clear();
    }
    if (!sndReady()) return;
    const c = sndCtx;
    try {                                                   // a silent blip — iPhone opens the sound only for one played during a touch
        const b = c.createBuffer(1, 1, 22050), src = c.createBufferSource();
        src.buffer = b; src.connect(c.destination); src.start(0);
    } catch { /* fine */ }
    if (c.state !== 'running') setTimeout(() => { if (sndCtx === c && c.state !== 'running') sndStuck = true; }, 400);
}

/** Phones only allow sound after a touch: get it ready then (only when sound is on). */
function sndOnTouch() {
    sndTouched = true;
    if ((root?.settings?.soundOn || root?.settings?.replyOn) && (sndStuck || sndCtx?.state !== 'running')) sndWake();   // 0.11.10: iPhone can say 'running' and stay silent
}

/** 0.11.13: what happened to the last reply sound — shown under 답 도착 in ⚙ 설정 (not saved). */
let replyLastNote = '';
function replyNote(t) {
    const d = new Date(), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    replyLastNote = `${hm} ${t}`;
    const el = win?.body?.querySelector?.('.tw-replynote');
    if (el) el.textContent = `${LX('마지막 답 소리', 'Last reply sound')}: ${replyLastNote}`;
}

/** test = a try-out button (plays even when sound is off or the same sound just played). rec = the pet (its own sound file, if any).
 *  pick = which answer sound (settings ▶); none = the next one in turn. */
function playSound(key, k = 1, test = false, rec = null, pick = null) {
    const s = root?.settings, def = SOUNDS[key];
    const note = (t) => { if (key === 'reply' && !test) replyNote(t); };   // 0.11.13: the last reply sound, for ⚙ 설정
    if (!def || !s) return;
    if (document.hidden) return note(LX('건너뜀 (다른 탭·앱을 보고 있어서)', 'skipped (another tab or app was open)'));
    if (!test && !(key === 'reply' ? s.replyOn : s.soundOn)) return;   // 0.10.11: 답 도착은 따로 켜고 끔
    if (!test && !sndTouched) return note(LX('건너뜀 (아직 화면을 안 눌러서)', 'skipped (no tap on the page yet)'));
    const now = performance.now() / 1000;
    if (!test && now < sndBusyTill) return note(LX('건너뜀 (다른 소리가 나는 중이라)', 'skipped (another sound was playing)'));   // one at a time
    if (!test && now - (sndLast[key] || -99) < SND_GAP) return note(LX('건너뜀 (바로 전에 울려서)', 'skipped (it just played)'));
    if (test) { if (sndCtx) sndStuck = true; sndWake(); }              // try-out buttons are touches — 0.11.10: always a fresh one (fixes a silent iPhone)
    if (!sndReady()) return note(LX('건너뜀 (이 브라우저에서 소리를 못 켜서)', 'skipped (sound isn’t available here)'));
    note(sndCtx.state === 'running' ? LX('울림', 'played')
        : LX('울리려 했지만 폰이 소리를 막고 있었을 수 있어요 (▶ 한 번 눌러 주세요)', 'tried, but the phone may have blocked it (press ▶ once)'));
    sndOut.gain.value = volOf(key) / 100 * SND_MASTER;
    sndLast[key] = now;
    let path = rec?.sounds?.[key], [len, play] = feel(key, def[0], def[1]);   // 0.11.19 부드럽게
    const pk = PICK_SOUNDS[key], pv = pk && rec?.[pk[0]];               // 0.11.15 목소리 · 0.11.16 하트 소리
    if (pv && pv !== pk[2] && Object.hasOwn(pk[1], pv)) [len, play] = feel(`${key}:${pv}`, pk[1][pv][1], pk[1][pv][2]);
    if (key === 'reply' && typeof path !== 'string') {                  // 0.10.11: 그 펫의 내 소리가 없으면 설정의 답 도착 소리
        const r = pick || pickReply();
        replyLast = r.id;
        if (r.path) path = r.path; else { len = r.len; play = r.play; }
    }
    if (typeof path === 'string') {                                     // 0.10.6: the pet's own sound file
        sndBusyTill = now + SND_MAX_SEC;
        sndBuf(path).then((b) => {
            try {
                if (!b) return play(k);                                 // could not read it → the usual sound
                const src = sndCtx.createBufferSource(), g = sndCtx.createGain();
                src.buffer = b; g.gain.value = k;
                src.connect(g); g.connect(sndOut); src.start();
                sndBusyTill = performance.now() / 1000 + Math.min(b.duration, SND_MAX_SEC);
            } catch { /* never let a sound break the pet */ }
        });
        return;
    }
    sndBusyTill = now + len;
    try { play(k); } catch { /* never let a sound break the pet */ }
}

/* ---------- 0.10.6 내 소리: a short file per pet and per sound (empty = the usual sound) ---------- */

const SOUND_SLOTS = [['heart', LX('♥ 하트', '♥ Heart')], ['wake', LX('깨우기', 'Wake')], ['sleep', LX('재우기', 'Sleep')], ['cheer', LX('축하', 'Celebrate')], ['bump', LX('부딪힐 때', 'Bumping')], ['chat', LX('펫끼리 말할 때', 'Pets chatting')], ['reply', LX('답 도착', 'Reply arrives')]];
const SND_MAX_SEC = 5;           // 0.11.18: was 3 (a long one still keeps other sounds waiting until it ends)
const SND_MAX_BYTES = 2 * 1024 * 1024;
const SND_ACCEPT = 'audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.ogg,.m4a';
const sndBufs = new Map();            // file path → Promise<AudioBuffer | null>

function sndBuf(path) {
    if (!sndBufs.has(path)) {
        sndBufs.set(path, (async () => {
            try {
                const res = await fetch(imgUrl(path));
                if (!res.ok) return null;
                return await sndCtx.decodeAudioData(await res.arrayBuffer());
            } catch { return null; }
        })().then((b) => { if (!b) sndBufs.delete(path); return b; }));   // a failed read is tried again next time
    }
    return sndBufs.get(path);
}

function sndExt(name, type) {
    const e = /\.(mp3|wav|ogg|m4a)$/i.exec(name || '')?.[1]?.toLowerCase();
    if (e) return e;
    if (/mpeg|mp3/.test(type)) return 'mp3';
    if (/wav/.test(type)) return 'wav';
    if (/ogg/.test(type)) return 'ogg';
    if (/mp4|m4a|aac/.test(type)) return 'm4a';
    return null;
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
        this.state = 'idle'; this.t = 0; this.until = rand(...this.p.idle) * IDLE_SLOW;
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
        this.pk = null;              // { d } — peeking at the input box
        this.big = null;             // { kind: 'gift', … } — leaning out toward you
        this.meHeart = false;        // 무심 (내편): a ♥ this time
        this.idleTried = false;      // already rolled for "dozing off while you're away" this quiet spell
        this.special = null;         // special days to celebrate when it comes out (birthday…)
        this.sayEl = null;           // speech bubble over its head
        this.lastTalk = -1e9;        // ms — last ordinary line
        this.aside = false;          // walking away with its back turned (등 돌리기)
        this.climbJump = false;      // the big hop up onto a message (말풍선 오르기)
        this.cheering = false;       // dancing because closeness went up (축하)
        this.animList = null; this.animT0 = 0;   // frames: which picture list is playing, since when
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
        if (this.state === 'portal' && this.pt?.ph === 'in') return;   // 0.11.12: walking through a door near the edge goes past it — don't pull it back (it got stuck)
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
        return !this.held && !this.air && !['off', 'tuck', 'wave', 'crouch', 'appear', 'greet', 'sniff', 'eat', 'nod', 'dance', 'roll', 'resist', 'gift', 'sleepy', 'stroll', 'fly', 'portal'].includes(this.state);
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
            nap: persOf(this, 'eat').perch === 'doze' && (tier === 'bowl' || tier === 'feast') };   // 느긋: nods off halfway, then finishes
        this.reunionMeal = true;
        if (take.becameFull) this.fullNow = true;
        spawnMeal(this, take, tier, persOf(this, 'eat').eat || 1);
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
        this.talk('meal');
        if (this.reunionMeal) { this.reunionMeal = false; if (this.afterReunionMeal()) return; }
        if (this.fullNow) { this.fullNow = false; this.fk = 'tummy'; return this.setState('fidget'); }   // full now: pats its tummy ♪
        const el = this.afterMeal; this.afterMeal = null;
        if (!el && actors.length > 1 && this.startShare()) return;     // 0.10.12 나눠 먹기: the other one is still eating
        this.setState('idle');
        if (el && el.isConnected && !this.waiting) this.watchReply(el);
    }

    /** The end of the first meal after waking, by personality. true = it set what happens next. */
    afterReunionMeal() {
        const k = kindOf(this, 'eat');
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
        this.cheering = true;
        this.talk('level');
    }

    /** 화면 오르기 (0.7.12): straight up the screen from where it stands on the floor, back to you. */
    /** 오르기 / 날기 / 휙휙 — each with its own 빈도, sharing one chance between the ones that are on (or none). */
    pickMove() {
        const list = movesOf(this.rec);
        if (!list.length) return null;
        if (Date.now() - (screenAt.get(this.rec.id) || 0) < restOf(this.rec) * 60000) return null;   // 쉬는 시간
        let r = Math.random();
        const each = (this.p.wall || 0) * SCREEN_SCALE / list.length;
        for (const m of list) {
            const c = chance(this, m, each);
            if (r < c) return m;
            r -= c;
        }
        return null;
    }

    startWall(m) {
        if (!MOVES[m]) { const list = movesOf(this.rec); m = list[Math.floor(Math.random() * list.length)] || 'wall'; }
        this.y = 0;
        if (m === 'wall') return this.setState('stroll');
        if (m === 'portal') return this.startPortal();
        this.fmode = m;                                           // 날기 / 휙휙
        this.setState('fly');
    }

    /** 날기 · 휙휙: somewhere new on the screen (the first one: up off the floor). */
    flyPick(first) {
        const L = stage.left + this.w / 2, R = Math.max(L, stage.right - this.w / 2);
        const lo = this.h * 1.2, hi = Math.max(lo, this.strollTop());
        if (first) {
            this.sx = clamp(this.x + rand(-1, 1) * this.w, L, R);
            this.sy = clamp(rand(this.h * 1.6, this.h * 4), lo, hi);
        } else {
            this.sx = rand(L, R);
            this.sy = rand(lo, hi);
            if (Math.hypot(this.sx - this.x, this.sy - this.y) < this.h * 1.5) this.sy = clamp(this.y + (this.y + this.h * 2 <= hi ? 2 : -2) * this.h, lo, hi);
        }
    }

    /** End of 날기 · 휙휙: settle on the floor, onto a message, or (now and then) just let go. */
    flyEnd() {
        const r = Math.random();
        if (r < 0.15) return this.strollDrop();
        if (r < 0.55 && ledgesOn()) {
            const ok = plats.filter(p => p.right - p.left > this.w * 1.2 && p.top > (stage.chatTop || 0) + this.h && p.top < stage.floorY - this.h);
            if (ok.length) {
                const p = ok[Math.floor(Math.random() * ok.length)];
                this.fgoal = 'perch';
                this.sx = clamp(this.x, p.left + this.w * 0.6, p.right - this.w * 0.6);
                this.sy = Math.min(this.strollTop(), stage.floorY - p.top + this.h * 0.3);
                return;
            }
        }
        this.fgoal = 'land';
        const [L, R] = this.range();
        this.sx = clamp(this.x, L, Math.max(L, R));
        this.sy = 0;
    }

    /** Got where it was going (날기 · 휙휙). */
    flyArrive() {
        if (this.fgoal === 'land') {
            this.y = 0;
            const [L, R] = this.range();
            this.x = clamp(this.x, L, Math.max(L, R));
            this.endWall();
            this.sq = this.fmode === 'dash' ? 0.8 : 0.9;
            this.setState('idle');
            return;
        }
        if (this.fgoal === 'perch') return this.strollDrop();   // just above the message → caught by it
        if (this.t > this.until) this.flyEnd(); else this.flyPick(false);
    }

    /** 0.11.3 차원문: a door opens on the floor a little way off; it walks in. */
    startPortal() {
        const [L, R] = this.range();
        if (R - L < this.w) return this.setState('idle');
        let side = this.dir || 1;
        if ((side > 0 ? R - this.x : this.x - L) < this.w * 1.2) side = -side;
        const x = clamp(this.x + side * this.w * rand(1.1, 1.8), L, Math.max(L, R));
        this.y = 0;
        this.setState('portal');
        this.pt = { ph: 'open', k: 0, x, s: x >= this.x ? 1 : -1, a: openDoor(this, x, 0), b: null, to: null };
    }

    /** Where it comes out: up in the air (then falls), on top of a message, or on the floor. */
    portalOut() {
        const L = stage.left + this.w / 2, R = Math.max(L, stage.right - this.w / 2);
        const r = Math.random();
        if (r < 0.4 && ledgesOn()) {
            const ok = plats.filter(p => p.right - p.left > this.w * 1.4 && p.top > (stage.chatTop || 0) + this.h * 1.5 && p.top < stage.floorY - this.h);
            if (ok.length) {
                const p = ok[Math.floor(Math.random() * ok.length)];
                return { k: 'perch', x: rand(p.left + this.w * 0.7, p.right - this.w * 0.7), y: stage.floorY - p.top + this.h * 0.1 };
            }
        }
        const top = this.strollTop();
        if (r < 0.65 && top > this.h * 2) return { k: 'air', x: rand(L, R), y: rand(this.h * 1.6, top) };
        const [fl, fr] = this.range();
        let x = rand(fl, Math.max(fl, fr));
        if (Math.abs(x - this.x) < this.w * 2) x = clamp(this.x + (this.x - fl > fr - this.x ? -1 : 1) * this.w * rand(2, 4), fl, Math.max(fl, fr));
        return { k: 'land', x, y: 0 };
    }

    /** 휙휙: a fading copy of itself left behind. */
    ghost() {
        if (!layer || !this.el.isConnected) return;
        const g = this.el.cloneNode(true);
        g.className = 'tavvy-ghost';
        g.removeAttribute('id');
        layer.insertBefore(g, this.el);
        g.addEventListener('animationend', () => g.remove());
        setTimeout(() => g.remove(), 800);
    }

    /** Back to normal standing (left the wall / the screen). */
    endWall() {
        if (this.wallOn) screenAt.set(this.rec.id, Date.now());   // 쉬는 시간 starts when it comes down
        this.wallOn = false;
        this.tilt = 0; this.tiltv = 0; this.tiltT = 0;
        this.body.style.transformOrigin = '';
        this.sgoal = null; this.fgoal = null;
        if (this.pt) {                                            // 0.11.3 차원문: doors close, it is back in sight
            shutDoor(this.pt.a); shutDoor(this.pt.b);
            this.pt = null;
            this.el.style.opacity = '';
        }
        this.portalMask(null);
    }

    /** 0.11.9 차원문: the part past the door's middle line is out of sight (cut = { E: line x, s: walking side }); null = all back. */
    portalMask(cut) {
        this.pcut = cut;
        this.wobY = 0;
        if (!cut) { this.el.style.webkitMaskImage = this.el.style.maskImage = ''; }
    }

    /** Highest a pet may go on the screen (feet height above the floor). */
    strollTop() { return Math.max(this.h, stage.floorY - (stage.chatTop || 0) - this.h - 4); }

    /** Pick somewhere new on the screen to stroll to. */
    strollPick(up) {
        const L = stage.left + this.w / 2, R = Math.max(L, stage.right - this.w / 2);
        const lo = this.h * 1.2, hi = Math.max(lo, this.strollTop());
        const nearEdge = this.x - L < this.w * 1.5 || R - this.x < this.w * 1.5;
        if (!up && Math.random() < (nearEdge ? 0.5 : 0.25)) {           // now and then a little way sideways (away from a side)
            const side = this.x - L < this.w * 1.5 ? 1 : R - this.x < this.w * 1.5 ? -1 : Math.random() < 0.5 ? -1 : 1;
            this.sx = clamp(this.x + side * rand(this.w, this.w * 2.5), L, R);
            this.sy = clamp(this.y + rand(-0.3, 0.3) * this.h, lo, hi);
        } else {                                                 // mostly straight up or down
            this.sx = clamp(this.x + rand(-0.15, 0.15) * this.w, L, R);
            let y = rand(lo, hi);
            if (Math.abs(y - this.y) < this.h * 1.5) y = this.y + (this.y + this.h * 2 <= hi ? 2 : -2) * this.h;
            this.sy = clamp(y, lo, hi);
        }
        this.sp = 0; this.spLen = rand(0.8, 2.5); this.cph = 0; this.slipT = 0;
    }

    /** End of a stroll: drop, climb back down to the floor, or step onto a message. */
    strollEnd() {
        const r = Math.random();
        if (r < 0.35) {                                          // climb straight back down (still showing its back)
            this.sgoal = 'down';
            this.sx = this.x; this.sy = 0; this.sp = 0; this.spLen = 0;
            return;
        }
        if (r < 0.65 && ledgesOn()) {                           // over a message, then onto it
            const ok = plats.filter(p => p.right - p.left > this.w * 1.2 && p.top > (stage.chatTop || 0) + this.h && p.top < stage.floorY - this.h);
            if (ok.length) {
                const p = ok[Math.floor(Math.random() * ok.length)];
                this.sgoal = 'drop';
                this.sx = clamp(this.x, p.left + this.w * 0.6, p.right - this.w * 0.6);
                this.sy = Math.min(this.strollTop(), stage.floorY - p.top + this.h * 0.5);
                this.sp = 0; this.spLen = 0;
                return;
            }
        }
        this.strollDrop();
    }

    /** Let go of the screen and fall (caught by a message on the way, like being put down). */
    strollDrop() {
        this.endWall();
        this.air = true; this.vy = 0; this.vx = 0; this.next = 'idle';
        this.setState('fall');
    }

    /** A small hop straight up, landing where it stood (floor or the same message). */
    hopInPlace(next) {
        this.air = true; this.vy = rand(240, 320); this.vx = 0;
        this.next = next;
        this.sq = 0.92;
        this.setState('jump');
    }

    /* ---------- 0.9.0: everyday things · attitudes ---------- */

    /** 빼꼼 숨기: to the nearer side, half out of sight, then a peek back. */
    startPeek() {
        const [L, R] = this.range();
        if (R - L < 40) return false;
        const s = this.x - stage.left < stage.right - this.x ? -1 : 1;
        const go = { k: 'hide', s, E: s < 0 ? stage.left : stage.right };
        const wx = s < 0 ? L : R;
        if (Math.abs(wx - this.x) <= 10) { this.arrive(go); return true; }
        this.walkTo(wx);
        this.go = go;
        return true;
    }

    /* ---------- 0.10.0 선물: a present you gave it ---------- */

    giftList() { return (this.rec.gifts || []).filter(g => g && typeof g.src === 'string' && !g.fresh); }

    /** 0.10.13: one present to take out — the favourite (♥) about half the time. */
    pickGift() {
        const l = this.giftList(), fav = l.find(g => g.fav);
        if (fav && Math.random() < GIFT_FAV_P) return fav;
        return l[Math.floor(Math.random() * l.length)];
    }

    /** 0.10.13: room to roll it along this message (ends kept clear). */
    ledgeRollOk(g) {
        if (!this.plat || !this.pr || !g) return false;
        const w = Math.min(this.pr.right, stage.right) - Math.max(this.pr.left, stage.left);
        return w >= this.w + this.h * giftK(g) + LEDGE_ROLL_ROOM;
    }

    /** Where the present may be: the screen, or this message with its ends kept clear (0.10.13). */
    toyRange(g) {
        const hp = this.h * giftK(g);
        let lo = stage.left + hp / 2, hi = stage.right - hp / 2;
        if (this.plat && this.pr) { lo = Math.max(lo, this.pr.left + hp / 2 + 8); hi = Math.min(hi, this.pr.right - hp / 2 - 8); }
        return [lo, Math.max(lo, hi)];
    }

    /** Take a present out: look (구경) / show (자랑) / roll (굴리기) / toss (던졌다 받기) / recv (just given — it drops in). */
    startToy(kind, g) {
        if (!g) g = this.pickGift();
        if (!g) return false;
        if ((kind === 'toss' || (kind === 'roll' && !this.ledgeRollOk(g))) && this.plat) kind = 'look';   // 0.10.13: 넓은 말풍선 위에선 굴려요
        const hp = this.h * giftK(g), [lo, hi] = this.toyRange(g);
        let s = this.side ? this.dir : (Math.random() < 0.5 ? -1 : 1);
        if ((s > 0 ? hi - this.x : this.x - lo) < this.w * 0.5 + hp + (kind === 'roll' ? 80 : 0)) s = -s;   // the side with room
        this.setState('toy');
        this.toy = { k: kind, g, s, px: clamp(this.x + s * (this.w * 0.42 + hp * 0.32), lo, hi), lift: 0, vx: 0, vy: 0, rot: 0, sc: 0, st: 1,
            ph: 0, n: 0, max: kind === 'roll' ? (this.plat ? 2 : Math.random() < 0.5 ? 2 : 3) : 2, f: 0, wait: 0, dur: rand(3, 5) };
        if (kind === 'recv') {
            const T = this.toy;
            T.sc = 0;                                            // 0.10.1: inside a ribbon box until it's opened
            T.box = { o: -1, sh: 0 };
            T.lift = Math.max(this.h * 2, this.foot() - stage.chatTop);   // drops in from the top of the chat
            // 0.10.2: every other present still waiting comes down in a box of its own, beside the first one
            const bs = Math.max(16, this.h * 0.5), step = bs * 1.1, blo = stage.left + bs / 2, bhi = stage.right - bs / 2;
            const near = clamp(this.x - s * (this.w * 0.42 + bs * 0.6), blo, bhi);
            const others = (this.rec.gifts || []).filter(x => x !== g && x?.fresh && typeof x.src === 'string').slice(0, GIFT_MAX - 1);
            T.extra = others.map((x, i) => {
                const j = Math.floor(i / 2), far = i % 2 === 0;     // the other side first, then further out on both
                return { g: x, px: clamp(far ? near - s * step * j : T.px + s * step * (j + 1), blo, bhi) };
            });
            T.kind = kindOf(this, 'me');
        }
        return true;
    }

    /** Got it (landed in front of it): no longer waiting to be given. */
    gotGift(g) {
        delete g.fresh;
        addMoment(this.rec, 'firstGift');
        saveSoon();
        refreshBed();
        renderPanel();
    }

    /** One frame of walking toward tx outside the walk state. True once it's there. */
    stepToward(tx, dt) {
        const dx = tx - this.x, sp = this.p.speed * paceOf(this.rec);
        if (Math.abs(dx) <= sp * dt + 1) return true;
        this.dir = Math.sign(dx);
        this.x += Math.sign(dx) * sp * dt;
        this.stepWalk(sp * dt);
        return false;
    }

    /** The present beside it (playing with it, or tucked up next to it while dozing). */
    drawProp() {
        const T = this.state === 'toy' ? this.toy : this.state === 'doze' ? this.hug : null;
        if (T && T === this.hug) T.sc = Math.min(1, T.sc + 0.06);
        this.drawBox(T);
        const on = T && !this.held && !this.air && !this.gone && !document.hidden && T.sc > 0.02;
        if (!on) { if (this.propEl) this.propEl.hidden = true; return; }
        let el = this.propEl;
        if (!el) { el = this.propEl = document.createElement('img'); el.className = 'tavvy-prop'; el.alt = ''; el.draggable = false; ensureLayer().appendChild(el); }
        const src = imgUrl(T.g.src);
        if (el.dataset.src !== src) { el.src = src; el.dataset.src = src; }
        const hp = this.h * giftK(T.g);
        el.style.height = hp.toFixed(1) + 'px';
        el.style.maxWidth = (hp * 1.6).toFixed(1) + 'px';
        el.hidden = false;
        const x = T.px - stage.ox, y = this.foot() - T.lift - stage.oy;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) rotate(${(T.rot || 0).toFixed(1)}deg) scale(${T.sc.toFixed(3)})`;
    }

    /** 0.10.1: the ribbon box a new present comes in (drawn with CSS — no picture needed).
     *  0.10.2: one box per present not yet received, all opened together; the extra presents pop out and twinkle away. */
    drawBox(T) {
        const B = T?.box;
        const on = !!B && B.o < 0.8 && !this.held && !this.air && !this.gone && !document.hidden;
        const list = on ? [{ px: T.px }, ...(T.extra || [])] : [];
        const els = (this.boxEls ||= []), gels = (this.xgEls ||= []);
        while (els.length < list.length) {
            const el = document.createElement('div');
            el.className = 'tavvy-giftbox';
            el.innerHTML = '<div class="tgb-lid"></div><div class="tgb-body"></div>';
            ensureLayer().appendChild(el);
            els.push(el);
        }
        const s = Math.max(16, this.h * 0.5), o = on ? Math.max(0, B.o) : 0;
        els.forEach((el, i) => {
            if (i >= list.length) { el.hidden = true; return; }
            el.hidden = false;
            el.style.width = s.toFixed(1) + 'px';
            el.style.height = (s * 0.86).toFixed(1) + 'px';
            const sh = B.sh > 0 ? Math.sin(B.sh * 60 + i * 1.7) * 7 * (B.sh / 0.25) : 0;   // they all wobble when patted
            const x = list[i].px - stage.ox, y = this.foot() - (B.o < 0 ? T.lift : 0) - stage.oy;
            el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) rotate(${((B.o < 0 ? T.rot * (i % 2 ? -1 : 1) : 0) + sh).toFixed(1)}deg)`;
            el.style.opacity = String(clamp(1 - (o - 0.3) / 0.5, 0, 1));
            const ls = i % 2 ? -T.s : T.s;
            el.firstChild.style.transform = o ? `translate(${(ls * o * s * 0.5).toFixed(1)}px, ${(-o * s * 1.1).toFixed(1)}px) rotate(${(ls * o * 70).toFixed(1)}deg)` : '';
        });
        const xs = on && B.o >= 0 ? T.extra || [] : [];
        while (gels.length < xs.length) {
            const el = document.createElement('img');
            el.className = 'tavvy-prop'; el.alt = ''; el.draggable = false;
            ensureLayer().appendChild(el);
            gels.push(el);
        }
        gels.forEach((el, i) => {
            const X = xs[i];
            if (!X) { el.hidden = true; return; }
            const src = imgUrl(X.g.src);
            if (el.dataset.src !== src) { el.src = src; el.dataset.src = src; }
            const hp = this.h * giftK(X.g), u2 = Math.min(1, o / 0.45);
            el.style.height = hp.toFixed(1) + 'px';
            el.style.maxWidth = (hp * 1.6).toFixed(1) + 'px';
            el.hidden = false;
            const lift = Math.sin(u2 * Math.PI) * this.h * 0.35 + Math.max(0, o - 0.35) * this.h * 1.4;
            el.style.opacity = String(clamp(1 - (o - 0.35) / 0.4, 0, 1));
            el.style.transform = `translate3d(${(X.px - stage.ox).toFixed(1)}px, ${(this.foot() - lift - stage.oy).toFixed(1)}px, 0) translate(-50%, -100%) scale(${u2.toFixed(3)})`;
        });
    }

    /** Moved dx px without the walk state: count steps so the 걷기 pictures take turns (0.9.3). */
    stepWalk(dx) {
        const before = Math.floor(this.walkPh || 0);
        this.walkPh = (this.walkPh || 0) + Math.abs(dx) / 22;
        if (Math.floor(this.walkPh) !== before) this.frame++;
    }

    /** 글 읽는 척 on the message it stands on. */
    startRead() {
        if (!this.plat) return false;
        const [L, R] = this.range();
        if (R - L < 30) return false;
        this.setState('read');
        return true;
    }

    /** Walked somewhere for a reason (this.go) — and got there. */
    arrive(go) {
        if (go.k === 'hide') { this.setState('hide'); this.hd = { s: go.s, E: go.E, x0: this.x, wait: 0.6 + rand(1.2, 2.4), f: 0 }; return; }
        if (go.k === 'where') return this.setState('where');
        if (go.k === 'stare') return this.setState('stare');
        if (go.k === 'napwith') {                                    // 0.10.12 같이 졸기: next to it — nods off too
            const b = go.who;
            if (duetAlive(b) && b.state === 'doze' && b.plat === this.plat && !this.waiting) {
                if (this.side && Math.abs(b.x - this.x) > 4) this.dir = b.x >= this.x ? 1 : -1;
                return this.setState('doze');
            }
            return this.setState('idle');
        }
        if (go.k === 'tag') return this.tagTap(go.who);              // 0.10.12 쫓아가기 장난
        if (go.k === 'tagchase') {
            this.setState('idle');
            const b = go.who;
            if (duetAlive(b) && b.plat === this.plat && Math.abs(b.x - this.x) <= (this.w + b.w) * 1.5) {
                if (this.side && Math.abs(b.x - this.x) > 4) this.dir = b.x >= this.x ? 1 : -1;
                fx(this, TAG_END[kindOf(this, '')] ?? '♪', 'tavvy-fx-small');
            }
            return;
        }
        if (go.k === 'race') { this.setState('idle'); raceLand(this, go.el); return this.watchReply(go.el); }   // 0.10.12 먼저 달려가기: there — up if it can
        if (go.k === 'share') return this.shareBite(go.who);         // 0.10.12 나눠 먹기
        if (go.k === 'visit') {                                      // 0.10.9 말 걸러 가기: there — say something if still close
            this.setState('idle');
            const b = go.who;
            if (duetAlive(b) && b.plat === this.plat && Math.abs(b.x - this.x) <= (this.w + b.w) * 1.6) startDuet(this, b, 'visit');
            return;
        }
        this.setState('idle');
    }

    /** …어디 갔었어?: you were away a while — over to the middle, a long look at you. */
    startWhere() {
        if (this.state === 'doze') { fx(this, '!', 'tavvy-fx-small'); this.sq = 0.9; }
        const [L, R] = this.range();
        const tx = clamp((stage.left + stage.right) / 2 + rand(-30, 30), L, Math.max(L, R));
        if (Math.abs(tx - this.x) <= 20) return this.arrive({ k: 'where' });
        this.walkTo(tx);
        this.go = { k: 'where' };
    }

    /** 0.10.9 말 걸러 가기: walk over to another pet on the same floor / ledge that it has something to say to. */
    startVisit() {
        if (duetOn) return false;
        const now = performance.now();
        const ok = (b) => b !== this && duetAlive(b) && !b.air && b.plat === this.plat && VISIT_TO.includes(b.state)
            && now - (metAt.get(duetKey(this.rec.id, b.rec.id)) ?? -1e9) >= MEET_REST * 1000 && duetCan(this, b);
        const others = actors.filter(ok);
        if (!others.length) {                                        // on another floor / ledge: get over there first
            const far = actors.filter(b => b !== this && duetAlive(b) && !b.air && b.plat !== this.plat && VISIT_TO.includes(b.state)
                && now - (metAt.get(duetKey(this.rec.id, b.rec.id)) ?? -1e9) >= MEET_REST * 1000 && duetCan(this, b));
            if (!far.length || !this.free()) return false;
            if (this.plat && far.some(b => !b.plat)) { this.hopOff(); return 'near'; }      // it is down on the floor: hop off
            const up = far.map(b => b.plat && plats.find(q => q.el === b.plat)).find(q => q && this.reachable().includes(q));
            if (up && this.climbTo(up, 'idle')) return 'near';                              // up on a message it can reach
            return false;
        }
        const b = others[Math.floor(Math.random() * others.length)];
        const [L, R] = this.range();
        const side = this.x <= b.x ? -1 : 1;                         // stop on this side of it
        const tx = clamp(b.x + side * (this.w + b.w) * 0.6, L, Math.max(L, R));
        b.chatTill = Math.max(b.chatTill || 0, now + VISIT_WAIT * 1000);   // it stays put a moment
        if (Math.abs(tx - this.x) <= 12) { this.arrive({ k: 'visit', who: b }); return 'go'; }
        this.walkTo(tx);
        this.go = { k: 'visit', who: b };
        return 'go';
    }

    /* ---------- 0.10.12 멍 (로딩 중): a little wheel over its head (the body stays as it is) ---------- */
    drawZone() {
        if (!this.zoneEl) {
            this.zoneEl = document.createElement('div');
            this.zoneEl.className = 'tavvy-zone';
            this.zoneEl.innerHTML = '<i></i>'.repeat(8);
            layer.appendChild(this.zoneEl);
        }
        this.zoneEl.style.left = (this.x - stage.ox) + 'px';
        this.zoneEl.style.top = (stage.floorY - this.y - this.h * this.scale - 4 - stage.oy) + 'px';
    }

    unzone() {
        this.zoneT = 0;
        this.zoneEl?.remove();
        this.zoneEl = null;
    }

    /** 0.10.12 같이 졸기: walk over next to a pet that is dozing. */
    startNapWith(a) {
        if (!duetAlive(this) || !duetAlive(a) || a.state !== 'doze' || this.plat !== a.plat || this.air || this.wallOn || this.waiting
            || !this.free() || !NIGHT_FROM.includes(this.state) || this.food > 0 || this.mealPending) return;
        const [L, R] = this.range();
        const side = this.x <= a.x ? -1 : 1;
        const tx = clamp(a.x + side * (this.w + a.w) * 0.42, L, Math.max(L, R));
        this.passing.add(a); a.passing.add(this);                   // no bumping into the sleeper
        if (Math.abs(tx - this.x) <= 10) return this.arrive({ k: 'napwith', who: a });
        this.walkTo(tx);
        this.go = { k: 'napwith', who: a };
    }

    /** 0.10.12 쫓아가기 장난: over to another pet on the floor, a tap, then off it runs. */
    startTag() {
        const now = performance.now();
        const ok = (b) => b !== this && duetAlive(b) && !b.air && !b.wallOn && !b.plat && ['idle', 'fidget', 'look'].includes(b.state) && !b.waiting
            && fr(b, 'tag') > 0 && Math.abs(b.x - this.x) < TAG_NEAR && pairOk('tag', this, b, TAG_REST);
        const list = actors.filter(ok);
        if (!list.length) return false;
        const b = list[Math.floor(Math.random() * list.length)];
        pairMark('tag', this, b);
        const [L, R] = this.range();
        const side = this.x <= b.x ? -1 : 1;
        const tx = clamp(b.x + side * (this.w + b.w) * 0.5, L, Math.max(L, R));
        b.chatTill = Math.max(b.chatTill || 0, now + 6000);            // it stays put a moment
        this.passing.add(b); b.passing.add(this);
        if (Math.abs(tx - this.x) <= 10) { this.arrive({ k: 'tag', who: b }); return true; }
        this.walkTo(tx);
        this.go = { k: 'tag', who: b };
        return true;
    }

    tagTap(b) {
        this.setState('idle');
        if (!duetAlive(b) || b.plat !== this.plat || b.air || Math.abs(b.x - this.x) > (this.w + b.w) * 1.2) { if (b) b.chatTill = 0; return; }
        if (this.side && Math.abs(b.x - this.x) > 4) this.dir = b.x >= this.x ? 1 : -1;
        b.chatTill = 0;
        b.sq = 0.85; this.sq = 0.9;                                 // 톡
        fx(b, '!', 'tavvy-fx-small');
        const [L, R] = this.range();
        let away = this.x <= b.x ? -1 : 1;
        let tx = clamp(this.x + away * rand(150, 260), L, Math.max(L, R));
        if (Math.abs(tx - this.x) < 80) return;                      // a wall right behind: just the tap
        this.walkTo(tx);
        this.gait = 'run';
        this.go = { k: 'tagrun' };
        const run = this;
        if (Math.random() < (TAG_CHASE[kindOf(b, '')] ?? 0.5)) setTimeout(() => b.chaseTag(run), 500);
        else setTimeout(() => { if (duetAlive(b) && b.state === 'idle') duetReact(b, run); }, 400);
    }

    chaseTag(a) {
        if (!duetAlive(this) || !duetAlive(a) || this.air || this.plat !== a.plat || !['idle', 'fidget', 'look'].includes(this.state)) return;
        const [L, R] = this.range();
        const to = clamp(a.state === 'walk' ? a.tx : a.x, L, Math.max(L, R));   // where it is running to
        const side = this.x <= to ? -1 : 1;
        const tx = clamp(to + side * (this.w + a.w) * 0.55, L, Math.max(L, R));
        if (Math.abs(tx - this.x) <= 10) return;
        this.walkTo(tx);
        if (kindOf(this, '') !== 'neugut') this.gait = 'run';       // 느긋: walks after it
        this.go = { k: 'tagchase', who: a };
    }

    /** 0.10.12 나눠 먹기: another one is eating close by → over for a bite (a show only: nobody's record changes). */
    startShare() {
        const ok = (b) => b !== this && duetAlive(b) && b.state === 'eat' && !b.air && b.plat === this.plat
            && Math.abs(b.x - this.x) < SHARE_NEAR && pairOk('share', this, b, SHARE_REST);
        const b = actors.find(ok);
        if (!b || this.air || this.wallOn || Math.random() >= chance(this, 'share', SHARE_P)) return false;
        pairMark('share', this, b);
        const [L, R] = this.range();
        const side = this.x <= b.x ? -1 : 1;
        const tx = clamp(b.x + side * (this.w + b.w) * 0.5, L, Math.max(L, R));
        this.passing.add(b); b.passing.add(this);
        if (Math.abs(tx - this.x) <= 10) { this.arrive({ k: 'share', who: b }); return true; }
        this.walkTo(tx);
        this.go = { k: 'share', who: b };
        return true;
    }

    shareBite(b) {
        if (!duetAlive(b) || b.state !== 'eat' || b.plat !== this.plat) return this.setState('idle');
        if (this.side && Math.abs(b.x - this.x) > 4) this.dir = b.x >= this.x ? 1 : -1;
        const k = kindOf(b, '');
        if (k === 'simsul') {                                        // 심술: turns its back on it
            if (b.side) b.dir = this.x >= b.x ? -1 : 1;
            fx(b, '💢', 'tavvy-fx-small');
            this.after = 'idle';
            return this.startLook('?', b.x);
        }
        fx(b, SHARE_MINE[k] ?? '♥', 'tavvy-fx-small');
        this.fk = 'nibble';
        this.setState('fidget');
    }

    /** 글 쓰면 빤히: over to the input box to watch you write. */
    startStare() {
        if (this.plat) return this.arrive({ k: 'stare' });       // up on a message: watches from there
        const [L, R] = this.range();
        const tx = clamp(inputX() + rand(-40, 40), L, Math.max(L, R));
        if (Math.abs(tx - this.x) <= 20) return this.arrive({ k: 'stare' });
        this.walkTo(tx);
        this.go = { k: 'stare' };
    }

    /** Stop and react to you (the person in front of the screen). */
    startMe() {
        const mid = (stage.left + stage.right) / 2;
        if (this.side && Math.abs(mid - this.x) > 8) this.dir = mid >= this.x ? 1 : -1;
        this.lastMe = performance.now();
        const bigOk = performance.now() - (bigAt.get(this.rec.id) ?? -Infinity) > BIG_REST * 1000;
        if (bigOk && can(this, 'gift') && Math.random() < chance(this, 'gift', GIFT_CHANCE)) { bigAt.set(this.rec.id, performance.now()); return this.startGift(); }     // 내편 애교: a little present
        this.meHeart = Math.random() < 0.55;
        this.setState('me');
    }

    endMe() {
        const k = kindOf(this, 'me');
        if (k === 'neugut') return this.setState('doze');                     // ♪ … and nods off
        if (k === 'musim' && !can(this, 'soft') && this.stepAside((stage.left + stage.right) / 2)) return;   // "…" and backs off a few steps
        this.setState('idle');
    }

    /* ---------- 내편: a gift ---------- */

    startGift() {
        this.setState('gift');
        this.big = { kind: 'gift', shown: false, item: GIFTS[Math.floor(Math.random() * GIFTS.length)] };
    }

    /** Leaving the gift: back to normal size. */
    endBig() {
        this.big = null;
        if (this.scale > 1) this.scale = 1;
    }

    /* ---------- 관심: the input box, your hand, a pat ---------- */

    /** You started writing (or are still at it): a peek at the input box. */
    startPeekIn() {
        const k = kindOf(this, 'me');
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
        if (kindOf(this, 'me') === 'musim' && this.followedOnce) return false;          // 무심: only the first time
        this.followNext = now + 3000;
        return Math.random() < chance(this, 'follow', FOLLOW_CHANCE);
    }

    startFollow() {
        const k = kindOf(this, 'me');
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
        this.aside = true;                              // walking off with its back to it (등 돌리기 picture)
        return true;
    }

    /** Woken up: look around, spot you "!", greet you by personality — then the food. */
    startGreet() {
        const plan = this.reunion || {};
        this.reunion = null;
        const k = kindOf(this, 'wake');
        const q = [];
        const greets = k !== 'musim' && !plan.skip;             // 무심 never greets; lots of food soon after → straight to it
        if (greets) q.push({ k: 'scan', d: 0.7 });
        if (greets || plan.teary) q.push({ k: 'found', d: 0.4 });
        // a special day: first of all coloured ✦, a dance, and what it wants to say
        const sp = this.special; this.special = null;
        if (sp?.length) q.unshift({ k: 'party', d: 1.9, days: sp }, ...sp.map(x => ({ k: 'line', d: 2.9, text: x.text })));
        else if (!(plan.away >= REVISIT_DAYS * 86400e3 && this.talk('reunion'))) this.talk(backSoon(this.rec) ? 'back' : 'wake');   // 0.11.17 돌아오기
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
            this.held = true; this.air = false; this.next = null; this.patJump = false;
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
            if (down && down.id === e.pointerId) return;
            if (this.held) { this.dropPointer(); return; }      // held and touched again = stuck (or a 2nd finger) → let go
            if (down) { clearTimeout(timer); down = null; }    // an old touch that never ended → forget it, start fresh
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
        /** Forget the finger and put the pet down (stuck, or the app went to the background). */
        this.dropPointer = () => {
            clearTimeout(timer);
            if (down) { try { this.el.releasePointerCapture(down.id); } catch { /* ignore */ } }
            down = null;
            if (this.held) this.release();
        };
    }

    /** Tap = a pat: a little hop and a reaction. Counts once a day toward closeness. */
    tap(px) {
        if (['tuck', 'wave', 'resist', 'gift'].includes(this.state) || this.held) return;
        const now = performance.now();
        this.taps = this.taps.filter(t => now - t < RAPID_WINDOW * 1000);
        this.taps.push(now);
        const k = kindOf(this, 'pat'), pp = PERSONALITIES[k];
        const close = closenessOf(this.rec) >= CLOSE;
        const soft = can(this, 'soft');
        const rapid = pp.fussy && this.taps.length >= RAPID_TAPS;
        if (!this.air) { this.air = true; this.vy = 300; this.vx = 0; this.next = 'idle'; this.patJump = true; }
        if (rapid) return fx(this, '💢');   // 연타 싫어! (closeness is not lost)
        patPet(this.rec);
        this.talk('pat');
        fx(this, k === 'simsul' && soft ? '♥' : pp.tap);                                // 내편 심술: no 💢, just ♥
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
        this.climbJump = false;
        this.patJump = false;
        this.leftPlat = null;
        this.vy = 0; this.vx = 0;
        this.body.style.transformOrigin = '';
        const soft = (this.rec.look.squish ?? 0.5) * 2;
        if (soft > 0) this.sq = 1 - Math.min(0.22, impact / 4200);
        // a big landing bounces once, lightly
        if (impact > 500) { this.air = true; this.plat = null; this.vy = impact * 0.18; return; }
        if (this.plat) this.pr = liveRect(this.plat);
        const n = this.next || 'idle';
        this.next = null;
        if (n === 'greet') return this.startGreet();
        if (this.landReact) {
            this.landReact = false;
            this.after = n;
            return this.startLook(persOf(this, 'land').land, this.x + this.dir * 40);
        }
        if (this.bumpReact) {
            this.bumpReact = false;
            const o = this.bumpWith; this.bumpWith = null;
            const ox = o && !o.gone ? o.x : this.x + this.dir * 40;
            if (persOf(this, 'land').bump === 'aside') {                // 무심: "…" and steps out of the way
                fx(this, '…');
                if (this.stepAside(ox)) return;
                return this.setState(n);
            }
            this.after = n;
            return this.startLook(persOf(this, 'land').bump, ox);
        }
        this.setState(n);
    }

    setState(s) {
        if (this.big && s !== this.state) this.endBig();
        if (this.wallOn && s !== 'stroll' && s !== 'fly' && s !== 'portal') this.endWall();
        this.state = s; this.t = 0;
        this.aside = false; this.cheering = false;
        if (this.zoneT > 0 || this.zoneEl) this.unzone();            // 0.10.12 멍: only while it lasts
        if (s !== 'walk') { this.gait = null; this.go = null; }      // 0.9.0: how / why it's walking
        if (s !== 'read') this.rd = null;
        if (s !== 'toy') this.toy = null;                            // 0.10.0 선물
        this.hug = null;
        if (s === 'doze' && !this.plat && Math.random() < chance(this, 'pr_hug', PRESENT_P.pr_hug)) {   // 끼고 자기
            const l = this.giftList(), g = l.find(x => x.fav) || l[Math.floor(Math.random() * l.length)];   // 0.10.13: 좋아하는 선물 먼저
            if (g) {
                const hp = this.h * giftK(g), sd = this.side ? this.dir : (Math.random() < 0.5 ? -1 : 1);
                this.hug = { g, px: clamp(this.x + sd * (this.w * 0.42 + hp * 0.32), stage.left + hp / 2, stage.right - hp / 2), lift: 0, rot: 0, sc: 0 };
            }
        }
        this.sqT = 1;
        if (s === 'idle') { this.until = rand(...this.p.idle) * IDLE_SLOW; this.tiltT = 0; }
        if (s === 'doze') { this.until = rand(...this.p.dozeLen) * (this.isFull() ? FULL_DOZE_LEN : 1); this.fxT = 0.6; }
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
        if (s === 'wait') { this.fxT = rand(0.4, 1.2); this.scanT = 0.6; this.wvT = rand(2, 3.5); this.wsw = 0; }
        if (s === 'fidget') { this.fxT = 0; this.tiltT = 0; this.fq = Math.random() < 0.35; this.until = { scan: rand(1.6, 2.4), sway: 2.6, sit: rand(3, 6), tummy: 1.8, nibble: 1.6 }[this.fk] || 1.6; }
        if (s === 'fidget' && this.fk === 'zone') { this.until = rand(...(ZONE_LEN[kindOf(this, '')] || [2, 3])); this.zoneT = this.until; }   // 0.10.12 멍
        if (s === 'doze' && actors.length > 1) setTimeout(() => nightCheck(this), 900);                                                     // 0.10.12 잘 자 · 같이 졸기
        if (s === 'skid') { this.until = 0.45; }
        if (s === 'where') { this.fxT = 0; this.until = 3.4; }
        if (s === 'stare') { this.fxT = 0; }
        if (s === 'watch') { this.fxT = 0; this.until = 2.8; }
        if (s === 'fly') {                          // 날기 · 휙휙
            this.wallOn = true;
            this.plat = null; this.pr = null;
            this.body.style.transformOrigin = '50% 50%';
            this.tiltT = 0; this.fvx = 0; this.fvy = 0; this.gT = 0;
            this.until = rand(...STROLL_TIME); this.fgoal = null;
            this.hold = this.fmode === 'dash' ? 0.2 : 0;
            this.flyPick(true);
        }
        if (s === 'portal') {                       // 0.11.3 차원문
            this.wallOn = true;
            this.plat = null; this.pr = null;
            this.body.style.transformOrigin = '50% 65%';
            this.tiltT = 0; this.walkPh = 0;
        }
        if (s === 'stroll') {                       // 화면 산책
            this.wallOn = true;
            this.plat = null; this.pr = null;
            this.body.style.transformOrigin = '50% 50%';
            this.tiltT = 0; this.wph = 0;
            this.until = rand(...STROLL_TIME); this.sgoal = null;
            this.strollPick(this.y < this.h);           // from the floor: straight up first
        }
        if (s === 'me') {
            this.fxT = 0;
            const close = closenessOf(this.rec) >= CLOSE;
            this.until = can(this, 'soft')
                ? { saechim: 1.2, neugut: 1.5, simsul: 1.1, musim: 1.1 }[kindOf(this, 'me')] || 1.0
                : { aegyo: 1.0, saechim: close ? 1.9 : 1.1, neugut: 1.4, simsul: close ? 1.5 : 1.0, musim: 0.8 }[kindOf(this, 'me')] || 1.2;
            this.until += ME_LOOK + ME_HOLD;   // 0.11.7
        }
        const k = kindOf(this, 'me');
        if (s === 'peekin') { this.fxT = 0; this.until = { aegyo: 1.5, neugut: 1.8, simsul: 1.7 }[k] || 1.4; }
        if (s === 'follow') { this.fxT = 0; this.fstepped = false; this.until = { saechim: 1.3, simsul: 1.6, musim: 0.9 }[k] || 3; }
        if (s === 'resist') { this.fxT = 0; this.until = 1.0; this.tiltT = 0; }
        if (s === 'sleepy') { this.fxT = 0.8; }
        if (s === 'gift') { this.fxT = 0; this.tiltT = 0; }
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
        if (this.chatTill && performance.now() < this.chatTill) return this.setState('idle');   // 0.10.8: talking with another pet
        if (this.wantTalk && !gen.active && fr(this, 'visit') > 0) {                // 0.10.9 말 걸러 가기: still wants to — before anything else
            const v = this.startVisit();
            if (v) { this.wantTalk = v === 'near'; return; }
        }
        if (this.afterMeal) { const el = this.afterMeal; this.afterMeal = null; if (el.isConnected && !this.waiting) { this.watchReply(el); if (this.state !== 'idle') return; } }
        if (gen.active && this.waiting) return this.setState('wait');
        const fresh = (this.rec.gifts || []).find(g => g?.fresh && typeof g.src === 'string');
        if (fresh && !win?.open && !this.wallOn) return void this.startToy('recv', fresh);   // 0.10.0: a present for it
        const full = this.isFull();
        const r = Math.random();
        const dz = chance(this, 'doze', this.p.doze + (full ? FULL_DOZE : 0));
        if (r < dz) return this.setState('doze');
        // stop and react to you now and then (friendlier = more often)
        if (performance.now() - this.lastMe > ME_REST * 1000 && Math.random() < chance(this, 'me', byCloseness(this, ...this.p.me) * ME_SCALE)) return this.startMe();
        if (full && !this.plat && Math.random() < chance(this, 'roll', 0.12)) return this.setState('roll');   // 데굴데굴
        if (full && Math.random() < FULL_TUMMY) { this.fk = 'tummy'; return this.setState('fidget'); }   // 배 통통 ♪
        // 0.9.0: everyday things of their own
        if (!this.plat && !this.isFull() && Math.random() < chance(this, 'roll', NEW_ACTS.roll)) return this.setState('roll');   // 데굴데굴 (0.9.1: was in 제자리 놀기)
        if (Math.random() < chance(this, 'hum', NEW_ACTS.hum)) { this.fk = 'sway'; return this.setState('fidget'); }      // 흥얼거리기 ♪
        if (Math.random() < chance(this, 'scan', NEW_ACTS.scan)) { this.fk = 'scan'; return this.setState('fidget'); }    // 두리번
        if (Math.random() < chance(this, 'zone', (ZONE_P[kindOf(this, '')] || 0.02) * (gen.active ? ZONE_GEN : 1))) { this.fk = 'zone'; return this.setState('fidget'); }   // 0.10.12 멍
        if (this.rec.look.roles?.sit?.length && Math.random() < chance(this, 'sit', NEW_ACTS.sit)) { this.fk = 'sit'; return this.setState('fidget'); }
        if (!this.plat && !gen.active && Math.random() < chance(this, 'peek', NEW_ACTS.peek) && this.startPeek()) return;  // 빼꼼
        if (!gen.active && this.giftList().length) {                  // 0.10.0 선물: takes one out now and then
            for (const [k, key] of [['look', 'pr_look'], ['show', 'pr_show'], ['give', 'pr_give'], ['roll', 'pr_roll'], ['toss', 'pr_toss']]) {
                if (k === 'toss' && this.plat) continue;
                if (Math.random() < chance(this, key, PRESENT_P[key])) {
                    const g = this.pickGift();
                    if (k === 'roll' && this.plat && !this.ledgeRollOk(g)) continue;   // 0.10.13: 좁은 말풍선 위에선 안 굴려요
                    return void this.startToy(k, g);
                }
            }
        }
        if (!gen.active && !this.wantTalk && Math.random() < chance(this, 'visit', VISIT_P)) {                             // 0.10.9 말 걸러 가기
            const v = this.startVisit();
            if (v) { this.wantTalk = v === 'near'; return; }          // 'near' = on its way to the other one's floor / ledge first
            if (actors.length > 1) this.wantTalk = true;              // nobody to go to now (asleep…) → it tries first thing next time
        }
        if (!gen.active && actors.length > 1 && this.startShare()) return;                                               // 0.10.12 나눠 먹기
        if (!gen.active && actors.length > 1 && !this.plat && Math.random() < chance(this, 'tag', TAG_P[kindOf(this, '')] ?? 0.01) && this.startTag()) return;   // 0.10.12 쫓아가기 장난
        if (this.plat && Math.random() < chance(this, 'read', READ_ON) && this.startRead()) return;                        // 글 읽는 척
        if (!this.plat && ledgesOn() && Math.random() < chance(this, 'read', READ_CLIMB)) {
            const t = this.pickClimb();
            if (t && this.climbTo(t, 'read')) return;
        }
        if (!this.plat && !this.waiting && root?.settings?.stroll !== false && stageIsChat()) {
            const m = this.pickMove();
            if (m) return this.startWall(m);
        }
        // hop up onto a message by itself
        if (ledgesOn() && Math.random() < chance(this, 'climb', byCloseness(this, ...this.p.climb))) {
            const t = this.pickClimb();
            if (t && this.climbTo(t, 'perch')) return;
        }
        // while a reply is being written, sometimes glance at the chat (more often when curious)
        if (gen.active && Math.random() < (this.fidgety() ? 0.45 : 0.3)) return this.startLook('peek', (stage.left + stage.right) / 2);
        if (!gen.active) this.talk('play');                         // playing alone: a line now and then
        if (r < dz + 0.62) {
            const [L, R] = this.range();
            if (this.plat && Math.random() < EDGE_CHANCE) {
                const [l2, r2] = this.range(0.2);
                return this.walkTo(Math.random() < 0.5 ? l2 : r2, true);
            }
            if (R - L < 10) return this.setState('idle');
            let tx = rand(L, R);
            if (Math.abs(tx - this.x) < 30) tx = clamp(this.x + (Math.random() < 0.5 ? -1 : 1) * rand(40, 140), L, R);
            const gait = Math.random() < chance(this, 'run', RUN_WALK) ? 'run' : null;
            if (gait === 'run' && Math.abs(tx - this.x) < 120 && R - L > 160) tx = this.x - L > R - this.x ? rand(L, L + 40) : rand(R - 40, R);   // a run needs a little room
            if (Math.abs(tx - this.x) < 6) return this.setState('idle');
            this.walkTo(tx);
            this.gait = gait;
            return;
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
        if (can(this, 'myBubble') && Math.random() < chance(this, 'myBubble', MY_BUBBLE)) {
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
        this.climbJump = true;
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
        if (!r || (!this.plat.closest('#chat') && !platOf(this.plat))) { this.dropOff(); return false; }   // 0.11.17: a window hidden / closed / now covering the chat
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
        else if (kind !== 'glance' && kind !== 'flick' && kind !== 'hmph' && kind !== 'yawn') fx(this, kind);   // hmph·yawn: just the gesture, no text
    }

    /* ---------- waiting for a reply / watching it ---------- */

    startWait() {
        this.waiting = true;
        this.tried = new WeakSet();
        this.talk('wait');
        if (this.free() && this.state !== 'doze') this.setState('wait');   // a napping pet keeps napping (waits after)
    }

    endWait() {
        if (!this.waiting) return;
        this.waiting = false;
        if (!this.free() && this.state !== 'wait') return;
        if (this.plat && this.plat === gen.target) return this.setState('watch');
        if (this.state === 'wait') this.startLook('up', this.x);
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
        if (!this.free() || this.waiting || this.state === 'doze') return;
        if (this.plat === el) return this.setState('watch');
        const p = platOf(el);
        const rc = race && race.el === el && race.who.has(this) && performance.now() < race.till ? race : null;
        if (rc && p && !this.plat && !this.wallOn && !rc.ran.has(this)) {     // 0.10.12 먼저 달려가기: under the middle of it first
            rc.ran.add(this);
            const [L, R] = this.range();
            const tx = clamp((p.left + p.right) / 2 + rand(-this.w, this.w), L, Math.max(L, R));
            if (Math.abs(tx - this.x) > 30) {
                this.walkTo(tx);
                if (kindOf(this, '') !== 'neugut') this.gait = 'run';   // 느긋: walks
                this.go = { k: 'race', el };
                return;
            }
            raceLand(this, el);                                     // already right under it
        }
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
        const resist = can(this, 'resist') && !this.held && !this.air && this.state !== 'off' && Math.random() < chance(this, 'resist', RESIST_CHANCE);
        if (this.held) { this.held = false; this.el.classList.remove('tavvy-held'); this.body.style.transformOrigin = ''; }
        this.onGone = done;
        this.waiting = false;
        if (this.state === 'off') { this.vanish(); bumpBed(); return; }
        this.talk('sleep');
        this.plat = null;      // waves where it is, then goes into the bed (doesn't ride a ledge away)
        this.air = false;
        this.setState(resist ? 'resist' : 'wave');
        this.tiltT = 0;
    }

    vanish() {
        if (this.gone) return;
        this.gone = true;
        this.el.remove();
        this.propEl?.remove();
        this.unzone();
        if (this.pt) { shutDoor(this.pt.a); shutDoor(this.pt.b); this.pt = null; }
        this.pcut = null;
        for (const el of [...(this.boxEls || []), ...(this.xgEls || [])]) el.remove();
        this.boxEls = this.xgEls = null;
        if (this.sayEl) { const el = this.sayEl; this.sayEl = null; clearTimeout(this.sayTimer); setTimeout(() => el.remove(), 1400); }   // "잘 자…" stays a moment
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

        if (this.state !== 'tuck' && this.state !== 'portal' && this.scale < 1) this.scale = Math.min(1, this.scale + dt * 4);
        if (this.eatT > 0) this.eatT -= dt;
        if (this.zoneT > 0) { this.zoneT -= dt; this.drawZone(); } else if (this.zoneEl) this.unzone();   // 0.10.12 멍

        if (this.wallOn && (this.held || this.air)) this.endWall();   // picked up / tapped off the wall or screen
        if (this.held) {
            const left = this.ptr.x - this.grab.x;
            const top = this.ptr.y - this.grab.y;
            this.x = left + this.w / 2;
            this.y = stage.floorY - top - this.h;
            this.ptr.vx *= Math.pow(0.08, dt);                      // pointer stopped → swing settles
            this.tiltT = clamp(-this.ptr.vx * 0.07, -HOLD_SWING_MAX, HOLD_SWING_MAX);
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
            pose = this.state === 'fall' ? this.rp('fall') : this.state === 'appear' ? this.rp('appear') : this.climbJump ? this.rp('climb') : this.patJump ? this.rp('pat') : this.rp('jump');
        } else if (!this.trackPlat()) {
            // its ledge went away this frame (falling or gone off the top)
            if (this.state === 'off') return;
        } else {
            switch (this.state) {
                case 'idle':
                case 'appear':
                    breath = 1;
                    if (this.state === 'idle' && this.isFull()) pose = this.rp('full');
                    if (this.state === 'idle' && (this.food > 0 || this.mealPending)) { this.decide(); break; }   // food coming → stop and eat
                    if (this.state === 'idle' && this.t > 0.3 && this.wantsFollow()) { this.startFollow(); break; }   // 관심: your hand
                    if (this.t > this.until) this.decide();
                    break;
                case 'peekin': {                       // 관심: you are writing — a peek at the input box
                    const k = kindOf(this, 'me'), d = this.pk?.d || 1;
                    breath = 1;
                    pose = this.role('look', 'idle');
                    if (k === 'aegyo') {                                 // 폴짝폴짝, can't wait
                        pose = this.role('happy', 'idle');
                        bob = Math.abs(Math.sin(this.t * Math.PI * 3)) * 7 * this.k;
                        this.tiltT = d * 2;
                        if (this.fxT === 0 && this.t > 0.15) { this.fxT = 1; fx(this, '♪'); }
                    } else if (k === 'neugut') {                         // just woke up, a slow look
                        this.tiltT = d * Math.min(2, this.t * 2);
                        if (this.fxT === 0 && this.t > 0.8) { this.fxT = 1; fx(this, '?', 'tavvy-fx-small'); }
                    } else if (k === 'simsul') {                         // waits… 💢
                        this.tiltT = d * 2;
                        if (this.fxT === 0 && this.t > 1.0) { this.fxT = 1; fx(this, '💢'); }
                        if (this.fxT === 1) pose = this.rp('angry');
                    } else {
                        this.tiltT = d * 2;
                        if (this.fxT === 0 && this.t > 0.2) { this.fxT = 1; fx(this, '?', 'tavvy-fx-small'); }
                    }
                    if (this.t > this.until) { this.pk = null; this.setState('idle'); }
                    break;
                }
                case 'follow': {                       // 관심: looking at your hand / finger
                    const k = kindOf(this, 'me');
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
                case 'resist': {                       // 단짝: doesn't want to go to bed yet (도리도리)
                    const k = kindOf(this, 'bed'), d = this.side ? this.dir : 1;
                    pose = k === 'simsul' ? this.rp('angry') : k === 'saechim' ? this.rp('flick') : k === 'musim' ? this.role('idle') : this.rp('fluster');
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
                    pose = this.role('nod', 'sleep', 'idle');
                    this.tiltT = (this.side ? this.dir : 1) * (7 + Math.max(0, Math.sin(this.t * 2.6)) * 8);
                    this.fxT -= dt;
                    if (this.fxT <= 0) { this.fxT = 1.6; fx(this, 'Z', 'tavvy-fx-z'); }
                    break;
                case 'gift': {                         // 내편 애교: here, for you
                    const b = this.big;
                    if (!b) { this.setState('idle'); break; }
                    breath = 1;
                    if (this.t < 0.7) {                                  // 꼼지락 (getting it out)
                        this.tiltT = Math.sin(this.t * 22) * 5;
                    } else if (this.t < 2.4) {
                        if (!b.shown) { b.shown = true; showGift(this, b.item); fx(this, '♥'); }
                        pose = this.role('gift', 'happy', 'idle');
                        this.tiltT = 0;                                  // 0.10.9: no more growing bigger — just holds it out
                    } else {
                        pose = this.role('happy', 'idle');
                        if (this.t > 2.9) this.setState('idle');
                    }
                    break;
                }
                case 'walk': {
                    if (this.food > 0) { this.edge = false; this.setState('eat'); break; }
                    const d = this.tx - this.x;
                    const sp = this.p.speed * paceOf(this.rec) * (this.gait === 'run' ? RUN_X : 1);   // 0.8.2: no more slow steps after a big meal (felt unnatural)
                    if (Math.abs(d) <= sp * dt) {
                        this.x = this.tx;
                        const go = this.go, gait = this.gait;
                        if (go) { this.arrive(go); break; }                                           // 0.9.0: walked there for something
                        if (gait === 'run') { this.skv = Math.sign(d || this.dir) * sp; this.setState('skid'); break; }   // 급정거
                        if (this.edge && this.plat) { this.edge = false; this.setState('edge'); this.until = rand(0.6, 1.1); }
                        else { this.edge = false; this.setState('idle'); this.until *= 0.6; }   // only a short stop after a walk
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
                    if (this.gait === 'run') { bob *= 0.6; this.tiltT = Math.sign(d) * 7; }        // leaning into it
                    if (Math.floor(this.walkPh) !== before) {
                        // foot touches down: next frame + a tiny squish
                        this.frame++;
                        const soft = (this.rec.look.squish ?? 0.5) * 2;
                        if (soft > 0) this.sq = Math.min(this.sq, 0.95);
                    }
                    pose = this.aside ? this.rp('aside') : this.role('walk');
                    break;
                }
                case 'skid': {                         // 갑자기 달리기: a sudden stop, sliding a bit
                    const [Ls, Rs] = this.range();
                    this.skv *= Math.pow(0.004, dt);
                    this.x = clamp(this.x + this.skv * dt, Ls, Math.max(Ls, Rs));
                    this.tiltT = -Math.sign(this.skv || 1) * 9;
                    this.sqT = 0.92;
                    pose = this.rec.look.roles?.surprise?.length ? this.rp('surprise') : this.role('walk');   // 0.9.2: no 놀람 picture → still the walking one
                    if (this.t > this.until) { this.tiltT = 0; this.sqT = 1; if (Math.random() < 0.3) fx(this, '💦', 'tavvy-fx-small'); this.setState('idle'); }
                    break;
                }
                case 'read': {                         // 글 읽는 척: along the message, looking down at the words
                    breath = 1;
                    if (this.food > 0 || this.mealPending) { this.tiltT = 0; this.decide(); break; }
                    if (!this.rd) {
                        if (!this.plat) { this.setState('idle'); break; }
                        const [Lr, Rr] = this.range();
                        if (Rr - Lr < 20) { this.setState('perch'); break; }
                        this.rd = { tx: this.x - Lr > Rr - this.x ? rand(Lr, Lr + 15) : rand(Rr - 15, Rr), f: 0, end: 0 };
                    }
                    const rd = this.rd, dr = rd.tx - this.x, spr = this.p.speed * paceOf(this.rec) * 0.5;   // 0.9.4: 0.35 → 0.5 (felt too slow)
                    if (Math.abs(dr) > 2) this.dir = Math.sign(dr);   // 0.9.3: always — a side-facing 걷기 picture on a front-facing pet walked backwards
                    pose = this.role('look', 'idle');
                    this.tiltT = (this.side ? this.dir : 1) * 6;
                    if (Math.abs(dr) > spr * dt) {                     // 0.9.2: moving → the walking picture (no gliding)
                        this.x += Math.sign(dr) * spr * dt;
                        this.stepWalk(spr * dt);                       // 0.9.3: the walking pictures take turns
                        bob = Math.pow(Math.sin((this.walkPh % 1) * Math.PI), 0.7) * 2 * this.k;
                        pose = this.role('walk');
                    }
                    else if (!rd.end) { rd.end = this.t + 1.1; if (Math.random() < 0.7) fx(this, Math.random() < 0.5 ? '!' : '♪', 'tavvy-fx-small'); }
                    if (!rd.f && this.t > 1.3) { rd.f = 1; fx(this, Math.random() < 0.6 ? '?' : '…', 'tavvy-fx-small'); }
                    if ((rd.end && this.t > rd.end) || this.t > 14) { this.tiltT = 0; this.setState('idle'); }
                    break;
                }
                case 'toy': {                          // 0.10.0 선물: out of its pocket for a while
                    const T = this.toy;
                    if (!T) { this.setState('idle'); break; }
                    if (this.food > 0 || this.mealPending) { this.toy = null; this.decide(); break; }
                    breath = 1;
                    const H = this.h, hold = H * 0.92, u = Math.min(1, dt * 8);
                    const hp = H * giftK(T.g), [lo, hi] = this.toyRange(T.g);
                    const walking = () => { pose = this.role('walk'); bob = Math.pow(Math.sin((this.walkPh % 1) * Math.PI), 0.7) * 4 * this.k; this.tiltT = 0; };
                    if (T.out) {                                             // back into its pocket
                        const v = Math.min(1, dt * 10);
                        T.px += (this.x - T.px) * v; T.lift += (H * 0.4 - T.lift) * v;
                        T.sc = Math.max(0, T.sc - dt * (T.fast ? 7 : 3.5));
                        T.rot *= 0.8;
                        pose = this.role('happy', 'idle');
                        if (T.sc <= 0.02) { this.toy = null; this.tiltT = 0; this.setState('idle'); }
                        break;
                    }
                    if (T.k !== 'recv') T.sc += (T.st - T.sc) * u;          // pops out
                    if (T.k === 'look') {                                    // 구경하기
                        if (this.side) this.dir = T.s;
                        pose = this.role('look', 'idle');
                        this.tiltT = T.s * 6;
                        if (!T.f && this.t > 0.9) { T.f = 1; fx(this, Math.random() < 0.5 ? '?' : '♪', 'tavvy-fx-small'); }
                        if (T.f === 1 && this.t > 2.4) { T.f = 2; if (Math.random() < 0.5) fx(this, '♪', 'tavvy-fx-small'); }
                        if (this.t > T.dur) T.out = true;
                    } else if (T.k === 'show') {                             // 자랑하기: up over its head, toward you
                        if (this.side) this.dir = (stage.left + stage.right) / 2 >= this.x ? 1 : -1;
                        T.px += (this.x - T.px) * u;
                        T.lift += (H * 1.02 - T.lift) * Math.min(1, dt * 6);
                        T.st = this.t > 0.5 && this.t < 1.9 ? 1.25 : 1;
                        pose = this.role('happy', 'idle');
                        this.tiltT = 0;
                        if (this.t < 0.5) bob = Math.sin(this.t / 0.5 * Math.PI) * 5 * this.k;
                        if (!T.f && this.t > 0.6) { T.f = 1; fx(this, '♥'); }
                        if (T.f === 1 && this.t > 1.3) { T.f = 2; fx(this, '✦'); }
                        if (this.t > 2.7) T.out = true;
                    } else if (T.k === 'roll') {                             // 굴리며 놀기: a push, it rolls, after it
                        T.px += T.vx * dt;
                        if (T.px < lo || T.px > hi) { T.px = clamp(T.px, lo, hi); T.vx = this.plat ? 0 : -T.vx * 0.5; }   // 말풍선 위: 끝 전에 멈춤
                        T.rot += (T.vx * dt) / Math.max(8, hp / 2) * 57.3;
                        T.vx *= Math.pow(0.3, dt);
                        if (T.moving && Math.abs(T.vx) < 12) {               // stopped: next push goes where there's room
                            T.moving = false; T.vx = 0;
                            if ((T.s > 0 ? hi - T.px : T.px - lo) < (this.plat ? 50 : 100)) T.s = -T.s;
                        }
                        const tx = clamp(T.px - T.s * (this.w * 0.42 + hp * 0.32), ...this.range());
                        if (!this.stepToward(tx, dt)) walking();
                        else {
                            if (this.side) this.dir = T.s;
                            pose = this.role('look', 'idle');
                            this.tiltT = T.s * 4;
                            if (!T.moving) {
                                T.wait += dt;
                                if (T.n >= T.max) { if (!T.f) { T.f = 1; fx(this, '♪', 'tavvy-fx-small'); } if (T.wait > 0.9) T.out = true; }
                                else if (T.wait > (T.n ? 0.35 : 0.5)) { T.n++; T.wait = 0; T.moving = true; T.vx = T.s * (this.plat ? rand(80, 120) : rand(150, 230)); this.sq = 0.88; }
                            }
                        }
                        if (this.t > 14) T.out = true;
                    } else if (T.k === 'toss') {                             // 던졌다 받기
                        if (T.ph === 0) {                                    // holding it up over its head
                            T.px += (this.x - T.px) * u;
                            T.lift += (hold - T.lift) * u;
                            T.rot *= 0.8;
                            pose = this.role('happy', 'idle');
                            this.tiltT = 0;
                            T.wait += dt;
                            if (T.wait > (T.n ? 0.35 : 0.6)) {
                                if (T.n >= T.max) { T.out = true; fx(this, '♪', 'tavvy-fx-small'); }
                                else { T.ph = 1; T.wait = 0; T.vy = Math.sqrt(2 * TOY_G * H * rand(1.2, 2)); this.sq = 0.88; }
                            }
                        } else if (T.ph === 1) {                             // up… and down
                            T.lift += T.vy * dt; T.vy -= TOY_G * dt;
                            T.rot += 260 * dt * T.s;
                            pose = this.role('look', 'idle');
                            if (T.vy < 0 && T.lift <= hold) {
                                if (!T.missed && Math.random() < 0.2) { T.missed = true; T.ph = 2; T.vx = T.s * rand(50, 90); fx(this, '!', 'tavvy-fx-small'); }
                                else { T.lift = hold; T.vy = 0; T.n++; T.ph = 0; T.wait = 0; T.hop = 0.3; this.sq = 0.9; }
                            }
                        } else if (T.ph === 2) {                             // missed — it drops
                            T.px = clamp(T.px + T.vx * dt, lo, hi); T.lift += T.vy * dt; T.vy -= TOY_G * dt;
                            T.rot += T.vx * dt * 2;
                            pose = this.role('surprise', 'look', 'idle');
                            if (T.lift <= 0) {
                                T.lift = 0;
                                if (T.vy < -150) T.vy = -T.vy * 0.35; else { T.vy = 0; T.vx = 0; T.ph = 3; fx(this, '💦', 'tavvy-fx-small'); }
                            }
                        } else {                                             // walks over and picks it up
                            const tx = clamp(T.px - T.s * (this.w * 0.35), ...this.range());
                            if (!this.stepToward(tx, dt)) walking();
                            else { T.ph = 0; T.wait = 0; T.n = T.max; }
                        }
                        if (T.hop > 0) { T.hop -= dt; bob = Math.max(0, Math.sin((1 - T.hop / 0.3) * Math.PI)) * 6 * this.k; }
                        if (this.t > 15) T.out = true;
                    } else if (T.k === 'give') {                             // 0.10.1 나에게 내밀기: holds it out to you
                        const cs = (stage.left + stage.right) / 2 >= this.x ? 1 : -1;
                        if (this.side) this.dir = cs;
                        const gx = this.x + cs * this.w * 0.3;          // in front, a little to one side (its face stays in view)
                        T.px += (gx - T.px) * u;
                        T.lift += (H * 0.12 - T.lift) * u;
                        pose = this.role('happy', 'idle');
                        if (this.t < 0.7) { T.st = 0.8; this.tiltT = Math.sin(this.t * 28) * 4; }            // rummaging for it
                        else if (this.t < 2.3) { T.st = 1.6; this.tiltT = 0; T.rot = Math.sin(this.t * 5) * 4; } // closer — for you
                        else { T.st = 1; T.rot *= 0.8; }
                        if (!T.f && this.t > 0.9) { T.f = 1; fx(this, '♥'); }
                        if (this.t > 3) T.out = true;
                    } else {                                                 // recv: you just gave it — it drops in
                        if (T.ph === 0) {
                            T.vy -= TOY_G * dt; T.lift += T.vy * dt; T.rot += 200 * dt * T.s;
                            pose = this.role('look', 'idle');
                            if (this.side) this.dir = T.s;
                            if (T.lift <= 0) {
                                T.lift = 0;
                                if (T.vy < -260) T.vy = -T.vy * 0.3;
                                else { T.vy = 0; T.rot = 0; T.ph = 1; T.lt = 0; fx(this, '!'); this.sq = 0.88; }
                            }
                        } else if (T.ph === 1) {                             // 0.10.1: a box! a look, two pats, and it opens
                            const B = T.box, lt = (T.lt += dt);
                            if (this.side) this.dir = T.s;
                            if (B.sh > 0) B.sh = Math.max(0, B.sh - dt);
                            if (B.o < 0) {
                                pose = lt < 0.6 ? this.role('look', 'idle') : this.role('happy', 'idle');
                                this.tiltT = lt < 0.6 ? T.s * 6 : T.s * 3;
                                for (const at of [0.7, 1.05]) if (lt >= at && (T.pats || 0) < (at === 0.7 ? 1 : 2)) {
                                    T.pats = (T.pats || 0) + 1; B.sh = 0.25; this.sq = 0.88;
                                }
                                if (lt > 0.7 && lt < 1.35) bob = Math.abs(Math.sin((lt - 0.7) / 0.35 * Math.PI)) * 3 * this.k;
                                if (lt >= 1.45) {
                                    B.o = 0; fx(this, '✦'); this.gotGift(T.g);
                                    for (const X of T.extra || []) this.gotGift(X.g);   // 0.10.2: all of them at once
                                }
                            } else {
                                B.o += dt;
                                const u2 = Math.min(1, B.o / 0.45);
                                T.sc = u2;
                                T.lift = Math.sin(u2 * Math.PI) * this.h * 0.35;   // pops up out of it, then settles
                                pose = this.role('surprise', 'happy', 'idle');
                                this.tiltT = 0;
                                if (T.extra?.length && B.o >= 0.4 && !T.tw) { T.tw = 1; fx(this, '✦'); }   // the rest twinkle away
                                if (B.o >= (T.extra?.length ? 0.8 : 0.6)) { T.lift = 0; T.sc = 1; T.ph = 2; T.lt = 0; T.box = null; T.extra = null; }
                            }
                        } else {
                            const k = T.kind, lt = (T.lt += dt);
                            if (this.side) this.dir = T.s;
                            pose = this.role('happy', 'idle');
                            this.tiltT = 0;
                            if (k === 'aegyo') {                             // 통통 + ♥
                                if (lt < 0.9) bob = Math.abs(Math.sin(lt / 0.45 * Math.PI)) * 6 * this.k;
                                if (!T.f && lt > 0.3) { T.f = 1; fx(this, '♥'); }
                                if (T.f === 1 && lt > 1.0) { T.f = 2; fx(this, '♥'); }
                                if (lt > 2.4) T.out = true;
                            } else if (k === 'saechim') {                    // 고개 홱 → 몰래 힐끔 → 작은 ♥
                                if (lt < 1.1) { if (this.side) this.dir = -T.s; pose = this.role('flick', 'aside', 'idle'); this.tiltT = -T.s * 8; }
                                else { pose = this.role('look', 'idle'); this.tiltT = T.s * 5; if (!T.f) { T.f = 1; fx(this, '♥', 'tavvy-fx-small'); } }
                                if (lt > 2.6) T.out = true;
                            } else if (k === 'neugut') {                     // ♪
                                if (!T.f && lt > 0.5) { T.f = 1; fx(this, '♪'); }
                                if (lt > 2.4) T.out = true;
                            } else if (k === 'simsul') {                     // turns away and it's whisked away
                                pose = this.role('angry', 'idle');
                                if (lt > 0.9) { T.out = true; T.fast = true; }
                            } else {                                         // 무심: "…" then a small ♥
                                pose = this.role('look', 'idle');
                                if (!T.f && lt > 0.3) { T.f = 1; fx(this, '…', 'tavvy-fx-small'); }
                                if (T.f === 1 && lt > 1.5) { T.f = 2; fx(this, '♥', 'tavvy-fx-small'); }
                                if (lt > 2.6) T.out = true;
                            }
                        }
                    }
                    break;
                }
                case 'hide': {                         // 빼꼼 숨기: half out of sight at the side, then a peek back at you
                    const h = this.hd;
                    if (!h) { this.setState('idle'); break; }
                    breath = 1;
                    const ease = (a, b, u) => a + (b - a) * (1 - Math.pow(1 - clamp(u, 0, 1), 2));
                    const hideX = h.E + h.s * this.w * 0.12, peekX = h.E - h.s * this.w * 0.18;
                    this.clipEdge = h;
                    const px = this.x;
                    if (this.t < 0.6) { this.dir = h.s; this.x = ease(h.x0, hideX, this.t / 0.6); this.stepWalk(this.x - px); pose = this.role('walk'); }   // walking in (0.9.3: right way round, pictures in turn)
                    else if (this.t < h.wait) { this.x = hideX; pose = this.rp('aside'); }
                    else if (this.t < h.wait + 0.5) {
                        this.dir = -h.s;
                        this.x = ease(hideX, peekX, (this.t - h.wait) / 0.5);
                        this.stepWalk(this.x - px);
                        pose = this.role('walk');                  // 0.9.2: a step out, walking
                        this.tiltT = -h.s * 8;
                    } else {
                        this.x = peekX;
                        pose = this.role('look', 'idle');
                        this.tiltT = -h.s * 8;
                        if (!h.f) { h.f = 1; fx(this, ['?', '!', '♥'][Math.floor(Math.random() * 3)], 'tavvy-fx-small'); }
                        if (this.t > h.wait + 1.9) {
                            this.tiltT = 0; this.hd = null;
                            const [Lh, Rh] = this.range();
                            this.walkTo(clamp(this.x - h.s * rand(50, 110), Lh, Rh));   // comes back out
                        }
                    }
                    break;
                }
                case 'where': {                        // …어디 갔었어? — comes and stares at you
                    breath = 1;
                    pose = this.role('look', 'idle');
                    this.tiltT = 0;
                    this.sqT = this.t > 0.4 ? 1.03 : 1;
                    if (this.fxT === 0 && this.t > 0.2) { this.fxT = 1; fx(this, '…', 'tavvy-fx-small'); }
                    if (this.fxT === 1 && this.t > 0.9) { this.fxT = 2; this.speak(LX('…어디 갔었어?', '…where did you go?'), 2600); }
                    if (this.t > this.until) { this.sqT = 1; this.setState('idle'); }
                    break;
                }
                case 'stare': {                        // 글 쓰면 빤히: next to the input box, watching you write
                    breath = 1;
                    if (this.food > 0 || this.mealPending) { this.tiltT = 0; this.decide(); break; }
                    pose = this.role('look', 'idle');
                    const ix = inputX();
                    if (this.side && Math.abs(ix - this.x) > 10) this.dir = ix > this.x ? 1 : -1;
                    this.tiltT = (Math.abs(ix - this.x) > 10 ? (ix > this.x ? 1 : -1) : (this.side ? this.dir : 1)) * 4;
                    if (this.fxT === 0 && this.t > 0.4) { this.fxT = 1; fx(this, '…', 'tavvy-fx-small'); }
                    if (performance.now() - typing.last > 2500 || this.t > 12) { this.tiltT = 0; this.setState('idle'); }
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
                    pose = this.rp('climb');
                    if (this.t > 0.35) this.launch();
                    break;
                case 'fly': {                          // 날기 (soft curves) · 휙휙 (dart, stop, dart)
                    const top = this.strollTop();
                    if (this.y > top) this.y = top;                      // keyboard came up etc.
                    if (this.sy > top) this.sy = top;                    // 0.8.4: …and where it's going, too (else it never gets there)
                    this.sx = clamp(this.sx, L, Math.max(L, R));
                    if (this.t > this.until + STUCK_EXTRA) { this.strollDrop(); break; }   // safety net: never stuck up there
                    const dash = this.fmode === 'dash';
                    pose = this.rp(dash ? 'dash' : 'fly');
                    const dx = this.sx - this.x, dy = this.sy - this.y, dist = Math.hypot(dx, dy);
                    if (dash) {
                        if (this.hold > 0) {                             // stopped in the air for a moment
                            this.hold -= dt;
                            breath = 1;
                            bob = Math.sin(this.clock * 3) * 2 * this.k;
                            this.tiltT = 0; this.sqT = 1;
                            break;
                        }
                        const m = Math.min(dist, DASH_SPEED * dt);
                        if (dist > 0.5) { this.x += dx / dist * m; this.y += dy / dist * m; }
                        if (Math.abs(dx) > 3) this.dir = dx > 0 ? 1 : -1;
                        this.tiltT = Math.abs(dx) > 3 ? Math.sign(dx) * 14 : 0;
                        this.sqT = 0.9;
                        this.gT -= dt;
                        if (this.gT <= 0) { this.gT = GHOST_GAP; this.ghost(); }
                        if (dist <= DASH_SPEED * dt) {
                            this.sqT = 1; this.sq = 0.92; this.tiltT = 0;
                            if (this.fgoal) { this.flyArrive(); break; }
                            this.hold = rand(...DASH_HOLD);
                            if (this.t > this.until) this.flyEnd(); else this.flyPick(false);
                        }
                        break;
                    }
                    // 날기: drifts toward the next point, turning in soft curves, bobbing a little
                    const near = this.fgoal ? 2 : this.h * 0.5;
                    if (dist <= near) { this.flyArrive(); break; }
                    const spd = Math.max(45, (this.p.speed * paceOf(this.rec)) * 1.2) * Math.min(1, dist / (this.h * 1.2) + (this.fgoal ? 0.15 : 0.35));
                    const k = Math.min(1, dt * 1.8);
                    this.fvx += (dx / dist * spd - this.fvx) * k;
                    this.fvy += (dy / dist * spd - this.fvy) * k;
                    this.x += this.fvx * dt;
                    this.y = Math.max(0, this.y + this.fvy * dt);
                    this.x = clamp(this.x, L, Math.max(L, R));
                    if (this.fgoal === 'land' && this.y <= 0.5 && Math.abs(dx) < 3) { this.flyArrive(); break; }
                    bob = Math.sin(this.clock * 3) * 3 * this.k * Math.min(1, this.y / this.h);
                    this.tiltT = clamp(this.fvx * 0.12, -FLY_TILT, FLY_TILT);
                    if (Math.abs(this.fvx) > 8) this.dir = this.fvx > 0 ? 1 : -1;
                    breath = 1;
                    break;
                }
                case 'portal': {                       // 0.11.3 차원문: walk in … out of sight … out of another one
                    const P = this.pt;
                    if (!P || this.t > 20) {                             // safety net
                        const up = this.y > 1;
                        this.endWall(); this.scale = 1;
                        if (up) this.strollDrop(); else this.setState('idle');
                        break;
                    }
                    P.k += dt;
                    if (P.ph === 'open') {
                        pose = this.role('idle');
                        if (Math.abs(P.x - this.x) > 3) this.dir = P.x > this.x ? 1 : -1;
                        if (P.k >= PORTAL_OPEN) { P.ph = 'walk'; P.k = 0; }
                        break;
                    }
                    if (P.ph === 'walk' || P.ph === 'out') {             // walking (in: to the door / out: a few steps away)
                        const sp = this.p.speed * paceOf(this.rec);
                        const tx = P.ph === 'walk' ? P.x - P.s * this.w / 2 : P.tx;   // 0.11.9: to where its front touches the door's middle
                        const d = tx - this.x;
                        if (P.ph === 'out') {
                            const f = Math.min(1, P.k / PORTAL_IN);
                            this.scale = 0.1 + 0.9 * f;
                            this.el.style.opacity = String(f);
                            if (f >= 1 && P.b) { shutDoor(P.b); P.b = null; }
                        }
                        if (Math.abs(d) <= sp * dt || (P.ph === 'out' && P.to.k !== 'land')) {
                            if (P.ph === 'walk') { this.x = tx; P.ph = 'in'; P.k = 0; P.x0 = tx; this.portalMask({ E: P.x, s: P.s }); break; }
                            if (P.k < PORTAL_IN) { pose = this.role('idle'); break; }   // still coming out
                            const k = P.to.k;
                            this.endWall(); this.scale = 1;
                            if (k === 'land') { this.y = 0; this.sq = 0.92; this.setState('idle'); }
                            else this.strollDrop();                      // air: falls / message: settles onto it
                            break;
                        }
                        this.dir = d > 0 ? 1 : -1;
                        this.x += this.dir * sp * dt;
                        const before = Math.floor(this.walkPh);
                        this.walkPh += sp / 22 * dt;
                        bob = Math.pow(Math.sin((this.walkPh % 1) * Math.PI), 0.7) * 4 * this.k * this.scale;
                        waddle = Math.sin(this.walkPh * Math.PI) * 1.5;
                        if (Math.floor(this.walkPh) !== before) this.frame++;
                        pose = this.role('walk');
                        break;
                    }
                    if (P.ph === 'in') {                                 // 0.11.9: walking on through the door — gone past its middle line
                        const sp = this.p.speed * paceOf(this.rec);
                        const go = this.w * (1 + PORTAL_SOFT);
                        this.dir = P.s;
                        this.x += P.s * sp * dt;
                        const f = Math.min(1, (this.x - P.x0) * P.s / go);
                        const before = Math.floor(this.walkPh);
                        this.walkPh += sp / 22 * dt;
                        bob = Math.pow(Math.sin((this.walkPh % 1) * Math.PI), 0.7) * 4 * this.k;
                        waddle = Math.sin(this.walkPh * Math.PI) * 1.5;
                        if (Math.floor(this.walkPh) !== before) this.frame++;
                        pose = this.role('walk');
                        this.wobY = Math.sin(f * Math.PI * 3) * PORTAL_WOB;
                        glowDoor(P.a, Math.sin(f * Math.PI));
                        if (f >= 1) {
                            this.el.style.opacity = '0';
                            this.portalMask(null);
                            shutDoor(P.a); P.a = null; P.ph = 'gap'; P.k = 0;
                        }
                        break;
                    }
                    if (P.ph === 'gap') {                                // out of sight
                        pose = this.role('idle');
                        if (P.k < PORTAL_GAP) break;
                        P.to = this.portalOut();
                        this.x = P.to.x; this.y = P.to.y;
                        P.b = openDoor(this, P.to.x, P.to.y - (P.to.k === 'perch' ? this.h * 0.1 : 0));
                        P.ph = 'wait'; P.k = 0;
                        break;
                    }
                    if (P.ph === 'wait') {                               // the other door opening
                        pose = this.role('idle');
                        if (P.k < PORTAL_OPEN) break;
                        let s = Math.random() < 0.5 ? -1 : 1;
                        if (P.to.k === 'land') {
                            const [fl, fr] = this.range();
                            if ((s > 0 ? fr - this.x : this.x - fl) < this.w) s = -s;
                            P.tx = clamp(this.x + s * this.w * 0.9, fl, Math.max(fl, fr));
                        } else P.tx = this.x;
                        this.dir = s;
                        P.ph = 'out'; P.k = 0;
                        break;
                    }
                    break;
                }
                case 'stroll': {                       // 화면 산책 — anywhere on the screen, stays put while scrolling
                    const top = this.strollTop();
                    if (this.y > top) this.y = top;                      // keyboard came up etc.
                    if (this.sy > top) this.sy = top;                    // 0.8.4: …and where it's going, too (else it never gets there)
                    this.sx = clamp(this.sx, L, Math.max(L, R));
                    if (this.t > this.until + STUCK_EXTRA) { this.strollDrop(); break; }   // safety net: never stuck up there
                    pose = this.rp('wall');
                    if (this.slipT > 0) {                                // slipped: slides down a little, holds on again
                        this.slipT -= dt;
                        this.y = Math.max(this.h, this.y - 200 * dt);
                        shiver = Math.sin(this.clock * 40) * 1.2;
                        if (this.slipT <= 0) this.sy = Math.max(this.sy, this.y);
                        break;
                    }
                    const dx = this.sx - this.x, dy = this.sy - this.y, dist = Math.hypot(dx, dy);
                    if (dist > 2) {                                      // climbing: pull … hold … pull
                        const prev = this.cph || 0;
                        this.cph = prev + dt;
                        const ph = this.cph % CLIMB_PULL;
                        if (ph < prev % CLIMB_PULL) {                    // a new pull
                            this.frame++;
                            this.pullSide = -(this.pullSide || 1);
                            if (dy > 0 && Math.random() < CLIMB_SLIP) { this.slipT = 0.3; if (Math.random() < 0.4) fx(this, '💦', 'tavvy-fx-small'); break; }
                        }
                        const moving = ph < CLIMB_PULL * 0.65;
                        const sp = (this.p.speed * paceOf(this.rec)) * 0.6 * 1.55;            // same average pace as before, in pulls
                        if (moving) {
                            const m = Math.min(dist, sp * dt);
                            this.x += dx / dist * m; this.y += dy / dist * m;
                        }
                        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 3) this.dir = dx > 0 ? 1 : -1;
                        this.tiltT = (this.pullSide || 1) * 3;           // reaching with one side, then the other
                        this.sqT = moving ? 1.05 : 0.97;
                        break;
                    }
                    this.tiltT = 0; this.sqT = 1;
                    if (this.sgoal === 'down') {                         // back on the floor
                        this.y = 0;
                        const [L, R] = this.range();
                        this.x = clamp(this.x, L, Math.max(L, R));
                        this.endWall();
                        this.sq = 0.85;
                        this.setState('idle');
                        break;
                    }
                    if (this.sgoal === 'drop') { this.strollDrop(); break; }
                    breath = 1;                                          // stopped for a moment
                    this.sp += dt;
                    if (this.sp > this.spLen) {
                        if (this.t > this.until) this.strollEnd();
                        else this.strollPick();
                    }
                    break;
                }
                case 'fidget': {                       // a little something on the spot
                    breath = 1;
                    if (this.food > 0 || this.mealPending) { this.sqT = 1; this.decide(); break; }   // food coming → eat
                    const k = this.fk;
                    if (k === 'scan') {                                  // 두리번
                        pose = this.role('look', 'idle');
                        this.tiltT = Math.sin(this.t * Math.PI * 1.3) * 4;
                        if (this.fq && this.fxT === 0 && this.t > 0.8) { this.fxT = 1; fx(this, '?', 'tavvy-fx-small'); }
                    } else if (k === 'sway') {                           // 흥얼거리기: humming, swaying (0.9.0: longer, a few ♪)
                        pose = this.role('happy', 'idle');
                        this.tiltT = Math.sin(this.t * Math.PI * 1.6) * 6;
                        bob = Math.abs(Math.sin(this.t * Math.PI * 1.6)) * 2 * this.k;
                        if (this.fxT < 3 && this.t > 0.2 + this.fxT * 0.85) { this.fxT++; fx(this, this.fxT === 2 ? '♫' : '♪', 'tavvy-fx-small'); }
                    } else if (k === 'tummy') {                          // 배 통통 — pats its full tummy
                        pose = this.role('happy', 'idle');
                        this.tiltT = 0;
                        this.sqT = this.t < 1.4 && Math.sin(this.t * Math.PI * 5) > 0.5 ? 0.94 : 1;
                        if (this.fxT === 0 && this.t > 0.3) { this.fxT = 1; fx(this, '♪', 'tavvy-fx-small'); }
                    } else if (k === 'sit') {                            // sits down for a bit (has a 앉기 picture)
                        pose = this.role('sit', 'idle');
                        breath = 0.8;
                    } else if (k === 'zone') {                           // 0.10.12 멍: stands still, the wheel turns
                        this.tiltT = 0;
                    } else if (k === 'nibble') {                         // 0.10.12 나눠 먹기: a bite or two (a show — nothing is counted)
                        pose = this.role('eat', 'idle');
                        if (this.fxT < 3 && this.t > 0.3 + this.fxT * 0.45) { this.fxT++; this.frame++; this.sq = Math.min(this.sq, 0.93); }
                    }
                    if (this.t > this.until) { this.sqT = 1; this.tiltT = 0; this.setState('idle'); this.until = rand(...AFTER_FIDGET); }
                    break;
                }
                case 'perch':                          // sitting on a message
                    breath = 0.8;
                    pose = this.role('sit', 'idle');
                    if (!this.rec.look.roles?.sit?.length) this.tiltT = Math.sin(this.t * 1.1) * 3;   // no 앉기 picture: a lazy sway
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
                    if (k === 'glance') { this.tiltT = this.t < 0.6 ? d * 6 : -d * 9; if (this.t >= 0.6) pose = this.rp('flick'); }   // look… then turn away
                    else if (k === 'flick') { this.tiltT = this.t < 0.15 ? 0 : -d * 9; if (this.t >= 0.15) pose = this.rp('flick'); }
                    else if (k === 'up') { this.tiltT = d * 4; }
                    else if (k === 'peek' || k === '?') { this.tiltT = d * 4; pose = this.rp('curious'); }
                    else if (k === '♥') { this.tiltT = 0; pose = this.role('happy', 'idle'); }
                    else if (k === '💢' || k === 'hmph') { this.tiltT = d * 4; pose = this.rp('angry'); }
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
                    if (this.fxT <= 0) {
                        this.fxT = rand(2.4, 3.6);
                        const zk = kindOf(this, '');
                        if (this.zoneT > 0) { /* still loading */ }
                        else if (Math.random() < chance(this, 'zone', (ZONE_P[zk] || 0.02) * ZONE_GEN * 2)) this.zoneT = rand(...(ZONE_LEN[zk] || [2, 3]));   // 0.10.12 같이 로딩 중
                        else fx(this, '?', 'tavvy-fx-small');
                    }
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
                    if (this.p.perch === 'doze' && this.t > 6) { this.setState('doze'); break; }   // 느긋쟁이 nods off while waiting
                    if (this.wsw > 0) {                                  // swaying while it waits
                        this.wsw -= dt;
                        this.tiltT = Math.sin(this.t * Math.PI * 2) * 4;
                        pose = this.role('happy', 'idle');
                    }
                    this.wvT -= dt;
                    if (this.wvT <= 0 && this.wsw <= 0) {               // not just standing there: a little something now and then
                        this.wvT = rand(...WAIT_FIDGET);
                        const r = Math.random(), [L, R] = this.range();
                        const long = (performance.now() - gen.t0) / 1000 > 10;
                        // 0.11.6: walk 30% · sway 25% · doze 15% (long waits) · hop 8% (rarest) · the rest just stands
                        if (r < 0.3 && R - L > 50) { this.walkTo(clamp(this.x + (Math.random() < 0.5 ? -1 : 1) * rand(25, 70), L, R)); break; }
                        if (r < 0.55 && r >= 0.3) { this.wsw = 1.6; fx(this, '♪', 'tavvy-fx-small'); break; }
                        if (r < 0.7 && r >= 0.55 && long) { this.setState('doze'); this.until = rand(3, 6); break; }
                        if (r >= 0.92) { this.hopInPlace('wait'); break; }
                    }
                    break;
                }
                case 'watch':                          // looking at the reply from on top of it
                    breath = 1;
                    pose = this.role('look', 'idle');
                    this.tiltT = (this.side ? this.dir : 1) * 6;
                    if (this.fxT === 0 && this.t > 0.2) { this.fxT = 1; fx(this, '?'); }
                    if (this.fxT === 1 && this.t > 1.4) { this.fxT = 2; fx(this, '!'); }
                    if (this.t > this.until) {                          // seen it — then sit / nap / play up there
                        const r = Math.random();
                        this.setState(this.plat && r < 0.35 ? 'perch' : this.plat && r < 0.5 ? 'doze' : 'idle');
                    }
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
                    else if ((this.eatIdle += dt) > 0.45 && this.t >= EAT_MIN) this.finishMeal();
                    break;
                case 'nod':                            // after a big meal: leaning over, nodding, Z
                    breath = 0.6;
                    pose = this.role('nod', 'sleep', 'idle');
                    this.tiltT = (this.side ? this.dir : 1) * (11 + Math.max(0, Math.sin(this.t * 3.4)) * 7);
                    this.fxT -= dt;
                    if (this.fxT <= 0) { this.fxT = 1.1; fx(this, 'Z', 'tavvy-fx-z'); }
                    if (this.t > this.until) {
                        const n = this.after || 'idle'; this.after = 'idle';
                        if (n === 'dance') this.setState('dance'); else this.mealDone();
                    }
                    break;
                case 'dance': {                        // feast finished: a happy little dance
                    pose = this.cheering ? this.rp('cheer') : this.role('dance', 'happy', 'idle');
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
                    const k = kindOf(this, 'me'), close = closenessOf(this.rec) >= CLOSE, d = this.side ? this.dir : 1;
                    pose = this.role('look', 'idle');
                    const t = this.t - ME_LOOK;                          // 0.11.7: a good look at you first
                    if (t < 0) this.tiltT = d * 3;
                    else if (k !== 'aegyo' && can(this, 'soft')) {           // 내편: one layer softer
                        if (k === 'saechim') {                           // no turning away — a small ♥ right away
                            this.tiltT = d * 4;
                            if (this.fxT === 0 && t > 0.2) { this.fxT = 1; fx(this, '♥', 'tavvy-fx-small'); }
                        } else if (k === 'simsul') {                     // no 💢 — just ♥
                            this.tiltT = 0; pose = this.role('happy', 'idle');
                            if (this.fxT === 0 && t > 0.1) { this.fxT = 1; fx(this, '♥'); }
                        } else if (k === 'musim') {                      // stays, sometimes a ♥
                            this.tiltT = d * 3;
                            if (this.fxT === 0 && t > 0.1) { this.fxT = 1; fx(this, '…'); }
                            if (this.meHeart && this.fxT === 1 && t > 0.6) { this.fxT = 2; fx(this, '♥', 'tavvy-fx-small'); }
                        } else {                                         // 느긋: ♪, a small ♥, then a happy doze
                            this.tiltT = d * 3;
                            if (this.fxT === 0 && t > 0.2) { this.fxT = 1; fx(this, '♪'); }
                            if (this.fxT === 1 && t > 0.75) { this.fxT = 2; fx(this, '♥', 'tavvy-fx-small'); }
                        }
                    } else if (k === 'aegyo') {                                 // ♥♥ 통통
                        pose = this.role('happy', 'idle'); this.tiltT = 0;
                        bob = Math.abs(Math.sin(t * Math.PI * 2.5)) * 6 * this.k;
                        if (this.fxT === 0 && t > 0.05) { this.fxT = 1; fx(this, '♥'); }
                        if (this.fxT === 1 && t > 0.45) { this.fxT = 2; fx(this, '♥'); }
                    } else if (k === 'saechim') {                        // looks… turns away (close: looks back, small ♥)
                        this.tiltT = t < 0.6 ? d * 5 : close && t > 1.2 ? d * 4 : -d * 9;
                        if (t >= 0.6 && !(close && t > 1.2)) pose = this.rp('flick');
                        if (close && this.fxT === 0 && t > 1.3) { this.fxT = 1; fx(this, '♥', 'tavvy-fx-small'); }
                    } else if (k === 'neugut') {                         // looks, ♪ (then dozes off)
                        this.tiltT = d * 3;
                        if (this.fxT === 0 && t > 0.2) { this.fxT = 1; fx(this, '♪'); }
                    } else if (k === 'simsul') {                         // 💢 (close: then ♥)
                        if (this.fxT === 0 && t > 0.1) { this.fxT = 1; fx(this, '💢'); }
                        if (close && this.fxT === 1 && t > 0.9) { this.fxT = 2; fx(this, '♥'); }
                        this.tiltT = this.fxT === 2 ? 0 : -d * 4;
                        if (this.fxT === 2) pose = this.role('happy', 'idle');
                        else if (this.fxT === 1) pose = this.rp('angry');
                    } else {                                             // 무심: "…" (then backs off)
                        this.tiltT = 0;
                        if (this.fxT === 0 && t > 0.1) { this.fxT = 1; fx(this, '…'); }
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
                        case 'party':                                                                   // 특별한 날: ✦ + 춤
                            pose = this.rp('cheer');
                            if (first) { markCelebrated(this.rec, g.days); burstStars(this); }
                            bob = Math.abs(Math.sin(this.t * Math.PI * 2.2)) * 7 * this.k;
                            this.tiltT = (Math.floor(this.t * 2.2) % 2 ? 1 : -1) * 10;
                            if (first || ((this.t + dt) % 0.95) < dt) fx(this, '♪');
                            break;
                        case 'line':                                                                    // 축하 말
                            this.tiltT = 0; pose = this.role('happy', 'idle');
                            if (first) { this.speak(g.text, 2800, 60); fx(this, '♥', 'tavvy-fx-small'); }
                            break;
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
                        case 'flick': this.tiltT = this.t < 0.15 ? d * 4 : -d * 9; if (this.t >= 0.15) pose = this.rp('flick'); break;   // 밥 못 본 척 고개 홱
                        case 'yawn': this.tiltT = -d * 3; pose = this.role('idle'); break;
                        case 'grumpy': this.tiltT = -d * 4; pose = this.rp('angry'); if (first) fx(this, '💢'); break;   // 왜 이제 와
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
                    pose = this.rp('roll');
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
        // every squish goes through 말랑 정도 here: 0 → never squashed (no breathing either)
        const sy = Math.max(0.55, 1 - (1 - this.sq) * soft) * br;
        const sx = 1 + (1 - sy) * 0.7;
        const left = this.x - this.w / 2 + shiver;
        const top = stage.floorY - this.y - this.h + this.basePx - bob;
        this.el.style.transform = `translate3d(${(left - stage.ox).toFixed(1)}px, ${(top - stage.oy).toFixed(1)}px, 0)`;
        const ce = this.clipEdge;                                                 // 0.9.0 빼꼼: the part past the side is out of sight
        if (ce) {
            const hid = ce.s < 0 ? ce.E - left : left + this.w - ce.E;
            if (hid <= 0 && this.state !== 'hide') { this.clipEdge = null; this.el.style.clipPath = ''; }
            else { const v = Math.max(0, hid).toFixed(1); this.el.style.clipPath = ce.s < 0 ? `inset(-200% -200% -200% ${v}px)` : `inset(-200% ${v}px -200% -200%)`; }
        }
        const pc = this.pcut;                                                     // 0.11.9 차원문: soft edge at the door's middle
        if (pc) {
            const c = pc.E - left, soft = this.w * PORTAL_SOFT, O = 2000;          // a wide mask so name tags etc. are not cut off elsewhere
            const g = pc.s > 0
                ? `linear-gradient(to right, #000 ${(O + c - soft).toFixed(1)}px, transparent ${(O + c).toFixed(1)}px)`
                : `linear-gradient(to right, transparent ${(O + c).toFixed(1)}px, #000 ${(O + c + soft).toFixed(1)}px)`;
            const st = this.el.style;
            st.webkitMaskImage = st.maskImage = g;
            st.webkitMaskSize = st.maskSize = `${O * 2}px 100%`;
            st.webkitMaskPosition = st.maskPosition = `${-O}px 0`;
            st.webkitMaskRepeat = st.maskRepeat = 'repeat-y';
        }
        const wy = this.wobY || 0;                                                // 0.11.9: a little wobble through the door
        this.body.style.transform = `rotate(${((this.tilt + waddle) * TILT_K + this.spin).toFixed(2)}deg) scale(${(sx * (1 - wy * 0.83) * this.scale).toFixed(3)}, ${(sy * (1 + wy) * this.scale).toFixed(3)})`;
        const look = this.rec.look;
        const list = pose && pose.length ? pose : look.roles.idle;
        const rk = roleKeyOf(look, list);
        const opt = (rk && look.roleOpts?.[rk]) || {};
        if (list !== this.animList) { this.animList = list; this.animT0 = performance.now(); }
        let i = 0;
        if (list.length > 1) {
            if (STEP_ROLES[rk]) i = this.frame;                                   // walking: one per step / eating: one per bite
            else i = Math.floor((performance.now() - this.animT0) / 1000 * (FRAME_FPS[opt.speed] || FRAME_FPS.normal));
        }
        const src = imgUrl(list[i % list.length]);
        if (src !== this.curSrc) { this.img.src = src; this.curSrc = src; }
        this.placeImg(fitOf(src));
        const f = opt.facing || look.facing;                                      // each picture may face its own way
        const flip = (f === 'left' || f === 'right') && (f === 'right' ? this.dir < 0 : this.dir > 0);
        this.img.classList.toggle('tavvy-flip', flip);
        if (this.sayEl) this.placeSay();
        this.drawProp();
    }

    /** A 키 맞추기 picture: its own size at the 기본 picture's scale, standing on the box's bottom middle. */
    placeImg(fit) {
        const key = fit ? `${fit.w}|${fit.h}|${fit.m}|${this.w}|${this.h}|${this.k}` : '';
        if (key === this.fitKey) return;
        this.fitKey = key;
        const st = this.img.style;
        this.img.classList.toggle('tavvy-smooth', !!fit && fit.m > 1);
        if (!fit) { st.cssText = ''; return; }
        const W = fit.w * this.k / fit.m, H = fit.h * this.k / fit.m;
        Object.assign(st, { position: 'absolute', maxWidth: 'none', maxHeight: 'none', width: W.toFixed(1) + 'px', height: H.toFixed(1) + 'px', left: ((this.w - W) / 2).toFixed(1) + 'px', top: (this.h - H).toFixed(1) + 'px' });
    }

    /** A picture for this action, or what stands in for it (ROLE_DEFS fallbacks, ending at 기본). */
    rp(key) {
        const roles = this.rec.look.roles || {};
        for (let k = key, n = 0; k && n < 8; k = ROLE_DEFS[k]?.fb, n++) if (roles[k]?.length) return roles[k];
        return roles.idle;
    }

    /* ---------- speech bubble over its head ---------- */

    /** Say a line from this moment's list (if it has any, and it's in the mood). */
    talk(moment, force = false, opt = null) {
        const rec = this.rec;
        const freq = TALK_FREQ[rec.talkFreq] ? rec.talkFreq : 'some';
        if (freq === 'off') return false;
        let list = linesFor(rec, moment);
        if (opt?.also) list = [...list, ...linesFor(rec, opt.also)];      // 0.11.17 메뉴: that menu's lines + the common ones
        if (!list.length) return false;
        const always = force || TALK_ALWAYS.includes(moment);
        const now = performance.now();
        if (!always) {
            if (now - (this.lastTalk || -1e9) < TALK_GAP * 1000) return false;
            const ch = moment === 'play' ? TALK_PLAY[freq] : TALK_CHANCE[freq] * (TALK_HALF.includes(moment) ? 0.5 : 1);
            if (Math.random() >= ch) return false;
        }
        this.lastTalk = now;
        const line = list[Math.floor(Math.random() * list.length)];
        this.speak(opt?.menu ? fillName(line, 'menu', opt.menu) : line);
        return true;
    }

    speak(text, ms = SAY_MS, max = LINE_MAX) {
        const line = fillUser(text, this.rec).slice(0, max);
        if (!line) return;
        if (!this.sayEl) {
            this.sayEl = document.createElement('div');
            this.sayEl.className = 'tavvy-say';
            ensureLayer().appendChild(this.sayEl);
        }
        this.sayEl.textContent = line;
        this.sayW = this.sayEl.offsetWidth;
        this.sayH = this.sayEl.offsetHeight;
        clearTimeout(this.sayTimer);
        this.sayTimer = setTimeout(() => this.unsay(), ms);
        this.placeSay();
    }

    placeSay() {
        const el = this.sayEl, w = this.sayW || 0, h = this.sayH || 0;
        const x = clamp(this.x - w / 2, 4, Math.max(4, stage.vw - w - 4));
        const y = clamp(this.foot() - this.h * this.scale - h - 10, 4, Math.max(4, stage.vh - h - 4));
        el.style.transform = `translate3d(${(x - stage.ox).toFixed(1)}px, ${(y - stage.oy).toFixed(1)}px, 0)`;
    }

    unsay() {
        clearTimeout(this.sayTimer);
        if (this.sayEl) { this.sayEl.remove(); this.sayEl = null; }
    }
}

/* ---------- animation loop (stops when nobody is awake) ---------- */
let raf = 0, lastT = 0, remeasureT = 0;

function ensureLoop() {
    if (raf || !actors.length) return;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
}

const STEP_MAX = 1 / 30;     // s — one movement step is never longer than this (ledges, landings stay exact)
const FRAME_MAX = 0.15;      // s — 0.11.22: a slow screen (PC: few frames a second) catches up in several steps, up to this; longer gaps (tab hidden) don't
function tick(t) {
    raf = 0;
    const gap = Math.min(FRAME_MAX, Math.max(0, (t - lastT) / 1000));
    const n = Math.max(1, Math.ceil(gap / STEP_MAX - 1e-6)), dt = gap / n;   // was: one step capped at 1/30 s → half speed at 15 frames/s
    lastT = t;
    // keep geometry fresh: floor every ~0.25s (keyboard, toolbar changes), overlay origin every frame
    remeasureT += gap;
    if (remeasureT > 0.25) {
        remeasureT = 0; measure();
        // missed "generation ended" signal (stopped / error) → stop waiting
        if (gen.active && document.body.dataset.generating !== 'true' && t - gen.t0 > 3000) onGenEnd();
        // 0.10.6: not a word of the reply yet after LATE_WAIT → "답이 늦어질 때" (once per reply)
        if (gen.active && !gen.firstToken && !gen.late && t - gen.t0 > LATE_WAIT * 1000) {
            gen.late = true;
            for (const a of actors) if (canChat(a) && !a.held) a.talk('late');
        }
        checkIdle();
    }
    else {
        const ox = stage.ox, oy = stage.oy;
        measureOrigin();
        if (ox !== stage.ox || oy !== stage.oy) placeBed();
    }
    for (let i = 0; i < n && actors.length; i++) {
        for (const a of [...actors]) a.step(dt);
        if (actors.length > 1) { bumpCheck(); apartCheck(dt); meetCheck(); }
        if (sparkles.length) stepSparkles(dt);
    }
    if (actors.length) raf = requestAnimationFrame(tick);
}

/* ---------- 0.8.2: two pets standing right on top of each other → one walks a few steps off ---------- */
const APART_NEAR = 1 / 3;       // × the smaller width — closer than this counts as "on top of each other"
const APART_WAIT = 1.0;         // s of that before one of them moves

function apartCheck(dt) {
    for (const a of actors) {
        let other = null;
        if (a.state === 'idle' && !a.air && !a.held && !a.gone) {
            other = actors.find(b => b !== a && !b.air && !b.held && !b.gone && b.plat === a.plat && b.state !== 'walk'
                && Math.abs(a.x - b.x) < Math.min(a.w, b.w) * APART_NEAR);
        }
        a.stackT = other ? (a.stackT || 0) + dt : 0;
        if (a.stackT < APART_WAIT) continue;
        a.stackT = 0;
        if (other) other.stackT = 0;
        const [L, R] = a.range();
        let away = a.x === other.x ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(a.x - other.x);
        const far = Math.max(a.w, other.w) * rand(0.8, 1.3);
        let tx = clamp(a.x + away * far, L, Math.max(L, R));
        if (Math.abs(tx - a.x) < far * 0.5) { away = -away; tx = clamp(a.x + away * far, L, Math.max(L, R)); }   // a wall that side
        if (Math.abs(tx - a.x) <= 8) continue;
        a.dir = away; a.tx = tx; a.edge = false;
        a.setState('walk');
    }
}

/* ---------- two pets meeting on the same floor / ledge ---------- */
const BUMPABLE = ['idle', 'walk', 'doze', 'perch', 'look', 'wait', 'watch', 'edge', 'fidget'];

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
            if (resting || Math.random() >= BUMP_CHANCE * Math.min(fr(a, 'bump'), fr(b, 'bump'))) { a.passing.add(b); b.passing.add(a); continue; }
            const d = a.x < b.x ? -1 : a.x > b.x ? 1 : (Math.random() < 0.5 ? -1 : 1);
            a.bump(d, b); b.bump(-d, a);
            playSound('bump', 1, false, (Math.random() < 0.5 ? a : b).rec);   // 0.10.13 콩 (둘이 한 번)
            const t = performance.now(); a.bumpedAt.set(b, t); b.bumpedAt.set(a, t);
            setTimeout(() => startDuet(a, b, 'bump'), 2400);      // 0.10.8: a word after the bump (once they have landed and reacted)
            a.passing.add(b); b.passing.add(a);    // no second bump until they have parted
        }
    }
}

/* ---------- 0.10.8 펫끼리 말하기: two pets in the same room say something to each other ---------- */
let duetOn = null;                       // the talk going on now (one at a time)
const duetDeck = new Map();              // 'idA+idB' → talks not used yet this time round (indices)
const metAt = new Map();                 // 'idA+idB' → when they last talked
const meetSeen = new Set();              // pairs already rolled for this meeting (until they part)
const MEET_CALM = ['idle', 'perch', 'fidget', 'look', 'read'];   // 0.10.9: also while humming / looking about / sitting

const duetKey = (a, b) => [a, b].sort().join('+');

/** The talks two pets share (each: [[pet id, line], …]). */
function duetsOf(a, b) {
    const list = root?.duets?.[duetKey(a, b)];
    if (!Array.isArray(list)) return [];
    return list.filter(t => Array.isArray(t) && t.length && t.every(l => Array.isArray(l) && (l[0] === a || l[0] === b) && typeof l[1] === 'string' && l[1].trim()));
}

/** One talk, not repeating until all have been used (then shuffled again). */
function duetPick(a, b) {
    const list = duetsOf(a, b);
    if (!list.length) return null;
    const k = duetKey(a, b);
    let d = duetDeck.get(k);
    if (!d || d.n !== list.length || !d.left.length) {
        d = { n: list.length, left: list.map((_, i) => i).sort(() => Math.random() - 0.5) };
        duetDeck.set(k, d);
    }
    return list[d.left.pop()];
}

const talkFreqOf = (a) => TALK_FREQ[a.rec.talkFreq] ? a.rec.talkFreq : 'some';
const linesOf = (a, m) => (a.rec.lines?.[m] || []).filter(x => typeof x === 'string' && x.trim());
const fillPet = (text, other) => fillName(text, 'pet', other?.rec?.name || '');
const duetAlive = (x) => actors.includes(x) && !x.gone && !x.held;

/** No words back: the personality's reaction (the same as after a bump). */
function duetReact(x, other) {
    const k = persOf(x, 'land').bump;
    if (k === 'aside') return fx(x, '…');
    if (x.state !== 'idle' && x.state !== 'perch') return fx(x, k === 'flick' ? '…' : k);
    x.after = x.state;
    x.startLook(k, other.x);
}

/** Is there anything for a and b to say (lines or talks, and neither on 끔 when it matters)? */
function duetCan(a, b) {
    const fa = talkFreqOf(a), fb = talkFreqOf(b);
    if (fa !== 'off' && fb !== 'off' && duetsOf(a.rec.id, b.rec.id).length) return true;
    return (fa !== 'off' && linesOf(a, 'greet').length > 0) || (fb !== 'off' && linesOf(b, 'greet').length > 0);
}

/** Start a talk between a and b. how: 'bump' (right after a bump: no dice, no second reaction) / 'visit' (came over to talk: no dice) / '' (met). */
function startDuet(a, b, how = '') {
    const bump = how === 'bump';
    if (duetOn || !duetAlive(a) || !duetAlive(b) || a.plat !== b.plat) return false;
    const k = duetKey(a.rec.id, b.rec.id);
    const now = performance.now();
    if (!how && now - (metAt.get(k) ?? -1e9) < MEET_REST * 1000) return false;
    const [i, r] = how === 'visit' || Math.random() < 0.5 ? [a, b] : [b, a];   // the one who came over speaks first
    const fi = talkFreqOf(i), fr = talkFreqOf(r);
    const talks = fi !== 'off' && fr !== 'off' && duetsOf(a.rec.id, b.rec.id).length;
    let first = i, second = r;
    let greet = fi !== 'off' && linesOf(i, 'greet').length;
    if (!greet && !talks && fr !== 'off' && linesOf(r, 'greet').length) { first = r; second = i; greet = true; }   // the other one starts
    if (!greet && !talks) return false;
    if (!how && Math.random() >= TALK_CHANCE[talkFreqOf(first)]) { metAt.set(k, now); return false; }
    let script;
    if (talks && (!greet || Math.random() < 0.5)) {
        const t = duetPick(a.rec.id, b.rec.id);
        script = t.slice(0, DUET_LINES).map(([id, line]) => [id === a.rec.id ? a : b, line]);
    } else {
        const g = linesOf(first, 'greet'), ans = talkFreqOf(second) !== 'off' ? linesOf(second, 'answer') : [];
        script = [[first, g[Math.floor(Math.random() * g.length)]]];
        if (ans.length) script.push([second, ans[Math.floor(Math.random() * ans.length)]]);
        else if (!bump) script.push([second, null]);               // no words → a look / "…"
    }
    metAt.set(k, now);
    a.wantTalk = b.wantTalk = false;
    const till = now + (script.length * DUET_STEP + 1.5) * 1000;
    for (const [x, y] of [[a, b], [b, a]]) {
        x.chatTill = till;
        if (x.side && x.state !== 'walk' && Math.abs(y.x - x.x) > 8) x.dir = y.x >= x.x ? 1 : -1;   // turn to each other
    }
    const me = duetOn = { a, b };
    script.forEach(([x, line], n) => setTimeout(() => {
        if (duetOn !== me) return;
        if (!duetAlive(a) || !duetAlive(b)) { duetOn = null; a.chatTill = b.chatTill = 0; return; }
        const y = x === a ? b : a;
        if (line === null) return duetReact(x, y);
        x.lastTalk = performance.now();
        playSound('chat', 1, false, x.rec);                       // 0.10.13 웅얼
        x.speak(fillPet(line, y));
    }, n * DUET_STEP * 1000));
    setTimeout(() => { if (duetOn === me) duetOn = null; }, script.length * DUET_STEP * 1000 + 800);
    return true;
}

/** Two pets resting near each other on the same floor / ledge → maybe a talk (once per meeting). */
function meetCheck() {
    if (duetOn) return;
    const calm = (x) => !x.held && !x.air && !x.gone && MEET_CALM.includes(x.state) && !(gen.active && x.waiting);
    for (let i = 0; i < actors.length; i++) {
        for (let j = i + 1; j < actors.length; j++) {
            const a = actors[i], b = actors[j];
            const k = duetKey(a.rec.id, b.rec.id);
            const near = (a.w + b.w) * MEET_DIST;
            const dist = Math.abs(a.x - b.x);
            if (a.plat !== b.plat || dist > near * 1.4) { meetSeen.delete(k); continue; }
            if (dist > near || meetSeen.has(k) || !calm(a) || !calm(b)) continue;
            meetSeen.add(k);
            if (startDuet(a, b)) return;
        }
    }
}

/* ---------- 0.10.12 여러 마리 더 ---------- */
const pairAt = new Map();                // 'what:idA+idB' → when (ms)
const pairOk = (what, a, b, sec) => performance.now() - (pairAt.get(what + ':' + duetKey(a.rec.id, b.rec.id)) ?? -1e9) >= sec * 1000;
const pairMark = (what, a, b) => pairAt.set(what + ':' + duetKey(a.rec.id, b.rec.id), performance.now());

/** a just nodded off: pets close by say good night (잘 자), and may come and doze next to it (같이 졸기). */
function nightCheck(a) {
    if (!duetAlive(a) || a.state !== 'doze') return;
    for (const b of actors) {
        if (b === a || !duetAlive(b) || b.air || b.wallOn || b.plat !== a.plat || !NIGHT_FROM.includes(b.state) || b.waiting) continue;
        const dx = Math.abs(b.x - a.x);
        if (dx > NAP_NEAR) continue;
        const near = dx <= (a.w + b.w) * 2;
        let said = false;
        if (near && pairOk('night', a, b, NIGHT_REST) && Math.random() < chance(b, 'night', NIGHT_P)) {
            pairMark('night', a, b);
            said = true;
            if (b.side && b.state !== 'walk' && dx > 8) b.dir = a.x >= b.x ? 1 : -1;
            const lines = talkFreqOf(b) !== 'off' ? linesOf(b, 'night') : [];
            if (lines.length) { b.lastTalk = performance.now(); playSound('chat', 1, false, b.rec); b.speak(fillPet(lines[Math.floor(Math.random() * lines.length)], a)); }
            else fx(b, NIGHT_FX[kindOf(b, '')] ?? '…', 'tavvy-fx-small');
        }
        if (Math.random() < chance(b, 'napwith', NAP_P[kindOf(b, '')] ?? 0.1)) setTimeout(() => b.startNapWith(a), said ? 1800 : 400);
    }
}

/** 먼저 달려가기: who got to the new reply first (under it — most replies are too tall to climb). */
let race = null;                         // { el, who: Set, ran: Set, first, till }
const RACE_TIME = 25;                    // s — a race nobody finishes is forgotten after this

function raceLand(a, el) {
    const rc = race;
    if (!rc || rc.el !== el || !rc.who.has(a)) return;
    if (performance.now() > rc.till) { race = null; return; }
    rc.who.delete(a);
    if (!rc.first) { rc.first = a; fx(a, '!'); a.sq = 0.85; }
    else fx(a, RACE_LATE[kindOf(a, '')] ?? '…', 'tavvy-fx-small');
    if (!rc.who.size) race = null;
}

/* =====================================================================
 * Food (stage 4) — counting, the bowl, sparkles, backups
 * ===================================================================== */

const EATABLE = ['idle', 'walk', 'eat', 'look', 'wait', 'watch', 'perch', 'edge', 'me', 'peekin', 'follow', 'fidget', 'read', 'stare', 'where', 'skid', 'toy'];

/** "2026-11-12" — the day starts at 6 a.m. */
function dayKey(t = Date.now()) {
    const d = new Date(t - DAY_START_H * 3600e3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The pet's "today" record, reset when the day has changed. */
function rollToday(rec) {
    const day = dayKey();
    rec.today ??= { day: null, eaten: 0, full: false, tokens: 0 };
    if (rec.today.day !== day) { rec.today.day = day; rec.today.eaten = 0; rec.today.full = false; rec.today.tokens = 0; }
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
    const pl = notePlace(rec);                                          // 0.10.9 함께한 곳: messages eaten at this home
    if (pl) pl.n = (pl.n || 0) + take.n;
    e.me = (e.me || 0) + take.me; e.them = (e.them || 0) + take.them; e.tokens = (e.tokens || 0) + take.tokens;
    b.me = 0; b.them = 0; b.tokens = 0;
    const t = rollToday(rec);
    const wasFull = t.full || t.eaten >= FULL_AT;
    t.eaten += take.n;
    t.tokens = (t.tokens || 0) + take.tokens;
    const j = rec.journal;                                              // 0.10.5: the day it ate the most (counted from this version on)
    if (j && t.tokens > (j.best?.tokens || 0)) j.best = { day: t.day, tokens: t.tokens, n: t.eaten };
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
    const from = { me: plats.filter(p => p.user).map(p => p.el), them: plats.filter(p => !p.user && !p.panel).map(p => p.el) };   // 0.11.17: not from windows
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
        const data = JSON.stringify({ tavvyBackup: 1, formatVersion: FORMAT_VERSION, day, savedAt: Date.now(), pets: root.pets, duets: root.duets || {} });
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
    if (!f) return say(LX('백업을 골라 주세요.', 'Choose a backup.'));
    if (!(await confirmBox(LX(`${day} 백업으로 되돌릴까요? 지금 펫 기록이 그날 기록으로 바뀌어요.`, `Restore the ${day} backup? Your current pet data will be replaced with that day’s.`)))) return;
    let data;
    try {
        const res = await fetch(imgUrl(f.path), { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        data = await res.json();
    } catch (e) {
        return say(LX('백업 파일을 읽지 못했어요: ', 'Couldn’t read the backup file: ') + (e.message || e));
    }
    if (!data || data.tavvyBackup !== 1 || !Array.isArray(data.pets) || typeof data.formatVersion !== 'number' || data.formatVersion > FORMAT_VERSION) {
        return say(LX('백업 파일 모양이 이상해서 되돌리지 않았어요.', 'The backup file looks wrong, so nothing was restored.'));
    }
    sleepInstant();
    root.pets = data.pets;
    if (data.duets && typeof data.duets === 'object') root.duets = data.duets;   // 0.10.8 (older backups have none: keep today's)
    migrate(root);
    const ok = await saveNow();
    refreshBed();
    renderPanel();
    say(ok ? LX(`${day} 백업으로 되돌렸어요.`, `Restored the ${day} backup.`) : LX('되돌렸지만 저장하지 못했어요. 페이지를 새로고침하기 전에 다시 시도해 주세요.', 'Restored, but couldn’t save. Try again before reloading the page.'));
}

/* =====================================================================
 * Bed button (wake / sleep / drag)
 * ===================================================================== */

let bed = null;
let bedBusy = false;
const BED_SIZE = 37;

function ensureBed() {
    if (bed) return bed;
    bed = document.createElement('div');
    bed.id = 'tavvy-bed';
    bed.title = LX('Tavvy — 톡: 깨우기/재우기 · 끌기: 옮기기', 'Tavvy — tap: wake / sleep · drag: move');
    bed.innerHTML = '<span class="tavvy-bed-icon">🛏️</span><span class="tavvy-bed-z">z</span><span class="tavvy-bed-badge" hidden></span><span class="tavvy-bed-gift" hidden>🎁</span>';
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

/** Entering a room: a special day (today, or missed within a week) → "할 말이 있어!";
 *  otherwise, after REVISIT_DAYS or more away, the one that waited longest says so. */
function revisitBubble() {
    if (actors.length) return;
    const talky = residents().filter(p => pendingDays(p).length);
    if (talky.length) {
        showBubble(residents().length > 1 ? `${talky.map(p => p.name).join(', ')}${LX(': 할 말이 있어!', ': has something to say!')}` : LX('할 말이 있어!', 'Something to say!'), 12000);
        bubble?.classList.add('tavvy-bubble-special');
        return;
    }
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
    const line = (REVISIT_LINES[kindOf(best, 'wake')] || REVISIT_LINES.aegyo)(n);
    showBubble(residents().length > 1 ? `${best.name}: ${line}` : line);
}

/* ---------- special days (birthdays, anniversaries, the day we met) ---------- */

const pad2 = (n) => String(n).padStart(2, '0');

/** "MM-DD" in a given year as a day key (Feb 29 → Feb 28 in other years). */
function occurrence(md, year) {
    let [m, d] = String(md).split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (m === 2 && d === 29 && !leap) d = 28;
    return `${year}-${pad2(m)}-${pad2(d)}`;
}

/** This pet's special days that are today — or were missed in the last few days — and not celebrated yet. */
function pendingDays(rec) {
    const today = dayKey();
    const y = Number(today.slice(0, 4));
    const list = [];
    if (rec.metOn !== false) {
        const met = dayKey(rec.createdAt || Date.now());
        list.push({ id: 'met', kind: 'met', md: met.slice(5), since: met });
    }
    for (const d of rec.dates || []) {
        if (d && DATE_KINDS[d.kind] && /^\d\d-\d\d$/.test(d.md || '')) list.push({ id: d.id, kind: d.kind, md: d.md, msg: d.msg });
    }
    const out = [];
    for (const it of list) {
        let occ = occurrence(it.md, y);
        if (occ > today) occ = occurrence(it.md, y - 1);
        const late = daysBetween(occ, today);
        if (late < 0 || late >= LATE_DAYS) continue;
        if (it.since && occ <= it.since) continue;                 // not the very day we met
        if (rec.celebrated?.[it.id] === occ) continue;             // once a day
        const n = it.kind === 'met' ? Number(occ.slice(0, 4)) - Number(it.since.slice(0, 4)) : 0;
        const lines = SPECIAL_LINES[it.kind];
        let text = String(it.msg || '').trim() || (lines[kindOf(rec, 'wake')] || lines.aegyo).replace('{n}', n);
        if (late > 0) text = LX('늦었지만… ', 'A bit late, but… ') + text;
        out.push({ id: it.id, occ, late, text });
    }
    return out;
}

function markCelebrated(rec, days) {
    if (!rec.celebrated || typeof rec.celebrated !== 'object') rec.celebrated = {};
    for (const d of days) rec.celebrated[d.id] = d.occ;
    saveNow();
    renderPanel();
}

/* ---------- closeness went up: banner + coloured ✦ ---------- */
const CHEER_COLORS = ['#ff7eb6', '#ffd23f', '#6fc3ff', '#8be07a'];

function showCheer(a, from, to) {
    const top = stage.floorY - a.y - a.h;
    const el = document.createElement('div');
    el.className = 'tavvy-cheer';
    const mode = root?.settings?.heartMode || 'both';
    const fresh = unlocksFor(a.rec).filter(u => u.lv > from && u.lv <= to);
    el.innerHTML = LX('<b>친밀도 상승!</b>', '<b>Closer now!</b>') + (mode === 'hide' ? '' : `<span>${esc(levelLabel(a.rec, from))} → ${esc(levelLabel(a.rec, to))}</span>`)
        + (fresh.length ? `<span class="tavvy-cheer-new">${LX('새로운 행동을 할 수 있게 되었어요!', 'It learned something new!')}</span><small>${fresh.map(u => esc(u.name)).join(' · ')}</small>` : '');
    ensureLayer().appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    const x = clamp(a.x - w / 2, 4, Math.max(4, stage.vw - w - 4));
    const y = clamp(top - h - 22, 4, Math.max(4, stage.vh - h - 4));
    el.style.left = (x - stage.ox) + 'px';
    el.style.top = (y - stage.oy) + 'px';
    setTimeout(() => el.remove(), 4200);
    burstStars(a);
}

/** Coloured ✦ bursting out around the pet (closeness up, special days). */
function burstStars(a) {
    playSound('cheer', 1, false, a.rec);
    const top = stage.floorY - a.y - a.h;
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
    const who = residents().filter(p => bowlCount(p) > 0 && can(p, 'bedWiggle'));
    if (!who.length) return;
    wiggleAt = now + rand(...WIGGLE_GAP) * 1000 / Math.max(...who.map(p => fr(p, 'bedWiggle')));
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
        if (a.held || a.air || a.waiting) continue;
        if (a.state === 'stare' || a.go?.k === 'stare') continue;                     // already watching you write
        if (start && ['idle', 'walk', 'perch', 'fidget', 'read'].includes(a.state) && !a.wallOn && Math.random() < chance(a, 'stare', STARE_CHANCE)) { a.startStare(); continue; }   // 0.9.0 글 쓰면 빤히
        if (!can(a, 'peekInput')) continue;
        if (!start && now < a.peekInNext) continue;
        a.peekInNext = now + rand(...PEEKIN_GAP) * 1000;
        const k = kindOf(a, 'me');
        const okState = ['idle', 'walk', 'perch', 'fidget'].includes(a.state) || (a.state === 'doze' && k === 'neugut');
        if (!okState || Math.random() >= chance(a, 'peekInput', start ? PEEKIN_CHANCE : PEEKIN_AGAIN)) continue;
        if (k === 'musim') { if (a.peekInSession === typing.session) continue; a.peekInSession = typing.session; }
        a.startPeekIn();
    }
}

/** Middle of the input box (or of the chat). */
function inputX() {
    const r = $id('send_textarea')?.getBoundingClientRect();
    return r && r.width > 0 ? (r.left + r.right) / 2 : (stage.left + stage.right) / 2;
}
/** 졸졸 따라다니기 (0.9.3): you tapped at x → pets with it on walk over that way (on what they stand on). */
function clingTap(x) {
    for (const a of actors) {
        if (!a.free() || a.waiting || a.wallOn || a.go || a.gait) continue;
        if (!['idle', 'walk', 'perch', 'fidget', 'read', 'look', 'edge'].includes(a.state)) continue;
        if (Math.random() >= chance(a, 'cling', CLING_TAP)) continue;
        const [L, R] = a.range();
        if (R - L < 10) continue;
        const tx = clamp(x + rand(-20, 20), L, R);
        if (Math.abs(tx - a.x) < 24) continue;
        if (Math.random() < 0.4) fx(a, '!', 'tavvy-fx-small');
        a.walkTo(tx);
    }
}

/** Back after WHERE_AWAY minutes or more away from this screen: …어디 갔었어? */
function whereAll() {
    for (const a of actors) {
        if (!a.free() || a.waiting || a.wallOn || a.go) continue;
        if (!['idle', 'walk', 'perch', 'fidget', 'read', 'doze'].includes(a.state)) continue;
        if (Math.random() < chance(a, 'where', WHERE_CHANCE)) a.startWhere();
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
        if (a.idleTried || !can(a, 'dozeWait') || !a.free() || a.waiting || !['idle', 'walk', 'perch', 'doze', 'fidget'].includes(a.state)) continue;
        a.idleTried = true;
        if (Math.random() >= chance(a, 'dozeWait', IDLE_DOZE_CHANCE)) continue;
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
    const gm = bed.querySelector('.tavvy-bed-gift');                 // 0.10.0: a present waiting for it
    if (gm) gm.hidden = actors.length > 0 || !here.some(p => (p.gifts || []).some(g => g?.fresh));
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
            const sp = pendingDays(rec);
            a.special = sp.length ? sp : null;       // a special day → a little party before anything else
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
    if (actors.length) { playSound('sleep', 1, false, actors[0].rec); sleepAll(); }
    else if (!bedBusy && residents().length) { playSound('wake', 1, false, residents()[0]); wakeAll(); }
}

/* =====================================================================
 * Replies: waiting, watching, seeing off my message
 * ===================================================================== */

// target = the message being written ("…" box / streaming reply), when there is one on screen
const gen = { active: false, type: '', startLen: 0, t0: 0, firstToken: false, late: false, target: null };
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
    gen.late = false;
    gen.target = null;
    for (const a of actors) a.restless = false;
    if (gen.type === 'regenerate') setTimeout(() => notice('regen'), 300);   // 0.11.17
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
    gen.endAt = performance.now();
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
    if (['normal', undefined, '', 'regenerate', 'swipe', 'continue'].includes(type) && room) {     // 0.10.7 답 도착: asleep too
        const rm = ctx().chat?.[id];
        const pet = actors[0]?.rec || residents()[0];
        if (pet && rm && !rm.is_user && !rm.is_system) playSound('reply', 1, false, pet);
    }
    if (!actors.length || !['normal', undefined, '', 'regenerate', 'swipe'].includes(type)) return;
    const m = ctx().chat?.[id];
    if (!m || m.is_user) return;
    setTimeout(() => { for (const a of actors) if (canChat(a)) a.talk('reply'); }, 700);   // "오, 왔다!"
    if (String(m.mes || '').length < WATCH_MIN_CHARS) return;
    const key = `${id}:${m.swipe_id ?? 0}:${String(m.mes).length}`;
    if (watched.has(key)) return;
    watched.add(key);
    setTimeout(() => {                      // after it is drawn
        const el = msgEl(id);
        if (!el) return;
        measurePlats();
        let go = actors.filter(a => !(a.state === 'watch' && a.plat === el) && Math.random() < byCloseness(a, 0.3, 0.85));
        const runners = actors.filter(a => fr(a, 'race') > 0 && !a.plat && !a.wallOn && (a.free() || eaters.includes(a)) && canChat(a) && a.state !== 'doze' && !a.waiting);   // 0.10.12 먼저 달려가기
        if (runners.length > 1 && Math.random() < RACE_P * Math.min(...runners.map(a => fr(a, 'race')))) {   // a race: everyone who can, goes
            race = { el, who: new Set(runners), ran: new Set(), first: null, till: performance.now() + RACE_TIME * 1000 };
            go = [...new Set([...go, ...runners])];
        }
        for (const a of go) {
            if (eaters.includes(a)) a.afterMeal = el;                      // eat it first, then go and look
            else a.watchReply(el);
        }
    }, 250);
}

/** Awake enough to say something about a message (not napping, not going to bed). */
const canChat = (a) => !['off', 'doze', 'sleepy', 'tuck', 'wave', 'appear'].includes(a.state);

/* ---------- 0.11.17 알아보고 말하기: what you do in SillyTavern ---------- */

const noticeAt = new Map();      // moment → when last said (performance.now)
const leftAt = new Map();        // pet id → when you left its room (Date.now; not saved)

/** One pet (at random, awake) may say something about it — not the same thing twice within NOTICE_REST. */
function notice(moment, opt = null) {
    if (!actors.length || document.hidden) return false;
    const now = performance.now();
    if (now - (noticeAt.get(moment) ?? -1e9) < NOTICE_REST * 1000) return false;
    const who = actors.filter(a => canChat(a) && !a.held);
    if (!who.length) return false;
    const a = who[Math.floor(Math.random() * who.length)];
    if (!a.talk(moment, false, opt)) return false;
    noticeAt.set(moment, now);
    return true;
}

/** Woken just after coming back from another room (within BACK_MIN). Asks once. */
function backSoon(rec) {
    const t = leftAt.get(rec.id);
    leftAt.delete(rec.id);
    return typeof t === 'number' && Date.now() - t < BACK_MIN * 60000;
}

/** A menu in the top bar opened. */
function watchMenus() {
    for (const [id, key] of Object.entries(MENU_DRAWERS)) {
        const el = $id(id)?.querySelector('.drawer-content');
        if (!el || el.dataset.tavvyWatch) continue;
        el.dataset.tavvyWatch = '1';
        let open = el.classList.contains('openDrawer');
        new MutationObserver(() => {
            const now = el.classList.contains('openDrawer');
            if (now && !open && ready) notice(key, { also: 'menu', menu: menuName(key) });
            open = now;
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    }
}

/** The chat scrolled: far up = reading old messages. */
let oldAway = false;
function onChatScroll(el) {
    const fromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (fromBottom < el.clientHeight) { oldAway = false; return; }
    if (oldAway || fromBottom <= el.clientHeight * OLD_SCREENS) return;
    oldAway = true;                                   // once per trip up
    notice('old');
}

/** The input box changed: erasing a lot, or writing a long time without sending. */
const writing = { len: 0, start: 0, said: false, dels: [] };
function onWriting(value) {
    const now = Date.now(), len = String(value || '').length;
    if (!len) { writing.len = 0; writing.start = 0; writing.said = false; writing.dels = []; return; }   // sent / cleared (not counted)
    if (!writing.start) writing.start = now;
    if (len < writing.len) {
        writing.dels.push([now, writing.len - len]);
        writing.dels = writing.dels.filter(d => now - d[0] < RETYPE_WIN * 1000);
        if (writing.dels.reduce((s, d) => s + d[1], 0) > RETYPE_DEL && notice('retype')) writing.dels = [];
    }
    writing.len = len;
    if (!writing.said && now - writing.start > RETYPE_LONG * 1000) writing.said = notice('retype') || writing.said;
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
            if (!a.free() || a.state === 'doze' || Math.random() >= byCloseness(a, 0.3, 0.85)) continue;
            a.after = a.state === 'perch' ? 'idle' : a.waiting ? 'wait' : 'idle';
            a.startLook(persOf(a, 'send').send, x);
        }
        if (String(ctx().chat?.[id]?.mes || '').length > LONG_SEND && notice('long')) return;   // 0.11.17 아주 긴 글
        for (const a of actors) if (canChat(a)) a.talk('sent');
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
    if (next && root) {                                           // 0.11.5: renamed or a copy? (asks only when it matters)
        await checkCopies(next);
        if (!sameRoom(readRoom(), next)) return;                  // moved on meanwhile — that change handles it
    }
    // A change to "no chat" can be a passing moment while the chat reloads → look again shortly.
    clearTimeout(roomRetry);
    if (!next) roomRetry = setTimeout(recheckRoom, 800);

    if (room && root) { const t = Date.now(); for (const p of residents()) leftAt.set(p.id, t); }   // 0.11.17 돌아오기
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
            if (res.here) { prevVisit.set(p.id, p.lastVisit); p.lastVisit = now; notePlace(p); }
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

/* =====================================================================
 * The Tavvy window — pets, journal, looks and settings in one place.
 * Opened from the wand menu ("펫 정보") or the button in the extension settings.
 * ===================================================================== */

const $id = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const THEMES = { theme: LX('테마 따르기', 'Follow theme'), cream: LX('크림·분홍', 'Cream · pink'), white: LX('하얀 깔끔', 'Clean white'), night: LX('밤하늘', 'Night sky') };

/** The extension settings drawer is only a door to the window now. */
function panelHtml() {
    return `
<div class="tavvy-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>${LX('Tavvy (태비)', 'Tavvy')}</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div id="tavvy-warn" class="tavvy-warn" hidden></div>
      <div id="tavvy-room" class="tavvy-note"></div>
      <div id="tavvy-open" class="menu_button"><i class="fa-solid fa-paw"></i> ${LX('Tavvy 열기', 'Open Tavvy')}</div>
      <div class="tavvy-note">${LX('펫 목록, 기록장, 새 펫 만들기, 설정이 모두 이 창 안에 있어요. 입력창 왼쪽 ✨ 마법봉 메뉴의', 'The pet list, journal, new pets, and settings are all in this window. You can also open it from')} "${LX('펫 정보', 'Pet info')}"${LX('로도 열 수 있어요.', ' in the ✨ wand menu left of the input box.')}</div>
    </div>
  </div>
</div>`;
}

function bindPanel() {
    const host = $id('extensions_settings') || $id('extensions_settings2');   // 0.11.1: left column first
    if (!host) return;
    host.insertAdjacentHTML('beforeend', panelHtml());
    $id('tavvy-open').addEventListener('click', () => openWin('home'));
}

/** Diagnostic: bring the bed to the middle of the screen and report what the page sees. */
function findBed() {
    measure();
    refreshBed();
    const lines = [];
    lines.push(`${LX('준비:', 'Ready:')} ${ready ? LX('됨', 'yes') : LX('안 됨', 'no')} ${LX('· 이 방 펫:', '· pets in this room:')} ${residents().length}`);
    lines.push(`${LX('화면', 'Screen')} ${Math.round(stage.vw)}×${Math.round(stage.vh)} ${LX('· 바닥', '· floor')} ${Math.round(stage.floorY)} · ${device()}`);
    lines.push(`${LX('채팅 윗선', 'Chat top')} ${Math.round(stage.chatTop)} ${LX('· 보이는 발판', '· visible ledges')} ${plats.length} · ${isBubbleChat() ? LX('말풍선', 'bubbles') : LX('줄 모양', 'lines')} ${LX('· 무대', '· stage')} ${stageIsChat() ? LX('채팅창 전체', 'whole chat') : LX('바닥만', 'floor only')}`);
    // room / home keys, shortened so character names are not shown
    const key = (chatId, integ) => {
        const id = String(chatId || '');
        const tail = id.includes(' - ') ? id.slice(id.lastIndexOf(' - ') + 3) : id.slice(-20);
        return `…${tail || LX('(없음)', '(none)')} / ${integ ? String(integ).slice(0, 6) : LX('(번호 없음)', '(no number)')}`;
    };
    const live = readRoom();
    lines.push(`${LX('지금 방:', 'Current room:')} ${live ? key(live.chatId, live.integrity) + (live.branch ? LX(' · 분기', ' · branch') : '') : LX('없음', 'none')}`);
    lines.push(`${LX('기억한 방:', 'Remembered room:')} ${room ? key(room.chatId, room.integrity) : LX('없음', 'none')}`);
    for (const p of root?.pets || []) lines.push(`${p.name}${LX('의 집:', '’s home:')} ${p.home ? key(p.home.chatId, p.home.integrity) : LX('집 없음', 'no home')}`);
    if (!bed) {
        lines.push(LX('침대 버튼: 만들어지지 않음', 'Bed button: not created'));
    } else {
        const x = Math.round(stage.vw / 2 - BED_SIZE / 2), y = Math.round(stage.vh / 2 - BED_SIZE / 2);
        bed.style.transform = `translate3d(${x - stage.ox}px, ${y - stage.oy}px, 0)`;   // temporary, not saved
        bumpBed();
        const r = bed.getBoundingClientRect();
        const cs = getComputedStyle(bed);
        const ls = getComputedStyle(layer);   // layer is a 0×0 anchor on purpose
        lines.push(`${LX('침대 버튼:', 'Bed button:')} ${bed.hidden ? LX('숨김', 'hidden') : LX('보임', 'shown')} · ${cs.display} ${LX('· 투명도', '· opacity')} ${cs.opacity} ${LX('· 위치', '· position')} ${Math.round(r.left)},${Math.round(r.top)} ${LX('크기', 'Size')} ${Math.round(r.width)}×${Math.round(r.height)}`);
        const lr = layer.getBoundingClientRect();
        lines.push(`${LX('무대:', 'Stage:')} ${ls.display} · z ${ls.zIndex} · ${Math.round(lr.left)},${Math.round(lr.top)} ${Math.round(lr.width)}×${Math.round(lr.height)} ${LX('· 부모', '· parent')} ${layer.parentElement?.tagName}`);
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const desc = top ? (top.id ? '#' + top.id : top.tagName.toLowerCase() + (top.className && typeof top.className === 'string' ? '.' + top.className.split(' ')[0] : '')) : LX('없음', 'none');
        lines.push(`${LX('그 자리 맨 위:', 'Topmost there:')} ${desc}`);
        lines.push(LX('창을 닫고 화면 가운데에 🛏️ 가 보이는지 확인해 주세요.', 'Close this window and check that 🛏️ shows in the middle of the screen.'));
    }
    const d = $id('tavvy-diag');
    if (d) d.textContent = lines.join('\n');
}

/** A short message at the bottom of whatever the window shows. */
function say(text) {
    const m = win?.body.querySelector('.tw-pane:not([hidden]) .tw-msg') || win?.body.querySelector('.tw-msg');
    if (m) m.textContent = text;
}

function homeLabel(p) {
    if (!p.home) return LX('집 없음', 'no home');
    if (room && checkHome(p, room).here) return LX('이 방', 'This room');
    return LX('다른 방', 'Another room');
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
    return `px${isSharp(p, size) ? LX(' ✦선명', ' ✦sharp') : ''}${size === DEFAULT_SIZE[device()] ? LX(' (기본)', ' (default)') : ''} · ${SIZE_MIN}~${SIZE_MAX}`;
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

/* ---------- saved looks (내가 올린 외형) — a picture uploaded once can be picked again ---------- */

function lookFiles(l) {
    const out = [];
    for (const list of Object.values(l?.roles || {})) for (const f of list || []) if (f && !f.startsWith('builtin:')) out.push(f);
    return out;
}

/** Is this server file still used by a pet (other than `except`) or kept in the look library? */
function fileInUse(path, except = null) {
    return (root?.pets || []).some(p => p !== except && petFiles(p).includes(path))
        || (root?.looks || []).some(l => lookFiles(l).includes(path))
        || (root?.settings?.replyFiles || []).some(f => f?.path === path);     // 0.10.11 답 도착 내 소리
}

/** Pets wearing this saved look. */
function lookUsers(l) {
    const files = lookFiles(l);
    return (root?.pets || []).filter(p => petFiles(p).some(f => files.includes(f)));
}

/** "builtin:bori" / "lib:<id>" / "other" — what a pet is wearing now. */
function lookKeyOf(p) {
    const first = p.look?.roles?.idle?.[0] || '';
    if (first.startsWith('builtin:')) return 'builtin:' + first.slice(8).split('/')[0];
    const l = (root?.looks || []).find(x => x.roles?.idle?.[0] === first);
    return l ? 'lib:' + l.id : 'other';
}

function lookById(key) {
    if (!key) return null;
    if (key.startsWith('builtin:')) {
        const k = key.slice(8);
        return BUILTIN[k] ? { key, name: BUILTIN[k].name, src: `${BASE}assets/pets/${k}/idle.png`, facing: BUILTIN[k].facing, squish: 0.5, make: () => builtinLook(k) } : null;
    }
    if (key.startsWith('lib:')) {
        const l = (root?.looks || []).find(x => x.id === key.slice(4));
        return l ? {
            key, name: l.name, src: imgUrl(l.roles?.idle?.[0]), facing: l.facing || 'front', squish: l.squish ?? 0.5,
            make: () => ({ kind: l.kind || 'single', facing: l.facing || 'front', roles: structuredClone(l.roles), roleOpts: structuredClone(l.roleOpts || {}), baseline: l.baseline || 0, size: { ...DEFAULT_SIZE }, squish: l.squish ?? 0.5 }),
        } : null;
    }
    return null;
}

/** Tiles: built-in pets, then my saved looks, then "새로 올리기". */
function lookGridHtml(selected, current = null) {
    const tile = (key, src, name, del = '') =>
        `<div class="tw-look${selected === key ? ' tw-on' : ''}" data-look="${esc(key)}"><div class="tw-look-img">${src ? `<img src="${esc(src)}" alt="">` : ''}${current === key ? LX('<em>지금</em>', '<em>Now</em>') : ''}${del}</div><span>${esc(name)}</span></div>`;
    const builtins = Object.entries(BUILTIN).map(([k, v]) => tile('builtin:' + k, `${BASE}assets/pets/${k}/idle.png`, v.name)).join('');
    // 0.10.3: a saved look no pet wears can be thrown away right here (same as in ⚙)
    const mine = (root?.looks || []).map(l => tile('lib:' + l.id, imgUrl(l.roles?.idle?.[0]), l.name,
        lookUsers(l).length ? '' : `<i class="tw-lookdel" data-dellook="${esc(l.id)}" title="${LX('지우기', 'Delete')}">✕</i>`)).join('');
    return `<div class="tw-cap">${LX('기본 펫', 'Starter pets')}</div><div class="tw-looks">${builtins}</div>
<div class="tw-cap">${LX('내가 올린 외형', 'My uploaded looks')}</div><div class="tw-looks">${mine}<div class="tw-look tw-look-add${selected === 'upload' ? ' tw-on' : ''}" data-look="upload"><div class="tw-look-img"><i class="fa-solid fa-plus"></i></div><span>${LX('새로 올리기', 'Upload new')}</span></div></div>`;
}

const PIC_ACCEPT = 'image/png,image/jpeg,image/webp';

/** "배경 지우기" switch + strength bar (prefix '' = upload box, 'role' = 그림 tab). */
function bgHtml(prefix = '') {
    return `<label class="tw-check"><input type="checkbox" data-f="${prefix}bg" checked> ${LX('배경 지우기', 'Remove background')} <span class="tw-sub">${LX('(하얀색 같은 단색 배경)', '(a plain one-color background, like white)')}</span></label>
<div class="tw-bgrow" data-bgrow="${prefix}"><span class="tw-sub">${LX('조금', 'Less')}</span><input type="range" min="6" max="80" step="2" value="${BG_TOL}" data-f="${prefix}bgtol"><span class="tw-sub">${LX('많이', 'More')}</span></div>`;
}

/** Background strength chosen in the window (0 = off). */
function bgTolOf(prefix = '') {
    const on = win.body.querySelector(`[data-f="${prefix}bg"]`);
    if (on && !on.checked) return 0;
    return Number(win.body.querySelector(`[data-f="${prefix}bgtol"]`)?.value) || BG_TOL;
}

/** The upload box (new picture → also kept in the look library). */
function uploadHtml() {
    return `<div class="tw-upload" hidden>
  <input type="file" accept="${PIC_ACCEPT}" data-f="file">
  <div class="tw-row"><div class="tw-btn" data-act="pickfile"><i class="fa-solid fa-image"></i> ${LX('그림 고르기', 'Choose picture')}</div><span class="tw-sub tw-filename">${LX('아직 안 골랐어요', 'Nothing chosen yet')}</span></div>
  <div class="tw-row tw-prevrow" hidden><img class="tw-prev tw-checker" alt=""><div>
    <div class="tw-row"><div class="tw-btn tw-btn-small" data-act="cutopen"><i class="fa-solid fa-crop-simple"></i> ${LX('직접 자르기', 'Crop by hand')}</div><span class="tw-sub tw-cutnote"></span></div>
    <label class="tw-check"><input type="checkbox" data-f="crop" checked> ${LX('투명 여백 자르기', 'Trim transparent edges')}</label>
    ${bgHtml('')}
  </div></div>
  <div class="tw-sub">${LX('그림 한 장이면 돼요. 배경이 하얀색처럼 한 가지 색이면 알아서 지워요(미리보기에서 확인). 한 번 올리면', 'One picture is enough. A plain background like white is removed automatically (check the preview). Once uploaded, it stays in')} "${LX('내가 올린 외형', 'My uploaded looks')}"${LX('에 남아서 다음에 고르기만 하면 돼요.', ' so next time you can just pick it.')}</div>
  <div class="tw-row tw-uploadno"><div class="tw-btn tw-btn-small" data-act="uploadno">${LX('취소', 'Cancel')}</div></div>
</div>`;
}

function facingHtml() {
    return `<label class="tw-label">${LX('그림이 보는 쪽', 'Which way the picture faces')}
  <select data-f="facing">
    <option value="front">${LX('정면', 'Front')}</option>
    <option value="right">${LX('오른쪽을 봄', 'Faces right')}</option>
    <option value="left">${LX('왼쪽을 봄', 'Faces left')}</option>
  </select>
</label>
<div class="tw-sub">${LX('그림 한 장이 어느 쪽을 보는지예요. 반대쪽은 자동으로 뒤집어서 써요.', 'Which way a single picture faces. It’s flipped automatically for the other side.')}</div>
<label class="tw-label"><span>${LX('말랑 정도', 'Squishiness')} <span class="tw-squish-val"></span></span>
  <input type="range" data-f="squish" min="0" max="1" step="0.1">
</label>`;
}

/* ---------- journal pieces ---------- */

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

const MOMENT_NAMES = { firstFeast: LX('첫 잔칫상', 'First feast'), firstFull: LX('첫 배부름', 'First full tummy'), moved: LX('이사한 날', 'Moving day'), firstGift: LX('첫 선물 받은 날', 'First present') };

function togetherDays(p) {
    return daysBetween(dayKey(p.createdAt || Date.now()), dayKey()) + 1;
}

function journalMoments(p) {
    const today = dayKey();
    const met = dayKey(p.createdAt || Date.now());
    const moments = [{ day: met, name: LX('처음 만난 날', 'The day we met') }];
    for (const m of p.journal?.moments || []) {
        const r = /^level(\d)$/.exec(m?.kind || '');
        if (r) moments.push({ day: m.day, name: LX(`${josa(LEVELS[Number(r[1])]?.name || '?', '이', '가')} 된 날`, `Became ${LEVELS[Number(r[1])]?.name || '?'}`) });
        else if (MOMENT_NAMES[m?.kind]) moments.push({ day: m.day, name: MOMENT_NAMES[m.kind] });
    }
    if (togetherDays(p) >= 100) moments.push({ day: addDays(met, 99), name: LX('만난 지 100일', '100 days together') });
    for (let y = 1; y < 100; y++) {                                   // every year on the day we met
        const ann = met.replace(/^\d+/, (v) => String(Number(v) + y));
        if (ann > today) break;
        moments.push({ day: ann, name: LX(`만난 지 ${y}년`, `${y} year${y > 1 ? 's' : ''} together`) });
    }
    moments.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    return moments;
}

/** Words only, no numbers ("숫자 레벨 대신 보는 재미"). */
function nextStep(p) {
    const k = levelOf(p);
    if (k >= LEVELS.length - 1) return { pct: 100, text: LX('가장 친한 사이예요', 'As close as can be') };
    const a = LEVELS[k].min, b = LEVELS[k + 1].min;
    const r = clamp((petPoints(p) - a) / (b - a), 0, 1);
    const nm = LEVELS[k + 1].name;
    const text = r < 0.34 ? LX(`${nm}까지 천천히 가는 중`, `Slowly on the way to ${nm}`) : r < 0.67 ? LX(`${nm}까지 조금 더`, `A little more to ${nm}`) : LX(`${nm}까지 거의 다 왔어요`, `Almost at ${nm}`);
    return { pct: Math.max(4, Math.round(r * 100)), text };
}

function persName(p) {
    return PERSONALITIES[p.personality?.base]?.name || '?';
}

function heroHtml(p) {
    const mode = root?.settings?.heartMode || 'both';
    const L = LEVELS[levelOf(p)];
    const step = nextStep(p);
    const hearts = mode === 'hide' ? '' : `<div class="tw-hearts">${mode !== 'name' ? `<span class="tw-heart">${L.hearts}</span>` : ''}${mode !== 'hearts' ? ` <span>${L.name}</span>` : ''}</div>
<div class="tw-bar"><i style="width:${step.pct}%"></i></div><div class="tw-sub tw-center">${esc(step.text)}</div>`;
    return `<div class="tw-hero">
  <div class="tw-hero-img"><img src="${esc(imgUrl(p.look?.roles?.idle?.[0]))}" alt=""></div>
  <div class="tw-hero-name">${esc(p.name)} <span class="tw-chip">${esc(persName(p))}</span></div>
  <div class="tw-sub tw-center">${esc(homeLabel(p))}</div>
  ${hearts}
</div>`;
}

const tokWords = (tok) => (tok >= 10000 ? LX(`약 ${(Math.round(tok / 1000) / 10).toLocaleString()}만`, `about ${Math.round(tok / 1000).toLocaleString()}k`) : `${LX('약', 'about')} ${tok.toLocaleString()}`);

/** 0.10.5 가장 많이 먹은 날 (counted from 0.10.5 on). */
function bestTile(b) {
    if (!b?.day) return `<div class="tw-tile tw-tile-wide"><span>${LX('가장 많이 먹은 날', 'Biggest meal day')}</span><b>${LX('아직 없어요', 'Not yet')}</b><small>${LX('이번 업데이트부터 세기 시작해요', 'Counting starts from this update')}</small></div>`;
    const [y, m, d] = b.day.split('-').map(Number);
    const date = dateText(y, m, d);
    return `<div class="tw-tile tw-tile-wide"><span>${LX('가장 많이 먹은 날', 'Biggest meal day')}</span><b>${esc(date)}</b><small>${LX('그날', 'That day')} ${esc(tokWords(b.tokens))} ${LX('토큰 · 메시지', 'tokens ·')} ${Number(b.n) || 0}${LX('개', ' messages')}</small></div>`;
}

function journalHtml(p) {
    const e = p.eaten || {}, j = p.journal || {};
    const tile = (label, value, sub = '') => `<div class="tw-tile"><span>${label}</span><b>${esc(value)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    const tokText = tokWords(e.tokens || 0);
    return `<div class="tw-tiles">
  ${tile(LX('함께한 지', 'Together'), LX(`${togetherDays(p)}일째`, `Day ${togetherDays(p)}`))}
  ${tile(LX('대화한 날', 'Days chatted'), `${j.talkDays || 0}${LX('일', '')}`)}
  ${tile(LX('주고받은 메시지', 'Messages exchanged'), `${(e.me || 0) + (e.them || 0)}`, `${LX('나', 'you')} ${e.me || 0} ${LX('· 상대', '· them')} ${e.them || 0}`)}
  ${tile(LX('먹은 토큰', 'Tokens eaten'), tokText)}
  ${bestTile(j.best)}
</div>
<div class="tw-cap">${LX('기념 순간', 'Milestones')}</div>
<div class="tw-moments">${journalMoments(p).map(m => `<div><span>${esc(m.day)}</span><b>${esc(m.name)}</b></div>`).join('')}</div>`;
}

/* ---------- 0.10.9 함께한 곳: the homes a pet has lived in (기록 탭) — the character there, how long, messages eaten ---------- */
const PLACE_MAX = 100;
const PLACE_NAME = 30;
const PLACE_MEMO = 100;

/** Who lives in the chat open now: the character (or the group) name. */
function roomCharName() {
    const c = ctx();
    if (c.groupId) {
        const g = (c.groups || []).find(x => String(x.id) === String(c.groupId));
        return { name: String(g?.name || LX('그룹 채팅', 'Group chat')).slice(0, PLACE_NAME), grp: true };
    }
    return { name: String(c.name2 || '').slice(0, PLACE_NAME), grp: false };
}

const sameAt = (a, b) => !!a && !!b && (a.integrity && b.integrity ? a.integrity === b.integrity : a.chatId === b.chatId);

/** The pet's place for its home right now (made when it is home and has none yet). */
function notePlace(p) {
    if (!p?.home || !Array.isArray(p.places)) return null;
    let pl = p.places.find(x => x.at && !x.to && sameAt(x.at, p.home));
    if (pl) {
        if (pl.at.chatId !== p.home.chatId) pl.at = { chatId: p.home.chatId, integrity: p.home.integrity || '' };   // renamed chat
        return pl;
    }
    if (!room || !checkHome(p, room).here) return null;     // only while it is home (so the name is the right one)
    const today = dayKey();
    for (const x of p.places) if (x.at && !x.to) x.to = today;   // it moved: the old home ends today
    const who = roomCharName();
    pl = { id: 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: who.name || LX('이름 없는 곳', 'Unnamed place'), grp: who.grp,
        from: today, to: null, n: 0, memo: '', at: { chatId: p.home.chatId, integrity: p.home.integrity || '' } };
    p.places.push(pl);
    if (p.places.length > PLACE_MAX) p.places.splice(0, p.places.length - PLACE_MAX);
    saveSoon();
    return pl;
}

function placeDate(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '';
    const [y, m, dd] = d.split('-').map(Number);
    return dateText(y, m, dd);
}

function placeDays(from) {
    const a = Date.parse(from + 'T00:00:00'), b = Date.parse(dayKey() + 'T00:00:00');
    return Number.isFinite(a) && b >= a ? Math.round((b - a) / 864e5) + 1 : 0;
}

function placeCard(p, pl) {
    const here = pl.at && !pl.to && sameAt(pl.at, p.home);
    if (win.placeEdit === pl.id) return placeForm(pl);
    const when = pl.to ? `${placeDate(pl.from)} ~ ${placeDate(pl.to)}` : pl.from ? LX(`${placeDate(pl.from)}부터 · ${placeDays(pl.from)}일째`, `since ${placeDate(pl.from)} · day ${placeDays(pl.from)}`) : '';
    const bits = [when, pl.at || pl.n ? `${LX('먹은 메시지', 'Messages eaten:')} ${pl.n || 0}` : ''].filter(Boolean).join(' · ');
    return `<div class="tw-place${here ? ' tw-place-here' : ''}">
  <div class="tw-place-top"><b>${esc(pl.name || LX('이름 없는 곳', 'Unnamed place'))}${pl.grp ? LX(' <small>(그룹)</small>', ' <small>(group)</small>') : ''}</b>${here ? LX('<span class="tw-place-tag">지금 집</span>', '<span class="tw-place-tag">Current home</span>') : ''}<span class="tw-place-edit" data-act="placeedit" data-pl="${esc(pl.id)}"><i class="fa-solid fa-pen"></i> ${LX('고치기', 'Edit')}</span></div>
  ${bits ? `<div class="tw-sub">${esc(bits)}</div>` : ''}
  ${pl.memo ? `<div class="tw-place-memo">${esc(pl.memo)}</div>` : ''}
</div>`;
}

function placeForm(pl) {
    const neu = !pl.id;
    return `<div class="tw-place tw-place-form" data-plform="${esc(pl.id || 'new')}">
  <label class="tw-label">${LX('이름', 'Name')} <input data-pf="name" maxlength="${PLACE_NAME}" value="${esc(pl.name || '')}" placeholder="${LX('캐릭터나 방 이름', 'Character or room name')}"></label>
  <div class="tw-place-dates">
    <label class="tw-label">${LX('처음', 'From')} <input type="date" data-pf="from" value="${esc(pl.from || '')}"></label>
    ${pl.at && !pl.to ? '' : `<label class="tw-label">${LX('마지막', 'To')} <input type="date" data-pf="to" value="${esc(pl.to || '')}"></label>`}
  </div>
  ${pl.at && !pl.to ? LX('<div class="tw-sub">지금 사는 곳이라 마지막 날은 없어요(이사하면 그날로 적혀요).</div>', '<div class="tw-sub">It lives here now, so there’s no end date (moving fills it in).</div>') : ''}
  <label class="tw-label">${LX('메모', 'Notes')} <textarea data-pf="memo" rows="2" maxlength="${PLACE_MEMO}" placeholder="${LX('이곳에서 있었던 일', 'What happened here')}">${esc(pl.memo || '')}</textarea></label>
  <div class="tw-place-btns">
    <div class="tw-btn tw-btn-main" data-act="placesave">${LX('저장', 'Save')}</div>
    ${neu ? '' : LX('<div class="tw-btn" data-act="placedel">빼기</div>', '<div class="tw-btn" data-act="placedel">Remove</div>')}
    <div class="tw-btn" data-act="placecancel">${LX('취소', 'Cancel')}</div>
  </div>
</div>`;
}

/** The 함께한 곳 list (not a live part: a form being filled in must not be redrawn under your fingers). */
function drawPlaces() {
    const box = win?.body.querySelector('[data-pane="journal"] .tw-places');
    const p = curPet();
    if (!box || !p) return;
    notePlace(p);
    const list = (p.places || []).filter(x => !x.hide).slice().sort((a, b) => (!a.to) - (!b.to) || String(b.to || b.from || '').localeCompare(String(a.to || a.from || '')));
    list.sort((a, b) => ((!b.to && b.at) ? 1 : 0) - ((!a.to && a.at) ? 1 : 0));   // the home it lives in now first
    box.innerHTML = `<div class="tw-cap">${LX('함께한 곳', 'Places together')}</div>
  ${list.map(pl => placeCard(p, pl)).join('')}
  ${win.placeEdit === 'new' ? placeForm({ name: '', from: '', to: '', memo: '' }) : LX('<div class="tw-btn tw-btn-small tw-wide" data-act="placeadd"><i class="fa-solid fa-plus"></i> 직접 넣기</div>', '<div class="tw-btn tw-btn-small tw-wide" data-act="placeadd"><i class="fa-solid fa-plus"></i> Add by hand</div>')}
  <div class="tw-sub">${LX('사는 방마다 자동으로 적혀요(0.10.9부터). 그 전 일은 직접 넣을 수 있어요. 펫 파일에는 안 담겨요.', 'Each room it lives in is noted automatically (since 0.10.9). You can add earlier ones by hand. Not included in pet files.')}</div>`;
}

function placeAct(act, t) {
    const p = curPet();
    if (!p) return;
    if (act === 'placeedit') { win.placeEdit = t.closest('[data-pl]')?.dataset.pl || null; return drawPlaces(); }
    if (act === 'placeadd') { win.placeEdit = 'new'; return drawPlaces(); }
    if (act === 'placecancel') { win.placeEdit = null; return drawPlaces(); }
    if (readOnly) return say(readOnlyReason);
    const form = t.closest('[data-plform]');
    const id = form?.dataset.plform;
    if (!form) return;
    const pl = id === 'new' ? null : (p.places || []).find(x => x.id === id);
    if (act === 'placedel') {
        if (!pl) return;
        if (pl.at && !pl.to && sameAt(pl.at, p.home)) pl.hide = true;    // the home it lives in now: hidden (else it would come right back)
        else p.places = p.places.filter(x => x !== pl);
    } else if (act === 'placesave') {
        const v = (k) => form.querySelector(`[data-pf="${k}"]`)?.value || '';
        const okDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
        let from = okDay(v('from')), to = okDay(v('to'));
        if (from && to && to < from) [from, to] = [to, from];
        const data = { name: v('name').replace(/\s+/g, ' ').trim().slice(0, PLACE_NAME) || LX('이름 없는 곳', 'Unnamed place'), memo: v('memo').trim().slice(0, PLACE_MEMO), from };
        if (pl) Object.assign(pl, data, pl.at && !pl.to ? {} : { to: to || null });
        else {
            p.places ??= [];
            p.places.push({ id: 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...data, to: to || null, n: 0, grp: false, at: null });
        }
    }
    win.placeEdit = null;
    saveSoon();
    drawPlaces();
}

/** One behaviour in the 행동 tab: 끔 / 드물게 / 보통 / 자주 (or just 끔 / 켬). */
function freqRow(p, u) {
    const off = MOVES[u.key] ? !movesOf(p).includes(u.key) : isAtt(u.key) ? !FREQ_X[p.freq?.[u.key]] : isOff(p, u.key);
    const cur = off ? 'off' : (FREQ_X[p.freq?.[u.key]] ? p.freq[u.key] : isPres(u.key) ? 'rare' : 'norm');
    if (u.many && !roommates(p).length) {                          // 0.10.9: needs another pet in the same room
        return `<div class="tw-frow tw-frow-off"><span class="tw-fname">${esc(u.name)}</span><span class="tw-sub">${LX('같은 방에 펫이 둘 이상이면 해요', 'Needs two or more pets in the same room')}</span></div>`;
    }
    if (u.needs && !p.look?.roles?.[u.needs]?.length) {         // 앉기 without a 앉기 picture
        return `<div class="tw-frow tw-frow-off"><span class="tw-fname">${esc(u.name)}</span><span class="tw-sub">${esc(ROLE_DEFS[u.needs]?.name || u.name)} ${LX('그림을 넣으면 해요', 'picture needed')}</span></div>`;
    }
    const opts = NO_FREQ.includes(u.key) ? [['off', LX('끔', 'Off')], ['norm', LX('켬', 'On')]] : FREQS;
    return `<div class="tw-frow${off ? ' tw-frow-off' : ''}"><span class="tw-fname">${esc(u.name)}</span><span class="tw-fseg">${opts.map(([k, n]) =>
        `<span class="tw-fbtn${cur === k ? ' tw-fon' : ''}" data-freq="${u.key}" data-fv="${k}">${n}</span>`).join('')}</span></div>`;
}

/** 끔 / 드물게 / 보통 / 자주 for the pet on screen (saved right away). */
function setFreq(key, v) {
    const p = curPet();
    if (!p || readOnly) return;
    const off = new Set(Array.isArray(p.off) ? p.off : []);
    const freq = { ...(p.freq || {}) };
    if (MOVES[key]) {                                    // ways to get about: 끔 = not one of its ways
        const on = new Set(movesOf(p));
        if (v === 'off') on.delete(key); else on.add(key);
        p.moves = Object.keys(MOVES).filter(k => on.has(k));
    } else if (isAtt(key)) {                             // attitudes: stored only when on (보통 too)
        off.delete(key);
        if (FREQ_X[v]) freq[key] = v; else delete freq[key];
    } else if (isPres(key)) {                            // 선물: 드물게 is the default, so 보통 is stored too
        if (v === 'off') off.add(key); else { off.delete(key); if (FREQ_X[v]) freq[key] = v; }
    } else if (v === 'off') off.add(key); else off.delete(key);
    if (!isAtt(key) && !isPres(key)) { if (v === 'rare' || v === 'often') freq[key] = v; else if (v !== 'off') delete freq[key]; }
    p.off = [...off];
    p.freq = freq;
    saveSoon();
    renderPanel();
}

function setRest(v) {
    const p = curPet();
    v = Number(v);
    if (!p || readOnly || !RESTS.some(x => x[0] === v)) return;
    p.screenRest = v;
    saveSoon();
    renderPanel();
}

function setPace(v) {
    const p = curPet();
    if (!p || readOnly || !PACES.some(x => x[0] === v)) return;
    p.pace = v;
    saveSoon();
    renderPanel();
}

function setReact(m, v) {
    const p = curPet();
    if (!p || readOnly || !REACT_MOMENTS.some(x => x.key === m)) return;
    p.personality.react ??= {};
    if (PERSONALITIES[v]) p.personality.react[m] = v; else delete p.personality.react[m];
    saveSoon();
    renderPanel();
}

/** Back to how the preset (기본 성격) does it. */
async function resetActs() {
    const p = curPet();
    if (!p || readOnly) return;
    if (!await confirmBox(LX('행동 빈도·걸음·반응 모습을 모두 기본 성격대로 되돌릴까요?', 'Reset all frequencies, walking speed and reactions to the base personality?'))) return;
    p.off = []; p.freq = {}; p.pace = 'norm'; p.moves = ['wall']; p.screenRest = REST_DEF;
    if (p.personality) p.personality.react = {};
    saveSoon();
    renderPanel();
    say(LX('기본 성격대로 되돌렸어요.', 'Reset to the base personality.'));
}

function actsHtml(p) {
    const lv = levelOf(p);
    const hide = (root?.settings?.heartMode || 'both') === 'hide';
    const list = unlocksFor(p);
    const groups = [1, 2, 3, 4].map(k => {
        const items = list.filter(u => u.lv === k);
        if (!items.length) return '';
        const open = lv >= k;
        const head = hide ? '' : `<div class="tw-cap">${esc(levelLabel(p, k))}${open ? '' : LX(' <span class="tw-sub">· 아직이에요</span>', ' <span class="tw-sub">· not yet</span>')}</div>`;
        return head + (open
            ? `<div class="tw-freqs">${items.map(u => freqRow(p, u)).join('')}</div>`
            : `<div class="tw-acts">${items.map(() => '<span class="tw-act"><i class="fa-solid fa-lock"></i> ???</span>').join('')}</div>`);
    }).join('');
    const baseName = persName(p);
    const head = `<div class="tw-preset"><span>${LX('기본 성격', 'Base personality')} <span class="tw-chip">${esc(baseName)}</span>${customised(p) ? LX(' <span class="tw-sub">· 직접 고친 곳 있음</span>', ' <span class="tw-sub">· customized</span>') : ''}</span>`
        + (customised(p) ? LX('<div class="tw-btn tw-btn-small" data-act="actreset">처음대로</div>', '<div class="tw-btn tw-btn-small" data-act="actreset">Reset</div>') : '') + '</div>'
        + LX('<div class="tw-sub">처음엔 기본 성격대로 움직여요. 아래에서 빈도와 반응을 마음대로 바꿀 수 있어요. 누르면 바로 저장돼요.</div>', '<div class="tw-sub">It starts out acting like its base personality. Change frequencies and reactions below as you like. Changes save right away.</div>');
    const pace = p.pace || 'norm';
    const rest = restOf(p);
    const restRow = `<div class="tw-frow"><span class="tw-fname">${LX('화면 쉬는 시간', 'Rest between screen trips')}</span><span class="tw-fseg">${RESTS.map(([k, n]) =>
        `<span class="tw-fbtn${rest === k ? ' tw-fon' : ''}" data-rest="${k}">${n}</span>`).join('')}</span></div>`;
    const basic = `<div class="tw-cap">${LX('평소 행동', 'Everyday behavior')}</div><div class="tw-freqs">${BASIC_ACTS.map(u => freqRow(p, u) + (u.key === 'dash' ? restRow : '')).join('')}`
        + `<div class="tw-frow"><span class="tw-fname">${LX('걸음 빠르기', 'Walking speed')}</span><span class="tw-fseg">${PACES.map(([k, n]) =>
            `<span class="tw-fbtn${pace === k ? ' tw-fon' : ''}" data-pace="${k}">${n}</span>`).join('')}</span></div></div>`;
    const atts = `<div class="tw-cap">${LX('나를 대하는 태도', 'How it treats you')}</div><div class="tw-sub">${LX('처음엔 꺼져 있어요. 원하는 것만 켜 보세요.', 'These start off. Turn on the ones you like.')}</div><div class="tw-freqs">${ATTITUDES.map(u => freqRow(p, u)).join('')}</div>`;
    const react = p.personality?.react || {};
    const reacts = `<div class="tw-cap">${LX('반응 모습', 'Reaction style')}</div><div class="tw-sub">${LX('순간마다 어느 성격처럼 반응할지 골라요. 섞어 써도 돼요.', 'Pick which personality it reacts like at each moment. Mix freely.')}</div><div class="tw-freqs">${REACT_MOMENTS.map(m =>
        `<div class="tw-frow"><span class="tw-fname">${esc(m.name)}</span><select class="tw-rsel" data-react="${m.key}"><option value="">${LX('기본 (', 'Default (')}${esc(baseName)})</option>${Object.entries(PERSONALITIES).map(([k, v]) =>
            `<option value="${k}"${react[m.key] === k ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>`).join('')}</div>`;
    const pres = `<div class="tw-cap">${LX('선물', 'Presents')}</div><div class="tw-sub">${LX('선물 탭에서 선물을 줬을 때만 해요. 처음엔 드물게예요.', 'Only after you give a present in the Presents tab. Rare at first.')}</div><div class="tw-freqs">${PRESENT_ACTS.map(u => freqRow(p, u)).join('')}</div>`;
    return `${head}${basic}${atts}${pres}${groups}<div class="tw-sub" style="margin:6px 0 4px">${LX('친해질수록 새 행동이 하나씩 열려요.', 'New behaviors unlock one by one as you grow closer.')}</div>${reacts}`;
}

/* ---------- window ---------- */

let win = null;   // { el, box, head, body, view, id, tab, form } while open

function ensureWin() {
    if (win) return win;
    const el = document.createElement('div');
    el.id = 'tavvy-win';
    el.className = 'tavvy-modal';
    el.hidden = true;
    el.innerHTML = '<div class="tavvy-win" role="dialog" aria-modal="true"><div class="tavvy-win-head"></div><div class="tavvy-win-body"></div></div>';
    document.body.appendChild(el);
    win = { el, box: el.firstElementChild, head: el.querySelector('.tavvy-win-head'), body: el.querySelector('.tavvy-win-body'), open: false, view: 'home', id: null, tab: 'journal', form: null,
        talkBase: null, roleEdit: null, rolesOpen: new Set(), prevTimer: 0, fit: '' };
    el.addEventListener('pointerdown', (e) => { if (e.target === el) closeWin(); });
    el.addEventListener('click', onWinClick);
    el.addEventListener('input', onWinInput);
    el.addEventListener('change', onWinInput);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && win?.open) { if (cutter) closeCutter(); else closeWin(); } });
    const refit = () => { if (win?.open) fitWin(); };
    window.addEventListener('resize', refit);
    window.visualViewport?.addEventListener('resize', refit);
    window.visualViewport?.addEventListener('scroll', refit);
    el.addEventListener('focusin', refitSoon);
    el.addEventListener('focusout', refitSoon);
    hookTyper(el);
    el.addEventListener('toggle', (e) => {                          // folded groups in the 그림 tab stay as you left them
        const g = e.target?.dataset?.group;
        if (g) { if (e.target.open) win.rolesOpen.add(g); else win.rolesOpen.delete(g); }
    }, true);
    // while open: if the visible screen changed without telling us (keyboard), fit again
    setInterval(() => {
        if (!win?.open || document.hidden) return;
        const vv = window.visualViewport;
        const now = vv ? `${Math.round(vv.width)}|${Math.round(vv.height)}|${Math.round(vv.offsetLeft)}|${Math.round(vv.offsetTop)}` : `${window.innerWidth}|${window.innerHeight}|0|0`;
        if (now !== win.fit) fitWin();
    }, 250);
    return win;
}

/**
 * Sit exactly on the part of the screen you can see. On some phones a "fixed" box is shifted or
 * taller than the screen (the same thing the pets' layer corrects for), which pushed the X off screen.
 */
function fitWin() {
    if (typer?.open) return;                                        // phone typing box is up → the window stays put
    const el = win.el, vv = window.visualViewport;
    const w = vv ? vv.width : window.innerWidth;
    const h = vv ? vv.height : window.innerHeight;
    const x = vv ? vv.offsetLeft : 0, y = vv ? vv.offsetTop : 0;
    // phone keyboard up: the part you can see got much shorter → the window sits at its top and fills it
    const kb = !!vv && window.innerHeight - h > 120;
    // typing box just closed: the keyboard is still sliding down → keep the window as it was (no half-size flash)
    if (typerShut) {
        if (kb && performance.now() < typerShut) return;
        typerShut = 0;
    }
    win.fit = `${Math.round(w)}|${Math.round(h)}|${Math.round(x)}|${Math.round(y)}`;
    el.classList.toggle('tavvy-kb', kb);
    el.style.width = `${Math.round(w)}px`;
    el.style.height = `${Math.round(h)}px`;
    el.style.transform = 'none';
    if (kb) {
        // keyboard up: stick straight onto the visible part (no measuring mid-slide — iPhone moves things
        // while the keyboard animates, and correcting against that made the window jump about)
        el.style.top = `${Math.round(y)}px`;
        el.style.left = `${Math.round(x)}px`;
        keepFocusVisible();
        return;
    }
    el.style.top = '0px';
    el.style.left = '0px';
    const r = el.getBoundingClientRect();
    const dx = x - r.left, dy = y - r.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
}

/* ---------- phone typing box ----------
 * On phones, tapping a text box in the window doesn't type in place: a small box opens at the very top of
 * the screen instead, and what you write goes back into the window's box when you finish. The keyboard
 * then never has to share the screen with the big window (iPhone kept cutting it in half). */
const isTouchUi = () => window.matchMedia?.('(pointer: coarse)').matches;
const TYPED = 'input:not([type="checkbox"]):not([type="range"]):not([type="file"]), textarea';
let typer = null;   // { el, field, target, open }
let typerShut = 0;  // until when the window waits for the keyboard to go down after the typing box closed
const TYPER_SHUT_WAIT = 1000;   // ms

function typerLabel(f) {
    const lab = f.closest('label');
    const t = lab ? [...lab.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim() : '';
    return t || f.placeholder || LX('적기', 'Type');
}

function ensureTyper() {
    if (typer) return typer;
    const el = document.createElement('div');
    el.className = 'tavvy-typer';
    el.hidden = true;
    el.innerHTML = `<div class="tavvy-typer-box"><div class="tavvy-typer-head"><span></span><div class="tw-btn" data-typer="done">${LX('완료', 'Done')}</div></div><div class="tavvy-typer-slot"></div></div>`;
    document.body.appendChild(el);
    typer = { el, field: null, target: null, open: false };
    // tap "완료" without the field losing focus first (pointerdown keeps the focus) — and close on the click itself,
    // so the tap ends on 완료 and doesn't land on the window's ✕ underneath (0.9.2)
    const done = el.querySelector('[data-typer="done"]');
    done.addEventListener('pointerdown', (e) => e.preventDefault());
    done.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeTyper(true); });
    const place = () => {
        if (!typer.open) return;
        const vv = window.visualViewport;
        el.style.top = `${Math.round(vv ? vv.offsetTop : 0)}px`;
        el.style.left = `${Math.round(vv ? vv.offsetLeft : 0)}px`;
        el.style.width = `${Math.round(vv ? vv.width : window.innerWidth)}px`;
    };
    typer.place = place;
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return typer;
}

/** Copy what's typed back into the window's box, as if it was typed there. */
function typerPush() {
    const t = typer;
    if (!t?.target || !t.field) return;
    if (t.target.value === t.field.value) return;
    t.target.value = t.field.value;
    t.target.dispatchEvent(new Event('input', { bubbles: true }));
}

function openTyper(target) {
    const t = ensureTyper();
    if (t.open) closeTyper(true);
    const multi = target.tagName === 'TEXTAREA';
    const f = document.createElement(multi ? 'textarea' : 'input');
    for (const a of ['type', 'inputmode', 'maxlength', 'min', 'max', 'step', 'placeholder', 'enterkeyhint']) {
        const v = target.getAttribute(a);
        if (v != null) f.setAttribute(a, v);
    }
    if (!multi) f.setAttribute('enterkeyhint', 'done');
    if (multi) f.rows = 4;
    f.value = target.value;
    f.addEventListener('input', typerPush);
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multi) { e.preventDefault(); closeTyper(true); } });
    f.addEventListener('blur', () => setTimeout(() => { if (t.field === f) closeTyper(true); }, 0));   // keyboard closed
    t.el.querySelector('.tavvy-typer-slot').replaceChildren(f);
    t.el.querySelector('.tavvy-typer-head span').textContent = typerLabel(target);
    t.el.dataset.theme = win?.box?.dataset?.theme || 'theme';
    t.field = f; t.target = target; t.open = true;
    t.el.hidden = false;
    t.place();
    target.classList.add('tw-typing');
    // the keyboard's ˄ ˅ keys must not hop into the big window's boxes
    for (const x of win?.body?.querySelectorAll(TYPED) || []) if (!x.readOnly) { x.readOnly = true; x.dataset.typerLock = '1'; }
    f.focus();                                                      // same tap → iPhone opens the keyboard
    try { const n = f.value.length; f.setSelectionRange(n, n); } catch { /* number boxes */ }
}

function closeTyper(keep = true) {
    const t = typer;
    if (!t?.open) return;
    if (keep) {
        typerPush();
        t.target?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    t.target?.classList.remove('tw-typing');
    for (const x of document.querySelectorAll('[data-typer-lock]')) { x.readOnly = false; delete x.dataset.typerLock; }
    t.open = false;
    const f = t.field;
    t.field = null; t.target = null;
    t.el.hidden = true;
    typerShut = performance.now() + TYPER_SHUT_WAIT;
    f?.blur();
    if (win?.open) refitSoon();
    setTimeout(() => { if (win?.open) fitWin(); }, TYPER_SHUT_WAIT + 50);   // in case the phone never says the keyboard is gone
}

/** Phones: the window's text boxes open the typing box instead of the keyboard in place. */
function hookTyper(el) {
    el.addEventListener('pointerdown', (e) => {
        const f = e.target.closest?.(TYPED);
        if (!f || !isTouchUi() || f.disabled) return;
        if (!f.readOnly) { f.readOnly = true; f.dataset.typerLock = '1'; }   // no keyboard here…
    }, true);
    el.addEventListener('click', (e) => {
        const f = e.target.closest?.(TYPED);
        if (!f || !f.dataset.typerLock || !isTouchUi() || f.disabled) return;
        e.preventDefault();
        f.blur();
        openTyper(f);                                               // …but up top
    }, true);
}

/** The box you are typing in stays in view (scrolls inside the window, not the page). */
function keepFocusVisible() {
    const a = document.activeElement;
    if (!a || !win.body.contains(a) || !a.matches('input, textarea, select')) return;
    const b = win.body.getBoundingClientRect(), r = a.getBoundingClientRect();
    if (r.bottom > b.bottom - 8) win.body.scrollTop += r.bottom - b.bottom + 16;
    else if (r.top < b.top + 8) win.body.scrollTop -= b.top - r.top + 16;
}

/** The keyboard slides in and out over a moment, and phones don't always say when it's done → look again. */
function refitSoon() {
    if (!win?.open) return;
    fitWin();
    for (const ms of [80, 250, 500, 900]) setTimeout(() => { if (win?.open) fitWin(); }, ms);
}

function applyTheme() {
    if (win) win.box.dataset.theme = THEMES[root?.settings?.winTheme] ? root.settings.winTheme : 'theme';
}

/** From the wand menu: one pet in this room → its page; otherwise the list. */
function openInfoFromMenu() {
    const here = residents();
    if (here.length === 1) return openWin('pet', { id: here[0].id });
    openWin('home');
}

function openWin(view = 'home', opts = {}) {
    ensureWin();
    applyTheme();
    win.el.hidden = false;
    win.open = true;
    fitWin();
    show(view, opts);
}

/** Switch what the window shows (no questions asked — use leave() when changes may be lost). */
function show(view, opts = {}) {
    win.view = view;
    win.id = opts.id ?? null;
    win.tab = opts.tab || 'journal';
    win.form = null;
    win.talkBase = null;
    win.roleEdit = null;
    win.sheet = null;
    win.giftPend = null;
    win.placeEdit = null;
    stopPreview();
    closeCutter();
    const back = view !== 'home';
    const p = view === 'pet' ? root?.pets.find(x => x.id === win.id) : null;
    if (view === 'pet' && !p) return show('home');
    const title = { home: 'Tavvy', pet: p?.name || '', new: LX('새 펫 만들기', 'New pet'), settings: LX('설정', 'Settings'), bye: LX('작별', 'Farewell') }[view];
    win.head.innerHTML = `${back ? LX('<div class="tw-icon" data-act="back" title="뒤로"><i class="fa-solid fa-arrow-left"></i></div>', '<div class="tw-icon" data-act="back" title="Back"><i class="fa-solid fa-arrow-left"></i></div>') : '<div class="tw-icon tw-paw"><i class="fa-solid fa-paw"></i></div>'}
<b class="tw-title">${esc(title)}</b>
${view === 'home' ? LX('<div class="tw-icon" data-act="settings" title="설정"><i class="fa-solid fa-gear"></i></div>', '<div class="tw-icon" data-act="settings" title="Settings"><i class="fa-solid fa-gear"></i></div>') : ''}
<div class="tw-icon" data-act="close" title="${LX('닫기', 'Close')}"><i class="fa-solid fa-xmark"></i></div>`;
    if (view === 'home') win.body.innerHTML = homeHtml();
    else if (view === 'pet') win.body.innerHTML = petHtml(p);
    else if (view === 'new') win.body.innerHTML = newHtml();
    else if (view === 'settings') win.body.innerHTML = settingsHtml();
    else if (view === 'bye') win.body.innerHTML = byeHtml(opts.name);
    win.body.scrollTop = 0;
    if (view === 'pet') { fillEdit(p); fillTalk(p); showTab(win.tab); }
    if (view === 'new') fillNew();
    if (view === 'settings') fillSettings();
    refreshWin();
}

/** 0.10.3: after saying goodbye — so it's clear the pet is gone. */
function byeHtml(name) {
    const n = String(name || '');
    return `<div class="tw-bye">
  <div class="tw-bye-wave">👋</div>
  <b>${LX(`${esc(n)}${esc(josa(n, '과', '와').slice(n.length))} 작별했어요`, `Said goodbye to ${esc(n)}`)}</b>
  <div class="tw-sub">${LX('함께한 기록은 지워졌어요. 외형(그림)은', 'Its records are gone. Its look (pictures) stays in')} "${LX('내가 올린 외형', 'My uploaded looks')}"${LX('에 남아 있어서 새 펫을 만들 때 다시 고를 수 있어요.', ' so you can pick it again for a new pet.')}</div>
  <div class="tw-row tw-bye-btns"><div class="tw-btn" data-act="gohome">${LX('처음 화면으로', 'Back to start')}</div><div class="tw-btn tw-btn-main" data-act="close">${LX('닫기', 'Close')}</div></div>
</div>`;
}

/** Leaving a page with unsaved edits asks once. Returns true if it's fine to go. */
async function okToLeave() {
    if (!formDirty()) return true;
    return await confirmBox(LX('저장 안 한 내용이 있어요. 그래도 나갈까요?', 'You have unsaved changes. Leave anyway?'));
}

let leaving = false;
async function leave(fn) {
    if (leaving) return;
    leaving = true;
    try { if (await okToLeave()) fn(); } finally { leaving = false; }
}

function closeWin() {
    if (!win?.open) return;
    closeTyper(true);
    leave(() => { closeCutter(); win.el.hidden = true; win.open = false; win.form = null; win.talkBase = null; stopPreview(); });
}

/* --- home --- */

function homeHtml() {
    return `<div class="tw-sub tw-roomnote" data-live="room"></div>
<div data-live="home"></div>
<div class="tw-btn tw-btn-main tw-wide" data-act="new"><i class="fa-solid fa-plus"></i> ${LX('새 펫 만들기', 'New pet')}</div>
<input type="file" accept=".json,.png,application/json,image/png" data-f="importfile" hidden>
<div class="tw-btn tw-wide" data-act="import"><i class="fa-solid fa-file-import"></i> ${LX('불러오기 (펫 파일 · PNG 카드)', 'Import (pet file · PNG card)')}</div>
<div class="tw-msg"></div>`;
}

function petCard(p, big) {
    const lv = levelLabel(p);
    const sub = big ? `${lv ? lv + ' · ' : ''}${LX(`함께한 지 ${togetherDays(p)}일째`, `day ${togetherDays(p)} together`)}` : `${homeLabel(p)}${lv ? ' · ' + lv : ''}`;
    return `<div class="tw-card${big ? '' : ' tw-card-small'}" data-pet="${esc(p.id)}">
  <div class="tw-av"><img src="${esc(imgUrl(p.look?.roles?.idle?.[0]))}" alt=""></div>
  <div class="tw-card-main"><b>${esc(p.name)} <span class="tw-chip">${esc(persName(p))}</span></b><span>${esc(sub)}</span></div>
  <i class="fa-solid fa-chevron-right tw-chev"></i>
</div>`;
}

function homeLiveHtml() {
    const here = residents();
    const others = (root?.pets || []).filter(p => !here.includes(p));
    let html = '';
    if (here.length) html += `<div class="tw-cap">${LX('이 방에 사는 펫', 'Pets in this room')}</div>${here.map(p => petCard(p, true)).join('')}`;
    if (others.length) html += `<div class="tw-cap">${LX('다른 방의 펫', 'Pets in other rooms')}</div>${others.map(p => petCard(p, false)).join('')}`;
    if (!html) html = LX('<div class="tw-empty">아직 펫이 없어요.<br>채팅방을 열고 첫 펫을 만들어 보세요.</div>', '<div class="tw-empty">No pets yet.<br>Open a chat and make your first pet.</div>');
    return html;
}

function roomNote() {
    if (readOnly) return readOnlyReason;
    if (!room) return LX('열려 있는 채팅방이 없어요.', 'No chat is open.');
    return residents().length ? '' : LX('이 방에는 아직 펫이 없어요.', 'No pets in this room yet.');
}

/* --- pet page --- */

function petHtml(p) {
    return `<div data-live="hero"></div>
<div data-live="move"></div>
<div class="tw-tabs">
  <div class="tw-tab" data-tab="journal">${LX('기록', 'Journal')}</div>
  <div class="tw-tab" data-tab="acts">${LX('행동', 'Actions')}</div>
  <div class="tw-tab" data-tab="edit">${LX('꾸미기', 'Style')}</div>
  <div class="tw-tab" data-tab="roles">${LX('그림', 'Art')}</div>
  <div class="tw-tab" data-tab="talk">${LX('대사', 'Lines')}</div>
  <div class="tw-tab" data-tab="gifts">${LX('선물', 'Presents')}</div>
</div>
<div class="tw-pane" data-pane="journal"><div data-live="journal"></div><div class="tw-places"></div></div>
<div class="tw-pane" data-pane="acts" data-live="acts"></div>
<div class="tw-pane" data-pane="roles"></div>
<div class="tw-pane" data-pane="talk">${talkHtml(p)}</div>
<div class="tw-pane" data-pane="gifts"></div>
<div class="tw-pane tw-form" data-pane="edit">
  <label class="tw-label">${LX('이름', 'Name')} <input data-f="name" maxlength="20"></label>
  <label class="tw-label">${LX('나를 부르는 이름', 'What it calls you')} <input data-f="callme" maxlength="20" placeholder="${esc(ctx().name1 || LX('나', 'you'))}"></label>
  <div class="tw-sub">${LX('대사의 {{user}}가 이 이름으로 바뀌어요. 비워 두면 실리태번의 내 이름(페르소나)으로 불러요.', 'Replaces {{user}} in its lines. Leave empty to use your SillyTavern (persona) name.')}</div>
  <label class="tw-label">${LX('기본 성격', 'Base personality')} <select data-f="pers">${Object.entries(PERSONALITIES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
  <div class="tw-sub">${LX('성격을 바꾸면 행동은 바로 바뀌어요. 친밀도와 기록은 그대로예요.', 'Changing the personality changes behavior right away. Closeness and records stay.')}</div>
  <label class="tw-label">${LX('크기 (', 'Size (')}${device() === 'phone' ? LX('폰', 'phone') : 'PC'})
    <div class="tw-row"><input type="number" inputmode="numeric" min="${SIZE_MIN}" max="${SIZE_MAX}" step="1" value="${petSize(p)}" data-size="${esc(p.id)}" class="tw-num"><span class="tw-sub" data-sizeval="${esc(p.id)}">${sizeLabel(p, petSize(p))}</span></div>
  </label>
  <div class="tw-sub">${LX('크기는 적으면 바로 바뀌어요. 폰과 PC는 따로 기억해요.', 'Size changes as you type. Phone and PC are remembered separately.')}</div>
  <div class="tw-cap">${LX('외형', 'Look')}</div>
  <div class="tw-lookgrid"></div>
  ${uploadHtml()}
  ${facingHtml()}
  <div class="tw-btn tw-btn-main tw-wide" data-act="save">${LX('저장', 'Save')}</div>
  <div class="tw-msg"></div>
  <div class="tw-cap">${LX('소리', 'Sounds')}</div>
  <div class="tw-sounds">${soundsHtml(p)}</div>
  <input type="file" accept="${SND_ACCEPT}" data-f="sndfile">
  <div class="tw-sub">mp3 · wav · ogg · m4a, ${SND_MAX_SEC}${LX('초까지. 비워 두면 기본 소리예요. 올리거나 빼면 바로 저장돼요. 소리는 ⚙ 설정에서 켜야 나요(▶ 듣기는 꺼져 있어도 들려요).', ' s max. Empty = default sound. Uploading or removing saves right away. Turn sounds on in ⚙ Settings (▶ preview plays even when off).')}</div>
  <div class="tw-msg tw-sndmsg"></div>
  <div class="tw-cap">${LX('내보내기', 'Export')}</div>
  <div class="tw-row"><div class="tw-btn" data-act="exportpet"><i class="fa-solid fa-file-arrow-down"></i> ${LX('펫 파일', 'Pet file')}</div><span class="tw-sub">${LX('기록까지 모두 담긴 백업 파일이에요.', 'A backup file with all its records.')}</span></div>
  <div class="tw-row"><div class="tw-btn" data-act="exportcard"><i class="fa-solid fa-image"></i> ${LX('PNG 카드', 'PNG card')}</div><span class="tw-sub">${LX('외형과 동작 그림만 담긴 그림이에요. 남에게 나눠 줄 때 써요.', 'An image holding only the look and action pictures. For sharing with others.')}</span></div>
  <div class="tw-sub">${LX('펫이 사는 방 정보는 넣지 않아요. 메신저·사진 앱을 거치면 카드 안 정보가 지워질 수 있어요. 그럴 땐 파일 그대로 보내 주세요.', 'Room info is never included. Messengers and photo apps may strip the data inside the card, so send it as a file.')}</div>
  <div class="tw-danger">
    <div class="tw-btn tw-btn-danger" data-act="delete"><i class="fa-solid fa-hand"></i> ${LX('작별하기', 'Say goodbye')}</div>
    <div class="tw-sub">${LX('함께한 기록은 사라지고 되돌릴 수 없어요. 외형은', 'Its records will be gone for good. The look stays in')} "${LX('내가 올린 외형', 'My uploaded looks')}"${LX('에 남아요.', '.')}</div>
  </div>
</div>`;
}

function soundsHtml(p) {
    return SOUND_SLOTS.map(([k, name]) => {
        const mine = typeof p.sounds?.[k] === 'string';
        return `<div class="tw-sndrow"><span class="tw-sndname">${name}</span>${mine ? LX('<span class="tw-chip">내 소리</span>', '<span class="tw-chip">My sound</span>') : LX('<span class="tw-sub">기본 소리</span>', '<span class="tw-sub">Default sound</span>')}
  <div class="tw-btn tw-btn-small" data-sndplay="${k}" title="${LX('듣기', 'Play')}"><i class="fa-solid fa-play"></i></div>
  ${mine ? `<div class="tw-btn tw-btn-small" data-snddel="${k}" title="${LX('기본으로', 'Use default')}">✕</div>` : `<div class="tw-btn tw-btn-small" data-sndup="${k}">${LX('올리기', 'Upload')}</div>`}</div>`
            + (PICK_SOUNDS[k] ? voiceRowHtml(p, k, mine) : '');
    }).join('');
}

/** 0.11.15 목소리 · 0.11.16 하트 소리: which built-in sound this pet uses (a sound file of its own still comes first). */
function voiceRowHtml(p, key, mine) {
    const [field, list, def, label] = PICK_SOUNDS[key];
    const cur = Object.hasOwn(list, p[field] ?? '') ? p[field] : def;
    return `<div class="tw-sndrow"><span class="tw-sndname">${label}</span><span class="tw-seg" style="flex:1">${Object.entries(list).map(([v, [n]]) =>
        `<span class="${v === cur ? 'on' : ''}" data-voice="${v}" data-vkey="${key}">${n}</span>`).join('')}</span></div>`
        + (mine ? `<div class="tw-sub">${LX('내 소리를 올려 둬서 이 소리 대신 그 소리가 나요.', 'Its own sound file plays instead of this.')}</div>` : '');
}

function setVoice(key, v) {
    const p = curPet(), pk = PICK_SOUNDS[key];
    if (!p || !pk || !Object.hasOwn(pk[1], v)) return;
    sndTouched = true;
    playSound(key, 1, true, { [pk[0]]: v });            // hear the sound itself, even with a file of its own
    if (p[pk[0]] === v) return;
    p[pk[0]] = v;
    drawSounds(p);
    saveSoon();
}

function drawSounds(p) {
    const box = win?.body.querySelector('.tw-sounds');
    if (box && p) box.innerHTML = soundsHtml(p);
}

function sndSay(text) {
    const m = win?.body.querySelector('.tw-sndmsg');
    if (m) m.textContent = text;
}

/** Save behind the screen (it can take seconds on a phone); old files go only after the save worked. */
async function saveSoundChange(p, key, old, fresh) {
    const ok = await saveNow();
    if (!ok && readOnly) {                            // could not save at all → put it back
        if ((p.sounds[key] ?? null) === fresh) {
            if (old) p.sounds[key] = old; else delete p.sounds[key];
        }
        if (fresh) deleteFile(fresh);
        drawSounds(p);
        return sndSay(readOnlyReason);
    }
    if (!ok) return saveSoon();
    if (old && !fileInUse(old)) deleteFile(old);
}

/** Check a picked sound file (kind, size, length) and upload it: { path, buf } or null (the reason is told with say). */
async function sndLoad(file, base, say) {
    const ext = sndExt(file.name, file.type);
    if (!ext) return say(LX('mp3 · wav · ogg · m4a 파일만 넣을 수 있어요.', 'Only mp3 · wav · ogg · m4a files.')), null;
    if (file.size > SND_MAX_BYTES) return say(LX(`파일이 너무 커요. 짧은 효과음(${SND_MAX_SEC}초까지)을 넣어 주세요.`, `The file is too big. Use a short sound (up to ${SND_MAX_SEC} s).`)), null;
    if (!sndReady()) return say(LX('이 브라우저에서는 소리를 쓸 수 없어요.', 'This browser can’t play sounds.')), null;
    say(LX('읽는 중…', 'Reading…'));
    const bytes = await file.arrayBuffer();
    let buf;
    try { buf = await sndCtx.decodeAudioData(bytes.slice(0)); } catch { return say(LX('소리를 읽지 못했어요. 다른 파일로 해 주세요.', 'Couldn’t read the sound. Try another file.')), null; }
    if (buf.duration > SND_MAX_SEC + 0.05) return say(`${Math.round(buf.duration * 10) / 10}${LX('초짜리예요.', ' s long.')} ${SND_MAX_SEC}${LX('초까지만 넣을 수 있어요.', ' s max.')}`), null;
    try {
        const b64 = await blobToDataUrl(new Blob([bytes])).then(u => u.split(',')[1]);
        return { path: await uploadFile(`${base}.${ext}`, b64), buf };
    } catch (e) { return say(LX('올리지 못했어요: ', 'Upload failed: ') + (e.message || e)), null; }
}

/* ---------- 0.10.11 답 도착 소리 (settings) ---------- */

function repliesHtml() {
    const s = root.settings, off = s.replyOff || [];
    const row = (id, name, mine) => `<div class="tw-sndrow"><label class="tw-check tw-grow"><input type="checkbox" data-replyck="${esc(id)}"${off.includes(id) ? '' : ' checked'}> <span class="tw-sndname">${esc(name)}</span>${mine ? LX(' <span class="tw-chip">내 소리</span>', ' <span class="tw-chip">My sound</span>') : ''}</label>
  <div class="tw-btn tw-btn-small" data-replyplay="${esc(id)}" title="${LX('듣기', 'Play')}"><i class="fa-solid fa-play"></i></div>${mine ? `<div class="tw-btn tw-btn-small" data-replydel="${esc(id)}" title="${LX('빼기', 'Remove')}">✕</div>` : ''}</div>`;
    return REPLY_SOUNDS.map(([k, name]) => row(k, name, false)).join('')
        + (s.replyFiles || []).filter(f => f?.id).map(f => row(f.id, f.name || LX('내 소리', 'My sound'), true)).join('');
}

function drawReplies() {
    const box = win?.body.querySelector('.tw-replies');
    if (box && root) box.innerHTML = repliesHtml();
}

function replySay(text) {
    const m = win?.body.querySelector('.tw-replymsg');
    if (m) m.textContent = text;
}

function toggleReply(id, on) {
    const s = root.settings;
    s.replyOff = (s.replyOff || []).filter(x => x !== id);
    if (!on) s.replyOff.push(id);
    saveSoon();
}

async function replyPicked(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !root) return;
    if (readOnly) return replySay(readOnlyReason);
    if ((root.settings.replyFiles || []).length >= REPLY_FILES_MAX) return replySay(`${LX('내 소리는', 'Up to')} ${REPLY_FILES_MAX}${LX('개까지 넣을 수 있어요.', ' of your own sounds.')}`);
    const got = await sndLoad(file, `tavvy_reply_${Date.now().toString(36)}`, replySay);
    if (!got) return;
    const f = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), path: got.path,
        name: String(file.name || '').replace(/\.[^.]+$/, '').trim().slice(0, 20) || LX('내 소리', 'My sound') };
    root.settings.replyFiles.push(f);
    sndBufs.set(f.path, Promise.resolve(got.buf));
    drawReplies();
    replySay('');
    playSound('reply', 1, true, null, replyById(f.id));
    const ok = await saveNow();                         // the screen changed already; saving can take seconds on a phone
    if (!ok && readOnly) {
        root.settings.replyFiles = root.settings.replyFiles.filter(x => x !== f);
        deleteFile(f.path);
        drawReplies();
        return replySay(readOnlyReason);
    }
    if (!ok) saveSoon();
}

async function removeReply(id) {
    const s = root?.settings, f = (s?.replyFiles || []).find(x => x?.id === id);
    if (!f || readOnly) return;
    s.replyFiles = s.replyFiles.filter(x => x !== f);
    s.replyOff = (s.replyOff || []).filter(x => x !== id);
    drawReplies();
    replySay('');
    const ok = await saveNow();
    if (!ok && readOnly) { s.replyFiles.push(f); drawReplies(); return replySay(readOnlyReason); }
    if (!ok) return saveSoon();
    if (!fileInUse(f.path)) deleteFile(f.path);         // files go only after the save worked
}

async function sndPicked(input) {
    const file = input.files?.[0];
    input.value = '';
    const key = win?.sndKey, p = curPet();
    if (!file || !p || !SOUNDS[key]) return;
    if (readOnly) return sndSay(readOnlyReason);
    const got = await sndLoad(file, `tavvy_snd_${p.id}_${key}_${Date.now().toString(36)}`, sndSay);
    if (!got) return;
    const { path, buf } = got;
    if (!root.pets.includes(p)) return deleteFile(path);   // said goodbye meanwhile
    const old = typeof p.sounds?.[key] === 'string' ? p.sounds[key] : null;
    if (!isObj(p.sounds)) p.sounds = {};
    p.sounds[key] = path;
    sndBufs.set(path, Promise.resolve(buf));
    drawSounds(p);
    sndSay('');
    playSound(key, 1, true, p);
    saveSoundChange(p, key, old, path);
}

function removeSound(key) {
    const p = curPet();
    if (!p || readOnly || typeof p.sounds?.[key] !== 'string') return;
    const old = p.sounds[key];
    delete p.sounds[key];
    drawSounds(p);
    sndSay('');
    saveSoundChange(p, key, old, null);
}

function fillEdit(p) {
    const cur = lookKeyOf(p);
    win.form = { kind: 'edit', id: p.id, look: cur, file: null, prep: null,
        base: { name: p.name, callMe: p.callMe || '', pers: p.personality?.base || 'aegyo', facing: p.look?.facing || 'front', squish: String(Math.round((p.look?.squish ?? 0.5) * 10) / 10), look: cur } };
    const b = win.form.base, box = win.body;
    box.querySelector('[data-f="name"]').value = b.name;
    box.querySelector('[data-f="callme"]').value = b.callMe;
    box.querySelector('[data-f="pers"]').value = b.pers;
    box.querySelector('[data-f="facing"]').value = b.facing;
    box.querySelector('[data-f="squish"]').value = b.squish;
    drawLookGrid();
    showSquish();
}

function showTab(tab) {
    win.tab = tab;
    win.body.querySelectorAll('.tw-tab').forEach(t => t.classList.toggle('tw-on', t.dataset.tab === tab));
    win.body.querySelectorAll('.tw-pane').forEach(pn => { pn.hidden = pn.dataset.pane !== tab; });
    if (tab === 'roles') drawRoles(); else stopPreview();
    if (tab === 'gifts') drawGifts();
    if (tab === 'journal') drawPlaces();
    refreshWin();
}

/* --- new pet --- */

function newHtml() {
    return `<div class="tw-form">
  <div class="tw-sub" data-live="newroom"></div>
  <label class="tw-label">${LX('이름', 'Name')} <input data-f="name" maxlength="20" placeholder="${LX('이름', 'Name')}"></label>
  <div class="tw-cap">${LX('외형', 'Look')}</div>
  <div class="tw-lookgrid"></div>
  ${uploadHtml()}
  <div class="tw-uploadopts" hidden>${facingHtml()}</div>
  <label class="tw-label">${LX('기본 성격', 'Base personality')} <select data-f="pers">${Object.entries(PERSONALITIES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
  <div class="tw-btn tw-btn-main tw-wide" data-act="create">${LX('만들기', 'Create')}</div>
  <div class="tw-msg"></div>
</div>`;
}

function fillNew() {
    win.form = { kind: 'new', look: null, file: null, prep: null, autoName: '' };
    win.body.querySelector('[data-f="facing"]').value = 'front';
    win.body.querySelector('[data-f="squish"]').value = '0.5';
    drawLookGrid();
    showSquish();
}

/* --- settings --- */

function settingsHtml() {
    const themes = Object.entries(THEMES).map(([k, v]) =>
        `<div class="tw-theme" data-theme-pick="${k}"><div class="tw-swatch tw-swatch-${k}"><i></i><i></i></div><span>${v}</span></div>`).join('');
    return `<div class="tw-form">
  <div class="tw-cap">언어 · Language</div>
  <label class="tw-label">${LX('언어', 'Language')}
    <select data-s="lang">
      <option value="auto">${LX('자동 (실리태번·브라우저 언어 따라)', 'Auto (SillyTavern / browser language)')}</option>
      <option value="ko">한국어</option>
      <option value="en">English</option>
    </select>
  </label>
  <div class="tw-sub">${LX('바꾸면 페이지를 새로고침한 뒤에 적용돼요.', 'Takes effect after you reload the page.')}</div>

  <div class="tw-cap">${LX('창 색', 'Window color')}</div>
  <div class="tw-themes">${themes}</div>

  <div class="tw-cap">${LX('펫', 'Pets')}</div>
  <label class="tw-check"><input type="checkbox" data-s="autoWake"> ${LX('방에 들어올 때 자동으로 깨우기', 'Wake pets automatically when entering a room')}</label>
  <label class="tw-label">${LX('무대', 'Stage')}
    <select data-s="stageMode">
      <option value="chat">${LX('채팅창 전체 (말풍선 위에도 올라가요)', 'Whole chat (climbs onto messages too)')}</option>
      <option value="floor">${LX('바닥만 (입력창 위에서만 지내요)', 'Floor only (stays above the input box)')}</option>
    </select>
  </label>
  <label class="tw-check"><input type="checkbox" data-s="lineLedges"> ${LX('줄 모양 채팅에서 메시지 사이 경계선도 발판으로 쓰기', 'In line-style chats, use the borders between messages as ledges too')}</label>
  <label class="tw-check"><input type="checkbox" data-s="stroll"> ${LX('화면 위를 돌아다니기', 'Roam around the screen')}</label>
  <label class="tw-check"><input type="checkbox" data-s="badge"> ${LX('재워 둔 동안 침대에 쌓인 밥 수 보기', 'Show food piling up on the bed while pets sleep')}</label>
  <label class="tw-label">${LX('친밀도 표시', 'Closeness display')}
    <select data-s="heartMode">
      <option value="both">${LX('하트 + 이름 (♥♥ 친구)', 'Hearts + name (♥♥ Friend)')}</option>
      <option value="hearts">${LX('하트만', 'Hearts only')}</option>
      <option value="name">${LX('이름만', 'Name only')}</option>
      <option value="hide">${LX('숨기기', 'Hide')}</option>
    </select>
  </label>

  <div class="tw-cap">${LX('소리', 'Sounds')}</div>
  <div class="tw-sndrow"><span class="tw-sndname">${LX('소리 느낌', 'Sound style')}</span><span class="tw-seg" style="flex:1"><span data-feel="clear">${LX('또렷하게', 'Crisp')}</span><span data-feel="soft">${LX('부드럽게', 'Soft')}</span></span></div>
  <div class="tw-sub">${LX('펫 소리와 답 도착 소리가 한꺼번에 바뀌어요. 부드럽게는 조금 길게 울려요. 올려 둔 내 소리는 그대로예요.', 'Changes pet sounds and reply sounds together. Soft rings a little longer. Your own sound files stay as they are.')}</div>
  <label class="tw-check"><input type="checkbox" data-s="replyOn"> ${LX('답 도착 알림', 'Reply arrival alert')}</label>
  <div class="tw-sub">${LX('체크한 소리가 답이 올 때마다 돌아가며 나요. 펫 꾸미기 탭에서 그 펫의 답 도착 소리를 올려 두었으면 그게 먼저예요.', 'The checked sounds take turns each time a reply arrives. A pet’s own reply sound (set in its Style tab) comes first.')}</div>
  <div class="tw-sounds tw-replies">${repliesHtml()}</div>
  <div class="tw-row"><div class="tw-btn tw-btn-small" data-act="replyup">${LX('내 소리 올리기', 'Upload my sound')}</div><span class="tw-sub">mp3 · wav · ogg · m4a, ${SND_MAX_SEC}${LX('초까지,', ' s max,')} ${REPLY_FILES_MAX}${LX('개까지', ' files max')}</span></div>
  <input type="file" accept="${SND_ACCEPT}" data-f="replyfile">
  <div class="tw-msg tw-replymsg"></div>
  <div class="tw-row"><span class="tw-sub">${LX('답 도착 음량', 'Reply volume')}</span><input type="range" min="0" max="100" step="5" data-s="replyVol" class="tw-grow"><span class="tw-sub tw-volpct" data-pct="replyVol"></span></div>
  <div class="tw-sub tw-replynote"></div>
  <label class="tw-check"><input type="checkbox" data-s="soundOn"> ${LX('펫 소리 (♥ · 깨우기 · 재우기 · 축하 · 콩 · 웅얼)', 'Pet sounds (♥ · wake · sleep · cheer · boop · mumble)')}</label>
  <div class="tw-row"><span class="tw-sub">${LX('펫 소리 음량', 'Pet sound volume')}</span><input type="range" min="0" max="100" step="5" data-s="soundVol" class="tw-grow"><span class="tw-sub tw-volpct" data-pct="soundVol"></span></div>
  <div class="tw-sub">${LX('다른 탭을 보고 있을 땐 소리가 나지 않아요. 폰은 화면을 한 번 누른 뒤부터 나요.', 'No sounds while you’re on another tab. On phones, sounds start after you tap the screen once.')}</div>

  <div class="tw-cap">${LX('대사', 'Lines')}</div>
  <label class="tw-label tw-profrow">${LX('AI로 대사 만들 때 쓸 연결', 'Connection used for AI lines')}
    <select data-s="talkProfile"></select>
  </label>
  <div class="tw-sub tw-profrow">${LX('대사 탭의', 'Only used when you press')} "${LX('AI로 빈 칸 채우기', 'Fill empty slots with AI')}"${LX('를 누를 때만 써요. 실리태번 연결 프로필(Connection Manager)에서 골라요.', ' in the Lines tab. Pick from SillyTavern connection profiles (Connection Manager).')}</div>

  <div class="tw-cap">${LX('깨우기 버튼', 'Wake button')}</div>
  <div class="tw-row">
    <div class="tw-btn" data-act="bedreset">${LX('위치 처음으로', 'Reset position')}</div>
    <div class="tw-btn" data-act="bedfind">${LX('찾기 (화면 가운데로)', 'Find (move to center)')}</div>
  </div>
  <div id="tavvy-diag" class="tw-sub tw-diag"></div>

  <div class="tw-cap">${LX('내가 올린 외형', 'My uploaded looks')}</div>
  <div data-live="looks"></div>

  <div class="tw-cap">${LX('백업', 'Backups')} <span class="tw-sub">${LX('(하루 한 번 자동, 최근', '(automatic once a day, last')} ${BACKUP_KEEP}${LX('개)', ')')}</span></div>
  <div class="tw-row"><select data-live="backups" class="tw-grow"></select><div class="tw-btn" data-act="restore">${LX('되돌리기', 'Restore')}</div></div>
  <div class="tw-sub">${LX('되돌리면 모든 펫의 기록(먹은 양 등)이 그날 기록으로 바뀌어요.', 'Restoring replaces every pet’s records (food eaten, etc.) with that day’s.')}</div>
  <div class="tw-msg"></div>
</div>`;
}

function fillSettings() {
    const s = root.settings, box = win.body;
    box.querySelector('[data-s="lang"]').value = ['ko', 'en'].includes(s.lang) ? s.lang : 'auto';
    box.querySelector('[data-s="autoWake"]').checked = !!s.autoWake;
    box.querySelector('[data-s="stageMode"]').value = stageIsChat() ? 'chat' : 'floor';
    box.querySelector('[data-s="lineLedges"]').checked = s.lineLedges !== false;
    box.querySelector('[data-s="lineLedges"]').disabled = !stageIsChat();
    box.querySelector('[data-s="stroll"]').checked = s.stroll !== false;
    box.querySelector('[data-s="stroll"]').disabled = !stageIsChat();
    box.querySelector('[data-s="badge"]').checked = s.badge !== false;
    box.querySelector('[data-s="heartMode"]').value = s.heartMode || 'both';
    box.querySelector('[data-s="soundOn"]').checked = !!s.soundOn;
    box.querySelector('[data-s="replyOn"]').checked = !!s.replyOn;
    box.querySelector('.tw-replynote').textContent = replyLastNote ? `${LX('마지막 답 소리', 'Last reply sound')}: ${replyLastNote}` : '';   // 0.11.13
    for (const [k, on] of [['soundVol', s.soundOn], ['replyVol', s.replyOn]]) {   // 0.11.8: two volumes
        const vol = box.querySelector(`[data-s="${k}"]`);
        vol.value = volOf(k === 'replyVol' ? 'reply' : 'heart');
        vol.disabled = !on;
        box.querySelector(`[data-pct="${k}"]`).textContent = `${vol.value}%`;
    }
    box.querySelectorAll('[data-feel]').forEach(x => x.classList.toggle('on', x.dataset.feel === (s.soundFeel === 'soft' ? 'soft' : 'clear')));   // 0.11.19
    box.querySelectorAll('[data-theme-pick]').forEach(t => t.classList.toggle('tw-on', t.dataset.themePick === (THEMES[s.winTheme] ? s.winTheme : 'theme')));
    // connection profiles (only when SillyTavern's Connection Manager is there)
    const profiles = connectionProfiles();
    box.querySelectorAll('.tw-profrow').forEach(n => { n.hidden = !profiles; });
    if (profiles) {
        const sel = box.querySelector('[data-s="talkProfile"]');
        sel.innerHTML = LX('<option value="">지금 연결 그대로</option>', '<option value="">Current connection</option>') + profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join('');
        sel.value = profiles.some(p => p.id === s.talkProfile) ? s.talkProfile : '';
    }
}

/** Connection Manager profiles that can be used for a request, or null if it isn't available. */
function connectionProfiles() {
    try {
        const svc = ctx().ConnectionManagerRequestService;
        if (!svc || typeof svc.getSupportedProfiles !== 'function' || typeof svc.sendRequest !== 'function') return null;
        const list = svc.getSupportedProfiles();
        return Array.isArray(list) ? list.filter(p => p && p.id) : null;
    } catch { return null; }
}

function looksLiveHtml() {
    const looks = root?.looks || [];
    if (!looks.length) return LX('<div class="tw-sub">아직 없어요. 새 펫을 만들 때 그림을 올리면 여기 남아요.</div>', '<div class="tw-sub">None yet. Pictures you upload when making a pet are kept here.</div>');
    return looks.map(l => {
        const users = lookUsers(l);
        return `<div class="tw-lookrow">
  <div class="tw-av"><img src="${esc(imgUrl(l.roles?.idle?.[0]))}" alt=""></div>
  <div class="tw-card-main"><input class="tw-lookname" data-lname="${esc(l.id)}" maxlength="20" value="${esc(l.name)}" placeholder="${LX('이름 없음', 'No name')}"><span>${users.length ? LX(`${esc(users.map(p => p.name).join(', '))}${josa(users[users.length - 1].name, '이', '가').slice(users[users.length - 1].name.length)} 쓰는 중`, `Used by ${esc(users.map(p => p.name).join(', '))}`) : LX('쓰는 펫 없음', 'Not used by any pet')}</span></div>
  <div class="tw-btn tw-btn-small${users.length ? ' tw-btn-dim' : ''}" data-dellook="${esc(l.id)}">${LX('지우기', 'Delete')}</div>
</div>`;
    }).join('');
}

function backupsHtml() {
    const files = [...(root?.settings.backup?.files || [])].reverse();
    return files.length
        ? files.map(f => `<option value="${esc(f.day)}">${esc(f.day)} ${LX('· 펫', '· pets:')} ${Number(f.pets) || 0}${LX('마리', '')}</option>`).join('')
        : LX('<option value="">아직 백업이 없어요</option>', '<option value="">No backups yet</option>');
}

/* --- live parts (the pet may be eating while you look) --- */

function refreshWin() {
    if (!win?.open || !root) return;
    if (win.view === 'pet' && !root.pets.some(p => p.id === win.id)) return show('home');
    const p = win.view === 'pet' ? root.pets.find(x => x.id === win.id) : null;
    win.body.querySelectorAll('[data-live]').forEach(node => {
        const kind = node.dataset.live;
        let html;
        if (kind === 'home') html = homeLiveHtml();
        else if (kind === 'room') html = esc(roomNote());
        else if (kind === 'hero') html = heroHtml(p);
        else if (kind === 'move') html = moveHtml(p);
        else if (kind === 'journal') { if (win.tab !== 'journal') return; html = journalHtml(p); }
        else if (kind === 'acts') { if (win.tab !== 'acts') return; html = actsHtml(p); }
        else if (kind === 'looks') html = looksLiveHtml();
        else if (kind === 'backups') html = backupsHtml();
        else if (kind === 'newroom') html = esc(readOnly ? readOnlyReason : room ? LX('지금 열려 있는 채팅방이 이 펫의 집이 돼요.', 'The chat that’s open now becomes this pet’s home.') : LX('먼저 펫이 살 채팅방을 열어 주세요.', 'First open the chat where the pet will live.'));
        else return;
        if (node.dataset.html !== html) { node.innerHTML = html; node.dataset.html = html; }
    });
    if (win.view === 'pet') {
        const t = win.head.querySelector('.tw-title');
        if (p && t.textContent !== p.name) t.textContent = p.name;
    }
}

/* --- forms --- */

function drawLookGrid() {
    const grid = win.body.querySelector('.tw-lookgrid');
    if (!grid || !win.form) return;
    grid.innerHTML = lookGridHtml(win.form.look, win.form.kind === 'edit' ? win.form.base.look : null);
    const up = win.form.look === 'upload';
    win.body.querySelector('.tw-upload').hidden = !up;
    const opts = win.body.querySelector('.tw-uploadopts');
    if (opts) opts.hidden = !up;
}

function showSquish() {
    const v = Number(win.body.querySelector('[data-f="squish"]')?.value);
    const out = win.body.querySelector('.tw-squish-val');
    if (out) out.textContent = v <= 0 ? LX('(안 말랑)', '(firm)') : `(${Math.round(v * 100)}%)`;
}

function formDirty() {
    const f = win?.form;
    if (!f || !win.open) return false;
    const box = win.body;
    const val = (k) => box.querySelector(`[data-f="${k}"]`)?.value ?? '';
    if (f.kind === 'new') return !!val('name').trim() || !!f.look;
    if (f.kind !== 'edit') return false;
    if (talkDirty()) return true;
    const b = f.base;
    return f.look !== b.look || !!f.file
        || val('name') !== b.name || val('callme').trim() !== b.callMe || val('pers') !== b.pers || val('facing') !== b.facing
        || String(Number(val('squish'))) !== String(Number(b.squish));
}

function pickLook(key) {
    const f = win.form;
    if (!f) return;
    f.look = key;
    const box = win.body;
    const L = lookById(key);
    if (L) {
        box.querySelector('[data-f="facing"]').value = L.facing;
        box.querySelector('[data-f="squish"]').value = String(L.squish);
        showSquish();
        if (f.kind === 'new') {
            const nameEl = box.querySelector('[data-f="name"]');
            if (!nameEl.value.trim() || nameEl.value === f.autoName) { nameEl.value = L.name; f.autoName = L.name; }
        }
    }
    drawLookGrid();
}

/* ---------- 0.7.5: cut a picture by hand, or split a sheet into frames ---------- */

const CUT_GAP = 2;        // empty lines (on the small working copy) that separate two pictures on a sheet
const CUT_DUST = 0.03;    // a piece smaller than this share of the biggest one is a stray dot, not a picture
const CUT_WORK = 400;     // a sheet is looked at in this size (quick enough on phones)
const GRID_MAX = 8;

let cutter = null;

/**
 * Opens over the window. opts: { box (earlier cut), sheet (allow splitting), sheetOn, space (frames that still fit), done(cuts, sheet, extra) }.
 * done gets null for "the whole picture", or a list of { sx, sy, sw, sh, keep? } in the picture's own pixels.
 */
async function openCutter(file, opts = {}) {
    closeCutter();
    let im;
    try { im = await loadFileImage(file); } catch { return say(LX('그림을 읽지 못했어요.', 'Couldn’t read the picture.')); }
    if (!win?.open) return;
    const W = im.naturalWidth, H = im.naturalHeight, b = opts.box;
    const step = (k) => `<span class="tw-step"><b data-cutstep="${k}:-1">−</b><em data-cutval="${k}"></em><b data-cutstep="${k}:1">+</b></span>`;
    const el = document.createElement('div');
    el.className = 'tw-cut';
    el.innerHTML = `<b>${opts.sheet ? LX('자르기 · 나누기', 'Crop · split') : LX('직접 자르기', 'Crop by hand')}</b>
<div class="tw-sub">${LX('네모 모서리를 끌면 크기가, 안쪽을 끌면 자리가 바뀌어요. 바깥을 끌면 새로 그려요.', 'Drag a corner to resize, drag inside to move, drag outside to draw a new box.')}</div>
<div class="tw-cut-wrap"><div class="tw-cut-stage tw-checker"><canvas></canvas><div class="tw-cut-cells"></div>
  <div class="tw-cut-box"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div></div>
${opts.sheet ? `<div class="tw-seg"><span data-cutmode="one">${LX('한 장으로 자르기', 'Crop as one')}</span><span data-cutmode="sheet">${LX('여러 장으로 나누기', 'Split into several')}</span></div>
<div class="tw-cut-sheet">
  <div class="tw-seg"><span data-cuthow="auto">${LX('자동 찾기', 'Find automatically')}</span><span data-cuthow="grid">${LX('칸 수', 'Grid')}</span></div>
  <div class="tw-row tw-cut-grid">${LX('가로', 'Columns')} ${step('cols')} ${LX('× 세로', '× rows')} ${step('rows')}</div>
  <div class="tw-sub tw-cut-info"></div>
</div>` : ''}
<div class="tw-row tw-cut-btns"><div class="tw-btn tw-btn-small" data-cut="all">${LX('전체', 'All')}</div><span class="tw-grow"></span><div class="tw-btn" data-cut="no">${LX('취소', 'Cancel')}</div><div class="tw-btn tw-btn-main" data-cut="ok"></div></div>`;
    const keepScroll = win.body.scrollTop;
    win.box.classList.add('tw-cutting');
    win.box.appendChild(el);
    const cv = el.querySelector('canvas');
    const k0 = Math.min(1, 900 / Math.max(W, H));                     // the on-screen copy doesn't need to be huge
    cv.width = Math.max(1, Math.round(W * k0)); cv.height = Math.max(1, Math.round(H * k0));
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = Math.max(W, H) > 256;
    g.drawImage(im, 0, 0, cv.width, cv.height);
    if (Math.max(W, H) <= 256) cv.style.imageRendering = 'pixelated';
    const c = cutter = {
        el, im, W, H, opts, cv, keepScroll, space: opts.space || FRAMES_MAX, k: 1,
        box: b ? { x0: b.sx, y0: b.sy, x1: b.sx + b.sw, y1: b.sy + b.sh } : { x0: 0, y0: 0, x1: W, y1: H },
        sheet: !!opts.sheetOn, how: 'auto', cols: 2, rows: 1, cells: [], drag: null,
    };
    el.addEventListener('click', onCutClick);
    const stage = el.querySelector('.tw-cut-stage');
    stage.addEventListener('pointerdown', cutDown);
    stage.addEventListener('pointermove', cutMove);
    stage.addEventListener('pointerup', cutUp);
    stage.addEventListener('pointercancel', cutUp);
    if (typeof ResizeObserver === 'function') { c.ro = new ResizeObserver(() => fitCut()); c.ro.observe(el.querySelector('.tw-cut-wrap')); }
    if (c.sheet) findCells();
    fitCut();
}

function closeCutter() {
    const c = cutter;
    if (!c) return;
    cutter = null;
    c.ro?.disconnect();
    c.el.remove();
    if (win) {
        win.box.classList.remove('tw-cutting');
        win.body.scrollTop = c.keepScroll || 0;
    }
}

/** Size the picture to the space there is (small pixel art is blown up so the corners can be caught). */
function fitCut() {
    const c = cutter;
    if (!c) return;
    const wrap = c.el.querySelector('.tw-cut-wrap');
    const availW = Math.max(120, wrap.clientWidth);
    const availH = Math.max(160, (window.visualViewport?.height || window.innerHeight) * 0.46);
    const s = Math.min(availW / c.W, availH / c.H, 12);
    c.cv.style.width = Math.round(c.W * s) + 'px';
    c.cv.style.height = Math.round(c.H * s) + 'px';
    drawCut();
}

const cutRect = (c) => {
    const sx = Math.round(c.box.x0), sy = Math.round(c.box.y0);
    return { sx, sy, sw: Math.max(1, Math.round(c.box.x1) - sx), sh: Math.max(1, Math.round(c.box.y1) - sy) };
};

function drawCut() {
    const c = cutter;
    if (!c) return;
    const el = c.el, k = c.k = (c.cv.clientWidth / c.W) || 1;
    const px = (v) => Math.round(v * k) + 'px';
    const bx = el.querySelector('.tw-cut-box');
    Object.assign(bx.style, { left: px(c.box.x0), top: px(c.box.y0), width: px(c.box.x1 - c.box.x0), height: px(c.box.y1 - c.box.y0) });
    const sheet = !!(c.opts.sheet && c.sheet);
    const n = c.cells.length, use = Math.min(n, c.space);
    el.querySelector('.tw-cut-cells').innerHTML = sheet && !c.drag ? c.cells.map((p, i) => {
        const q = p.keep || p;
        return `<div class="${i >= c.space ? 'tw-cut-over' : ''}" style="left:${px(q.sx)};top:${px(q.sy)};width:${px(q.sw)};height:${px(q.sh)}"><span>${i + 1}</span></div>`;
    }).join('') : '';
    el.querySelectorAll('[data-cutmode]').forEach(s => s.classList.toggle('on', (s.dataset.cutmode === 'sheet') === sheet));
    el.querySelectorAll('[data-cuthow]').forEach(s => s.classList.toggle('on', s.dataset.cuthow === c.how));
    el.querySelectorAll('[data-cutval]').forEach(s => { s.textContent = c[s.dataset.cutval]; });
    const sh = el.querySelector('.tw-cut-sheet');
    if (sh) sh.hidden = !sheet;
    const grid = el.querySelector('.tw-cut-grid');
    if (grid) grid.hidden = c.how !== 'grid';
    const info = el.querySelector('.tw-cut-info');
    if (info) {
        const what = c.how === 'grid' ? LX('그림이 있는 칸', 'Cells with pictures') : LX('그림', 'Art');
        info.textContent = c.drag ? ''
            : !n ? (c.how === 'grid' ? LX('그림이 있는 칸이 없어요.', 'No cells with pictures.') : LX('나눌 그림을 못 찾았어요. 칸 수로 나눠 보세요.', 'Couldn’t find pictures to split. Try a grid.'))
            : n > c.space && c.space < Infinity ? LX(`${what} ${n}개를 찾았어요. 이 동작에는 ${c.space}장만 더 넣을 수 있어서 앞의 ${c.space}장만 넣어요.`, `Found ${n}. This action only has room for ${c.space} more, so only the first ${c.space} go in.`)
            : LX(`${what} ${n}개를 찾았어요. 왼쪽 → 오른쪽, 위 → 아래 순서로 들어가요.${c.how === 'auto' ? ' 잘못 나뉘면 칸 수로 해 보세요.' : ''}`, `Found ${n}. They go in left → right, top → bottom.${c.how === 'auto' ? ' If it splits wrong, try a grid.' : ''}`);
    }
    el.querySelector('[data-cut="ok"]').textContent = sheet ? `${LX('나누기 (', 'Split (')}${use}${LX('장)', ')')}` : LX('자르기', 'Crop');
}

function cutPoint(c, e) {
    const r = c.cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / c.k, y: (e.clientY - r.top) / c.k };
}

function cutDown(e) {
    const c = cutter;
    if (!c || c.drag) return;
    e.preventDefault();
    const pt = cutPoint(c, e), b = c.box;
    const h = e.target?.dataset?.h;
    const whole = b.x0 <= 0 && b.y0 <= 0 && b.x1 >= c.W && b.y1 >= c.H;      // nothing to move yet → draw a new one
    const inside = !whole && pt.x >= b.x0 && pt.x <= b.x1 && pt.y >= b.y0 && pt.y <= b.y1;
    c.drag = { id: e.pointerId, mode: h || (inside ? 'move' : 'new'), sx: pt.x, sy: pt.y, b: { ...b } };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not needed everywhere */ }
}

function cutMove(e) {
    const c = cutter, d = c?.drag;
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    const p = cutPoint(c, e), W = c.W, H = c.H;
    const m = Math.min(Math.max(4, 18 / c.k), W, H);                 // smallest box
    let { x0, y0, x1, y1 } = d.b;
    const dx = p.x - d.sx, dy = p.y - d.sy;
    if (d.mode === 'move') {
        const w = x1 - x0, h = y1 - y0;
        x0 = clamp(x0 + dx, 0, W - w); y0 = clamp(y0 + dy, 0, H - h); x1 = x0 + w; y1 = y0 + h;
    } else if (d.mode === 'new') {
        const ax = clamp(d.sx, 0, W), ay = clamp(d.sy, 0, H), bx = clamp(p.x, 0, W), by = clamp(p.y, 0, H);
        if (Math.abs(bx - ax) < m || Math.abs(by - ay) < m) return;      // too small yet → keep the old box
        x0 = Math.min(ax, bx); x1 = Math.max(ax, bx); y0 = Math.min(ay, by); y1 = Math.max(ay, by);
    } else {
        if (d.mode.includes('w')) x0 = clamp(x0 + dx, 0, x1 - m);
        if (d.mode.includes('e')) x1 = clamp(x1 + dx, x0 + m, W);
        if (d.mode.includes('n')) y0 = clamp(y0 + dy, 0, y1 - m);
        if (d.mode.includes('s')) y1 = clamp(y1 + dy, y0 + m, H);
    }
    c.box = { x0, y0, x1, y1 };
    drawCut();
}

function cutUp(e) {
    const c = cutter, d = c?.drag;
    if (!d || e.pointerId !== d.id) return;
    c.drag = null;
    const r = cutRect(c);
    c.box = { x0: r.sx, y0: r.sy, x1: r.sx + r.sw, y1: r.sy + r.sh };
    if (c.sheet) findCells();
    drawCut();
}

function onCutClick(e) {
    e.stopPropagation();                                              // the window's own buttons don't see these
    const c = cutter;
    if (!c) return;
    const t = e.target;
    const btn = t.closest('[data-cut]')?.dataset.cut;
    if (btn === 'no') return closeCutter();
    if (btn === 'ok') return cutOk();
    if (btn === 'all') c.box = { x0: 0, y0: 0, x1: c.W, y1: c.H };
    const md = t.closest('[data-cutmode]')?.dataset.cutmode;
    if (md) c.sheet = md === 'sheet';
    const hw = t.closest('[data-cuthow]')?.dataset.cuthow;
    if (hw) c.how = hw;
    const st = t.closest('[data-cutstep]')?.dataset.cutstep;
    if (st) { const [key, d] = st.split(':'); c[key] = clamp(c[key] + Number(d), 1, GRID_MAX); }
    if (!(btn || md || hw || st)) return;
    if (c.sheet) findCells();
    drawCut();
}

function cutOk() {
    const c = cutter;
    if (!c) return;
    const done = c.opts.done;
    if (c.opts.sheet && c.sheet) {
        if (!c.cells.length) return;
        const use = c.cells.slice(0, c.space);
        closeCutter();
        return done?.(use, true, c.cells.length - use.length);
    }
    const r = cutRect(c);
    const whole = r.sx === 0 && r.sy === 0 && r.sw === c.W && r.sh === c.H;
    closeCutter();
    done?.(whole ? null : [r], false, 0);
}

/** Which pixels of the box are picture (not background), on a small copy. */
function inkMask(im, b) {
    const s = Math.min(1, CUT_WORK / Math.max(b.sw, b.sh));
    const w = Math.max(1, Math.round(b.sw * s)), h = Math.max(1, Math.round(b.sh * s));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, b.sx, b.sy, b.sw, b.sh, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    // plain background? same reading of the edge as "배경 지우기"
    const edge = [];
    for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
    let clear = 0;
    for (const i of edge) if (d[i * 4 + 3] < 128) clear++;
    let bg = null;
    if (clear <= edge.length * 0.5) {
        const buckets = new Map();
        for (const i of edge) {
            const o = i * 4;
            if (d[o + 3] < 128) continue;
            const key = (d[o] >> 4) << 8 | (d[o + 1] >> 4) << 4 | (d[o + 2] >> 4);
            const q = buckets.get(key) || buckets.set(key, { n: 0, r: 0, g: 0, b: 0 }).get(key);
            q.n++; q.r += d[o]; q.g += d[o + 1]; q.b += d[o + 2];
        }
        let top = null;
        for (const q of buckets.values()) if (!top || q.n > top.n) top = q;
        if (top && top.n >= edge.length * 0.35) bg = [top.r / top.n, top.g / top.n, top.b / top.n];
    }
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        if (d[o + 3] <= 8) continue;
        if (bg && Math.max(Math.abs(d[o] - bg[0]), Math.abs(d[o + 1] - bg[1]), Math.abs(d[o + 2] - bg[2])) <= BG_TOL) continue;
        m[i] = 1;
    }
    return { m, w, h, s };
}

/** Runs of "something here" along a line, closed after CUT_GAP empty steps. */
function inkRuns(n, has) {
    const out = [];
    let st = -1, last = -1;
    for (let i = 0; i < n; i++) {
        if (has(i)) { if (st < 0) st = i; last = i; } else if (st >= 0 && i - last >= CUT_GAP) { out.push([st, last]); st = -1; }
    }
    if (st >= 0) out.push([st, last]);
    return out;
}

function findCells() {
    const c = cutter;
    if (!c) return;
    const b = cutRect(c);
    const mk = inkMask(c.im, b);
    c.cells = c.how === 'grid' ? gridCells(c, b, mk) : autoCells(c, b, mk);
}

/** Even grid over the box; cells with nothing in them are skipped. All cells are the same size. */
function gridCells(c, b, { m, w, s }) {
    const out = [], cw = b.sw / c.cols, ch = b.sh / c.rows;
    const sw = Math.max(1, Math.floor(cw)), sh = Math.max(1, Math.floor(ch));
    for (let r = 0; r < c.rows; r++) {
        for (let q = 0; q < c.cols; q++) {
            const sx = Math.round(b.sx + q * cw), sy = Math.round(b.sy + r * ch);
            const mx0 = Math.floor(q * cw * s), mx1 = Math.ceil((q + 1) * cw * s), my0 = Math.floor(r * ch * s), my1 = Math.ceil((r + 1) * ch * s);
            let ink = 0;
            for (let y = my0; y < my1; y++) for (let x = mx0; x < mx1 && x < w; x++) ink += m[y * w + x] || 0;
            if (ink >= Math.max(2, (mx1 - mx0) * (my1 - my0) * 0.002)) out.push({ sx, sy, sw, sh, row: r });
        }
    }
    return out;
}

/**
 * Finds the pictures by the empty space between them: rows first, then each row from left to right.
 * The pieces are then widened to one common size (bottom-centred) so the frames don't jump; what
 * that drags in from the neighbours is wiped later (keep).
 */
function autoCells(c, b, { m, w, h, s }) {
    const rowHas = (y) => { for (let x = 0; x < w; x++) if (m[y * w + x]) return true; return false; };
    let pieces = [], row = -1;
    for (const [ya, yb] of inkRuns(h, rowHas)) {
        row++;
        const colHas = (x) => { for (let y = ya; y <= yb; y++) if (m[y * w + x]) return true; return false; };
        for (const [xa, xb] of inkRuns(w, colHas)) {
            let ty0 = yb, ty1 = ya;
            for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if (m[y * w + x]) { if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
            pieces.push({ x: xa, y: ty0, w: xb - xa + 1, h: ty1 - ty0 + 1, row });
        }
    }
    const big = Math.max(0, ...pieces.map(p => p.w * p.h));
    pieces = pieces.filter(p => p.w * p.h >= big * CUT_DUST);
    const nat = pieces.map((p) => {
        const sx = clamp(Math.floor(b.sx + p.x / s), 0, c.W - 1), sy = clamp(Math.floor(b.sy + p.y / s), 0, c.H - 1);
        const ex = clamp(Math.ceil(b.sx + (p.x + p.w) / s), sx + 1, c.W), ey = clamp(Math.ceil(b.sy + (p.y + p.h) / s), sy + 1, c.H);
        return { sx, sy, sw: ex - sx, sh: ey - sy, row: p.row };
    });
    if (nat.length < 2) return nat;
    const Wm = Math.max(...nat.map(p => p.sw)), Hm = Math.max(...nat.map(p => p.sh));
    return nat.map((p) => ({
        sx: clamp(Math.round(p.sx + p.sw / 2 - Wm / 2), 0, c.W - Wm),
        sy: clamp(p.sy + p.sh - Hm, 0, c.H - Hm),
        sw: Wm, sh: Hm, keep: p, row: p.row,
    }));
}

async function onFilePicked(input) {
    const f = win.form;
    if (!f) return;
    f.file = input.files?.[0] || null;
    f.cut = null;                                        // a new picture starts uncut
    win.body.querySelector('.tw-filename').textContent = f.file ? f.file.name : LX('아직 안 골랐어요', 'Nothing chosen yet');
    return redoUploadPreview();
}

/** 0.10.4: close the "새로 올리기" box — forget the picked picture, go back to the look picked before. */
function cancelUpload() {
    const f = win.form;
    if (!f) return;
    f.file = null; f.prep = null; f.cut = null;
    const box = win.body;
    const input = box.querySelector('[data-f="file"]');
    if (input) input.value = '';
    box.querySelector('.tw-filename').textContent = LX('아직 안 골랐어요', 'Nothing chosen yet');
    box.querySelector('.tw-prevrow').hidden = true;
    const note = box.querySelector('.tw-cutnote');
    if (note) note.textContent = '';
    if (f.kind === 'edit') {
        f.look = f.base.look;
        box.querySelector('[data-f="facing"]').value = f.base.facing;
        box.querySelector('[data-f="squish"]').value = f.base.squish;
        showSquish();
    } else f.look = null;
    drawLookGrid();
}

/** Make the upload preview again with the current switches (and the hand cut, if any). */
async function redoUploadPreview() {
    const f = win.form;
    if (!f) return;
    f.prep = null;
    const box = win.body;
    const row = box.querySelector('.tw-prevrow');
    if (!f.file) { row.hidden = true; return; }
    const file = f.file, cut = f.cut;
    const note = box.querySelector('.tw-cutnote');
    if (note) note.textContent = cut ? LX('직접 자른 부분만 써요', 'Only the part you cropped is used') : '';
    try {
        const out = await preparePng(file, box.querySelector('[data-f="crop"]').checked, bgTolOf(''), cut);
        if (win.form !== f || f.file !== file || f.cut !== cut) return;
        f.prep = out;
        box.querySelector('.tw-prev').src = out.dataUrl;
        row.hidden = false;
    } catch {
        if (win.form === f && f.file === file) { say(LX('그림을 읽지 못했어요. 다른 그림(PNG·JPG)을 골라 주세요.', 'Couldn’t read the picture. Choose another one (PNG · JPG).')); row.hidden = true; }
    }
}

/** Upload the chosen picture and keep it in the look library. Returns the new look. */
async function uploadLook(name, facing, squish) {
    const f = win.form;
    if (!f.file) throw new Error(LX('그림을 골라 주세요.', 'Choose a picture.'));
    if (f.file.size > 8 * 1024 * 1024) throw new Error(LX('그림이 너무 커요 (8MB 이하).', 'The picture is too big (8 MB max).'));
    say(LX('그림 올리는 중…', 'Uploading picture…'));
    const img = f.prep || await preparePng(f.file, win.body.querySelector('[data-f="crop"]').checked, bgTolOf(''), f.cut);
    const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const path = await uploadFile(`tavvy_look_${id}.png`, img.base64);
    return { id, name, kind: 'single', facing, squish, roles: { idle: [path] }, roleOpts: {}, baseline: 0, createdAt: Date.now() };
}

function formValues() {
    const box = win.body;
    const v = (k) => box.querySelector(`[data-f="${k}"]`)?.value ?? '';
    return {
        name: v('name').trim(),
        callMe: v('callme').trim().slice(0, 20),
        pers: PERSONALITIES[v('pers')] ? v('pers') : 'aegyo',
        facing: ['front', 'left', 'right'].includes(v('facing')) ? v('facing') : 'front',
        squish: Math.round(clamp(Number(v('squish')) || 0, 0, 1) * 10) / 10,
    };
}

let busy = false;

async function saveEdit() {
    if (busy || win.form?.kind !== 'edit') return;
    if (readOnly) return say(readOnlyReason);
    if (!ready) return say(LX('실리태번이 아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요.', 'SillyTavern is still getting ready. Try again in a moment.'));
    const p = root.pets.find(x => x.id === win.form.id);
    if (!p) return;
    const v = formValues();
    if (!v.name) return say(LX('이름을 적어 주세요.', 'Enter a name.'));
    if (!formDirty()) return say(LX('바뀐 게 없어요.', 'Nothing changed.'));
    const f = win.form;
    if (f.look === 'upload' && !f.file) return say(LX('올릴 PNG 그림을 골라 주세요.', 'Choose a PNG picture to upload.'));
    busy = true;
    let added = null;
    try {
        let look = null;
        if (f.look === 'upload') {
            added = await uploadLook(v.name, v.facing, v.squish);
            look = { kind: 'single', roles: structuredClone(added.roles), roleOpts: {}, baseline: 0 };
        } else if (f.look !== f.base.look) {
            look = lookById(f.look)?.make() || null;
        }
        if (added) root.looks.push(added);
        const oldFiles = look ? petFiles(p) : [];
        p.name = v.name;
        p.callMe = v.callMe;
        p.personality = { ...(p.personality || {}), base: v.pers };
        if (look) { p.look.roles = look.roles; p.look.roleOpts = look.roleOpts || {}; p.look.kind = look.kind; p.look.baseline = look.baseline; }
        p.look.facing = v.facing;
        p.look.squish = v.squish;
        const ok = await saveNow();
        if (!ok) saveSoon();
        // pictures only this pet had (e.g. added to a built-in look) and nothing uses any more
        if (ok) for (const file of oldFiles) { if (!fileInUse(file)) deleteFile(file); }
        for (const a of actors) if (a.rec === p) { a.p = PERSONALITIES[v.pers]; if (look) a.reloadLook(); }
        refreshBed();
        renderPanel();
        if (win.view === 'pet' && win.id === p.id) { fillEdit(p); win.body.querySelector('.tw-filename').textContent = LX('아직 안 골랐어요', 'Nothing chosen yet'); win.body.querySelector('.tw-prevrow').hidden = true; }
        say(ok ? LX('저장했어요.', 'Saved.') : LX('바꿨지만 저장이 늦어지고 있어요. 잠시 뒤 다시 저장돼요.', 'Changed, but saving is slow. It’ll save again shortly.'));
    } catch (e) {
        console.error('[Tavvy] edit failed', e);
        if (added) { root.looks = root.looks.filter(l => l !== added); lookFiles(added).forEach(deleteFile); }
        say(LX('저장하지 못했어요: ', 'Couldn’t save: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

async function createPet() {
    if (busy || win.form?.kind !== 'new') return;
    if (readOnly) return say(readOnlyReason);
    if (!ready) return say(LX('실리태번이 아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요.', 'SillyTavern is still getting ready. Try again in a moment.'));
    if (!room) return say(LX('먼저 펫이 살 채팅방을 열어 주세요.', 'First open the chat where the pet will live.'));
    const f = win.form;
    if (!f.look) return say(LX('외형을 골라 주세요.', 'Choose a look.'));
    const v = formValues();
    if (!v.name) return say(LX('이름을 적어 주세요.', 'Enter a name.'));
    if (f.look === 'upload' && !f.file) return say(LX('올릴 PNG 그림을 골라 주세요.', 'Choose a PNG picture to upload.'));
    busy = true;
    let added = null;
    try {
        let look;
        if (f.look === 'upload') {
            added = await uploadLook(v.name, v.facing, v.squish);
            look = { kind: 'single', facing: v.facing, roles: structuredClone(added.roles), roleOpts: {}, baseline: 0, size: { ...DEFAULT_SIZE }, squish: v.squish };
        } else {
            look = lookById(f.look)?.make();
            if (!look) return say(LX('외형을 다시 골라 주세요.', 'Choose a look again.'));
        }
        const rec = newPetRecord({ id: newId(), name: v.name, personality: v.pers, look });
        rec.home = homeOf(room);
        root.pets.push(rec);
        if (added) root.looks.push(added);
        const ok = await saveNow();
        if (!ok && readOnly) {
            root.pets.pop();
            if (added) { root.looks.pop(); lookFiles(added).forEach(deleteFile); }
            return say(readOnlyReason);
        }
        if (!ok) saveSoon();
        refreshBed();
        renderPanel();
        win.form = null;
        show('pet', { id: rec.id });
        say(ok ? LX(`${josa(v.name, '이', '가')} 이 방에 왔어요! 🛏️ 버튼을 눌러 깨워 보세요.`, `${v.name} is here! Press the 🛏️ button to wake it.`) : LX('만들었지만 저장이 늦어지고 있어요. 잠시 뒤 다시 저장돼요.', 'Created, but saving is slow. It’ll save again shortly.'));
    } catch (e) {
        console.error('[Tavvy] create failed', e);
        if (added) lookFiles(added).forEach(deleteFile);
        say(LX('펫을 만들지 못했어요: ', 'Couldn’t create the pet: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

async function deletePet(id) {
    if (readOnly) return say(readOnlyReason);
    const i = root.pets.findIndex(p => p.id === id);
    if (i < 0) return;
    const pet = root.pets[i];
    if (!(await confirmBox(LX(`${josa(pet.name, '과', '와')} 작별할까요? 함께한 기록도 모두 사라져요. 되돌릴 수 없어요.`, `Say goodbye to ${pet.name}? All its records will be gone. This can’t be undone.`)))) return;
    for (const a of [...actors]) if (a.rec === pet) { a.onGone = null; a.vanish(); }
    root.pets.splice(i, 1);
    for (const k of Object.keys(root.duets || {})) if (k.split('+').includes(pet.id)) delete root.duets[k];   // 0.10.8: its talks with others
    const ok = await saveNow();
    // files only after the record is safely saved, and only ones nothing else uses (saved looks stay)
    if (ok) for (const f of petFiles(pet)) { if (!fileInUse(f)) deleteFile(f); }
    else saveSoon();
    refreshBed();
    renderPanel();
    if (win?.open) { win.form = null; show('bye', { name: pet.name }); }   // 0.10.3: a page that says it's done
}

async function deleteLook(id) {
    if (readOnly) return say(readOnlyReason);
    const l = (root.looks || []).find(x => x.id === id);
    if (!l) return;
    const users = lookUsers(l);
    if (users.length) {
        const n = users.map(p => p.name).join(', ');
        return say(LX(`${n}${josa(users[users.length - 1].name, '이', '가').slice(users[users.length - 1].name.length)} 입고 있어서 지울 수 없어요. 그 펫의 외형을 바꾸거나 작별하면 지울 수 있어요.`, `${n} is using it, so it can’t be deleted. Change that pet’s look or say goodbye first.`));
    }
    if (!(await confirmBox(LX(`"${l.name}" 외형을 지울까요? 그림 파일도 함께 지워져요.`, `Delete the look "${l.name}"? Its picture files will be deleted too.`)))) return;
    root.looks = root.looks.filter(x => x !== l);
    // 0.10.4: the screen changes right away; saving to SillyTavern (can take seconds on a phone) carries on behind it
    if (win?.form && win.form.look === 'lib:' + l.id) {   // it was picked in an open form
        win.form.look = win.form.kind === 'edit' ? win.form.base.look : null;
    }
    if (win?.form) drawLookGrid();
    refreshWin();
    say(LX('외형을 지웠어요.', 'Look deleted.'));
    saveNow().then((ok) => {   // picture files go only once the record is safely saved
        if (ok) { for (const f of lookFiles(l)) { if (!fileInUse(f)) deleteFile(f); } }
        else saveSoon();
    });
}

/** 0.10.3: give a saved look another name (pets wearing it keep their own names). */
function renameLook(id, v) {
    if (readOnly) return say(readOnlyReason);
    const l = (root.looks || []).find(x => x.id === id);
    if (!l) return;
    const name = String(v || '').trim().slice(0, 20);
    if (name && name !== l.name) { l.name = name; saveSoon(); }
    setTimeout(refreshWin, 0);   // not while the box is still losing focus (redrawing it then throws)
}

/* ---------- moving, copying, pet files and PNG cards (7단계) ---------- */

/** On a pet's page: bring a pet that lives in another room into this one, or copy it here. */
function moveHtml(p) {
    if (!p || !room || readOnly || checkHome(p, room).here) return '';
    return `<div class="tw-movebox">
  <div class="tw-sub">${p.home ? LX('다른 방에 사는 펫이에요.', 'This pet lives in another room.') : LX('집이 없는 펫이에요.', 'This pet has no home.')}</div>
  <div class="tw-row"><div class="tw-btn tw-btn-main" data-act="movehere"><i class="fa-solid fa-house"></i> ${LX('이 방으로 데려오기', 'Bring to this room')}</div>
  <div class="tw-btn" data-act="clonehere"><i class="fa-solid fa-clone"></i> ${LX('이 방에 복제', 'Copy into this room')}</div></div>
  <label class="tw-check"><input type="checkbox" data-f="clonerec"> ${LX('복제할 때 기록·친밀도도 함께 복사', 'Copy records and closeness too')}</label>
</div>`;
}

async function movePetHere(id) {
    if (readOnly) return say(readOnlyReason);
    if (busy) return;
    const p = root.pets.find(x => x.id === id);
    if (!p || !room) return say(LX('먼저 데려올 채팅방을 열어 주세요.', 'First open the chat to bring it to.'));
    if (checkHome(p, room).here) return;
    if (!(await confirmBox(LX(`${josa(p.name, '을', '를')} 이 방으로 데려올까요? 원래 방에서는 사라져요. 기록과 친밀도는 그대로예요.`, `Bring ${p.name} to this room? It leaves its old room. Records and closeness stay.`)))) return;
    const before = p.home;
    p.home = homeOf(room);
    prevVisit.set(p.id, p.lastVisit);
    p.lastVisit = Date.now();
    const ok = await saveNow();
    if (!ok && readOnly) { p.home = before; renderPanel(); return say(readOnlyReason); }
    if (!ok) saveSoon();
    refreshBed();
    renderPanel();
    say(LX(`${josa(p.name, '이', '가')} 이 방으로 왔어요! 🛏️ 버튼을 눌러 깨워 보세요.`, `${p.name} moved here! Press the 🛏️ button to wake it.`));
}

/** The parts of a pet that make it "that pet" (look, personality, lines, special days). */
function petCore(p) {
    return {
        name: p.name,
        look: structuredClone(p.look),
        personality: structuredClone(p.personality),
        lines: structuredClone(p.lines || {}),
        talkFreq: p.talkFreq,
        moves: movesOf(p),
        off: [...(p.off || [])],
        freq: structuredClone(p.freq || {}),
        pace: p.pace || 'norm',
        screenRest: restOf(p),
        acts090: true,
        dates: structuredClone(p.dates || []).map(d => ({ ...d, id: 'd' + Math.random().toString(36).slice(2, 9) })),
        metOn: p.metOn,
        sounds: structuredClone(p.sounds || {}),
    };
}

async function clonePetHere(id, withRecords) {
    if (readOnly) return say(readOnlyReason);
    if (busy) return;
    const p = root.pets.find(x => x.id === id);
    if (!p || !room) return say(LX('먼저 복제할 채팅방을 열어 주세요.', 'First open the chat to copy it into.'));
    const what = withRecords ? LX('기록·친밀도까지 똑같이', 'with the same records and closeness') : LX('기록은 처음부터 새로', 'with fresh records');
    if (!(await confirmBox(LX(`${josa(p.name, '을', '를')} 이 방에 한 마리 더 만들까요? (${what}) 원래 펫은 그대로 있어요.`, `Make another ${p.name} in this room (${what})? The original stays where it is.`)))) return;
    let rec;
    if (withRecords) {
        rec = structuredClone(p);
        rec.dates = petCore(p).dates;
        rec.celebrated = p.celebrated?.met ? { met: p.celebrated.met } : {};
    } else {
        const c = petCore(p);
        rec = newPetRecord({ id: '', name: c.name, personality: 'aegyo', look: c.look });
        Object.assign(rec, c);
    }
    rec.id = newId();
    rec.home = homeOf(room);
    rec.bowl = { me: 0, them: 0, tokens: 0 };      // food waiting belongs to the old room
    rec.lastVisit = Date.now();
    root.pets.push(rec);
    const ok = await saveNow();
    if (!ok && readOnly) { root.pets.pop(); renderPanel(); return say(readOnlyReason); }
    if (!ok) saveSoon();
    refreshBed();
    renderPanel();
    show('pet', { id: rec.id });
    say(LX(`이 방에도 ${josa(rec.name, '이', '가')} 생겼어요! 🛏️ 버튼을 눌러 깨워 보세요.`, `Now there’s a ${rec.name} here too! Press the 🛏️ button to wake it.`));
}

/* --- files --- */

const PET_FILE = 'tavvy-pet';
const CARD_KEY = 'tavvy';
const IMPORT_MAX = 40 * 1024 * 1024;
const DATA_IMG = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function blobToDataUrl(blob) {
    return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(blob); });
}

async function fileToDataUrl(path) {
    const res = await fetch(imgUrl(path), { cache: 'no-store' });
    if (!res.ok) throw new Error(LX('그림을 읽지 못했어요 (', 'Couldn’t read the picture (') + res.status + ')');
    return blobToDataUrl(await res.blob());
}

/** Picture lists with every picture packed in: { roles: { idle: [0, 1] }, files: [dataUrl…] }. builtin pictures stay as they are unless `packBuiltin`. */
async function packRoles(roles, packBuiltin) {
    const files = [], index = new Map(), out = {};
    for (const [k, list] of Object.entries(roles || {})) {
        if (!Array.isArray(list)) continue;
        out[k] = [];
        for (const path of list) {
            if (typeof path !== 'string' || !path) continue;
            if (path.startsWith('builtin:') && !packBuiltin) { out[k].push(path); continue; }
            if (!index.has(path)) { index.set(path, files.length); files.push(await fileToDataUrl(path)); }
            out[k].push(index.get(path));
        }
    }
    return { roles: out, files };
}

function safeName(name) {
    return String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 20) || 'pet';
}

function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

const lookShape = (l) => ({ kind: l.kind, facing: l.facing, roleOpts: structuredClone(l.roleOpts || {}), baseline: l.baseline || 0, size: structuredClone(l.size || DEFAULT_SIZE), squish: l.squish ?? 0.5 });

async function exportPetFile(id) {
    const p = root?.pets.find(x => x.id === id);
    if (!p || busy) return;
    busy = true;
    try {
        say(LX('펫 파일 만드는 중…', 'Making pet file…'));
        const { roles, files } = await packRoles(p.look?.roles, false);
        const pet = structuredClone(p);
        delete pet.home;                      // which room it lives in stays here (room names can hold names and dates)
        delete pet.bowl;                      // food waiting belongs to that room
        delete pet.places;                    // 0.10.9 함께한 곳 stays here too (it remembers rooms)
        pet.sounds = {};                      // 0.10.6 내 소리: packed in too (a file that can't be read is left out)
        for (const [k] of SOUND_SLOTS) {
            const path = p.sounds?.[k];
            if (typeof path !== 'string') continue;
            try { files.push(await fileToDataUrl(path)); pet.sounds[k] = { file: files.length - 1 }; } catch { /* skip */ }
        }
        pet.look = { ...lookShape(p.look || {}), roles };
        pet.gifts = [];                       // 0.10.0 선물: pictures packed in too
        for (const g of p.gifts || []) {
            if (typeof g?.src !== 'string') continue;
            files.push(await fileToDataUrl(g.src));
            pet.gifts.push({ name: g.name || '', ...(g.memo ? { memo: g.memo } : {}), ...(g.fav ? { fav: true } : {}), size: g.size || 'm', at: g.at || 0, file: files.length - 1 });
        }
        const data = { [PET_FILE]: 1, formatVersion: FORMAT_VERSION, pet, files };
        download(`tavvy_${safeName(p.name)}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
        say(LX('펫 파일을 내려받았어요.', 'Pet file downloaded.'));
    } catch (e) {
        console.error('[Tavvy] export failed', e);
        say(LX('펫 파일을 만들지 못했어요: ', 'Couldn’t make the pet file: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

/* PNG chunks: the card is the pet's picture with a tEXt chunk "tavvy" (base64 JSON) before IEND. */
let crcTable = null;
function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const isPng = (b) => b.length > 8 && PNG_SIG.every((v, i) => b[i] === v);

function pngChunks(b) {
    const out = [];
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let o = 8;
    while (o + 12 <= b.length) {
        const len = dv.getUint32(o);
        const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
        if (o + 12 + len > b.length) break;
        out.push({ type, start: o, data: b.subarray(o + 8, o + 8 + len) });
        o += 12 + len;
        if (type === 'IEND') break;
    }
    return out;
}

function addTextChunk(png, key, text) {
    const body = new Uint8Array(key.length + 1 + text.length);
    for (let i = 0; i < key.length; i++) body[i] = key.charCodeAt(i);
    for (let i = 0; i < text.length; i++) body[key.length + 1 + i] = text.charCodeAt(i);   // base64 → plain ASCII
    const typed = new Uint8Array(4 + body.length);
    typed.set([116, 69, 88, 116]);           // "tEXt"
    typed.set(body, 4);
    const chunk = new Uint8Array(12 + body.length);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, body.length);
    chunk.set(typed, 4);
    dv.setUint32(8 + body.length, crc32(typed));
    const iend = pngChunks(png).find(c => c.type === 'IEND');
    if (!iend) throw new Error(LX('PNG 모양이 이상해요', 'The PNG looks wrong'));
    const out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, iend.start));
    out.set(chunk, iend.start);
    out.set(png.subarray(iend.start), iend.start + chunk.length);
    return out;
}

function readTextChunk(png, key) {
    for (const c of pngChunks(png)) {
        if (c.type !== 'tEXt') continue;
        const z = c.data.indexOf(0);
        if (z < 0 || String.fromCharCode(...c.data.subarray(0, z)) !== key) continue;
        let s = '';
        for (let i = z + 1; i < c.data.length; i += 8192) s += String.fromCharCode(...c.data.subarray(i, Math.min(c.data.length, i + 8192)));
        return s;
    }
    return null;
}

const utf8ToB64 = (str) => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };
const b64ToUtf8 = (b64) => { const s = atob(b64); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new TextDecoder().decode(b); };

const CARD_MAX = 512;   // px — the card picture's longer side

async function exportPetCard(id) {
    const p = root?.pets.find(x => x.id === id);
    if (!p || busy) return;
    busy = true;
    try {
        say(LX('PNG 카드 만드는 중…', 'Making PNG card…'));
        const { roles, files } = await packRoles(p.look?.roles, true);
        const look = { ...lookShape(p.look || {}), roles };
        delete look.size;                     // size is the person's own screen choice
        const text = utf8ToB64(JSON.stringify({ [CARD_KEY]: 1, formatVersion: FORMAT_VERSION, look, files }));
        // the card picture: the pet's own main picture
        const img = await loadImage(files[roles.idle?.[0] ?? 0] || imgUrl(p.look?.roles?.idle?.[0]));
        const k = Math.min(1, CARD_MAX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round((img.naturalWidth || 1) * k));
        cv.height = Math.max(1, Math.round((img.naturalHeight || 1) * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
        if (!blob) throw new Error(LX('그림을 만들지 못했어요', 'Couldn’t make the picture'));
        const png = addTextChunk(new Uint8Array(await blob.arrayBuffer()), CARD_KEY, text);
        download(`tavvy_${safeName(p.name)}_card.png`, new Blob([png], { type: 'image/png' }));
        say(LX('PNG 카드를 내려받았어요.', 'PNG card downloaded.'));
    } catch (e) {
        console.error('[Tavvy] card failed', e);
        say(LX('PNG 카드를 만들지 못했어요: ', 'Couldn’t make the PNG card: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

/* --- reading a file back in --- */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);

/** Upload packed pictures and rebuild the picture lists. Returns { roles, uploaded } — or throws. */
async function unpackRoles(roles, files, tag) {
    if (!isObj(roles) || !Array.isArray(files)) throw new Error(LX('그림 정보가 없어요', 'No picture data'));
    const uploaded = [], paths = new Map(), out = {};
    try {
        for (const [k, list] of Object.entries(roles)) {
            if (!/^[a-zA-Z0-9_]{1,30}$/.test(k) || !Array.isArray(list)) continue;
            const got = [];
            for (const it of list.slice(0, FRAMES_MAX)) {
                if (typeof it === 'string') {
                    const m = /^builtin:([a-z]+)\/([a-z0-9_]+\.png)$/.exec(it);
                    if (m && BUILTIN[m[1]]) got.push(it);
                    continue;
                }
                if (!Number.isInteger(it) || typeof files[it] !== 'string' || !DATA_IMG.test(files[it])) continue;
                if (!paths.has(it)) {
                    const [, ext] = /^data:image\/(\w+);/.exec(files[it]);
                    const path = await uploadFile(`tavvy_${tag}_${uploaded.length}.${ext === 'jpeg' ? 'jpg' : ext}`, files[it].split(',')[1]);
                    uploaded.push(path);
                    paths.set(it, path);
                }
                got.push(paths.get(it));
            }
            if (got.length) out[k] = got;
        }
    } catch (e) {
        uploaded.forEach(deleteFile);
        throw e;
    }
    if (!out.idle?.length) { uploaded.forEach(deleteFile); throw new Error(LX('기본 그림이 없어요', 'No basic picture')); }
    return { roles: out, uploaded };
}

function cleanLook(l, roles) {
    const roleOpts = {};
    if (isObj(l.roleOpts)) for (const [k, v] of Object.entries(l.roleOpts)) if (roles[k] && isObj(v)) roleOpts[k] = structuredClone(v);
    return {
        kind: Object.values(roles).some(x => x.length > 1) ? 'frames' : 'single',
        facing: ['front', 'left', 'right'].includes(l.facing) ? l.facing : 'front',
        roles, roleOpts,
        baseline: num(l.baseline),
        size: { ...DEFAULT_SIZE },
        squish: Math.min(1, num(l.squish, 0.5)),
    };
}

const strList = (v, max) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.slice(0, LINE_MAX)).slice(0, max) : []);

/** A pet from a pet file, checked field by field. */
function cleanPet(src, look) {
    const rec = newPetRecord({ id: newId(), name: String(src.name || '').trim().slice(0, 20) || LX('펫', 'Pets'), personality: PERSONALITIES[src.personality?.base] ? src.personality.base : 'aegyo', look });
    if (Array.isArray(src.personality?.traits)) rec.personality.traits = src.personality.traits.filter(x => typeof x === 'string').slice(0, 10);
    if (isObj(src.lines)) for (const [k, v] of Object.entries(src.lines)) if (/^[a-zA-Z]{1,20}$/.test(k)) { const l = strList(v, 30); if (l.length) rec.lines[k] = l; }
    if (TALK_FREQ[src.talkFreq]) rec.talkFreq = src.talkFreq;
    if (typeof src.callMe === 'string') rec.callMe = src.callMe.trim().slice(0, 20);
    if (Object.hasOwn(CHAT_VOICES, src.chatVoice ?? '')) rec.chatVoice = src.chatVoice;
    if (Object.hasOwn(HEART_SOUNDS, src.heartSound ?? '')) rec.heartSound = src.heartSound;
    src = { ...src, off: Array.isArray(src.off) ? [...src.off] : src.off, freq: isObj(src.freq) ? { ...src.freq } : src.freq };
    splitScreen(src);                                   // a pet file from before 0.8.2
    splitFidget(src);                                   // …and before 0.9.0
    rec.moves = movesOf(src);
    const actKey = (k) => BASIC_ACTS.some(b => b.key === k) || UNLOCKS.some(u => u.key === k) || isPres(k);
    if (Array.isArray(src.off)) rec.off = src.off.filter(actKey);
    if (isObj(src.freq)) for (const [k, v] of Object.entries(src.freq)) {
        if (actKey(k) && (v === 'rare' || v === 'often')) rec.freq[k] = v;
        else if ((isAtt(k) || isPres(k)) && FREQ_X[v]) rec.freq[k] = v;   // 0.9.0 attitudes / 0.10.0 선물 (보통 is stored too)
    }
    if (PACES.some(x => x[0] === src.pace)) rec.pace = src.pace;
    if (RESTS.some(x => x[0] === src.screenRest)) rec.screenRest = src.screenRest;
    if (isObj(src.personality?.react)) for (const m of REACT_MOMENTS) if (PERSONALITIES[src.personality.react[m.key]]) rec.personality.react[m.key] = src.personality.react[m.key];
    if (Array.isArray(src.dates)) {
        rec.dates = src.dates.filter(d => isObj(d) && /^\d\d-\d\d$/.test(d.md)).slice(0, 30)
            .map(d => ({ id: 'd' + Math.random().toString(36).slice(2, 9), kind: String(d.kind || 'other').slice(0, 20), md: d.md, msg: String(d.msg || '').slice(0, LINE_MAX) }));
    }
    if (typeof src.metOn === 'boolean') rec.metOn = src.metOn;
    if (num(src.createdAt) > 0 && src.createdAt <= Date.now()) rec.createdAt = src.createdAt;
    for (const k of ['me', 'them', 'tokens']) rec.eaten[k] = num(src.eaten?.[k]);
    rec.pats.score = num(src.pats?.score);
    if (typeof src.pats?.lastDay === 'string') rec.pats.lastDay = src.pats.lastDay;
    if (isObj(src.today) && typeof src.today.day === 'string') rec.today = { day: src.today.day, eaten: num(src.today.eaten), full: !!src.today.full, tokens: num(src.today.tokens) };
    if (isObj(src.celebrated)) for (const [k, v] of Object.entries(src.celebrated)) if (typeof v === 'string' && k === 'met') rec.celebrated.met = v;
    const j = src.journal;
    if (isObj(j)) {
        rec.journal.talkDays = num(j.talkDays);
        if (typeof j.lastTalkDay === 'string') rec.journal.lastTalkDay = j.lastTalkDay;
        if (isObj(j.best) && /^\d{4}-\d\d-\d\d$/.test(j.best.day) && num(j.best.tokens) > 0) rec.journal.best = { day: j.best.day, tokens: num(j.best.tokens), n: num(j.best.n) };
        if (Array.isArray(j.moments)) rec.journal.moments = j.moments.filter(isObj).slice(0, 200).map(m => structuredClone(m));
    }
    for (const k of Object.keys(src)) if (rec[k] === undefined && k !== 'home' && k !== 'bowl' && k !== 'gifts') { try { rec[k] = structuredClone(src[k]); } catch { /* skip */ } }   // things from a newer Tavvy stay
    return rec;
}

async function importPicked(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (readOnly) return say(readOnlyReason);
    if (busy) return;
    if (file.size > IMPORT_MAX) return say(LX('파일이 너무 커요 (40MB 이하).', 'The file is too big (40 MB max).'));
    busy = true;
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isPng(bytes)) {
            const text = readTextChunk(bytes, CARD_KEY);
            if (!text) return say(LX('이 그림에는 Tavvy 카드 정보가 없어요. 메신저 등을 거치며 지워졌을 수 있어요. 그냥 그림으로 쓰려면 "새 펫 만들기"에서 올려 주세요.', 'This image has no Tavvy card data. A messenger may have stripped it. To use it as a plain picture, upload it from "New pet".'));
            let data;
            try { data = JSON.parse(b64ToUtf8(text)); } catch { return say(LX('카드 정보를 읽지 못했어요.', 'Couldn’t read the card data.')); }
            return await importCard(data);
        }
        let data;
        try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { return say(LX('Tavvy 펫 파일이 아니에요.', 'Not a Tavvy pet file.')); }
        return await importPetFile(data);
    } catch (e) {
        console.error('[Tavvy] import failed', e);
        say(LX('불러오지 못했어요: ', 'Couldn’t import: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

/** 0.10.0 선물 from a pet file: each picture goes up as a file of its own (paths added to `uploaded`). */
async function unpackGifts(list, files, uploaded) {
    const out = [];
    if (!Array.isArray(list) || !Array.isArray(files)) return out;
    for (const g of list.slice(0, GIFT_MAX)) {
        if (!isObj(g) || !Number.isInteger(g.file) || typeof files[g.file] !== 'string' || !DATA_IMG.test(files[g.file])) continue;
        const [, ext] = /^data:image\/(\w+);/.exec(files[g.file]);
        const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const path = await uploadFile(`tavvy_gift_${id}.${ext === 'jpeg' ? 'jpg' : ext}`, files[g.file].split(',')[1]);
        uploaded.push(path);
        const memo = String(g.memo || '').slice(0, GIFT_MEMO);
        out.push({ id, src: path, name: String(g.name || '').slice(0, 20), ...(memo ? { memo } : {}), ...(g.fav === true && !out.some(x => x.fav) ? { fav: true } : {}), size: GIFT_SIZES.some(x => x[0] === g.size) ? g.size : 'm', at: num(g.at) });
    }
    return out;
}

/** 0.10.6 내 소리 from a pet file. */
async function unpackSounds(src, files, uploaded, petId) {
    const out = {};
    if (!isObj(src) || !Array.isArray(files)) return out;
    for (const [k] of SOUND_SLOTS) {
        const i = src[k]?.file;
        const m = Number.isInteger(i) && typeof files[i] === 'string' ? /^data:([\w/.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(files[i]) : null;
        const ext = m && m[1].startsWith('audio/') ? sndExt('', m[1]) : null;
        if (!ext || m[2].length > SND_MAX_BYTES * 1.4) continue;
        const path = await uploadFile(`tavvy_snd_${petId}_${k}_${Date.now().toString(36)}.${ext}`, m[2]);
        uploaded.push(path);
        out[k] = path;
    }
    return out;
}

async function importPetFile(data) {
    if (!isObj(data) || data[PET_FILE] !== 1 || !isObj(data.pet) || !isObj(data.pet.look)) return say(LX('Tavvy 펫 파일이 아니에요.', 'Not a Tavvy pet file.'));
    if (typeof data.formatVersion !== 'number' || data.formatVersion > FORMAT_VERSION) return say(LX('더 새로운 버전의 Tavvy가 만든 파일이에요. 확장을 업데이트해 주세요.', 'This file was made by a newer Tavvy. Please update the extension.'));
    if (!room) return say(LX('먼저 펫이 살 채팅방을 열어 주세요.', 'First open the chat where the pet will live.'));
    say(LX('불러오는 중…', 'Importing…'));
    const id = newId();
    const { roles, uploaded } = await unpackRoles(data.pet.look.roles, data.files, 'pet_' + id);
    const rec = cleanPet(data.pet, cleanLook(data.pet.look, roles));
    rec.id = id;
    try {
        rec.gifts = await unpackGifts(data.pet.gifts, data.files, uploaded);
        rec.sounds = await unpackSounds(data.pet.sounds, data.files, uploaded, id);
    } catch (e) { uploaded.forEach(deleteFile); throw e; }
    rec.home = homeOf(room);
    let added = null;
    if (!roles.idle[0].startsWith('builtin:')) {
        added = { id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: rec.name, ...structuredClone({ kind: rec.look.kind, facing: rec.look.facing, squish: rec.look.squish, roles: rec.look.roles, roleOpts: rec.look.roleOpts, baseline: rec.look.baseline }), createdAt: Date.now() };
        root.looks.push(added);
    }
    root.pets.push(rec);
    const ok = await saveNow();
    if (!ok && readOnly) {
        root.pets.pop();
        if (added) root.looks.pop();
        uploaded.forEach(deleteFile);
        return say(readOnlyReason);
    }
    if (!ok) saveSoon();
    refreshBed();
    renderPanel();
    show('pet', { id: rec.id });
    say(LX(`${josa(rec.name, '이', '가')} 이 방에 왔어요! 🛏️ 버튼을 눌러 깨워 보세요.`, `${rec.name} is here! Press the 🛏️ button to wake it.`));
}

/** A card only has a look: it goes into "내가 올린 외형", then a new pet can wear it. */
async function importCard(data) {
    if (!isObj(data) || data[CARD_KEY] !== 1 || !isObj(data.look)) return say(LX('Tavvy 카드가 아니에요.', 'Not a Tavvy card.'));
    if (typeof data.formatVersion !== 'number' || data.formatVersion > FORMAT_VERSION) return say(LX('더 새로운 버전의 Tavvy가 만든 카드예요. 확장을 업데이트해 주세요.', 'This card was made by a newer Tavvy. Please update the extension.'));
    say(LX('불러오는 중…', 'Importing…'));
    const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const { roles, uploaded } = await unpackRoles(data.look.roles, data.files, 'look_' + id);
    const l = cleanLook(data.look, roles);
    const look = { id, name: LX('받은 외형', 'Imported look'), kind: l.kind, facing: l.facing, squish: l.squish, roles: l.roles, roleOpts: l.roleOpts, baseline: l.baseline, createdAt: Date.now() };
    root.looks.push(look);
    const ok = await saveNow();
    if (!ok && readOnly) { root.looks.pop(); uploaded.forEach(deleteFile); return say(readOnlyReason); }
    if (!ok) saveSoon();
    show('new');
    pickLook('lib:' + id);
    const nameEl = win.body.querySelector('[data-f="name"]');
    if (nameEl) { nameEl.value = ''; win.form.autoName = ''; }
    say(LX('카드 외형을 "내가 올린 외형"에 넣었어요. 이름과 성격을 정하고 만들기를 눌러 주세요.', 'Added the card’s look to "My uploaded looks". Choose a name and personality, then press Create.'));
}

function setSetting(key, value) {
    if (!root) return;
    root.settings[key] = value;
    saveSoon();
    if (key === 'stageMode' || key === 'lineLedges') measure();
    if (key === 'badge') refreshBed();
    if (key === 'stageMode') fillSettings();
    if (key === 'winTheme') { applyTheme(); fillSettings(); }
    renderPanel();
}

function onWinClick(e) {
    if (!win?.open) return;
    const t = e.target;
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'close') return closeWin();
    if (act === 'back') return leave(() => show('home'));
    if (act === 'settings') return show('settings');
    if (act === 'replyup') { sndTouched = true; return win.body.querySelector('[data-f="replyfile"]')?.click(); }   // 0.10.11
    if (act === 'gohome') return show('home');
    if (act === 'uploadno') return cancelUpload();
    if (act === 'new') return show('new');
    if (act === 'save') return saveEdit();
    if (act === 'create') return createPet();
    if (act === 'delete') return deletePet(win.id);
    if (act === 'movehere') return movePetHere(win.id);
    if (act === 'clonehere') return clonePetHere(win.id, !!win.body.querySelector('[data-f="clonerec"]')?.checked);
    if (act === 'exportpet') return exportPetFile(win.id);
    if (act === 'exportcard') return exportPetCard(win.id);
    if (act === 'import') return win.body.querySelector('[data-f="importfile"]')?.click();
    if (act === 'pickfile') return win.body.querySelector('[data-f="file"]').click();   // SillyTavern hides file inputs
    if (act === 'bedreset') {
        root.settings.bedPos = { phone: null, pc: null };
        saveSoon(); placeBed();
        return say(LX('깨우기 버튼을 처음 자리로 옮겼어요.', 'Moved the wake button back to its starting spot.'));
    }
    if (act === 'bedfind') return findBed();
    if (act === 'restore') return restoreBackup(win.body.querySelector('[data-live="backups"]').value);
    if (act === 'savetalk') return saveTalk();
    if (act === 'actreset') return resetActs();
    const fq = t.closest('[data-freq]');
    if (fq) return setFreq(fq.dataset.freq, fq.dataset.fv);
    const rs = t.closest('[data-rest]');
    if (rs) return setRest(rs.dataset.rest);
    const pc = t.closest('[data-pace]');
    if (pc) return setPace(pc.dataset.pace);
    if (act === 'aifill') return aiFill();
    if (act?.startsWith?.('place')) return placeAct(act, t);
    if (act === 'aiduet') return aiDuet(t.closest('[data-with]')?.dataset.with);
    if (act === 'adddate') return addDateRow();
    if (act === 'giftpick') return pickGift();
    if (act === 'giftok') return confirmGift(false);
    if (act === 'giftnow') return confirmGift(true);
    if (act === 'giftno') { win.giftPend = null; return drawGifts(); }
    if (act === 'giftswap') return void win.body.querySelector('[data-f="giftfile"]')?.click();
    const ge = t.closest('[data-gedit]');
    if (ge) return editGift(ge.dataset.gedit);
    if (act === 'giftcut') {
        const pend = win.giftPend;
        if (!pend?.file) return;
        return openCutter(pend.file, { box: pend.cut, done: (cuts) => { if (win.giftPend !== pend) return; pend.cut = cuts?.[0] || null; redoGiftPreview(); } });
    }
    const gf = t.closest('[data-gfav]');
    if (gf) return favGift(gf.dataset.gfav);
    const gs = t.closest('[data-gsize]');
    if (gs) return setGiftSize(gs.dataset.gsize, gs.dataset.gv);
    const gw = t.closest('[data-gshow]');
    if (gw) return showGiftNow(gw.dataset.gshow);
    const gd = t.closest('[data-gdel]');
    if (gd) return delGift(gd.dataset.gdel);
    if (act === 'rolesback') { win.roleEdit = null; return drawRoles(); }
    if (act === 'addframe') return win.body.querySelector('[data-f="rolefile"]')?.click();
    if (act === 'pendok') return confirmRolePend();
    if (act === 'pendno') { win.rolePend = null; return drawRolePend(); }
    if (act === 'refit') return openRefit();
    if (act === 'refitok') return confirmRefit();
    if (act === 'refitno') return closeRefit();
    if (act === 'copyprompt') return void copyPrompt(t.closest('[data-n]')?.dataset.n);
    if (act === 'sheetall') return win.body.querySelector('[data-f="sheetfile"]')?.click();
    if (act === 'sheetok') return confirmSheet();
    if (act === 'sheetno') { win.sheet = null; return drawRoles(); }
    if (act === 'cutopen') {
        const f = win.form;
        if (!f?.file) return;
        return openCutter(f.file, { box: f.cut, done: (cuts) => { f.cut = cuts?.[0] || null; redoUploadPreview(); } });
    }
    if (act === 'pendcut') {
        const pend = win.rolePend, p = curPet();
        if (!pend || pend.files.length !== 1 || !p) return;
        const space = Math.max(1, FRAMES_MAX - (p.look.roles[pend.key]?.length || 0));
        return openCutter(pend.files[0], {
            sheet: true, space, box: pend.sheet ? null : pend.cuts?.[0], sheetOn: pend.sheet,
            done: (cuts, sheet, extra) => {
                if (win.rolePend !== pend) return;
                pend.cuts = cuts; pend.sheet = !!(sheet && cuts); pend.skipped = extra || 0;
                redoRolePreview();
            },
        });
    }
    const dd = t.closest('[data-deldate]');
    if (dd) return dd.closest('.tw-date')?.remove();
    const df = t.closest('[data-delframe]');
    if (df) return delRoleFrame(Number(df.dataset.delframe));
    const mf = t.closest('[data-moveframe]');
    if (mf) return moveRoleFrame(Number(mf.dataset.moveframe));
    const role = t.closest('[data-role]');
    if (role) return openRole(role.dataset.role);
    const pet = t.closest('[data-pet]');
    if (pet) return show('pet', { id: pet.dataset.pet });
    const tab = t.closest('[data-tab]');
    if (tab) return showTab(tab.dataset.tab);
    const dl = t.closest('[data-dellook]');
    if (dl) return deleteLook(dl.dataset.dellook);
    const vc = t.closest('[data-voice]');
    if (vc) return setVoice(vc.dataset.vkey, vc.dataset.voice);
    const sp = t.closest('[data-sndplay]');
    if (sp) { sndTouched = true; return playSound(sp.dataset.sndplay, 1, true, curPet()); }
    const su = t.closest('[data-sndup]');
    if (su) { sndTouched = true; win.sndKey = su.dataset.sndup; return win.body.querySelector('[data-f="sndfile"]')?.click(); }
    const sd = t.closest('[data-snddel]');
    if (sd) return removeSound(sd.dataset.snddel);
    const rp = t.closest('[data-replyplay]');
    if (rp) { sndTouched = true; return playSound('reply', 1, true, null, replyById(rp.dataset.replyplay)); }
    const rd = t.closest('[data-replydel]');
    if (rd) return removeReply(rd.dataset.replydel);
    const look = t.closest('[data-look]');
    if (look) return pickLook(look.dataset.look);
    const theme = t.closest('[data-theme-pick]');
    if (theme) return setSetting('winTheme', theme.dataset.themePick);
    const fe = t.closest('[data-feel]');                                // 0.11.19 소리 느낌: pick → hear it
    if (fe) { setSetting('soundFeel', fe.dataset.feel === 'soft' ? 'soft' : 'clear'); fillSettings(); sndTouched = true; return playSound('heart', 1, true); }
}

function onWinInput(e) {
    if (!win?.open) return;
    const t = e.target;
    if (t.matches?.('[data-size]')) return onSizeInput(t, e.type === 'change');
    const f = t.dataset?.f;
    if (f === 'squish') return showSquish();
    if (t.dataset?.react != null && e.type === 'change') return setReact(t.dataset.react, t.value);
    if (f === 'file' && e.type === 'change') return onFilePicked(t);
    if (f === 'importfile' && e.type === 'change') return importPicked(t);
    if (f === 'rolefile' && e.type === 'change') return addRoleFrames(t);
    if (f === 'giftfile' && e.type === 'change') return giftPicked(t);
    if (f === 'sndfile' && e.type === 'change') return sndPicked(t);
    if (f === 'replyfile' && e.type === 'change') return replyPicked(t);
    if (t.dataset?.replyck != null && e.type === 'change') return toggleReply(t.dataset.replyck, t.checked);
    if (f === 'giftname' && win.giftPend) { win.giftPend.name = t.value; return; }
    if ((f === 'giftcrop' || f === 'giftbg' || f === 'giftbgtol') && e.type === 'change' && win.giftPend) {
        const pend = win.giftPend;
        if (f === 'giftcrop') pend.crop = t.checked;
        if (f === 'giftbg') pend.bg = t.checked;
        if (f === 'giftbgtol') pend.tol = Number(t.value) || BG_TOL;
        return redoGiftPreview();
    }
    if (t.dataset?.gname != null && e.type === 'change') return renameGift(t.dataset.gname, t.value);
    if (t.dataset?.lname != null && e.type === 'change') return renameLook(t.dataset.lname, t.value);
    if (t.dataset?.gmemo != null && e.type === 'change') return memoGift(t.dataset.gmemo, t.value);
    if (f === 'sheetfile' && e.type === 'change') return sheetPicked(t);
    if ((t.dataset?.sheetpick != null || t.dataset?.sheetrow != null || t.dataset?.sheetref != null) && e.type === 'change') return onSheetInput(t);
    if (t.dataset?.fitmode != null || t.dataset?.fitscale != null) return onFitInput(t, e.type === 'change');
    if (t.dataset?.sheetscale != null && win.sheet) { win.sheet.scale = clamp(Number(t.value) || 100, 50, 200) / 100; return placeFitPreview(win.sheet); }
    if (t.dataset?.ro && e.type === 'change') return setRoleOpt(t.dataset.ro, t.value);
    if ((f === 'crop' || f === 'bg' || f === 'bgtol') && e.type === 'change' && win.form?.file) { showBgRow(''); return redoUploadPreview(); }
    if (f === 'bg' && e.type === 'change') return showBgRow('');
    if ((f === 'rolebg' || f === 'rolebgtol' || f === 'rolecrop') && e.type === 'change') { showBgRow('role'); return win.sheet ? redoSheet() : redoRolePreview(); }
    const s = t.dataset?.s;
    if (s && e.type === 'change') {
        if (s === 'stageMode') return setSetting(s, t.value === 'floor' ? 'floor' : 'chat');
        if (s === 'heartMode') return setSetting(s, ['both', 'hearts', 'name', 'hide'].includes(t.value) ? t.value : 'both');
        if (s === 'talkProfile') return setSetting(s, String(t.value || ''));
        if (s === 'lang') return setSetting(s, ['ko', 'en'].includes(t.value) ? t.value : 'auto');
        if (s === 'soundVol' || s === 'replyVol') { setSetting(s, clamp(Math.round(Number(t.value) || 0), 0, 100)); fillSettings(); return playSound(s === 'soundVol' ? 'heart' : 'reply', 1, true); }
        setSetting(s, t.checked);
        if (s === 'soundOn' || s === 'replyOn') { fillSettings(); if (t.checked) { sndTouched = true; playSound(s === 'soundOn' ? 'heart' : 'reply', 1, true); } }
        return;
    }
    if (s === 'soundVol' || s === 'replyVol') { const pct = win.body.querySelector(`[data-pct="${s}"]`); if (pct) pct.textContent = `${t.value}%`; }
}

/* ---------- 0.10.0 선물 tab: pictures you give the pet ---------- */

function giftsHtml(p) {
    const list = p.gifts || [];
    const pend = win.giftPend?.pet === p ? win.giftPend : null;
    const cards = list.map(g => `<div class="tw-gift">
  <div class="tw-giftpicbox"><img class="tw-giftpic tw-checker" src="${esc(imgUrl(g.src))}" alt=""><span class="tw-giftfav${g.fav ? ' tw-fon' : ''}" data-gfav="${esc(g.id)}" title="${g.fav ? LX('가장 좋아하는 선물 (다시 누르면 풀어요)', 'Favorite present (press again to unset)') : LX('가장 좋아하는 선물로', 'Make favorite')}"><i class="fa-${g.fav ? 'solid' : 'regular'} fa-heart"></i></span></div>
  <input class="tw-giftname" data-gname="${esc(g.id)}" maxlength="20" value="${esc(g.name || '')}" placeholder="${LX('이름 없음', 'No name')}">
  <textarea class="tw-giftmemo" data-gmemo="${esc(g.id)}" maxlength="${GIFT_MEMO}" rows="2" placeholder="${LX('메모', 'Notes')}">${esc(g.memo || '')}</textarea>
  <span class="tw-fseg tw-giftsize">${GIFT_SIZES.map(([k, n]) => `<span class="tw-fbtn${(g.size || 'm') === k ? ' tw-fon' : ''}" data-gsize="${esc(g.id)}" data-gv="${k}">${n}</span>`).join('')}</span>
  <div class="tw-giftbtns"><div class="tw-btn tw-btn-small" data-gshow="${esc(g.id)}">${LX('꺼내 보기', 'Take it out')}</div><div class="tw-btn tw-btn-small" data-gdel="${esc(g.id)}">${LX('빼기', 'Remove')}</div><div class="tw-btn tw-btn-small" data-gedit="${esc(g.id)}">${LX('그림 고치기', 'Edit picture')}</div></div>
  ${g.fresh ? LX('<span class="tw-sub">아직 안 받았어요</span>', '<span class="tw-sub">Not received yet</span>') : ''}
</div>`).join('');
    const add = list.length < GIFT_MAX && !pend
        ? LX('<div class="tw-gift tw-giftadd" data-act="giftpick"><i class="fa-solid fa-plus"></i><span>선물 주기</span><span class="tw-sub">그림 고르기</span></div>', '<div class="tw-gift tw-giftadd" data-act="giftpick"><i class="fa-solid fa-plus"></i><span>Give a present</span><span class="tw-sub">Choose picture</span></div>') : '';
    const pendHtml = !pend ? '' : `<div class="tw-giftpend">
  ${pend.editId ? `<div class="tw-cap">${LX('그림 고치기', 'Edit picture')}</div><div class="tw-sub">${LX('이름·크기·받은 기록은 그대로예요. 한 번 지운 배경이나 잘라 낸 부분은 되살릴 수 없어서, 그럴 땐', 'Name, size and history stay. A removed background or cropped-off part can’t be restored, so in that case use')} "${LX('다른 그림으로', 'Another picture')}"${LX('로 원래 그림을 다시 넣어 주세요.', ' to put the original picture back.')}</div>` : ''}
  <div class="tw-row">${pend.prep ? `<img class="tw-prev tw-checker" src="${pend.prep.dataUrl}" alt="">` : LX('<span class="tw-sub">그림 준비 중…</span>', '<span class="tw-sub">Preparing picture…</span>')}<div>
    <div class="tw-row"><div class="tw-btn tw-btn-small" data-act="giftcut"><i class="fa-solid fa-crop-simple"></i> ${LX('직접 자르기', 'Crop by hand')}</div><span class="tw-sub">${pend.cut ? LX('직접 자른 부분만 써요', 'Only the part you cropped is used') : ''}</span></div>
    <label class="tw-check"><input type="checkbox" data-f="giftcrop"${pend.crop ? ' checked' : ''}> ${LX('투명 여백 자르기', 'Trim transparent edges')}</label>
    <label class="tw-check"><input type="checkbox" data-f="giftbg"${pend.bg ? ' checked' : ''}> ${LX('배경 지우기', 'Remove background')} <span class="tw-sub">${LX('(하얀색 같은 단색 배경)', '(a plain one-color background, like white)')}</span></label>
    <div class="tw-bgrow"${pend.bg ? '' : ' hidden'}><span class="tw-sub">${LX('조금', 'Less')}</span><input type="range" min="6" max="80" step="2" value="${pend.tol}" data-f="giftbgtol"><span class="tw-sub">${LX('많이', 'More')}</span></div>
  </div></div>
  <label class="tw-label">${LX('이름', 'Name')} <span class="tw-sub">${LX('(안 적어도 돼요)', '(optional)')}</span> <input data-f="giftname" maxlength="20" value="${esc(pend.name || '')}"></label>
  <div class="tw-row">${pend.editId
      ? LX('<div class="tw-btn tw-btn-main" data-act="giftok">바꾸기</div><div class="tw-btn" data-act="giftswap">다른 그림으로</div>', '<div class="tw-btn tw-btn-main" data-act="giftok">Replace</div><div class="tw-btn" data-act="giftswap">Another picture</div>')
      : LX('<div class="tw-btn tw-btn-main" data-act="giftnow">바로 주기</div><div class="tw-btn" data-act="giftok">모아 두기</div>', '<div class="tw-btn tw-btn-main" data-act="giftnow">Give now</div><div class="tw-btn" data-act="giftok">Save for later</div>')}<div class="tw-btn" data-act="giftno">${LX('취소', 'Cancel')}</div></div>
  ${pend.editId ? '' : LX('<div class="tw-sub">바로 주기: 창을 닫고 안 받은 선물을 한꺼번에 건네요 · 모아 두기: 넣어만 두고 다음 그림을 골라요</div>', '<div class="tw-sub">Give now: closes the window and hands over all waiting presents · Save for later: keeps it and lets you pick the next picture</div>')}
</div>`;
    return `<div class="tw-cap">${LX('받은 선물', 'Presents received')} ${list.length} / ${GIFT_MAX}</div>
<div class="tw-sub">${LX('선물을 주면 가끔 꺼내서 구경하고, 갖고 놀고, 자랑해요. 얼마나 자주 할지는 행동 탭', 'Pets sometimes take out their presents to look at, play with, and show off. Set how often in the Actions tab')} "${LX('선물', 'Presents')}"${LX('에서 골라요. ♡를 누르면 가장 좋아하는 선물이 돼요(하나만).', '. Press ♡ to make one its favorite (only one).')}</div>
<input type="file" accept="${PIC_ACCEPT}" data-f="giftfile">
${pendHtml}
<div class="tw-gifts">${cards}${add}</div>`;
}

function drawGifts() {
    const pane = win?.body?.querySelector('[data-pane="gifts"]');
    const p = curPet();
    if (!pane || !p) return;
    pane.innerHTML = giftsHtml(p);
}

const giftOf = (p, id) => (p?.gifts || []).find(g => g.id === id);

function pickGift() {
    const p = curPet();
    if (!p) return;
    if (readOnly) return say(readOnlyReason);
    if ((p.gifts || []).length >= GIFT_MAX) return say(`${LX('선물은', 'Up to')} ${GIFT_MAX}${LX('개까지 줄 수 있어요.', ' presents.')}`);
    win.body.querySelector('[data-f="giftfile"]')?.click();   // SillyTavern hides file inputs
}

function giftPicked(input) {
    const file = input.files?.[0], p = curPet();
    input.value = '';
    if (!file || !p) return;
    if (file.size > 8 * 1024 * 1024) return say(LX('그림이 너무 커요 (8MB 이하).', 'The picture is too big (8 MB max).'));
    const old = win.giftPend?.pet === p && win.giftPend.editId ? win.giftPend : null;   // 0.10.1: "다른 그림으로" while editing
    win.giftPend = { pet: p, file, cut: null, crop: true, bg: true, tol: BG_TOL, name: old ? old.name : '', prep: null, editId: old?.editId };
    return redoGiftPreview();
}

async function redoGiftPreview() {
    const pend = win.giftPend;
    if (!pend) return;
    pend.prep = null;
    drawGifts();
    try {
        const out = await preparePng(pend.file, pend.crop, pend.bg ? pend.tol : 0, pend.cut);
        if (win.giftPend !== pend) return;
        pend.prep = out;
    } catch {
        if (win.giftPend === pend) { win.giftPend = null; say(LX('그림을 읽지 못했어요. 다른 그림(PNG·JPG)을 골라 주세요.', 'Couldn’t read the picture. Choose another one (PNG · JPG).')); }
    }
    drawGifts();
}

/** 0.10.1 "그림 고치기": the same preview as giving one, starting from the picture it has now. */
async function editGift(id) {
    const p = curPet(), g = giftOf(p, id);
    if (!g || busy) return;
    if (readOnly) return say(readOnlyReason);
    let file;
    try {
        const r = await fetch(imgUrl(g.src));
        if (!r.ok) throw new Error(r.status);
        const blob = await r.blob();
        file = new File([blob], 'gift.png', { type: blob.type || 'image/png' });
    } catch {
        return say(LX('선물 그림을 읽지 못했어요. "빼기" 뒤에 다시 줘 보세요.', 'Couldn’t read the present picture. "Remove" Try giving it again later.'));
    }
    if (curPet() !== p || !giftOf(p, id)) return;
    win.giftPend = { pet: p, file, cut: null, crop: true, bg: false, tol: BG_TOL, name: g.name || '', prep: null, editId: id };
    await redoGiftPreview();
    win.body?.querySelector('.tw-giftpend')?.scrollIntoView?.({ block: 'nearest' });
}

async function confirmGift(now) {
    const pend = win.giftPend, p = curPet();
    if (!pend?.prep || busy || p !== pend.pet) return;
    if (readOnly) return say(readOnlyReason);
    if (!ready) return say(LX('실리태번이 아직 준비 중이에요. 잠시 뒤 다시 해 주세요.', 'SillyTavern is still getting ready. Try again in a moment.'));
    if (pend.editId) return replaceGift(p, pend);
    if ((p.gifts || []).length >= GIFT_MAX) return say(`${LX('선물은', 'Up to')} ${GIFT_MAX}${LX('개까지 줄 수 있어요.', ' presents.')}`);
    busy = true;
    try {
        say(LX('선물 올리는 중…', 'Uploading present…'));
        const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const path = await uploadFile(`tavvy_gift_${id}.png`, pend.prep.base64);
        const g = { id, src: path, name: String(pend.name || '').trim().slice(0, 20), size: 'm', at: Date.now(), fresh: true };
        (p.gifts ||= []).push(g);
        const ok = await saveNow();
        if (!ok && readOnly) { p.gifts.pop(); deleteFile(path); return say(readOnlyReason); }
        if (!ok) saveSoon();
        win.giftPend = null;
        drawGifts();
        refreshBed();
        const awake = actors.some(a => a.rec === p);
        if (now && awake) return void giveNow(p);              // 0.10.2 바로 주기
        say(awake ? LX(`선물을 넣었어요! 창을 닫으면 ${josa(p.name, '이', '가')} 받아요.`, `Present added! ${p.name} gets it when you close the window.`) : LX(`선물을 넣었어요! 🛏️ 버튼으로 깨우면 ${josa(p.name, '이', '가')} 받아요.`, `Present added! ${p.name} gets it when you wake it with 🛏️.`));
    } catch (e) {
        say(LX('선물을 올리지 못했어요: ', 'Couldn’t upload the present: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

/** 0.10.1: a new picture for a present it already has — name, size and "받았어요" stay. */
async function replaceGift(p, pend) {
    const g = giftOf(p, pend.editId);
    if (!g) { win.giftPend = null; return drawGifts(); }
    busy = true;
    try {
        say(LX('그림 바꾸는 중…', 'Changing picture…'));
        const path = await uploadFile(`tavvy_gift_${g.id}_${Date.now().toString(36)}.png`, pend.prep.base64);
        const old = g.src, oldName = g.name;
        g.src = path;
        g.name = String(pend.name || '').trim().slice(0, 20);
        const ok = await saveNow();
        if (!ok && readOnly) { g.src = old; g.name = oldName; deleteFile(path); return say(readOnlyReason); }
        if (ok) { if (!fileInUse(old)) deleteFile(old); } else saveSoon();
        win.giftPend = null;
        drawGifts();
        say(LX('선물 그림을 바꿨어요.', 'Present picture changed.'));
    } catch (e) {
        say(LX('그림을 올리지 못했어요: ', 'Couldn’t upload the picture: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

/** 0.10.13 가장 좋아하는 선물: one per pet; tap again to undo. */
function favGift(id) {
    const p = curPet(), g = giftOf(p, id);
    if (!g || readOnly) return;
    const on = !g.fav;
    for (const x of p.gifts || []) if (x) delete x.fav;
    if (on) g.fav = true;
    saveSoon();
    drawGifts();
}

function setGiftSize(id, v) {
    const g = giftOf(curPet(), id);
    if (!g || readOnly || !GIFT_SIZES.some(x => x[0] === v)) return;
    g.size = v;
    saveSoon();
    drawGifts();
}

function renameGift(id, v) {
    const g = giftOf(curPet(), id);
    if (!g || readOnly) return;
    g.name = String(v || '').trim().slice(0, 20);
    saveSoon();
}

/** 0.10.2: a note about the present, just for you (the pet doesn't use it). */
function memoGift(id, v) {
    const g = giftOf(curPet(), id);
    if (!g || readOnly) return;
    const m = String(v || '').trim().slice(0, GIFT_MEMO);
    if (m) g.memo = m; else delete g.memo;
    saveSoon();
}

async function delGift(id) {
    const p = curPet(), g = giftOf(p, id);
    if (!g || readOnly || busy) return;
    if (!(await confirmBox(LX(`${g.name ? `"${g.name}"` : '이 선물'}을(를) 뺄까요? 선물 그림도 지워져요.`, `Remove ${g.name ? `"${g.name}"` : 'this present'}? Its picture will be deleted too.`)))) return;
    for (const a of actors) if (a.rec === p && (a.toy?.g === g || a.hug?.g === g)) { a.toy = null; a.hug = null; if (a.state === 'toy') a.setState('idle'); }
    p.gifts = p.gifts.filter(x => x !== g);
    const ok = await saveNow();
    if (ok) { if (!fileInUse(g.src)) deleteFile(g.src); } else saveSoon();
    drawGifts();
    refreshBed();
}

/** "꺼내 보기": the window closes and it takes this one out right away. */
/** 0.10.2 바로 주기: close the window and hand over every present still waiting, right away (or as soon as it's free). */
function giveNow(p) {
    const a = actors.find(x => x.rec === p);
    if (!a) return;
    closeWin();
    const go = (n) => {
        if (win?.open) { if (n < 40) setTimeout(() => go(n + 1), 250); return; }   // "저장 안 한 내용" may be asking first
        const g = (p.gifts || []).find(x => x?.fresh && typeof x.src === 'string');
        if (!g || a.gone || a.state === 'toy' && a.toy?.k === 'recv') return;
        if (!a.free() || a.held || a.air || a.wallOn || ['eat', 'sniff', 'toy'].includes(a.state)) return;   // busy → it takes them when it's done
        a.startToy('recv', g);
    };
    setTimeout(() => go(0), 350);
}

function showGiftNow(id) {
    const p = curPet(), g = giftOf(p, id);
    if (!g) return;
    const a = actors.find(x => x.rec === p);
    if (!a) return say(LX(`먼저 🛏️ 버튼으로 ${josa(p.name, '을', '를')} 깨워 주세요.`, `First wake ${p.name} with the 🛏️ button.`));
    if (!a.free() || a.held || a.air || a.wallOn || ['eat', 'sniff', 'toy'].includes(a.state)) return say(LX('지금은 바빠 보여요. 잠시 뒤 다시 눌러 보세요.', 'It looks busy right now. Try again in a moment.'));
    closeWin();
    const go = (n) => {
        if (win?.open) { if (n < 40) setTimeout(() => go(n + 1), 250); return; }   // "저장 안 한 내용" may be asking first
        if (a.gone || !a.free() || a.held || a.air || a.wallOn) return;
        if (g.fresh) return void a.startToy('recv', g);
        const kinds = a.plat ? ['look', 'show', 'give', ...(a.ledgeRollOk(g) ? ['roll'] : [])] : ['look', 'show', 'give', 'roll', 'toss'];
        a.startToy(kinds[Math.floor(Math.random() * kinds.length)], g);
    };
    setTimeout(() => go(0), 350);
}

/* ---------- 그림 tab: a picture (or several) for each action ---------- */

const curPet = () => (win?.view === 'pet' ? root?.pets.find(x => x.id === win.id) : null);

/** The picture that shows when this action has none (follows the fallbacks to one that exists). */
function standIn(p, key) {
    const roles = p.look?.roles || {};
    for (let k = ROLE_DEFS[key]?.fb, n = 0; k && n < 8; k = ROLE_DEFS[k]?.fb, n++) if (roles[k]?.length) return k;
    return 'idle';
}

function speedText(p, key) {
    const list = p.look.roles[key] || [];
    if (list.length < 2) return LX(`${list.length}장`, `${list.length} pic${list.length === 1 ? '' : 's'}`);
    if (STEP_ROLES[key]) return `${LX(`${list.length}장`, `${list.length} pics`)} · ${key === 'walk' ? LX('걸음마다', 'per step') : LX('한 입마다', 'per bite')}`;
    return `${LX(`${list.length}장`, `${list.length} pics`)} · ${SPEED_NAMES[p.look.roleOpts?.[key]?.speed] || LX('보통', 'Normal')}`;
}

function slotHtml(p, r) {
    const list = p.look.roles[r.key] || [];
    const pics = list.length
        ? `<div class="tw-slot-imgs">${list.slice(0, 3).map(f => `<img src="${esc(imgUrl(f))}" alt="">`).join('')}</div>`
        : LX('<div class="tw-slot-imgs tw-slot-empty"><i class="fa-solid fa-plus"></i> 그림 넣기</div>', '<div class="tw-slot-imgs tw-slot-empty"><i class="fa-solid fa-plus"></i> Add pictures</div>');
    const sub = list.length ? speedText(p, r.key) : `${LX('없음 →', 'none →')} ${ROLE_DEFS[standIn(p, r.key)]?.name || LX('기본', 'Basic')}`;
    return `<div class="tw-slot${list.length ? '' : ' tw-slot-none'}" data-role="${r.key}">${pics}<b>${esc(r.name)}</b><span class="tw-sub">${esc(sub)}</span></div>`;
}

function lookNote(p) {
    const key = lookKeyOf(p);
    if (key.startsWith('lib:')) {
        const l = root.looks.find(x => x.id === key.slice(4));
        return `${LX('여기 넣은 그림은', 'Pictures added here are saved with the look')} "${esc(l?.name || '')}"${LX(' 외형에 같이 저장돼요. 이 외형을 쓰는 다른 펫과, 이 외형으로 새로 만드는 펫에도 들어가요.', '. Other pets using this look, and new pets made with it, get them too.')}`;
    }
    if (key.startsWith('builtin:')) return LX('기본 펫 외형이라, 여기 넣은 그림은 이 펫에게만 들어가요.', 'This is a starter look, so pictures added here go to this pet only.');
    return LX('여기 넣은 그림은 이 펫에게 들어가요.', 'Pictures added here go to this pet.');
}

// 0.11.7: an example to copy into a picture AI (Tavvy itself never calls one)
// 0.11.14: two sheets of 3 × 2 instead of one 4 × 3 — fewer frames per sheet, so each picture comes out bigger
const AI_PIC_PROMPTS = [`Sprite sheet of one small chibi character: [describe your character here].
Same character in every frame, full body, same size and scale.
3 columns x 2 rows grid, clear empty space between frames,
plain white background, no text, no numbers.
Row 1: standing (front), walking (side view) x2
Row 2: sleeping, sitting, eating`, `Another sprite sheet of the same character as the first sheet: [describe your character here].
Same look, same size and scale as the first sheet, full body.
3 columns x 2 rows grid, clear empty space between frames,
plain white background, no text, no numbers.
Row 1: happy, angry, surprised
Row 2: curious, looking up, waving`];

function aiPromptHtml() {
    const box = (n, cap) => `<div class="tw-sub"><b>${cap}</b></div>
<textarea class="tw-aiprompt" data-n="${n}" readonly rows="9">${esc(AI_PIC_PROMPTS[n])}</textarea>
<div class="tw-row"><div class="tw-btn tw-btn-small" data-act="copyprompt" data-n="${n}"><i class="fa-regular fa-copy"></i> ${LX('복사', 'Copy')}</div></div>`;
    return `<details class="tw-fold" data-group="aiprompt"${win.rolesOpen.has('aiprompt') ? ' open' : ''}><summary>${LX('AI로 그림 만들 때 예시', 'Example for making pictures with an AI')}</summary>
<div class="tw-sub">${LX('그림 AI에 붙여 넣을 예시예요. [ ] 안에 생김새를 적어 주세요. 그림 AI는 영어를 잘 알아들어요. 한 장에 그림이 적을수록 크게 나와서, 6개씩 두 장으로 나눴어요.', 'An example to paste into a picture AI. Write the look inside [ ]. Fewer pictures per sheet come out bigger, so it is split into two sheets of 6.')}</div>
${box(0, LX('1장 · 움직이기·쉬기', 'Sheet 1 · Moving · resting'))}
${box(1, LX('2장 · 반응', 'Sheet 2 · Reactions'))}
<div class="tw-sub">${LX('· 2장은 1장을 그린 대화에서 이어서 부탁하거나, 1장 그림을 같이 올리면 생김새가 잘 맞아요.<br>· 다른 동작도 필요하면 Row 줄의 동작만 바꿔서 몇 장이든 더 그려요.<br>· 그림 사이를 띄워 두면 "시트로 한꺼번에 넣기"의 자동 찾기로 잘 나뉘어요. 안 되면 칸 수 3 × 2로 나눠요.<br>· 걷기는 옆모습이 자연스러워요. 배경은 한 가지 색이 좋아요.<br>· 그림마다 키가 어긋나면 키 맞추기로 맞춰요.', '· For sheet 2, ask in the same chat as sheet 1, or attach the sheet 1 picture, so the look matches.<br>· Need other actions? Change the actions on the Row lines and make as many more sheets as you like.<br>· With space between pictures, auto-find in "Add from a sheet" splits them well. If not, split by 3 × 2.<br>· Walking looks best from the side. A one-colour background works best.<br>· If the heights do not match, fix them with height matching.')}</div>
</details>`;
}

async function copyPrompt(n) {
    n = n === '1' ? 1 : 0;
    let ok = false;
    try { await navigator.clipboard.writeText(AI_PIC_PROMPTS[n]); ok = true; } catch { }
    if (!ok) {
        const ta = win?.body.querySelector(`.tw-aiprompt[data-n="${n}"]`);
        if (ta) { ta.focus(); ta.select(); try { ok = document.execCommand('copy'); } catch { } }
    }
    say(ok ? LX('복사했어요.', 'Copied.') : LX('복사가 안 됐어요. 글을 길게 눌러 직접 복사해 주세요.', 'Could not copy. Press and hold the text to copy it.'));
}

function rolesHtml(p) {
    const groups = ROLE_GROUPS.map((g, i) => {
        const grid = `<div class="tw-slots">${g.roles.map(r => slotHtml(p, r)).join('')}</div>`;
        if (i === 0) return `<div class="tw-cap">${esc(g.name)}</div>${grid}`;
        const have = g.roles.filter(r => p.look.roles[r.key]?.length).length;
        return `<details class="tw-fold" data-group="${g.key}"${win.rolesOpen.has(g.key) ? ' open' : ''}><summary>${esc(g.name)} <span class="tw-sub">${have ? `${have}${LX('칸 채움', ' filled')}` : ''}</span></summary>${grid}</details>`;
    }).join('');
    return `<div class="tw-sub">${LX('그림이 없는 칸은 기본 그림 + 움직임으로 대신해요. 칸을 누르면 그림을 넣거나 빼요.', 'Empty slots use the basic picture + movement instead. Tap a slot to add or remove pictures.')}</div>
<div class="tw-row tw-sheetbar"><div class="tw-btn tw-btn-small" data-act="sheetall"><i class="fa-solid fa-table-cells"></i> ${LX('시트로 한꺼번에 넣기', 'Add from a sheet')}</div><span class="tw-sub">${LX('한 장을 나눠서 여러 동작에', 'Split one image across several actions')}</span></div>
<input type="file" accept="${PIC_ACCEPT}" data-f="sheetfile">
${groups}
${aiPromptHtml()}
<div class="tw-sub" style="margin-top:10px">${lookNote(p)}</div>
<div class="tw-msg"></div>`;
}

function roleEditHtml(p, key) {
    const r = ROLE_DEFS[key];
    const list = p.look.roles[key] || [];
    const opt = p.look.roleOpts?.[key] || {};
    const canDel = key !== 'idle' || list.length > 1;
    const frames = list.map((f, i) => `<div class="tw-frame"><img src="${esc(imgUrl(f))}" alt=""><span>${i + 1}</span>${canDel ? `<i class="fa-solid fa-xmark" data-delframe="${i}" title="${LX('빼기', 'Remove')}"></i>` : ''}${i ? `<em class="fa-solid fa-chevron-left" data-moveframe="${i}" title="${LX('앞으로', 'Front')}"></em>` : ''}${i < list.length - 1 ? `<em class="fa-solid fa-chevron-right tw-next" data-moveframe="${i + 1}" title="${LX('뒤로', 'Back')}"></em>` : ''}</div>`).join('');
    const add = list.length < FRAMES_MAX ? '<div class="tw-frame tw-frame-add" data-act="addframe"><i class="fa-solid fa-plus"></i></div>' : '';
    const petFacing = { front: LX('정면', 'Front'), right: LX('오른쪽', 'Right'), left: LX('왼쪽', 'Left') }[p.look.facing] || LX('정면', 'Front');
    const speed = list.length < 2 ? ''
        : STEP_ROLES[key] ? `<div class="tw-sub">${LX('여러 장이면', 'With several, it')} ${STEP_ROLES[key]}.</div>`
        : `<label class="tw-label">${LX('빠르기', 'Speed')} <select data-ro="speed">${Object.entries(SPEED_NAMES).map(([k, v]) => `<option value="${k}"${(opt.speed || 'normal') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`;
    return `<div class="tw-btn tw-btn-small" data-act="rolesback"><i class="fa-solid fa-arrow-left"></i> ${LX('동작 목록', 'Action list')}</div>
<div class="tw-roled-head">
  <div class="tw-roled-prev"><img alt=""></div>
  <div><b>${esc(r.name)}</b><div class="tw-sub">${list.length ? (r.note ? esc(r.note) : '') : `${LX('없으면', 'If empty, uses the')} ${esc(ROLE_DEFS[standIn(p, key)]?.name || LX('기본', 'Basic'))} ${LX('그림을 써요', 'picture')}`}</div></div>
</div>
<div class="tw-cap">${LX('그림', 'Art')} ${list.length}/${FRAMES_MAX} <span class="tw-sub">${LX('· 여러 장이면 차례로 넘어가요', '· several pictures play in turn')}</span></div>
<div class="tw-frames">${frames}${add}</div>
${list.length && key !== 'idle' ? `<div class="tw-row"><div class="tw-btn tw-btn-small" data-act="refit"><i class="fa-solid fa-up-down"></i> ${LX('키 맞추기', 'Match height')}</div><span class="tw-sub">${LX('넣어 둔 그림 크기를 기본 그림에 맞춰요', 'Resize the added pictures to match the basic picture')}</span></div>
<div class="tw-refit" hidden>
  <div class="tw-refitbox"></div>
  <div class="tw-row"><div class="tw-btn" data-act="refitok"><i class="fa-solid fa-check"></i> ${LX('바꾸기', 'Replace')}</div><div class="tw-btn" data-act="refitno">${LX('취소', 'Cancel')}</div></div>
</div>` : ''}
<div class="tw-rolepend" hidden>
  <div class="tw-cap">${LX('미리보기', 'Preview')} <span class="tw-sub">${LX('· 이대로 넣을까요?', '· add it like this?')}</span></div>
  <div class="tw-frames tw-pendframes"></div>
  <div class="tw-pendfit"></div>
  <div class="tw-row"><div class="tw-btn tw-btn-small" data-act="pendcut"><i class="fa-solid fa-crop-simple"></i> ${LX('자르기 · 나누기', 'Crop · split')}</div><span class="tw-sub tw-cutnote"></span></div>
  <div class="tw-row"><div class="tw-btn" data-act="pendok"><i class="fa-solid fa-check"></i> ${LX('넣기', 'Add')}</div><div class="tw-btn" data-act="pendno">${LX('취소', 'Cancel')}</div></div>
</div>
<input type="file" accept="${PIC_ACCEPT}" multiple data-f="rolefile">
<label class="tw-check"><input type="checkbox" data-f="rolecrop" checked> ${LX('투명 여백 자르기', 'Trim transparent edges')}</label>
${bgHtml('role')}
<div class="tw-sub">${LX('여러 장을 한 번에 고르면 이름 순서대로 들어가고, 같은 크기면 같은 자리로 잘라서 움직임이 흔들리지 않아요. 한 장을 고르면 미리보기에서 직접 자르거나, 여러 동작이 그려진 그림을 여러 장으로 나눌 수 있어요.', 'Pick several at once and they go in by file name; same-size pictures are cropped at the same spot so the motion doesn’t wobble. Pick one and you can crop it in the preview, or split a sheet of actions into several pictures.')}</div>
${speed}
<label class="tw-label">${LX('이 그림이 보는 쪽', 'Which way these pictures face')}
  <select data-ro="facing">
    <option value=""${!opt.facing ? ' selected' : ''}>${LX('펫과 같게 (', 'Same as pet (')}${petFacing})</option>
    <option value="front"${opt.facing === 'front' ? ' selected' : ''}>${LX('정면', 'Front')}</option>
    <option value="right"${opt.facing === 'right' ? ' selected' : ''}>${LX('오른쪽을 봄', 'Faces right')}</option>
    <option value="left"${opt.facing === 'left' ? ' selected' : ''}>${LX('왼쪽을 봄', 'Faces left')}</option>
  </select>
</label>
<div class="tw-sub">${LX('정면 그림과 옆모습 그림을 섞어 써도 돼요. 옆모습이면 가는 쪽에 맞춰 뒤집어요.', 'Front and side pictures can be mixed. Side pictures flip to match the direction it moves.')}</div>
<div class="tw-msg"></div>`;
}

function stopPreview() {
    if (win?.prevTimer) { clearInterval(win.prevTimer); win.prevTimer = 0; }
}

/** Draw the 그림 tab (the list, or one action being edited). Keeps the scroll position. */
function drawRoles() {
    const p = curPet();
    const pane = win?.body.querySelector('[data-pane="roles"]');
    if (!p || !pane) return;
    stopPreview();
    const keep = win.body.scrollTop;
    win.rolePend = null;                                           // an unconfirmed preview never survives a redraw
    win.refit = null;
    if (win.sheet && win.sheet.pet !== p) win.sheet = null;
    if (win.sheet) {                                                // a sheet waiting to be shared out
        pane.innerHTML = sheetHtml();
        win.body.scrollTop = keep;
        return drawSheet();
    }
    pane.innerHTML = win.roleEdit && ROLE_DEFS[win.roleEdit] ? roleEditHtml(p, win.roleEdit) : rolesHtml(p);
    win.body.scrollTop = keep;
    if (!win.roleEdit) return;
    // a little live preview of the frames
    const key = win.roleEdit;
    const img = pane.querySelector('.tw-roled-prev img');
    const list = p.look.roles[key]?.length ? p.look.roles[key] : p.look.roles[standIn(p, key)] || p.look.roles.idle;
    const fps = STEP_ROLES[key] ? 4 : FRAME_FPS[p.look.roleOpts?.[key]?.speed] || FRAME_FPS.normal;
    let i = 0;
    img.src = imgUrl(list[0]);
    if (list.length > 1) win.prevTimer = setInterval(() => { i = (i + 1) % list.length; img.src = imgUrl(list[i]); }, 1000 / fps);
}

function openRole(key) {
    if (!ROLE_DEFS[key]) return;
    win.roleEdit = key;
    drawRoles();
    win.body.querySelector('[data-pane="roles"]')?.scrollIntoView?.({ block: 'start' });
}

/**
 * Change this pet's action pictures. The change also goes into its saved look (내가 올린 외형) and to the
 * other pets wearing that look, so a new pet made from the look gets the same pictures.
 * Files nothing uses any more are deleted after a successful save.
 */
async function changeRoles(p, fn) {
    const key = lookKeyOf(p);
    const L = key.startsWith('lib:') ? root.looks.find(x => x.id === key.slice(4)) : null;
    const wearers = L ? root.pets.filter(x => lookKeyOf(x) === key) : [p];
    const before = new Set([...wearers.flatMap(petFiles), ...(L ? lookFiles(L) : [])]);
    p.look.roleOpts ??= {};
    fn(p.look);
    for (const k of Object.keys(p.look.roles)) if (!p.look.roles[k]?.length) delete p.look.roles[k];
    for (const k of Object.keys(p.look.roleOpts)) if (!Object.keys(p.look.roleOpts[k] || {}).length) delete p.look.roleOpts[k];
    p.look.kind = Object.values(p.look.roles).some(l => l.length > 1) ? 'frames' : 'single';
    for (const x of wearers) {
        if (x === p) continue;
        x.look.roles = structuredClone(p.look.roles); x.look.roleOpts = structuredClone(p.look.roleOpts); x.look.kind = p.look.kind;
    }
    if (L) { L.roles = structuredClone(p.look.roles); L.roleOpts = structuredClone(p.look.roleOpts); L.kind = p.look.kind; }
    // the screen changes right away; saving to SillyTavern (a trip to the server) carries on behind it
    for (const a of actors) if (wearers.includes(a.rec)) a.reloadLook();
    renderPanel();
    drawRoles();
    saveNow().then((ok) => {
        if (!ok) { saveSoon(); return; }
        for (const f of before) { if (!fileInUse(f)) deleteFile(f); }
    });
    return true;
}

async function addRoleFrames(input) {
    const p = curPet(), key = win.roleEdit;
    const files = [...(input.files || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    input.value = '';
    if (!p || !key || !files.length) return;
    if (readOnly) return say(readOnlyReason);
    if (!ready) return say(LX('실리태번이 아직 준비 중이에요. 잠시 뒤 다시 해 주세요.', 'SillyTavern is still getting ready. Try again in a moment.'));
    if (busy) return;
    if (files.some(f => f.size > 8 * 1024 * 1024)) return say(LX('그림이 너무 커요 (한 장에 8MB 이하).', 'The picture is too big (8 MB max each).'));
    const space = FRAMES_MAX - (p.look.roles[key]?.length || 0);
    const use = files.slice(0, Math.max(0, space));
    if (!use.length) return say(`${LX('한 동작에는 그림을', 'One action holds up to')} ${FRAMES_MAX}${LX('장까지 넣을 수 있어요.', ' pictures.')}`);
    const skipped = files.length - use.length;
    if (bgTolOf('role') > 0 || use.length === 1 || key !== 'idle') {   // look first (one picture can be cut or split there; 키 맞추기)
        closeRefit();
        win.rolePend = { pet: p, key, files: use, skipped, imgs: null, cuts: null, sheet: false, fit: null };
        return redoRolePreview();
    }
    const crop = win.body.querySelector('[data-f="rolecrop"]')?.checked !== false;
    busy = true;
    try {
        say(LX('그림 준비 중…', 'Preparing picture…'));
        await putRoleFrames(p, key, await prepareFrames(use, crop, 0), skipped);
    } catch (e) {
        say(LX('그림을 읽지 못했어요: ', 'Couldn’t read the picture: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

/** Process the waiting pictures again with the current switches and show them. */
async function redoRolePreview() {
    const pend = win.rolePend;
    if (!pend) return;
    const crop = win.body.querySelector('[data-f="rolecrop"]')?.checked !== false;
    const tol = bgTolOf('role');
    say(tol > 0 ? LX('배경 지우는 중…', 'Removing background…') : LX('그림 준비 중…', 'Preparing picture…'));
    try {
        const imgs = await prepareFrames(pend.files, crop, tol, pend.cuts);
        if (win.rolePend !== pend) return;
        pend.imgs = imgs;
        if (pend.key !== 'idle') {                                   // 키 맞추기 (keeps the choice when made again)
            const F = { pet: pend.pet, imgs, mode: pend.fit?.mode || 'auto', scale: pend.fit?.scale || 1 };
            await measureFit(F);
            if (win.rolePend !== pend) return;
            pend.fit = F;
        }
        say('');
    } catch (e) {
        if (win.rolePend === pend) { win.rolePend = null; say(LX('그림을 읽지 못했어요: ', 'Couldn’t read the picture: ') + (e.message || e)); }
    }
    drawRolePend();
}

function drawRolePend() {
    const box = win.body.querySelector('.tw-rolepend');
    if (!box) return;
    const pend = win.rolePend;
    box.hidden = !pend?.imgs;
    const cutBtn = box.querySelector('[data-act="pendcut"]');
    if (cutBtn) cutBtn.hidden = pend?.files?.length !== 1;
    const note = box.querySelector('.tw-cutnote');
    if (note) note.textContent = !pend?.cuts ? '' : pend.sheet ? LX(`${pend.cuts.length}장으로 나눴어요`, `Split into ${pend.cuts.length}`) : LX('직접 자른 부분만 써요', 'Only the part you cropped is used');
    box.querySelector('.tw-pendframes').innerHTML = pend?.imgs
        ? pend.imgs.map((im, i) => `<div class="tw-frame"><img class="tw-checker" src="${im.dataUrl}" alt=""><span>${i + 1}</span></div>`).join('') : '';
    const fb = box.querySelector('.tw-pendfit');
    if (fb) { fb.innerHTML = ''; if (pend?.fit) drawFit(); }
    if (pend?.imgs) box.scrollIntoView?.({ block: 'nearest' });
}

async function confirmRolePend() {
    const pend = win.rolePend;
    if (!pend?.imgs || busy) return;
    if (curPet() !== pend.pet || win.roleEdit !== pend.key) { win.rolePend = null; return drawRolePend(); }
    busy = true;
    try {
        let imgs;
        try {
            imgs = await fittedImgs(pend.fit, pend.imgs);
        } catch (e) {
            return say(LX('키를 맞추지 못했어요: ', 'Couldn’t match the height: ') + (e.message || e));
        }
        if (pend.fit) {                                                  // 0.10.9: remember the size picked (shown again in 다시 맞추기)
            const opts = pend.pet.look.roleOpts ??= {};
            const o = { ...(opts[pend.key] || {}) };
            const pct = Math.round((pend.fit.scale || 1) * 100);
            if (pend.fit.mode === 'off' || pct === 100) delete o.fitPct; else o.fitPct = pct;
            if (Object.keys(o).length) opts[pend.key] = o; else delete opts[pend.key];
        }
        await putRoleFrames(pend.pet, pend.key, imgs, pend.skipped);
    } finally {
        busy = false;
    }
}

/* ---- 0.7.5: one sheet → pictures for several actions at once ---- */

async function sheetPicked(input) {
    const file = input.files?.[0];
    input.value = '';
    const p = curPet();
    if (!p || !file) return;
    if (readOnly) return say(readOnlyReason);
    if (!ready) return say(LX('실리태번이 아직 준비 중이에요. 잠시 뒤 다시 해 주세요.', 'SillyTavern is still getting ready. Try again in a moment.'));
    if (file.size > 8 * 1024 * 1024) return say(LX('그림이 너무 커요 (8MB 이하).', 'The picture is too big (8 MB max).'));
    openCutter(file, {
        sheet: true, sheetOn: true, space: Infinity,
        done: (cuts) => {
            if (curPet() !== p) return;
            const rows = cuts ? cuts.map(c => c.row ?? 0) : [0];
            win.sheet = { pet: p, file, cuts, rows, picks: rows.map(() => ''), imgs: null, ref: 'auto', scale: 1, boxes: null, base: null };
            drawRoles();
            redoSheet();
        },
    });
}

/** Make the pieces again with the current switches (투명 여백 자르기, 배경 지우기). */
async function redoSheet() {
    const sh = win.sheet;
    if (!sh) return;
    const crop = win.body.querySelector('[data-f="rolecrop"]')?.checked !== false;
    const tol = bgTolOf('role');
    say(tol > 0 ? LX('배경 지우는 중…', 'Removing background…') : LX('그림 준비 중…', 'Preparing picture…'));
    try {
        const imgs = await prepareFrames([sh.file], crop, tol, sh.cuts);
        if (win.sheet !== sh) return;
        sh.imgs = imgs;
        await measureSheet(sh);
        if (win.sheet !== sh) return;
        say('');
    } catch (e) {
        if (win.sheet === sh) say(LX('그림을 읽지 못했어요: ', 'Couldn’t read the picture: ') + (e.message || e));
    }
    drawSheet();
}

function roleOptions(sel, first) {
    return first + ROLE_GROUPS.map(g => `<optgroup label="${esc(g.name)}">${g.roles.map(r => `<option value="${r.key}"${sel === r.key ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>`).join('');
}

/** Which picked pictures still fit (8 per action, after what's already there). */
function sheetFit(p, sh) {
    const count = {}, fit = [];
    sh.picks.forEach((k, i) => {
        if (!k) return;
        count[k] ??= k === 'idle' ? 0 : (p.look.roles[k]?.length || 0);   // 기본 is replaced, not added to
        if (count[k] < FRAMES_MAX) { count[k]++; fit[i] = true; } else fit[i] = false;
    });
    return fit;
}

function sheetHtml() {
    return `<div class="tw-btn tw-btn-small" data-act="sheetno"><i class="fa-solid fa-arrow-left"></i> ${LX('동작 목록', 'Action list')}</div>
<div class="tw-cap">${LX('어느 동작에 넣을까요?', 'Which action should each go to?')}</div>
<div class="tw-sub">${LX('그림 아래 칸을 눌러 동작을 골라요. 줄 옆 칸으로 그 줄 전부를 한 번에 고를 수도 있어요. 고르지 않은 그림은 넣지 않고, 이미 그림이 있는 동작에는 뒤에 붙어요.', 'Tap the box under a picture to pick an action. The box beside a row sets the whole row at once. Pictures without an action are skipped, and actions that already have pictures get them added at the end.')}</div>
<div class="tw-sheet"></div>
<div class="tw-sheet-ref"></div>
<label class="tw-check"><input type="checkbox" data-f="rolecrop" checked> ${LX('투명 여백 자르기', 'Trim transparent edges')}</label>
${bgHtml('role')}
<div class="tw-row"><div class="tw-btn tw-btn-main" data-act="sheetok"></div><div class="tw-btn" data-act="sheetno">${LX('취소', 'Cancel')}</div></div>
<div class="tw-msg"></div>`;
}

function drawSheet() {
    const p = curPet(), sh = win.sheet;
    const box = win.body.querySelector('.tw-sheet');
    if (!p || !sh || !box) return;
    if (!sh.imgs) { box.innerHTML = LX('<div class="tw-sub">준비 중…</div>', '<div class="tw-sub">Preparing…</div>'); return; }
    const fit = sheetFit(p, sh);
    const rows = [...new Set(sh.rows)];
    box.innerHTML = rows.map((r, ri) => {
        const idx = sh.rows.map((x, i) => (x === r ? i : -1)).filter(i => i >= 0);
        const tiles = idx.map(i => `<div class="tw-sheet-frame${sh.picks[i] ? '' : ' tw-sheet-none'}${fit[i] === false ? ' tw-sheet-over' : ''}">
  <div class="tw-frame"><img class="tw-checker" src="${sh.imgs[i]?.dataUrl || ''}" alt=""><span>${i + 1}</span></div>
  <select data-sheetpick="${i}">${roleOptions(sh.picks[i], `<option value=""${sh.picks[i] ? '' : ' selected'}>${LX('안 넣음', 'Skip')}</option>`)}</select>
</div>`).join('');
        const head = rows.length > 1 || idx.length > 1
            ? `<div class="tw-row tw-sheet-head"><span class="tw-sub">${rows.length > 1 ? LX(`${ri + 1}줄`, `Row ${ri + 1}`) : LX('전부', 'All')}</span><span class="tw-grow"></span><select data-sheetrow="${r}">${roleOptions('', LX('<option value="" selected>이 줄 전부 →</option><option value="-">안 넣음</option>', '<option value="" selected>Whole row →</option><option value="-">Skip</option>'))}</select></div>` : '';
        return `<div class="tw-sheet-row">${head}<div class="tw-sheet-frames">${tiles}</div></div>`;
    }).join('');
    // actions that overflow
    const over = {};
    sh.picks.forEach((k, i) => { if (k && fit[i] === false) over[k] = (over[k] || 0) + 1; });
    const warn = Object.entries(over).map(([k, n]) => {
        const room = FRAMES_MAX - (k === 'idle' ? 0 : (p.look.roles[k]?.length || 0));
        return `${esc(ROLE_DEFS[k]?.name || k)}: ${room > 0 ? LX(`${room}장만 더 들어가요`, `only ${room} more fit`) : LX('이미 가득 찼어요', 'already full')} ${LX(`(흐린 ${n}장은 빠져요)`, `(${n} faded ones left out)`)}`;
    });
    if (warn.length) box.insertAdjacentHTML('beforeend', `<div class="tw-sheet-warn">${warn.join('<br>')}</div>`);
    drawSheetRef(p, sh);
    const n = fit.filter(Boolean).length;
    const ok = win.body.querySelector('[data-act="sheetok"]');
    if (ok) ok.innerHTML = `<i class="fa-solid fa-check"></i> ${LX('넣기 (', 'Add (')}${n}${LX('장)', ')')}`;
}

function onSheetInput(t) {
    const sh = win.sheet;
    if (!sh) return;
    if (t.dataset.sheetpick != null) sh.picks[Number(t.dataset.sheetpick)] = ROLE_DEFS[t.value] ? t.value : '';
    if (t.dataset.sheetref != null) {
        const n = Number(t.value);
        sh.ref = t.value === 'auto' ? 'auto' : (Number.isInteger(n) && n >= 0 && n < sh.picks.length ? n : -1);
        sh.scale = 1;
    }
    if (t.dataset.sheetrow != null && t.value) {
        const r = Number(t.dataset.sheetrow), v = t.value === '-' ? '' : (ROLE_DEFS[t.value] ? t.value : '');
        sh.rows.forEach((x, i) => { if (x === r) sh.picks[i] = v; });
    }
    drawSheet();
}

async function confirmSheet() {
    const p = curPet(), sh = win.sheet;
    if (!p || !sh?.imgs || sh.pet !== p || busy) return;
    if (readOnly) return say(readOnlyReason);
    const fit = sheetFit(p, sh);
    const groups = new Map();                                        // action → pictures, in sheet order
    sh.picks.forEach((k, i) => { if (k && fit[i] && sh.imgs[i]) (groups.get(k) || groups.set(k, []).get(k)).push(sh.imgs[i]); });
    const total = [...groups.values()].reduce((a, l) => a + l.length, 0);
    if (!total) return say(LX('넣을 그림이 없어요. 그림 아래 칸에서 동작을 골라 주세요.', 'Nothing to add. Pick an action in the box under a picture.'));
    busy = true;
    const uploaded = [];
    try {
        const ri = sheetRefIndex(sh);
        if (!groups.has('idle') && ri >= 0 && sh.imgs[ri]) {                   // 키 맞추기: the whole sheet, to the 기본 picture
            say(LX('키 맞추는 중…', 'Matching height…'));
            const fitted = await fitSheet(p, sh.imgs[ri], [...groups.values()].flat(), sh.scale || 1);
            for (const [k, imgs] of groups) groups.set(k, imgs.map(im => fitted.get(im)));
        }
        say(LX(`그림 ${total}장 올리는 중…`, `Uploading ${total} picture${total === 1 ? '' : 's'}…`));
        const paths = new Map();
        for (const [k, imgs] of groups) {
            const res = await Promise.allSettled(imgs.map((im) => {
                const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
                return uploadFile(`tavvy_role_${id}.png`, im.base64);
            }));
            const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value);
            uploaded.push(...ok);
            const bad = res.find(r => r.status === 'rejected');
            if (bad) throw bad.reason;
            paths.set(k, ok);
        }
        if (curPet() !== p || win.sheet !== sh) throw new Error(LX('창이 바뀌었어요', 'The window changed'));
        win.sheet = null;
        const saved = await changeRoles(p, (look) => {
            for (const [k, list] of paths) look.roles[k] = [...(k === 'idle' ? [] : (look.roles[k] || [])), ...list].slice(0, FRAMES_MAX);   // 기본 is replaced
        });
        const names = [...paths.keys()].map(k => ROLE_DEFS[k]?.name || k).join(' · ');
        say((saved ? LX(`${total}장 넣었어요: ${names}`, `Added ${total}: ${names}`) : LX('넣었지만 저장이 늦어지고 있어요.', 'Added, but saving is slow.')));
    } catch (e) {
        console.error('[Tavvy] sheet pictures failed', e);
        for (const f of uploaded) if (!fileInUse(f)) deleteFile(f);
        say(LX('그림을 넣지 못했어요: ', 'Couldn’t add the pictures: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

/** 키 맞추기: the figure boxes of the sheet pictures and of the 기본 picture (for 자동 and the preview). */
async function measureSheet(sh) {
    try {
        const p = sh.pet;
        const base = await canvasOf(imgUrl(p.look.roles.idle[0]));
        const bb = opaqueBox(base.g, base.w, base.h);
        const boxes = [];
        for (const im of sh.imgs) {
            const c = await canvasOf(im.dataUrl);
            boxes.push(opaqueBox(c.g, c.w, c.h));
        }
        sh.base = bb ? { box: bb, url: imgUrl(p.look.roles.idle[0]), w: base.w, h: base.h } : null;
        sh.boxes = boxes;
    } catch (e) {
        console.warn('[Tavvy] could not measure the sheet', e);
        sh.base = null; sh.boxes = null;
    }
}

/** The picture to match heights by: the chosen number, or (자동) the one shaped most like the 기본 picture. -1 = none. */
function sheetRefIndex(sh) {
    if (sh.ref !== 'auto') return sh.ref;
    if (!sh.base || !sh.boxes) return -1;
    const want = sh.base.box.sw / sh.base.box.sh;
    let best = -1, bestD = Infinity;
    sh.boxes.forEach((b, i) => {
        if (!b) return;
        const d = Math.abs(Math.log((b.sw / b.sh) / want));
        if (d < bestD) { bestD = d; best = i; }
    });
    return best;
}

/** sheet px → 기본 px for the reference picture (× the 막대). */
function sheetK(sh, i) {
    const b = sh.boxes?.[i];
    if (!b || !sh.base) return 0;
    return sh.base.box.sh / b.sh * (sh.scale || 1);
}

/** Under the sheet: 기본 picked → it replaces the old one; otherwise 키 맞추기 with a preview over the 기본 picture. */
function drawSheetRef(p, sh) {
    const box = win.body.querySelector('.tw-sheet-ref');
    if (!box) return;
    if (sh.picks.includes('idle')) {
        box.innerHTML = LX('<div class="tw-sub">기본으로 고른 그림이 원래 기본 그림을 바꿔요. 같은 시트 그림끼리는 크기가 딱 맞아요.</div>', '<div class="tw-sub">A picture chosen for Basic replaces the old basic picture. Pictures from the same sheet match in size exactly.</div>');
        return;
    }
    const ri = sheetRefIndex(sh);
    const autoName = sh.ref === 'auto' && ri >= 0 ? LX(` (${ri + 1}번)`, ` (#${ri + 1})`) : '';
    const opts = sh.picks.map((_, i) => `<option value="${i}"${sh.ref === i ? ' selected' : ''}${LX(`>${i + 1}번 그림`, `>Picture ${i + 1}`)}</option>`).join('');
    const pct = Math.round((sh.scale || 1) * 100);
    box.innerHTML = `<div class="tw-row"><span class="tw-cap tw-grow">${LX('키 맞추기', 'Match height')}</span><select data-sheetref="1"><option value="auto"${sh.ref === 'auto' ? ' selected' : ''}>${LX('자동', 'Auto ')}${autoName}</option><option value="-1"${sh.ref === -1 ? ' selected' : ''}>${LX('맞추지 않음', 'Don’t match')}</option>${opts}</select></div>
<div class="tw-sub">${LX('기본 그림과 가장 닮은 그림(보통 서 있는 그림)을 찾아, 그 그림 속 키가 기본 그림 속 키와 같아지게 시트 전체를 맞춰 넣어요. 어긋나 보이면 다른 번호를 고르거나 막대로 맞춰요.', 'Finds the picture most like the basic one (usually standing) and scales the whole sheet so its height matches the basic picture. If it looks off, pick another number or adjust with the slider.')}</div>`
        + (ri >= 0 && sheetK(sh, ri) > 0 ? `<div class="tw-fitprev"><img class="tw-fit-base" alt=""><img class="tw-fit-ref" alt=""></div>
<div class="tw-row"><span class="tw-sub">${LX('크기', 'Size')}</span><input type="range" min="50" max="200" step="5" value="${pct}" data-sheetscale="1" class="tw-grow"><span class="tw-sub tw-fitpct">${pct}%</span></div>
<div class="tw-sub">${LX('흐린 그림이 지금 기본 그림이에요.', 'The faded picture is the current basic picture.')}</div>` : '');
    placeFitPreview(sh);
}

/** Both pictures in the preview, standing on the same ground, at the scale they will have on screen. */
function placeFitPreview(sh) {
    const box = win.body.querySelector('.tw-fitprev');
    const ri = sheetRefIndex(sh);
    if (!box || ri < 0 || !sh.base) return;
    const H = 150, u = H / sh.base.h;                       // preview px per 기본 px
    const k = sheetK(sh, ri), ref = sh.imgs[ri];
    const bi = box.querySelector('.tw-fit-base'), fi = box.querySelector('.tw-fit-ref');
    if (bi.getAttribute('src') !== sh.base.url) bi.src = sh.base.url;
    if (fi.getAttribute('src') !== ref.dataUrl) fi.src = ref.dataUrl;
    bi.style.width = (sh.base.w * u).toFixed(1) + 'px'; bi.style.height = H + 'px';
    fi.style.width = (ref.w * k * u).toFixed(1) + 'px'; fi.style.height = (ref.h * k * u).toFixed(1) + 'px';
    const pct = win.body.querySelector('.tw-fitpct');
    if (pct) pct.textContent = Math.round((sh.scale || 1) * 100) + '%';
}

async function canvasOf(src) {
    const im = await loadImage(src);
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    return { cv, g, w: cv.width, h: cv.height };
}

/**
 * 키 맞추기: scale every picture of the sheet by one factor, so that the reference picture's figure is as
 * tall as the figure in the 기본 picture. The results are drawn at the 기본 picture's scale (not squeezed
 * into its box — a lying-down picture may be wider), which FIT_MARK tells the pet.
 * Returns Map(old picture → new picture).
 */
async function fitSheet(p, refImg, imgs, scale = 1) {
    const base = await canvasOf(imgUrl(p.look.roles.idle[0]));
    const bb = opaqueBox(base.g, base.w, base.h);
    const ref = await canvasOf(refImg.dataUrl);
    const rb = opaqueBox(ref.g, ref.w, ref.h);
    if (!bb || !rb) throw new Error(LX('기준 그림이 비어 있어요', 'The reference picture is empty'));
    return fitWithK(imgs, bb.sh / rb.sh * scale);              // sheet px → 기본 px (× the 막대)
}

/** Draw pictures at k (picture px → 기본 px) with the FIT_MARK. Returns Map(old picture → new picture). */
async function fitWithK(imgs, k) {
    const big = Math.max(...imgs.map(im => Math.max(im.w, im.h))) * k;
    let m = k < 1 ? clamp(Math.round(1 / k), 1, FIT_M_MAX) : 1;   // drawn m× finer than the 기본 picture, so it stays sharp
    while (m > 1 && big * m > FIT_MAX_PX) m--;
    const out = new Map();
    for (const im of new Set(imgs)) {
        const c = await cleanCanvas(im.dataUrl);
        const w = Math.max(FIT_MARK.length + 1, Math.round(c.w * k * m)), h = Math.max(1, Math.round(c.h * k * m));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(c.cv, 0, 0, w, h);
        const mark = g.createImageData(FIT_MARK.length + 1, 1);
        [...FIT_MARK, m].forEach((a, i) => { mark.data[i * 4 + 3] = a; });
        g.putImageData(mark, 0, 0);
        const dataUrl = cv.toDataURL('image/png');
        out.set(im, { base64: dataUrl.split(',')[1], dataUrl, w, h });
    }
    return out;
}

/* ---- 0.8.3: 키 맞추기 for pictures put in one action at a time, and for pictures already in ---- */

const FIT_LIKE = 0.4;            // |log(shape ratio)| under this = shaped like the 기본 picture → 자동 matches heights

/** A picture on a canvas with its 키 맞추기 mark wiped (so it doesn't count as part of the figure). fm = its m, or 0. */
async function cleanCanvas(src) {
    const c = await canvasOf(src);
    const n = FIT_MARK.length + 1;
    c.fm = 0;
    if (c.w >= n) {
        const d = c.g.getImageData(0, 0, n, 1).data;
        if (FIT_MARK.every((a, i) => d[i * 4 + 3] === a) && d[(n - 1) * 4 + 3] >= 1) { c.fm = d[(n - 1) * 4 + 3]; c.g.clearRect(0, 0, n, 1); }
    }
    return c;
}

/**
 * A fit state F = { pet, imgs: [{ dataUrl, w, h }], mode: 'auto' | 'fit' | 'off', scale, base, boxes, cur }.
 * cur[i] = the scale (picture px → 기본 px) picture i is shown at now: squeezed into the pet's box, or its mark.
 */
async function measureFit(F) {
    try {
        const url = imgUrl(F.pet.look.roles.idle[0]);
        const base = await cleanCanvas(url);
        const bb = opaqueBox(base.g, base.w, base.h);
        F.boxes = []; F.cur = [];
        for (const im of F.imgs) {
            const c = await cleanCanvas(im.dataUrl);
            F.boxes.push(opaqueBox(c.g, c.w, c.h));
            F.cur.push(c.fm ? 1 / c.fm : Math.min(base.w / c.w, base.h / c.h));
        }
        F.base = bb ? { box: bb, url, w: base.w, h: base.h } : null;
    } catch (e) {
        console.warn('[Tavvy] could not measure for height matching', e);
        F.base = null; F.boxes = null;
    }
}

/** The picture most like the 기본 picture in shape, and how alike (log ratio, 0 = same). */
function fitRef(F) {
    if (!F.base || !F.boxes) return { i: -1, d: Infinity };
    const want = F.base.box.sw / F.base.box.sh;
    let i = -1, d = Infinity;
    F.boxes.forEach((b, j) => {
        if (!b) return;
        const dj = Math.abs(Math.log((b.sw / b.sh) / want));
        if (dj < d) { d = dj; i = j; }
    });
    return { i, d };
}

/** Does 키 맞추기 match heights (true) or keep today's size (false)? */
const fitMatches = (F) => F.mode === 'fit' || (F.mode === 'auto' && fitRef(F).d < FIT_LIKE);

/** picture px → 기본 px for the result, or 0 = leave the pictures as they are. */
function fitKOf(F) {
    const { i } = fitRef(F);
    if (F.mode === 'off' || i < 0) return 0;
    if (fitMatches(F)) return F.base.box.sh / F.boxes[i].sh * (F.scale || 1);
    return F.cur[i] * (F.scale || 1) / (F.prev || 1);        // 0.10.9: already at prev (e.g. 105%) → only the difference
}

/** Nothing would change: plain pictures kept at the size they already show at. */
const fitIdle = (F) => !fitKOf(F) || (!fitMatches(F) && (F.scale || 1) === (F.prev || 1) && F.cur.every((k, i) => Math.abs(k - Math.min(F.base.w / F.imgs[i].w, F.base.h / F.imgs[i].h)) < 1e-6));

function fitHtml(F) {
    if (!F.base || !F.boxes) return F.boxes === undefined ? LX('<div class="tw-sub">크기 재는 중…</div>', '<div class="tw-sub">Measuring…</div>') : '';
    const like = fitRef(F).d < FIT_LIKE;
    const pct = Math.round((F.scale || 1) * 100);
    const k = fitKOf(F);
    return `<div class="tw-row"><span class="tw-cap tw-grow">${LX('키 맞추기', 'Match height')}</span><select data-fitmode="1">
  <option value="auto"${F.mode === 'auto' ? ' selected' : ''}>${LX('자동 (', 'Auto (')}${like ? LX('키 맞춤', 'height match') : LX('지금 크기', 'current size')})</option>
  <option value="fit"${F.mode === 'fit' ? ' selected' : ''}>${LX('기본 그림과 키 같게', 'Same height as basic picture')}</option>
  <option value="off"${F.mode === 'off' ? ' selected' : ''}>${LX('맞추지 않음', 'Don’t match')}</option></select></div>
<div class="tw-sub">${F.mode === 'off' ? LX('펫 칸에 맞춰 줄여 넣어요 (예전 방식).', 'Shrinks it to fit the pet box (the old way).') : like || F.mode === 'fit' ? LX('그림 속 키가 기본 그림 속 키와 같아지게 맞춰요.', 'Scales it so its height matches the basic picture.') : LX('기본 그림과 모양이 달라서(누운 그림 등) 지금 보이는 크기에서 시작해요. 막대로 맞춰요.', 'It’s shaped differently from the basic picture (lying down, etc.), so it starts at the current size. Adjust with the slider.')}</div>`
        + (k > 0 ? `<div class="tw-fitprev"><img class="tw-fit-base" alt=""><img class="tw-fit-ref" alt=""></div>
<div class="tw-row"><span class="tw-sub">${LX('크기', 'Size')}</span><input type="range" min="30" max="200" step="5" value="${pct}" data-fitscale="1" class="tw-grow"><span class="tw-sub tw-fitpct">${pct}%</span></div>
<div class="tw-sub">${LX('흐린 그림이 지금 기본 그림이에요.', 'The faded picture is the current basic picture.')}${F.prev ? LX(' 크기를 여러 번 바꾸면 그림이 조금씩 흐려질 수 있어요.', ' Resizing many times can make the picture slightly blurry.') : ''}</div>` : '');
}

/** The preview: the reference picture over the 기본 picture, standing on the same ground, at screen scale. */
function placeFitPrev(box, base, ref, k, scale) {
    if (!box || !base || !ref || !(k > 0)) return;
    const H = 150, u = H / base.h;
    const bi = box.querySelector('.tw-fit-base'), fi = box.querySelector('.tw-fit-ref');
    if (bi.getAttribute('src') !== base.url) bi.src = base.url;
    if (fi.getAttribute('src') !== ref.dataUrl) fi.src = ref.dataUrl;
    bi.style.width = (base.w * u).toFixed(1) + 'px'; bi.style.height = H + 'px';
    fi.style.width = (ref.w * k * u).toFixed(1) + 'px'; fi.style.height = (ref.h * k * u).toFixed(1) + 'px';
    const pct = box.parentElement?.querySelector('.tw-fitpct');
    if (pct) pct.textContent = Math.round((scale || 1) * 100) + '%';
}

/** The fit state showing now (the waiting new pictures, or 다시 맞추기) and its box. */
function curFit() {
    if (win?.rolePend?.fit) return { F: win.rolePend.fit, box: win.body.querySelector('.tw-pendfit') };
    if (win?.refit) return { F: win.refit, box: win.body.querySelector('.tw-refitbox') };
    return null;
}

function drawFit() {
    const c = curFit();
    if (!c?.box) return;
    c.box.innerHTML = fitHtml(c.F);
    placeFit();
}

function placeFit() {
    const c = curFit();
    if (!c?.box) return;
    const { i } = fitRef(c.F);
    placeFitPrev(c.box.querySelector('.tw-fitprev'), c.F.base, c.F.imgs[i], fitKOf(c.F), c.F.scale);
}

function onFitInput(t, change) {
    const c = curFit();
    if (!c) return;
    if (t.dataset.fitmode != null) {
        if (!change) return;
        c.F.mode = ['auto', 'fit', 'off'].includes(t.value) ? t.value : 'auto';
        c.F.scale = c.F.prev || 1;
        return drawFit();
    }
    c.F.scale = clamp(Number(t.value) || 100, 30, 200) / 100;
    placeFit();
}

/** The pictures as they will go in: fitted if 키 맞추기 says so. */
async function fittedImgs(F, imgs) {
    if (!F || fitIdle(F)) return imgs;
    say(LX('키 맞추는 중…', 'Matching height…'));
    const out = await fitWithK(imgs, fitKOf(F));
    return imgs.map(im => out.get(im));
}

/** 다시 맞추기: the pictures already in this action, fitted again (or put back to squeezed-in). */
async function openRefit() {
    const p = curPet(), key = win.roleEdit;
    const list = p?.look.roles[key];
    if (!list?.length || key === 'idle') return;
    win.rolePend = null; drawRolePend();
    const prev = clamp((Number(p.look.roleOpts?.[key]?.fitPct) || 100) / 100, 0.3, 2);   // 0.10.9: the size picked last time
    const F = { pet: p, key, imgs: [], mode: 'auto', scale: prev, prev };
    win.refit = F;
    const box = win.body.querySelector('.tw-refit');
    if (box) box.hidden = false;
    drawFit();
    try {
        for (const path of list) {
            const c = await canvasOf(imgUrl(path));
            F.imgs.push({ dataUrl: imgUrl(path), w: c.w, h: c.h, path });
        }
        await measureFit(F);
    } catch (e) {
        if (win.refit === F) { win.refit = null; if (box) box.hidden = true; say(LX('그림을 읽지 못했어요: ', 'Couldn’t read the picture: ') + (e.message || e)); }
        return;
    }
    if (win.refit !== F) return;
    // 자동 starts from the size they show at now: a picture fitted before keeps its size
    drawFit();
    box?.scrollIntoView?.({ block: 'nearest' });
}

function closeRefit() {
    win.refit = null;
    const box = win.body.querySelector('.tw-refit');
    if (box) box.hidden = true;
}

async function confirmRefit() {
    const F = win.refit, p = curPet();
    if (!F?.boxes || busy || !p || F.pet !== p || win.roleEdit !== F.key) return;
    if (readOnly) return say(readOnlyReason);
    const was = F.cur.map((k, i) => Math.abs(k - Math.min(F.base.w / F.imgs[i].w, F.base.h / F.imgs[i].h)) > 1e-6);   // already fitted
    let imgs;
    busy = true;
    const uploaded = [];
    try {
        if (F.mode === 'off') {                                   // back to squeezed into the box: just drop the mark
            if (!was.some(Boolean)) { closeRefit(); return say(LX('바꿀 게 없어요.', 'Nothing to change.')); }
            imgs = [];
            for (const im of F.imgs) {
                const c = await cleanCanvas(im.dataUrl);
                const dataUrl = c.cv.toDataURL('image/png');
                imgs.push({ base64: dataUrl.split(',')[1], dataUrl, w: c.w, h: c.h });
            }
        } else {
            if (fitIdle(F)) { closeRefit(); return say(LX('바꿀 게 없어요.', 'Nothing to change.')); }
            imgs = await fittedImgs(F, F.imgs);
        }
        say(LX('그림 올리는 중…', 'Uploading picture…'));
        const res = await Promise.allSettled(imgs.map((im) => {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
            return uploadFile(`tavvy_role_${id}.png`, im.base64);
        }));
        for (const r of res) if (r.status === 'fulfilled') uploaded.push(r.value);
        const bad = res.find(r => r.status === 'rejected');
        if (bad) throw bad.reason;
        if (curPet() !== p || win.roleEdit !== F.key || win.refit !== F) throw new Error(LX('창이 바뀌었어요', 'The window changed'));
        const olds = F.imgs.map(im => im.path);
        win.refit = null;
        const ok = await changeRoles(p, (look) => {
            const cur = look.roles[F.key] || [];
            look.roles[F.key] = cur.map(f => { const j = olds.indexOf(f); return j >= 0 ? uploaded[j] : f; });
            const o = { ...(look.roleOpts[F.key] || {}) };            // 0.10.9: remember the size picked (shown again next time)
            if (F.mode === 'off' || Math.round((F.scale || 1) * 100) === 100) delete o.fitPct; else o.fitPct = Math.round(F.scale * 100);
            look.roleOpts[F.key] = o;
        });
        say(ok ? LX('크기를 맞췄어요.', 'Size adjusted.') : LX('바꿨지만 저장이 늦어지고 있어요.', 'Changed, but saving is slow.'));
    } catch (e) {
        console.error('[Tavvy] refit failed', e);
        for (const f of uploaded) if (!fileInUse(f)) deleteFile(f);
        say(LX('크기를 바꾸지 못했어요: ', 'Couldn’t resize: ') + (e.message || e));
    } finally {
        busy = false;
    }
}

/** Upload ready pictures into one action's slot. */
async function putRoleFrames(p, key, imgs, skipped) {
    const uploaded = [];
    try {
        say(imgs.length > 1 ? LX(`그림 ${imgs.length}장 올리는 중…`, `Uploading ${imgs.length} pictures…`) : LX('그림 올리는 중…', 'Uploading picture…'));
        const res = await Promise.allSettled(imgs.map((im) => {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
            return uploadFile(`tavvy_role_${id}.png`, im.base64);
        }));
        for (const r of res) if (r.status === 'fulfilled') uploaded.push(r.value);
        const bad = res.find(r => r.status === 'rejected');
        if (bad) throw bad.reason;
        if (curPet() !== p || win.roleEdit !== key) throw new Error(LX('창이 바뀌었어요', 'The window changed'));
        const ok = await changeRoles(p, (look) => { look.roles[key] = [...(look.roles[key] || []), ...uploaded]; });
        say((ok ? LX(`${uploaded.length}장 넣었어요.`, `Added ${uploaded.length}.`) : LX('넣었지만 저장이 늦어지고 있어요.', 'Added, but saving is slow.')) + (skipped ? LX(` (${FRAMES_MAX}장이 넘어서 ${skipped}장은 뺐어요)`, ` (over ${FRAMES_MAX}, so ${skipped} left out)`) : ''));
    } catch (e) {
        console.error('[Tavvy] role pictures failed', e);
        for (const f of uploaded) if (!fileInUse(f)) deleteFile(f);
        say(LX('그림을 넣지 못했어요: ', 'Couldn’t add the pictures: ') + (e.message || e));
    }
}

/** Show the strength bar only while "배경 지우기" is on. */
function showBgRow(prefix) {
    const row = win.body.querySelector(`[data-bgrow="${prefix}"]`);
    const on = win.body.querySelector(`[data-f="${prefix}bg"]`);
    if (row && on) row.hidden = !on.checked;
}

async function delRoleFrame(i) {
    const p = curPet(), key = win.roleEdit;
    if (!p || !key || busy) return;
    if (readOnly) return say(readOnlyReason);
    const list = p.look.roles[key] || [];
    if (!list[i] || (key === 'idle' && list.length < 2)) return;
    busy = true;
    try {
        await changeRoles(p, (look) => { look.roles[key] = list.filter((_, j) => j !== i); });
        say(LX('그림을 뺐어요.', 'Picture removed.'));
    } finally { busy = false; }
}

async function moveRoleFrame(i) {
    const p = curPet(), key = win.roleEdit;
    if (!p || !key || busy || readOnly) return;
    const list = [...(p.look.roles[key] || [])];
    if (i < 1 || i >= list.length) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    busy = true;
    try { await changeRoles(p, (look) => { look.roles[key] = list; }); } finally { busy = false; }
}

async function setRoleOpt(name, value) {
    const p = curPet(), key = win.roleEdit;
    if (!p || !key || busy) return;
    if (readOnly) return say(readOnlyReason);
    busy = true;
    try {
        await changeRoles(p, (look) => {
            const o = { ...(look.roleOpts[key] || {}) };
            if (name === 'speed') { if (FRAME_FPS[value] && value !== 'normal') o.speed = value; else delete o.speed; }
            if (name === 'facing') { if (['front', 'left', 'right'].includes(value)) o.facing = value; else delete o.facing; }
            look.roleOpts[key] = o;
        });
        say(LX('바꿨어요.', 'Changed.'));
    } finally { busy = false; }
}

/* ---------- 대사 tab: lines for little moments + special days ---------- */

function dateRowHtml(d) {
    const [m, day] = String(d.md || '01-01').split('-').map(Number);
    return `<div class="tw-date" data-date="${esc(d.id)}">
  <select data-dk>${Object.entries(DATE_KINDS).map(([k, v]) => `<option value="${k}"${d.kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
  <select data-dm>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${m === i + 1 ? ' selected' : ''}>${LX(`${i + 1}월`, EN_MON[i])}</option>`).join('')}</select>
  <select data-dd>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${day === i + 1 ? ' selected' : ''}>${i + 1}${LX('일', '')}</option>`).join('')}</select>
  <div class="tw-icon tw-icon-small" data-deldate title="${LX('지우기', 'Delete')}"><i class="fa-solid fa-xmark"></i></div>
  <input data-dmsg maxlength="${LINE_MAX}" placeholder="${LX('축하 말 (비우면 성격에 맞는 기본 말)', 'Message (empty = default line for its personality)')}" value="${esc(d.msg || '')}">
</div>`;
}

function talkHtml(p) {
    const met = dayKey(p.createdAt || Date.now()).slice(5).split('-').map(Number);
    return `<div class="tw-form">
  <label class="tw-label">${LX('말하는 빈도', 'How often it talks')}
    <select data-t="freq">${Object.entries(TALK_FREQ).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
  </label>
  <div class="tw-sub">${LX('순간마다 한 줄에 하나씩 적어요. 여러 줄이면 그때그때 하나를 골라 펫 머리 위 말풍선으로 말해요.', 'Write one line per row for each moment. With several, one is picked each time and said in a bubble above the pet.')} <b>{{user}}</b>${LX('는 나를 부르는 이름(꾸미기 탭, 비우면 내 이름)으로,', ' becomes what it calls you (Style tab; empty = your name),')} <b>{{pet}}</b>${LX('은 상대 펫 이름으로 바뀌어요. 바로 뒤 조사(은/는·이/가 등)는 이름에 맞게 저절로 바뀌어요. 한 줄은', ' becomes the other pet’s name. A line can be up to')} ${LINE_MAX}${LX('자까지예요.', ' characters.')}</div>
  <div class="tw-sub">${LX('회색 글씨가 기본 대사인 칸은 비워 두면 성격에 맞는 그 대사를 해요. 직접 적으면 적은 것만 써요.', 'Where the grey text shows default lines, an empty box uses those (they suit its personality). Write your own and only yours are used.')}</div>
  ${TALK_GROUPS.map(g => talkGroupHtml(p, g)).join('\n  ')}
  <div class="tw-btn tw-wide" data-act="aifill"><i class="fa-solid fa-wand-magic-sparkles"></i> ${LX('AI로 빈 칸 채우기', 'Fill empty slots with AI')}</div>
  <div class="tw-sub">${LX('누를 때만 한 번 만들어요. AI에게는 펫 이름과 성격만 보내요. 마음에 안 드는 줄은 저장하기 전에 고치거나 지우면 돼요.', 'Runs once, only when pressed. Only the pet’s name and personality are sent to the AI. Edit or delete lines you don’t like before saving.')}</div>

  <div class="tw-cap">${LX('기념일', 'Anniversary')}</div>
  <label class="tw-check"><input type="checkbox" data-t="met"> ${LX(`만난 날(${met[0]}월 ${met[1]}일)도 매년 축하하기`, `Also celebrate the day we met (${EN_MON[met[0] - 1]} ${met[1]}) every year`)}</label>
  <div class="tw-dates"></div>
  <div class="tw-btn tw-btn-small" data-act="adddate"><i class="fa-solid fa-plus"></i> ${LX('날짜 넣기', 'Add a date')}</div>
  <div class="tw-sub">${LX('매년 그날 침대 옆에', 'Every year on that day,')} "${LX('할 말이 있어!', 'Something to say!')}"${LX('가 떠요. 깨우면 색깔 ✦ 속에서 춤추고 축하 말을 해요. 그날 못 만나면 7일 안에', ' shows by the bed. Wake it and it dances in colorful ✦ and says its message. If you miss the day, within 7 days it says')} "${LX('늦었지만…', 'A bit late, but…')}" ${LX('하고 해 줘요.', 'first.')}</div>

  <div class="tw-btn tw-btn-main tw-wide" data-act="savetalk">${LX('저장', 'Save')}</div>
  <div class="tw-msg"></div>
</div>`;
}

/** One line box of the 대사 tab. */
function talkBoxHtml(p, key) {
    const m = TALK_MOMENTS.find(x => x.key === key);
    if (!m) return '';
    const def = NOTICE_LINES[key] ? linesFor({ personality: p.personality }, key) : null;
    const ph = def ? `${LX('기본:', 'Default:')} ${def.join(' / ')}` : `${LX('예)', 'e.g.')} ${m.ex}`;
    return `<label class="tw-label">${esc(m.name)}<textarea data-line="${m.key}" rows="2" placeholder="${esc(ph)}"></textarea></label>`;
}

/** 0.11.17: a group of the 대사 tab, folded (one open at a time). */
function talkGroupHtml(p, g) {
    const open = (win.talkOpen ?? 'daily') === g.key;
    const rows = g.rows.map(([cap, keys]) => (cap ? `<div class="tw-minicap">${esc(cap)}</div>` : '') + keys.map(k => talkBoxHtml(p, k)).join('')).join('');
    const sub = g.fold ? `<details class="tw-fold tw-fold-in" data-tsub="${g.fold.key}"${win.talkSubOpen ? ' open' : ''}><summary>${esc(g.fold.name)} <span class="tw-sub" data-tcount="${g.fold.key}"></span></summary>
    <div class="tw-sub">${LX('여기 적은 대사와 위 "메뉴 열기" 대사 중 하나를 골라 말해요. 확장 메뉴는 알아보지 않아요.', 'It says one of these or one of the "Opening a menu" lines above. The Extensions menu isn’t noticed.')}</div>
    ${g.fold.keys.map(k => talkBoxHtml(p, k)).join('')}</details>` : '';
    return `<details class="tw-fold" data-tgroup="${g.key}"${open ? ' open' : ''}><summary>${esc(g.name)} <span class="tw-sub" data-tcount="${g.key}"></span></summary>${rows}${sub}${g.duets ? duetHtml(p) : ''}</details>`;
}

/** "2/5칸 적음" next to each group. */
function talkCounts() {
    const box = win?.body.querySelector('[data-pane="talk"]');
    if (!box) return;
    const keysOf = (g) => g.rows.flatMap(r => r[1]);
    const put = (key, keys) => {
        const el = box.querySelector(`[data-tcount="${key}"]`);
        if (!el) return;
        const n = keys.filter(k => box.querySelector(`[data-line="${k}"]`)?.value.trim()).length;
        el.textContent = `${n}/${keys.length}${LX('칸 적음', ' written')}`;
    };
    for (const g of TALK_GROUPS) { put(g.key, keysOf(g)); if (g.fold) put(g.fold.key, g.fold.keys); }
}

function fillTalk(p) {
    const box = win.body.querySelector('[data-pane="talk"]');
    if (!box) return;
    box.querySelector('[data-t="freq"]').value = TALK_FREQ[p.talkFreq] ? p.talkFreq : 'some';
    box.querySelector('[data-t="met"]').checked = p.metOn !== false;
    for (const m of TALK_MOMENTS) box.querySelector(`[data-line="${m.key}"]`).value = (p.lines?.[m.key] || []).join('\n');
    box.querySelector('.tw-dates').innerHTML = (p.dates || []).map(dateRowHtml).join('');
    for (const ta of box.querySelectorAll('[data-duet]')) {
        const o = root.pets.find(x => x.id === ta.dataset.duet);
        ta.value = o ? duetText(p, o) : '';
    }
    talkCounts();
    if (!box.dataset.tfold) {                     // 0.11.17: one group open at a time; counts follow typing
        box.dataset.tfold = '1';
        box.addEventListener('toggle', (e) => {
            const d = e.target;
            if (d.dataset?.tsub) { win.talkSubOpen = d.open; return; }
            if (!d.dataset?.tgroup) return;
            if (d.open) { win.talkOpen = d.dataset.tgroup; for (const o of box.querySelectorAll('[data-tgroup]')) if (o !== d) o.open = false; }
            else if (win.talkOpen === d.dataset.tgroup) win.talkOpen = '';
        }, true);
        box.addEventListener('input', (e) => { if (e.target?.dataset?.line) talkCounts(); });
    }
    win.talkBase = JSON.stringify(readTalk());
}

const splitLines = (text) => String(text || '').split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** What the 대사 tab says right now (as it would be saved). */
function readTalk() {
    const box = win?.body.querySelector('[data-pane="talk"]');
    if (!box) return null;
    const lines = {};
    for (const m of TALK_MOMENTS) {
        const l = splitLines(box.querySelector(`[data-line="${m.key}"]`)?.value).map(x => x.slice(0, LINE_MAX)).slice(0, LINES_MAX);
        if (l.length) lines[m.key] = l;
    }
    const dates = [...box.querySelectorAll('.tw-date')].map(row => {
        const m = Number(row.querySelector('[data-dm]').value) || 1;
        const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
        const d = clamp(Number(row.querySelector('[data-dd]').value) || 1, 1, maxDay);
        const kind = DATE_KINDS[row.querySelector('[data-dk]').value] ? row.querySelector('[data-dk]').value : 'anniv';
        return { id: row.dataset.date, kind, md: `${pad2(m)}-${pad2(d)}`, msg: row.querySelector('[data-dmsg]').value.trim().slice(0, LINE_MAX) };
    });
    const freq = box.querySelector('[data-t="freq"]').value;
    const duets = {};
    const p = curPet();
    for (const ta of box.querySelectorAll('[data-duet]')) {
        const o = root.pets.find(x => x.id === ta.dataset.duet);
        if (p && o) duets[o.id] = parseDuet(ta.value, p, o);
    }
    return { freq: TALK_FREQ[freq] ? freq : 'some', met: !!box.querySelector('[data-t="met"]').checked, lines, dates, duets };
}

function talkDirty() {
    if (win?.view !== 'pet' || !win.talkBase) return false;
    return JSON.stringify(readTalk()) !== win.talkBase;
}

async function saveTalk() {
    const p = curPet();
    if (!p || busy) return;
    if (readOnly) return say(readOnlyReason);
    if (!ready) return say(LX('실리태번이 아직 준비 중이에요. 잠시 뒤 다시 눌러 주세요.', 'SillyTavern is still getting ready. Try again in a moment.'));
    if (!talkDirty()) return say(LX('바뀐 게 없어요.', 'Nothing changed.'));
    const box = win.body.querySelector('[data-pane="talk"]');
    const long = TALK_MOMENTS.some(m => splitLines(box.querySelector(`[data-line="${m.key}"]`).value).some(x => x.length > LINE_MAX))
        || [...box.querySelectorAll('[data-duet]')].some(ta => splitLines(ta.value).some(x => x.replace(/^[^:：]{1,24}[:：]\s*/, '').length > LINE_MAX));
    const v = readTalk();
    p.talkFreq = v.freq;
    p.metOn = v.met;
    p.lines = v.lines;
    p.dates = v.dates;
    for (const [oid, list] of Object.entries(v.duets || {})) {       // 0.10.8: talks with pets in the same room
        const k = duetKey(p.id, oid);
        if (list.length) root.duets[k] = list; else delete root.duets[k];
        duetDeck.delete(k);
    }
    if (p.celebrated) for (const id of Object.keys(p.celebrated)) if (id !== 'met' && !v.dates.some(d => d.id === id)) delete p.celebrated[id];
    busy = true;
    try {
        const ok = await saveNow();
        if (!ok) saveSoon();
        fillTalk(p);
        renderPanel();
        say((ok ? LX('저장했어요.', 'Saved.') : LX('바꿨지만 저장이 늦어지고 있어요. 잠시 뒤 다시 저장돼요.', 'Changed, but saving is slow. It’ll save again shortly.')) + (long ? LX(` (${LINE_MAX}자가 넘는 줄은 잘랐어요)`, ` (lines over ${LINE_MAX} characters were cut)`) : ''));
    } finally { busy = false; }
}

function addDateRow() {
    const box = win.body.querySelector('[data-pane="talk"] .tw-dates');
    if (!box) return;
    const t = new Date();
    box.insertAdjacentHTML('beforeend', dateRowHtml({ id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'me', md: `${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`, msg: '' }));
}

/* ---------- 0.10.8 대사 탭: talks with the other pets in the same room ---------- */

/** Pets living in the same room as p. */
function roommates(p) {
    const h = p?.home;
    if (!h) return [];
    return root.pets.filter(o => o !== p && o.home && o.home.chatId === h.chatId && (o.home.integrity || '') === (h.integrity || ''));
}

/** The names written before each line (two pets of the same name get ① ②). */
function duetLabels(p, o) {
    const a = String(p.name || LX('펫', 'Pets')), b = String(o.name || LX('펫', 'Pets'));
    return a === b ? [a + '①', b + '②'] : [a, b];
}

function duetText(p, o) {
    const [la, lb] = duetLabels(p, o);
    return duetsOf(p.id, o.id).map(t => t.map(([id, line]) => `${id === p.id ? la : lb}: ${line}`).join('\n')).join('\n\n');
}

/** "이름: 말" lines, a blank line between talks. A line without a known name = the other one's turn. */
function parseDuet(text, p, o) {
    const [la, lb] = duetLabels(p, o);
    const out = [];
    for (const block of String(text || '').split(/\n\s*\n/)) {
        const talk = [];
        for (const raw of block.split('\n')) {
            const s = raw.replace(/\s+/g, ' ').trim();
            if (!s) continue;
            const m = /^(.{1,24}?)\s*[:：]\s*(.*)$/.exec(s);
            let id = null, line = s;
            if (m && (m[1] === la || m[1] === lb)) { id = m[1] === la ? p.id : o.id; line = m[2].trim(); }
            if (!id) id = talk.length ? (talk[talk.length - 1][0] === p.id ? o.id : p.id) : p.id;
            line = line.slice(0, LINE_MAX);
            if (line && talk.length < DUET_LINES) talk.push([id, line]);
        }
        if (talk.length) out.push(talk);
        if (out.length >= DUET_MAX) break;
    }
    return out;
}

function duetHtml(p) {
    const others = roommates(p);
    if (!others.length) return '';
    return `<div class="tw-cap">${LX('다른 펫과 나누는 대화', 'Talks with other pets')}</div>
  <div class="tw-sub">${LX('같은 방 펫과 가까이 마주치거나 부딪히면, 위의', 'When it meets or bumps into a pet in the same room, they trade one of the')} "${LX('말 걸 때 / 말 걸어 오면', 'Talking to another pet / When another pet talks to it')}" ${LX('한 마디나 여기 적은 대화 중 하나를 주고받아요. 한 줄에', 'lines above, or one of the talks written here. Write each line as')} <b>${LX('이름: 말', 'Name: line')}</b>${LX(', 대화 사이는 빈 줄이에요. 대화 하나는', ', with a blank line between talks. Each talk is up to')} ${DUET_LINES}${LX('줄까지,', ' lines, and up to')} ${DUET_MAX}${LX('개까지 모여요. 다 쓰면 다시 섞어서 써요. 둘 중 하나라도 말하는 빈도가', ' talks are kept. Once all are used, they’re shuffled again. If either pet’s talking frequency is')} "${LX('끔', 'Off')}"${LX('이면 이 대화는 안 해요.', ', these talks are skipped.')}</div>
  ${others.map(o => { const [la, lb] = duetLabels(p, o); return `<label class="tw-label">${esc(LX(josa(o.name, '과', '와'), `With ${o.name}`))}<textarea data-duet="${esc(o.id)}" rows="6" placeholder="${esc(LX(`${la}: 또 자?\n${lb}: …응\n${la}: 나도 옆에서 잘래`, `${la}: Sleeping again?\n${lb}: …yeah\n${la}: Me too, right next to you`))}"></textarea></label>
  <div class="tw-btn tw-btn-small" data-act="aiduet" data-with="${esc(o.id)}"><i class="fa-solid fa-wand-magic-sparkles"></i> ${LX('AI로', 'Make')} ${DUET_ADD}${LX('개 더 만들기', ' more with AI')}</div>`; }).join('\n  ')}
  <div class="tw-sub">${LX('누를 때만 한 번 만들어 아래에 붙여요. AI에게는 두 펫의 이름과 성격만 보내요. 저장을 눌러야 바뀌어요.', 'Runs once, only when pressed, and adds them below. Only the two pets’ names and personalities are sent to the AI. Press Save to keep them.')}</div>`;
}

async function aiDuet(oid) {
    const p = curPet(), o = root.pets.find(x => x.id === oid);
    if (!p || !o || busy) return;
    const box = win.body.querySelector('[data-pane="talk"]');
    const ta = box?.querySelector(`[data-duet="${CSS.escape(oid)}"]`);
    const btn = box?.querySelector(`[data-act="aiduet"][data-with="${CSS.escape(oid)}"]`);
    if (!ta || !btn) return;
    const have = parseDuet(ta.value, p, o).length;
    if (have >= DUET_MAX) return say(`${LX('대화는', 'Up to')} ${DUET_MAX}${LX('개까지예요. 몇 개 지운 뒤 눌러 주세요.', ' talks. Delete a few, then press again.')}`);
    const want = Math.min(DUET_ADD, DUET_MAX - have);
    const label = btn.innerHTML;
    busy = true;
    btn.classList.add('tw-busy');
    btn.textContent = LX('만드는 중…', 'Making…');
    say('');
    try {
        const kp = p.personality?.base, ko = o.personality?.base;
        const system = 'You write very short dialogues between two tiny pets that live on a chat app screen. Answer with JSON only, no other text.';
        const user = [
            `${LX('펫 A:', 'Pet A:')} ${p.name} ${LX('— 성격', '— personality')} ${persName(p)} (${PERS_DESC[kp] || ''})`,
            `${LX('펫 B:', 'Pet B:')} ${o.name} ${LX('— 성격', '— personality')} ${persName(o)} (${PERS_DESC[ko] || ''})`,
            LX('두 펫은 채팅 앱 화면에 같이 사는 작은 동반자예요. 화면에서 마주쳤을 때 나눌 짧은 한국어 대화를 써 주세요.', 'The two pets are tiny companions living together on a chat app screen. Write short English dialogues they’d have when they run into each other on screen.'),
            `${LX('- 대화', '-')} ${want}${LX('개, 하나는 2~', ' talks, each 2–')}${DUET_LINES}${LX('줄, A와 B가 번갈아 말하기 (누가 먼저든 괜찮아요)', ' lines, A and B taking turns (either may start)')}`,
            LX('- 한 줄은 25자 안쪽, 반말, 두 펫의 성격이 잘 드러나게, 대화마다 다른 이야기', '- Each line under 35 characters, casual, showing both personalities, a different topic per talk'),
            LX('- 이모지는 가끔만', '- Emoji only occasionally'),
            LX('- 화면 앞의 사람을 부를 때는 {{user}}라고 쓰기', '- Refer to the person at the screen as {{user}}'),
            LX('JSON으로만 답하기. 예: {"talks": [[["A", "…"], ["B", "…"]], [["B", "…"], ["A", "…"], ["B", "…"]]]}', 'Answer in JSON only. Example: {"talks": [[["A", "…"], ["B", "…"]], [["B", "…"], ["A", "…"], ["B", "…"]]]}'),
        ].join('\n');
        const { text, fellBack } = await askAI(system, user);
        if (curPet() !== p || !ta.isConnected) return;
        const raw = looseJson(text)?.talks;
        const [la, lb] = duetLabels(p, o);
        const clean = (x) => String(x ?? '').replace(/\s+/g, ' ').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').slice(0, LINE_MAX);
        const add = [];
        for (const t of Array.isArray(raw) ? raw : []) {
            if (!Array.isArray(t)) continue;
            const lines = t.filter(l => Array.isArray(l) && /^[AB]$/i.test(String(l[0]).trim()) && clean(l[1]))
                .slice(0, DUET_LINES).map(l => `${/^a$/i.test(String(l[0]).trim()) ? la : lb}: ${clean(l[1])}`);
            if (lines.length >= 2) add.push(lines.join('\n'));
            if (add.length >= want) break;
        }
        if (!add.length) return say(LX('AI 답을 알아보지 못했어요. 한 번 더 눌러 보세요.', 'Couldn’t understand the AI’s answer. Try pressing again.'));
        ta.value = [ta.value.trim(), ...add].filter(Boolean).join('\n\n');
        say(`${LX(`대화 ${add.length}개를 붙였어요. 마음에 들면 저장을 눌러 주세요.`, `Added ${add.length} talk${add.length === 1 ? '' : 's'}. Press Save if you like them.`)}${fellBack ? LX(' (고른 연결을 찾지 못해서 지금 연결로 만들었어요)', ' (the chosen connection wasn’t found, so the current one was used)') : ''}`);
    } catch (e) {
        console.error('[Tavvy] AI talks failed', e);
        say(LX('대화를 만들지 못했어요: ', 'Couldn’t make talks: ') + (e?.cause?.message || e?.message || e));
    } finally {
        busy = false;
        btn.classList.remove('tw-busy');
        btn.innerHTML = label;
    }
}

/* ---------- AI: fill in the empty moments (only when the button is pressed) ---------- */

const TALK_PROMPT_MOMENTS = {
    wake: LX('깨워서 침대에서 나왔을 때', 'woken up and getting out of bed'), sleep: LX('재워서 침대로 들어갈 때', 'put to bed and going in'), pat: LX('쓰다듬어 줄 때', 'being patted'),
    meal: LX('밥(채팅 메시지)을 다 먹었을 때', 'finishing a meal (chat messages)'), play: LX('혼자 놀고 있을 때', 'playing alone'), wait: LX('상대의 답을 기다릴 때', 'waiting for the other side’s reply'),
    level: LX('사람과 한 단계 더 친해졌을 때', 'getting one step closer to the person'), reunion: LX('며칠 만에 다시 만났을 때', 'meeting again after a few days'),
    reply: LX('상대(캐릭터)의 답이 막 도착했을 때', 'the character’s reply just arrived'), sent: LX('사람이 방금 메시지를 보냈을 때', 'the person just sent a message'),
    late: LX('상대(캐릭터)의 답이 오래 걸려서 기다리다 지칠 때', 'the character’s reply is taking a long time'),
    night: LX('같은 방에 사는 다른 펫이 옆에서 꾸벅꾸벅 졸 때', 'another pet in the same room is dozing off nearby'),
    greet: LX('같은 방에 사는 다른 펫에게 먼저 말을 걸 때', 'starting a chat with another pet in the same room'), answer: LX('다른 펫이 말을 걸어 와서 대답할 때', 'answering when another pet talks to it'),
    // 0.11.17 알아보고 말하기
    retype: LX('사람이 입력창에 썼다 지웠다 하며 망설일 때', 'the person keeps writing and erasing in the input box'),
    long: LX('사람이 아주 긴 메시지를 보냈을 때', 'the person just sent a very long message'),
    swipe: LX('사람이 캐릭터의 답을 넘겨 다른 답을 볼 때(스와이프)', 'the person swiped to another version of the character’s reply'),
    regen: LX('사람이 캐릭터의 답을 처음부터 다시 쓰게 할 때', 'the person asked for the character’s reply to be written again'),
    edit: LX('사람이 메시지를 고쳤을 때', 'the person edited a message'), del: LX('사람이 메시지를 지웠을 때', 'the person deleted a message'),
    old: LX('사람이 채팅을 한참 위로 올려 옛날 대화를 볼 때', 'the person scrolled far up to read old messages'),
    menu: LX('사람이 설정 메뉴를 열었을 때 (메뉴 이름은 {{menu}})', 'the person opened a settings menu (its name is {{menu}})'),
    back: LX('사람이 다른 채팅방에 갔다가 금방 돌아왔을 때', 'the person went to another chat and soon came back'),
    menuChar: LX('사람이 캐릭터 목록을 열었을 때', 'the person opened the character list'), menuWorld: LX('사람이 월드인포(세계 설정)를 열었을 때', 'the person opened World Info (the story’s world settings)'),
    menuAi: LX('사람이 AI 설정(숫자 조절)을 열었을 때', 'the person opened the AI settings (number sliders)'), menuApi: LX('사람이 AI 연결 설정을 열었을 때', 'the person opened the AI connection settings'),
    menuPersona: LX('사람이 자기 페르소나(자기가 맡는 인물) 설정을 열었을 때', 'the person opened their persona (the character they play) settings'),
    menuBg: LX('사람이 채팅 배경을 고르는 메뉴를 열었을 때', 'the person opened the chat background menu'), menuFormat: LX('사람이 글 서식 설정을 열었을 때', 'the person opened the text formatting settings'),
};

/** Ask the chosen connection (or the current one). Returns the text of the answer. */
async function askAI(system, user, len = 800) {
    const c = ctx();
    const id = root?.settings?.talkProfile;
    if (id) {
        const prof = connectionProfiles()?.find(p => p.id === id);
        if (prof) {
            const r = await c.ConnectionManagerRequestService.sendRequest(id, [{ role: 'system', content: system }, { role: 'user', content: user }], len);
            return { text: typeof r === 'string' ? r : String(r?.content ?? ''), fellBack: false };
        }
    }
    if (typeof c.generateRaw !== 'function') throw new Error(LX('이 실리태번 버전에서는 AI 대사 만들기를 쓸 수 없어요', 'This SillyTavern version can’t make AI lines'));
    const text = await c.generateRaw({ prompt: user, systemPrompt: system, responseLength: len });
    return { text: String(text ?? ''), fellBack: !!id };
}

function looseJson(text) {
    const t = String(text || '').replace(/```(?:json)?/gi, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

async function aiFill() {
    const p = curPet();
    if (!p || busy) return;
    const box = win.body.querySelector('[data-pane="talk"]');
    const empty = TALK_MOMENTS.filter(m => !box.querySelector(`[data-line="${m.key}"]`).value.trim());
    if (!empty.length) return say(LX('빈 칸이 없어요. 새로 만들고 싶은 칸을 비운 뒤 눌러 주세요.', 'No empty slots. Clear the ones you want remade, then press again.'));
    const btn = box.querySelector('[data-act="aifill"]');
    const label = btn.innerHTML;
    busy = true;
    btn.classList.add('tw-busy');
    btn.textContent = LX('만드는 중…', 'Making…');
    say('');
    try {
        const k = p.personality?.base;
        const system = 'You write very short speech lines for a tiny pet that lives on a chat app screen. Answer with JSON only, no other text.';
        const user = [
            `${LX('펫 이름:', 'Pet name:')} ${p.name}`,
            `${LX('성격:', 'Personality:')} ${persName(p)} — ${PERS_DESC[k] || ''}`,
            LX('이 펫은 채팅 앱 화면에 사는 작은 동반자예요. 아래 순간마다 펫이 머리 위 말풍선으로 할 짧은 한국어 대사를 3개씩 써 주세요.', 'This pet is a tiny companion living on a chat app screen. For each moment below, write 3 short English lines the pet says in a speech bubble above its head.'),
            LX('- 한 줄은 25자 안쪽, 반말, 성격이 잘 드러나게', '- Each line under 35 characters, casual, showing its personality'),
            LX('- 이모지는 가끔만', '- Emoji only occasionally'),
            LX('- 화면 앞의 사람을 부를 때는 {{user}}라고 쓰기', '- Refer to the person at the screen as {{user}}'),
            ...(empty.some(m => m.key === 'greet' || m.key === 'answer' || m.key === 'night') ? [LX('- 다른 펫을 부를 때는 {{pet}}이라고 쓰기', '- Refer to the other pet as {{pet}}')] : []),
            ...(empty.some(m => m.key === 'menu') ? [LX('- menu 순간에 메뉴 이름을 말할 때는 {{menu}}라고 쓰기', '- In the menu moment, refer to the menu’s name as {{menu}}')] : []),
            LX('순간:', 'Moments:'),
            ...empty.map(m => `${m.key}: ${TALK_PROMPT_MOMENTS[m.key]}`),
            `${LX('JSON으로만 답하기. 예: {', 'Answer in JSON only. Example: {')}"${empty[0].key}": ["…", "…", "…"]}`,
        ].join('\n');
        const { text, fellBack } = await askAI(system, user, Math.max(800, empty.length * 110));   // 0.11.17: more boxes → room for all
        if (curPet() !== p) return;
        const data = looseJson(text);
        let n = 0;
        for (const m of empty) {
            const raw = data?.[m.key];
            const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
            const lines = arr.map(x => String(x).replace(/\s+/g, ' ').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''))
                .filter(Boolean).map(x => x.slice(0, LINE_MAX)).slice(0, 3);
            const ta = box.querySelector(`[data-line="${m.key}"]`);
            if (lines.length && !ta.value.trim()) { ta.value = lines.join('\n'); n++; }
        }
        say(n ? LX(`${n}칸을 채웠어요. 마음에 들면 저장을 눌러 주세요.${fellBack ? ' (고른 연결을 찾지 못해서 지금 연결로 만들었어요)' : ''}`, `Filled ${n} slot${n === 1 ? '' : 's'}. Press Save if you like them.${fellBack ? ' (the chosen connection wasn’t found, so the current one was used)' : ''}`)
            : LX('AI 답을 알아보지 못했어요. 한 번 더 눌러 보세요.', 'Couldn’t understand the AI’s answer. Try pressing again.'));
    } catch (e) {
        console.error('[Tavvy] AI lines failed', e);
        say(LX('대사를 만들지 못했어요: ', 'Couldn’t make lines: ') + (e?.cause?.message || e?.message || e));
    } finally {
        busy = false;
        btn.classList.remove('tw-busy');
        btn.innerHTML = label;
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
    item.innerHTML = LX('<div class="fa-solid fa-paw extensionsMenuExtensionButton"></div><span>펫 정보</span>', '<div class="fa-solid fa-paw extensionsMenuExtensionButton"></div><span>Pet info</span>');
    item.addEventListener('click', openInfoFromMenu);
    menu.appendChild(item);
    return true;
}

/** Keep the little settings drawer and the open window up to date. */
function renderPanel() {
    const warn = $id('tavvy-warn');
    if (warn) { warn.hidden = !readOnly; warn.textContent = readOnly ? readOnlyReason : ''; }
    const r = $id('tavvy-room');
    if (r && root) {
        const here = residents();
        const text = !room ? LX('열려 있는 채팅방이 없어요.', 'No chat is open.') : here.length ? `${LX('이 방에 사는 펫:', 'Pets in this room:')} ${here.map(p => p.name).join(', ')}` : LX('이 방에는 아직 펫이 없어요.', 'No pets in this room yet.');
        if (r.textContent !== text) r.textContent = text;
    }
    refreshWin();
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

async function confirmBox(text) {
    const c = ctx();
    if (typeof c.callGenericPopup === 'function' && c.POPUP_TYPE) {
        return !!(await c.callGenericPopup(text, c.POPUP_TYPE.CONFIRM));
    }
    return window.confirm(text);
}

/* =====================================================================
 * Boot
 * ===================================================================== */

function onReady() {
    if (ready) return;
    ready = true;
    log('ready', { pets: root?.pets.length ?? 0, readOnly });
    onChatChanged();
    watchMenus();
    setTimeout(watchMenus, 5000);                  // 0.11.17: in case the top bar is built a little later
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
    // 0.11.17 알아보고 말하기 (not while a reply is being written: regenerate removes the old one, writing updates it)
    const byHand = () => ready && !gen.active && performance.now() - (gen.endAt || -1e9) > 3000;
    on('MESSAGE_SWIPED', () => { if (ready) setTimeout(() => notice('swipe'), 200); });
    on('MESSAGE_EDITED', () => { if (byHand()) notice('edit'); });
    on('MESSAGE_DELETED', () => { if (byHand()) setTimeout(() => notice('del'), 200); });
    ['MESSAGE_DELETED', 'MORE_MESSAGES_LOADED', 'MESSAGE_SWIPED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED'].forEach(n => on(n, ledgesMoved));
    // the chat scrolling (capture: the chat box scrolls by itself, not the window)
    let st = 0;
    document.addEventListener('scroll', (e) => {
        if (!actors.length) return;
        noteUserAct();
        if (e.target?.id === 'chat') onChatScroll(e.target);
        if (st) return;
        st = requestAnimationFrame(() => { st = 0; measurePlats(); });
    }, { capture: true, passive: true });
    // you: writing in the input box, where your hand / finger is
    document.addEventListener('input', (e) => { if (e.target?.id === 'send_textarea') { onTyping(); onWriting(e.target.value); } }, true);
    const seeHand = (e) => { if (!actors.length) return; hand.x = e.clientX; hand.y = e.clientY; hand.t = performance.now(); };
    document.addEventListener('pointermove', seeHand, { capture: true, passive: true });
    document.addEventListener('pointerdown', seeHand, { capture: true, passive: true });
    // 0.10.8: phones count a touch when the finger lifts (pointerup / touchend / click), not when it lands
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, sndOnTouch, { capture: true, passive: true });
    // 0.9.3 졸졸 따라다니기: a short tap anywhere (not on a pet / the bed / the Tavvy window, not a scroll)
    const taps = new Map();
    const notMine = (t) => !t?.closest?.('.tavvy-pet, #tavvy-bed, #tavvy-win, .tavvy-bubble');
    document.addEventListener('pointerdown', (e) => { if (actors.length && e.isPrimary && notMine(e.target)) taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() }); }, { capture: true, passive: true });
    document.addEventListener('pointerup', (e) => {
        const d = taps.get(e.pointerId); taps.delete(e.pointerId);
        if (!d || !actors.length) return;
        if (performance.now() - d.t > TAP_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MOVE) return;
        clingTap(e.clientX);
    }, { capture: true, passive: true });
    document.addEventListener('pointercancel', (e) => taps.delete(e.pointerId), { capture: true, passive: true });
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
    // leaving the app mid-hold: the finger's "let go" never arrives → put held pets down
    const dropAll = () => { for (const a of actors) a.dropPointer?.(); };
    window.addEventListener('pagehide', dropAll);
    window.addEventListener('blur', dropAll);
    let awayAt = 0;                                  // 0.9.0: when this screen went out of sight
    const onReturn = () => {
        if (document.hidden) { if (!awayAt) awayAt = Date.now(); if (sndCtx) sndStuck = true; return dropAll(); }   // 0.11.10: sound is made again on the first touch back
        if (awayAt && Date.now() - awayAt >= WHERE_AWAY * 60000) setTimeout(whereAll, 1500);
        awayAt = 0;
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
