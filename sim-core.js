// The simulation: settings, creatures (points, springs, feet), births,
// bursts and the fixed step. No page elements: the screen size is simSize,
// and what the page shows (prints, counts) goes through simHooks. Loaded by
// the page before sim.js (they share these globals), and by sim-worker.js.

// Screen size in CSS pixels (the page keeps it equal to the canvas size).
const simSize = { width: 300, height: 150 };
// Set by the page (or the worker) at load.
const simHooks = {
    tick() {}, // after the step counter moves on, before anything else
    print(creature, shade, blendMode, color) {}, // a creature prints itself
    populationChanged() {}, // creatures added or removed
};
// Character of new Letter-shape creatures (Letter Shape input).
let newCreatureChar = '+';

/**
 * A small canvas for measuring a letter shape: a page canvas, or an
 * OffscreenCanvas in a worker.
 */
function createScratchCanvas() {
    if (typeof document === 'undefined') return new OffscreenCanvas(1, 1);
    return document.createElement('canvas');
}

let creatures = [];
let time = 0;
let timeSinceEmpty = null;
let timeSinceLastAutoAdd = null;
let isInitializingFill = false;

const INIT_FILL_DELAY = 30;
const FOOT_STATES = { FIXED: 0, SEEKING: 1, SETTLING: 2 };
const FADE_DURATION = 180;

// --- Physics & Motion ---
let damping = 0.1;
let springStiffness = 0.21;
let shiverIntensityFactor = 0.5;
let shiverPropagationFactor = 0.95;
let shiverEffectMultiplier = 1.0;
let shiverDurationFactor = 0.8;
let shiverPropagationSpeed = 1.0;
let numSeekingFeet = 2;
let footCoordinationFactor = 0.0;
let stepCooldown = 120;
let stepDuration = 300;
let stepHeight = 68;
let wobbleStrength = 36;
let targetAttraction = 0.05;
let gaitPattern = 'sequential';
let waveDelay = 5;

// --- Appearance ---
let drawMode = 'point';
let pointBaseSize = 1.4;
let letterToDraw = 'i';
let maxLineThickness = 1.0;
let minShade = 0.0;
let pointSizeVariation = 0.25;

// --- Breathing ---
let enableBreathing = true;
let breathingRate = 0.007;
let breathingAmplitude = 0.04;
let breathingOffset = 0.92;

// --- Birth & Death ---
let enableAging = true;
let agingMode = 'time';
let lifespanSeconds = 25;
let maxFootsteps = 50;
let deathEffect = 'fade';
let enableProgressiveAppearance = true;
let growthSpeed = 2;

// --- Structure (for next creature) ---
let creatureShape = 'letter';
let pointDensity = 15;
let numFeet = 2;
let restLengthFactor = 0.8828470773159127;
let useRandomPlacement = true;
let pruneUnfootedPoints = true;
let minPointsPerFoot = 20;

// --- Tendrils (for next creature) ---
let enableTendrils = false;
let numTendrils = 5;
let tendrilLength = 5;
let tendrilStiffness = 0.1;
let placeFeetOnTendrils = true;
let shiversOnTendrils = true;
let tendrilQuality = 1.0;
let tendrilLengthVariation = 0;

// --- Population & Spawning ---
let autoAddDelaySeconds = 2.9;
let autoMode = 'top-up';
let enableCreatureLimit = false;
let maxCreatures = 31;
let enablePointLimit = true;
let maxPoints = 400;
let randomizeMode = 'reset';

// --- Printing & Gravity ---
let imprintShade = 0.39;
let imprintColor = '#000000';
let creatureColor = '#000000';
let shiverColor = '#000000';
let imprintMatchesCreature = true; // imprints use the creature and shiver colors
/**
 * Converts '#rrggbb' to {r, g, b}.
 */
function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

let randomCreatureColor = false; // each new creature gets its own random ink

/**
 * A random ink color: any hue, fairly saturated, never too pale or too
 * bright, so creatures stay ink-like on white paper.
 */
function randomInkRgb() {
    const h = Math.random() * 360;
    const s = 0.55 + Math.random() * 0.35;
    const v = 0.35 + Math.random() * 0.45;
    const f = (n) => {
        const k = (n + h / 60) % 6;
        return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
    };
    return { r: f(5), g: f(3), b: f(1) };
}
let imprintBlendMode = 'multiply';
let usePerCreatureImprint = false;
const keepImprintsOnReset = true; // randomize and start over leave the imprints
let printOnShiver = true; // a creature prints when one of its feet lands
// Walls and floor: body points stop at the screen edges (and slide along
// them) instead of hanging past them, e.g. with soft springs and gravity.
let keepOnScreen = false;
// Burst: many creatures born at once (B key: random places; long press on the
// paper: around the finger). Spread staggers the births, Force pushes them
// outward. Bursts ignore the point limit; the population settles afterwards.
let burstSize = 12;
let burstSpreadSeconds = 0.5;
let burstForce = 3;
let burstKeyOrigin = 'random'; // B key: 'random' places or the screen 'center'
const burstQueue = []; // { at (step), x, y, around: origin or null }
let darkPaper = false; // inverted page: black paper, white ink (style.css)
const EDGE_FRICTION = 0.8; // share of the sliding speed kept along an edge
const SHIVER_PRINT_COOLDOWN = 30; // frames between two shiver prints of one creature
// Point circles: how much a shiver swells them, and their largest radius (px).
const POINT_SHIVER_SWELL = 0.35;
const MAX_POINT_RADIUS = 4;

// Fading imprints, smooth on every frame. The fading part of each imprint
// goes on one of the fade layers; each layer's CSS opacity (full precision,
// composited by the GPU) goes from 1 to 0 over the fade time and is updated
// every step. A new layer takes the prints every fadeTime / (FADE_LAYERS - 1);
// a faded layer is cleared and reused. (Fading the pixels themselves cannot
// be smooth: the canvas keeps 256 opacity levels, so tiny per-frame steps
// round away to nothing.) fadeAmount decides how much of each imprint fades;
// the rest stays on the background.
let fadeImprints = false;
let fadeTimeSeconds = 10;
let fadeAmount = 1; // share of each imprint that fades (the rest stays)
// Off by default: blending full-screen layers is costly for the browser
// (measured in software rendering: 60 fps without, ~20 fps with).
let blendFadeLayers = false;
let printIntervalMs = 250;
let printIntervalRandomness = 0.89; // 1 = between half and double the interval
let imprintShadeVariation = 0; // each print's strength varies by up to this share
let gravity = 0.17; // Gravity Magnitude slider (fixed) or tilt sensitivity
let gravityX = 0;
let gravityY = gravity;

/**
 * Every setting, by name, with its getter and setter: the page sends them to
 * the worker this way (see sim-worker-client.js).
 */
