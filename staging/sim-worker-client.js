// Worker mode (the default; ?page keeps the simulation on the page): the
// simulation runs in sim-worker.js and the page only draws. The page keeps
// light copies of the creatures (CreatureView) that the usual drawing code
// reads, replays the worker's events in order (step ticks for the fading
// imprints, prints), and sends the settings, the screen size and commands
// (add, burst, start over...) with each request. If the worker cannot run
// or fails, the simulation goes back to the page and starts over.
(function () {
    const params = new URLSearchParams(location.search);
    if (params.has('page') || params.get('worker') === '0' || typeof Worker === 'undefined') return;

    const MAX_PENDING_STEPS = MAX_STEPS_PER_FRAME * 2; // more: the simulation slows down
    const worker = new Worker('sim-worker.js');
    const original = {
        update, addCreature, triggerBurst, resetCreatures, startCreatures,
        releaseFloorFeet, moveFeetWithEdges, getCurrentTotalPoints,
    };

    // A creature as the page sees it: fixed data, plus views onto the latest
    // pool copy. Drawing and title prints use Creature's own methods.
    class CreatureView {
        constructor(data) {
            Object.assign(this, data);
            this.isDead = false;
            this.deathTime = null;
        }
    }
    CreatureView.prototype.draw = Creature.prototype.draw;
    CreatureView.prototype.printToBackground = Creature.prototype.printToBackground;

    let views = new Map(); // id -> CreatureView
    let totalPoints = 0;
    let pendingSteps = 0;
    let commands = [];
    let inFlight = null; // { request, resolve }
    let requestCount = 0;
    let lastSettings = '';
    let currentPool = null; // the pool copy the creature views read
    let returnBuffers = null; // the one before, handed back to the worker
    let failed = false;
    const stats = { replies: 0, simMs: 0, roundTripMs: 0, applyMs: 0 };

    function send(steps) {
        newCreatureChar = document.getElementById('letterInput').value || '+';
        const settings = getSimSettings();
        const settingsText = JSON.stringify(settings);
        const msg = {
            request: ++requestCount,
            size: { width: simSize.width, height: simSize.height },
            commands,
            steps,
        };
        if (settingsText !== lastSettings) {
            msg.settings = settings;
            lastSettings = settingsText;
        }
        commands = [];
        const transfer = [];
        if (returnBuffers) {
            msg.buffers = returnBuffers;
            transfer.push(returnBuffers.x.buffer, returnBuffers.y.buffer, returnBuffers.pulse.buffer);
            returnBuffers = null;
        }
        return new Promise((resolve) => {
            inFlight = { request: msg.request, resolve, sentAt: performance.now() };
            worker.postMessage(msg, transfer);
        });
    }

    function apply(reply) {
        const t0 = performance.now();
        for (const data of reply.added) views.set(data.id, new CreatureView(data));
        // Events in step order: fading layers move on, prints are stamped
        // with the pose they had at that moment.
        for (const ev of reply.events) {
            time = ev.time;
            if (ev.kind === 'tick') {
                updateFadeLayers();
            } else {
                const pose = Object.create(views.get(ev.id));
                pose.isDead = ev.isDead;
                pose.store = { x: ev.x, y: ev.y, pulse: ev.pulse };
                stampPrint(pose, ev.shade, ev.blendMode, ev.color);
            }
        }
        time = reply.time;
        const { x, y, pulse } = reply.pool;
        const next = new Map();
        creatures = reply.list.map((item) => {
            const v = views.get(item.id);
            v.isDead = item.isDead;
            v.deathTime = item.deathTime;
            const end = item.offset + v.count;
            v.store = { x: x.subarray(item.offset, end), y: y.subarray(item.offset, end), pulse: pulse.subarray(item.offset, end) };
            next.set(item.id, v);
            return v;
        });
        views = next;
        totalPoints = reply.totalPoints;
        returnBuffers = currentPool;
        currentPool = reply.pool;
        simHooks.populationChanged();
        stats.replies++;
        stats.simMs += reply.simMs;
        stats.applyMs += performance.now() - t0;
    }

    worker.onmessage = (e) => {
        const reply = e.data;
        const pending = inFlight;
        inFlight = null;
        if (pending) stats.roundTripMs += performance.now() - pending.sentAt;
        apply(reply);
        pending?.resolve(reply);
    };
    worker.onerror = (err) => {
        if (failed) return;
        failed = true;
        console.error('Simulation worker failed, back to the page:', err.message);
        worker.terminate();
        inFlight = null;
        Object.assign(window, original);
        window.ivraieSim.worker = false;
        init(false);
    };

    // The page's simulation calls now go to the worker.
    update = () => {
        pendingSteps = Math.min(pendingSteps + 1, MAX_PENDING_STEPS);
    };
    addCreature = () => commands.push(['addCreature']);
    triggerBurst = (origin = null) => commands.push(['triggerBurst', [origin]]);
    resetCreatures = () => {
        commands.push(['resetCreatures']);
        creatures = [];
        totalPoints = 0;
    };
    startCreatures = () => commands.push(['startCreatures']);
    releaseFloorFeet = () => commands.push(['releaseFloorFeet']);
    moveFeetWithEdges = (...args) => commands.push(['moveFeetWithEdges', args]);
    getCurrentTotalPoints = () => totalPoints;

    // Each frame, before drawing: ask for the steps due (one request at a
    // time; steps due meanwhile wait for the next one).
    const innerDraw = draw;
    draw = () => {
        if (!failed && !inFlight && (pendingSteps > 0 || commands.length > 0)) {
            const steps = pendingSteps;
            pendingSteps = 0;
            send(steps);
        }
        innerDraw();
    };

    // For tests and measurements.
    window.ivraieSim = {
        worker: true,
        stats,
        // Takes n steps now and resolves once their result is applied.
        async step(n) {
            while (inFlight) await new Promise((r) => setTimeout(r, 0));
            return send(n);
        },
        command(name, ...args) {
            commands.push([name, args]);
        },
        // Runs a worker command now and resolves with its result.
        async call(name, ...args) {
            commands.push([name, args]);
            const reply = await this.step(0);
            return reply.results[reply.results.length - 1];
        },
    };

    // Start over in the worker (the page's own start is dropped).
    creatures = [];
    resetCreatures();
    startCreatures();
})();
