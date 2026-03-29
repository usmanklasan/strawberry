(function () {
    var hammerhead = window['%hammerhead%'];
    if (!hammerhead) throw new Error('hammerhead not loaded yet');
    if (hammerhead.settings._settings.sessionId) {
        // task.js already loaded. this will likely never happen though since this file loads before task.js
        console.warn('unexpected task.js to load before rammerhead.js. url shuffling cannot be used');
        main();
    } else {
        // wait for task.js to load
        hookHammerheadStartOnce(main);
        // before task.js, we need to add url shuffling
        addUrlShuffling();
    }

    function main() {
        fixUrlRewrite();
        fixElementGetter();
        applyProxyUrlBarMask();
        fixCrossWindowLocalStorage();
        installStrawberryDock();

        delete window.overrideGetProxyUrl;
        delete window.overrideParseProxyUrl;
        delete window.overrideIsCrossDomainWindows;

        // other code if they want to also hook onto hammerhead start //
        if (window.rammerheadStartListeners) {
            for (const eachListener of window.rammerheadStartListeners) {
                try {
                    eachListener();
                } catch (e) {
                    console.error(e);
                }
            }
            delete window.rammerheadStartListeners;
        }

        // sync localStorage code //
        // disable if other code wants to implement their own localStorage site wrapper
        if (window.rammerheadDisableLocalStorageImplementation) {
            delete window.rammerheadDisableLocalStorageImplementation;
            return;
        }
        // consts
        var timestampKey = 'rammerhead_synctimestamp';
        var updateInterval = 5000;
        var isSyncing = false;

        var proxiedLocalStorage = localStorage;
        var realLocalStorage = proxiedLocalStorage.internal.nativeStorage;
        var sessionId = hammerhead.settings._settings.sessionId;
        var origin = window.__get$(window, 'location').origin;
        var keyChanges = [];

        try {
            syncLocalStorage();
        } catch (e) {
            if (e.message !== 'server wants to disable localStorage syncing') {
                throw e;
            }
            return;
        }
        proxiedLocalStorage.addChangeEventListener(function (event) {
            if (isSyncing) return;
            if (keyChanges.indexOf(event.key) === -1) keyChanges.push(event.key);
        });
        setInterval(function () {
            var update = compileUpdate();
            if (!update) return;
            localStorageRequest({ type: 'update', updateData: update }, function (data) {
                updateTimestamp(data.timestamp);
            });

            keyChanges = [];
        }, updateInterval);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                var update = compileUpdate();
                if (update) {
                    // even though we'll never get the timestamp, it's fine. this way,
                    // the data is safer
                    hammerhead.nativeMethods.sendBeacon.call(
                        window.navigator,
                        getSyncStorageEndpoint(),
                        JSON.stringify({
                            type: 'update',
                            updateData: update
                        })
                    );
                }
            }
        });

        function syncLocalStorage() {
            isSyncing = true;
            var timestamp = getTimestamp();
            var response;
            if (!timestamp) {
                // first time syncing
                response = localStorageRequest({ type: 'sync', fetch: true });
                if (response.timestamp) {
                    updateTimestamp(response.timestamp);
                    overwriteLocalStorage(response.data);
                }
            } else {
                // resync
                response = localStorageRequest({ type: 'sync', timestamp: timestamp, data: proxiedLocalStorage });
                if (response.timestamp) {
                    updateTimestamp(response.timestamp);
                    overwriteLocalStorage(response.data);
                }
            }
            isSyncing = false;

            function overwriteLocalStorage(data) {
                if (!data || typeof data !== 'object') throw new TypeError('data must be an object');
                proxiedLocalStorage.clear();
                for (var prop in data) {
                    proxiedLocalStorage[prop] = data[prop];
                }
            }
        }
        function updateTimestamp(timestamp) {
            if (!timestamp) throw new TypeError('timestamp must be defined');
            if (isNaN(parseInt(timestamp))) throw new TypeError('timestamp must be a number. received' + timestamp);
            realLocalStorage[timestampKey] = timestamp;
        }
        function getTimestamp() {
            var rawTimestamp = realLocalStorage[timestampKey];
            var timestamp = parseInt(rawTimestamp);
            if (isNaN(timestamp)) {
                if (rawTimestamp) {
                    console.warn('invalid timestamp retrieved from storage: ' + rawTimestamp);
                }
                return null;
            }
            return timestamp;
        }
        function getSyncStorageEndpoint() {
            return (
                '/syncLocalStorage?sessionId=' + encodeURIComponent(sessionId) + '&origin=' + encodeURIComponent(origin)
            );
        }
        function localStorageRequest(data, callback) {
            if (!data || typeof data !== 'object') throw new TypeError('data must be an object');

            var request = hammerhead.createNativeXHR();
            // make synchronous if there is no callback
            request.open('POST', getSyncStorageEndpoint(), !!callback);
            request.setRequestHeader('content-type', 'application/json');
            request.send(JSON.stringify(data));
            function check() {
                if (request.status === 404) {
                    throw new Error('server wants to disable localStorage syncing');
                }
                if (request.status !== 200)
                    throw new Error(
                        'server sent a non 200 code. got ' + request.status + '. Response: ' + request.responseText
                    );
            }
            if (!callback) {
                check();
                return JSON.parse(request.responseText);
            } else {
                request.onload = function () {
                    check();
                    callback(JSON.parse(request.responseText));
                };
            }
        }
        function compileUpdate() {
            if (!keyChanges.length) return null;

            var updates = {};
            for (var i = 0; i < keyChanges.length; i++) {
                updates[keyChanges[i]] = proxiedLocalStorage[keyChanges[i]];
            }

            keyChanges = [];
            return updates;
        }
    }

    function isEmbeddedInStrawberryProxyFrame() {
        try {
            var fe = window.frameElement;
            if (!fe) return false;
            if (fe.id === 'proxy-frame') return true;
            if ((fe.name || '') === 'strawberry-proxy') return true;
            return fe.getAttribute && fe.getAttribute('data-strawberry-proxy') === '1';
        } catch (e) {
            return false;
        }
    }

    /** Real parent shell when AB Cloak redefines window.parent (avoid window.parent.postMessage → self). */
    function getStrawberryShellWindow() {
        try {
            var fe = window.frameElement;
            if (!fe || !isEmbeddedInStrawberryProxyFrame()) return null;
            var doc = fe.ownerDocument;
            if (!doc || !doc.defaultView) return null;
            var shell = doc.defaultView;
            return shell === window ? null : shell;
        } catch (e) {
            return null;
        }
    }

    /** Dock + URL mask: real top-level proxy, or proxied page inside Strawberry's #proxy-frame (AB Cloak). */
    function isStrawberryBrowserUiContext() {
        try {
            if (window.top === window.self) return true;
        } catch (e) {
            return false;
        }
        return isEmbeddedInStrawberryProxyFrame();
    }

    function installStrawberryDock() {
        try {
            if (!isStrawberryBrowserUiContext()) return;
        } catch (e) {
            return;
        }
        if (document.getElementById('strawberry-dock-host')) return;

        const host = document.createElement('div');
        host.id = 'strawberry-dock-host';
        host.style.all = 'initial';
        host.style.position = 'fixed';
        host.style.left = '0';
        host.style.right = '0';
        host.style.bottom = '0';
        host.style.zIndex = '2147483647';
        host.style.pointerEvents = 'none';

        const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

        const style = document.createElement('style');
        style.textContent = `
            :host { all: initial; }
            .dock {
                pointer-events: auto;
                width: min(560px, calc(100vw - 16px));
                margin: 0 auto;
                margin-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
                padding: 10px 8px;
                border-radius: 22px;
                background: rgba(7, 9, 12, 0.78);
                border: 1px solid rgba(255, 159, 46, 0.45);
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.65), 0 0 28px rgba(255, 159, 46, 0.16);
                display: grid;
                grid-template-columns: repeat(6, 1fr);
                gap: 8px;
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
                box-sizing: border-box;
            }
            .btn {
                min-height: 48px;
                height: auto;
                border-radius: 16px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(10, 12, 18, 0.65);
                color: rgba(255, 255, 255, 0.90);
                display: grid;
                place-items: center;
                cursor: pointer;
                user-select: none;
                -webkit-tap-highlight-color: transparent;
                transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
            }
            .btn:hover {
                transform: translateY(-1px);
                border-color: rgba(255, 159, 46, 0.60);
                box-shadow: 0 0 18px rgba(255, 159, 46, 0.18);
            }
            .ic { font-size: 20px; line-height: 1; }
            .menu {
                pointer-events: auto;
                width: min(420px, calc(100vw - 16px));
                margin: 0 auto 8px;
                padding: 10px;
                border-radius: 18px;
                background: rgba(7, 9, 12, 0.86);
                border: 1px solid rgba(255, 159, 46, 0.35);
                box-shadow: 0 12px 46px rgba(0, 0, 0, 0.70);
                font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
                color: rgba(255, 255, 255, 0.92);
            }
            .menu[hidden] { display: none; }
            .menu a {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 10px 12px;
                border-radius: 14px;
                color: inherit;
                text-decoration: none;
                border: 1px solid rgba(255, 255, 255, 0.10);
                background: rgba(10, 12, 18, 0.55);
                margin: 8px 0;
            }
            .menu a:hover {
                border-color: rgba(255, 159, 46, 0.55);
                box-shadow: 0 0 18px rgba(255, 159, 46, 0.12);
            }
            .label { opacity: 0.92; font-size: 13px; }
            .hint { opacity: 0.55; font-size: 12px; }
            @media (max-width: 520px) {
                .dock {
                    grid-template-columns: repeat(3, 1fr);
                    gap: 8px;
                    padding: 8px;
                }
                .btn { min-height: 46px; }
            }
            @media (max-width: 380px) {
                .dock { grid-template-columns: repeat(2, 1fr); }
            }
        `;

        const container = document.createElement('div');
        const menu = document.createElement('div');
        menu.className = 'menu';
        menu.hidden = true;

        const dock = document.createElement('div');
        dock.className = 'dock';

        function mkBtn(label, icon, onClick) {
            const b = document.createElement('div');
            b.className = 'btn';
            b.setAttribute('role', 'button');
            b.setAttribute('tabindex', '0');
            b.setAttribute('aria-label', label);
            b.innerHTML = `<span class="ic" aria-hidden="true">${icon}</span>`;
            b.addEventListener('click', onClick);
            b.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            });
            return b;
        }

        function goHome() {
            try {
                // Inside AB Cloak iframe, navigating to / loads the full shell *inside* the iframe (double chrome).
                var shell = getStrawberryShellWindow();
                if (shell) {
                    shell.postMessage({ type: 'strawberry-dock-home' }, window.location.origin);
                    return;
                }
                window.location.href = window.location.origin + '/';
            } catch (e) {
                // ignore
            }
        }

        function toggleMenu() {
            menu.hidden = !menu.hidden;
        }

        dock.appendChild(mkBtn('Home', '⌂', goHome));
        dock.appendChild(mkBtn('Back', '←', () => history.back()));
        dock.appendChild(mkBtn('Forward', '→', () => history.forward()));
        dock.appendChild(mkBtn('Reload', '⟳', () => location.reload()));
        dock.appendChild(mkBtn('Top', '⇧', () => window.scrollTo({ top: 0, behavior: 'smooth' })));
        dock.appendChild(mkBtn('Menu', '☰', toggleMenu));

        function mkLink(text, hint, href, onClick) {
            const a = document.createElement('a');
            a.href = href || '#';
            a.innerHTML = `<span class="label">${text}</span><span class="hint">${hint || ''}</span>`;
            if (onClick) {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    onClick();
                    menu.hidden = true;
                });
            } else {
                a.addEventListener('click', () => (menu.hidden = true));
            }
            return a;
        }

        menu.appendChild(mkLink('Home', 'Strawberry', '#', goHome));
        menu.appendChild(
            mkLink('New tab', 'In Strawberry', '#', function () {
                try {
                    var shell = getStrawberryShellWindow();
                    if (shell) {
                        shell.postMessage({ type: 'strawberry-dock-new-tab' }, window.location.origin);
                        return;
                    }
                } catch (e) {}
                window.open(window.location.origin + '/', '_blank', 'noopener,noreferrer');
            })
        );
        menu.appendChild(mkLink('Close menu', '', '#', () => (menu.hidden = true)));

        container.appendChild(menu);
        container.appendChild(dock);

        root.appendChild(style);
        root.appendChild(container);
        document.documentElement.appendChild(host);

        // Close menu when clicking outside
        document.addEventListener(
            'click',
            (e) => {
                if (menu.hidden) return;
                const path = e.composedPath ? e.composedPath() : [];
                if (path.includes(host)) return;
                menu.hidden = true;
            },
            true
        );
    }

    var noShuffling = false;
    function addUrlShuffling() {
        const request = new XMLHttpRequest();
        const sessionId = (location.pathname.slice(1).match(/^[a-z0-9]+/i) || [])[0];
        if (!sessionId) {
            console.warn('cannot get session id from url');
            return;
        }
        request.open('GET', '/api/shuffleDict?id=' + sessionId, false);
        request.send();
        if (request.status !== 200) {
            console.warn(
                `received a non 200 status code while trying to fetch shuffleDict:\nstatus: ${request.status}\nresponse: ${request.responseText}`
            );
            return;
        }
        const shuffleDict = JSON.parse(request.responseText);
        if (!shuffleDict) return;

        // pasting entire thing here "because lazy" - m28
        const mod = (n, m) => ((n % m) + m) % m;
        const baseDictionary = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~-';
        const shuffledIndicator = '_rhs';
        const generateDictionary = function () {
            let str = '';
            const split = baseDictionary.split('');
            while (split.length > 0) {
                str += split.splice(Math.floor(Math.random() * split.length), 1)[0];
            }
            return str;
        };
        class StrShuffler {
            constructor(dictionary = generateDictionary()) {
                this.dictionary = dictionary;
            }
            shuffle(str) {
                if (str.startsWith(shuffledIndicator)) {
                    return str;
                }
                let shuffledStr = '';
                for (let i = 0; i < str.length; i++) {
                    const char = str.charAt(i);
                    const idx = baseDictionary.indexOf(char);
                    if (char === '%' && str.length - i >= 3) {
                        shuffledStr += char;
                        shuffledStr += str.charAt(++i);
                        shuffledStr += str.charAt(++i);
                    } else if (idx === -1) {
                        shuffledStr += char;
                    } else {
                        shuffledStr += this.dictionary.charAt(mod(idx + i, baseDictionary.length));
                    }
                }
                return shuffledIndicator + shuffledStr;
            }
            unshuffle(str) {
                if (!str.startsWith(shuffledIndicator)) {
                    return str;
                }

                str = str.slice(shuffledIndicator.length);

                let unshuffledStr = '';
                for (let i = 0; i < str.length; i++) {
                    const char = str.charAt(i);
                    const idx = this.dictionary.indexOf(char);
                    if (char === '%' && str.length - i >= 3) {
                        unshuffledStr += char;
                        unshuffledStr += str.charAt(++i);
                        unshuffledStr += str.charAt(++i);
                    } else if (idx === -1) {
                        unshuffledStr += char;
                    } else {
                        unshuffledStr += baseDictionary.charAt(mod(idx - i, baseDictionary.length));
                    }
                }
                return unshuffledStr;
            }
        }

        const replaceUrl = (url, replacer) => {
            //        regex:              https://google.com/    sessionid/   url
            return (url || '').replace(/^((?:[a-z0-9]+:\/\/[^/]+)?(?:\/[^/]+\/))([^]+)/i, function (_, g1, g2) {
                return g1 + replacer(g2);
            });
        };
        const shuffler = new StrShuffler(shuffleDict);

        // shuffle current url if it isn't already shuffled (unshuffled urls likely come from user input)
        const oldUrl = location.href;
        const newUrl = replaceUrl(location.href, (url) => shuffler.shuffle(url));
        if (oldUrl !== newUrl) {
            history.replaceState(null, null, newUrl);
        }

        const getProxyUrl = hammerhead.utils.url.getProxyUrl;
        const parseProxyUrl = hammerhead.utils.url.parseProxyUrl;
        hammerhead.utils.url.overrideGetProxyUrl(function (url, opts) {
            if (noShuffling) {
                return getProxyUrl(url, opts);
            }
            return replaceUrl(getProxyUrl(url, opts), (u) => shuffler.shuffle(u), true);
        });
        hammerhead.utils.url.overrideParseProxyUrl(function (url) {
            return parseProxyUrl(replaceUrl(url, (u) => shuffler.unshuffle(u), false));
        });
        // manual hooks //
        window.overrideGetProxyUrl(
            (getProxyUrl$1) =>
                function (url, opts) {
                    if (noShuffling) {
                        return getProxyUrl$1(url, opts);
                    }
                    return replaceUrl(getProxyUrl$1(url, opts), (u) => shuffler.shuffle(u), true);
                }
        );
        window.overrideParseProxyUrl(
            (parseProxyUrl$1) =>
                function (url) {
                    return parseProxyUrl$1(replaceUrl(url, (u) => shuffler.unshuffle(u), false));
                }
        );

        // Used by applyProxyUrlBarMask: location.href is shuffled but parse+compare was using
        // unshuffled partAfterHost, so newPart === partAfterHost always and replaceState never ran.
        window.__strawberryUnshuffleProxyHref = function (href) {
            return replaceUrl(href, function (u) {
                return shuffler.unshuffle(u);
            });
        };
    }
    /**
     * Replace the visible path with a readable destination URL (same proxy routing).
     * Browsers cannot show another origin (e.g. https://example.com) while staying on the proxy host;
     * this removes obfuscated segments (e.g. URL shuffling) from the address bar.
     */
    function applyProxyUrlBarMask() {
        try {
            if (!isStrawberryBrowserUiContext()) return;
        } catch (e) {
            return;
        }

        var parseProxyUrl = hammerhead.utils.url.parseProxyUrl;
        if (!parseProxyUrl) return;

        function tryMask() {
            try {
                var visible = window.location.pathname + window.location.search + window.location.hash;
                var href = window.location.href;
                var forParse = href;
                if (window.__strawberryUnshuffleProxyHref) {
                    forParse = window.__strawberryUnshuffleProxyHref(href);
                }
                var parsed = parseProxyUrl(forParse);
                if (!parsed || !parsed.destUrl || !parsed.partAfterHost) return;
                if (parsed.destUrl.indexOf('about:') === 0) return;

                var m = parsed.partAfterHost.match(/^(\/[^/]+\/)([\s\S]*)$/);
                if (!m) return;

                var newPartAfterHost = m[1] + parsed.destUrl;
                if (newPartAfterHost === visible) return;

                history.replaceState(history.state, document.title, newPartAfterHost);
            } catch (e) {
                // ignore
            }
        }

        tryMask();
        setTimeout(tryMask, 0);
        window.addEventListener('popstate', tryMask);
    }

    function fixUrlRewrite() {
        const port = location.port || (location.protocol === 'https:' ? '443' : '80');
        const getProxyUrl = hammerhead.utils.url.getProxyUrl;
        hammerhead.utils.url.overrideGetProxyUrl(function (url, opts = {}) {
            if (!opts.proxyPort) {
                opts.proxyPort = port;
            }
            return getProxyUrl(url, opts);
        });
        window.overrideParseProxyUrl(
            (parseProxyUrl$1) =>
                function (url) {
                    const parsed = parseProxyUrl$1(url);
                    if (!parsed || !parsed.proxy) return parsed;
                    if (!parsed.proxy.port) {
                        parsed.proxy.port = port;
                    }
                    return parsed;
                }
        );
    }
    function fixElementGetter() {
        const fixList = {
            HTMLAnchorElement: ['href'],
            HTMLAreaElement: ['href'],
            HTMLBaseElement: ['href'],
            HTMLEmbedElement: ['src'],
            HTMLFormElement: ['action'],
            HTMLFrameElement: ['src'],
            HTMLIFrameElement: ['src'],
            HTMLImageElement: ['src'],
            HTMLInputElement: ['src'],
            HTMLLinkElement: ['href'],
            HTMLMediaElement: ['src'],
            HTMLModElement: ['cite'],
            HTMLObjectElement: ['data'],
            HTMLQuoteElement: ['cite'],
            HTMLScriptElement: ['src'],
            HTMLSourceElement: ['src'],
            HTMLTrackElement: ['src']
        };
        const urlRewrite = (url) => (hammerhead.utils.url.parseProxyUrl(url) || {}).destUrl || url;
        for (const ElementClass in fixList) {
            for (const attr of fixList[ElementClass]) {
                if (!window[ElementClass]) {
                    console.warn('unexpected unsupported element class ' + ElementClass);
                    continue;
                }
                const desc = Object.getOwnPropertyDescriptor(window[ElementClass].prototype, attr);
                const originalGet = desc.get;
                desc.get = function () {
                    return urlRewrite(originalGet.call(this));
                };
                if (attr === 'action') {
                    const originalSet = desc.set;
                    // don't shuffle form action urls
                    desc.set = function (value) {
                        noShuffling = true;
                        try {
                            var returnVal = originalSet.call(this, value);
                        } catch (e) {
                            noShuffling = false;
                            throw e;
                        }
                        noShuffling = false;
                        return returnVal;
                    };
                }
                Object.defineProperty(window[ElementClass].prototype, attr, desc);
            }
        }
    }
    function fixCrossWindowLocalStorage() {
        // completely replace hammerhead's implementation as restore() and save() on every
        // call is just not viable (mainly memory issues as the garbage collector is sometimes not fast enough)

        const getLocHost = win => (new URL(hammerhead.utils.url.parseProxyUrl(win.location.href).destUrl)).host;
        const prefix = win => `rammerhead|storage-wrapper|${hammerhead.settings._settings.sessionId}|${
            getLocHost(win)
        }|`;
        const toRealStorageKey = (key = '', win = window) => prefix(win) + key;
        const fromRealStorageKey = (key = '', win = window) => {
            if (!key.startsWith(prefix(win))) return null;
            return key.slice(prefix.length);
        };

        const replaceStorageInstance = (storageProp, realStorage) => {
            const reservedProps = ['internal', 'clear', 'key', 'getItem', 'setItem', 'removeItem', 'length'];
            Object.defineProperty(window, storageProp, {
                // define a value-based instead of getter-based property, since with this localStorage implementation,
                // we don't need to rely on sharing a single memory-based storage across frames, unlike hammerhead
                configurable: true,
                writable: true,
                // still use window[storageProp] as basis to allow scripts to access localStorage.internal
                value: new Proxy(window[storageProp], {
                    get(target, prop, receiver) {
                        if (reservedProps.includes(prop) && prop !== 'length') {
                            return Reflect.get(target, prop, receiver);
                        } else if (prop === 'length') {
                            let len = 0;
                            for (const [key] of Object.entries(realStorage)) {
                                if (fromRealStorageKey(key)) len++;
                            }
                            return len;
                        } else {
                            return realStorage[toRealStorageKey(prop)];
                        }
                    },
                    set(_, prop, value) {
                        if (!reservedProps.includes(prop)) {
                            realStorage[toRealStorageKey(prop)] = value;
                        }
                        return true;
                    },
                    deleteProperty(_, prop) {
                        delete realStorage[toRealStorageKey(prop)];
                        return true;
                    },
                    has(target, prop) {
                        return toRealStorageKey(prop) in realStorage || prop in target;
                    },
                    ownKeys() {
                        const list = [];
                        for (const [key] of Object.entries(realStorage)) {
                            const proxyKey = fromRealStorageKey(key);
                            if (proxyKey && !reservedProps.includes(proxyKey)) list.push(proxyKey);
                        }
                        return list;
                    },
                    getOwnPropertyDescriptor(_, prop) {
                        return Object.getOwnPropertyDescriptor(realStorage, toRealStorageKey(prop));
                    },
                    defineProperty(_, prop, desc) {
                        if (!reservedProps.includes(prop)) {
                            Object.defineProperty(realStorage, toRealStorageKey(prop), desc);
                        }
                        return true;
                    }
                })
            });
        };
        const rewriteFunction = (prop, newFunc) => {
            Storage.prototype[prop] = new Proxy(Storage.prototype[prop], {
                apply(_, thisArg, args) {
                    return newFunc.apply(thisArg, args);
                }
            });
        };

        replaceStorageInstance('localStorage', hammerhead.storages.localStorageProxy.internal.nativeStorage);
        replaceStorageInstance('sessionStorage', hammerhead.storages.sessionStorageProxy.internal.nativeStorage);
        rewriteFunction('clear', function () {
            for (const [key] of Object.entries(this)) {
                delete this[key];
            }
        });
        rewriteFunction('key', function (keyNum) {
            return (Object.entries(this)[keyNum] || [])[0] || null;
        });
        rewriteFunction('getItem', function (key) {
            return this.internal.nativeStorage[toRealStorageKey(key, this.internal.ctx)] || null;
        });
        rewriteFunction('setItem', function (key, value) {
            if (key) {
                this.internal.nativeStorage[toRealStorageKey(key, this.internal.ctx)] = value;
            }
        });
        rewriteFunction('removeItem', function (key) {
            delete this.internal.nativeStorage[toRealStorageKey(key, this.internal.ctx)];
        });
    }

    function hookHammerheadStartOnce(callback) {
        var originalStart = hammerhead.__proto__.start;
        hammerhead.__proto__.start = function () {
            originalStart.apply(this, arguments);
            hammerhead.__proto__.start = originalStart;
            callback();
        };
    }
})();
