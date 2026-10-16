// Ink color picker: a tint thread (hue) and a square for that tint
// (intensity across, light to dark down), no text. Replaces the native picker
// of every color input in the settings panel. sim.js also opens it from the
// print color corner (window.openColorPicker) with several targets (creature,
// shiver), shown as small dots above the square.
(function () {
    const isFrench = (navigator.language || '').toLowerCase().startsWith('fr');
    const T = isFrench
        ? { dialog: 'Choisir une couleur', tint: 'Teinte' }
        : { dialog: 'Choose a color', tint: 'Tint' };

    const FIELD = 168; // px, square
    const AUTO_HIDE_MS = 6000; // closes after this long without interaction

    // ---------- Color math (HSV: hue, saturation, value) ----------
    function hexToHsv(hex) {
        const n = parseInt(hex.slice(1), 16);
        const r = ((n >> 16) & 255) / 255;
        const g = ((n >> 8) & 255) / 255;
        const b = (n & 255) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d > 0) {
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
        }
        return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
    }

    function hsvToHex(h, s, v) {
        const f = (n) => {
            const k = (n + h / 60) % 6;
            return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
        };
        return `#${[f(5), f(3), f(1)]
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
        <input type="range" class="cp-range cp-hue" min="0" max="360" step="1" aria-label="${T.tint}" />`;
    document.body.appendChild(card);

    const field = card.querySelector('.cp-field');
    const canvas = field.querySelector('canvas');
    const marker = field.querySelector('.cp-marker');
    const targetBox = card.querySelector('.cp-targets');
    const hueInput = card.querySelector('.cp-hue');

    // The square for one tint: white at the top left, the pure tint at the
    // top right, black along the bottom. Two gradients over a flat color.
    let drawnHue = null;
    function drawField(h) {
        const q = Math.round(h);
        if (q === drawnHue) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        drawnHue = q;
        const size = canvas.width;
        ctx.fillStyle = hsvToHex(q, 1, 1);
        ctx.fillRect(0, 0, size, size);
        const white = ctx.createLinearGradient(0, 0, size, 0);
        white.addColorStop(0, '#ffffff');
        white.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = white;
        ctx.fillRect(0, 0, size, size);
        const black = ctx.createLinearGradient(0, 0, 0, size);
        black.addColorStop(0, 'rgba(0, 0, 0, 0)');
        black.addColorStop(1, '#000000');
        ctx.fillStyle = black;
        ctx.fillRect(0, 0, size, size);
    }

    // ---------- State ----------
    // { opts, active, value, hsv, changed }
    //   opts.targets(): [{ id, label, color, split? }] (optional)
    //   opts.toggles: [{ label, background, active(), onToggle() }] (optional),
    //     on/off dots shown after the targets
    //   opts.onChange(hex, targetId), opts.onReselect(targetId), opts.onClose(changed)
    let session = null;

    function renderTargets() {
        const { opts, active } = session;
        targetBox.hidden = !opts.targets && !opts.toggles;
        if (targetBox.hidden) return;
        targetBox.innerHTML = '';
        for (const t of opts.targets ? opts.targets() : []) {
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
        for (const t of opts.toggles || []) {
            const on = t.active();
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cp-target cp-toggle';
            b.title = t.label;
            b.setAttribute('aria-label', t.label);
            b.setAttribute('aria-pressed', String(on));
            b.classList.toggle('is-selected', on);
            const dot = document.createElement('span');
            dot.className = 'cp-target-dot';
            dot.style.background = t.background;
            b.appendChild(dot);
            b.addEventListener('click', () => {
                t.onToggle();
                session.changed = true;
                renderTargets();
            });
            targetBox.appendChild(b);
        }
    }

    function render() {
        const { value, hsv } = session;
        drawField(hsv.h);
        // Kept inside the field at the edges (the marker is 10px wide).
        marker.style.left = `calc(5px + (100% - 10px) * ${hsv.s})`;
        marker.style.top = `calc(5px + (100% - 10px) * ${1 - hsv.v})`;
        marker.style.background = value;
        hueInput.value = String(Math.round(hsv.h));
        renderTargets();
    }

    function load(value) {
        const hsv = hexToHsv(value);
        // A grey has no tint of its own: keep the tint already on the thread.
        if (hsv.s === 0 && session.hsv) hsv.h = session.hsv.h;
        session.value = value;
        session.hsv = hsv;
        render();
    }

    // Clicking another dot edits that color; clicking the selected one again
    // lets the caller act on it.
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
        const { h, s, v } = session.hsv;
        session.value = hsvToHex(h, s, v);
        session.changed = true;
        session.opts.onChange(session.value, session.active);
        render();
    }

    // Square: click or drag picks intensity (across) and lightness (down).
    function pickAt(clientX, clientY) {
        const r = field.getBoundingClientRect();
        session.hsv.s = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
        session.hsv.v = 1 - Math.min(Math.max((clientY - r.top) / r.height, 0), 1);
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

    // Keyboard on the square: left/right for intensity, up/down for lightness.
    field.addEventListener('keydown', (e) => {
        if (!session) return; // closed by the same key press (Escape, Enter)
        const step = e.shiftKey ? 0.1 : 0.02;
        const hsv = session.hsv;
        if (e.key === 'ArrowLeft') hsv.s = Math.max(0, hsv.s - step);
        else if (e.key === 'ArrowRight') hsv.s = Math.min(1, hsv.s + step);
        else if (e.key === 'ArrowUp') hsv.v = Math.min(1, hsv.v + step);
        else if (e.key === 'ArrowDown') hsv.v = Math.max(0, hsv.v - step);
        else return;
        e.preventDefault();
        apply();
    });

    // Tint thread. A tint chosen on a grey or black would not show: give the
    // color some intensity and light so the new tint is visible.
    hueInput.addEventListener('input', () => {
        if (!session) return;
        const hsv = session.hsv;
        hsv.h = Number(hueInput.value);
        if (hsv.s < 0.05) hsv.s = 0.8;
        if (hsv.v < 0.05) hsv.v = 0.8;
        apply();
    });

    // ---------- Open / close ----------
    // anchor: a DOMRect-like {left, top, right, bottom}; the card opens below
    // it, or above when there is no room, and stays inside the window.
    // Auto-hide: any interaction inside the card restarts the countdown; it
    // never closes in the middle of a drag.
    let hideTimer = null;
    let dragging = false;
    function restartHideTimer() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (dragging) restartHideTimer();
            else closeColorPicker();
        }, AUTO_HIDE_MS);
    }
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel']) {
        card.addEventListener(type, () => session && restartHideTimer(), { passive: true });
    }
    card.addEventListener('pointerdown', () => (dragging = true));
    window.addEventListener('pointerup', () => (dragging = false));
    window.addEventListener('pointercancel', () => (dragging = false));

    function openColorPicker(anchor, opts) {
        if (session) closeColorPicker();
        session = { opts, active: opts.active || null, changed: false, hsv: null };
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
        restartHideTimer();
    }

    function closeColorPicker() {
        clearTimeout(hideTimer);
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
