// =================================================================
//                      DOM & UI ELEMENTS
// =================================================================

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const backgroundCanvas = document.getElementById('background-canvas');
const backgroundCtx = backgroundCanvas.getContext('2d');
// Imprints that fade (Fade Imprints): FADE_LAYERS stacked canvases above the
// permanent background, oldest first (see updateFadeLayers).
const FADE_LAYERS = 4;
const fadeLayers = [];
for (let i = 0; i < FADE_LAYERS; i++) {
    const layer = document.createElement('canvas');
    layer.className = 'fade-layer';
    layer.style.display = 'none'; // hidden while empty (see clearFadeLayer)
    canvas.before(layer); // between the background and the live drawing
    fadeLayers.push({ canvas: layer, ctx: layer.getContext('2d'), born: 0, hasInk: false, opacity: 1 });
}
const gravityIndicatorCanvas = document.getElementById(
    'gravity-indicator-canvas',
);
const gravityIndicatorCtx = gravityIndicatorCanvas.getContext('2d');

const fpsCounterElement = document.getElementById('fpsCounter');
const debugStatus = document.getElementById('debug-status');
const debugOrientation = document.getElementById('debug-orientation');
const debugGravityX = document.getElementById('debug-gravity-x');
const debugGravityY = document.getElementById('debug-gravity-y');

// =================================================================
//                     GLOBAL STATE & CONFIG
// =================================================================

// --- Core Simulation State ---
let creatures = [];
let time = 0;
let frameCount = 0;
let lastFpsUpdateTime = 0;
let fps = 0;
let continuousPrintTimeoutId = null;
let timeSinceEmpty = null;
let timeSinceLastAutoAdd = null;
let isInitializingFill = false;

// --- Constants ---
const INIT_FILL_DELAY = 30;
const FOOT_STATES = { FIXED: 0, SEEKING: 1, SETTLING: 2 };
const FADE_DURATION = 180;
const SIM_STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 4;
const STEP_TOLERANCE_MS = 1;
let lastFrameTime = null;
let stepAccumulator = 0;
let resizePending = false;
const snapshotCanvas = document.createElement('canvas');
const snapshotCtx = snapshotCanvas.getContext('2d');

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

/**
 * Imprint ink: the chosen color lightened toward white by `lightness` (0..1),
 * so shiver intensity still reads as darker or lighter ink. Black gives the
 * original grays.
 */
function imprintInk(rgb, lightness, alpha) {
    const mix = (v) => Math.round(v + (255 - v) * lightness);
    return `rgba(${mix(rgb.r)}, ${mix(rgb.g)}, ${mix(rgb.b)}, ${alpha})`;
}

/**
 * Sets a separate print color (bottom-left picker).
 */
function setPrintColor(hex) {
    imprintMatchesCreature = false;
    imprintColor = hex;
    syncPrintColorControls();
    document.dispatchEvent(
        new CustomEvent('printcolorchange', { detail: { same: false, color: hex } }),
    );
}

/**
 * Sets the creature color and updates its panel control.
 */
function setCreatureColor(hex) {
    creatureColor = hex;
    creatureRgb = hexToRgb(hex);
    const input = document.getElementById('creatureColor');
    const value = document.getElementById('creatureColorValue');
    if (input) input.value = hex;
    if (value) value.textContent = hex;
}

/**
 * Turns the screen walls on or off, keeping the right-edge zone and the
 * panel checkbox in line; tour.js flashes the new state.
 */
function setKeepOnScreen(on) {
    keepOnScreen = on;
    const check = document.getElementById('keepOnScreenCheck');
    if (check) check.checked = on;
    document.getElementById('keepOnScreenBtn')?.setAttribute('aria-pressed', String(on));
    document.dispatchEvent(new CustomEvent('keeponscreenchange', { detail: { on } }));
}

/**
 * Sets the shiver color and updates its panel control.
 */
function setShiverColor(hex) {
    shiverColor = hex;
    shiverRgb = hexToRgb(hex);
    const input = document.getElementById('shiverColor');
    const value = document.getElementById('shiverColorValue');
    if (input) input.value = hex;
    if (value) value.textContent = hex;
}

/**
 * Prints in the creature and shiver colors again.
 */
function setPrintColorSame() {
    imprintMatchesCreature = true;
    syncPrintColorControls();
    document.dispatchEvent(
        new CustomEvent('printcolorchange', { detail: { same: true, color: creatureColor } }),
    );
}

/**
 * Keeps the Printing panel controls in line with the current print color.
 */
function syncPrintColorControls() {
    const check = document.getElementById('imprintMatchesCreatureCheck');
    const picker = document.getElementById('imprintColor');
    const value = document.getElementById('imprintColorValue');
    if (check) check.checked = imprintMatchesCreature;
    if (picker) {
        picker.value = imprintColor;
        picker.disabled = imprintMatchesCreature;
    }
    if (value) value.textContent = imprintColor;
}

// Drawing buckets shared by all creatures (drawing is synchronous, one
// creature at a time), so no arrays or objects are allocated per frame.
const SHADE_STEPS = 20;
const DRAW_BUCKETS = {
    springs: Array.from({ length: SHADE_STEPS + 1 }, () => []),
    points: Array.from({ length: SHADE_STEPS + 1 }, () => []),
    radii: Array.from({ length: SHADE_STEPS + 1 }, () => []),
    feet: [],
    tendrils: [],
};

// Parsed once per color change, not on every frame.
let creatureRgb = hexToRgb(creatureColor);
let shiverRgb = hexToRgb(shiverColor);

/**
 * Live ink: the creature color, lightened by `restLightness` at rest, moving
 * toward the shiver color as `intensity` (0..1) rises. With both colors black
 * this gives the original grays.
 */
function liveInk(restLightness, intensity, alpha) {
    // The creature being drawn may have its own color (random colors).
    const base = drawInkRgb || creatureRgb;
    const mix = (c, s) => {
        const rest = c + (255 - c) * restLightness;
        return Math.round(rest + (s - rest) * intensity);
    };
    return `rgba(${mix(base.r, shiverRgb.r)}, ${mix(base.g, shiverRgb.g)}, ${mix(base.b, shiverRgb.b)}, ${alpha})`;
}

