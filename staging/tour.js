// Helps visitors find the hidden interactions: a short guided tour on the
// first visit (replayable with the "?" button), and small hints that appear
// when the mouse comes near a hidden button. Drawn like the creatures: an ink
// dot on the target, a grey thread, a short label. French if the browser is.
(function () {
    // No tour, hints or "?" button in show mode (show-mode.js).
    if (document.documentElement.classList.contains('show-mode')) return;
    const isFrench = (navigator.language || '').toLowerCase().startsWith('fr');
    const isTouch = window.matchMedia('(hover: none)').matches;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const TEXT = isFrench
        ? {
              title: isTouch ? 'restez appuyé pour imprimer' : 'maintenez pour imprimer',
              titleSub: isTouch
                  ? 'double tap : imprimer sans tenir'
                  : 'double-clic : imprimer sans tenir · espace : ajouter une créature',
              randomize: isTouch ? 'touchez pour tout changer' : 'cliquez pour tout changer',
              erase: isTouch ? 'touchez pour tout recommencer' : 'cliquez pour tout recommencer',
              cueRandomize: 'tout changer',
              cueErase: 'recommencer',
              clear: isTouch ? 'touchez pour effacer les empreintes' : 'cliquez pour effacer les empreintes',
              cueClear: 'effacer les empreintes',
              keep: isTouch ? "touchez pour garder les créatures dans l'écran" : "cliquez pour garder les créatures dans l'écran",
              cueKeep: "créatures dans l'écran",
              keepState: (on) => `créatures dans l'écran : ${on ? 'oui' : 'non'}`,
              print: isTouch ? 'touchez pour choisir les couleurs' : 'cliquez pour choisir les couleurs',
              cuePrint: 'couleurs',
              printState: (same, color) => `couleur d'impression : ${same ? 'comme les créatures' : color}`,
              titleHint: 'maintenez pour imprimer',
              help: 'Revoir la visite',
          }
        : {
              title: isTouch ? 'touch and hold to print' : 'hold to print',
              titleSub: isTouch
                  ? 'double tap: keep printing'
                  : 'double-click: keep printing · space: add a creature',
              randomize: isTouch ? 'tap to randomize' : 'click to randomize',
              erase: isTouch ? 'tap to start over' : 'click to start over',
              cueRandomize: 'randomize',
              cueErase: 'start over',
              clear: isTouch ? 'tap to clear the imprints' : 'click to clear the imprints',
              cueClear: 'clear the imprints',
              keep: isTouch ? 'tap to keep the creatures on screen' : 'click to keep the creatures on screen',
              cueKeep: 'keep on screen',
              keepState: (on) => `creatures stay on screen: ${on ? 'on' : 'off'}`,
              print: isTouch ? 'tap to choose the colors' : 'click to choose the colors',
              cuePrint: 'colors',
              printState: (same, color) => `print color: ${same ? 'same as the creatures' : color}`,
              titleHint: 'hold to print',
              help: 'Replay the tour',
          };

    const STORAGE_KEY = 'ivraie-tour-seen';
    const START_DELAY_MS = 1500;
    const STEP_MS = 2800;
    const FADE_MS = 400;

    const title = document.querySelector('#title-container h1');
    const randomizeBtn = document.getElementById('randomizeShortcutBtn');
    const eraseBtn = document.getElementById('eraseBtn');
    const clearBtn = document.getElementById('clearImprintsBtn');
    const printBtn = document.getElementById('printColorBtn');
    const keepBtn = document.getElementById('keepOnScreenBtn');
    if (!title || !randomizeBtn || !eraseBtn || !clearBtn || !printBtn) return;

    const track = (name, data) => {
        if (typeof trackEvent === 'function') trackEvent(name, data);
    };
    const center = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
    };

    // Hint anchors for the hidden zones: near the screen edge, not in the
    // middle of the (large) zone, so the dot shows where the zone starts.
    const EDGE = 36;
    const anchor = {
        randomize: () => { const r = randomizeBtn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + EDGE }; },
        erase: () => { const r = eraseBtn.getBoundingClientRect(); return { x: r.left + EDGE, y: r.top + EDGE }; },
        clear: () => { const r = clearBtn.getBoundingClientRect(); return { x: r.left + EDGE, y: r.top + r.height / 2 }; },
        print: () => { const r = printBtn.getBoundingClientRect(); return { x: r.left + EDGE, y: r.bottom - EDGE }; },
        keep: () => { const r = keepBtn.getBoundingClientRect(); return { x: r.right - EDGE, y: r.top + r.height / 2 }; },
    };
    // Distance from a point to a zone (0 inside it).
    const distanceToZone = (el, px, py) => {
        const r = el.getBoundingClientRect();
        const dx = Math.max(r.left - px, 0, px - r.right);
        const dy = Math.max(r.top - py, 0, py - r.bottom);
        return Math.hypot(dx, dy);
    };

    // Where the title's letters end: an empty inline-block sits on the text
    // baseline, so its position is measured rather than guessed from the font.
    const TITLE_HINT_GAP = 10;
    const baselineProbe = document.createElement('span');
    baselineProbe.setAttribute('aria-hidden', 'true');
    baselineProbe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    title.appendChild(baselineProbe);
    const titleBaseline = () => baselineProbe.getBoundingClientRect().top;
    const updateTitleHint = () => {
        const offset = titleBaseline() - title.getBoundingClientRect().top + TITLE_HINT_GAP;
        title.style.setProperty('--hint-top', `${offset}px`);
    };

    // ---------- Hint: dot + thread + label ----------
    const layer = document.createElement('div');
    layer.className = 'tour-layer';
    layer.setAttribute('aria-live', 'polite');
    document.body.appendChild(layer);

    function makeHint(extraClass) {
        const el = document.createElement('div');
        el.className = `tour-hint ${extraClass || ''}`;
        el.innerHTML =
            '<span class="tour-thread"></span><span class="tour-dot"></span>' +
            '<span class="tour-label"><span class="tour-text"></span><span class="tour-sub"></span></span>';
        layer.appendChild(el);
        return el;
    }

    // Places the dot at (x, y) and the label at (lx, ly); `side` says where the
    // label sits relative to its anchor point: 'below' or 'right'.
    function placeHint(el, { x, y, lx, ly, side, text, sub = '' }) {
        const dot = el.querySelector('.tour-dot');
        const thread = el.querySelector('.tour-thread');
        const label = el.querySelector('.tour-label');
        el.querySelector('.tour-text').textContent = text;
        el.querySelector('.tour-sub').textContent = sub;
        dot.style.left = `${x}px`;
        dot.style.top = `${y}px`;
        const len = Math.hypot(lx - x, ly - y);
        thread.style.left = `${x}px`;
        thread.style.top = `${y}px`;
        thread.style.width = `${len}px`;
        thread.style.transform = `rotate(${Math.atan2(ly - y, lx - x)}rad)`;
        label.style.left = `${lx}px`;
        label.style.top = `${ly}px`;
        label.dataset.side = side;
    }

    // ---------- Guided tour ----------
    const STEPS = [
        {
            id: 'title',
            place: () => {
                const { x } = center(title);
                const y = titleBaseline() + TITLE_HINT_GAP;
                return { x, y, lx: x, ly: y + 36, side: 'below', text: TEXT.title, sub: TEXT.titleSub };
            },
        },
        {
            id: 'randomize',
            place: () => {
                const { x, y } = anchor.randomize();
                return { x, y, lx: x, ly: y + 64, side: 'below', text: TEXT.randomize };
            },
        },
        {
            id: 'erase',
            place: () => {
                const { x, y } = anchor.erase();
                return { x, y, lx: x + 56, ly: y + 56, side: 'right', text: TEXT.erase };
            },
        },
        {
            id: 'clear',
            place: () => {
                const { x, y } = anchor.clear();
                return { x, y, lx: x + 64, ly: y, side: 'right', text: TEXT.clear };
            },
        },
        {
            id: 'print-color',
            place: () => {
                const { x, y } = anchor.print();
                return { x, y, lx: x + 56, ly: y - 56, side: 'right', text: TEXT.print };
            },
        },
        {
            id: 'keep-on-screen',
            place: () => {
                const { x, y } = anchor.keep();
                return { x, y, lx: x - 64, ly: y, side: 'left', text: TEXT.keep };
            },
        },
    ];

    const tourHint = makeHint('is-tour');
    let tourTimer = null;
    let tourStep = -1;

    // If a label would cover the title or the statement (e.g. on a phone in
    // portrait), move it just above what it covers; the thread follows.
    const statement = document.querySelector('.statement');
    function avoidTitle(el, spot) {
        const margin = 12;
        for (const obstacle of [title, statement]) {
            if (!obstacle) continue;
            const label = el.querySelector('.tour-label').getBoundingClientRect();
            const t = obstacle.getBoundingClientRect();
            const overlaps =
                label.right > t.left - margin &&
                label.left < t.right + margin &&
                label.bottom > t.top - margin &&
                label.top < t.bottom + margin;
            if (overlaps) {
                spot = { ...spot, ly: t.top - margin - label.height / 2 };
                placeHint(el, spot);
            }
        }
        // Then keep the label inside the screen (e.g. right-edge hints on small
        // phones): slide it back in; the thread follows.
        const edge = 8;
        const r = el.querySelector('.tour-label').getBoundingClientRect();
        let dx = 0;
        let dy = 0;
        if (r.left < edge) dx = edge - r.left;
        else if (r.right > innerWidth - edge) dx = innerWidth - edge - r.right;
        if (r.top < edge) dy = edge - r.top;
        else if (r.bottom > innerHeight - edge) dy = innerHeight - edge - r.bottom;
        if (dx || dy) placeHint(el, { ...spot, lx: spot.lx + dx, ly: spot.ly + dy });
    }

    function showStep(i) {
        tourStep = i;
        const spot = STEPS[i].place();
        placeHint(tourHint, spot);
        if (STEPS[i].id !== 'title') avoidTitle(tourHint, spot);
        tourHint.classList.add('is-visible');
        tourTimer = setTimeout(() => {
            tourHint.classList.remove('is-visible');
            tourTimer = setTimeout(() => {
                if (i + 1 < STEPS.length) showStep(i + 1);
                else endTour(true);
            }, FADE_MS);
        }, STEP_MS);
    }

    function startTour(replay) {
        if (tourStep !== -1) return;
        document.body.classList.add('tour-running');
        track(replay ? 'tour-replay' : 'tour-start');
        // Any click, tap or key press ends the tour; the action itself still happens.
        setTimeout(() => {
            window.addEventListener('pointerdown', skipTour, true);
            window.addEventListener('keydown', skipTour, true);
        }, 0);
        showStep(0);
    }

    function skipTour() {
        if (tourStep !== -1) {
            track('tour-skip', { step: STEPS[tourStep].id });
            endTour(false);
        }
    }

    function endTour(completed) {
        if (completed) track('tour-complete');
        clearTimeout(tourTimer);
        tourHint.classList.remove('is-visible');
        tourStep = -1;
        document.body.classList.remove('tour-running');
        window.removeEventListener('pointerdown', skipTour, true);
        window.removeEventListener('keydown', skipTour, true);
        try {
            localStorage.setItem(STORAGE_KEY, '1');
        } catch (err) {
            // Storage blocked: the tour will simply show again next time.
        }
    }

    // ---------- "?" button ----------
    const helpBtn = document.createElement('button');
    helpBtn.id = 'tourHelpBtn';
    helpBtn.type = 'button';
    helpBtn.textContent = '?';
    helpBtn.title = TEXT.help;
    helpBtn.setAttribute('aria-label', TEXT.help);
    helpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startTour(true);
    });
    document.body.appendChild(helpBtn);

    // ---------- Permanent cues ----------
    // Title: a hint under the word on hover (CSS reads data-hint).
    title.dataset.hint = TEXT.titleHint;
    updateTitleHint();
    window.addEventListener('resize', updateTitleHint);

    // Hidden buttons: a hint shows while the mouse is in a zone and fades out
    // over CUE_FADE pixels around it (mouse only).
    if (!isTouch) {
        const CUE_FADE = 100;
        const cues = [
            {
                el: makeHint('is-cue'),
                target: randomizeBtn,
                anchor: anchor.randomize,
                place: (x, y) => ({ x, y, lx: x, ly: y + 44, side: 'below', text: TEXT.cueRandomize }),
            },
            {
                el: makeHint('is-cue'),
                target: eraseBtn,
                anchor: anchor.erase,
                place: (x, y) => ({ x, y, lx: x + 36, ly: y + 36, side: 'right', text: TEXT.cueErase }),
            },
            {
                el: makeHint('is-cue'),
                target: clearBtn,
                anchor: anchor.clear,
                place: (x, y) => ({ x, y, lx: x + 40, ly: y, side: 'right', text: TEXT.cueClear }),
            },
            {
                el: makeHint('is-cue'),
                target: printBtn,
                anchor: anchor.print,
                place: (x, y) => ({ x, y, lx: x + 36, ly: y - 36, side: 'right', text: TEXT.cuePrint }),
            },
            {
                el: makeHint('is-cue'),
                target: keepBtn,
                anchor: anchor.keep,
                place: (x, y) => ({ x, y, lx: x - 40, ly: y, side: 'left', text: TEXT.cueKeep }),
            },
        ];
        let mouse = null;
        let frame = null;
        const update = () => {
            frame = null;
            for (const cue of cues) {
                const { x, y } = cue.anchor();
                placeHint(cue.el, cue.place(x, y));
                const d = mouse ? distanceToZone(cue.target, mouse.x, mouse.y) : Infinity;
                const strength = Math.max(0, 1 - d / CUE_FADE);
                cue.el.style.opacity = (strength * 0.9).toFixed(2);
            }
        };
        window.addEventListener('mousemove', (e) => {
            mouse = { x: e.clientX, y: e.clientY };
            if (frame === null) frame = requestAnimationFrame(update);
        });
        document.addEventListener('mouseleave', () => {
            mouse = null;
            if (frame === null) frame = requestAnimationFrame(update);
        });
    }

    // Print color feedback: the corner is invisible, so each change shows the
    // new color next to it for a moment, with the dot in that color.
    const flashHint = makeHint('is-flash');
    let flashTimer = null;
    document.addEventListener('printcolorchange', (e) => {
        // While the color picker is open it shows the color itself; the final
        // color is flashed once it closes.
        if (document.querySelector('.cp-card:not([hidden])')) return;
        const { x, y } = anchor.print();
        const { same, color } = e.detail;
        placeHint(flashHint, { x, y, lx: x + 36, ly: y - 36, side: 'right', text: TEXT.printState(same, color) });
        flashHint.querySelector('.tour-dot').style.background = color;
        flashHint.classList.add('is-visible');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => flashHint.classList.remove('is-visible'), 1600);
    });

    // Same for the keep-on-screen zone on the right edge.
    document.addEventListener('keeponscreenchange', (e) => {
        if (!keepBtn) return;
        const { x, y } = anchor.keep();
        placeHint(flashHint, { x, y, lx: x - 40, ly: y, side: 'left', text: TEXT.keepState(e.detail.on) });
        flashHint.querySelector('.tour-dot').style.background = '';
        flashHint.classList.add('is-visible');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => flashHint.classList.remove('is-visible'), 1600);
    });

    // ---------- First visit ----------
    let seen = false;
    try {
        seen = localStorage.getItem(STORAGE_KEY) === '1';
    } catch (err) {
        seen = false;
    }
    if (!seen) setTimeout(() => startTour(false), reduceMotion ? 0 : START_DELAY_MS);
})();
