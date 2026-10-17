// Runs the simulation (sim-core.js) off the page's thread, by default. The
// page sends a request with the settings, the screen size, commands and how
// many steps to take; the worker steps and answers with what the page
// draws: every creature's slice of the point pool (positions and shivers,
// copied into transferred buffers), what happened during the steps (step
// ticks and prints, in order) and, once per creature, its fixed data
// (springs, flags).
importScripts(`sim-core.js${self.location.search}`); // same version stamp as the page

// Letter shapes are measured on an OffscreenCanvas (missing before Safari
// 16.4): without one, fail now so the page runs the simulation itself.
if (typeof OffscreenCanvas === 'undefined' || !new OffscreenCanvas(1, 1).getContext('2d')) {
    throw new Error('no OffscreenCanvas 2D in workers');
}

const ids = new WeakMap();
let nextId = 1;
const known = new Set(); // creature ids whose fixed data the page has
let pending = []; // fixed data of creatures the page does not have yet
let events = []; // { kind: 'tick', time } or { kind: 'print', ... }, in order

function idOf(c) {
    let id = ids.get(c);
    if (id === undefined) {
        id = nextId++;
        ids.set(c, id);
    }
    if (!known.has(id)) {
        known.add(id);
        pending.push({
            id,
            count: c.store.x.length,
            springA: c.springA,
            springB: c.springB,
            springIsHair: c.springIsHair,
            isFootFlags: c.isFootFlags,
            isHairFlags: c.isHairFlags,
            pointBirth: c.pointBirth,
            pointSizeRandom: c.pointSizeRandom,
            inkRgb: c.inkRgb,
            params: {
                imprintShade: c.params.imprintShade,
                imprintBlendMode: c.params.imprintBlendMode,
                imprintColor: c.params.imprintColor,
            },
        });
    }
    return id;
}

simHooks.tick = () => events.push({ kind: 'tick', time });
simHooks.print = (c, shade, blendMode, color) => {
    // The pose at this moment, for the page to stamp.
    events.push({
        kind: 'print',
        time,
        id: idOf(c),
        shade,
        blendMode,
        color,
        isDead: c.isDead,
        x: c.store.x.slice(),
        y: c.store.y.slice(),
        pulse: c.store.pulse.slice(),
    });
};

const COMMANDS = {
    addCreature,
    triggerBurst,
    resetCreatures,
    startCreatures,
    releaseFloorFeet,
    moveFeetWithEdges,
    printAll: () => creatures.forEach((c) => c.printToBackground()),
    // Tests: the same random numbers as a seeded page.
    seed(value) {
        let a = value >>> 0;
        Math.random = () => {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },
    // Tests: every point's full state, as the comparison harness reads it.
    dumpState() {
        const state = [];
        for (const c of creatures) {
            state.push(c.points.length, c.isDead ? 1 : 0);
            for (const p of c.points) state.push(p.x, p.y, p.oldX, p.oldY, p.pulseMagnitude, p.isFoot ? p.footState : -1);
        }
        return state;
    },
};

// Output buffers, handed back by the page after use.
let spare = null;
function poolCopy() {
    const used = pointPool.used;
    const out = spare && spare.x.length >= used ? spare : {
        x: new Float64Array(Math.max(used, 1024) * 1.5 | 0),
        y: new Float64Array(Math.max(used, 1024) * 1.5 | 0),
        pulse: new Float64Array(Math.max(used, 1024) * 1.5 | 0),
    };
    spare = null;
    if (used > 0) {
        out.x.set(pointPool.arrays.x.subarray(0, used));
        out.y.set(pointPool.arrays.y.subarray(0, used));
        out.pulse.set(pointPool.arrays.pulse.subarray(0, used));
    }
    return out;
}

onmessage = (e) => {
    const msg = e.data;
    if (msg.buffers) spare = msg.buffers;
    const t0 = performance.now();
    if (msg.settings) setSimSettings(msg.settings);
    if (msg.size) {
        simSize.width = msg.size.width;
        simSize.height = msg.size.height;
    }
    const results = [];
    for (const [name, args] of msg.commands || []) {
        results.push(COMMANDS[name](...(args || [])));
    }
    for (let i = 0; i < (msg.steps || 0); i++) simStep();
    const simMs = performance.now() - t0;

    const list = creatures.map((c) => ({
        id: idOf(c),
        offset: c.poolOffset,
        isDead: c.isDead,
        deathTime: c.deathTime,
    }));
    const pool = poolCopy();
    const reply = {
        type: 'state',
        request: msg.request,
        time,
        list,
        added: pending,
        events,
        results,
        totalPoints: getCurrentTotalPoints(),
        pool,
        simMs,
    };
    pending = [];
    events = [];
    const transfer = [pool.x.buffer, pool.y.buffer, pool.pulse.buffer];
    for (const ev of reply.events) {
        if (ev.kind === 'print') transfer.push(ev.x.buffer, ev.y.buffer, ev.pulse.buffer);
    }
    postMessage(reply, transfer);
};
