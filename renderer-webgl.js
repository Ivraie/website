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
    // kind 0 = line from a to b with a width; kind 1 = disc at a with a radius.
    let prog, uViewport, vao, instBuf;
    function setupGL() {
        const vs = `#version 300 es
        layout(location=0) in vec2 corner;   // x: 0..1 along, y: -1..1 across
        layout(location=1) in vec4 ab;       // ax, ay, bx, by
        layout(location=2) in vec2 sizeKind; // width or radius, kind
        layout(location=3) in vec4 color;    // straight rgba
        uniform vec2 viewport;
        out vec2 vLocal; out float vHalf; out float vKind; out vec4 vColor;
        void main() {
            vec2 p;
            if (sizeKind.y < 0.5) {
                vec2 a = ab.xy, b = ab.zw;
                vec2 dir = b - a; float len = length(dir);
                dir = len > 0.0 ? dir / len : vec2(1.0, 0.0);
                vec2 n = vec2(-dir.y, dir.x);
                float half_ = sizeKind.x * 0.5 + 0.5; // + antialiasing margin
                p = mix(a, b, corner.x) + n * corner.y * half_;
                vLocal = vec2(0.0, corner.y * half_);
                vHalf = sizeKind.x * 0.5;
            } else {
                float r = sizeKind.x + 1.0;
                vec2 off = vec2(corner.x * 2.0 - 1.0, corner.y) * r;
                p = ab.xy + off;
                vLocal = off;
                vHalf = sizeKind.x;
            }
            vKind = sizeKind.y; vColor = color;
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
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, bytes, 24);
        gl.vertexAttribDivisor(3, 1);
    }

    // ---------- Instances, filled from the creatures each frame ----------
    const STRIDE = 10; // ax ay bx by size kind r g b a
    let data = new Float32Array(STRIDE * 20000);
    let n = 0;
    function push(ax, ay, bx, by, size, kind, c) {
        if ((n + 1) * STRIDE > data.length) {
            const bigger = new Float32Array(data.length * 2);
            bigger.set(data);
            data = bigger;
        }
        const o = n * STRIDE;
        data[o] = ax;
        data[o + 1] = ay;
        data[o + 2] = bx;
        data[o + 3] = by;
        data[o + 4] = size;
        data[o + 5] = kind;
        data[o + 6] = c[0];
        data[o + 7] = c[1];
        data[o + 8] = c[2];
        data[o + 9] = c[3];
        n++;
    }
    // Lines thinner than 1px: 1px wide with proportional alpha, which is how
    // Canvas 2D renders hairlines.
    function pushLine(a, b, width, c) {
        if (width < 1) push(a.x, a.y, b.x, b.y, 1, 0, [c[0], c[1], c[2], c[3] * width]);
        else push(a.x, a.y, b.x, b.y, width, 0, c);
    }
    // Numeric twin of liveInk() in sim.js.
    function ink(base, restLightness, intensity, alpha) {
        const mix = (c, s) => {
            const rest = c + (255 - c) * restLightness;
            return Math.round(rest + (s - rest) * intensity) / 255;
        };
        return [mix(base.r, shiverRgb.r), mix(base.g, shiverRgb.g), mix(base.b, shiverRgb.b), alpha];
    }

    const springB = Array.from({ length: SHADE_STEPS + 1 }, () => []);
    const pointB = Array.from({ length: SHADE_STEPS + 1 }, () => []);
    const radiusB = Array.from({ length: SHADE_STEPS + 1 }, () => []);
    const feet = [];

    function fillInstances() {
        n = 0;
        for (const c of creatures) {
            let fadeAlpha = 1;
            if (c.isDead && deathEffect === 'fade') {
                fadeAlpha = Math.max(0, 1 - (time - c.deathTime) / FADE_DURATION);
                if (fadeAlpha <= 0.01) continue;
            }
            const base = c.inkRgb || creatureRgb;
            for (let k = 0; k <= SHADE_STEPS; k++) {
                springB[k].length = 0;
                pointB[k].length = 0;
                radiusB[k].length = 0;
            }
            feet.length = 0;
            const tendrilColor = ink(base, 0, 0, 0.5 * fadeAlpha);
            for (const s of c.springs) {
                if (time < s.p1.birthTime || time < s.p2.birthTime) continue;
                if (s.isHair) {
                    pushLine(s.p1, s.p2, 1, tendrilColor);
                    continue;
                }
                const pulse = (s.p1.pulseMagnitude + s.p2.pulseMagnitude) / 2;
                const shade = Math.min(1, Math.max(minShade, pulse * shiverEffectMultiplier));
                springB[Math.floor(shade * SHADE_STEPS)].push(s);
            }
            for (const p of c.points) {
                if (p.isHair || time < p.birthTime) continue;
                if (p.isFoot) {
                    feet.push(p);
                    continue;
                }
                const pulse = p.pulseMagnitude;
                const shade = Math.min(1, Math.max(minShade, pulse * shiverEffectMultiplier));
                const swell = 1 + pulse * shiverEffectMultiplier * POINT_SHIVER_SWELL;
                const variation = 1 + p.sizeRandomizer * pointSizeVariation;
                const r = Math.min(MAX_POINT_RADIUS, Math.max(0.1, pointBaseSize * swell * variation));
                const k = Math.floor(shade * SHADE_STEPS);
                pointB[k].push(p);
                radiusB[k].push(r);
            }
            const baseLineWidth = Math.max(0.2, 2.8 - c.points.length / 25);
            for (let k = 0; k <= SHADE_STEPS; k++) {
                if (springB[k].length === 0) continue;
                const si = k / SHADE_STEPS;
                const width = Math.min(baseLineWidth + si * (baseLineWidth * 3.5), maxLineThickness);
                const color = ink(base, 80 / 255, si, fadeAlpha);
                for (const s of springB[k]) pushLine(s.p1, s.p2, width, color);
            }
            for (let k = 0; k <= SHADE_STEPS; k++) {
                if (pointB[k].length === 0) continue;
                const color = ink(base, 180 / 255, k / SHADE_STEPS, fadeAlpha);
                for (let i = 0; i < pointB[k].length; i++) {
                    const p = pointB[k][i];
                    push(p.x, p.y, 0, 0, radiusB[k][i], 1, color);
                }
            }
            if (feet.length) {
                const color = ink(base, 0, 0, fadeAlpha);
                const footRadius = pointBaseSize + 2;
                for (const p of feet) push(p.x, p.y, 0, 0, footRadius, 1, color);
            }
        }
        state.instances = n;
    }

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
