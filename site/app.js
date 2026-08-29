/* Signals plugin registry browser. Reads index.json alongside this page. */

(function () {
    'use strict';

    var results = document.getElementById('results');
    var message = document.getElementById('message');
    var resultCount = document.getElementById('result-count');
    var searchInput = document.getElementById('q');
    var tierSelect = document.getElementById('tier');
    var yankedToggle = document.getElementById('show-yanked');
    var controls = document.querySelector('.controls');

    var plugins = [];

    /* ---- Theme -------------------------------------------------------- */
    /* The stored preference is applied before first paint by the inline
       script in the document head; this only keeps the toggle in sync. */

    var THEME_KEY = 'signals-registry-theme';

    function storeTheme(theme) {
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (error) {
            /* Storage unavailable: the choice simply does not persist. */
        }
    }

    function syncThemeButton(button) {
        var dark = document.documentElement.classList.contains('dark');
        button.setAttribute('aria-pressed', dark ? 'true' : 'false');
        button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }

    function setUpTheme() {
        var button = document.getElementById('theme-toggle');
        if (!button) {
            return;
        }

        syncThemeButton(button);

        button.addEventListener('click', function () {
            var dark = document.documentElement.classList.toggle('dark');
            storeTheme(dark ? 'dark' : 'light');
            syncThemeButton(button);
        });
    }

    function showMessage(title, detail) {
        message.innerHTML = '';
        var heading = document.createElement('h2');
        heading.textContent = title;
        message.appendChild(heading);
        if (detail) {
            var paragraph = document.createElement('p');
            paragraph.textContent = detail;
            message.appendChild(paragraph);
        }
        message.hidden = false;
    }

    function hideMessage() {
        message.hidden = true;
    }

    function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined && text !== null) {
            node.textContent = text;
        }
        return node;
    }

    function badge(label, kind) {
        return element('span', 'badge badge-' + kind, label);
    }

    function displayName(plugin) {
        if (plugin.latest && plugin.latest.name) {
            return plugin.latest.name;
        }
        return plugin.package.split('/')[1] || plugin.package;
    }

    function searchText(plugin) {
        var parts = [plugin.package, plugin.description, displayName(plugin)];
        if (plugin.keywords) {
            parts = parts.concat(plugin.keywords);
        }
        return parts.join(' ').toLowerCase();
    }

    function definition(list, term, value) {
        list.appendChild(element('dt', null, term));
        var dd = element('dd');
        if (typeof value === 'string') {
            dd.textContent = value;
        } else {
            dd.appendChild(value);
        }
        list.appendChild(dd);
    }

    function buildCard(plugin) {
        var card = element('article', 'card');

        var head = element('div', 'card-head');
        var titleWrap = element('div');
        titleWrap.appendChild(element('h2', null, displayName(plugin)));
        titleWrap.appendChild(element('p', 'package', plugin.package));
        head.appendChild(titleWrap);

        var badges = element('div', 'badges');
        badges.appendChild(
            plugin.tier === 'verified'
                ? badge('Verified', 'verified')
                : badge('Community', 'community')
        );
        if (plugin.status === 'deprecated') {
            badges.appendChild(badge('Deprecated', 'deprecated'));
        }
        if (plugin.status === 'yanked') {
            badges.appendChild(badge('Yanked', 'yanked'));
        }
        if (plugin.enrichment === 'stale') {
            badges.appendChild(badge('Stale', 'stale'));
        }
        if (!plugin.latest) {
            badges.appendChild(badge('No release', 'unavailable'));
        }
        head.appendChild(badges);
        card.appendChild(head);

        card.appendChild(element('p', 'summary', plugin.description));

        if (plugin.status_reason && plugin.status !== 'active') {
            card.appendChild(element('p', 'notice', plugin.status_reason));
        }

        var meta = element('dl', 'meta');

        if (plugin.latest) {
            definition(meta, 'Latest', element('span', 'mono', plugin.latest.version));
            definition(
                meta,
                'Requires',
                element('span', 'mono', 'Signals ' + plugin.latest.signals_version)
            );
        } else {
            definition(meta, 'Latest', 'No usable release found in the source repository.');
        }

        if (plugin.tier === 'verified' && plugin.verification) {
            var reviewed = plugin.verification.reviewed_version;
            var suffix =
                plugin.latest && plugin.latest.version !== reviewed
                    ? ' (later releases are not automatically verified)'
                    : '';
            definition(
                meta,
                'Reviewed',
                reviewed + ' on ' + plugin.verification.reviewed_at + suffix
            );
        }

        if (plugin.latest && plugin.latest.network && plugin.latest.network.length) {
            var hosts = element('div', 'hosts');
            plugin.latest.network.forEach(function (host) {
                hosts.appendChild(element('span', 'host', host));
            });
            definition(meta, 'Talks to', hosts);
        }

        if (plugin.license) {
            definition(meta, 'Licence', plugin.license);
        }

        if (plugin.authors && plugin.authors.length) {
            definition(
                meta,
                plugin.authors.length > 1 ? 'Authors' : 'Author',
                plugin.authors
                    .map(function (author) {
                        return author.name;
                    })
                    .join(', ')
            );
        }

        card.appendChild(meta);

        if (plugin.keywords && plugin.keywords.length) {
            var keywords = element('ul', 'keywords');
            plugin.keywords.forEach(function (keyword) {
                keywords.appendChild(element('li', 'keyword', keyword));
            });
            card.appendChild(keywords);
        }

        if (plugin.latest) {
            var installCommand =
                'git clone --depth 1 --branch ' +
                plugin.latest.tag +
                ' ' +
                plugin.source.url;

            var install = element('div', 'install');
            var code = element('code', null, installCommand);
            install.appendChild(code);

            var copy = element('button', 'copy', 'Copy');
            copy.type = 'button';
            copy.addEventListener('click', function () {
                copyText(installCommand, copy);
            });
            install.appendChild(copy);
            card.appendChild(install);
        }

        var foot = element('div', 'card-foot');
        var repoLink = element('a', null, 'Source repository');
        repoLink.href = plugin.source.url.replace(/\.git$/, '');
        repoLink.rel = 'noopener';
        foot.appendChild(repoLink);

        if (plugin.homepage) {
            var homeLink = element('a', null, 'Homepage');
            homeLink.href = plugin.homepage;
            homeLink.rel = 'noopener';
            foot.appendChild(homeLink);
        }

        card.appendChild(foot);

        return card;
    }

    function copyText(text, button) {
        var original = button.textContent;
        var done = function (label) {
            button.textContent = label;
            setTimeout(function () {
                button.textContent = original;
            }, 1500);
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
                function () {
                    done('Copied');
                },
                function () {
                    done('Press ⌘C');
                }
            );
            return;
        }

        done('Press ⌘C');
    }

    function render() {
        var query = searchInput.value.trim().toLowerCase();
        var tier = tierSelect.value;
        var includeYanked = yankedToggle.checked;

        var visible = plugins.filter(function (plugin) {
            if (!includeYanked && plugin.status === 'yanked') {
                return false;
            }
            if (tier !== 'all' && plugin.tier !== tier) {
                return false;
            }
            if (query && searchText(plugin).indexOf(query) === -1) {
                return false;
            }
            return true;
        });

        results.innerHTML = '';
        visible.forEach(function (plugin) {
            results.appendChild(buildCard(plugin));
        });

        if (plugins.length === 0) {
            resultCount.textContent = '';
            showMessage(
                'No plugins listed yet',
                'The registry is empty. See the contributing guide to submit the first plugin.'
            );
            return;
        }

        if (visible.length === 0) {
            resultCount.textContent = '';
            showMessage('No matches', 'No plugin matches the current search and filters.');
            return;
        }

        hideMessage();
        var hidden = plugins.length - visible.length;
        resultCount.textContent =
            visible.length +
            (visible.length === 1 ? ' plugin' : ' plugins') +
            (hidden > 0 ? ' (' + hidden + ' hidden by filters)' : '');
    }

    function start() {
        setUpTheme();

        controls.addEventListener('input', render);
        controls.addEventListener('change', render);
        controls.addEventListener('submit', function (event) {
            event.preventDefault();
        });

        fetch('index.json', { cache: 'no-cache' })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.json();
            })
            .then(function (index) {
                if (!index || !Array.isArray(index.plugins)) {
                    throw new Error('index.json is not in the expected format');
                }
                plugins = index.plugins;
                render();
            })
            .catch(function (error) {
                results.innerHTML = '';
                resultCount.textContent = '';
                showMessage(
                    'Could not load the registry index',
                    'index.json could not be fetched (' + error.message + '). Try again shortly.'
                );
            });
    }

    start();
})();