// Set by Creature.draw for the creature being drawn (drawing is synchronous).
let drawInkRgb = null;
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
        const w = canvas.width;
        const h = canvas.height;
        for (const p of this.points) {
            if (p.isFoot) continue;
            if (p.x < 0 || p.x > w) {
                p.x = p.x < 0 ? 0 : w;
                p.oldX = p.x; // no speed into the wall
                p.oldY = p.y - (p.y - p.oldY) * EDGE_FRICTION; // slide along it
            }
            if (p.y < 0 || p.y > h) {
                p.y = p.y < 0 ? 0 : h;
                p.oldY = p.y;
                p.oldX = p.x - (p.x - p.oldX) * EDGE_FRICTION;
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
        const rgb = hexToRgb(colorToUse);
        const stamp = (targetCtx, shade) => {
            targetCtx.save();
            targetCtx.globalCompositeOperation = blendModeToUse;
            this.draw(targetCtx, true, shade, rgb);
            targetCtx.restore();
        };
        if (!fadeImprints) {
            stamp(backgroundCtx, shadeToUse);
            return;
        }
        // Fade Amount splits each imprint: the part that fades goes on the
        // fade layer, the part that stays on the permanent background.
        if (fadeAmount > 0) stamp(currentFadeLayer().ctx, shadeToUse * fadeAmount);
        if (fadeAmount < 1) stamp(backgroundCtx, shadeToUse * (1 - fadeAmount));
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
        const size = Math.min(canvas.width, canvas.height) * 0.6;
        const spacing = density > 1 ? size / (density - 1) : size;
        const offsetX = (canvas.width - size) / 2 + (Math.random() * 200 - 100);
        const offsetY = (canvas.height - size) / 2 + (Math.random() * 200 - 100);
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
        const offscreenCanvas = document.createElement('canvas');
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
        const targetSize = Math.min(canvas.width, canvas.height) * 0.7;
        const scale = targetSize / Math.max(width, height);
        for (const p of rawPoints) {
            const x =
                (p.x - centerX) * scale +
                canvas.width / 2 +
                (Math.random() * 200 - 100);
            const y =
                (p.y - centerY) * scale +
                canvas.height / 2 +
                (Math.random() * 200 - 100);
            this.points.push(new Point(x, y, this));
        }
        return { perimeter: this.points, springThreshold: step * scale * 1.5 };
    }

    createSpringsFromProximity(threshold) {
        if (this.points.length < 2) return;
        const grid = new SpatialHashGrid(
            { width: canvas.width, height: canvas.height },
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
            minX > canvas.width + buffer ||
            maxY < -buffer ||
            minY > canvas.height + buffer
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
        for (const point of this.points) point.update();
        const restFactor = this.currentRestLengthFactor;
        const tendrilStiffness = this.params.tendrilStiffness;
        for (const s of this.springs) s.update(restFactor, tendrilStiffness);
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
        const points = this.points;
        const n = points.length;
        // Nothing shivering: nothing to spread or decay (the common case).
        let shivering = false;
        for (let i = 0; i < n; i++) {
            if (points[i].pulseMagnitude > 0) {
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
        for (let i = 0; i < n; i++) {
            points[i].index = i;
            now[i] = points[i].pulseMagnitude;
        }
        const skipHair = !this.params.shiversOnTendrils;
        for (let hop = 0; hop < numHops; hop++) {
            next.fill(0);
            for (const spring of this.springs) {
                if (skipHair && spring.isHair) continue;
                const a = spring.p1.index;
                const b = spring.p2.index;
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
            points[i].pulseMagnitude = pulse < 0.01 ? 0 : pulse;
        }
    }

    draw(targetCtx, isImprint = false, currentImprintShade = 0.2, imprintRgb = hexToRgb(imprintColor)) {
        drawInkRgb = this.inkRgb;
        let fadeAlpha = 1.0;
        if (!isImprint && this.isDead && deathEffect === 'fade') {
            fadeAlpha = Math.max(0, 1.0 - (time - this.deathTime) / FADE_DURATION);
            if (fadeAlpha <= 0.01) return;
        }
        // Imprint ink: the imprint color, or the creature and shiver colors
        // when "Imprint Uses Creature Colors" is on.
        const imprintFill = (restLightness, intensity, lightness, alpha) =>
            imprintMatchesCreature
                ? liveInk(restLightness, intensity, alpha)
                : imprintInk(imprintRgb, lightness, alpha);
        // Reused per-shade buckets (21 shades); emptied, not reallocated.
        const springBatches = DRAW_BUCKETS.springs;
        const pointBatches = DRAW_BUCKETS.points;
        const pointRadii = DRAW_BUCKETS.radii;
        for (let k = 0; k <= SHADE_STEPS; k++) {
            springBatches[k].length = 0;
            pointBatches[k].length = 0;
            pointRadii[k].length = 0;
        }
        const footBatch = DRAW_BUCKETS.feet;
        const tendrilBatch = DRAW_BUCKETS.tendrils;
        footBatch.length = 0;
        tendrilBatch.length = 0;
        const letterBatches = new Map();
        const baseBodyRadius = pointBaseSize;
        const baseFootRadius = baseBodyRadius + 2.0;
        for (const s of this.springs) {
            if (time < s.p1.birthTime || time < s.p2.birthTime) continue;
            if (s.isHair) {
                tendrilBatch.push(s);
                continue;
            }
            const baseIntensity = (s.p1.pulseMagnitude + s.p2.pulseMagnitude) / 2;
            const shadeIntensity = Math.min(
                1.0,
                Math.max(minShade, baseIntensity * shiverEffectMultiplier),
            );
            springBatches[Math.floor(shadeIntensity * SHADE_STEPS)].push(s);
        }
        for (const point of this.points) {
            if (point.isHair || time < point.birthTime) continue;
            if (point.isFoot) {
                footBatch.push(point);
            } else {
                const baseIntensity = point.pulseMagnitude;
                const shadeIntensity = Math.min(
                    1.0,
                    Math.max(minShade, baseIntensity * shiverEffectMultiplier),
                );
                const radiusMultiplier =
                    1 + baseIntensity * shiverEffectMultiplier * POINT_SHIVER_SWELL;
                const variation = 1.0 + point.sizeRandomizer * pointSizeVariation;
                if (drawMode === 'point') {
                    const finalRadius = Math.min(
                        MAX_POINT_RADIUS,
                        Math.max(0.1, baseBodyRadius * radiusMultiplier * variation),
                    );
                    const k = Math.floor(shadeIntensity * SHADE_STEPS);
                    pointBatches[k].push(point);
                    pointRadii[k].push(finalRadius);
                } else if (drawMode === 'letter') {
                    const fontSize = Math.max(
                        1,
                        baseBodyRadius * 3 * radiusMultiplier * variation,
                    );
                    const styleKey = `${Math.floor(shadeIntensity * 20)}_${Math.round(
                        fontSize,
                    )}`;
                    if (!letterBatches.has(styleKey)) letterBatches.set(styleKey, []);
                    letterBatches.get(styleKey).push(point);
                }
            }
        }
        if (tendrilBatch.length > 0) {
            targetCtx.strokeStyle = isImprint
                ? imprintFill(20 / 255, 0, 20 / 255, currentImprintShade * 0.75)
                : liveInk(0, 0, 0.5 * fadeAlpha);
            targetCtx.lineWidth = 1;
            targetCtx.beginPath();
            for (const s of tendrilBatch) {
                targetCtx.moveTo(s.p1.x, s.p1.y);
                targetCtx.lineTo(s.p2.x, s.p2.y);
            }
            targetCtx.stroke();
        }
        const baseLineWidth = Math.max(0.2, 2.8 - this.points.length / 25);
        for (let styleKey = 0; styleKey <= SHADE_STEPS; styleKey++) {
            const springsInBatch = springBatches[styleKey];
            if (springsInBatch.length === 0) continue;
            const shadeIntensity = styleKey / SHADE_STEPS;
            const gray = Math.floor(80 * (1 - shadeIntensity));
            const lineWidth = Math.min(
                baseLineWidth + shadeIntensity * (baseLineWidth * 3.5),
                maxLineThickness,
            );
            targetCtx.strokeStyle = isImprint
                ? imprintFill(80 / 255, shadeIntensity, gray / 255, currentImprintShade)
                : liveInk(80 / 255, shadeIntensity, fadeAlpha);
            targetCtx.lineWidth = lineWidth;
            targetCtx.beginPath();
            for (const s of springsInBatch) {
                targetCtx.moveTo(s.p1.x, s.p1.y);
                targetCtx.lineTo(s.p2.x, s.p2.y);
            }
            targetCtx.stroke();
        }
        for (let styleKey = 0; styleKey <= SHADE_STEPS; styleKey++) {
            const pointsInBatch = pointBatches[styleKey];
            if (pointsInBatch.length === 0) continue;
            const radii = pointRadii[styleKey];
            const shadeIntensity = styleKey / SHADE_STEPS;
            const gray = Math.floor(180 * (1 - shadeIntensity));
            targetCtx.fillStyle = isImprint
                ? imprintFill(180 / 255, shadeIntensity, gray / 255, currentImprintShade)
                : liveInk(180 / 255, shadeIntensity, fadeAlpha);
            targetCtx.beginPath();
            for (let i = 0; i < pointsInBatch.length; i++) {
                const p = pointsInBatch[i];
                const r = radii[i];
                targetCtx.moveTo(p.x + r, p.y);
                targetCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
            }
            targetCtx.fill();
        }
        letterBatches.forEach((pointsInBatch, styleKey) => {
            const [shadeKey, fontSizeKey] = styleKey.split('_');
            const shadeIntensity = parseInt(shadeKey, 10) / 20;
            const gray = Math.floor(180 * (1 - shadeIntensity));
            targetCtx.fillStyle = isImprint
                ? imprintFill(180 / 255, shadeIntensity, gray / 255, currentImprintShade)
                : liveInk(180 / 255, shadeIntensity, fadeAlpha);
            targetCtx.font = `bold ${fontSizeKey}px sans-serif`;
            targetCtx.textAlign = 'center';
            targetCtx.textBaseline = 'middle';
            for (const point of pointsInBatch) {
                targetCtx.fillText(letterToDraw, point.x, point.y);
            }
        });
        if (footBatch.length > 0) {
            targetCtx.fillStyle = isImprint
                ? imprintFill(20 / 255, 0, 20 / 255, currentImprintShade)
                : liveInk(0, 0, fadeAlpha);
            targetCtx.beginPath();
            for (const point of footBatch) {
                targetCtx.moveTo(point.x + baseFootRadius, point.y);
                targetCtx.arc(point.x, point.y, baseFootRadius, 0, Math.PI * 2);
            }
            targetCtx.fill();
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
        this.x = this.oldX = x;
        this.y = this.oldY = y;
        this.creature = creature;
        this.isFoot = isFoot;
        this.isHair = false;
        this.footState = isFoot ? FOOT_STATES.FIXED : null;
        this.targetPos = { x, y };
        this.searchPhase = Math.random() * Math.PI * 2;
        this.mass = 1;
        this.stepStartTime = 0;
        this.settleStartTime = 0;
        this.pulseMagnitude = 0;
        this.birthTime = Infinity;
        this.sizeRandomizer = (Math.random() - 0.5) * 4;
    }

    update() {
        if (this.isFoot) {
            this.updateFoot();
        } else {
            this.updateBody();
        }
    }

    updateBody() {
        const vX = (this.x - this.oldX) * (1.0 - damping);
        const vY = (this.y - this.oldY) * (1.0 - damping);
        this.oldX = this.x;
        this.oldY = this.y;
        this.x += vX + gravityX;
        this.y += vY + gravityY;
    }

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
                    this.x >= canvas.width - 1 ||
                    this.y <= 1 ||
                    this.y >= canvas.height - 1
                ) {
                    this.footState = FOOT_STATES.SETTLING;
                    this.settleStartTime = time;
                    this.targetPos.x = Math.max(0, Math.min(canvas.width, this.x));
                    this.targetPos.y = Math.max(0, Math.min(canvas.height, this.y));
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

    applyForce(fx, fy) {
        if (
            this.footState === FOOT_STATES.FIXED ||
            this.footState === FOOT_STATES.SETTLING
        )
            return;
        this.x += fx / this.mass;
        this.y += fy / this.mass;
    }

    getRandomEdgeTarget() {
        const edge = Math.floor(Math.random() * 4);
        switch (edge) {
            case 0:
                return { x: Math.random() * canvas.width, y: 0 };
            case 1:
                return { x: canvas.width, y: Math.random() * canvas.height };
            case 2:
                return { x: Math.random() * canvas.width, y: canvas.height };
            case 3:
                return { x: 0, y: Math.random() * canvas.height };
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
        for (let x = 0; x <= canvas.width; x += 50) {
            for (const p of [
                { x, y: 0 },
                { x, y: canvas.height },
            ]) {
                const d = Math.hypot(p.x - oppositeX, p.y - oppositeY);
                if (d < bestDist) {
                    bestDist = d;
                    bestPoint = p;
                }
            }
        }
        for (let y = 0; y <= canvas.height; y += 50) {
            for (const p of [
                { x: 0, y },
                { x: canvas.width, y },
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

    /**
     * @param {number} restFactor - The creature's current rest length factor.
     * @param {number} tendrilStiffness - The creature's tendril stiffness.
     */
    update(restFactor, tendrilStiffness) {
        const p1 = this.p1;
        const p2 = this.p2;
        const averagePulse = (p1.pulseMagnitude + p2.pulseMagnitude) * 0.5;
        const contraction = 1.0 - averagePulse * shiverIntensityFactor;
        const currentRestLength = this.baseRestLength * restFactor * contraction;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 0.0001) return; // dist < 0.01
        const dist = Math.sqrt(distSq);
        const stiffness = this.isHair ? tendrilStiffness : springStiffness;
        const scale = ((dist - currentRestLength) * stiffness) / dist;
        const fx = dx * scale;
        const fy = dy * scale;
        p1.applyForce(fx, fy);
        p2.applyForce(-fx, -fy);
    }
}

// =================================================================
//                     CORE SIMULATION & UTILS
// =================================================================

/**
 * Updates the physics and state of all creatures.
 */
function update() {
    time++;
    updateFadeLayers();
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
            updateAddButtonState();
            updateCurrentPointsDisplay();
            updateCreatureCountDisplay();
        }
    }
}

/**
 * Draws all creatures on the main canvas.
 */
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const creature of creatures) {
        creature.draw(ctx);
    }
}

/**
 * The main animation loop.
 */
function animate(currentTime = performance.now()) {
    frameCount++;
    const deltaTime = currentTime - lastFpsUpdateTime;
    if (deltaTime > 1000) {
        fps = Math.round((frameCount * 1000) / deltaTime);
        if (fpsCounterElement) {
            fpsCounterElement.textContent = fps;
        }
        frameCount = 0;
        lastFpsUpdateTime = currentTime;
    }

    if (resizePending) {
        resizePending = false;
        resizeCanvases();
    }

    // Fixed timestep: the simulation always advances at SIM_STEP_MS per step,
    // whatever the display refresh rate (60/120/144 Hz...).
    if (lastFrameTime === null) lastFrameTime = currentTime;
    stepAccumulator += Math.min(
        currentTime - lastFrameTime,
        SIM_STEP_MS * MAX_STEPS_PER_FRAME,
    );
    lastFrameTime = currentTime;
    // The tolerance absorbs rAF timestamp jitter on 60 Hz screens, which
    // would otherwise alternate between 0 and 2 steps per frame.
    while (stepAccumulator >= SIM_STEP_MS - STEP_TOLERANCE_MS) {
        update();
        stepAccumulator -= SIM_STEP_MS;
    }

    draw();
    drawGravityIndicator();

    requestAnimationFrame(animate);
}

/**
 * Resets the simulation.
 * @param {boolean} clearHistory - Whether to clear the background canvas.
 */
function init(clearHistory = true) {
    creatures = [];
    isInitializingFill = false;
    if (clearHistory) {
        resetHistory();
    }
    if (autoMode === 'top-up') {
        isInitializingFill = true;
        timeSinceLastAutoAdd = time;
    } else if (autoMode !== 'off') {
        addCreature();
    }
    updateAddButtonState();
    updateCurrentPointsDisplay();
    updateCreatureCountDisplay();
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
    const char = document.getElementById('letterInput').value || '+';
    creatures.push(new Creature(creatureShape, char));
    if (enablePointLimit && getCurrentTotalPoints() > maxPoints) {
        creatures.pop(); // Remove if it exceeded the limit
    }
    updateAddButtonState();
    updateCurrentPointsDisplay();
    updateCreatureCountDisplay();
}

/**
 * Queues a burst of creatures. With an origin ({x, y}), they are born around
 * it and pushed away from it; without one, each is born at a random place and
 * bursts outward from its own center.
 */
function triggerBurst(origin = null) {
    const steps = Math.round(burstSpreadSeconds * 60);
    const radius = Math.min(canvas.width, canvas.height) * 0.12;
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
            x = canvas.width * (0.1 + Math.random() * 0.8);
            y = canvas.height * (0.1 + Math.random() * 0.8);
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
    const char = document.getElementById('letterInput').value || '+';
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
    updateAddButtonState();
    updateCurrentPointsDisplay();
    updateCreatureCountDisplay();
}

// Bursts per visit, reported at these counts only (like the title presses).
const BURST_MILESTONES = [1, 5, 20];
let burstCount = 0;
function trackBurst(origin) {
    burstCount++;
    if (BURST_MILESTONES.includes(burstCount)) trackEvent('burst', { bursts: burstCount, origin });
}

/**
 * Clears the persistent background canvas.
 */
/**
 * The fade layer that takes new prints. Every fadeTime / (FADE_LAYERS - 1)
 * the oldest layer (faded out by then) is cleared and moved to the top.
 */
function currentFadeLayer() {
    const slot = (fadeTimeSeconds * 60) / (FADE_LAYERS - 1);
    let layer = fadeLayers[fadeLayers.length - 1];
    if (layer.hasInk && time - layer.born >= slot) {
        layer = fadeLayers.shift();
        clearFadeLayer(layer);
        canvas.before(layer.canvas); // top of the stack
        fadeLayers.push(layer);
    }
    if (!layer.hasInk) {
        layer.born = time;
        layer.hasInk = true;
        layer.canvas.style.display = ''; // shown only while it holds imprints
    }
    return layer;
}

/**
 * The CSS mix-blend-mode matching a canvas composite operation.
 */
function cssBlendMode(op) {
    if (op === 'source-over') return 'normal';
    if (op === 'lighter') return 'plus-lighter';
    return op; // multiply, screen, difference, overlay, color-burn, ...
}

// An empty layer is hidden: a full-screen layer, above all one with a blend
// mode, costs the browser compositing work on every frame even when empty.
function clearFadeLayer(layer) {
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.hasInk = false;
    layer.opacity = 1;
    layer.canvas.style.opacity = '';
    layer.canvas.style.display = 'none';
}

/**
 * Every step: each fade layer's opacity follows its age, from 1 when its
 * first print landed to 0 one fade time later, when it is cleared.
 */
function updateFadeLayers() {
    const life = fadeTimeSeconds * 60;
    const blend = blendFadeLayers ? cssBlendMode(imprintBlendMode) : 'normal';
    for (const layer of fadeLayers) {
        // Layers blend with what is under them (the permanent imprints and
        // older layers) the way prints blend within one canvas.
        if (layer.blend !== blend) {
            layer.blend = blend;
            layer.canvas.style.mixBlendMode = blend;
        }
        if (!layer.hasInk) continue;
        const opacity = Math.max(0, 1 - (time - layer.born) / life);
        if (opacity === 0) {
            clearFadeLayer(layer);
        } else if (Math.abs(opacity - layer.opacity) >= 0.001) {
            layer.opacity = opacity;
            layer.canvas.style.opacity = opacity.toFixed(4);
        }
    }
}

function resetHistory() {
    backgroundCtx.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
    fadeLayers.forEach(clearFadeLayer);
}

// =================================================================
//                 UI & CONTROL SETUP FUNCTIONS
// =================================================================

/**
 * Generic setup for a range slider.
 * @param {string} id - The slider's element ID.
 * @param {string} valueDisplayId - The ID of the element displaying the value.
 * @param {function} setter - The function to call with the new value.
 * @param {boolean} [isFloat=true] - Whether the value is a float.
 * @param {boolean} [requiresReset=false] - Whether changing the value should reset the simulation.
 */
function setupSlider(
    id,
    valueDisplayId,
    setter,
    isFloat = true,
    requiresReset = false,
) {
    const slider = document.getElementById(id);
    if (!slider) return;
    const display = document.getElementById(valueDisplayId);

    slider.addEventListener('input', (e) => {
        const value = isFloat
            ? parseFloat(e.target.value)
            : parseInt(e.target.value, 10);
        setter(value);

        if (display) {
            const precisionMap = {
                damping: 3,
                breathingRate: 3,
                pointSize: 2,
                maxLineThickness: 2,
                autoAddDelay: 2,
                gravity: 2,
                minShade: 2,
                shiverPropagation: 2,
                shiverEffect: 2,
                shiverDuration: 2,
                imprintShade: 2,
                waveDelay: 2,
                stepCooldown: 2,
                stepDuration: 1,
            };
            const precision = precisionMap[id] ?? 1;
            display.textContent = isFloat ? value.toFixed(precision) : value;
        }

        if (requiresReset) {
            init();
        }
    });
}

/**
 * Generic setup for a checkbox.
 * @param {string} id - The checkbox's element ID.
 * @param {function} setter - The function to call with the new boolean value.
 * @param {boolean} [requiresReset=false] - Whether changing the value should reset the simulation.
 * @param {HTMLElement[]} [dependentControls=[]] - An array of controls to show/hide based on the checkbox state.
 */
function setupCheckbox(
    id,
    setter,
    requiresReset = false,
    dependentControls = [],
) {
    const checkbox = document.getElementById(id);
    if (!checkbox) return;

    const updateDependents = (checked) => {
        for (const control of dependentControls) {
            if (control) {
                control.style.display = checked ? 'block' : 'none';
            }
        }
    };

    checkbox.addEventListener('change', (e) => {
        const checked = e.target.checked;
        setter(checked);
        updateDependents(checked);
        if (requiresReset) {
            init();
        }
    });

    updateDependents(checkbox.checked);
}

function setupShapeSelector() {
    const shapeSelect = document.getElementById('creatureShape');
    const densityLabel = document.getElementById('pointDensityLabel');
    const densityValueDisplay = document.getElementById('pointDensityValue');
    const densitySlider = document.getElementById('pointDensity');
    const letterInputControl = document.getElementById('letterInputContainer');
    const letterInput = document.getElementById('letterInput');

    const updateShapeControls = (event) => {
        creatureShape = event.target.value;
        if (creatureShape === 'grid') {
            letterInputControl.style.display = 'none';
            densityLabel.childNodes[0].nodeValue = 'Points per Side ';
            densitySlider.min = 3;
            densitySlider.max = 15;
            if (parseInt(densitySlider.value, 10) > 15) densitySlider.value = 15;
        } else if (creatureShape === 'letter') {
            letterInputControl.style.display = 'block';
            densityLabel.childNodes[0].nodeValue = 'Body Detail ';
            densitySlider.min = 2;
            densitySlider.max = 18;
        }
        densityValueDisplay.textContent = densitySlider.value;
        pointDensity = parseInt(densitySlider.value, 10);
    };
    shapeSelect.addEventListener('change', updateShapeControls);
    letterInput.addEventListener('input', () => {
        /* No-op, handled at creation */
    });
    updateShapeControls({ target: shapeSelect });
}

function setupGaitSelector() {
    const gaitSelect = document.getElementById('gaitPattern');
    const seekingFeetControl = document.getElementById('seekingFeetControl');
    const waveDelayControl = document.getElementById('waveDelayControl');

    const updateVisibility = () => {
        gaitPattern = gaitSelect.value;
        seekingFeetControl.style.display =
            gaitPattern === 'sequential' ? 'block' : 'none';
        waveDelayControl.style.display =
            gaitPattern === 'sidewinder' ? 'block' : 'none';
    };
    gaitSelect.addEventListener('change', updateVisibility);
    updateVisibility();
}

function setupTendrilControls() {
    setupSlider(
        'numTendrils',
        'numTendrilsValue',
        (val) => (numTendrils = val),
        false,
    );
    setupSlider(
        'tendrilLength',
        'tendrilLengthValue',
        (val) => (tendrilLength = val),
        false,
    );
    setupSlider(
        'tendrilQuality',
        'tendrilQualityValue',
        (val) => (tendrilQuality = val),
        true,
    );
    setupSlider(
        'tendrilStiffness',
        'tendrilStiffnessValue',
        (val) => (tendrilStiffness = val),
    );
    const variationSlider = document.getElementById('tendrilLengthVariation');
    const variationDisplay = document.getElementById(
        'tendrilLengthVariationValue',
    );
    variationSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        tendrilLengthVariation = value;
        variationDisplay.textContent = `${(100 * value).toFixed(0)}%`;
    });
    setupCheckbox('feetOnTendrils', (val) => (placeFeetOnTendrils = val));
    setupCheckbox('shiversOnTendrils', (val) => (shiversOnTendrils = val));
}

function setupAppearanceControls() {
    const drawModeSelect = document.getElementById('drawMode');
    const pointSizeControl = document.getElementById('pointSizeContainer');
    const letterChoiceControl = document.getElementById('letterChoiceContainer');
    const letterChoiceSelect = document.getElementById('letterChoice');

    const updateVisibility = () => {
        drawMode = drawModeSelect.value;
        pointSizeControl.style.display = drawMode === 'point' ? 'block' : 'none';
        letterChoiceControl.style.display =
            drawMode === 'letter' ? 'block' : 'none';
    };
    drawModeSelect.addEventListener('change', updateVisibility);
    letterChoiceSelect.addEventListener('change', (e) => {
        letterToDraw = e.target.value;
    });
    setupSlider(
        'pointSize',
        'pointSizeValue',
        (val) => (pointBaseSize = val),
        true,
    );
    updateVisibility();
}

function setupPercentageSlider(sliderId, displayId, setter) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (!slider || !display) return;
    slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        setter(value);
        display.textContent = `${(value * 100).toFixed(0)}%`;
    });
    display.textContent = `${(parseFloat(slider.value) * 100).toFixed(0)}%`;
}

