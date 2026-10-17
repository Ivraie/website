// Debug panel (D, or ?debug in the address): frame rate, renderer, where the
// simulation runs, its speed and costs, points and creatures, screen. Top
// left, high contrast, updated four times a second.
(function () {
    const panel = document.createElement('div');
    panel.id = 'debug-overlay';
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    document.body.appendChild(panel);

    // Frame times, from the browser's frame callbacks.
    const frameTimes = [];
    let lastFrame = null;
    (function onFrame(t) {
        if (lastFrame !== null) frameTimes.push(t - lastFrame);
        if (frameTimes.length > 120) frameTimes.shift();
        lastFrame = t;
        requestAnimationFrame(onFrame);
    })(performance.now());

    // Time spent in the simulation (page mode) and in drawing, per call.
    const cost = { simMs: 0, simCalls: 0, drawMs: 0, drawCalls: 0 };
    const inWorker = () => !!window.ivraieSim?.worker;
    const innerUpdate = update;
    update = () => {
        const t0 = performance.now();
        innerUpdate();
        if (!inWorker()) {
            cost.simMs += performance.now() - t0;
            cost.simCalls++;
        }
    };
    const innerDraw = draw;
    draw = () => {
        const t0 = performance.now();
        innerDraw();
        cost.drawMs += performance.now() - t0;
        cost.drawCalls++;
    };

    let last = { at: performance.now(), time, replies: 0, workerMs: 0, cost: { ...cost } };

    // Value classes: ok, warn (amber), bad (red).
    const level = (value, warn, bad) => (value >= bad ? 'bad' : value >= warn ? 'warn' : '');
    const row = (label, value, cls = '') => `<dt>${label}</dt><dd class="${cls}">${value}</dd>`;

    function render() {
        const now = performance.now();
        const secs = (now - last.at) / 1000;
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const avg = frameTimes.reduce((s, v) => s + v, 0) / (frameTimes.length || 1);
        const worst = sorted[sorted.length - 1] || 0;
        const fpsNow = avg > 0 ? 1000 / avg : 0;
        const stepsPerSec = (time - last.time) / secs;

        const renderer = window.ivraieRenderer;
        let rendererText = renderer?.mode === 'webgl' ? 'WebGL' : 'Canvas 2D';
        if (renderer?.mode === 'webgl' && drawMode !== 'point') rendererText = 'Canvas 2D (letters)';
        if (renderer && !renderer.available) rendererText += ' · no WebGL';

        const sim = window.ivraieSim;
        let simText = 'page';
        let simCost = '';
        if (inWorker()) {
            const replies = sim.stats.replies - last.replies;
            const workerMs = sim.stats.simMs - last.workerMs;
            simText = `worker · ${(replies / secs).toFixed(0)} updates/s`;
            const perStep = stepsPerSec > 0 ? workerMs / secs / stepsPerSec : 0;
            simCost = row('physics', `${perStep.toFixed(2)} ms/step`, level(perStep, 10, 16));
            last.replies = sim.stats.replies;
            last.workerMs = sim.stats.simMs;
        } else {
            const calls = cost.simCalls - last.cost.simCalls;
            const perStep = calls ? (cost.simMs - last.cost.simMs) / calls : 0;
            simCost = row('physics', `${perStep.toFixed(2)} ms/step`, level(perStep, 6, 10));
        }
        const drawCalls = cost.drawCalls - last.cost.drawCalls;
        const drawPer = drawCalls ? (cost.drawMs - last.cost.drawMs) / drawCalls : 0;

        const points = getCurrentTotalPoints();
        const pointLimit = enablePointLimit ? ` / ${maxPoints.toLocaleString('en')}` : '';
        const creatureLimit = enableCreatureLimit ? ` / ${maxCreatures}` : '';
        const switches = [
            keepOnScreen ? 'walls' : null,
            fadeImprints ? 'fading prints' : null,
            darkPaper ? 'dark paper' : null,
            randomCreatureColor ? 'random colors' : null,
        ].filter(Boolean);

        panel.innerHTML =
            `<dl>` +
            row('fps', `${fpsNow.toFixed(0)}`, `big ${level(-fpsNow, -55, -40)}`) +
            row('frame', `${avg.toFixed(1)} ms avg · ${worst.toFixed(0)} worst`, level(worst, 25, 50)) +
            row('renderer', rendererText) +
            row('simulation', simText) +
            row('speed', `${stepsPerSec.toFixed(0)} steps/s`, level(-stepsPerSec, -57, -45)) +
            simCost +
            row('drawing', `${drawPer.toFixed(2)} ms/frame`, level(drawPer, 8, 14)) +
            row('points', `${points.toLocaleString('en')}${pointLimit}`) +
            row('creatures', `${creatures.length}${creatureLimit}`) +
            (renderer?.mode === 'webgl' ? row('instances', renderer.instances.toLocaleString('en')) : '') +
            row('screen', `${simSize.width}×${simSize.height} · ×${devicePixelRatio.toFixed(2)}`) +
            row('step', time.toLocaleString('en')) +
            (switches.length ? row('on', switches.join(' · ')) : '') +
            `</dl><p>D hide · G renderer · B burst</p>`;

        last.at = now;
        last.time = time;
        last.cost = { ...cost };
    }

    let timer = null;
    function setVisible(on) {
        panel.hidden = !on;
        clearInterval(timer);
        timer = null;
        if (on) {
            last = { ...last, at: performance.now(), time, cost: { ...cost } };
            render();
            timer = setInterval(render, 250);
        }
        try {
            localStorage.setItem('ivraie-debug', on ? '1' : '0');
        } catch (e) {
            /* storage unavailable: not remembered */
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyD' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target.closest?.('input, select, textarea')) return;
        setVisible(panel.hidden);
    });

    let remembered = false;
    try {
        remembered = localStorage.getItem('ivraie-debug') === '1';
    } catch (e) {
        /* storage unavailable */
    }
    if (new URLSearchParams(location.search).has('debug') || remembered) setVisible(true);
})();