const SIM_SETTINGS = {
    newCreatureChar: [() => newCreatureChar, (v) => (newCreatureChar = v)],
    damping: [() => damping, (v) => (damping = v)],
    springStiffness: [() => springStiffness, (v) => (springStiffness = v)],
    shiverIntensityFactor: [() => shiverIntensityFactor, (v) => (shiverIntensityFactor = v)],
    shiverPropagationFactor: [() => shiverPropagationFactor, (v) => (shiverPropagationFactor = v)],
    shiverEffectMultiplier: [() => shiverEffectMultiplier, (v) => (shiverEffectMultiplier = v)],
    shiverDurationFactor: [() => shiverDurationFactor, (v) => (shiverDurationFactor = v)],
    shiverPropagationSpeed: [() => shiverPropagationSpeed, (v) => (shiverPropagationSpeed = v)],
    numSeekingFeet: [() => numSeekingFeet, (v) => (numSeekingFeet = v)],
    footCoordinationFactor: [() => footCoordinationFactor, (v) => (footCoordinationFactor = v)],
    stepCooldown: [() => stepCooldown, (v) => (stepCooldown = v)],
    stepDuration: [() => stepDuration, (v) => (stepDuration = v)],
    stepHeight: [() => stepHeight, (v) => (stepHeight = v)],
    wobbleStrength: [() => wobbleStrength, (v) => (wobbleStrength = v)],
    targetAttraction: [() => targetAttraction, (v) => (targetAttraction = v)],
    gaitPattern: [() => gaitPattern, (v) => (gaitPattern = v)],
    waveDelay: [() => waveDelay, (v) => (waveDelay = v)],
    drawMode: [() => drawMode, (v) => (drawMode = v)],
    pointBaseSize: [() => pointBaseSize, (v) => (pointBaseSize = v)],
    letterToDraw: [() => letterToDraw, (v) => (letterToDraw = v)],
    maxLineThickness: [() => maxLineThickness, (v) => (maxLineThickness = v)],
    minShade: [() => minShade, (v) => (minShade = v)],
    pointSizeVariation: [() => pointSizeVariation, (v) => (pointSizeVariation = v)],
    enableBreathing: [() => enableBreathing, (v) => (enableBreathing = v)],
    breathingRate: [() => breathingRate, (v) => (breathingRate = v)],
    breathingAmplitude: [() => breathingAmplitude, (v) => (breathingAmplitude = v)],
    breathingOffset: [() => breathingOffset, (v) => (breathingOffset = v)],
    enableAging: [() => enableAging, (v) => (enableAging = v)],
    agingMode: [() => agingMode, (v) => (agingMode = v)],
    lifespanSeconds: [() => lifespanSeconds, (v) => (lifespanSeconds = v)],
    maxFootsteps: [() => maxFootsteps, (v) => (maxFootsteps = v)],
    deathEffect: [() => deathEffect, (v) => (deathEffect = v)],
    enableProgressiveAppearance: [() => enableProgressiveAppearance, (v) => (enableProgressiveAppearance = v)],
    growthSpeed: [() => growthSpeed, (v) => (growthSpeed = v)],
    creatureShape: [() => creatureShape, (v) => (creatureShape = v)],
    pointDensity: [() => pointDensity, (v) => (pointDensity = v)],
    numFeet: [() => numFeet, (v) => (numFeet = v)],
    restLengthFactor: [() => restLengthFactor, (v) => (restLengthFactor = v)],
    useRandomPlacement: [() => useRandomPlacement, (v) => (useRandomPlacement = v)],
    pruneUnfootedPoints: [() => pruneUnfootedPoints, (v) => (pruneUnfootedPoints = v)],
    minPointsPerFoot: [() => minPointsPerFoot, (v) => (minPointsPerFoot = v)],
    enableTendrils: [() => enableTendrils, (v) => (enableTendrils = v)],
    numTendrils: [() => numTendrils, (v) => (numTendrils = v)],
    tendrilLength: [() => tendrilLength, (v) => (tendrilLength = v)],
    tendrilStiffness: [() => tendrilStiffness, (v) => (tendrilStiffness = v)],
    placeFeetOnTendrils: [() => placeFeetOnTendrils, (v) => (placeFeetOnTendrils = v)],
    shiversOnTendrils: [() => shiversOnTendrils, (v) => (shiversOnTendrils = v)],
    tendrilQuality: [() => tendrilQuality, (v) => (tendrilQuality = v)],
    tendrilLengthVariation: [() => tendrilLengthVariation, (v) => (tendrilLengthVariation = v)],
    autoAddDelaySeconds: [() => autoAddDelaySeconds, (v) => (autoAddDelaySeconds = v)],
    autoMode: [() => autoMode, (v) => (autoMode = v)],
    enableCreatureLimit: [() => enableCreatureLimit, (v) => (enableCreatureLimit = v)],
    maxCreatures: [() => maxCreatures, (v) => (maxCreatures = v)],
    enablePointLimit: [() => enablePointLimit, (v) => (enablePointLimit = v)],
    maxPoints: [() => maxPoints, (v) => (maxPoints = v)],
    randomizeMode: [() => randomizeMode, (v) => (randomizeMode = v)],
    imprintShade: [() => imprintShade, (v) => (imprintShade = v)],
    imprintColor: [() => imprintColor, (v) => (imprintColor = v)],
    creatureColor: [() => creatureColor, (v) => (creatureColor = v)],
    shiverColor: [() => shiverColor, (v) => (shiverColor = v)],
    imprintMatchesCreature: [() => imprintMatchesCreature, (v) => (imprintMatchesCreature = v)],
    randomCreatureColor: [() => randomCreatureColor, (v) => (randomCreatureColor = v)],
    imprintBlendMode: [() => imprintBlendMode, (v) => (imprintBlendMode = v)],
    usePerCreatureImprint: [() => usePerCreatureImprint, (v) => (usePerCreatureImprint = v)],
    printOnShiver: [() => printOnShiver, (v) => (printOnShiver = v)],
    keepOnScreen: [() => keepOnScreen, (v) => (keepOnScreen = v)],
    burstSize: [() => burstSize, (v) => (burstSize = v)],
    burstSpreadSeconds: [() => burstSpreadSeconds, (v) => (burstSpreadSeconds = v)],
    burstForce: [() => burstForce, (v) => (burstForce = v)],
    burstKeyOrigin: [() => burstKeyOrigin, (v) => (burstKeyOrigin = v)],
    darkPaper: [() => darkPaper, (v) => (darkPaper = v)],
    fadeImprints: [() => fadeImprints, (v) => (fadeImprints = v)],
    fadeTimeSeconds: [() => fadeTimeSeconds, (v) => (fadeTimeSeconds = v)],
    fadeAmount: [() => fadeAmount, (v) => (fadeAmount = v)],
    blendFadeLayers: [() => blendFadeLayers, (v) => (blendFadeLayers = v)],
    printIntervalMs: [() => printIntervalMs, (v) => (printIntervalMs = v)],
    printIntervalRandomness: [() => printIntervalRandomness, (v) => (printIntervalRandomness = v)],
    imprintShadeVariation: [() => imprintShadeVariation, (v) => (imprintShadeVariation = v)],
    gravity: [() => gravity, (v) => (gravity = v)],
    gravityX: [() => gravityX, (v) => (gravityX = v)],
    gravityY: [() => gravityY, (v) => (gravityY = v)],
};