// The top-right zone opens the settings panel; the panel's close button
// closes it. While the panel is open the zone lets clicks through.
function setupToggleControlsButton() {
    const toggleBtn = document.getElementById('toggleControlsBtn');
    const closeBtn = document.getElementById('closeControlsBtn');
    const controlsPanel = document.querySelector('.controls');
    if (!toggleBtn || !controlsPanel) return;
    const setOpen = (open) => {
        controlsPanel.classList.toggle('hidden', !open);
        toggleBtn.classList.toggle('is-visible', open);
        trackEvent(open ? 'controls-open' : 'controls-close');
    };
    toggleBtn.addEventListener('click', () => setOpen(true));
    closeBtn?.addEventListener('click', () => setOpen(false));
}

function setupPropagationSpeedControl() {
    const slider = document.getElementById('shiverPropagationSpeed');
    const display = document.getElementById('shiverPropagationSpeedValue');
    if (!slider) return;

    function updateSpeed(sliderValue) {
        const v = parseInt(sliderValue, 10);
        shiverPropagationSpeed = v >= 0 ? v + 1 : 1 / (Math.abs(v) + 1);
        if (display) display.textContent = shiverPropagationSpeed.toFixed(2);
    }
    slider.addEventListener('input', (e) => updateSpeed(e.target.value));
    updateSpeed(slider.value);
}

