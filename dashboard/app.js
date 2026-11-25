// Token Radar's dashboard (radar-2). Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail panel
// with the model's own inputs and the protocol's farm plan, and the live-token set kept
// apart. No network: every byte it shows is in data.js. No framework.
//
// The page recomputes a row's implied value from the snapshot figures and the fitted
// constants, so the page's arithmetic and board.json are visibly the same model. A row
// whose value was nudged by $1 for the strict rank order may differ by that $1.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var F = DATA.fitted;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageFmt(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365.25).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function holdDays(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // The model in one function: TVL x category multiple x growth x size x launch odds.
  function impliedOf(row) {
    var mult = F.multiples[row.category || '(null)'];
    if (mult === undefined) mult = F.global_multiple;
    var g = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, -50, 100) / 100;
    var growth = Math.pow(1 + g, 0.5);
    var size = Math.pow(row.tvl_usd / 1e8, F.size_slope - 1);
    var ageY = (row.age_days === null || row.age_days === undefined ? F.fallback_age_days : row.age_days) / 365.25;
    var f = F.odds_pi * (1 - Math.exp(-F.odds_lambda * Math.max(0, ageY)));
    var adj = F.odds_cat_adj[row.category || '(null)'];
    if (adj === undefined) adj = 1;
    var odds = clamp(((F.odds_pi - f) / (1 - f)) * adj, 0.05, 0.95);
    return Math.max(1, Math.round(row.tvl_usd * mult * growth * size * odds));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    // A fragment is the page's whole shared state: start from the defaults, then apply it.
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false;
    state.tab = 'pre-token'; state.sort = 'implied'; state.dir = -1; state.selected = null;
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('wl') === '1') state.wl = true;
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.wl) p.set('wl', '1');
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.wl && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'hour') { av = a.implied_per_farm_hour_usd; bv = b.implied_per_farm_hour_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, 'TOKEN ', el('b', { text: 'RADAR' })),
      el('span', { class: 'sub', text: 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · ' + DATA.model_version + ' model · ' + F.comparables + ' comparables' })
    );
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied token value' }),
      el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor (' + DATA.early_strict_size + ' of them outside the wrapped / staked / bridged categories). Implied value is a fitted model, not a price.' })
    );
  }
  function strip() {
    var v = DATA.validation;
    function kpi(label, big, small) {
      return el('div', { class: 'kpi' }, el('span', { text: label }), el('b', { text: big }), el('small', { text: small }));
    }
    return el('section', { class: 'strip' },
      kpi('Held-out FDV test', v.test_a.median_abs_log10_err + ' log10', 'median error ~3x · ' + v.test_a.within_3x + '/' + v.test_a.test + ' within 3x · baseline ' + v.test_a.baseline_median_abs_log10_err),
      kpi('Leave-one-category-out', v.test_b.median_abs_log10_err + ' log10', v.test_b.n + ' protocols · baseline ' + v.test_b.baseline_median_abs_log10_err),
      kpi('Token-status AUC', String(v.test_c.auc), 'Brier ' + v.test_c.brier + ' vs ' + v.test_c.baseline_brier + ' baseline · n=' + v.test_c.n),
      kpi('Size slope', String(F.size_slope.toFixed(2)), 'stable ' + Math.min.apply(null, v.size_slope_folds).toFixed(2) + '–' + Math.max.apply(null, v.size_slope_folds).toFixed(2) + ' across 5 folds')
    );
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var wlBox = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(); });
    var sortSel = el('select', { 'aria-label': 'Sort by' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['odds', 'Token odds'], ['hour', 'Value per farm hour'], ['growth', '7-day growth'], ['age', 'Age'], ['name', 'Name']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: o[0] === state.sort ? 'selected' : null });
      })
    );
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; writeHash(); render(); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { text: 'Sort by' }), sortSel),
      el('label', { class: 'check', for: 'wl' }, wlBox, 'Watchlist only'),
      el('span', { class: 'count', text: filteredRows().length + ' of ' + DATA.rows.length + ' rows' })
    );
  }
  function tabs() {
    function tab(name, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === name ? 'true' : 'false', text: label, onclick: function () { state.tab = name; state.selected = null; writeHash(); render(); } });
    }
    return el('div', { class: 'tabs' }, tab('pre-token', 'Pre-token board'), tab('live', 'Live token (' + DATA.live.length + ')'));
  }
  function sortHead(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = (key === 'rank' || key === 'name' || key === 'age') ? 1 : -1; } writeHash(); render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null)
    );
  }
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-sel': state.selected === r.slug ? 'true' : 'false',
        'class': state.selected === r.slug ? 'sel' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, el('span', { text: r.name }),
            r.watchlist ? el('span', { class: 'badge', text: 'WATCHLIST' }) : null,
            r.derivative ? el('span', { class: 'badge deriv', text: 'DERIVATIVE' }) : null),
          el('span', { text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: growth }),
        el('td', { class: 'num', text: ageFmt(r.age_days) }),
        el('td', { class: 'num', text: Math.round(r.token_odds * 100) + '%' }),
        el('td', null, el('div', null,
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: usd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: '$' + r.farm_cost_usd.toFixed(2) }),
        el('td', { class: 'num', text: usd(r.implied_per_farm_hour_usd) + '/h' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHead('rank', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('odds', 'Token odds'),
            sortHead('implied', 'Implied value'),
            el('th', { scope: 'col', class: 'num', text: 'Farm gas' }),
            sortHead('hour', 'Value / farm hour')
          )),
          tbody
        )
      )
    );
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        el('td', { class: 'num', text: usd(r.mcap_usd) }),
        el('td', null, el('span', { text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }
  function methodPanel() {
    var v = DATA.validation;
    return el('section', { class: 'panel method' },
      el('div', { style: 'padding:16px 18px' },
        el('h2', { text: 'How implied value is computed' }),
        el('p', { text: 'One function scores every row, from the snapshot alone. No protocol name is special-cased and no row is hand-picked.' }),
        el('div', { class: 'formula', text: 'implied = round( tvl_usd x multiple(category) x (1 + clamp(change_7d, -50, +100) / 100) ^ 0.5 x (tvl_usd / $100M) ^ (slope - 1) x launch_odds(age, category) )' }),
        el('ul', null,
          el('li', { text: 'multiple(category): the category median FDV/TVL among the ' + F.comparables + ' tokened comparables, winsorized to [0.001, 5] and shrunk toward the global median (' + F.global_multiple.toFixed(3) + ') with a 5-protocol prior.' }),
          el('li', { text: 'size slope ' + F.size_slope.toFixed(3) + ': log10(market cap) on log10(TVL). Token value grows slower than TVL, so the biggest protocols are cheaper per TVL dollar.' }),
          el('li', { text: 'launch_odds: from the snapshot\u2019s own age curve (pi=' + F.odds_pi + ', lambda=' + F.odds_lambda + '/yr, fitted on age bands), adjusted by the category\u2019s token rate. A protocol that has run years with no token is less likely ever to launch.' }),
          el('li', { text: 'Held out, the model predicts log10(FDV) with median error ' + v.test_a.median_abs_log10_err + ' (baseline ' + v.test_a.baseline_median_abs_log10_err + '), and token status with AUC ' + v.test_c.auc + ' (baseline Brier ' + v.test_c.baseline_brier + '). FDV is hard to predict from TVL alone; the strip above says so.' }),
          el('li', { text: 'Farm gas is an estimate for the chain\u2019s typical transaction fee; capital is yours and comes back when you unwind. Implied value is a model, not a price, and a protocol that records no token may still have one its DefiLlama record does not carry.' })
        )
      )
    );
  }
  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var panel = document.getElementById('detail');
    if (!panel) {
      // The panel is only in the page while a row is selected; a click creates it.
      panel = el('section', { class: 'detail', id: 'detail' });
      var method = document.querySelector('.method');
      if (method && method.parentNode) method.parentNode.insertBefore(panel, method);
      else document.querySelector('.wrap').appendChild(panel);
    }
    panel.textContent = '';
    var recomputed = impliedOf(row);
    var diff = recomputed - row.implied_value_usd;
    var match = diff === 0 ? 'The page recomputes this row as the same number board.json carries.'
      : Math.abs(diff) <= 10 ? 'The page recomputes this row as ' + usd(recomputed) + ', within $' + Math.abs(diff) + ' of the board: the $1 tie-break that keeps ranks strictly ordered.'
      : 'The page recomputes this row as ' + usd(recomputed) + ', which differs from the board: the data would be stale.';
    function cell(label, value, gold) {
      return el('div', null, el('span', { text: label }), el('b', { class: gold ? 'gold' : null, text: value }));
    }
    panel.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · on the watchlist' : ' · early radar') }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { state.selected = null; writeHash(); render(); } })
    ));
    panel.appendChild(el('div', { class: 'eq' },
      cell('TVL', usd(row.tvl_usd)),
      cell('Category multiple', String(row.multiple)),
      cell('Growth x size', row.growth_multiplier + ' x ' + row.size_multiplier),
      cell('Token odds', Math.round(row.token_odds * 100) + '%'),
      cell('Age with no token', ageFmt(row.age_days)),
      cell('7-day growth', pct(row.change_7d)),
      cell('Farm gas (est.)', '$' + row.farm_cost_usd.toFixed(2)),
      cell('Implied value', usd(row.implied_value_usd), true)
    ));
    panel.appendChild(el('p', { class: 'note', text: match + ' Value per farm hour is ' + usd(row.implied_per_farm_hour_usd) + ' for about ' + row.farm_hours + ' hours of active time over a ' + holdDays(row.age_days) + '-day hold.' }));
    if (row.derivative) {
      panel.appendChild(el('p', { class: 'note', text: 'Flagged derivative: this protocol sits in a wrapped, staked or bridged category, so a token it issued would likely be a derivative of a token that already trades. It fills the board below the strict early radar, by TVL.' }));
    }
    panel.appendChild(el('h3', { text: 'Farm plan — 8 steps, costed' }));
    var ol = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      ol.appendChild(el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail })));
    });
    panel.appendChild(ol);
    panel.scrollIntoView({ behavior: 'auto', block: 'nearest' });
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'wrap' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(strip());
    shell.appendChild(controls());
    shell.appendChild(tabs());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    var detail = el('section', { class: 'detail', id: 'detail' });
    if (state.tab === 'pre-token' && state.selected) shell.appendChild(detail);
    if (state.tab === 'pre-token') shell.appendChild(methodPanel());
    shell.appendChild(el('div', { class: 'foot', text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.model_version + ' · Implied values are a fitted model, not prices. Gas costs are estimates.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; writeHash(); render(); }
  });
})();