function getSimSettings() {
    const out = {};
    for (const name in SIM_SETTINGS) out[name] = SIM_SETTINGS[name][0]();
    return out;
}

function setSimSettings(values) {
    for (const name in values) SIM_SETTINGS[name]?.[1](values[name]);
}

// =================================================================
//                         SHARED POINT POOL
// =================================================================

/**
 * Positions, previous positions and shivers of every creature's points, in
 * one set of flat arrays. Each creature owns a contiguous slice; its `store`
 * holds views onto that slice, indexed by the creature's own point indices.
 * New creatures are added at the end; compact() closes the gaps left by
 * removed ones.
 */
const pointPool = {
    FIELDS: ['x', 'y', 'oldX', 'oldY', 'pulse'],
    capacity: 0,
    used: 0,
    arrays: {},
    members: [], // creatures owning a slice, in slice order
    minWaste: 4096, // compact once this many (and as many as live) points are unused

    alloc(creature, n) {
        if (this.capacity === 0 || this.used + n > this.capacity) this.grow(this.used + n);
        creature.poolOffset = this.used;
        creature.poolCount = n;
        this.used += n;
        this.members.push(creature);
        creature.store = {};
        this.bind(creature);
        return creature.store;
    },

    // Points the creature's views at its slice (after alloc, grow or compact).
    bind(c) {
        for (const f of this.FIELDS) {
            c.store[f] = this.arrays[f].subarray(c.poolOffset, c.poolOffset + c.poolCount);
        }
    },

    grow(needed) {
        const capacity = Math.max(needed, this.capacity * 2, 4096);
        for (const f of this.FIELDS) {
            const bigger = new Float64Array(capacity);
            if (this.arrays[f]) bigger.set(this.arrays[f].subarray(0, this.used));
            this.arrays[f] = bigger;
        }
        this.capacity = capacity;
        for (const c of this.members) this.bind(c);
    },

    /**
     * Keeps only the slices of the live creatures and moves them down to
     * close the gaps. A removed creature still referenced somewhere keeps its
     * numbers in its own arrays, so it never writes over another one.
     */
    compact(live) {
        const keep = new Set(live);
        let liveCount = 0;
        for (const c of this.members) if (keep.has(c)) liveCount += c.poolCount;
        if (this.used - liveCount < Math.max(this.minWaste, liveCount)) return; // little waste
        const kept = [];
        for (const c of this.members) {
            if (keep.has(c)) {
                kept.push(c);
            } else {
                for (const f of this.FIELDS) c.store[f] = c.store[f].slice();
            }
        }
        let offset = 0;
        for (const c of kept) {
            // Slices are in order, so moving each one down never overlaps a
            // slice that has not moved yet.
            if (c.poolOffset !== offset) {
                for (const f of this.FIELDS) {
                    this.arrays[f].copyWithin(offset, c.poolOffset, c.poolOffset + c.poolCount);
                }
                c.poolOffset = offset;
            }
            this.bind(c);
            offset += c.poolCount;
        }
        this.used = offset;
        this.members = kept;
    },
};

// =================================================================
//                         CLASS DEFINITIONS
// =================================================================

/**
 * Represents a single physics-based creature.
 */
class Creature {
    constructor(shape, character = 'A') {
        this.points = [];
        this.springs = [];
        this.feet = [];
        this.footPairs = [];
        this.gaitActivationQueue = [];
        this.nextFootToWake = 0;
        this.nextPairToWake = 0;
        this.isDead = false;
        this.stepsTaken = 0;
        this.lastShiverPrint = -Infinity;
        // Own color when "Random Color for New Creatures" is on, else the
        // shared creature color (null).
        this.inkRgb = randomCreatureColor ? randomInkRgb() : null;
        this.breathingPhase = Math.random() * Math.PI * 2;
        this.propagationAccumulator = 0;
        this.currentRestLengthFactor = 1.0;
        this.params = {
            shape,
            character,
            pointDensity,
            numFeet,
            useRandomPlacement,
            restLengthFactor,
            pruneUnfootedPoints,
            minPointsPerFoot,
            enableTendrils,
            numTendrils,
            tendrilLength,
            tendrilStiffness,
            placeFeetOnTendrils,
            shiversOnTendrils,
            tendrilQuality,
            tendrilLengthVariation,
            imprintShade,
            imprintBlendMode,
            imprintColor,
        };
        if (enableAging) {
            this.birthTime = time;
            this.lifespan = lifespanSeconds * 60 * (0.8 + Math.random() * 0.4);
            this.maxSteps = maxFootsteps;
            this.deathTime = null;
        }
        this.init();
    }

    incrementSteps() {
        this.stepsTaken++;
    }

    die() {
        if (this.isDead) return;
        this.printToBackground();
        this.isDead = true;
        this.deathTime = time;
        for (const foot of this.feet) {
            foot.footState = FOOT_STATES.FIXED;
        }
    }

    /**
     * Stops body points at the screen edges. Runs after the springs, so a
     * point pushed out by a spring is brought back in the same step. Feet are
     * left alone: they already stick to the edges themselves.
     */
    keepInsideScreen() {
        const w = simSize.width;
        const h = simSize.height;
        const { x: X, y: Y, oldX: OX, oldY: OY } = this.store;
        const isFoot = this.isFootFlags;
        for (let i = 0, n = this.points.length; i < n; i++) {
            if (isFoot[i]) continue;
            if (X[i] < 0 || X[i] > w) {
                X[i] = X[i] < 0 ? 0 : w;
                OX[i] = X[i]; // no speed into the wall
                OY[i] = Y[i] - (Y[i] - OY[i]) * EDGE_FRICTION; // slide along it
            }
            if (Y[i] < 0 || Y[i] > h) {
                Y[i] = Y[i] < 0 ? 0 : h;
                OY[i] = Y[i];
                OX[i] = X[i] - (X[i] - OX[i]) * EDGE_FRICTION;
            }
        }
    }

    /**
     * Called when a foot lands on an edge and a shiver starts.
     */
    onShiverStart() {
        if (!printOnShiver || this.isDead) return;
        if (time - this.lastShiverPrint < SHIVER_PRINT_COOLDOWN) return;
        this.lastShiverPrint = time;
        this.printToBackground();
    }