function setupRandomizeButtons() {
    const panelBtn = document.getElementById('randomizeBtn');
    if (panelBtn) {
        panelBtn.addEventListener('click', () => {
            trackEvent('randomize', { source: 'panel' });
            randomizeAndRespawn();
        });
    }
    const shortcutBtn = document.getElementById('randomizeShortcutBtn');
    if (shortcutBtn) {
        shortcutBtn.addEventListener('click', () => {
            trackEvent('randomize', { source: 'shortcut' });
            randomizeAndRespawn();
        });
    }
}

function setupBirthControls() {
    setupCheckbox(
        'enableProgressiveAppearance',
        (val) => {
            enableProgressiveAppearance = val;
        },
        false,
        [document.getElementById('progressiveAppearanceControls')],
    );
    setupSlider(
        'growthSpeed',
        'growthSpeedValue',
        (val) => {
            growthSpeed = val;
        },
        false,
    );
}

function setupAgingControls() {
    setupCheckbox(
        'enableAging',
        (val) => {
            enableAging = val;
        },
        false,
        [document.getElementById('agingControlsContainer')],
    );
    const modeSelect = document.getElementById('agingMode');
    const lifespanControl = document.getElementById('lifespanContainer');
    const maxStepsControl = document.getElementById('maxStepsContainer');

    const updateAgingControls = () => {
        agingMode = modeSelect.value;
        lifespanControl.style.display = agingMode === 'time' ? 'block' : 'none';
        maxStepsControl.style.display = agingMode === 'steps' ? 'block' : 'none';
    };
    modeSelect.addEventListener('change', updateAgingControls);
    document.getElementById('deathEffect').addEventListener('change', (e) => {
        deathEffect = e.target.value;
    });
    updateAgingControls();
}

