// `npm start`: development server with auto-reload (settings in
// bs-config.js), then opens the page in the default browser. browser-sync
// cannot open a browser from WSL by itself, so this does it, including the
// Windows browser when running under WSL.
const os = require('os');
const { spawn } = require('child_process');
const browserSync = require('browser-sync').create();
const config = require('./bs-config.js');

function openInBrowser(url) {
    const isWsl = process.platform === 'linux' && /microsoft/i.test(os.release());
    const [cmd, args] = isWsl
        ? ['explorer.exe', [url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '', url]]
            : ['xdg-open', [url]];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
}

browserSync.init({ ...config, open: false }, () => {
    const url = `http://localhost:${browserSync.getOption('port')}`;
    if (!process.argv.includes('--no-open')) openInBrowser(url);
});