    printToBackground() {
        const baseShade = usePerCreatureImprint
            ? this.params.imprintShade
            : imprintShade;
        // Shade Variation: each print a little stronger or fainter.
        const shadeToUse = Math.min(
            1,
            Math.max(0, baseShade * (1 + (Math.random() * 2 - 1) * imprintShadeVariation)),
        );
        const blendModeToUse = usePerCreatureImprint
            ? this.params.imprintBlendMode
            : imprintBlendMode;
        const colorToUse = usePerCreatureImprint
            ? this.params.imprintColor
            : imprintColor;
        simHooks.print(this, shadeToUse, blendModeToUse, colorToUse);
    }

    hasFaded() {
        return (
            this.isDead &&
            deathEffect === 'fade' &&
            time - this.deathTime > FADE_DURATION
        );
    }

    activateFoot(foot) {
        if (this.isDead) return false;
        if (foot && foot.footState === FOOT_STATES.FIXED) {
            const randomTarget = foot.getRandomEdgeTarget();
            const coordinatedTarget = foot.getCoordinatedTarget();
            const finalX =
                randomTarget.x * (1 - footCoordinationFactor) +
                coordinatedTarget.x * footCoordinationFactor;
            const finalY =
                randomTarget.y * (1 - footCoordinationFactor) +
                coordinatedTarget.y * footCoordinationFactor;
            foot.targetPos = { x: finalX, y: finalY };
            foot.footState = FOOT_STATES.SEEKING;
            foot.stepStartTime = time;
            return true;
        }
        return false;
    }

    processGaitQueue() {
        if (this.isDead || this.gaitActivationQueue.length === 0) return;
        for (let i = this.gaitActivationQueue.length - 1; i >= 0; i--) {
            const item = this.gaitActivationQueue[i];
            item.delay--;
            if (item.delay <= 0) {
                this.activateFoot(item.foot);
                this.gaitActivationQueue.splice(i, 1);
            }
        }
    }

    wakeNextMovers(triggeringFoot = null) {
        if (this.isDead) return;
        switch (gaitPattern) {
            case 'paired':
                if (this.footPairs.length === 0) return;
                for (let i = 0; i < this.footPairs.length; i++) {
                    const pairIndex = (this.nextPairToWake + i) % this.footPairs.length;
                    const pair = this.footPairs[pairIndex];
                    if (pair.every((foot) => foot.footState === FOOT_STATES.FIXED)) {
                        for (const foot of pair) this.activateFoot(foot);
                        this.nextPairToWake = (pairIndex + 1) % this.footPairs.length;
                        return;
                    }
                }
                break;
            case 'sidewinder':
                if (this.feet.length === 0 || this.gaitActivationQueue.length > 0)
                    return;
                let centerX = 0;
                for (const p of this.points) centerX += p.x;
                centerX /= this.points.length;
                const triggerSide = triggeringFoot
                    ? triggeringFoot.x < centerX
                        ? 'left'
                        : 'right'
                    : 'right';
                const sideToWake = triggerSide === 'left' ? 'right' : 'left';
                let feetToWake = this.feet.filter((foot) => {
                    const footSide = foot.x < centerX ? 'left' : 'right';
                    return (
                        footSide === sideToWake && foot.footState === FOOT_STATES.FIXED
                    );
                });
                if (feetToWake.length === 0) {
                    feetToWake = this.feet.filter(
                        (foot) => foot.footState === FOOT_STATES.FIXED,
                    );
                }
                feetToWake.sort((a, b) => a.y - b.y);
                for (let i = 0; i < feetToWake.length; i++) {
                    this.gaitActivationQueue.push({
                        foot: feetToWake[i],
                        delay: i * waveDelay,
                    });
                }
                break;
            default:
                if (this.feet.length === 0) return;
                for (let i = 0; i < this.feet.length; i++) {
                    this.nextFootToWake = (this.nextFootToWake + 1) % this.feet.length;
                    if (this.activateFoot(this.feet[this.nextFootToWake])) break;
                }
                break;
        }
    }

    createGrid(density) {
        const size = Math.min(simSize.width, simSize.height) * 0.6;
        const spacing = density > 1 ? size / (density - 1) : size;
        const offsetX = (simSize.width - size) / 2 + (Math.random() * 200 - 100);
        const offsetY = (simSize.height - size) / 2 + (Math.random() * 200 - 100);
        for (let row = 0; row < density; row++) {
            for (let col = 0; col < density; col++) {
                this.points.push(
                    new Point(offsetX + col * spacing, offsetY + row * spacing, this),
                );
            }
        }
        for (let row = 0; row < density; row++) {
            for (let col = 0; col < density; col++) {
                const index = row * density + col;
                if (col < density - 1)
                    this.springs.push(
                        new Spring(this.points[index], this.points[index + 1], spacing),
                    );
                if (row < density - 1)
                    this.springs.push(
                        new Spring(
                            this.points[index],
                            this.points[index + density],
                            spacing,
                        ),
                    );
            }
        }
        const perimeter = [];
        if (density > 1) {
            for (let i = 0; i < density; i++) perimeter.push(this.points[i]);
            for (let i = 1; i < density; i++)
                perimeter.push(this.points[i * density + density - 1]);
            for (let i = density - 2; i >= 0; i--)
                perimeter.push(this.points[(density - 1) * density + i]);
            for (let i = density - 2; i > 0; i--)
                perimeter.push(this.points[i * density]);
        } else if (this.points.length > 0) {
            perimeter.push(this.points[0]);
        }
        return { perimeter };
    }

