// Show mode for projection: open the page with ?show (e.g. /?show).
// Hides the interface, the cursor and the tour (CSS: .show-mode), keeps the
// screen awake, and shows a small stats line (frame rate, points, wake lock).
// Keys: F toggles fullscreen, H hides or shows the stats.
// Loaded in <head>, so the page never flashes the interface before hiding it.
(function () {
    if (!new URLSearchParams(location.search).has('show')) return;
    document.documentElement.classList.add('show-mode');

    let wakeLock = null;
    async function keepAwake() {
        if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => (wakeLock = null));
        } catch (err) {
            wakeLock = null; // refused (battery saver, permissions): the stats say so
        }
    }
    // The lock is dropped whenever the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', keepAwake);

    function toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.().catch(() => {});
    }

    window.addEventListener('DOMContentLoaded', () => {
        keepAwake();

        const stats = document.createElement('div');
        stats.id = 'show-stats';
        document.body.appendChild(stats);
        // fps, creatures and getCurrentTotalPoints come from sim.js.
        setInterval(() => {
            const frames = typeof fps === 'number' ? fps : '--';
            const points = typeof getCurrentTotalPoints === 'function' ? getCurrentTotalPoints() : '--';
            const renderer = window.ivraieRenderer?.mode === 'webgl' ? 'WebGL' : 'Canvas';
            stats.textContent = `${frames} fps · ${points} points · ${renderer} · screen ${wakeLock ? 'kept awake' : 'may sleep'}`;
        }, 500);

        document.addEventListener('keydown', (e) => {
            if (e.target.closest?.('input, select, textarea')) return;
            if (e.key === 'f' || e.key === 'F') toggleFullscreen();
            else if (e.key === 'h' || e.key === 'H') stats.hidden = !stats.hidden;
        });
    });
})();
