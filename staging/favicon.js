// Draws a random "Hanging" creature as the favicon on each visit: one of a
// dozen layouts, grown from a random seed. Medium lines, ink tone, no
// background; switches to light ink when the browser is in dark mode.
// On load the creature swings from its foot for a few seconds, then settles.
(function () {
    const WEIGHT = { line: 1.6, leg: 2.0, dot: 2.3 };
    const LIGHT = { line: '#6b6b6b', dot: '#1e1e1e', leg: '#000000' };
    const DARK = { line: '#9a9a9a', dot: '#e6e6e6', leg: '#ffffff' };

    function mulberry32(a) {
        return function () {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Points joined by grey springs, dark legs to the edges, black feet.
    function makeScene(rng) {
        const pts = [];
        const lines = new Set();
        const legs = [];
        const rand = (a, b) => a + rng() * (b - a);
        const S = {
            pts,
            lines,
            legs,
            add(x, y, size = rand(0.6, 1.4)) {
                pts.push({ x, y, s: size });
                return pts.length - 1;
            },
            link(a, b) {
                if (a !== b) lines.add(a < b ? `${a}-${b}` : `${b}-${a}`);
            },
            d2(i, j) {
                return (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2;
            },
            nearest(ids, k) {
                for (const i of ids) {
                    ids.filter((j) => j !== i)
                        .sort((p, q) => S.d2(i, p) - S.d2(i, q))
                        .slice(0, k)
                        .forEach((j) => S.link(i, j));
                }
            },
            cluster(cx, cy, n, spread, k = 2) {
                const ids = [];
                for (let i = 0; i < n; i++) {
                    const a = rand(0, Math.PI * 2);
                    const r = Math.sqrt(rng()) * spread;
                    ids.push(S.add(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
                }
                S.nearest(ids, k);
                return ids;
            },
            scatter(n, x0, y0, x1, y1) {
                const ids = [];
                for (let i = 0; i < n; i++) ids.push(S.add(rand(x0, x1), rand(y0, y1), rand(0.7, 1.3)));
                return ids;
            },
            thread(i, j, beads = 1, wobble = 2.5) {
                const a = pts[i];
                const b = pts[j];
                const nx = -(b.y - a.y);
                const ny = b.x - a.x;
                const len = Math.hypot(nx, ny) || 1;
                let prev = i;
                for (let s = 1; s <= beads; s++) {
                    const t = s / (beads + 1);
                    const w = rand(-wobble, wobble);
                    const id = S.add(
                        a.x + (b.x - a.x) * t + (nx / len) * w,
                        a.y + (b.y - a.y) * t + (ny / len) * w,
                        rand(0.4, 0.9),
                    );
                    S.link(prev, id);
                    prev = id;
                }
                S.link(prev, j);
            },
            leg(i, x, y, foot = false) {
                legs.push({ from: i, x, y, foot });
            },
            anchor(x, y) {
                const id = S.add(x, y, 1.6);
                pts[id].dark = true;
            },
            closest(ids, x, y) {
                let best = ids[0];
                let bd = Infinity;
                for (const id of ids) {
                    const d = (pts[id].x - x) ** 2 + (pts[id].y - y) ** 2;
                    if (d < bd) {
                        bd = d;
                        best = id;
                    }
                }
                return best;
            },
        };
        return S;
    }

    // A body hanging from the top edge, knots dangling below.
    // body: [x, y, points, spread, links]; knots: [x, y, points, spread, beads].
    function hang(S, { feet, body, knots = [], beads = 1, dot = false, tangle = false, chain = false }) {
        const [bx, by, bn, bsp, bk = 3] = body;
        let top;
        if (tangle) {
            top = S.scatter(bn, bx - bsp, by - bsp * 0.8, bx + bsp, by + bsp * 0.8);
            S.nearest(top, bk);
        } else {
            top = S.cluster(bx, by, bn, bsp, bk);
        }
        for (const [fx, fy] of feet) {
            S.leg(S.closest(top, fx, fy), fx, fy);
            if (dot) S.anchor(fx, fy);
        }
        let prev = top;
        let prevXY = [bx, by];
        for (const [kx, ky, kn, ksp, kb = beads] of knots) {
            const k = S.cluster(kx, ky, kn, ksp);
            const from = chain ? prev : top;
            const fromXY = chain ? prevXY : [bx, by];
            S.thread(S.closest(from, kx, ky), S.closest(k, fromXY[0], fromXY[1]), kb);
            prev = k;
            prevXY = [kx, ky];
        }
    }

    const LAYOUTS = [
        (S) => {
            const top = S.cluster(32, 28, 8, 8, 3);
            const l = S.cluster(20, 52, 4, 5);
            const r = S.cluster(46, 53, 4, 5);
            S.thread(S.closest(top, 20, 52), S.closest(l, 32, 28), 1);
            S.thread(S.closest(top, 46, 53), S.closest(r, 32, 28), 1);
            S.leg(S.closest(top, 32, 0), 30, 1);
        },
        (S) => hang(S, { feet: [[24, 1]], body: [36, 26, 8, 8], knots: [[18, 50, 5, 5.5], [50, 58, 3, 3.5]] }),
        (S) => hang(S, { feet: [[34, 1]], body: [30, 27, 8, 8], knots: [[15, 46, 6, 6, 0], [48, 58, 2, 3, 2]] }),
        (S) => hang(S, { feet: [[28, 1]], body: [33, 25, 8, 8], knots: [[22, 57, 4, 4.5, 2], [52, 40, 3, 4, 0]] }),
        (S) => hang(S, { feet: [[42, 1]], body: [38, 23, 9, 9], knots: [[20, 42, 4, 5], [12, 59, 2, 3, 0]], chain: true }),
        (S) => hang(S, { feet: [[10, 1]], body: [37, 30, 8, 8], knots: [[27, 56, 4, 4.5], [55, 49, 2, 3, 0]] }),
        (S) => hang(S, { feet: [[38, 1.5]], body: [31, 28, 8, 8], knots: [[17, 49, 4, 5], [42, 58, 3, 4, 2]], dot: true }),
        (S) => hang(S, { feet: [[46, 1]], body: [42, 24, 8, 8], knots: [[14, 45, 3, 4], [27, 59, 4, 4.5]] }),
        (S) => hang(S, { feet: [[42, 1]], body: [24, 30, 8, 8], knots: [[41, 52, 5, 5], [12, 58, 2, 3, 0]] }),
        (S) => hang(S, { feet: [[5, 1]], body: [40, 28, 10, 10], knots: [[50, 56, 3, 4, 0], [20, 53, 2, 3, 2]] }),
        (S) => hang(S, { feet: [[26, 1.5]], body: [35, 26, 10, 14, 3], knots: [[14, 52, 3, 4], [50, 58, 2, 3, 0]], dot: true, tangle: true }),
        (S) => hang(S, { feet: [[30, 1]], body: [34, 22, 6, 7], knots: [[16, 40, 3, 4, 0], [44, 47, 5, 5], [30, 60, 2, 2.5, 2]] }),
    ];

    // Swing: a damped pendulum around the foot. Points further from the foot
    // follow with a delay, so the knots trail behind the body like a whip.
    const SWING = {
        amplitude: 0.35, // radians at the start (about 20 degrees)
        frequency: 0.9, // swings per second
        decay: 1.1, // seconds for the swing to shrink to about a third
        lagPerUnit: 0.004, // seconds of delay per unit of distance from the foot
        duration: 3500, // ms
        frameMs: 66, // about 15 frames per second
    };

    function swungPoints(S, t) {
        const pivot = S.legs[0];
        if (!pivot || t <= 0) return S.pts;
        return S.pts.map((p) => {
            const dx = p.x - pivot.x;
            const dy = p.y - pivot.y;
            const local = Math.max(0, t - Math.hypot(dx, dy) * SWING.lagPerUnit);
            const angle =
                SWING.amplitude *
                Math.exp(-local / SWING.decay) *
                Math.sin(2 * Math.PI * SWING.frequency * local);
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            return { ...p, x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
        });
    }

    function creatureSvg(S, t = 0) {
        const f = (n) => Math.round(n * 10) / 10;
        const P = swungPoints(S, t);
        let out =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>' +
            `.l{stroke:${LIGHT.line}}.k{stroke:${LIGHT.leg}}.d{fill:${LIGHT.dot}}.f{fill:${LIGHT.leg}}` +
            `@media (prefers-color-scheme:dark){.l{stroke:${DARK.line}}.k{stroke:${DARK.leg}}.d{fill:${DARK.dot}}.f{fill:${DARK.leg}}}` +
            '</style>';
        out += `<g class="l" stroke-width="${WEIGHT.line}" stroke-linecap="round">`;
        for (const key of S.lines) {
            const [a, b] = key.split('-').map(Number);
            out += `<line x1="${f(P[a].x)}" y1="${f(P[a].y)}" x2="${f(P[b].x)}" y2="${f(P[b].y)}"/>`;
        }
        out += `</g><g class="k" stroke-width="${WEIGHT.leg}" stroke-linecap="round">`;
        for (const l of S.legs) {
            out += `<line x1="${f(P[l.from].x)}" y1="${f(P[l.from].y)}" x2="${f(l.x)}" y2="${f(l.y)}"/>`;
        }
        out += '</g><g class="d">';
        for (const p of P) if (!p.dark) out += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(WEIGHT.dot * p.s)}"/>`;
        out += '</g><g class="f">';
        for (const p of P) if (p.dark) out += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(WEIGHT.dot * p.s)}"/>`;
        return out + '</g></svg>';
    }

    const icon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    if (!icon) return;
    const S = makeScene(mulberry32(Math.floor(Math.random() * 100000)));
    LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)](S);
    // Anywhere but the live site, a dot on the icon and a word in the tab
    // title, to tell the tabs apart: red "local ·" (localhost, a dev server,
    // a file), blue "staging ·" (ivraie.ink/staging/).
    const isLocal = !/(^|\.)ivraie\.ink$/.test(location.hostname);
    const isStaging = !isLocal && location.pathname.startsWith('/staging/');
    const tag = isLocal ? 'local' : isStaging ? 'staging' : null;
    if (tag && !document.title.startsWith(tag)) document.title = `${tag} · ${document.title}`;
    const BADGE = `<circle cx="50" cy="14" r="13" fill="${isLocal ? '#e0402f' : '#2f6fe0'}" stroke="#ffffff" stroke-width="3"/>`;
    const show = (t) => {
        let svg = creatureSvg(S, t);
        if (tag) svg = svg.replace('</svg>', `${BADGE}</svg>`);
        icon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
    };

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        show(0);
        return;
    }
    // Timers, not requestAnimationFrame: the tab icon stays visible even when
    // the page is in a background tab, where animation frames are paused.
    const start = performance.now();
    const tick = () => {
        const elapsed = performance.now() - start;
        if (elapsed >= SWING.duration) {
            show(0);
            return;
        }
        show(elapsed / 1000);
        setTimeout(tick, SWING.frameMs);
    };
    tick();
})();