function setupBreathingControls() {
    const restLengthSlider = document.getElementById('restLength');
    const breathingCheckbox = document.getElementById('enableBreathing');
    const breathingContainer = document.getElementById(
        'breathingControlsContainer',
    );

    const updateBreathingState = () => {
        enableBreathing = breathingCheckbox.checked;
        restLengthSlider.disabled = enableBreathing;
        breathingContainer.style.display = enableBreathing ? 'block' : 'none';
        if (!enableBreathing) {
            restLengthFactor = parseFloat(restLengthSlider.value);
        }
    };

    breathingCheckbox.addEventListener('change', updateBreathingState);
    setupSlider(
        'breathingRate',
        'breathingRateValue',
        (val) => {
            breathingRate = val;
        },
        true,
    );
    setupSlider(
        'breathingAmplitude',
        'breathingAmplitudeValue',
        (val) => {
            breathingAmplitude = val;
        },
        true,
    );
    setupSlider(
        'breathingOffset',
        'breathingOffsetValue',
        (val) => {
            breathingOffset = val;
        },
        true,
    );
    updateBreathingState();
}

function setupPopulationControls() {
    setupCheckbox(
        'enableCreatureLimit',
        (v) => {
            enableCreatureLimit = v;
            updateAddButtonState();
        },
        false,
        [document.getElementById('creatureLimitContainer')],
    );
    setupCheckbox(
        'enablePointLimit',
        (v) => {
            enablePointLimit = v;
            updateAddButtonState();
        },
        false,
        [document.getElementById('pointLimitContainer')],
    );
    document.getElementById('autoMode').addEventListener('change', (e) => {
        autoMode = e.target.value;
        init(false); // Re-initialize logic without clearing history
    });
}

function setupGravityControls() {
    const sourceSelector = document.getElementById('gravitySource');
    const gravityLabel = document.getElementById('gravityLabel');
    if (!sourceSelector || !gravityLabel) return;

    // Fixed mode: the slider sets the downward pull. Tilt mode: it scales
    // the pull from the device orientation (see handleOrientationEvent).
    setupSlider('gravity', 'gravityValue', (val) => {
        gravity = val;
        if (sourceSelector.value === 'fixed') {
            gravityX = 0;
            gravityY = gravity;
            debugGravityX.textContent = gravityX.toFixed(3);
            debugGravityY.textContent = gravityY.toFixed(3);
        }
    });

    sourceSelector.addEventListener('change', (e) => {
        window.removeEventListener('deviceorientation', handleOrientationEvent);
        const source = e.target.value;
        if (source === 'fixed') {
            gravityLabel.childNodes[0].nodeValue = 'Gravity Strength ';
            gravityX = 0;
            gravityY = gravity;
            debugStatus.textContent = 'Fixed (Slider)';
            debugGravityX.textContent = gravityX.toFixed(3);
            debugGravityY.textContent = gravityY.toFixed(3);
        } else if (source === 'orientation') {
            gravityLabel.childNodes[0].nodeValue = 'Gravity Sensitivity ';
            requestOrientationPermissions(sourceSelector);
        }
    });
}

// =================================================================
//                 EVENT HANDLERS & INTERACTIONS
// =================================================================

/**
 * Handles the device orientation event to update gravity.
 * @param {DeviceOrientationEvent} event
 */
function handleOrientationEvent(event) {
    if (event.beta === null || event.gamma === null) return;

    const beta = event.beta;
    const gamma = event.gamma;
    const DEG_TO_RAD = Math.PI / 180;
    const tiltX = Math.sin(gamma * DEG_TO_RAD) * gravity;
    const tiltY = Math.sin(beta * DEG_TO_RAD) * gravity;

    // Screen rotation: the deprecated window.orientation where it exists,
    // else screen.orientation.angle (270 is the same as -90).
    let rotation =
        typeof window.orientation === 'number'
            ? window.orientation
            : (screen.orientation && screen.orientation.angle) || 0;
    if (rotation === 270) rotation = -90;
    switch (rotation) {
        case 90:
            gravityX = tiltY;
            gravityY = -tiltX;
            break;
        case -90:
            gravityX = -tiltY;
            gravityY = tiltX;
            break;
        case 180:
            gravityX = -tiltX;
            gravityY = -tiltY;
            break;
        default:
            gravityX = tiltX;
            gravityY = tiltY;
            break;
    }
    debugGravityX.textContent = gravityX.toFixed(3);
    debugGravityY.textContent = gravityY.toFixed(3);
}

function requestOrientationPermissions(sourceSelector) {
    if (!window.isSecureContext) {
        alert('Orientation controls require a secure (HTTPS) connection.');
        debugStatus.textContent = 'Blocked: Insecure';
        if (sourceSelector) {
            sourceSelector.value = 'fixed';
            sourceSelector.dispatchEvent(new Event('change'));
        }
        return;
    }
    if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
        debugStatus.textContent = 'Requesting permission...';
        DeviceOrientationEvent.requestPermission()
            .then((permissionState) => {
                debugStatus.textContent = `Permission: ${permissionState}`;
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientationEvent);
                } else if (sourceSelector) {
                    sourceSelector.value = 'fixed';
                    sourceSelector.dispatchEvent(new Event('change'));
                }
            })
            .catch((err) => {
                debugStatus.textContent = `Error: ${err.message}`;
                console.error(err);
            });
    } else {
        debugStatus.textContent = 'Adding listener directly...';
        window.addEventListener('deviceorientation', handleOrientationEvent);
    }
}

function setDefaultGravitySource() {
    const isMobile = 'ontouchstart' in window;
    const orientationPermissionRequired =
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function';
    const selector = document.getElementById('gravitySource');

    if (isMobile && !orientationPermissionRequired) {
        debugStatus.textContent = 'Orientation sensor detected. Activating.';
        selector.value = 'orientation';
        selector.dispatchEvent(new Event('change'));
    } else if (isMobile && orientationPermissionRequired) {
        // iPhone and iPad: the motion permission can only be requested during
        // a tap, so tilt starts on the first tap anywhere. Until then, and if
        // the visitor refuses, gravity stays fixed.
        debugStatus.textContent = 'Tilt starts on the first tap.';
        selector.value = 'fixed';
        selector.dispatchEvent(new Event('change'));
        const askOnFirstTap = () => {
            document.removeEventListener('touchend', askOnFirstTap, true);
            document.removeEventListener('click', askOnFirstTap, true);
            if (selector.value === 'orientation') return;
            selector.value = 'orientation';
            selector.dispatchEvent(new Event('change')); // asks for permission
        };
        document.addEventListener('touchend', askOnFirstTap, true);
        document.addEventListener('click', askOnFirstTap, true);
    } else {
        const reason = orientationPermissionRequired
            ? 'needs permission'
            : 'desktop detected';
        debugStatus.textContent = `Orientation ${reason}. Defaulting to slider.`;
        selector.value = 'fixed';
        selector.dispatchEvent(new Event('change'));
    }
}

/**
 * Resizes both canvases to the window, keeping the existing imprints
 * (setting a canvas size wipes its content).
 */
function resizeCanvases() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width === w && canvas.height === h) return;
    const oldW = canvas.width;
    const oldH = canvas.height;
    canvas.width = w;
    canvas.height = h;
    // Both imprint layers keep their content through the resize.
    const layers = [[backgroundCanvas, backgroundCtx], ...fadeLayers.map((l) => [l.canvas, l.ctx])];
    for (const [layer, layerCtx] of layers) {
        // Setting a canvas dimension resets its bitmap, even to the same value.
        if (snapshotCanvas.width !== oldW || snapshotCanvas.height !== oldH) {
            snapshotCanvas.width = oldW;
            snapshotCanvas.height = oldH;
        } else {
            snapshotCtx.clearRect(0, 0, oldW, oldH);
        }
        snapshotCtx.drawImage(layer, 0, 0);
        layer.width = w;
        layer.height = h;
        layerCtx.drawImage(snapshotCanvas, 0, 0);
    }
    moveFeetWithEdges(oldW, oldH, w, h);
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

// The actual resize is applied at the start of animate(), right before
// the redraw: resizing in a separate callback could clear the canvas
// after the frame was drawn, which shows up as flicker.
function handleResize() {
    resizePending = true;
}

// Pressing the title crossfades it with its negative copy (CSS transitions,
// same duration both ways); release waits a moment so a quick tap still shows.
const TITLE_RESTORE_DELAY_MS = 120;
let titleRestoreTimeoutId = null;
let titleH1El = null;
let titleNegativeEl = null;

function fadeTitleOut() {
    if (!titleH1El) return;
    clearTimeout(titleRestoreTimeoutId);
    titleH1El.classList.add('is-pressed');
    titleNegativeEl?.classList.add('is-visible');
}

function restoreTitle() {
    if (!titleH1El || !titleH1El.classList.contains('is-pressed')) return;
    clearTimeout(titleRestoreTimeoutId);
    titleRestoreTimeoutId = setTimeout(() => {
        titleH1El.classList.remove('is-pressed');
        titleNegativeEl?.classList.remove('is-visible');
    }, TITLE_RESTORE_DELAY_MS);
}

// Auto print (double tap): a dot pulses under the negative title.
function setTitleLatched(on) {
    titleNegativeEl?.classList.toggle('is-latched', on);
}

function setupTitle() {
    titleNegativeEl = document.getElementById('title-negative');
    titleH1El = document.querySelector('#title-container h1');
}