    createLetter(char, density) {
        const offscreenCanvas = createScratchCanvas();
        const offscreenCtx = offscreenCanvas.getContext('2d');
        const fontSize = 200;
        const canvasSize = 250;
        offscreenCanvas.width = canvasSize;
        offscreenCanvas.height = canvasSize;
        offscreenCtx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;
        offscreenCtx.textAlign = 'center';
        offscreenCtx.textBaseline = 'middle';
        offscreenCtx.fillText(char, canvasSize / 2, canvasSize / 2);
        const imageData = offscreenCtx.getImageData(0, 0, canvasSize, canvasSize);
        const step = Math.max(1, 20 - density);
        const rawPoints = [];
        for (let y = 0; y < canvasSize; y += step)
            for (let x = 0; x < canvasSize; x += step)
                if (imageData.data[(y * canvasSize + x) * 4 + 3] > 128)
                    rawPoints.push({ x, y });
        if (rawPoints.length === 0) return { perimeter: [], springThreshold: 0 };
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of rawPoints) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = minX + width / 2;
        const centerY = minY + height / 2;
        const targetSize = Math.min(simSize.width, simSize.height) * 0.7;
        const scale = targetSize / Math.max(width, height);
        for (const p of rawPoints) {
            const x =
                (p.x - centerX) * scale +
                simSize.width / 2 +
                (Math.random() * 200 - 100);
            const y =
                (p.y - centerY) * scale +
                simSize.height / 2 +
                (Math.random() * 200 - 100);
            this.points.push(new Point(x, y, this));
        }
        return { perimeter: this.points, springThreshold: step * scale * 1.5 };
    }

    createSpringsFromProximity(threshold) {
        if (this.points.length < 2) return;
        const grid = new SpatialHashGrid(
            { width: simSize.width, height: simSize.height },
            threshold * 1.5,
        );
        for (let i = 0; i < this.points.length; i++) {
            grid.insert(this.points[i], i);
        }
        for (let i = 0; i < this.points.length; i++) {
            const p1 = this.points[i];
            const nearby = grid.query(p1, threshold);
            for (const item of nearby) {
                const p2 = item.point;
                const j = item.index;
                if (i >= j) continue;
                const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                if (dist < threshold) {
                    this.springs.push(new Spring(p1, p2, dist));
                }
            }
        }
    }

    prunePointsNotConnectedToFeet() {
        if (
            !this.params.pruneUnfootedPoints ||
            this.feet.length === 0 ||
            this.points.length === 0
        )
            return;
        const adj = new Map();
        this.points.forEach((p) => adj.set(p, []));
        this.springs.forEach((s) => {
            if (adj.has(s.p1) && adj.has(s.p2)) {
                adj.get(s.p1).push(s.p2);
                adj.get(s.p2).push(s.p1);
            }
        });
        const pointsToKeep = new Set();
        const feetToKeep = new Set();
        for (const foot of this.feet) {
            const component = new Set();
            const queue = [foot];
            component.add(foot);
            let head = 0;
            while (head < queue.length) {
                const currentPoint = queue[head++];
                const neighbors = adj.get(currentPoint) || [];
                for (const neighbor of neighbors) {
                    if (!component.has(neighbor)) {
                        component.add(neighbor);
                        queue.push(neighbor);
                    }
                }
            }
            if (component.size >= this.params.minPointsPerFoot) {
                component.forEach((p) => pointsToKeep.add(p));
                feetToKeep.add(foot);
            }
        }
        this.points = this.points.filter((p) => pointsToKeep.has(p));
        this.feet = this.feet.filter((f) => feetToKeep.has(f));
        this.springs = this.springs.filter(
            (s) => pointsToKeep.has(s.p1) && pointsToKeep.has(s.p2),
        );
    }

    init() {
        this.points = [];
        this.springs = [];
        this.feet = [];
        this.footPairs = [];
        this.gaitActivationQueue = [];
        let shapeData;
        let perimeterRing = [];
        switch (this.params.shape) {
            case 'letter':
                shapeData = this.createLetter(
                    this.params.character,
                    this.params.pointDensity,
                );
                perimeterRing = shapeData.perimeter;
                this.createSpringsFromProximity(shapeData.springThreshold);
                break;
            default:
                shapeData = this.createGrid(this.params.pointDensity);
                perimeterRing = shapeData.perimeter;
                break;
        }
        const tendrilTips = [];
        if (this.params.enableTendrils && perimeterRing.length > 0) {
            const hairSegmentLength = 5;
            const actualNumTendrils = Math.min(
                this.params.numTendrils,
                perimeterRing.length,
            );
            const shuffledPerimeter = [...perimeterRing].sort(
                () => 0.5 - Math.random(),
            );
            const maxSegmentCount = Math.max(
                2,
                Math.floor(this.params.tendrilLength * this.params.tendrilQuality),
            );
            const minSegmentCount = Math.max(
                2,
                Math.floor(maxSegmentCount * (1 - this.params.tendrilLengthVariation)),
            );
            for (let i = 0; i < actualNumTendrils; i++) {
                const parentPoint = shuffledPerimeter[i];
                let prevPoint = parentPoint;
                const lengthRange = maxSegmentCount - minSegmentCount;
                const thisTendrilLength =
                    minSegmentCount + Math.floor(Math.random() * (lengthRange + 1));
                for (let j = 0; j < thisTendrilLength; j++) {
                    const newPoint = new Point(
                        prevPoint.x,
                        prevPoint.y + hairSegmentLength,
                        this,
                    );
                    newPoint.isHair = true;
                    this.points.push(newPoint);
                    const newSpring = new Spring(prevPoint, newPoint, hairSegmentLength);
                    newSpring.isHair = true;
                    this.springs.push(newSpring);
                    prevPoint = newPoint;
                    if (j === thisTendrilLength - 1) tendrilTips.push(newPoint);
                }
            }
        }
        const footPlacementPool =
            this.params.placeFeetOnTendrils && tendrilTips.length > 0
                ? tendrilTips
                : perimeterRing.filter((p) => !p.isFoot && this.points.includes(p));
        const actualNumFeet = Math.min(
            this.params.numFeet,
            footPlacementPool.length,
        );
        if (actualNumFeet > 0) {
            if (this.params.useRandomPlacement) {
                const shuffledPool = [...footPlacementPool].sort(
                    () => 0.5 - Math.random(),
                );
                for (let i = 0; i < actualNumFeet; i++) {
                    shuffledPool[i].isFoot = true;
                    this.feet.push(shuffledPool[i]);
                }
            } else {
                for (let i = 0; i < actualNumFeet; i++) {
                    const index = Math.floor(
                        i * (footPlacementPool.length / actualNumFeet),
                    );
                    footPlacementPool[index].isFoot = true;
                    this.feet.push(footPlacementPool[index]);
                }
            }
        }
        this.prunePointsNotConnectedToFeet();
        if (this.feet.length > 0) {
            this.feet.sort((a, b) => a.x - b.x);
            let start = 0;
            let end = this.feet.length - 1;
            while (start <= end) {
                if (start === end) this.footPairs.push([this.feet[start]]);
                else this.footPairs.push([this.feet[start], this.feet[end]]);
                start++;
                end--;
            }
            this.nextPairToWake = 0;
            for (const foot of this.feet) {
                foot.footState = FOOT_STATES.FIXED;
                foot.setEdgeTarget();
                foot.x = foot.targetPos.x;
                foot.y = foot.targetPos.y;
            }
            const seekersToStart = gaitPattern === 'sequential' ? numSeekingFeet : 1;
            for (let i = 0; i < seekersToStart; i++) this.wakeNextMovers();
        }
        if (enableProgressiveAppearance && this.feet.length > 0) {
            const adj = new Map();
            this.points.forEach((p) => adj.set(p, []));
            this.springs.forEach((s) => {
                adj.get(s.p1).push(s.p2);
                adj.get(s.p2).push(s.p1);
            });
            const queue = [{ point: this.feet[0], depth: 0 }];
            const visited = new Set([this.feet[0]]);
            this.feet[0].birthTime = time;
            let head = 0;
            while (head < queue.length) {
                const { point, depth } = queue[head++];
                point.birthTime = time + depth * growthSpeed;
                const neighbors = adj.get(point) || [];
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push({ point: neighbor, depth: depth + 1 });
                    }
                }
            }
        } else {
            for (const p of this.points) p.birthTime = time;
        }
        this.packArrays();
    }

    /**
     * Moves the points' positions and shivers into the creature's slice of
     * the shared point pool, and the springs' ends and rest lengths into index arrays, in
     * the same order, for the physics loops.
     */
    packArrays() {
        const n = this.points.length;
        const store = pointPool.alloc(this, n);
        // Fixed once the creature is built: used by the physics and drawing.
        this.isFootFlags = new Uint8Array(n);
        this.isHairFlags = new Uint8Array(n);
        this.pointBirth = new Float64Array(n);
        this.pointSizeRandom = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const p = this.points[i];
            store.x[i] = p.x;
            store.y[i] = p.y;
            store.oldX[i] = p.oldX;
            store.oldY[i] = p.oldY;
            store.pulse[i] = p.pulseMagnitude;
            p.store = store;
            p.i = i;
            this.isFootFlags[i] = p.isFoot ? 1 : 0;
            this.isHairFlags[i] = p.isHair ? 1 : 0;
            this.pointBirth[i] = p.birthTime;
            this.pointSizeRandom[i] = p.sizeRandomizer;
        }
        this.store = store;
        const m = this.springs.length;
        this.springA = new Int32Array(m);
        this.springB = new Int32Array(m);
        this.springRest = new Float64Array(m);
        this.springIsHair = new Uint8Array(m);
        for (let k = 0; k < m; k++) {
            const s = this.springs[k];
            this.springA[k] = s.p1.i;
            this.springB[k] = s.p2.i;
            this.springRest[k] = s.baseRestLength;
            this.springIsHair[k] = s.isHair ? 1 : 0;
        }
    }

    isOffscreen() {
        if (this.points.length === 0) return true;
        const buffer = 500;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of this.points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
        return (
            maxX < -buffer ||
            minX > simSize.width + buffer ||
            maxY < -buffer ||
            minY > simSize.height + buffer
        );
    }

    update() {
        if (enableBreathing && !this.isDead) {
            this.breathingPhase += breathingRate;
            this.currentRestLengthFactor =
                breathingOffset + Math.sin(this.breathingPhase) * breathingAmplitude;
        } else if (!this.isDead) {
            this.currentRestLengthFactor = this.params.restLengthFactor;
        }
        if (enableAging && !this.isDead) {
            let shouldDie = false;
            if (agingMode === 'time') {
                if (time - this.birthTime > this.lifespan) shouldDie = true;
            } else if (this.stepsTaken >= this.maxSteps) shouldDie = true;
            if (shouldDie) this.die();
        }
        this.processGaitQueue();
        const points = this.points;
        const { x: X, y: Y, oldX: OX, oldY: OY, pulse: P } = this.store;
        const isFoot = this.isFootFlags;
        const n = points.length;
        // Points: feet walk, body points move on (Verlet) and fall.
        for (let i = 0; i < n; i++) {
            if (isFoot[i]) {
                points[i].updateFoot();
                continue;
            }
            const vX = (X[i] - OX[i]) * (1.0 - damping);
            const vY = (Y[i] - OY[i]) * (1.0 - damping);
            OX[i] = X[i];
            OY[i] = Y[i];
            X[i] += vX + gravityX;
            Y[i] += vY + gravityY;
        }
        // Springs: pull both ends toward the rest length. Feet that stand
        // (fixed or settling) do not move.
        const restFactor = this.currentRestLengthFactor;
        const tendrilStiffness = this.params.tendrilStiffness;
        const { springA: A, springB: B, springRest: REST, springIsHair: HAIR } = this;
        const movable = (i) => {
            if (!isFoot[i]) return true;
            const s = points[i].footState;
            return s !== FOOT_STATES.FIXED && s !== FOOT_STATES.SETTLING;
        };
        for (let k = 0, m = A.length; k < m; k++) {
            const a = A[k];
            const b = B[k];
            const averagePulse = (P[a] + P[b]) * 0.5;
            const contraction = 1.0 - averagePulse * shiverIntensityFactor;
            const currentRestLength = REST[k] * restFactor * contraction;
            const dx = X[b] - X[a];
            const dy = Y[b] - Y[a];
            const distSq = dx * dx + dy * dy;
            if (distSq < 0.0001) continue; // dist < 0.01
            const dist = Math.sqrt(distSq);
            const stiffness = HAIR[k] ? tendrilStiffness : springStiffness;
            const scale = ((dist - currentRestLength) * stiffness) / dist;
            const fx = dx * scale;
            const fy = dy * scale;
            if (movable(a)) {
                X[a] += fx;
                Y[a] += fy;
            }
            if (movable(b)) {
                X[b] -= fx;
                Y[b] -= fy;
            }
        }
        if (keepOnScreen) this.keepInsideScreen();
        this.propagationAccumulator += shiverPropagationSpeed;
        const hopsThisFrame = Math.floor(this.propagationAccumulator);
        if (hopsThisFrame > 0) {
            this.propagateInternalPulse(hopsThisFrame);
            this.propagationAccumulator -= hopsThisFrame;
        }
    }

    propagateInternalPulse(numHops) {
        if (this.isDead) return;
        const n = this.points.length;
        const P = this.store.pulse;
        // Nothing shivering: nothing to spread or decay (the common case).
        let shivering = false;
        for (let i = 0; i < n; i++) {
            if (P[i] > 0) {
                shivering = true;
                break;
            }
        }
        if (!shivering) return;

        const pulseLoss = shiverPropagationFactor;
        const decayRate = 0.9 + shiverDurationFactor * 0.09;
        // Reused buffers indexed by point, instead of new Maps every frame.
        if (!this.pulseNow || this.pulseNow.length !== n) {
            this.pulseNow = new Float64Array(n);
            this.pulseNext = new Float64Array(n);
        }
        const now = this.pulseNow;
        const next = this.pulseNext;
        now.set(P);
        const skipHair = !this.params.shiversOnTendrils;
        const { springA: A, springB: B, springIsHair: HAIR } = this;
        for (let hop = 0; hop < numHops; hop++) {
            next.fill(0);
            for (let k = 0, m = A.length; k < m; k++) {
                if (skipHair && HAIR[k]) continue;
                const a = A[k];
                const b = B[k];
                const magA = now[a];
                const magB = now[b];
                if (magA > magB) {
                    const pulse = magA * pulseLoss;
                    if (pulse > next[b]) next[b] = pulse;
                } else if (magB > magA) {
                    const pulse = magB * pulseLoss;
                    if (pulse > next[a]) next[a] = pulse;
                }
            }
            let changed = false;
            for (let i = 0; i < n; i++) {
                if (next[i] > now[i]) {
                    now[i] = next[i];
                    changed = true;
                }
            }
            if (!changed) break;
        }
        for (let i = 0; i < n; i++) {
            const pulse = now[i] * decayRate;
            P[i] = pulse < 0.01 ? 0 : pulse;
        }
    }
}

