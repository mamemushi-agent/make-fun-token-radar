// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a live-token view, the calibration behind the model, and a per-protocol detail
// drawer. No network: every byte it shows is in data.js. The model and farm-plan functions below
// mirror lib/model.ts and are run live on every row, so the page proves its own numbers.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(3) + 'x'; }

  // == model logic (mirrors lib/model.ts) ==
  function impliedOf(row) {
    var m = DATA.model;
    var growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = Math.max(m.growth_min_multiplier, 1 + (growthPct / 100) * m.growth_weight);
    var age = row.age_days === null || row.age_days === undefined ? DATA.unknown_age_days : row.age_days;
    var maturityMult = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadthMult = 1 + m.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_steps);
    return Math.min(100000000000000, Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturityMult * breadthMult)));
  }
  // == end model logic ==

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
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

  // == farm logic (mirrors lib/model.ts) ==
  function chainOf(p) { return p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5000000000) return 400;
    if (p.tvl_usd >= 1000000000) return 300;
    if (p.tvl_usd >= 250000000) return 200;
    if (p.tvl_usd >= 50000000) return 150;
    if (p.tvl_usd >= 10000000) return 100;
    return 75;
  }
  function gasFor(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 14;
    if (c === 'solana' || c === 'polygon' || c.includes('arbitrum') || c.includes('optimism') || c === 'base' || c.includes('zksync') || c === 'linea' || c === 'scroll' || c === 'mantle' || c === 'blast' || c === 'mode' || c === 'taiko') return 1;
    if (c.includes('bnb') || c.includes('bsc') || c.includes('avalanche') || c.includes('fantom') || c.includes('sonic')) return 2;
    return 3;
  }
  function weeksFor(age) {
    if (age === null || age === undefined) return 6;
    if (age < 180) return 8;
    if (age < 540) return 6;
    return 4;
  }
  function actionsFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var third = Math.max(10, Math.round(capital * 0.3));
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return [
      'Supply $' + capital + ' of USDC as collateral in ' + name + ' on ' + chain + ', then borrow $' + third + ' against it and re-supply the borrowed amount once, keeping loan-to-value under 40%.',
      'Repay half the borrow, withdraw 10% of the supply, then restore both legs within the same session, so the wallet registers as borrower and supplier, not a one-way depositor.'];
    if (c.includes('dex') || c.includes('swap')) return [
      'Add $' + capital + " of balanced liquidity to " + name + "'s highest-TVL stable or native pair on " + chain + ', split evenly across both assets, and keep the LP position open.',
      'Swap $' + third + ' through ' + name + "'s main pair and move the LP range or tranche once, so the wallet shows trading volume as well as liquidity depth."];
    if (c.includes('bridge') || c.includes('canonical') || c.includes('cross chain')) return [
      'Bridge $' + capital + ' of USDC from Ethereum to ' + chain + ' through ' + name + ', then deposit the bridged funds into a money market on the destination chain instead of leaving them idle.',
      'Bridge $' + third + ' back to Ethereum and re-bridge it a week later, so the wallet has transfers in both directions rather than a single one-way hop.'];
    if (c.includes('staking') || c.includes('restak')) return [
      'Stake $' + capital + " worth of the chain's staking asset through " + name + ' on ' + chain + ' and keep the liquid receipt token in the same wallet for the whole campaign.',
      'Claim the accrued staking rewards, restake them through ' + name + ', and record the receipt-token balance before and after in the farm log.'];
    if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('interest rate')) return [
      'Deposit $' + capital + ' of USDC as margin on ' + name + ' and run a hedged pair: hold $' + third + ' of spot in the same wallet and short the same notional on ' + name + ', so price risk stays near neutral.',
      'Roll the hedge once: close the short, re-open it at the new spot price, and log both funding payments, keeping total fees visible rather than chasing volume.'];
    if (c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('yield') || c.includes('farm') || c.includes('liquidity manager')) return [
      'Deposit $' + capital + ' of USDC into ' + name + "'s main vault on " + chain + ' and keep the vault shares untouched for the first two weeks of the campaign.',
      'Add a second tranche of $' + third + ', then harvest any accrued yield and re-deposit it into the same vault, so deposits, harvests and compounding all appear on one wallet.'];
    if (c.includes('rwa')) return [
      'Subscribe $' + capital + ' to ' + name + "'s yield-bearing asset on " + chain + ' after its own onboarding check, and hold the issued asset in the farming wallet.',
      'Redeem a $' + third + ' slice and subscribe it back the following week, proving the wallet can use both sides of the product, then restore the full position.'];
    if (c.includes('stable')) return [
      'Mint or deposit $' + capital + ' of ' + name + "'s stable asset on " + chain + ' against the collateral the app asks for, and hold the stable asset rather than swapping out immediately.',
      'Provide $' + third + ' of the stable asset to a paired liquidity pool named in ' + name + "'s app and keep that LP position for the rest of the campaign."];
    if (c.includes('prediction')) return [
      'Fund ' + name + ' with $' + capital + ' and take small positions in at least three unrelated markets, sizing no single market above $' + third + '.',
      'Settle one finished market, record the payout, and re-enter a new market with the proceeds so the wallet shows a full prediction lifecycle.'];
    if (c.includes('insurance')) return [
      'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for a position this wallet actually holds, and keep the policy NFT or receipt for its full term.',
      'Renew or extend the cover once before it lapses, and log the premium paid each time so the cost of the hedge is explicit.'];
    if (c.includes('chain')) return [
      'Bridge $' + capital + ' to ' + name + "'s chain and make it the wallet's home chain for the campaign: pay every later fee in its native asset from this wallet.",
      'Use three different applications on the chain (a swap, a lending market and one native app), one transaction each, so activity is spread rather than repeated in one contract.'];
    if (c.includes('privacy')) return [
      'Deposit $' + capital + ' into ' + name + "'s shielded pool on " + chain + ' from the farming wallet and keep the note or commitment the app issues.',
      'Make one shielded transfer of $' + third + ' to a second wallet you control, then consolidate back, so both deposit and transfer paths are exercised.'];
    if (c.includes('index')) return [
      'Mint $' + capital + ' of ' + name + "'s index token on " + chain + ' and hold it for the full campaign instead of trading in and out.',
      'Mint a further $' + third + ' after the next rebalance the app publishes, and log the basket change the rebalance made.'];
    if (c.includes('payment') || c.includes('card')) return [
      'Activate ' + name + ' with $' + capital + ' of working balance and route one real payment of about $' + third + ' through it from the farming wallet.',
      'Repeat a smaller payment in a later week and keep both receipts, so the wallet shows recurring use rather than a single test transaction.'];
    return [
      'Deposit $' + capital + ' of USDC into ' + name + "'s main product on " + chain + ' and keep the position open for the whole campaign.',
      'Withdraw 10% of the position and re-deposit it a week later, so the wallet registers both directions of flow with ' + name + '.'];
  }
  function tvlText(tvl) {
    if (tvl >= 1000000000) return '$' + (tvl / 1000000000).toFixed(2) + 'B';
    if (tvl >= 1000000) return '$' + Math.round(tvl / 1000000) + 'M';
    return '$' + Math.round(tvl / 1000) + 'K';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var gas = gasFor(chain);
    var weeks = weeksFor(p.age_days);
    var holdDays = weeks * 7;
    var pair = actionsFor(p, capital, chain);
    return [
      'Open ' + p.name + "'s own app from its official documentation, confirm the contract and that " + chain + ' is the network behind its ' + tvlText(p.tvl_usd) + ' snapshot TVL, and start a farm log with the date, the wallet and this plan. Cost: $0 in fees. Time: 20 minutes.',
      'Create a fresh wallet used only for ' + p.name + ', back up its seed phrase offline, and fund it with $' + capital + ' of working capital plus $' + (gas * 6) + ' of ' + chain + ' gas money. Cost: about $' + gas + ' network fee to fund. Time: 10 minutes.',
      pair[0] + ' Cost: $' + capital + ' of capital plus about $' + gas + ' of gas. Time: 25 minutes.',
      pair[1] + ' Cost: about $' + gas + ' of gas. Time: 15 minutes.',
      'Repeat one qualifying action every week for ' + weeks + ' weeks, alternating the core and second steps, and keep the position open across at least ' + weeks + ' weekly snapshots. Cost: about $' + gas + ' of gas a week, $' + (gas * weeks) + ' in all. Time: 10 minutes a week.',
      'Every second week, open ' + p.name + "'s official points or rewards page, write the balance it shows for this wallet into the farm log, and never pay a third party to claim: a real claim is announced inside the app itself. Cost: $0. Time: 15 minutes.",
      'Exit when a token launch is announced inside the app or after ' + holdDays + ' days, whichever comes first: unwind in two transactions a day apart to limit slippage, then sweep the proceeds back to the funding wallet. Cost: about $' + (gas * 2) + ' of gas plus normal market slippage. Time: 30 minutes.'];
  }
  // == end farm logic ==

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('wl')) state.wl = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index, sealed' }),
        el('span', { text: 'Model ' + DATA.model_version })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, priced by the market\'s own multiples' }),
        el('p', null,
          'Every protocol that already trades reveals what the market pays per dollar of TVL. This radar measures that multiple per category from ',
          el('b', { text: DATA.calibration_live_n + ' live-token protocols' }),
          ' in the sealed snapshot, then prices all ',
          el('b', { text: DATA.board_size + ' pre-token protocols' }),
          ' with it, adjusted for 7-day growth, tokenless age and chain breadth. The watchlist of ' + DATA.watchlist_size + ' is the floor, not the ceiling: the early radar ranks every pre-token protocol below it.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Global median mcap / TVL' }), el('b', { text: fmtMult(DATA.global_multiple) })),
        el('div', { class: 'fact' }, el('span', { text: 'Set aside (live + products)' }), el('b', { text: String(DATA.live_size + DATA.aside_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function select(id, label, values, current, onChange) {
      var s = el('select', { id: id, 'aria-label': label },
        el('option', { value: 'all', text: label === 'Category' ? 'All categories' : 'All chains' }),
        values.map(function (v) { return el('option', { value: v, text: v, selected: v === current ? 'selected' : null }); })
      );
      s.addEventListener('change', function () { onChange(s.value); writeHash(); render(); });
      return s;
    }
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); render(); });
    function tab(id, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === id ? 'true' : 'false', text: label, onclick: function () { state.tab = id; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select('category', 'Category', categories, state.category, function (v) { state.category = v; })),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), select('chain', 'Chain', chains, state.chain, function (v) { state.chain = v; })),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), el('label', { class: 'check' }, wl, 'Watchlist only')),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tab('board', 'Board'), tab('live', 'Live tokens'), tab('model', 'Model'))),
      el('span', { class: 'count', text: state.tab === 'board' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : DATA.calibration.length + ' calibrated categories' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
        )),
        el('td', null, r.watchlist ? el('span', { class: 'badge', text: 'watchlist' }) : el('span', { class: 'status', text: 'early' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: '$' + r.farm_capital_usd + ' / ' + r.farm_weeks + 'w' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols ranked by implied value. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Scope' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Cat. multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Farm plan' })
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
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', null,
      el('div', { class: 'panel' },
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('caption', { class: 'sub', text: 'Already trading: market cap is a fact, not a model. These protocols are never ranked; their mcap/TVL ratios are the calibration the board is priced with. Top ' + DATA.live.length + ' by market cap shown.' }),
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Token' }))),
            tbody
          )
        )
      ),
      el('p', { class: 'note', text: 'Also set aside, unranked: ' + DATA.aside_size + ' pre-token records that are exchanges, versioned pools of another protocol, or above-floor wrapped / staked / bridged products of a token that already exists. The largest are ' + DATA.aside.slice(0, 5).map(function (a) { return a.name + ' (' + fmtUsd(a.tvl_usd) + ')'; }).join(', ') + '. A wrapped asset is not a launch that has not happened yet.' })
    );
  }

  function modelView() {
    var m = DATA.model;
    var calBody = el('tbody');
    DATA.calibration.forEach(function (c) {
      calBody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.live_n) }),
        el('td', { class: 'num', text: fmtMult(c.median_multiple) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) })
      ));
    });
    var asideBody = el('tbody');
    DATA.aside.slice(0, 12).forEach(function (a) {
      asideBody.appendChild(el('tr', null,
        el('td', { text: a.name }),
        el('td', { text: a.category || 'Uncategorised' }),
        el('td', { class: 'num', text: fmtUsd(a.tvl_usd) })
      ));
    });
    return el('div', null,
      el('section', { class: 'panel model' },
        el('h2', { text: 'How implied value is computed' }),
        el('div', { class: 'formula', text: 'implied = TVL x category_multiple x growth x maturity x breadth' }),
        el('ul', null,
          el('li', null, el('b', { text: 'category_multiple: ' }), 'the median mcap/TVL of the snapshot\'s live-token protocols in the same category, winsorised to [' + m.winsor_low + ', ' + m.winsor_high + '] and shrunk toward the global median (' + fmtMult(DATA.global_multiple) + ') with prior weight ' + m.prior_weight + ', so a category calibrated on 2 protocols leans on the market and one calibrated on 15 stands mostly on its own. A category with no live protocol uses the global median.'),
          el('li', null, el('b', { text: 'growth: ' }), '1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ', floored at ' + m.growth_min_multiplier + ': a hot week raises the price, a bad week cannot erase it.'),
          el('li', null, el('b', { text: 'maturity: ' }), m.maturity_floor + ' + min(tokenless age, ' + m.maturity_days + 'd) / ' + m.maturity_days + ' x ' + m.maturity_range + ': the longer a protocol has run with no token, the more of its value the model credits. Unknown ages use the snapshot\'s median known age, ' + DATA.unknown_age_days + ' days.'),
          el('li', null, el('b', { text: 'breadth: ' }), '1 + ' + m.breadth_per_chain + ' per extra chain, up to ' + m.breadth_max_steps + ': distribution across chains is worth a small premium.'),
          el('li', null, el('b', { text: 'Scope: ' }), 'the board ranks the full watchlist plus every rankable pre-token protocol below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. Exchanges, versioned pools and above-floor wrapped or staked products are set aside, not ranked. No protocol name is special-cased anywhere: one function, fed only by snapshot fields, scores every row, and this page recomputes each row live to prove it.')
        )
      ),
      el('div', { class: 'grid2' },
        el('section', { class: 'panel' },
          el('h2', { text: 'Calibration by category' }),
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live n' }), el('th', { scope: 'col', text: 'Median' }), el('th', { scope: 'col', text: 'Used' }))),
            calBody
          )
        ),
        el('section', { class: 'panel' },
          el('h2', { text: 'Set aside above the floor' }),
          el('p', { class: 'sub', text: 'Pre-token records the watchlist definition leaves out: products of tokens that already trade, exchanges and versioned pools. Shown, never ranked.' }),
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'TVL' }))),
            asideBody
          )
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row);
    var pageSteps = farmSteps(row);
    var stepsMatch = pageSteps.length === row.farm_steps.length && pageSteps.every(function (s, i) { return s === row.farm_steps[i]; });
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' - watchlist' : ' - early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' - listed ' + (row.listed_at || 'date unknown') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, step by step' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Uncategorised') + ', median ' + fmtMult(row.category_median_multiple) + ', n=' + row.calibration_n + ' live)' }), el('b', { text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Growth x (' + fmtPct(row.change_7d) + ' over 7d)' }), el('b', { text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity x (tokenless for ' + fmtAge(row.age_days) + ')' }), el('b', { text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth x (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')' }), el('b', { text: String(row.breadth_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'checkline', text: 'This page recomputes the row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' - identical to board.json.' : ' - differs from board.json: the data would be stale.') + ' An estimate from the snapshot\'s own figures, not a price prediction.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'planline' },
        el('span', null, 'Capital ', el('b', { text: '$' + row.farm_capital_usd })),
        el('span', null, 'Est. fees ', el('b', { text: '$' + row.farm_fees_usd })),
        el('span', null, 'Campaign ', el('b', { text: row.farm_weeks + ' weeks' })),
        el('span', null, 'Steps ', el('b', { text: String(row.farm_steps.length) }))
      ),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'checkline', text: stepsMatch ? 'Plan check: the plan this page derives from the category, chain, TVL and age matches board.json word for word.' : 'Plan check: page derivation differs from board.json.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'board') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else shell.appendChild(modelView());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
