// Ink color picker: a square color field (hue across, white to black down)
// and one intensity thread, no text. Replaces the native picker of every
// color input in the settings panel. sim.js also opens it from the print
// color corner (window.openColorPicker) with several targets (creature,
// shiver, print), shown as small dots next to the thread.
(function () {
    const isFrench = (navigator.language || '').toLowerCase().startsWith('fr');
    const T = isFrench
        ? { dialog: 'Choisir une couleur', intensity: 'Intensité' }
        : { dialog: 'Choose a color', intensity: 'Intensity' };

    const FIELD = 168; // px, square
    const DEFAULT_SATURATION = 0.75;

    // ---------- Color math ----------
    function hexToHsl(hex) {
        const n = parseInt(hex.slice(1), 16);
        const r = ((n >> 16) & 255) / 255;
        const g = ((n >> 8) & 255) / 255;
        const b = (n & 255) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        if (max === min) return { h: 0, s: 0, l };
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h;
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        return { h: h * 60, s, l };
    }

    function hslToRgb(h, s, l) {
        const k = (n) => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return [f(0), f(8), f(4)];
    }

    function hslToHex(h, s, l) {
        return `#${hslToRgb(h, s, l)
            .map((x) => Math.round(x * 255).toString(16).padStart(2, '0'))
            .join('')}`;
    }

    // ---------- Card ----------
    const card = document.createElement('div');
    card.className = 'cp-card';
    card.hidden = true;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', T.dialog);
    card.innerHTML = `
        <div class="cp-targets" hidden></div>
        <div class="cp-field" tabindex="0" role="application" aria-label="${T.dialog}">
            <canvas width="${FIELD * 2}" height="${FIELD * 2}"></canvas>
            <span class="cp-marker"></span>
        </div>
        <input type="range" class="cp-range cp-sat" min="0" max="1" step="0.01" aria-label="${T.intensity}" />`;
    document.body.appendChild(card);

    const field = card.querySelector('.cp-field');
    const canvas = field.querySelector('canvas');
    const marker = field.querySelector('.cp-marker');
    const targetBox = card.querySelector('.cp-targets');
    const satInput = card.querySelector('.cp-sat');

    // The field at a given intensity, at twice the size for sharp screens.
    let drawnSaturation = null;
    function drawField(s) {
        const q = Math.round(s * 100) / 100;
        if (q === drawnSaturation) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        drawnSaturation = q;
        const size = canvas.width;
        const img = ctx.createImageData(size, size);
        for (let x = 0; x < size; x++) {
            const h = (x / (size - 1)) * 360;
            for (let y = 0; y < size; y++) {
                const [r, g, b] = hslToRgb(h, q, 1 - y / (size - 1));
                const i = (y * size + x) * 4;
                img.data[i] = r * 255;
                img.data[i + 1] = g * 255;
                img.data[i + 2] = b * 255;
                img.data[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    // ---------- State ----------
    // { opts, active, value, hsl, changed }
    //   opts.targets(): [{ id, label, color, split? }] (optional)
    //   opts.onChange(hex, targetId), opts.onReselect(targetId), opts.onClose(changed)
    let session = null;

    function renderTargets() {
        const { opts, active } = session;
        targetBox.hidden = !opts.targets;
        if (!opts.targets) return;
        targetBox.innerHTML = '';
        for (const t of opts.targets()) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cp-target';
            b.title = t.label;
            b.setAttribute('aria-label', t.label);
            b.setAttribute('aria-pressed', String(t.id === active));
            b.classList.toggle('is-selected', t.id === active);
            const dot = document.createElement('span');
            dot.className = 'cp-target-dot';
            dot.style.background = t.split
                ? `linear-gradient(135deg, ${t.split[0]} 0 50%, ${t.split[1]} 50% 100%)`
                : t.color;
            b.appendChild(dot);
            b.addEventListener('click', () => selectTarget(t.id));
            targetBox.appendChild(b);
        }
    }

    function render() {
        const { value, hsl } = session;
        // A grey or black color has no intensity: show the field in color
        // anyway, so there is always something to pick from.
        drawField(hsl.s < 0.05 ? DEFAULT_SATURATION : hsl.s);
        // Kept inside the field at the edges (the marker is 10px wide).
        marker.style.left = `calc(5px + (100% - 10px) * ${hsl.h / 360})`;
        marker.style.top = `calc(5px + (100% - 10px) * ${1 - hsl.l})`;
        marker.style.background = value;
        satInput.value = String(hsl.s);
        satInput.style.setProperty(
            '--track',
            `linear-gradient(to right, ${hslToHex(hsl.h, 0, 0.5)}, ${hslToHex(hsl.h, 1, 0.5)})`,
        );
        renderTargets();
    }

    function load(value) {
        session.value = value;
        session.hsl = hexToHsl(value);
        render();
    }

    // Clicking another dot edits that color; clicking the selected one again
    // lets the caller act on it (the print dot relinks to the creatures).
    function selectTarget(id) {
        if (id === session.active) {
            if (session.opts.onReselect) {
                session.opts.onReselect(id);
                session.changed = true;
                renderTargets();
            }
            return;
        }
        session.active = id;
        const t = session.opts.targets().find((x) => x.id === id);
        load(t.color);
    }

    function apply() {
        const { h, s, l } = session.hsl;
        session.value = hslToHex(h, s, l);
        session.changed = true;
        session.opts.onChange(session.value, session.active);
        render();
    }

    // Field: click or drag.
    function pickAt(clientX, clientY) {
        const r = field.getBoundingClientRect();
        const x = Math.min(Math.max(clientX - r.left, 0), r.width);
        const y = Math.min(Math.max(clientY - r.top, 0), r.height);
        session.hsl.h = (x / r.width) * 360;
        session.hsl.l = 1 - y / r.height;
        // A hue picked on a grey field would not show: bring intensity back.
        if (session.hsl.s < 0.05) session.hsl.s = DEFAULT_SATURATION;
        apply();
    }
    field.addEventListener('pointerdown', (e) => {
        if (!session) return;
        e.preventDefault();
        field.focus();
        field.setPointerCapture(e.pointerId);
        pickAt(e.clientX, e.clientY);
    });
    field.addEventListener('pointermove', (e) => {
        if (session && field.hasPointerCapture(e.pointerId)) pickAt(e.clientX, e.clientY);
    });

    // Keyboard: left/right for the hue, up/down toward white/black.
    field.addEventListener('keydown', (e) => {
        if (!session) return; // closed by the same key press (Escape, Enter)
        const step = e.shiftKey ? 10 : 2;
        const hsl = session.hsl;
        if (e.key === 'ArrowLeft') hsl.h = (hsl.h - step + 360) % 360;
        else if (e.key === 'ArrowRight') hsl.h = (hsl.h + step) % 360;
        else if (e.key === 'ArrowUp') hsl.l = Math.min(1, hsl.l + step / 100);
        else if (e.key === 'ArrowDown') hsl.l = Math.max(0, hsl.l - step / 100);
        else return;
        e.preventDefault();
        apply();
    });

    satInput.addEventListener('input', () => {
        if (!session) return;
        session.hsl.s = Number(satInput.value);
        apply();
    });

    // ---------- Open / close ----------
    // anchor: a DOMRect-like {left, top, right, bottom}; the card opens below
    // it, or above when there is no room, and stays inside the window.
    function openColorPicker(anchor, opts) {
        if (session) closeColorPicker();
        session = { opts, active: opts.active || null, changed: false };
        const start = opts.targets
            ? opts.targets().find((t) => t.id === session.active).color
            : opts.value;
        card.hidden = false;
        load(start);

        const margin = 8;
        const w = card.offsetWidth;
        const hgt = card.offsetHeight;
        const left = Math.min(Math.max(margin, anchor.left), window.innerWidth - w - margin);
        let top = anchor.bottom + margin;
        if (top + hgt > window.innerHeight - margin) top = Math.max(margin, anchor.top - hgt - margin);
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;

        setTimeout(() => {
            document.addEventListener('pointerdown', onOutside, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
        // No automatic focus: it would draw the keyboard focus ring around the
        // field on every open. Tab reaches it; Escape and Enter close the card.
    }

    function closeColorPicker() {
        if (!session) return;
        const { opts, changed } = session;
        session = null;
        card.hidden = true;
        document.removeEventListener('pointerdown', onOutside, true);
        document.removeEventListener('keydown', onKey, true);
        if (opts.onClose) opts.onClose(changed);
    }

    function onOutside(e) {
        if (!card.contains(e.target)) closeColorPicker();
    }

    function onKey(e) {
        if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault();
            closeColorPicker();
        }
    }

    window.openColorPicker = openColorPicker;

    // ---------- Settings panel inputs ----------
    // The native <input type="color"> keeps the value and the existing
    // listeners in sim.js; only its picker is replaced.
    document.querySelectorAll('.controls input[type="color"]').forEach((input) => {
        input.addEventListener('click', (e) => {
            e.preventDefault();
            if (input.disabled) return;
            const detail = { fromPicker: true };
            openColorPicker(input.getBoundingClientRect(), {
                value: input.value,
                onChange: (hex) => {
                    input.value = hex;
                    input.dispatchEvent(new CustomEvent('input', { bubbles: true, detail }));
                },
                onClose: (changed) => {
                    if (changed) input.dispatchEvent(new CustomEvent('change', { bubbles: true, detail }));
                },
            });
        });
    });
})();