/**
 * A spatial hash grid for optimizing proximity queries.
 */
class SpatialHashGrid {
    constructor(bounds, cellSize) {
        this.bounds = bounds;
        this.cellSize = cellSize;
        this.cols = Math.ceil(bounds.width / cellSize);
        this.rows = Math.ceil(bounds.height / cellSize);
        this.grid = new Map();
    }

    _getKey(x, y) {
        return `${x}|${y}`;
    }

    insert(point, index) {
        const cx = Math.floor(point.x / this.cellSize);
        const cy = Math.floor(point.y / this.cellSize);
        const key = this._getKey(cx, cy);
        if (!this.grid.has(key)) {
            this.grid.set(key, []);
        }
        this.grid.get(key).push({ point, index });
    }

    query(point, radius) {
        const nearby = [];
        const r = radius / this.cellSize;
        const cx = Math.floor(point.x / this.cellSize);
        const cy = Math.floor(point.y / this.cellSize);
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
            for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
                const key = this._getKey(x, y);
                if (this.grid.has(key)) {
                    nearby.push(...this.grid.get(key));
                }
            }
        }
        return nearby;
    }
}

/**
 * Represents a single point mass in the Verlet integration simulation.
 */
class Point {
    constructor(x, y, creature, isFoot = false) {
        // Position, previous position and shiver live in flat arrays: the
        // point's own until its creature is built, then the creature's (see
        // Creature.packArrays). x, y, oldX, oldY and pulseMagnitude read and
        // write them.
        this.store = { x: [x], y: [y], oldX: [x], oldY: [y], pulse: [0] };
        this.i = 0;
        this.creature = creature;
        this.isFoot = isFoot;
        this.isHair = false;
        this.footState = isFoot ? FOOT_STATES.FIXED : null;
        this.targetPos = { x, y };
        this.searchPhase = Math.random() * Math.PI * 2;
        this.stepStartTime = 0;
        this.settleStartTime = 0;
        this.birthTime = Infinity;
        this.sizeRandomizer = (Math.random() - 0.5) * 4;
    }

