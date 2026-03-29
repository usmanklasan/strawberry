(function () {
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

    function setError(err) {
        var element = document.getElementById('error-text');
        if (err) {
            if (!element) return;
            element.style.display = 'block';
            element.textContent = 'An error occurred: ' + err;
        } else {
            if (!element) return;
            element.style.display = 'none';
            element.textContent = '';
        }
    }
    function getPassword() {
        var element = document.getElementById('session-password');
        return element ? element.value : '';
    }
    function get(url, callback, shush = false) {
        var pwd = getPassword();
        if (pwd) {
            // really cheap way of adding a query parameter
            if (url.includes('?')) {
                url += '&pwd=' + pwd;
            } else {
                url += '?pwd=' + pwd;
            }
        }

        var request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.send();

        request.onerror = function () {
            if (!shush) setError('Cannot communicate with the server');
        };
        request.onload = function () {
            if (request.status === 200) {
                callback(request.responseText);
            } else {
                if (request.responseText === 'bad password') {
                    var wrapper = document.getElementById('password-wrapper');
                    if (wrapper) wrapper.style.display = '';
                    if (!shush) setError('Bad password. Please try again.');
                    return;
                }
                if (!shush)
                    setError(
                        'unexpected server response to not match "200". Server says "' + request.responseText + '"'
                    );
            }
        };
    }

    var api = {
        needpassword(callback) {
            get('/needpassword', value => callback(value === 'true'));
        },
        newsession(callback) {
            get('/newsession', callback);
        },
        editsession(id, httpProxy, enableShuffling, callback) {
            get(
                '/editsession?id=' +
                encodeURIComponent(id) +
                (httpProxy ? '&httpProxy=' + encodeURIComponent(httpProxy) : '') +
                '&enableShuffling=' + (enableShuffling ? '1' : '0'),
                function (res) {
                    if (res !== 'Success') return setError('unexpected response from server. received ' + res);
                    callback();
                }
            );
        },
        sessionexists(id, callback) {
            get('/sessionexists?id=' + encodeURIComponent(id), function (res) {
                if (res === 'exists') return callback(true);
                if (res === 'not found') return callback(false);
                setError('unexpected response from server. received' + res);
            });
        },
        deletesession(id, callback) {
            api.sessionexists(id, function (exists) {
                if (exists) {
                    get('/deletesession?id=' + id, function (res) {
                        if (res !== 'Success' && res !== 'not found')
                            return setError('unexpected response from server. received ' + res);
                        callback();
                    });
                } else {
                    callback();
                }
            });
        },
        shuffleDict(id, callback) {
            get('/api/shuffleDict?id=' + encodeURIComponent(id), function (res) {
                callback(JSON.parse(res));
            });
        }
    };

    var localStorageKey = 'rammerhead_sessionids';
    var localStorageKeyDefault = 'rammerhead_default_sessionid';
    var sessionIdsStore = {
        get() {
            var rawData = localStorage.getItem(localStorageKey);
            if (!rawData) return [];
            try {
                var data = JSON.parse(rawData);
                if (!Array.isArray(data)) throw 'getout';
                return data;
            } catch (e) {
                return [];
            }
        },
        set(data) {
            if (!data || !Array.isArray(data)) throw new TypeError('must be array');
            localStorage.setItem(localStorageKey, JSON.stringify(data));
        },
        getDefault() {
            var sessionId = localStorage.getItem(localStorageKeyDefault);
            if (sessionId) {
                var data = sessionIdsStore.get();
                data.filter(function (e) {
                    return e.id === sessionId;
                });
                if (data.length) return data[0];
            }
            return null;
        },
        setDefault(id) {
            localStorage.setItem(localStorageKeyDefault, id);
        }
    };

    function renderSessionTable(data) {
        var tbody = document.querySelector('tbody');
        while (tbody.firstChild && !tbody.firstChild.remove());
        for (var i = 0; i < data.length; i++) {
            var tr = document.createElement('tr');
            appendIntoTr(data[i].id);
            appendIntoTr(data[i].createdOn);

            var fillInBtn = document.createElement('button');
            fillInBtn.textContent = 'Fill in existing session ID';
            fillInBtn.className = 'btn btn-outline-primary';
            fillInBtn.onclick = index(i, function (idx) {
                setError();
                sessionIdsStore.setDefault(data[idx].id);
                loadSettings(data[idx]);
            });
            appendIntoTr(fillInBtn);

            var deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'btn btn-outline-danger';
            deleteBtn.onclick = index(i, function (idx) {
                setError();
                api.deletesession(data[idx].id, function () {
                    data.splice(idx, 1)[0];
                    sessionIdsStore.set(data);
                    renderSessionTable(data);
                });
            });
            appendIntoTr(deleteBtn);

            tbody.appendChild(tr);
        }
        function appendIntoTr(stuff) {
            var td = document.createElement('td');
            if (typeof stuff === 'object') {
                td.appendChild(stuff);
            } else {
                td.textContent = stuff;
            }
            tr.appendChild(td);
        }
        function index(i, func) {
            return func.bind(null, i);
        }
    }
    function loadSettings(session) {
        document.getElementById('session-id').value = session.id;
        document.getElementById('session-httpproxy').value = session.httpproxy || '';
        document.getElementById('session-shuffling').checked = typeof session.enableShuffling === 'boolean' ? session.enableShuffling : true;
    }
    function loadSessions() {
        var sessions = sessionIdsStore.get();
        var defaultSession = sessionIdsStore.getDefault();
        if (defaultSession) loadSettings(defaultSession);
        renderSessionTable(sessions);
    }
    function addSession(id) {
        var data = sessionIdsStore.get();
        data.unshift({ id: id, createdOn: new Date().toLocaleString() });
        sessionIdsStore.set(data);
        renderSessionTable(data);
    }
    function editSession(id, httpproxy, enableShuffling) {
        var data = sessionIdsStore.get();
        for (var i = 0; i < data.length; i++) {
            if (data[i].id === id) {
                data[i].httpproxy = httpproxy;
                data[i].enableShuffling = enableShuffling;
                sessionIdsStore.set(data);
                return;
            }
        }
        throw new TypeError('cannot find ' + id);
    }

    var CLOAK_KEY = 'strawberry_ab_cloak';

    function useIframeCloak() {
        return localStorage.getItem(CLOAK_KEY) !== '0';
    }

    var lunarTabs = [];
    var lunarActiveTabId = null;
    var lunarTabSeq = 0;

    function getOrInitTabs() {
        if (lunarTabs.length) return;
        var frame = document.getElementById('proxy-frame');
        if (!frame) return;
        lunarTabs.push({ id: 't0', iframe: frame, showHome: true, label: 'Tab 1' });
        lunarActiveTabId = 't0';
        lunarTabSeq = 0;
    }

    function getActiveTab() {
        getOrInitTabs();
        for (var i = 0; i < lunarTabs.length; i++) {
            if (lunarTabs[i].id === lunarActiveTabId) return lunarTabs[i];
        }
        return lunarTabs[0];
    }

    function getActiveFrame() {
        var t = getActiveTab();
        return t ? t.iframe : null;
    }

    function isShellProxyFrameSource(win) {
        getOrInitTabs();
        for (var i = 0; i < lunarTabs.length; i++) {
            try {
                if (lunarTabs[i].iframe.contentWindow === win) return true;
            } catch (e) {
                // ignore
            }
        }
        return false;
    }

    function shortenTabLabel(pathSuffix) {
        try {
            var u = decodeURIComponent(String(pathSuffix || ''));
            if (u.length > 36) u = u.slice(0, 33) + '\u2026';
            return u || 'Browse';
        } catch (e) {
            return 'Browse';
        }
    }

    function renderTabBar() {
        var bar = document.getElementById('lunar-tabbar');
        if (!bar) return;
        if (lunarTabs.length < 2) {
            bar.hidden = true;
            while (bar.firstChild) bar.removeChild(bar.firstChild);
            return;
        }
        bar.hidden = false;
        while (bar.firstChild) bar.removeChild(bar.firstChild);
        for (var i = 0; i < lunarTabs.length; i++) {
            var tab = lunarTabs[i];
            var wrap = document.createElement('div');
            wrap.className = 'lunar-tab-wrap';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lunar-tab' + (tab.id === lunarActiveTabId ? ' is-active' : '');
            btn.textContent = tab.label || tab.id;
            btn.title = btn.textContent;
            (function (tid) {
                btn.addEventListener('click', function () {
                    lunarActivateTab(tid);
                });
            })(tab.id);
            wrap.appendChild(btn);
            if (tab.iframe && tab.iframe.id !== 'proxy-frame') {
                var close = document.createElement('button');
                close.type = 'button';
                close.className = 'lunar-tab-close';
                close.innerHTML = '\u00d7';
                close.setAttribute('aria-label', 'Close tab');
                (function (tid) {
                    close.addEventListener('click', function (e) {
                        e.stopPropagation();
                        lunarCloseTab(tid);
                    });
                })(tab.id);
                wrap.appendChild(close);
            }
            bar.appendChild(wrap);
        }
    }

    function lunarActivateTab(tabId) {
        getOrInitTabs();
        var found = false;
        for (var i = 0; i < lunarTabs.length; i++) {
            if (lunarTabs[i].id === tabId) found = true;
        }
        if (!found) return;
        lunarActiveTabId = tabId;
        var home = document.getElementById('lunar-home');
        for (var j = 0; j < lunarTabs.length; j++) {
            var t = lunarTabs[j];
            if (t.id === tabId) {
                if (t.showHome) {
                    if (home) home.classList.remove('is-hidden');
                    t.iframe.classList.remove('is-visible');
                } else {
                    if (home) home.classList.add('is-hidden');
                    t.iframe.classList.add('is-visible');
                }
            } else {
                t.iframe.classList.remove('is-visible');
            }
        }
        renderTabBar();
    }

    function createProxyIframeElement(idSuffix) {
        var f = document.createElement('iframe');
        f.id = 'strawberry-frame-' + idSuffix;
        f.className = 'lunar-frame';
        f.setAttribute('name', 'strawberry-proxy');
        f.setAttribute('data-strawberry-proxy', '1');
        f.title = 'Browsing';
        f.setAttribute(
            'sandbox',
            'allow-scripts allow-forms allow-popups allow-modals allow-same-origin allow-pointer-lock allow-downloads'
        );
        return f;
    }

    function lunarAddTab() {
        if (!useIframeCloak()) {
            window.open(window.location.origin + '/', '_blank', 'noopener,noreferrer');
            return;
        }
        getOrInitTabs();
        lunarTabSeq++;
        var tid = 't' + lunarTabSeq;
        var stack = document.getElementById('lunar-frame-stack');
        if (!stack) return;
        var iframe = createProxyIframeElement(tid);
        stack.appendChild(iframe);
        var n = lunarTabs.length + 1;
        lunarTabs.push({ id: tid, iframe: iframe, showHome: true, label: 'Tab ' + n });
        lunarActivateTab(tid);
        setPathHint('new');
        var input = document.getElementById('session-url');
        if (input) input.value = '';
        setError();
        var ping = document.getElementById('lunar-ping');
        if (ping) ping.textContent = 'Ready';
    }

    function lunarResetActiveTab() {
        getOrInitTabs();
        var t = getActiveTab();
        if (!t) return;
        t.showHome = true;
        if (t.iframe) {
            t.iframe.src = 'about:blank';
            t.iframe.classList.remove('is-visible');
        }
        var home = document.getElementById('lunar-home');
        if (home) home.classList.remove('is-hidden');
        setPathHint('new');
        var input = document.getElementById('session-url');
        if (input) input.value = '';
        setError();
        var ping = document.getElementById('lunar-ping');
        if (ping) ping.textContent = 'Ready';
        lunarActivateTab(t.id);
    }

    function lunarCloseTab(tabId) {
        getOrInitTabs();
        if (lunarTabs.length <= 1) return;
        var idx = -1;
        for (var i = 0; i < lunarTabs.length; i++) {
            if (lunarTabs[i].id === tabId) {
                idx = i;
                break;
            }
        }
        if (idx < 0) return;
        var removed = lunarTabs[idx];
        if (!removed.iframe || removed.iframe.id === 'proxy-frame') return;
        var wasActive = removed.id === lunarActiveTabId;
        removed.iframe.parentNode.removeChild(removed.iframe);
        lunarTabs.splice(idx, 1);
        if (wasActive) {
            var pick = lunarTabs[Math.max(0, idx - 1)] || lunarTabs[0];
            lunarActiveTabId = pick.id;
            lunarActivateTab(pick.id);
        } else {
            renderTabBar();
        }
    }

    function setPathHint(text) {
        var hint = document.getElementById('lunar-path-hint');
        if (hint) hint.textContent = text;
    }

    function navigateProxy(id, pathSuffix) {
        var dest = '/' + id + '/' + pathSuffix;
        var frame = getActiveFrame();
        var home = document.getElementById('lunar-home');
        if (useIframeCloak() && frame) {
            getOrInitTabs();
            var at = getActiveTab();
            if (at) {
                at.showHome = false;
                at.label = shortenTabLabel(pathSuffix);
            }
            if (home) home.classList.add('is-hidden');
            frame.classList.add('is-visible');
            var t0 = performance.now();
            frame.onload = function () {
                var ping = document.getElementById('lunar-ping');
                if (ping) ping.textContent = 'Frame: ' + Math.round(performance.now() - t0) + 'ms';
            };
            frame.src = dest;
            setPathHint('browse');
            renderTabBar();
        } else {
            window.location.href = dest;
        }
    }

    function lunarReloadFrame() {
        var frame = getActiveFrame();
        if (!frame || !frame.classList.contains('is-visible')) return;
        try {
            if (frame.contentWindow && frame.contentWindow.location && frame.contentWindow.location.href !== 'about:blank') {
                frame.contentWindow.location.reload();
                return;
            }
        } catch (e) {
            // ignore
        }
        var src = frame.src;
        if (src) frame.src = src;
    }

    window.addEventListener('message', function (ev) {
        if (ev.origin !== window.location.origin) return;
        if (!ev.data) return;
        getOrInitTabs();
        if (!isShellProxyFrameSource(ev.source)) return;
        if (ev.data.type === 'strawberry-dock-home') {
            lunarResetActiveTab();
            return;
        }
        if (ev.data.type === 'strawberry-dock-new-tab') {
            lunarAddTab();
        }
    });

    function lunarToggleSidebar(open) {
        var side = document.getElementById('lunar-sidebar');
        var btn = document.getElementById('lunar-sidebar-toggle');
        if (!side) return;
        var isOpen = typeof open === 'boolean' ? open : !side.classList.contains('is-open');
        side.classList.toggle('is-open', isOpen);
        if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    function lunarSyncCloakButton() {
        var btn = document.getElementById('lunar-action-cloak');
        if (btn) btn.setAttribute('aria-pressed', useIframeCloak() ? 'true' : 'false');
    }

    /** aria-pressed=true when dark theme is active (body does not have .lunar-light). */
    function lunarSyncDarkButton() {
        var btn = document.getElementById('lunar-action-dark');
        if (!btn) return;
        var darkOn = !document.body.classList.contains('lunar-light');
        btn.setAttribute('aria-pressed', darkOn ? 'true' : 'false');
    }

    get('/mainport', function (data) {
        var defaultPort = window.location.protocol === 'https:' ? 443 : 80;
        var currentPort = window.location.port || defaultPort;
        var mainPort = data || defaultPort;
        if (currentPort != mainPort) window.location.port = mainPort;
    });

    api.needpassword(doNeed => {
        if (doNeed) {
            var wrapper = document.getElementById('password-wrapper');
            if (wrapper) wrapper.style.display = '';
        }
    });

    function ensureDefaultSession(cb) {
        try {
            var existing = document.getElementById('session-id');
            if (existing && existing.value) return cb(existing.value);
        } catch (e) {
            // ignore
        }

        var defaultSession = null;
        try {
            defaultSession = sessionIdsStore.getDefault();
        } catch (e) {
            defaultSession = null;
        }
        if (defaultSession && defaultSession.id) {
            var idEl = document.getElementById('session-id');
            if (idEl) idEl.value = defaultSession.id;
            return cb(defaultSession.id);
        }

        api.newsession(function (id) {
            try {
                addSession(id);
                sessionIdsStore.setDefault(id);
            } catch (e) {
                // ignore
            }
            var idEl = document.getElementById('session-id');
            if (idEl) idEl.value = id;
            cb(id);
        });
    }

    function shouldSkipAdblockGate() {
        try {
            if (/[?&]noadblock=1(?:&|$)/.test(location.search)) {
                sessionStorage.setItem('strawberry_adblock_bypass', '1');
                try {
                    var u = new URL(location.href);
                    u.searchParams.delete('noadblock');
                    history.replaceState(null, '', u.pathname + u.search + u.hash);
                } catch (e) {
                    /* ignore */
                }
                return true;
            }
            if (sessionStorage.getItem('strawberry_adblock_bypass') === '1') return true;
        } catch (e) {
            /* ignore */
        }
        return false;
    }

    function cosmeticAdblockProbe() {
        var d = document.createElement('div');
        d.className = 'adsbox strawberry-ad-probe';
        d.setAttribute('aria-hidden', 'true');
        d.style.cssText = 'position:absolute;left:-9999px;width:100px;height:20px;';
        document.body.appendChild(d);
        var blocked = false;
        try {
            var st = window.getComputedStyle(d);
            if (st.display === 'none' || st.visibility === 'hidden') blocked = true;
            else if (d.offsetHeight < 1) blocked = true;
        } catch (e) {
            /* ignore */
        }
        d.remove();
        return blocked;
    }

    function scriptBaitProbe(cb) {
        var s = document.createElement('script');
        var done = false;
        var to = setTimeout(function () {
            if (done) return;
            done = true;
            cb(true);
        }, 2200);
        s.onload = function () {
            if (done) return;
            done = true;
            clearTimeout(to);
            cb(false);
        };
        s.onerror = function () {
            if (done) return;
            done = true;
            clearTimeout(to);
            cb(true);
        };
        s.src = '/show_ads.js?t=' + encodeURIComponent(String(Date.now()));
        document.head.appendChild(s);
    }

    function detectAdblock(cb) {
        if (cosmeticAdblockProbe()) {
            cb(true);
            return;
        }
        scriptBaitProbe(function (blocked) {
            cb(!!blocked);
        });
    }

    function wireAdblockWall() {
        var host = document.querySelector('.strawberry-adblock-host');
        if (host) host.textContent = location.hostname || 'this site';
        var retry = document.getElementById('strawberry-adblock-retry');
        if (retry)
            retry.onclick = function () {
                location.reload();
            };
        var bypass = document.getElementById('strawberry-adblock-bypass');
        if (bypass)
            bypass.onclick = function (e) {
                e.preventDefault();
                try {
                    sessionStorage.setItem('strawberry_adblock_bypass', '1');
                } catch (err) {
                    /* ignore */
                }
                location.reload();
            };
    }

    window.addEventListener('load', function () {
        function initStrawberryShell() {
        // Make the homepage logo look like a cutout by removing near-white pixels.
        (function tryTransparentLogoBackground() {
            try {
                var img = document.querySelector('.lunar-brand-icon');
                if (!img) return;
                if (img.dataset && img.dataset.cleaned === '1') return;

                function process() {
                    try {
                        var canvas = document.createElement('canvas');
                        var w = img.naturalWidth || img.width || 0;
                        var h = img.naturalHeight || img.height || 0;
                        if (!w || !h) return;
                        canvas.width = w;
                        canvas.height = h;
                        var ctx = canvas.getContext('2d');
                        if (!ctx) return;
                        ctx.drawImage(img, 0, 0);
                        var imageData = ctx.getImageData(0, 0, w, h);
                        var d = imageData.data;
                        for (var i = 0; i < d.length; i += 4) {
                            var r = d[i];
                            var g = d[i + 1];
                            var b = d[i + 2];
                            // If pixel is close to white, make it transparent (soft threshold).
                            if (r > 245 && g > 245 && b > 245) {
                                d[i + 3] = 0;
                            }
                        }
                        ctx.putImageData(imageData, 0, 0);
                        img.src = canvas.toDataURL('image/png');
                        if (img.dataset) img.dataset.cleaned = '1';
                    } catch (e) {
                        // ignore
                    }
                }

                if (img.complete && img.naturalWidth) process();
                else img.addEventListener('load', process, { once: true });
            } catch (e) {
                // ignore
            }
        })();

        try {
            loadSessions();
        } catch (e) {
            // ok if sessions table isn't visible
        }
        ensureDefaultSession(function () {});

        var showingAdvancedOptions = false;
        var advancedToggle = document.getElementById('session-advanced-toggle');
        if (advancedToggle)
            advancedToggle.onclick = function () {
            // eslint-disable-next-line no-cond-assign
            document.getElementById('session-advanced-container').style.display = (showingAdvancedOptions =
                !showingAdvancedOptions)
                ? 'block'
                : 'none';
        };

        var createBtn = document.getElementById('session-create-btn');
        if (createBtn)
            createBtn.onclick = function () {
            setError();
            api.newsession(function (id) {
                addSession(id);
                document.getElementById('session-id').value = id;
                document.getElementById('session-httpproxy').value = '';
                try {
                    sessionIdsStore.setDefault(id);
                } catch (e) {
                    // ignore
                }
            });
        };
        function go() {
            setError();
            ensureDefaultSession(function (id) {
                var httpproxyEl = document.getElementById('session-httpproxy');
                var shufflingEl = document.getElementById('session-shuffling');
                var urlEl = document.getElementById('session-url');

                var httpproxy = httpproxyEl ? httpproxyEl.value : '';
                var enableShuffling = shufflingEl ? shufflingEl.checked : true;
                var rawInput = (urlEl && urlEl.value) ? urlEl.value : '';
                rawInput = String(rawInput).trim();

                function normalizeInputToUrl(input) {
                    if (!input) return 'https://duckduckgo.com/';

                    // Already a URL with scheme
                    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) return input;

                    // Common domain patterns (no scheme)
                    if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/|$)/.test(input)) return 'https://' + input;

                    // Otherwise treat as search query
                    return 'https://duckduckgo.com/?q=' + encodeURIComponent(input) + '&ia=web';
                }

                var url = normalizeInputToUrl(rawInput);
                // Avoid breaking the proxy route with spaces/unescaped characters.
                url = encodeURI(url);

                api.sessionexists(id, function (value) {
                    if (!value) {
                        // session got deleted server-side; recreate
                        return api.newsession(function (newId) {
                            try {
                                addSession(newId);
                                sessionIdsStore.setDefault(newId);
                            } catch (e) {
                                // ignore
                            }
                            var idEl = document.getElementById('session-id');
                            if (idEl) idEl.value = newId;
                            go();
                        });
                    }
                    api.editsession(id, httpproxy, enableShuffling, function () {
                        try {
                            editSession(id, httpproxy, enableShuffling);
                        } catch (e) {
                            // ignore if not in table
                        }
                        api.shuffleDict(id, function (shuffleDict) {
                            if (!shuffleDict) {
                                navigateProxy(id, url);
                            } else {
                                var shuffler = new StrShuffler(shuffleDict);
                                navigateProxy(id, shuffler.shuffle(url));
                            }
                        });
                    });
                });
            });
        }
        var goBtn = document.getElementById('session-go');
        if (goBtn) goBtn.onclick = go;
        var urlBox = document.getElementById('session-url');
        if (urlBox)
            urlBox.onkeydown = function (event) {
                if (event.key === 'Enter') go();
            };

        (function lunarClock() {
            function tick() {
                var el = document.getElementById('lunar-clock');
                if (!el) return;
                el.textContent = new Date().toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }
            tick();
            setInterval(tick, 1000);
        })();

        document.querySelectorAll('.lunar-shortcut').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var u = btn.getAttribute('data-quick-url');
                var input = document.getElementById('session-url');
                if (input && u) input.value = u;
                go();
            });
        });

        var sideToggle = document.getElementById('lunar-sidebar-toggle');
        if (sideToggle)
            sideToggle.addEventListener('click', function () {
                lunarToggleSidebar();
            });
        var sideClose = document.getElementById('lunar-sidebar-close');
        if (sideClose)
            sideClose.addEventListener('click', function () {
                lunarToggleSidebar(false);
            });

        var btnNew = document.getElementById('lunar-action-newtab');
        if (btnNew) btnNew.addEventListener('click', lunarAddTab);
        var btnFs = document.getElementById('lunar-action-fullscreen');
        if (btnFs)
            btnFs.addEventListener('click', function () {
                var app = document.getElementById('lunar-app');
                if (!document.fullscreenElement && app && app.requestFullscreen) app.requestFullscreen();
                else if (document.exitFullscreen) document.exitFullscreen();
            });
        var btnRel = document.getElementById('lunar-action-reload');
        if (btnRel) btnRel.addEventListener('click', lunarReloadFrame);
        var btnDark = document.getElementById('lunar-action-dark');
        if (btnDark) {
            lunarSyncDarkButton();
            btnDark.addEventListener('click', function () {
                document.body.classList.toggle('lunar-light');
                lunarSyncDarkButton();
            });
        }
        var btnCloak = document.getElementById('lunar-action-cloak');
        if (btnCloak) {
            lunarSyncCloakButton();
            btnCloak.addEventListener('click', function () {
                var on = !useIframeCloak();
                localStorage.setItem(CLOAK_KEY, on ? '1' : '0');
                lunarSyncCloakButton();
            });
        }
        var btnHome = document.getElementById('lunar-action-home');
        if (btnHome) btnHome.addEventListener('click', lunarResetActiveTab);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') lunarToggleSidebar(false);
            if (!e.ctrlKey || !e.altKey) return;
            var k = e.key.toLowerCase();
            if (k === 'n') {
                e.preventDefault();
                lunarAddTab();
            } else if (k === 'r') {
                e.preventDefault();
                lunarReloadFrame();
            } else if (k === 'z') {
                e.preventDefault();
                var app = document.getElementById('lunar-app');
                if (!document.fullscreenElement && app && app.requestFullscreen) app.requestFullscreen();
                else if (document.exitFullscreen) document.exitFullscreen();
            } else if (k === 'x') {
                e.preventDefault();
                document.body.classList.toggle('lunar-light');
                lunarSyncDarkButton();
            } else if (k === 'c') {
                e.preventDefault();
                var on = !useIframeCloak();
                localStorage.setItem(CLOAK_KEY, on ? '1' : '0');
                lunarSyncCloakButton();
            }
        });

        document.addEventListener('click', function (e) {
            var side = document.getElementById('lunar-sidebar');
            var toggle = document.getElementById('lunar-sidebar-toggle');
            if (!side || !side.classList.contains('is-open')) return;
            if (side.contains(e.target) || (toggle && toggle.contains(e.target))) return;
            lunarToggleSidebar(false);
        });
        }

        if (shouldSkipAdblockGate()) {
            initStrawberryShell();
            return;
        }
        wireAdblockWall();
        detectAdblock(function (blocked) {
            if (blocked) {
                var wall = document.getElementById('strawberry-adblock-wall');
                if (wall) wall.hidden = false;
                document.body.classList.add('strawberry-adblock-lock');
                return;
            }
            initStrawberryShell();
        });
    });
})();
