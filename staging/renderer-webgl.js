// WebGL2 renderer for the live drawing (the creatures; imprints stay on their
// canvases). Draws the same image as Creature.draw in point mode: per
// creature, tendrils, springs by shade, dots by shade, then feet, with the
// same colors and widths, but in ONE instanced draw call per frame.
// Measured on an AMD Radeon 780M at 1080p: 60 fps up to ~40,000 points,
// where Canvas 2D drops to 36 fps at 8,000 and 18 fps at 15,000.
// Switch with the Renderer setting or the G key; falls back to Canvas 2D
// without WebGL2, in letter mode, or if the GPU context is lost.
// Loaded after sim.js, whose draw() it wraps.
(function () {
    const select = document.getElementById('rendererMode');
    const nameEl = document.getElementById('rendererName');

    const glCanvas = document.createElement('canvas');
    glCanvas.id = 'gl-canvas';
    canvas.after(glCanvas); // same place in the stack as the 2D canvas
    const gl = glCanvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true });

    const state = { available: !!gl, mode: gl ? 'webgl' : 'canvas', instances: 0 };
    window.ivraieRenderer = state;

    // ---------- GPU program: one quad per instance ----------
    // Each instance: a, b, size and a color code. The code is a slot in the
    // palette texture (block * 64 + slot): slots 0..21 are lines (0 tendrils,
    // 1..21 springs by shade), 22..43 discs (22..42 dots by shade, 43 feet).
    // A line has a width, a disc a radius.
    let prog, uViewport, uPalette, vao, instBuf, paletteTex;
    function setupGL() {
        const vs = `#version 300 es
        layout(location=0) in vec2 corner;   // x: 0..1 along, y: -1..1 across
        layout(location=1) in vec4 ab;       // ax, ay, bx, by
        layout(location=2) in vec2 sizeCode; // width or radius, color code
        uniform vec2 viewport;
        uniform highp sampler2D palette;     // straight rgba per slot, a row per block
        out vec2 vLocal; out float vHalf; out float vKind; out vec4 vColor;
        void main() {
            int code = int(sizeCode.y + 0.5);
            int slot = code & 63;
            vec4 color = texelFetch(palette, ivec2(slot, code >> 6), 0);
            vec2 p;
            if (slot < 22) {
                // Lines thinner than 1px: 1px wide with proportional alpha,
                // which is how Canvas 2D renders hairlines.
                float width = max(sizeCode.x, 1.0);
                color.a *= min(sizeCode.x, 1.0);
                vec2 a = ab.xy, b = ab.zw;
                vec2 dir = b - a; float len = length(dir);
                dir = len > 0.0 ? dir / len : vec2(1.0, 0.0);
                vec2 n = vec2(-dir.y, dir.x);
                float half_ = width * 0.5 + 0.5; // + antialiasing margin
                p = mix(a, b, corner.x) + n * corner.y * half_;
                vLocal = vec2(0.0, corner.y * half_);
                vHalf = width * 0.5;
                vKind = 0.0;
            } else {
                float r = sizeCode.x + 1.0;
                vec2 off = vec2(corner.x * 2.0 - 1.0, corner.y) * r;
                p = ab.xy + off;
                vLocal = off;
                vHalf = sizeCode.x;
                vKind = 1.0;
            }
            vColor = color;
            vec2 clip = p / viewport * 2.0 - 1.0;
            gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        }`;
        const fs = `#version 300 es
        precision highp float;
        in vec2 vLocal; in float vHalf; in float vKind; in vec4 vColor;
        out vec4 outColor;
        void main() {
            float d = vKind < 0.5 ? abs(vLocal.y) : length(vLocal);
            float a = vColor.a * clamp(vHalf + 0.5 - d, 0.0, 1.0); // soft edge
            if (a <= 0.0) discard;
            outColor = vec4(vColor.rgb * a, a); // premultiplied
        }`;
        const compile = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        uViewport = gl.getUniformLocation(prog, 'viewport');
        uPalette = gl.getUniformLocation(prog, 'palette');

        vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        instBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
        const bytes = STRIDE * 4;
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, bytes, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, bytes, 16);
        gl.vertexAttribDivisor(2, 1);

        paletteTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, paletteTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    // ---------- Instances, filled from the creatures each frame ----------
    // Order per creature: tendrils, springs by shade (lightest first), dots
    // by shade, feet; within a shade, in creature order. Written straight
    // into one Float32Array; shades are sorted by counting into reused
    // typed arrays. Colors go in the palette: a block of slots per creature
    // color and fade, shared by the creatures that have the same.
    const STRIDE = 6; // ax ay bx by size code
    let data = new Float32Array(STRIDE * 40000);
    let n = 0;
    const NONE = 255; // not drawn in a shade (unborn, tendril, foot...)
    const SHADES = SHADE_STEPS + 1;
    let keys = new Uint8Array(4096); // shade of each spring or point
    let order = new Int32Array(4096); // indices sorted by shade
    let radii = new Float64Array(4096); // dot radius of each point
    const counts = new Int32Array(SHADES);
    const starts = new Int32Array(SHADES);
    const SLOTS = 44; // per block: 0 tendril, 1..21 springs, 22..42 dots, 43 feet
    const SLOT_SPRING = 1;
    const SLOT_DOT = 22;
    const SLOT_FOOT = 43;
    let palette = new Float32Array(SLOTS * 4 * 8);
    let blocks = 0;
    const blockOf = new Map(); // 'r,g,b,fade' -> block, for this frame

    function reserve(instances, items) {
        if ((n + instances) * STRIDE > data.length) {
            const bigger = new Float32Array(Math.max(data.length * 2, (n + instances) * STRIDE));
            bigger.set(data.subarray(0, n * STRIDE));
            data = bigger;
        }
        if (items > keys.length) {
            const size = Math.max(items, keys.length * 2);
            keys = new Uint8Array(size);
            order = new Int32Array(size);
            radii = new Float64Array(size);
        }
    }
    // Numeric twin of liveInk() in sim.js, into a palette slot.
    function ink(o, base, restLightness, intensity, alpha) {
        const mix = (c, s) => {
            const rest = c + (255 - c) * restLightness;
            return Math.round(rest + (s - rest) * intensity) / 255;
        };
        palette[o] = mix(base.r, shiverRgb.r);
        palette[o + 1] = mix(base.g, shiverRgb.g);
        palette[o + 2] = mix(base.b, shiverRgb.b);
        palette[o + 3] = alpha;
    }
    // The palette block for a creature color and fade, made on first use.
    function paletteBlock(base, fadeAlpha) {
        const key = `${base.r},${base.g},${base.b},${fadeAlpha}`;
        let block = blockOf.get(key);
        if (block !== undefined) return block;
        block = blocks++;
        blockOf.set(key, block);
        if (blocks * SLOTS * 4 > palette.length) {
            const bigger = new Float32Array(palette.length * 2);
            bigger.set(palette);
            palette = bigger;
        }
        const o = block * SLOTS * 4;
        ink(o, base, 0, 0, 0.5 * fadeAlpha);
        for (let k = 0; k < SHADES; k++) {
            ink(o + (SLOT_SPRING + k) * 4, base, 80 / 255, k / SHADE_STEPS, fadeAlpha);
            ink(o + (SLOT_DOT + k) * 4, base, 180 / 255, k / SHADE_STEPS, fadeAlpha);
        }
        ink(o + SLOT_FOOT * 4, base, 0, 0, fadeAlpha);
        return block;
    }
    // Groups the indices with a shade (keys[0..count)) by shade, keeping
    // their order: order[starts[k] .. starts[k] + counts[k]).
    function sortByShade(count) {
        let at = 0;
        for (let k = 0; k < SHADES; k++) {
            starts[k] = at;
            at += counts[k];
        }
        for (let i = 0; i < count; i++) {
            const k = keys[i];
            if (k !== NONE) order[starts[k]++] = i;
        }
        for (let k = 0; k < SHADES; k++) starts[k] -= counts[k];
    }
    // One instance: a line (a to b, width) or a disc (at a, radius).
    function put(ax, ay, bx, by, size, code) {
        const o = n * STRIDE;
        data[o] = ax;
        data[o + 1] = ay;
        data[o + 2] = bx;
        data[o + 3] = by;
        data[o + 4] = size;
        data[o + 5] = code;
        n++;
    }

    function fillInstances() {
        n = 0;
        blocks = 0;
        blockOf.clear();
        for (const c of creatures) {
            let fadeAlpha = 1;
            if (c.isDead && deathEffect === 'fade') {
                fadeAlpha = Math.max(0, 1 - (time - c.deathTime) / FADE_DURATION);
                if (fadeAlpha <= 0.01) continue;
            }
            const base = c.inkRgb || creatureRgb;
            // The creature's flat arrays (see Creature.packArrays).
            const { x: X, y: Y, pulse: P } = c.store;
            const { springA: A, springB: B, springIsHair, pointBirth: BIRTH, isHairFlags, isFootFlags, pointSizeRandom } = c;
            const m = A.length;
            const count = X.length;
            reserve(m + count, Math.max(m, count));
            const code = paletteBlock(base, fadeAlpha) * 64;

            // Springs: tendrils now, the others by shade.
            counts.fill(0);
            for (let k = 0; k < m; k++) {
                const a = A[k];
                const b = B[k];
                if (time < BIRTH[a] || time < BIRTH[b]) {
                    keys[k] = NONE;
                } else if (springIsHair[k]) {
                    keys[k] = NONE;
                    put(X[a], Y[a], X[b], Y[b], 1, code);
                } else {
                    const pulse = (P[a] + P[b]) / 2;
                    const shade = Math.min(1, Math.max(minShade, pulse * shiverEffectMultiplier));
                    const key = Math.floor(shade * SHADE_STEPS);
                    keys[k] = key;
                    counts[key]++;
                }
            }
            sortByShade(m);
            const baseLineWidth = Math.max(0.2, 2.8 - count / 25);
            for (let k = 0; k < SHADES; k++) {
                if (counts[k] === 0) continue;
                const si = k / SHADE_STEPS;
                const width = Math.min(baseLineWidth + si * (baseLineWidth * 3.5), maxLineThickness);
                const slot = code + SLOT_SPRING + k;
                for (let j = starts[k], end = j + counts[k]; j < end; j++) {
                    const s = order[j];
                    put(X[A[s]], Y[A[s]], X[B[s]], Y[B[s]], width, slot);
                }
            }

            // Dots by shade (none at Point Size 0), then the feet.
            counts.fill(0);
            let feet = 0;
            for (let i = 0; i < count; i++) {
                keys[i] = NONE;
                if (isHairFlags[i] || time < BIRTH[i]) continue;
                if (isFootFlags[i]) {
                    feet++;
                    continue;
                }
                if (pointBaseSize <= 0) continue;
                const pulse = P[i];
                const shade = Math.min(1, Math.max(minShade, pulse * shiverEffectMultiplier));
                const swell = 1 + pulse * shiverEffectMultiplier * POINT_SHIVER_SWELL;
                const variation = 1 + pointSizeRandom[i] * pointSizeVariation;
                radii[i] = Math.min(MAX_POINT_RADIUS, Math.max(0.1, pointBaseSize * swell * variation));
                const key = Math.floor(shade * SHADE_STEPS);
                keys[i] = key;
                counts[key]++;
            }
            sortByShade(count);
            for (let k = 0; k < SHADES; k++) {
                if (counts[k] === 0) continue;
                const slot = code + SLOT_DOT + k;
                for (let j = starts[k], end = j + counts[k]; j < end; j++) {
                    const i = order[j];
                    put(X[i], Y[i], 0, 0, radii[i], slot);
                }
            }
            if (feet > 0) {
                const footRadius = pointBaseSize + 2;
                const slot = code + SLOT_FOOT;
                for (let i = 0; i < count; i++) {
                    if (isFootFlags[i] && !isHairFlags[i] && time >= BIRTH[i]) put(X[i], Y[i], 0, 0, footRadius, slot);
                }
            }
        }
        state.instances = n;
    }

    // Tests: the instance data of the last frame, and the filling alone.
    state.instanceData = () => data.slice(0, n * STRIDE);
    state.fillInstances = fillInstances;

    function renderGL() {
        if (glCanvas.width !== canvas.width || glCanvas.height !== canvas.height) {
            glCanvas.width = canvas.width;
            glCanvas.height = canvas.height;
        }
        fillInstances();
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(prog);
        gl.uniform2f(uViewport, glCanvas.width, glCanvas.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, paletteTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, SLOTS, Math.max(blocks, 1), 0, gl.RGBA, gl.FLOAT, palette.subarray(0, Math.max(blocks, 1) * SLOTS * 4));
        gl.uniform1i(uPalette, 0);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * STRIDE), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }

    // ---------- Switching ----------
    let showing = null; // which canvas is visible
    function show(which) {
        if (showing === which) return;
        showing = which;
        canvas.style.visibility = which === 'canvas' ? '' : 'hidden';
        glCanvas.style.visibility = which === 'webgl' ? '' : 'hidden';
        if (which === 'webgl') ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function updateLabel() {
        if (nameEl) nameEl.textContent = state.mode === 'webgl' ? ' · WebGL' : ' · Canvas';
        if (select) select.value = state.mode;
    }

    state.setMode = (mode) => {
        state.mode = mode === 'webgl' && state.available ? 'webgl' : 'canvas';
        updateLabel();
    };

    const canvasDraw = draw;
    draw = () => {
        // Letter mode draws text, which only Canvas 2D does.
        if (state.mode === 'webgl' && drawMode === 'point') {
            show('webgl');
            renderGL();
        } else {
            show('canvas');
            canvasDraw();
        }
    };

    if (gl) {
        try {
            setupGL();
        } catch (err) {
            console.error('WebGL renderer unavailable:', err);
            state.available = false;
            state.mode = 'canvas';
        }
        // If the GPU drops the context (driver reset, too many tabs), fall back.
        glCanvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            state.available = false;
            state.setMode('canvas');
        });
    }
    if (select) {
        if (!state.available) select.querySelector('option[value="webgl"]').disabled = true;
        select.addEventListener('change', (e) => state.setMode(e.target.value));
    }
    document.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyG' || e.repeat || e.target.closest?.('input, select, textarea')) return;
        state.setMode(state.mode === 'webgl' ? 'canvas' : 'webgl');
    });
    updateLabel();
})();