    get x() { return this.store.x[this.i]; }
    set x(v) { this.store.x[this.i] = v; }
    get y() { return this.store.y[this.i]; }
    set y(v) { this.store.y[this.i] = v; }
    get oldX() { return this.store.oldX[this.i]; }
    set oldX(v) { this.store.oldX[this.i] = v; }
    get oldY() { return this.store.oldY[this.i]; }
    set oldY(v) { this.store.oldY[this.i] = v; }
    get pulseMagnitude() { return this.store.pulse[this.i]; }
    set pulseMagnitude(v) { this.store.pulse[this.i] = v; }

    updateFoot() {
        switch (this.footState) {
            case FOOT_STATES.FIXED:
                this.x = this.targetPos.x;
                this.y = this.targetPos.y;
                break;
            case FOOT_STATES.SEEKING:
                let progress = (time - this.stepStartTime) / stepDuration;
                if (progress > 1) {
                    this.setEdgeTarget();
                    this.stepStartTime = time;
                    progress = 0;
                }
                const wobbleX =
                    Math.sin(time * 0.02 + this.searchPhase) * wobbleStrength;
                const wobbleY =
                    Math.cos(time * 0.015 + this.searchPhase) * wobbleStrength;
                const lift = Math.sin(progress * Math.PI) * stepHeight;
                this.x +=
                    (this.targetPos.x - this.x) * targetAttraction + wobbleX + gravityX;
                this.y +=
                    (this.targetPos.y - this.y) * targetAttraction -
                    lift +
                    wobbleY +
                    gravityY;
                if (
                    this.x <= 1 ||
                    this.x >= simSize.width - 1 ||
                    this.y <= 1 ||
                    (keepOnScreen && this.y >= simSize.height - 1)
                ) {
                    this.footState = FOOT_STATES.SETTLING;
                    this.settleStartTime = time;
                    this.targetPos.x = Math.max(0, Math.min(simSize.width, this.x));
                    this.targetPos.y = Math.max(0, Math.min(simSize.height, this.y));
                    this.pulseMagnitude = 1.0;
                    this.creature?.onShiverStart();
                }
                break;
            case FOOT_STATES.SETTLING:
                this.x = this.targetPos.x;
                this.y = this.targetPos.y;
                if (time > this.settleStartTime + stepCooldown) {
                    this.footState = FOOT_STATES.FIXED;
                    if (this.creature && !this.creature.isDead) {
                        this.creature.incrementSteps();
                        this.creature.wakeNextMovers(this);
                    }
                }
                break;
        }
    }

    getRandomEdgeTarget() {
        // The floor (edge 2) only holds feet while Keep Creatures on Screen is on.
        const edges = keepOnScreen ? [0, 1, 2, 3] : [0, 1, 3];
        const edge = edges[Math.floor(Math.random() * edges.length)];
        switch (edge) {
            case 0:
                return { x: Math.random() * simSize.width, y: 0 };
            case 1:
                return { x: simSize.width, y: Math.random() * simSize.height };
            case 2:
                return { x: Math.random() * simSize.width, y: simSize.height };
            case 3:
                return { x: 0, y: Math.random() * simSize.height };
        }
    }

    getCoordinatedTarget() {
        let centerX = 0;
        let centerY = 0;
        const creature = this.creature;
        if (creature && creature.points.length > 0) {
            const bodyPoints = creature.points.filter((p) => !p.isHair);
            if (bodyPoints.length > 0) {
                for (const p of bodyPoints) {
                    centerX += p.x;
                    centerY += p.y;
                }
                centerX /= bodyPoints.length;
                centerY /= bodyPoints.length;
            }
        }
        const vectorX = this.targetPos.x - centerX;
        const vectorY = this.targetPos.y - centerY;
        const oppositeX = centerX - vectorX;
        const oppositeY = centerY - vectorY;
        let bestDist = Infinity;
        let bestPoint = { x: 0, y: 0 };
        for (let x = 0; x <= simSize.width; x += 50) {
            for (const p of keepOnScreen
                ? [
                      { x, y: 0 },
                      { x, y: simSize.height },
                  ]
                : [{ x, y: 0 }]) {
                const d = Math.hypot(p.x - oppositeX, p.y - oppositeY);
                if (d < bestDist) {
                    bestDist = d;
                    bestPoint = p;
                }
            }
        }
        for (let y = 0; y <= simSize.height; y += 50) {
            for (const p of [
                { x: 0, y },
                { x: simSize.width, y },
            ]) {
                const d = Math.hypot(p.x - oppositeX, p.y - oppositeY);
                if (d < bestDist) {
                    bestDist = d;
                    bestPoint = p;
                }
            }
        }
        return bestPoint;
    }

    setEdgeTarget() {
        this.targetPos = this.getRandomEdgeTarget();
    }
}

