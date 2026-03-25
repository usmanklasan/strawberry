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

    window.addEventListener('load', function () {
        // Make the homepage logo look like a cutout by removing near-white pixels.
        (function tryTransparentLogoBackground() {
            try {
                var img = document.querySelector('.cheesy-logo');
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
                                window.location.href = '/' + id + '/' + url;
                            } else {
                                var shuffler = new StrShuffler(shuffleDict);
                                window.location.href = '/' + id + '/' + shuffler.shuffle(url);
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
    });
})();