/**
 * Sends a custom event to Umami analytics. Never throws: the script may
 * be blocked or not loaded yet (and is absent when opened locally).
 */
function trackEvent(name, data) {
    try {
        window.umami?.track(name, data);
    } catch (err) {
        // Analytics must never break the animation.
    }
}

/**
 * Tracks the first change of each setting in the controls panel, per
 * visit (one event per setting keeps the free event quota in check).
 * Programmatic changes (e.g. randomize) are ignored via isTrusted.
 */
function setupSettingsTracking() {
    const panel = document.querySelector('.controls');
    if (!panel) return;
    const trackedSettings = new Set();
    panel.addEventListener('change', (e) => {
        const id = e.target.id;
        // Changes from the ink color picker are dispatched by script.
        const fromUser = e.isTrusted || e.detail?.fromPicker;
        if (!fromUser || !id || trackedSettings.has(id)) return;
        trackedSettings.add(id);
        trackEvent('setting-changed', { setting: id });
    });
}

function setupInteractionHandlers() {
    document
        .getElementById('addCreatureBtn')
        ?.addEventListener('click', () => {
            trackEvent('add-creature', { source: 'button' });
            addCreature();
        });

    const titleH1 = document.querySelector('#title-container h1');
    if (titleH1) {
        const scheduleNextPrint = () => {
            if (continuousPrintTimeoutId === null) return;
            for (const creature of creatures) {
                if (!creature.isDead) creature.printToBackground();
            }
            // Random wait on a multiplying scale, so the range can go past
            // 100%: between base / (1 + v) and base * (1 + v), e.g. v = 3 gives
            // a quarter to four times the interval.
            const spread = Math.pow(1 + printIntervalRandomness, Math.random() * 2 - 1);
            // Floor of 8 ms: below one simulation step (~16.7 ms) prints repeat
            // the same pose, which only darkens it, so going lower adds nothing.
            const randomDelay = Math.max(8, printIntervalMs * spread);
            continuousPrintTimeoutId = setTimeout(scheduleNextPrint, randomDelay);
        };
        let pressStartTime = null;
        // Presses in this visit, reported at these counts only.
        const PRESS_MILESTONES = [1, 5, 20, 50];
        let pressCount = 0;
        let pressSeconds = 0;
        // A double tap (or double-click) keeps printing without holding; the
        // next single tap on the title stops it.
        const TAP_MAX_MS = 250; // a press shorter than this is a tap
        const DOUBLE_TAP_MS = 350; // max time between the two taps
        let latched = false;
        let latchCount = 0;
        let lastTapEnd = -Infinity;
        let ignoreRelease = false; // the release of the tap that unlatched
        const beginPrinting = () => {
            if (continuousPrintTimeoutId !== null) return;
            pressStartTime = performance.now();
            continuousPrintTimeoutId = 1; // Set a truthy value to start
            scheduleNextPrint();
        };
        const startPrinting = (e) => {
            e.preventDefault();
            if (latched) {
                latched = false;
                setTitleLatched(false);
                ignoreRelease = true;
                endPrinting();
                return;
            }
            fadeTitleOut();
            beginPrinting();
        };
        const stopPrinting = () => {
            if (ignoreRelease) {
                ignoreRelease = false;
                return;
            }
            if (latched) return; // keeps printing until the next tap
            if (pressStartTime !== null) {
                const now = performance.now();
                const isTap = now - pressStartTime < TAP_MAX_MS;
                if (isTap && now - lastTapEnd < DOUBLE_TAP_MS) {
                    latched = true;
                    setTitleLatched(true);
                    lastTapEnd = -Infinity;
                    latchCount++;
                    if (latchCount === 1) trackEvent('title-latch'); // once per visit
                    return;
                }
                if (isTap) lastTapEnd = now;
            }
            endPrinting();
        };
        const endPrinting = () => {
            restoreTitle();
            if (pressStartTime !== null) {
                pressCount++;
                pressSeconds += (performance.now() - pressStartTime) / 1000;
                pressStartTime = null;
                // One event per milestone, not per press: at most four per visit.
                if (PRESS_MILESTONES.includes(pressCount)) {
                    trackEvent('title-press-impress', {
                        presses: pressCount,
                        seconds: Math.round(pressSeconds * 10) / 10,
                    });
                }
            }
            if (continuousPrintTimeoutId !== null) {
                clearTimeout(continuousPrintTimeoutId);
                continuousPrintTimeoutId = null;
            }
        };
        titleH1.addEventListener('mousedown', startPrinting);
        titleH1.addEventListener('touchstart', startPrinting);
        window.addEventListener('mouseup', stopPrinting);
        window.addEventListener('touchend', stopPrinting);
        titleH1.addEventListener('mouseleave', stopPrinting);
    }

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.target.closest('input, select, button')) {
            e.preventDefault();
            trackEvent('add-creature', { source: 'space' });
            addCreature();
        } else if (e.code === 'KeyB' && !e.repeat && !e.target.closest('input, select, textarea')) {
            triggerBurst(); // random places
            trackBurst('key');
        }
    });

    // Long press on the paper (not the title, the zones or the panel): a
    // burst around the finger. A ring grows under the finger while pressing.
    const LONG_PRESS_MS = 550;
    const MOVE_TOLERANCE = 12;
    let press = null;
    const pressRing = document.createElement('div');
    pressRing.className = 'press-ring';
    document.body.appendChild(pressRing);
    const onPaper = (el) =>
        !el.closest('#title-container h1, button, a, input, select, label, .controls, .cp-card');
    const cancelPress = () => {
        if (!press) return;
        clearTimeout(press.timer);
        press = null;
        pressRing.classList.remove('is-pressing', 'is-burst');
    };
    document.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary || !onPaper(e.target)) return;
        cancelPress();
        const x = e.clientX;
        const y = e.clientY;
        pressRing.style.left = `${x}px`;
        pressRing.style.top = `${y}px`;
        pressRing.classList.remove('is-burst');
        void pressRing.offsetWidth; // restart the ring animation
        pressRing.classList.add('is-pressing');
        press = {
            x,
            y,
            timer: setTimeout(() => {
                triggerBurst({ x, y });
                trackBurst('press');
                pressRing.classList.remove('is-pressing');
                pressRing.classList.add('is-burst');
                press = null;
            }, LONG_PRESS_MS),
        };
    });
    document.addEventListener('pointermove', (e) => {
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
    });
    document.addEventListener('pointerup', cancelPress);
    document.addEventListener('pointercancel', cancelPress);
    // No context menu or text selection on a long press on the paper.
    document.addEventListener('contextmenu', (e) => {
        if (onPaper(e.target)) e.preventDefault();
    });

    document
        .getElementById('eraseBtn')
        ?.addEventListener('click', () => {
            trackEvent('erase');
            init(!keepImprintsOnReset);
        });

    // Bottom-left corner: opens a color picker for the print color. It starts
    // on the creature color; picking that color means "same as the creatures"
    // (creature and shiver colors), any other color prints in that color.
    // tour.js listens to 'printcolorchange' to flash the new color.
    // The picker (color-picker.js) opens in the corner with two dots: the
    // main color (creatures, and the prints follow it) and the shiver color.
    const isFrench = (navigator.language || '').toLowerCase().startsWith('fr');
    const LABELS = isFrench
        ? {
              main: "couleur des créatures et de l'impression",
              shiver: 'couleur du frisson',
              random: 'couleur aléatoire pour les nouvelles créatures',
          }
        : {
              main: 'creature and print color',
              shiver: 'shiver color',
              random: 'random color for new creatures',
          };
    document.getElementById('printColorBtn')?.addEventListener('click', () => {
        if (!window.openColorPicker) return;
        trackEvent('print-color-open');
        const corner = 24;
        const y = window.innerHeight - corner;
        window.openColorPicker(
            { left: corner, right: corner, top: y, bottom: y },
            {
                active: 'main',
                targets: () => [
                    { id: 'main', label: LABELS.main, color: creatureColor },
                    { id: 'shiver', label: LABELS.shiver, color: shiverColor },
                ],
                toggles: [
                    {
                        label: LABELS.random,
                        background:
                            'conic-gradient(#c8361f, #d98e04, #2e6b3f, #1f6f78, #1f2fb0, #6a2c70, #c8361f)',
                        active: () => randomCreatureColor,
                        onToggle: () => {
                            randomCreatureColor = !randomCreatureColor;
                            trackEvent('random-creature-color', { on: randomCreatureColor });
                        },
                    },
                ],
                onChange: (hex, target) => {
                    if (target === 'shiver') {
                        setShiverColor(hex);
                    } else {
                        setCreatureColor(hex);
                        if (!imprintMatchesCreature) setPrintColorSame();
                    }
                },
                onClose: (changed) => {
                    if (!changed) return;
                    trackEvent('print-color', { creature: creatureColor, shiver: shiverColor });
                    // Flash the resulting print color next to the corner.
                    document.dispatchEvent(
                        new CustomEvent('printcolorchange', {
                            detail: {
                                same: imprintMatchesCreature,
                                color: imprintMatchesCreature ? creatureColor : imprintColor,
                            },
                        }),
                    );
                },
            },
        );
    });

    // Middle of the right edge: keep creatures on screen, or let them leave.
    document.getElementById('keepOnScreenBtn')?.addEventListener('click', () => {
        setKeepOnScreen(!keepOnScreen);
        trackEvent('keep-on-screen', { on: keepOnScreen });
    });

    // Clears the printed imprints but keeps the creatures walking.
    document
        .getElementById('clearImprintsBtn')
        ?.addEventListener('click', () => {
            trackEvent('clear-imprints');
            resetHistory();
        });

    setupSettingsTracking();
}

