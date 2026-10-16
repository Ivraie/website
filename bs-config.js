// Development server settings, used by dev-server.js (`npm start`).
// Serves this folder, reloads the page when HTML or
// JS changes and injects CSS changes without a reload.
// The page's Content-Security-Policy blocks the inline script browser-sync
// needs, so the dev server removes that one meta tag from the HTML it serves
// (the published site keeps it).
module.exports = {
    server: { baseDir: __dirname },
    files: [`${__dirname}/*.html`, `${__dirname}/*.css`, `${__dirname}/*.js`],
    port: 3456,
    open: false, // dev-server.js opens the browser (also from WSL)
    notify: false,
    ui: false,
    rewriteRules: [
        {
            match: /<meta http-equiv="Content-Security-Policy"[^>]*>/,
            replace: '<!-- CSP removed by the dev server (bs-config.js) -->',
        },
    ],
};
