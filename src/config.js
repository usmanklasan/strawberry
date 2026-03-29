const path = require('path');
const fs = require('fs');
const os = require('os');
const RammerheadJSMemCache = require('./classes/RammerheadJSMemCache.js');
const RammerheadJSFileCache = require('./classes/RammerheadJSFileCache.js');

const enableWorkers = os.cpus().length !== 1;

/** Public hostname used when Host / X-Forwarded-Host are missing (e.g. internal requests). */
const STRAWBERRY_PUBLIC_HOST = process.env.STRAWBERRY_PUBLIC_HOST || 'strawberry.autos';

/**
 * Rewrite URLs (links, forms, Location redirects, etc.) to this proxy origin.
 * Uses forwarded headers when present (reverse proxy / TLS termination).
 * Override per-environment in root `config.js` if needed.
 *
 * @param {import('http').IncomingMessage} req
 */
function getServerInfo(req) {
    const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || STRAWBERRY_PUBLIC_HOST || '')
        .split(',')[0]
        .trim();

    let hostname = STRAWBERRY_PUBLIC_HOST;
    let portFromHost = null;
    try {
        const u = new URL('http://' + hostHeader);
        hostname = u.hostname || STRAWBERRY_PUBLIC_HOST;
        if (u.port) portFromHost = parseInt(u.port, 10);
    } catch (e) {
        hostname = STRAWBERRY_PUBLIC_HOST;
    }

    const protoHeader = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    let protocol = 'https:';
    if (protoHeader === 'http') protocol = 'http:';
    else if (!protoHeader && req.socket && !req.socket.encrypted) protocol = 'http:';

    let port = portFromHost;
    const forwardedPort = (req.headers['x-forwarded-port'] || '').split(',')[0].trim();
    if (forwardedPort) {
        const p = parseInt(forwardedPort, 10);
        if (!isNaN(p)) port = p;
    }
    if (port == null || isNaN(port)) {
        port = protocol === 'https:' ? 443 : 80;
    }

    // Omit crossDomainPort: RammerheadProxy uses serverInfo.crossDomainPort || this.crossDomainPort || serverInfo.port.
    // Local dev keeps a real second bind port (e.g. 8081). For a single public port on strawberry.autos set
    // crossDomainPort: null in root config.js so iframe/cross URLs stay on the same port.

    return {
        hostname,
        port,
        protocol
    };
}

module.exports = {
    //// HOSTING CONFIGURATION ////

    bindingAddress: '127.0.0.1',
    port: 8080,
    crossDomainPort: 8081,
    publicDir: path.join(__dirname, '../public'), // set to null to disable

    // enable or disable multithreading
    enableWorkers,
    workers: os.cpus().length,

    // ssl object is either null or { key: fs.readFileSync('path/to/key'), cert: fs.readFileSync('path/to/cert') }
    // for more info, see https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener
    ssl: null,

    // Determines proxy origin in rewritten HTML, redirects, and task.js (links/forms stay on this host).
    // Defaults to strawberry.autos (HTTPS). With Host: localhost:8080 you still get localhost for dev.
    getServerInfo,

    // enforce a password for creating new sessions. set to null to disable
    password: null,

    // disable or enable localStorage sync (turn off if clients send over huge localStorage data, resulting in huge memory usages)
    disableLocalStorageSync: false,

    // restrict sessions to be only used per IP
    restrictSessionToIP: true,

    // caching options for js rewrites. (disk caching not recommended for slow HDD disks)
    // recommended: 50mb for memory, 5gb for disk
    // jsCache: new RammerheadJSMemCache(5 * 1024 * 1024),
    jsCache: new RammerheadJSFileCache(path.join(__dirname, '../cache-js'), 5 * 1024 * 1024 * 1024, 50000, enableWorkers),

    // whether to disable http2 support or not (from proxy to destination site).
    // disabling may reduce number of errors/memory, but also risk
    // removing support for picky sites like web.whatsapp.com that want
    // the client to connect to http2 before connecting to their websocket
    disableHttp2: false,

    //// REWRITE HEADER CONFIGURATION ////

    // removes reverse proxy headers
    // cloudflare example:
    // stripClientHeaders: ['cf-ipcountry', 'cf-ray', 'x-forwarded-proto', 'cf-visitor', 'cf-connecting-ip', 'cdn-loop', 'x-forwarded-for'],
    stripClientHeaders: [],
    // if you want to modify response headers, like removing the x-frame-options header, do it like so:
    // rewriteServerHeaders: {
    //     // you can also specify a function to modify/add the header using the original value (undefined if adding the header)
    //     // 'x-frame-options': (originalHeaderValue) => '',
    //     'x-frame-options': null, // set to null to tell rammerhead that you want to delete it
    // },
    rewriteServerHeaders: {},

    //// SESSION STORE CONFIG ////

    // see src/classes/RammerheadSessionFileCache.js for more details and options
    fileCacheSessionConfig: {
        saveDirectory: path.join(__dirname, '../sessions'),
        cacheTimeout: 1000 * 60 * 20, // 20 minutes
        cacheCheckInterval: 1000 * 60 * 10, // 10 minutes
        deleteUnused: true,
        staleCleanupOptions: {
            staleTimeout: 1000 * 60 * 60 * 24 * 3, // 3 days
            maxToLive: null,
            staleCheckInterval: 1000 * 60 * 60 * 6 // 6 hours
        },
        // corrupted session files happens when nodejs exits abruptly while serializing the JSON sessions to disk
        deleteCorruptedSessions: true,
    },

    //// LOGGING CONFIGURATION ////

    // valid values: 'disabled', 'debug', 'traffic', 'info', 'warn', 'error'
    logLevel: process.env.DEVELOPMENT ? 'debug' : 'info',
    generatePrefix: (level) => `[${new Date().toISOString()}] [${level.toUpperCase()}] `,

    // logger depends on this value
    getIP: (req) => req.socket.remoteAddress
    // use the example below if rammerhead is sitting behind a reverse proxy like nginx
    // getIP: req => (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim()
};

if (fs.existsSync(path.join(__dirname, '../config.js'))) Object.assign(module.exports, require('../config'));