/**
 * Represents a spring constraint between two points.
 */
class Spring {
    constructor(p1, p2, baseLength) {
        this.p1 = p1;
        this.p2 = p2;
        this.baseRestLength = baseLength;
        this.isHair = false;
    }
}

/**
 * One simulation step: births, bursts, then every creature moves.
 */
function simStep() {
    pointPool.compact(creatures);
    time++;
    simHooks.tick();
    while (burstQueue.length && burstQueue[0].at <= time) {
        const b = burstQueue.shift();
        spawnBurstCreature(b.x, b.y, b.around);
    }
    const limitsReached =
        (enableCreatureLimit && creatures.length >= maxCreatures) ||
        (enablePointLimit && getCurrentTotalPoints() >= maxPoints);

    if (isInitializingFill) {
        if (!limitsReached && time - timeSinceLastAutoAdd > INIT_FILL_DELAY) {
            addCreature();
            timeSinceLastAutoAdd = time;
        } else if (limitsReached) {
            isInitializingFill = false;
        }
    } else {
        switch (autoMode) {
            case 'respawn':
                if (creatures.length === 0) {
                    if (timeSinceEmpty === null) timeSinceEmpty = time;
                    if (time - timeSinceEmpty > autoAddDelaySeconds * 60) {
                        addCreature();
                        timeSinceEmpty = null;
                    }
                } else {
                    timeSinceEmpty = null;
                }
                break;
            case 'top-up':
                if (!limitsReached) {
                    if (timeSinceLastAutoAdd === null) timeSinceLastAutoAdd = time;
                    if (time - timeSinceLastAutoAdd > autoAddDelaySeconds * 60) {
                        addCreature();
                        timeSinceLastAutoAdd = time;
                    }
                } else {
                    timeSinceLastAutoAdd = time;
                }
                break;
        }
    }

    for (let i = creatures.length - 1; i >= 0; i--) {
        const c = creatures[i];
        c.update();
        if (c.isOffscreen() || c.hasFaded()) {
            creatures.splice(i, 1);
            simHooks.populationChanged();
        }
    }
}

/**
 * Creates a new creature if limits are not reached.
 */
function addCreature() {
    if (
        (enableCreatureLimit && creatures.length >= maxCreatures) ||
        (enablePointLimit && getCurrentTotalPoints() >= maxPoints)
    ) {
        return;
    }
    const char = newCreatureChar;
    creatures.push(new Creature(creatureShape, char));
    if (enablePointLimit && getCurrentTotalPoints() > maxPoints) {
        creatures.pop(); // Remove if it exceeded the limit
    }
    simHooks.populationChanged();
}

/**
 * Queues a burst of creatures. With an origin ({x, y}), they are born around
 * it and pushed away from it; without one, each is born at a random place and
 * bursts outward from its own center.
 */
function triggerBurst(origin = null) {
    const steps = Math.round(burstSpreadSeconds * 60);
    const radius = Math.min(simSize.width, simSize.height) * 0.12;
    for (let i = 0; i < burstSize; i++) {
        const at = time + 1 + Math.round(Math.random() * steps);
        let x;
        let y;
        if (origin) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * radius;
            x = origin.x + Math.cos(a) * r;
            y = origin.y + Math.sin(a) * r;
        } else {
            x = simSize.width * (0.1 + Math.random() * 0.8);
            y = simSize.height * (0.1 + Math.random() * 0.8);
        }
        burstQueue.push({ at, x, y, around: origin });
    }
    burstQueue.sort((a, b) => a.at - b.at);
}

/**
 * One burst creature: born with its body centered on (x, y), then pushed
 * away from the burst origin (or from its own center for random bursts).
 */
function spawnBurstCreature(x, y, around) {
    const char = newCreatureChar;
    // About 1 creature in 8 comes out empty (Remove Loose Parts can discard
    // every point when the feet land on a detached piece): try again.
    let c;
    let body = [];
    for (let attempt = 0; attempt < 5 && body.length === 0; attempt++) {
        c = new Creature(creatureShape, char);
        body = c.points.filter((p) => !p.isHair);
    }
    if (body.length === 0) return;
    let cx = 0;
    let cy = 0;
    for (const p of body) {
        cx += p.x;
        cy += p.y;
    }
    cx /= body.length;
    cy /= body.length;
    const dx = x - cx;
    const dy = y - cy;
    const from = around || { x, y };
    for (const p of c.points) {
        p.x += dx;
        p.y += dy;
        p.targetPos.x += dx;
        p.targetPos.y += dy;
        // Verlet speed is the gap between x and oldX: away from the origin.
        const ox = p.x - from.x;
        const oy = p.y - from.y;
        const len = Math.hypot(ox, oy) || 1;
        const speed = burstForce * (around ? 1 : 0.6);
        p.oldX = p.x - (ox / len) * speed;
        p.oldY = p.y - (oy / len) * speed;
    }
    creatures.push(c);
    simHooks.populationChanged();
}

/**
 * Stretches foot targets with the window, as if pinned to an elastic
 * sheet: a foot at 1/3 of the top edge stays at 1/3, the right/bottom
 * edges carry their feet along. Bodies follow through their springs.
 */
function moveFeetWithEdges(oldW, oldH, newW, newH) {
    if (oldW <= 0 || oldH <= 0) return;
    const EDGE_SNAP = 2;
    const sx = newW / oldW;
    const sy = newH / oldH;
    for (const creature of creatures) {
        for (const foot of creature.feet) {
            const t = foot.targetPos;
            t.x = t.x >= oldW - EDGE_SNAP ? newW : t.x * sx;
            t.y = t.y >= oldH - EDGE_SNAP ? newH : t.y * sy;
            // Anchored feet sit exactly on their target.
            if (foot.footState !== FOOT_STATES.SEEKING) {
                foot.x = foot.oldX = t.x;
                foot.y = foot.oldY = t.y;
            }
        }
    }
}

function getCurrentTotalPoints() {
    return creatures.reduce((sum, creature) => sum + creature.points.length, 0);
}

/**
 * Keep on Screen turned off: feet standing on the floor let go and look for
 * another edge.
 */
function releaseFloorFeet() {
    for (const c of creatures) {
        if (c.isDead) continue;
        for (const foot of c.feet) {
            if (foot.footState !== FOOT_STATES.SEEKING && foot.targetPos.y >= simSize.height - 2) {
                foot.footState = FOOT_STATES.FIXED;
                c.activateFoot(foot);
            }
        }
    }
}

/**
 * Starts over: no creatures, then a first one or a fill, by Auto Mode.
 */
function resetCreatures() {
    creatures = [];
    isInitializingFill = false;
}

function startCreatures() {
    if (autoMode === 'top-up') {
        isInitializingFill = true;
        timeSinceLastAutoAdd = time;
    } else if (autoMode !== 'off') {
        addCreature();
    }
}
