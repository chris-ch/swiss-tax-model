/* UI for the Swiss tax model. Depends on js/model.js (window.TaxModel). */
(function () {
  'use strict';
  const M = window.TaxModel;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  function freshParams() {
    const p = JSON.parse(JSON.stringify(M.DEFAULTS));
    p.cells = M.defaultCells();
    return p;
  }
  let params = freshParams();
  let pop = null;
  let needRebuild = true;

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  const nf0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
  const chf = (v) => nf0.format(Math.round(v));
  function compact(v) {
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a < 1000) return s + Math.round(a);
    if (a < 1e6) return s + (a / 1e3).toFixed(a < 1e4 ? 1 : 0) + 'k';
    if (a < 1e9) return s + (a / 1e6).toFixed(a < 1e7 ? 2 : 1) + 'm';
    return s + (a / 1e9).toFixed(a < 1e10 ? 2 : 1) + 'bn';
  }
  function pct(v, d = 1) { return isFinite(v) ? (v * 100).toFixed(d) + '%' : '–'; }
  function signed(v, f) { return (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  // mult converts the displayed number into model units.
  const CONTROLS = [
    {
      title: 'Revenue target', fields: [
        { path: 'revenue.base', label: 'Tax-financed spending, net', unit: 'CHF bn per year', mult: 1e9, step: 1, dp: 1 },
        { path: 'revenue.ahvVat', label: 'VAT share paid into AHV', unit: 'CHF bn per year', mult: 1e9, step: 0.1, dp: 1 },
      ],
    },
    {
      title: 'Model A: income tax', cls: 'sw-a', fields: [
        { path: 'modelA.x0', label: 'Tax-free allowance x₀', unit: 'CHF, equivalised', mult: 1, step: 1000, dp: 0, min: 0 },
        { path: 'modelA.k', label: 'Steepness k', unit: 'higher = top rate reached sooner', mult: 1, step: 0.1, dp: 2, min: 0.05 },
      ],
    },
    {
      title: 'Model B: wealth tax', cls: 'sw-b', fields: [
        { path: 'modelB.rHigh', label: 'Rate r_high, up to W_low', unit: '% per year, before scaling', mult: 0.01, step: 0.05, dp: 3, min: 0 },
        { path: 'modelB.rLow', label: 'Rate r_low, from W_high', unit: '% per year, before scaling', mult: 0.01, step: 0.01, dp: 3, min: 0 },
        { path: 'modelB.wLow', label: 'W_low: rate starts falling', unit: 'CHF million', mult: 1e6, step: 0.1, dp: 2, min: 0.01 },
        { path: 'modelB.wHigh', label: 'W_high: rate reaches r_low', unit: 'CHF million', mult: 1e6, step: 1, dp: 1, min: 0.02 },
        { path: 'modelB.tMin', label: 'Minimum payment T_min', unit: 'CHF; below it tax is 0', mult: 1, step: 500, dp: 0, min: 0 },
        { path: 'modelB.tMax', label: 'Maximum payment T_max', unit: 'CHF per household', mult: 1, step: 10000, dp: 0, min: 1 },
        { path: 'modelB.interp', label: 'Rate falls linearly in', type: 'select', options: [['log', 'log(W) (default)'], ['linear', 'W']] },
      ],
    },
  ];

  const CALIB_FIELDS = [
    { path: 'calib.totalIncome', label: 'Total household income', unit: 'CHF bn; gross incl. pensions', mult: 1e9, step: 10, dp: 0, min: 1 },
    { path: 'calib.totalWealth', label: 'Total net wealth incl. pensions', unit: 'CHF bn; SNB financial accounts', mult: 1e9, step: 100, dp: 0, min: 1 },
    { path: 'calib.top1Income', label: 'Top 1% share of income', unit: '%; sets the income tail', mult: 0.01, step: 0.5, dp: 1, min: 1, max: 90 },
    { path: 'calib.top1Wealth', label: 'Top 1% share of non-pension wealth', unit: '%; sets the wealth tail', mult: 0.01, step: 0.5, dp: 1, min: 1, max: 95 },
    { path: 'calib.incomeTailQ', label: 'Income tail starts at', unit: 'within-type percentile', mult: 0.01, step: 0.5, dp: 1, min: 50, max: 99.9 },
    { path: 'calib.wealthTailQ', label: 'Wealth tail starts at', unit: 'within-type percentile', mult: 0.01, step: 0.5, dp: 1, min: 50, max: 99.9 },
    { path: 'calib.rho', label: 'Income–wealth correlation', unit: 'adjusted by age', mult: 1, step: 0.05, dp: 2, min: -0.9, max: 0.95 },
    { path: 'pop.perCell', label: 'Sample size per household type', unit: 'more = smoother, slower', mult: 1, step: 500, dp: 0, min: 200, max: 20000 },
    { path: 'pop.seed', label: 'Random seed', unit: 'changes the sample', mult: 1, step: 1, dp: 0, min: 0 },
  ];

  const getPath = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);
  function setPath(obj, path, v) {
    const ks = path.split('.'); const last = ks.pop();
    ks.reduce((o, k) => o[k], obj)[last] = v;
  }
  function displayValue(f) {
    const v = getPath(params, f.path);
    if (f.type === 'select') return v;
    return +(v / f.mult).toFixed(f.dp);
  }

  function fieldHtml(f) {
    const id = 'f-' + f.path.replace(/\./g, '-');
    const input = f.type === 'select'
      ? `<select id="${id}" data-path="${f.path}">${f.options.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`
      : `<input type="number" id="${id}" data-path="${f.path}" step="${f.step}"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}>`;
    return `<div class="field"><label for="${id}">${esc(f.label)}${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}</label>${input}</div>`;
  }

  const ALL_FIELDS = new Map();
  function renderControls() {
    const el = document.getElementById('controls');
    el.innerHTML = CONTROLS.map((g) => `
      <div class="ctrl-group">
        <h3>${g.cls ? `<span class="swatch ${g.cls}"></span>` : ''}${esc(g.title)}</h3>
        ${g.fields.map(fieldHtml).join('')}
      </div>`).join('') +
      `<div class="btn-row"><button type="button" id="resetBtn">Reset to defaults</button></div>`;
    document.getElementById('calibFields').innerHTML = CALIB_FIELDS.map(fieldHtml).join('');
    for (const g of CONTROLS) for (const f of g.fields) ALL_FIELDS.set(f.path, f);
    for (const f of CALIB_FIELDS) ALL_FIELDS.set(f.path, f);
    syncInputs();
  }

  function syncInputs() {
    for (const [path, f] of ALL_FIELDS) {
      const el = document.querySelector(`[data-path="${path}"]`);
      if (el && document.activeElement !== el) el.value = displayValue(f);
    }
  }

  function onFieldInput(e) {
    const el = e.target;
    const path = el.dataset.path;
    if (path) {
      const f = ALL_FIELDS.get(path);
      if (f.type === 'select') setPath(params, path, el.value);
      else {
        const raw = parseFloat(el.value);
        if (!isFinite(raw)) return;
        let v = raw;
        if (f.min !== undefined) v = Math.max(f.min, v);
        if (f.max !== undefined) v = Math.min(f.max, v);
        setPath(params, path, v * f.mult);
      }
      if (path.startsWith('calib.') || path.startsWith('pop.')) needRebuild = true;
      schedule();
      return;
    }
    if (el.dataset.cell !== undefined) {
      const raw = parseFloat(el.value);
      if (!isFinite(raw)) return;
      const col = CELL_COLS.find((c) => c.key === el.dataset.field);
      params.cells[+el.dataset.cell][col.key] = Math.max(col.min ?? 0, raw) * col.mult;
      needRebuild = true;
      schedule();
    }
  }

  // ---------------------------------------------------------------------------
  // Household type editor
  // ---------------------------------------------------------------------------

  const CELL_COLS = [
    { key: 'households', label: 'Households (k)', mult: 1000, dp: 1, step: 1 },
    { key: 'incMedian', label: 'Income median (CHF k)', mult: 1000, dp: 0, step: 1 },
    { key: 'incSigma', label: 'Income σ', mult: 1, dp: 2, step: 0.05, min: 0.05 },
    { key: 'wMedian', label: 'Wealth median (CHF k)', mult: 1000, dp: 0, step: 5 },
    { key: 'wSigma', label: 'Wealth σ', mult: 1, dp: 2, step: 0.05, min: 0.05 },
    { key: 'wZero', label: 'Zero-wealth share (%)', mult: 0.01, dp: 0, step: 1 },
  ];

  function renderCellTable() {
    const rows = params.cells.map((c, i) => `<tr><td>${esc(M.cellLabel(c))}</td>${CELL_COLS.map((col) =>
      `<td><input type="number" aria-label="${esc(M.cellLabel(c) + ': ' + col.label)}" data-cell="${i}" data-field="${col.key}" step="${col.step}" value="${+(c[col.key] / col.mult).toFixed(col.dp)}"></td>`).join('')}</tr>`).join('');
    document.getElementById('cellTable').innerHTML =
      `<table class="cells"><thead><tr><th>Household type</th>${CELL_COLS.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ---------------------------------------------------------------------------
  // Charts (small hand-rolled SVG line chart with hover readout)
  // ---------------------------------------------------------------------------

  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }
  function linearTicks(min, max, count) {
    const st = niceStep(max - min, count);
    const out = [];
    for (let v = Math.ceil(min / st) * st; v <= max + st * 1e-9; v += st) out.push(+v.toPrecision(12));
    return out;
  }
  function logTicks(min, max) {
    const out = [];
    for (let e = Math.ceil(Math.log10(min)); e <= Math.floor(Math.log10(max)); e++) out.push(Math.pow(10, e));
    return out;
  }

  function lineChart(el, opts) {
    const width = Math.max(280, Math.round(el.clientWidth || 520));
    const height = opts.height || 260;
    const m = { l: 48, r: 14, t: 10, b: 38 };
    const iw = width - m.l - m.r, ih = height - m.t - m.b;
    const X = opts.x, Y = opts.y;
    const sx = X.log
      ? (v) => m.l + (Math.log10(v) - Math.log10(X.min)) / (Math.log10(X.max) - Math.log10(X.min)) * iw
      : (v) => m.l + (v - X.min) / (X.max - X.min) * iw;
    const sy = (v) => m.t + ih - (Math.min(Math.max(v, Y.min), Y.max) - Y.min) / (Y.max - Y.min) * ih;

    const xt = X.ticks || (X.log ? logTicks(X.min, X.max) : linearTicks(X.min, X.max, 6));
    const yt = Y.ticks || linearTicks(Y.min, Y.max, 5);
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.aria || '')}">`;
    for (const t of yt) svg += `<line class="gridline" x1="${m.l}" x2="${m.l + iw}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${m.l - 6}" y="${sy(t) + 4}" text-anchor="end">${esc(Y.format(t))}</text>`;
    for (const t of xt) svg += `<line class="gridline" x1="${sx(t)}" x2="${sx(t)}" y1="${m.t}" y2="${m.t + ih}" opacity=".6"/><text x="${sx(t)}" y="${m.t + ih + 16}" text-anchor="middle">${esc(X.format(t))}</text>`;
    svg += `<line class="axisline" x1="${m.l}" x2="${m.l + iw}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
    if (X.label) svg += `<text x="${m.l + iw / 2}" y="${height - 4}" text-anchor="middle">${esc(X.label)}</text>`;
    for (const s of opts.series) {
      const d = s.data.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    // legend
    let lx = m.l + 6;
    for (const s of opts.series) {
      svg += `<line x1="${lx}" x2="${lx + 16}" y1="${m.t + 8}" y2="${m.t + 8}" stroke="${s.color}" stroke-width="2.5"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/><text x="${lx + 21}" y="${m.t + 12}" style="fill:var(--text)">${esc(s.label)}</text>`;
      lx += 30 + s.label.length * 6.2;
    }
    svg += `<line class="cursor" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>`;
    svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
    svg += '</svg>';
    el.innerHTML = svg + '<div class="tooltip"></div>';

    const svgEl = el.querySelector('svg'), tip = el.querySelector('.tooltip'), cursor = el.querySelector('.cursor');
    const base = opts.series[0].data;
    function move(ev) {
      const r = svgEl.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (width / r.width);
      let best = 0, bd = Infinity;
      for (let i = 0; i < base.length; i++) { const dd = Math.abs(sx(base[i].x) - px); if (dd < bd) { bd = dd; best = i; } }
      const x = sx(base[best].x);
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.setAttribute('visibility', 'visible');
      tip.innerHTML = opts.tooltip(best);
      tip.style.display = 'block';
      const left = x * (r.width / width);
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(0, left + 12), r.width - tw) + 'px';
      if (left + 12 + tw > r.width) tip.style.left = Math.max(0, left - tw - 12) + 'px';
      tip.style.top = '8px';
    }
    function leave() { tip.style.display = 'none'; cursor.setAttribute('visibility', 'hidden'); }
    const hit = el.querySelector('.hit');
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------------------------------------------------------------------------
  // Rendering of results
  // ---------------------------------------------------------------------------

  let last = null; // { ev, cellRows, ... } for re-rendering on resize

  function recompute() {
    document.getElementById('results').classList.add('busy');
    setTimeout(() => {
      try {
        if (needRebuild || !pop) { pop = M.buildPopulation(params); needRebuild = false; }
        const ev = M.evaluate(pop, params);
        const cellRows = M.summarize(pop, ev, 'cell');
        last = {
          ev, cellRows,
          curveInc: M.percentileCurve(pop, ev, 'taxable'),
          curveW: M.percentileCurve(pop, ev, 'wealth'),
          bStats: M.modelBStats(pop, ev),
          capShare: M.capShare(pop, ev, params.modelB.tMax),
        };
        renderAll();
      } catch (err) {
        console.error(err);
        document.getElementById('warnings').innerHTML = `<div class="warn"><b>Error:</b> ${esc(err.message)}</div>`;
      } finally {
        document.getElementById('results').classList.remove('busy');
      }
    }, 10);
  }

  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(recompute, 250); }

  function renderAll() {
    renderCards();
    renderWarnings();
    renderHeatmap();
    renderCategoryTable();
    renderCurves();
    renderSchedules();
    renderFlagged();
    renderDiag();
  }

  function renderCards() {
    const { ev, bStats } = last;
    const A = ev.A, B = ev.B;
    const incShare = ev.target / pop.diag.totalTaxable;
    const cards = [
      { k: 'Revenue target', v: `CHF ${(ev.target / 1e9).toFixed(1)} bn`, s: `${pct(incShare)} of modelled taxable income` },
      { cls: 'a', k: 'Model A: top marginal rate', v: isFinite(A.tmax) ? pct(A.tmax) : '–', s: `Above CHF ${chf(params.modelA.x0)} equivalised income, k = ${params.modelA.k}` },
      { cls: 'b', k: 'Model B: rate up to W_low', v: pct(B.rHigh, 2), s: `Falls to ${pct(B.rLow, 3)}; inputs scaled ×${B.lambda.toFixed(2)}${B.reachable ? '' : ' (target not reached)'}` },
      { cls: 'b', k: 'Model B: floor and cap', v: `${pct(bStats.zeroShare, 0)} pay 0`, s: `${pct(last.capShare, 2)} at the cap${bStats.guardShare > 0 ? `; monotonicity guard binds for ${pct(bStats.guardShare, 2)}` : ''}` },
      { cls: 'b', k: 'Wealth tax above income', v: `${compact(bStats.flagged)} households`, s: `${pct(bStats.flaggedShare)} of all households` },
    ];
    document.getElementById('cards').innerHTML = cards.map((c) =>
      `<div class="card ${c.cls || ''}"><div class="k">${esc(c.k)}</div><div class="v">${esc(c.v)}</div><div class="s">${esc(c.s)}</div></div>`).join('');
  }

  function renderWarnings() {
    const items = [
      ...pop.warnings.map((w) => ['Calibration', w]),
      ...last.ev.A.warnings.map((w) => ['Model A', w]),
      ...last.ev.B.warnings.map((w) => ['Model B', w]),
    ];
    document.getElementById('warnings').innerHTML = items.map(([who, w]) => `<div class="warn"><b>${esc(who)}:</b> ${esc(w)}</div>`).join('');
  }

  const HEAT_COLS = [['single', '0'], ['single', '1-2'], ['single', '3+'], ['couple', '0'], ['couple', '1-2'], ['couple', '3+']];
  function renderHeatmap() {
    const metric = document.getElementById('heatMetric').value;
    const byKey = new Map();
    last.cellRows.forEach((r) => { const c = pop.cells[r.cell]; byKey.set(`${c.age}|${c.comp}|${c.kids}`, r); });
    const val = (r) => metric === 'diff' ? r.avgB - r.avgA : metric === 'share' ? r.shareMoreB - 0.5 : r.pctIncB - r.pctIncA;
    const fmt = (r) => metric === 'diff' ? signed(r.avgB - r.avgA, compact) : metric === 'share' ? pct(r.shareMoreB, 0) : signed((r.pctIncB - r.pctIncA) * 100, (v) => v.toFixed(1));
    let maxAbs = 0;
    for (const r of last.cellRows) maxAbs = Math.max(maxAbs, Math.abs(val(r)));
    if (metric === 'share') maxAbs = 0.5;
    const head = `<tr><th>Age</th>${HEAT_COLS.map(([c, k]) => `<th>${c === 'single' ? 'Single' : 'Couple'}, ${k === '0' ? 'no children' : k + ' children'}</th>`).join('')}</tr>`;
    const body = M.AGE_BANDS.map((b) => {
      const cells = HEAT_COLS.map(([comp, kids]) => {
        const r = byKey.get(`${b.id}|${comp}|${kids}`);
        if (!r) return `<td class="na">${b.retired && kids !== '0' ? '' : '–'}</td>`;
        const v = val(r);
        const strength = Math.round(Math.min(1, Math.abs(v) / (maxAbs || 1)) * 62);
        const color = v >= 0 ? 'var(--b)' : 'var(--a)';
        const title = `${M.cellLabel(pop.cells[r.cell])}: avg tax A CHF ${chf(r.avgA)}, B CHF ${chf(r.avgB)}; ${pct(r.shareMoreB, 0)} pay more under B`;
        return `<td style="background:color-mix(in srgb, ${color} ${strength}%, var(--surface))" title="${esc(title)}">${esc(fmt(r))}</td>`;
      }).join('');
      return `<tr><td>${esc(b.id.replace('-', '–'))}${b.retired ? ' <span class="muted small">(retired)</span>' : ''}</td>${cells}</tr>`;
    }).join('');
    document.getElementById('heatmap').innerHTML = `<table class="heat"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    const lo = metric === 'share' ? '0%' : metric === 'diff' ? signed(-maxAbs, compact) : signed(-maxAbs * 100, (v) => v.toFixed(1));
    const hi = metric === 'share' ? '100%' : metric === 'diff' ? signed(maxAbs, compact) : signed(maxAbs * 100, (v) => v.toFixed(1));
    document.getElementById('heatLegend').innerHTML =
      `<span>A heavier</span><span class="num">${esc(lo)}</span><span class="grad"></span><span class="num">${esc(hi)}</span><span>B heavier</span><span>· Retired households have no children dimension and appear in the "no children" columns.</span>`;
  }

  function renderCategoryTable() {
    const by = document.getElementById('groupBy').value;
    const rows = by === 'cell' ? last.cellRows : M.summarize(pop, last.ev, by);
    const total = M.summarize(pop, last.ev, 'all')[0];
    const maxRev = Math.max(...rows.map((r) => Math.max(r.revShareA, r.revShareB, r.hhShare)));
    const bar = (v, color) => `<span class="bar" style="width:${Math.round(v / maxRev * 48)}px;background:${color}"></span>`;
    const q = (a) => `${compact(a[0])} / ${compact(a[1])} / ${compact(a[2])}`;
    const tr = (r, isTotal) => `<tr${isTotal ? ' style="font-weight:600"' : ''}>
      <td>${esc(r.label)}</td>
      <td>${compact(r.households)}</td>
      <td>${chf(r.incomeMedian)}</td>
      <td>${chf(r.wealthMedian)}</td>
      <td class="a">${chf(r.avgA)}</td><td class="b">${chf(r.avgB)}</td>
      <td class="a">${pct(r.pctIncA)}</td><td class="b">${pct(r.pctIncB)}</td>
      <td class="a">${pct(r.pctWealthA, 2)}</td><td class="b">${pct(r.pctWealthB, 2)}</td>
      <td>${isTotal ? '' : bar(r.hhShare, 'var(--muted)') + ' '}${pct(r.hhShare)}</td>
      <td class="a">${isTotal ? '' : bar(r.revShareA, 'var(--a)') + ' '}${pct(r.revShareA)}</td>
      <td class="b">${isTotal ? '' : bar(r.revShareB, 'var(--b)') + ' '}${pct(r.revShareB)}</td>
      <td class="a">${q(r.qA)}</td><td class="b">${q(r.qB)}</td>
    </tr>`;
    document.getElementById('catTable').innerHTML = `<table>
      <thead>
        <tr><th rowspan="2">Category</th><th rowspan="2">Households</th><th rowspan="2">Median income</th><th rowspan="2">Median wealth</th>
          <th colspan="2">Average tax (CHF)</th><th colspan="2">% of income</th><th colspan="2">% of wealth</th>
          <th rowspan="2">Share of households</th><th colspan="2">Share of revenue</th><th colspan="2">Tax p10 / median / p90 (CHF)</th></tr>
        <tr><th class="grp-a">A</th><th class="grp-b">B</th><th class="grp-a">A</th><th class="grp-b">B</th><th class="grp-a">A</th><th class="grp-b">B</th>
          <th class="grp-a">A</th><th class="grp-b">B</th><th class="grp-a">A</th><th class="grp-b">B</th></tr>
      </thead>
      <tbody>${rows.map((r) => tr(r, false)).join('')}${tr(total, true)}</tbody></table>`;
  }

  function renderCurves() {
    const a = css('--a'), b = css('--b');
    const draw = (id, bins, what) => {
      const ymax = Math.min(2, Math.max(0.1, ...bins.map((x) => Math.max(x.rateA, x.rateB))) * 1.08);
      lineChart(document.getElementById(id), {
        aria: `Tax as percent of income by ${what} percentile`,
        x: { min: 0, max: 100, format: (v) => v + '', label: `${what[0].toUpperCase() + what.slice(1)} percentile` },
        y: { min: 0, max: ymax, format: (v) => Math.round(v * 100) + '%' },
        series: [
          { label: 'A', color: a, data: bins.map((x) => ({ x: x.mid * 100, y: x.rateA })) },
          { label: 'B', color: b, data: bins.map((x) => ({ x: x.mid * 100, y: x.rateB })) },
        ],
        tooltip: (i) => {
          const x = bins[i];
          return `<b>Percentile ${+(x.lo * 100).toFixed(1)}–${+(x.hi * 100).toFixed(1)}</b><br>Mean ${what}: CHF ${chf(x.mean)}<br>` +
            `<span class="swatch sw-a"></span>A: ${pct(x.rateA)} of income<br><span class="swatch sw-b"></span>B: ${pct(x.rateB)} of income`;
        },
      });
    };
    draw('curveIncome', last.curveInc, 'income');
    draw('curveWealth', last.curveW, 'wealth');
  }

  function logGrid(min, max, n) {
    const out = [], l0 = Math.log(min), l1 = Math.log(max);
    for (let i = 0; i < n; i++) out.push(Math.exp(l0 + (l1 - l0) * i / (n - 1)));
    return out;
  }

  function renderSchedules() {
    const a = css('--a'), b = css('--b');
    const { x0, k } = params.modelA;
    const tmax = isFinite(last.ev.A.tmax) ? last.ev.A.tmax : 0;
    const xsA = logGrid(5000, 10e6, 160);
    const ptsA = xsA.map((x) => ({ x, m: M.marginalA(x, x0, k, tmax), av: tmax * M.taxAUnit(x, x0, k) / x }));
    lineChart(document.getElementById('schedA'), {
      aria: 'Model A marginal and average tax rate by equivalised income',
      x: { min: 5000, max: 10e6, log: true, format: compact, label: 'Equivalised income (CHF, log scale)' },
      y: { min: 0, max: Math.max(0.1, Math.min(1.5, tmax * 1.08)), format: (v) => Math.round(v * 100) + '%' },
      series: [
        { label: 'Marginal', color: a, data: ptsA.map((p) => ({ x: p.x, y: p.m })) },
        { label: 'Average', color: a, dash: '5 4', data: ptsA.map((p) => ({ x: p.x, y: p.av })) },
      ],
      tooltip: (i) => `<b>CHF ${chf(ptsA[i].x)}</b> equivalised<br>Marginal: ${pct(ptsA[i].m)}<br>Average: ${pct(ptsA[i].av)}<br>Tax per adult equivalent: CHF ${chf(ptsA[i].av * ptsA[i].x)}`,
    });

    const s = last.ev.B.schedule;
    const xsB = logGrid(10000, 1e10, 500);
    const ptsB = xsB.map((W) => { const t = s.guarded(W); return { x: W, t, r: t / W }; });
    const rmax = Math.max(0.001, ...ptsB.map((p) => p.r));
    lineChart(document.getElementById('schedB'), {
      aria: 'Model B tax as percent of wealth by net wealth',
      x: { min: 10000, max: 1e10, log: true, format: compact, label: 'Net wealth incl. pensions (CHF, log scale)' },
      y: { min: 0, max: rmax * 1.1, format: (v) => (v * 100).toFixed(v * 100 < 2 ? 1 : 0) + '%' },
      series: [{ label: 'Tax / wealth', color: b, data: ptsB.map((p) => ({ x: p.x, y: p.r })) }],
      tooltip: (i) => `<b>Wealth CHF ${compact(ptsB[i].x)}</b><br>Tax: CHF ${chf(ptsB[i].t)}<br>${pct(ptsB[i].r, 3)} of wealth`,
    });
  }

  function renderFlagged() {
    const ev = last.ev;
    const agg = new Map();
    let totW = 0, totPen = 0, totWl = 0;
    for (let i = 0; i < pop.n; i++) {
      const t = ev.B.tax[i];
      if (!(t > 0 && t > pop.taxable[i])) continue;
      const c = pop.cellIdx[i], w = pop.weight[i];
      if (!agg.has(c)) agg.set(c, { c, w: 0, inc: 0, wl: 0, pen: 0, tax: 0 });
      const g = agg.get(c);
      g.w += w; g.inc += w * pop.taxable[i]; g.wl += w * pop.wealth[i]; g.pen += w * pop.pension[i]; g.tax += w * t;
      totW += w; totPen += w * pop.pension[i]; totWl += w * pop.wealth[i];
    }
    const intro = document.getElementById('flagIntro');
    if (!totW) {
      intro.textContent = 'No household owes more wealth tax than its yearly income with these settings.';
      document.getElementById('flagTable').innerHTML = '';
      return;
    }
    intro.textContent = `${compact(totW)} households (${pct(last.bStats.flaggedShare)}) would owe more wealth tax than their yearly income. ` +
      `Pension capital, which cannot be sold to pay the tax, makes up ${pct(totPen / totWl, 0)} of their wealth on average.`;
    const hhByCell = new Map(last.cellRows.map((r) => [r.cell, r.households]));
    const rows = [...agg.values()].sort((x, y) => y.w - x.w);
    document.getElementById('flagTable').innerHTML = `<table>
      <thead><tr><th>Household type</th><th>Affected households</th><th>% of type</th><th>Avg income</th><th>Avg wealth</th><th>Pension share of wealth</th><th>Avg tax B</th><th>Tax B / income</th></tr></thead>
      <tbody>${rows.map((g) => `<tr><td>${esc(M.cellLabel(pop.cells[g.c]))}</td><td>${compact(g.w)}</td><td>${pct(g.w / hhByCell.get(g.c))}</td>
        <td>${chf(g.inc / g.w)}</td><td>${chf(g.wl / g.w)}</td><td>${pct(g.pen / g.wl, 0)}</td><td class="b">${chf(g.tax / g.w)}</td><td>${pct(g.tax / g.inc, 0)}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderDiag() {
    const d = pop.diag;
    const items = [
      ['Households', compact(d.totalHouseholds)],
      ['Synthetic sample', `${chf(pop.n)} (${chf(pop.per)} per type)`],
      ['Taxable income (after contributions)', `CHF ${(d.totalTaxable / 1e9).toFixed(0)} bn`],
      ['Net wealth incl. pensions', `CHF ${(d.totalWealth / 1e9).toFixed(0)} bn`],
      ['of which BVG and 3a', `CHF ${(d.totPension / 1e9).toFixed(0)} bn`],
      ['Top 1% income share', pct(d.achievedTop1Income)],
      ['Top 1% non-pension wealth share', pct(d.achievedTop1NonPension)],
      ['Top 1% wealth share incl. pensions', pct(d.top1Wealth)],
      ['Pareto α, income', d.alphaI.toFixed(2)],
      ['Pareto α, wealth', d.alphaW.toFixed(2)],
      ['Income scale factor', '×' + d.sI.toFixed(2)],
      ['Wealth scale factor', '×' + d.sW.toFixed(2)],
    ];
    document.getElementById('diag').innerHTML = items.map(([k, v]) => `<div><span class="muted">${esc(k)}</span><span class="num">${esc(v)}</span></div>`).join('');
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function init() {
    renderControls();
    renderCellTable();
    document.addEventListener('input', onFieldInput);
    document.addEventListener('change', (e) => { if (e.target.dataset.path) { onFieldInput(e); syncInputs(); } });
    document.getElementById('resetBtn').addEventListener('click', () => {
      params = freshParams(); needRebuild = true; syncInputs(); renderCellTable(); recompute();
    });
    document.getElementById('heatMetric').addEventListener('change', () => last && renderHeatmap());
    document.getElementById('groupBy').addEventListener('change', () => last && renderCategoryTable());
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (last) { renderCurves(); renderSchedules(); } }, 150); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (last) { renderCurves(); renderSchedules(); } });
    recompute();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
