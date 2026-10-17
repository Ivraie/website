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
let frameCount = 0;
let lastFpsUpdateTime = 0;
let fps = 0;
let continuousPrintTimeoutId = null;

// --- Constants ---
const SIM_STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 4;
const STEP_TOLERANCE_MS = 1;
let lastFrameTime = null;
let stepAccumulator = 0;
let resizePending = false;
const snapshotCanvas = document.createElement('canvas');
const snapshotCtx = snapshotCanvas.getContext('2d');


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
    if (!on) releaseFloorFeet();
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

// =================================================================
//                     DRAWING & STEPS
// =================================================================

/**
 * Draws one creature from its arrays: live on the main canvas, or as an
 * imprint. (Creature itself is in sim-core.js.)
 */
Creature.prototype.draw = function (targetCtx, isImprint = false, currentImprintShade = 0.2, imprintRgb = hexToRgb(imprintColor)) {
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
    // Batches hold indices: of springs (into springA/B) or of points.
    const { x: X, y: Y, pulse: P } = this.store;
    const { springA: A, springB: B, springIsHair, pointBirth: BIRTH } = this;
    for (let k = 0, m = A.length; k < m; k++) {
        const a = A[k];
        const b = B[k];
        if (time < BIRTH[a] || time < BIRTH[b]) continue;
        if (springIsHair[k]) {
            tendrilBatch.push(k);
            continue;
        }
        const baseIntensity = (P[a] + P[b]) / 2;
        const shadeIntensity = Math.min(
            1.0,
            Math.max(minShade, baseIntensity * shiverEffectMultiplier),
        );
        springBatches[Math.floor(shadeIntensity * SHADE_STEPS)].push(k);
    }
    const { isFootFlags, isHairFlags, pointSizeRandom } = this;
    for (let i = 0, n = this.store.x.length; i < n; i++) {
        if (isHairFlags[i] || time < BIRTH[i]) continue;
        if (isFootFlags[i]) {
            footBatch.push(i);
        } else {
            const baseIntensity = P[i];
            const shadeIntensity = Math.min(
                1.0,
                Math.max(minShade, baseIntensity * shiverEffectMultiplier),
            );
            const radiusMultiplier =
                1 + baseIntensity * shiverEffectMultiplier * POINT_SHIVER_SWELL;
            const variation = 1.0 + pointSizeRandom[i] * pointSizeVariation;
            if (drawMode === 'point') {
                if (pointBaseSize <= 0) continue; // Point Size 0: no dots
                const finalRadius = Math.min(
                    MAX_POINT_RADIUS,
                    Math.max(0.1, baseBodyRadius * radiusMultiplier * variation),
                );
                const k = Math.floor(shadeIntensity * SHADE_STEPS);
                pointBatches[k].push(i);
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
                letterBatches.get(styleKey).push(i);
            }
        }
    }
    if (tendrilBatch.length > 0) {
        targetCtx.strokeStyle = isImprint
            ? imprintFill(20 / 255, 0, 20 / 255, currentImprintShade * 0.75)
            : liveInk(0, 0, 0.5 * fadeAlpha);
        targetCtx.lineWidth = 1;
        targetCtx.beginPath();
        for (const k of tendrilBatch) {
            targetCtx.moveTo(X[A[k]], Y[A[k]]);
            targetCtx.lineTo(X[B[k]], Y[B[k]]);
        }
        targetCtx.stroke();
    }
    const baseLineWidth = Math.max(0.2, 2.8 - this.store.x.length / 25);
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
        for (const k of springsInBatch) {
            targetCtx.moveTo(X[A[k]], Y[A[k]]);
            targetCtx.lineTo(X[B[k]], Y[B[k]]);
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
            targetCtx.moveTo(X[p] + r, Y[p]);
            targetCtx.arc(X[p], Y[p], r, 0, Math.PI * 2);
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
        for (const i of pointsInBatch) {
            targetCtx.fillText(letterToDraw, X[i], Y[i]);
        }
    });
    if (footBatch.length > 0) {
        targetCtx.fillStyle = isImprint
            ? imprintFill(20 / 255, 0, 20 / 255, currentImprintShade)
            : liveInk(0, 0, fadeAlpha);
        targetCtx.beginPath();
        for (const i of footBatch) {
            targetCtx.moveTo(X[i] + baseFootRadius, Y[i]);
            targetCtx.arc(X[i], Y[i], baseFootRadius, 0, Math.PI * 2);
        }
        targetCtx.fill();
    }
};

/**
 * Stamps a creature on the imprints (see Creature.printToBackground).
 */
function stampPrint(creature, shadeToUse, blendModeToUse, colorToUse) {
    const rgb = hexToRgb(colorToUse);
    const stamp = (targetCtx, shade) => {
        targetCtx.save();
        targetCtx.globalCompositeOperation = blendModeToUse;
        creature.draw(targetCtx, true, shade, rgb);
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

simHooks.tick = () => updateFadeLayers();
simHooks.print = stampPrint;
simHooks.populationChanged = () => {
    updateAddButtonState();
    updateCurrentPointsDisplay();
    updateCreatureCountDisplay();
};

/**
 * One step: the page reads the Letter Shape input, then the simulation steps.
 */
function update() {
    newCreatureChar = document.getElementById('letterInput').value || '+';
    simStep();
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
    resetCreatures();
    if (clearHistory) {
        resetHistory();
    }
    startCreatures();
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
    simSize.width = w;
    simSize.height = h;
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
            const center = { x: canvas.width / 2, y: canvas.height / 2 };
            triggerBurst(burstKeyOrigin === 'center' ? center : null);
            trackBurst(burstKeyOrigin === 'center' ? 'key-center' : 'key');
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

    // Hidden zones never take focus: a focused zone would show an outline and
    // turn the next Space press into a click on it.
    document.querySelectorAll('.hidden-zone').forEach((zone) => {
        zone.addEventListener('mousedown', (e) => e.preventDefault());
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
        updateSlider('pointSize', rand(0.3, 2.0, true));
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
        burstKeyOrigin,
        renderer: window.ivraieRenderer?.mode,
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
    document
        .getElementById('burstKeyOrigin')
        ?.addEventListener('change', (e) => (burstKeyOrigin = e.target.value));
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