function randomizeAndRespawn() {
    const rand = (min, max, isFloat = false) =>
        isFloat
            ? Math.random() * (max - min) + min
            : Math.floor(Math.random() * (max - min + 1)) + min;
    const updateSlider = (id, value) => {
        const s = document.getElementById(id);
        if (s) {
            s.value = value;
            s.dispatchEvent(new Event('input', { bubbles: true }));
        }
    };
    const updateCheckbox = (id, checked) => {
        const c = document.getElementById(id);
        if (c) {
            c.checked = checked;
            c.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };
    const updateSelect = (id, value) => {
        const s = document.getElementById(id);
        if (s) {
            s.value = value;
            s.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    const randomizeAll = () => {
        updateSlider('stiffness', rand(0.05, 0.3, true));
        updateSlider('damping', rand(0.05, 0.15, true));
        updateSlider('shiverIntensity', rand(-1.5, 1.5, true));
        updateSlider('shiverPropagation', rand(0.85, 1.0, true));
        updateSlider('shiverPropagationSpeed', rand(-10, 5));
        updateSlider('shiverDuration', rand(0.5, 1.0, true));
        updateSelect(
            'gaitPattern',
            ['sequential', 'paired', 'sidewinder'][rand(0, 2)],
        );
        updateSlider('numSeekingFeet', rand(1, 4));
        updateSlider('stepHeight', rand(20, 80));
        updateSlider('wobbleStrength', rand(10, 50));
        updateSlider('pointSize', rand(1.0, 3.0, true));
        updateSlider('pointSizeVariation', rand(0.0, 0.8, true));
        updateSlider('maxLineThickness', rand(1.0, 2.0, true));
        updateSlider('minShade', rand(0.0, 0.4, true));
        updateCheckbox('enableBreathing', Math.random() < 0.8);
        updateSlider('breathingRate', rand(0.002, 0.02, true));
        updateSlider('breathingAmplitude', rand(0.01, 0.2, true));
        updateSlider('breathingOffset', rand(0.8, 1.1, true));
        const shape = Math.random() < 0.5 ? 'grid' : 'letter';
        updateSelect('creatureShape', shape);
        if (shape === 'letter') {
            const chars = '+*#@$%&?';
            document.getElementById('letterInput').value = chars.charAt(
                rand(0, chars.length - 1),
            );
        }
        updateSlider('pointDensity', rand(5, 18));
        updateSlider('numFeet', rand(2, 12));
        updateSlider('restLength', rand(0.5, 1.2, true));
        updateCheckbox('enableTendrils', Math.random() < 0.6);
        updateSlider('numTendrils', rand(1, 5));
        // A grid creature standing on its tendrils sags to the floor when the
        // tendrils are long and soft (measured at gravity 0.17: length 3 needs
        // ~0.25 stiffness, 8 needs ~0.4, 15 needs ~0.6). So for grids on
        // tendrils, keep them shorter and stiff enough for their length.
        const feetOnTendrils = document.getElementById('feetOnTendrils')?.checked;
        if (shape === 'grid' && feetOnTendrils) {
            const length = rand(3, 12);
            const minStiffness = Math.min(0.5, 0.15 + 0.03 * length);
            updateSlider('tendrilLength', length);
            updateSlider('tendrilStiffness', rand(minStiffness, 0.5, true));
        } else {
            updateSlider('tendrilLength', rand(3, 20));
            updateSlider('tendrilStiffness', rand(0.01, 0.2, true));
        }
        const blendModes = [
            'source-over',
            'lighter',
            'multiply',
            'difference',
            'screen',
        ];
        updateSelect(
            'imprintBlendMode',
            blendModes[rand(0, blendModes.length - 1)],
        );
        updateSlider('printIntervalRandomness', rand(0.0, 2.0, true));
        updateSlider('imprintShadeVariation', rand(0.0, 0.6, true));
    };

    switch (randomizeMode) {
        case 'evolve':
            randomizeAll();
            break;
        case 'reset':
        default:
            randomizeAll();
            init(!keepImprintsOnReset);
            break;
    }
}

function handleCopyParameters() {
    const params = {
        creatureShape,
        pointDensity,
        numFeet,
        restLengthFactor,
        useRandomPlacement,
        damping,
        springStiffness,
        gravity,
        gravitySource: document.getElementById('gravitySource')?.value,
        shiverIntensityFactor,
        shiverPropagationFactor,
        shiverPropagationSpeed,
        shiverEffectMultiplier,
        shiverDurationFactor,
        numSeekingFeet,
        footCoordinationFactor,
        stepCooldown,
        stepDuration,
        stepHeight,
        wobbleStrength,
        targetAttraction,
        gaitPattern,
        waveDelay,
        enableTendrils,
        numTendrils,
        tendrilLength,
        tendrilStiffness,
        placeFeetOnTendrils,
        shiversOnTendrils,
        tendrilQuality,
        tendrilLengthVariation,
        drawMode,
        pointBaseSize,
        letterToDraw,
        maxLineThickness,
        minShade,
        pointSizeVariation,
        autoAddDelaySeconds,
        autoMode,
        enableBreathing,
        breathingRate,
        breathingAmplitude,
        breathingOffset,
        pruneUnfootedPoints,
        minPointsPerFoot,
        keepOnScreen,
        burstSize,
        burstSpreadSeconds,
        burstForce,
        darkPaper,
        enableProgressiveAppearance,
        growthSpeed,
        enableAging,
        agingMode,
        lifespanSeconds,
        maxFootsteps,
        deathEffect,
        enableCreatureLimit,
        maxCreatures,
        enablePointLimit,
        maxPoints,
        randomizeMode,
        letterInput: document.getElementById('letterInput').value,
        imprintShade,
        imprintBlendMode,
        imprintColor,
        usePerCreatureImprint,
        printIntervalMs,
        imprintMatchesCreature,
        printOnShiver,
        fadeImprints,
        fadeTimeSeconds,
        fadeAmount,
        blendFadeLayers,
        randomCreatureColor,
        creatureColor,
        shiverColor,
        printIntervalRandomness,
        imprintShadeVariation,
        shiverPropagationSpeedSlider: document.getElementById(
            'shiverPropagationSpeed',
        ).value,
    };
    const paramsString = JSON.stringify(params, null, 2);
    navigator.clipboard
        .writeText(paramsString)
        .then(() => {
            const btn = document.getElementById('copyParamsBtn');
            if (btn) {
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 1500);
            }
        })
        .catch((err) => {
            console.error('Failed to copy parameters: ', err);
        });
    console.log('Current Parameters:', params);
}

// --- Helper functions for updating UI displays ---
function getCurrentTotalPoints() {
    return creatures.reduce((sum, creature) => sum + creature.points.length, 0);
}
function updateCurrentPointsDisplay() {
    const d = document.getElementById('currentPointsValue');
    if (d) d.textContent = getCurrentTotalPoints();
}
function updateCreatureCountDisplay() {
    const d = document.getElementById('currentCreaturesValue');
    if (d) d.textContent = creatures.length;
}
function updateAddButtonState() {
    const b = document.getElementById('addCreatureBtn');
    if (b)
        b.disabled =
            (enableCreatureLimit && creatures.length >= maxCreatures) ||
            (enablePointLimit && getCurrentTotalPoints() >= maxPoints);
}
function updateOrientationDebug() {
    debugOrientation.textContent = window.orientation || 0;
}
function drawGravityIndicator() {
    if (!gravityIndicatorCtx) return;
    const gctx = gravityIndicatorCtx;
    const w = gctx.canvas.width;
    const h = gctx.canvas.height;
    gctx.clearRect(0, 0, w, h);
    const mag = Math.hypot(gravityX, gravityY);
    if (mag < 0.001) {
        gctx.fillStyle = '#b8b8b8';
        gctx.beginPath();
        gctx.arc(w / 2, h / 2, 2, 0, Math.PI * 2);
        gctx.fill();
        return;
    }
    gctx.save();
    const cX = w / 2;
    const cY = h / 2;
    // Arrow length proportional to the strength, full length at the
    // slider's maximum; the head scales down so short arrows keep a line.
    const maxLen = (w / 2) * 0.8;
    const maxG = parseFloat(document.getElementById('gravity')?.max) || 0.5;
    const normX = gravityX / mag;
    const normY = gravityY / mag;
    const len = Math.min(1, mag / maxG) * maxLen;
    const endX = cX + normX * len;
    const endY = cY + normY * len;
    const hL = Math.min(8, len * 0.4);
    const ang = Math.atan2(endY - cY, endX - cX);
    gctx.strokeStyle = '#000000';
    gctx.fillStyle = '#000000';
    gctx.lineWidth = 2;
    gctx.beginPath();
    gctx.moveTo(cX, cY);
    gctx.lineTo(endX, endY);
    gctx.stroke();
    gctx.beginPath();
    gctx.moveTo(endX, endY);
    gctx.lineTo(
        endX - hL * Math.cos(ang - Math.PI / 6),
        endY - hL * Math.sin(ang - Math.PI / 6),
    );
    gctx.lineTo(
        endX - hL * Math.cos(ang + Math.PI / 6),
        endY - hL * Math.sin(ang + Math.PI / 6),
    );
    gctx.closePath();
    gctx.fill();
    gctx.restore();
}

// =================================================================
//                       INITIALIZATION
// =================================================================

/**
 * Main setup function to initialize all controls and start the simulation.
 */
function runSetup() {
    // Motion Physics
    setupSlider('stiffness', 'stiffnessValue', (val) => (springStiffness = val));
    setupSlider('damping', 'dampingValue', (val) => (damping = val), true);
    setupSlider(
        'shiverIntensity',
        'shiverIntensityValue',
        (val) => (shiverIntensityFactor = val),
    );
    setupSlider(
        'shiverEffect',
        'shiverEffectValue',
        (val) => (shiverEffectMultiplier = val),
        true,
    );
    setupSlider(
        'shiverPropagation',
        'shiverPropagationValue',
        (val) => (shiverPropagationFactor = val),
        true,
    );
    setupPropagationSpeedControl();
    setupSlider(
        'shiverDuration',
        'shiverDurationValue',
        (val) => (shiverDurationFactor = val),
        true,
    );

    // Foot Behavior
    setupSlider(
        'footCoordination',
        'footCoordinationValue',
        (val) => (footCoordinationFactor = val),
    );
    setupSlider(
        'targetAttraction',
        'targetAttractionValue',
        (val) => (targetAttraction = val),
    );
    setupSlider(
        'stepCooldown',
        'stepCooldownValue',
        (val) => (stepCooldown = Math.round(val * 60)), // shown in s, kept in steps
        true,
    );
    setupSlider(
        'stepDuration',
        'stepDurationValue',
        (val) => (stepDuration = Math.round(val * 60)), // shown in s, kept in steps
        true,
    );
    setupSlider(
        'stepHeight',
        'stepHeightValue',
        (val) => (stepHeight = val),
        false,
    );
    setupSlider(
        'wobbleStrength',
        'wobbleStrengthValue',
        (val) => (wobbleStrength = val),
        false,
    );
    setupSlider(
        'numSeekingFeet',
        'numSeekingFeetValue',
        (val) => (numSeekingFeet = val),
        false,
    );
    // Shown in seconds, kept in simulation steps (60 per second).
    setupSlider('waveDelay', 'waveDelayValue', (val) => (waveDelay = Math.round(val * 60)), true);
    setupGaitSelector();

    // Structure
    setupSlider(
        'pointDensity',
        'pointDensityValue',
        (val) => (pointDensity = val),
        false,
    );
    setupSlider('numFeet', 'numFeetValue', (val) => (numFeet = val), false);
    setupSlider(
        'restLength',
        'restLengthValue',
        (val) => (restLengthFactor = val),
    );
    setupCheckbox('randomPlacement', (val) => (useRandomPlacement = val));
    setupCheckbox('pruneUnfooted', (val) => (pruneUnfootedPoints = val), false, [
        document.getElementById('pruneThresholdContainer'),
    ]);
    setupSlider(
        'minPointsPerFoot',
        'minPointsPerFootValue',
        (val) => (minPointsPerFoot = val),
        false,
    );

    // Population
    setupSlider(
        'maxCreatures',
        'maxCreaturesValue',
        (val) => {
            maxCreatures = val;
            updateAddButtonState();
        },
        false,
    );
    setupSlider(
        'maxPoints',
        'maxPointsValue',
        (val) => {
            maxPoints = val;
            updateAddButtonState();
        },
        false,
    );
    setupSlider(
        'autoAddDelay',
        'autoAddDelayValue',
        (val) => (autoAddDelaySeconds = val),
        true,
    );
    document
        .getElementById('randomizeModeSelect')
        .addEventListener('change', (e) => (randomizeMode = e.target.value));

    // Appearance & Printing
    setupSlider(
        'maxLineThickness',
        'maxLineThicknessValue',
        (val) => (maxLineThickness = val),
        true,
    );
    setupSlider('minShade', 'minShadeValue', (val) => (minShade = val), true);
    setupSlider(
        'imprintShade',
        'imprintShadeValue',
        (val) => (imprintShade = val),
        true,
    );
    setupSlider(
        'printInterval',
        'printIntervalValue',
        (val) => (printIntervalMs = val),
        false,
    );
    document
        .getElementById('imprintBlendMode')
        .addEventListener('change', (e) => (imprintBlendMode = e.target.value));
    const setupColor = (id, setter) => {
        document.getElementById(id)?.addEventListener('input', (e) => {
            setter(e.target.value);
            document.getElementById(`${id}Value`).textContent = e.target.value;
        });
    };
    setupColor('imprintColor', (v) => (imprintColor = v));
    setupCheckbox('imprintMatchesCreatureCheck', (val) => {
        imprintMatchesCreature = val;
        syncPrintColorControls();
    });
    // Browsers can restore a checkbox state from the last visit on reload;
    // show the real setting instead.
    syncPrintColorControls();
    setupColor('creatureColor', (v) => {
        creatureColor = v;
        creatureRgb = hexToRgb(v);
    });
    setupColor('shiverColor', (v) => {
        shiverColor = v;
        shiverRgb = hexToRgb(v);
    });
    setupCheckbox(
        'perCreatureImprintCheck',
        (val) => (usePerCreatureImprint = val),
    );
    setupCheckbox('printOnShiverCheck', (val) => (printOnShiver = val));
    setupCheckbox('keepOnScreenCheck', (val) => setKeepOnScreen(val));
    setupSlider('burstSize', 'burstSizeValue', (val) => (burstSize = val), false);
    setupSlider('burstSpread', 'burstSpreadValue', (val) => (burstSpreadSeconds = val), true);
    setupSlider('burstForce', 'burstForceValue', (val) => (burstForce = val), true);
    // Dark paper, also from the address (?dark), e.g. for projection tests.
    const darkCheck = document.getElementById('darkPaperCheck');
    const setDarkPaper = (on) => {
        darkPaper = on;
        document.documentElement.classList.toggle('dark-paper', on);
        if (darkCheck) darkCheck.checked = on;
    };
    setupCheckbox('darkPaperCheck', setDarkPaper);
    if (new URLSearchParams(location.search).has('dark')) setDarkPaper(true);
    setupCheckbox('fadeImprintsCheck', (val) => (fadeImprints = val), false, [
        document.getElementById('fadeTimeContainer'),
    ]);
    setupSlider('fadeTime', 'fadeTimeValue', (val) => (fadeTimeSeconds = val), false);
    setupSlider('fadeAmount', 'fadeAmountValue', (val) => (fadeAmount = val / 100), false);
    setupCheckbox('blendFadeLayersCheck', (val) => (blendFadeLayers = val));

    // Birth & Death
    setupSlider(
        'lifespan',
        'lifespanValue',
        (val) => (lifespanSeconds = val),
        false,
    );
    setupSlider(
        'maxSteps',
        'maxStepsValue',
        (val) => (maxFootsteps = val),
        false,
    );

    // Tendrils
    setupCheckbox('enableTendrils', (val) => (enableTendrils = val), false, [
        document.getElementById('tendrilControlsContainer'),
    ]);
    setupTendrilControls();

    // Setup complex controls
    setupShapeSelector();
    setupAppearanceControls();
    setupBreathingControls();
    setupBirthControls();
    setupAgingControls();
    setupPopulationControls();
    setupGravityControls();
    setupPercentageSlider(
        'pointSizeVariation',
        'pointSizeVariationValue',
        (val) => (pointSizeVariation = val),
    );
    setupPercentageSlider(
        'imprintShadeVariation',
        'imprintShadeVariationValue',
        (val) => (imprintShadeVariation = val),
    );
    setupPercentageSlider(
        'printIntervalRandomness',
        'printIntervalRandomnessValue',
        (val) => (printIntervalRandomness = val),
    );

    // Setup buttons and event handlers
    setupToggleControlsButton();
    setupInteractionHandlers();
    setupRandomizeButtons();
    document
        .getElementById('copyParamsBtn')
        ?.addEventListener('click', () => {
            trackEvent('copy-params');
            handleCopyParameters();
        });
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', updateOrientationDebug);

    // Initial state setup
    resizeCanvases();
    init(true);
    setupTitle();
    updateOrientationDebug();
    setDefaultGravitySource();

    // Start the loop!
    requestAnimationFrame(animate);
}

// --- Let's go! ---
runSetup();

