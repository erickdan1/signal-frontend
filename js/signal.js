// ══════════════════════════════════════════════════════════════════
// ESTADO
// ══════════════════════════════════════════════════════════════════
let STATE = {
  data:     null,
  events:   [],
  filter:   'all',
  query:    '',
  module:   'feed',
};
let cProb = null, cZ = null;

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════
function getMagnitude(z) {
  const a = Math.abs(z);
  if (a >= 4.5) return 'raro';
  if (a >= 3.0) return 'forte';
  if (a >= 2.0) return 'moderado';
  return 'fraco';
}

function getMagnitudeLabel(mag) {
  return { raro: 'Raro', forte: 'Forte', moderado: 'Moderado', fraco: 'Fraco' }[mag] || mag;
}

function fmtDate(s) {
  if (!s) return '-';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return s; }
}

function fmtVol(v) {
  if (!v) return '-';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function fmtModel(m) {
  if (!m) return '-';
  return m.replace('Gemini 2.5 Flash', 'Gemini').replace('Gemma 3 27B', 'Gemma').replace('Qwen 2.5 72B', 'Qwen');
}

function brierClass(bs) {
  if (bs === null || bs === undefined) return 'neutral';
  if (bs < 0.12) return 'good';
  if (bs < 0.20) return 'neutral';
  return 'bad';
}

// ══════════════════════════════════════════════════════════════════
// FETCH
// ══════════════════════════════════════════════════════════════════
// ── CSV parser ────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => {
      const n = parseFloat(vals[i]);
      obj[h] = isNaN(n) ? vals[i] : n;
    });
    return obj;
  });
}

async function loadData() {
  try {
    // ── 1. Carrega o feed principal ───────────────────────────────
    const r = await fetch('data/demo_cache.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();

    STATE.data   = json;
    STATE.events = (json.events || []).map(e => ({
      ...e,
      _mag: getMagnitude(e.zscore),
    }));

    document.getElementById('top-ts').textContent =
      json.gerado_em
        ? new Date(json.gerado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';

    // ── 2. Tenta carregar sensibilidade.csv (override ao campo do JSON) ──
    try {
      const rc = await fetch('data/sensibilidade.csv');
      if (rc.ok) {
        const csvText = await rc.text();
        const parsed  = parseCSV(csvText);
        if (parsed.length > 0) {
          STATE.data._sensibilidade_csv = parsed; // guarda separado para o render
        }
      }
    } catch (_) {
      // CSV ausente — renderCalibration usará STATE.data.sensibilidade ou fallback hardcoded
    }

    renderFeed();
    populateChartSelect();
    renderCalibration();

  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    showError(err.message);
  }
}

function showError(msg) {
  document.getElementById('view-feed').innerHTML = `
    <div class="state-box">
      <svg class="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
      </svg>
      <p>Não foi possível carregar <code>data/demo_cache.json</code>.<br>
      Certifique-se de que o ficheiro existe e está acessível.<br>
      <small style="color:var(--text-3)">${msg}</small></p>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// FEED
// ══════════════════════════════════════════════════════════════════
function renderFeed() {
  const q    = STATE.query.toLowerCase();
  const filt = STATE.filter;

  let list = STATE.events.filter(e => {
    if (filt !== 'all' && e._mag !== filt) return false;
    if (q && ![(e.questao || ''), (e.evento || '')].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });

  const container = document.getElementById('view-feed');
  if (!list.length) {
    container.innerHTML = `<div class="state-box"><p>Nenhum sinal encontrado para os filtros actuais.</p></div>`;
    return;
  }

  const maxZ = Math.max(...list.map(e => Math.abs(e.zscore || 0)));

  const sumBar = `
    <div class="sum-bar">
      <div class="sum-cell"><span class="sum-val">${list.length}</span><span class="sum-lbl">sinais</span></div>
      <div class="sum-cell"><span class="sum-val" style="font-family:var(--mono)">${maxZ.toFixed(2)}</span><span class="sum-lbl">z máx</span></div>
      <div class="sum-cell"><span class="sum-val" style="font-family:var(--mono)">${
        STATE.data?.threshold != null ? STATE.data.threshold.toFixed(1) : '-'
      }</span><span class="sum-lbl">threshold z*</span></div>
      <div class="sum-cell" style="border:none;margin-left:auto">
        <span class="sum-note">Polymarket CLOB API · Demo Mode</span>
      </div>
    </div>`;

  container.innerHTML = sumBar + list.map((e, i) => cardHTML(e, i)).join('');
}

function statusBadge(resultado) {
  const isOpen = resultado === null || resultado === undefined || resultado === '';
  if (isOpen) {
    return `<span class="status-badge status-open">
      <span class="pulse-dot"></span>Em Aberto
    </span>`;
  }
  const label = String(resultado).toUpperCase();
  return `<span class="status-badge status-closed">
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>Encerrado: ${label}
  </span>`;
}

function cardHTML(e, i) {
  const mag      = e._mag;
  const probYes  = +(e.prob_yes  || 0).toFixed(1);
  const probNo   = +(100 - probYes).toFixed(1);
  const varNum   = e.variacao || 0;
  const varSign  = varNum >= 0 ? '+' : '';
  const varClass = varNum >= 0 ? 'pos' : 'neg';
  const zAbs     = Math.abs(e.zscore || 0);
  const zHi      = zAbs >= 3.5;

  return `
  <article class="card ${mag}" id="card-${e.id || i}">
    <div class="card-header">
      <div class="card-chips">
        <span class="z-chip ${zHi ? 'hi' : ''}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          z ${(e.zscore || 0).toFixed(2)}
        </span>
      </div>
    </div>
    <div class="card-meta-row">
      ${statusBadge(e.resultado)}
      <span class="card-date">${fmtDate(e.data)}</span>
    </div>

    <div class="card-evento">${e.evento || ''}</div>
    <div class="card-question">${e.questao_pt || '-'}</div>

    <div class="bin-wrap">
      <div class="bin-lbl">Probabilidade de mercado</div>
      <div class="bin-track">
        <div class="b-yes" style="width:${probYes}%">
          ${probYes >= 18 ? `SIM&nbsp;${probYes}%` : ''}
        </div>
        <div class="b-no">
          ${probNo >= 18 ? `NÃO&nbsp;${probNo}%` : ''}
        </div>
      </div>
      <div class="bin-labels">
        <span>${probYes < 18 ? `SIM ${probYes}%` : ''}</span>
        <span>${probNo < 18 ? `NÃO ${probNo}%` : ''}</span>
      </div>
    </div>

    <div class="narrative-wrap">
      <div class="narrative collapsed" id="narr-${e.id || i}">${e.narrativa || '<p>Narrativa não disponível.</p>'}</div>
      <button class="toggle-btn" onclick="toggleNarr('${e.id || i}', this)">Ler análise →</button>
    </div>

    <div class="card-foot">
      <span class="delta-chip ${varClass}">${varSign}${varNum.toFixed(1)}pp</span>
      <span class="foot-vol">vol <span>${fmtVol(e.volume)}</span></span>
      <span class="model-pill">${fmtModel(e.modelo_usado)}</span>
    </div>
  </article>`;
}

function toggleNarr(id, btn) {
  const el = document.getElementById(`narr-${id}`);
  if (!el) return;
  const isCollapsed = el.classList.toggle('collapsed');
  btn.textContent = isCollapsed ? 'Ler análise →' : '← Recolher';
}

// ══════════════════════════════════════════════════════════════════
// GRÁFICOS
// ══════════════════════════════════════════════════════════════════
function populateChartSelect() {
  const sel = document.getElementById('chart-ev-sel');
  sel.innerHTML = STATE.events.map((e, i) => {
    const d = e.data ? e.data.slice(0, 10) : `ev-${i}`;
    const q = (e.questao || '').slice(0, 60);
    return `<option value="${i}">${d} · ${q}</option>`;
  }).join('');
  sel.onchange = () => renderEventCharts();
}

function renderEventCharts() {
  const idx = parseInt(document.getElementById('chart-ev-sel').value) || 0;
  const ev  = STATE.events[idx];
  if (!ev) return;

  const thresh  = STATE.data?.threshold || 2.0;
  const labels  = ['Antes (−3d)', 'Evento', 'Depois (+3d)'];
  const probs   = [ev.prob_antes || 0, ev.prob_yes || 0, ev.prob_depois || 0];
  const zVals   = [0, Math.abs(ev.zscore || 0), 0];

  const ptColors = probs.map((_, i) => i === 1 ? '#7c6af7' : '#5a5866');
  const ptRadius = probs.map((_, i) => i === 1 ? 8 : 5);

  const commonOpt = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { displayColors: false, backgroundColor: '#1e1e24', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1, titleColor: '#9896a4', bodyColor: '#ededf0', titleFont: { family: "'DM Mono'", size: 11 }, bodyFont: { family: "'DM Mono'", size: 12 } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#5a5866', font: { family: "'DM Mono'", size: 10 } } },
      y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#5a5866', font: { family: "'DM Mono'", size: 10 } } },
    },
  };

  Chart.defaults.color = '#9896a4';

  if (cProb) cProb.destroy();
  cProb = new Chart(document.getElementById('c-prob'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: probs,
        borderColor: '#7c6af7',
        borderWidth: 2,
        tension: 0.35,
        pointBackgroundColor: ptColors,
        pointBorderColor: ptColors,
        pointRadius: ptRadius,
        pointHoverRadius: 10,
        fill: { target: 'origin', above: 'rgba(124,106,247,0.04)' },
      }],
    },
    options: {
      ...commonOpt,
      scales: {
        ...commonOpt.scales,
        y: { ...commonOpt.scales.y, min: Math.max(0, Math.min(...probs) - 10), max: Math.min(100, Math.max(...probs) + 10), ticks: { ...commonOpt.scales.y.ticks, callback: v => v + '%' } },
      },
      plugins: { ...commonOpt.plugins, tooltip: { ...commonOpt.plugins.tooltip, callbacks: { label: ctx => `${ctx.parsed.y.toFixed(1)}%` } } },
    },
  });

  if (cZ) cZ.destroy();
  cZ = new Chart(document.getElementById('c-z'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: zVals,
          backgroundColor: zVals.map((v, i) => i === 1 && v >= thresh ? 'rgba(224,82,82,.55)' : 'rgba(90,88,102,.35)'),
          borderColor: zVals.map((v, i) => i === 1 && v >= thresh ? '#e05252' : 'transparent'),
          borderWidth: 1,
          borderRadius: 5,
        },
        {
          type: 'line',
          data: labels.map(() => thresh),
          borderColor: 'rgba(217,144,64,.6)',
          borderDash: [5, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      ...commonOpt,
      scales: {
        ...commonOpt.scales,
        y: { ...commonOpt.scales.y, min: 0, max: Math.max(thresh + 0.8, ...zVals) + 0.3 },
      },
      plugins: { ...commonOpt.plugins, tooltip: { ...commonOpt.plugins.tooltip, callbacks: { label: ctx => ctx.datasetIndex === 0 ? `z = ${ctx.parsed.y.toFixed(2)}` : null }, filter: i => i.datasetIndex === 0 } },
    },
  });

  // Info row
  const upDown = (ev.variacao || 0) >= 0 ? 'pos' : 'neg';
  document.getElementById('ci-antes').textContent  = `${(ev.prob_antes || 0).toFixed(1)}%`;
  document.getElementById('ci-ev').className       = `cinfo-val ${upDown}`;
  document.getElementById('ci-ev').textContent     = `${(ev.prob_yes || 0).toFixed(1)}%`;
  document.getElementById('ci-depois').textContent = `${(ev.prob_depois || 0).toFixed(1)}%`;
  document.getElementById('chart-q-label').textContent = (ev.questao || '').slice(0, 30);
  document.getElementById('chart-z-label').textContent = `z = ${(ev.zscore || 0).toFixed(2)}`;
}

// ══════════════════════════════════════════════════════════════════
// CALIBRAÇÃO
// ══════════════════════════════════════════════════════════════════
function renderCalibration() {
  const d      = STATE.data || {};
  const evs    = STATE.events;
  const bs     = d.brier_score;
  const bsNull = bs === null || bs === undefined;

  // Brier Score card
  const bsEl     = document.getElementById('cal-brier');
  const bsNote   = document.getElementById('cal-brier-note');
  const bsBar    = document.getElementById('cal-bs-bar');
  const bsClass  = brierClass(bs);

  bsEl.textContent  = bsNull ? '-' : bs.toFixed(4);
  bsEl.className    = `cal-value ${bsClass}`;
  bsNote.textContent = bsNull
    ? 'Brier Score não disponível. Contratos sem desfecho confirmado.'
    : bs < 0.12
      ? 'Excelente calibração - significativamente abaixo do baseline aleatório (0,250).'
      : bs < 0.20
        ? 'Calibração moderada. Espaço para melhoria com mais dados.'
        : 'Acima do esperado. Verificar qualidade dos contratos monitorados.';

  if (!bsNull) {
    const pct = Math.max(0, Math.min(100, (1 - bs / 0.25) * 100));
    bsBar.style.width = `${pct}%`;
  }

  // Parâmetros
  document.getElementById('cal-thresh').textContent = d.threshold != null ? d.threshold.toFixed(1) : '-';
  document.getElementById('cal-janela').textContent = d.janela != null ? d.janela : '-';

  // Meta
  document.getElementById('cm-events').textContent = evs.length;
  const closed = evs.filter(e => e.resultado && e.resultado !== 'em aberto' && e.resultado !== null).length;
  document.getElementById('cm-closed').textContent = closed;
  const fb = evs.filter(e => e.tentativas && e.tentativas.length > 1).length;
  document.getElementById('cm-fb').textContent = fb;

  // Tabela de sensibilidade — prioridade: CSV > JSON > fallback hardcoded
  const sensData =
    STATE.data._sensibilidade_csv ||
    d.sensibilidade ||
    [
      { z_threshold:1.5, signals_brutos:3487, signals_dedup:205, alto_volume:194 },
      { z_threshold:2.0, signals_brutos:2668, signals_dedup:204, alto_volume:193 },
      { z_threshold:2.5, signals_brutos:1854, signals_dedup:201, alto_volume:190 },
    ];
  const active = d.threshold || 2.0;

  document.getElementById('sens-tbody').innerHTML = sensData.map(s => {
    const ratio   = s.signals_dedup > 0 ? s.alto_volume / s.signals_dedup : 0;
    const ratioP  = (ratio * 100).toFixed(0);
    const rClass  = ratio >= 0.75 ? 'good' : ratio >= 0.5 ? 'ok' : 'bad';
    const isActive = Math.abs(s.z_threshold - active) < 0.01;
    return `<tr class="${isActive ? 'row-active' : ''}">
      <td class="${isActive ? 'td-active' : ''}">z* = ${s.z_threshold.toFixed(1)}${isActive ? ' ✓' : ''}</td>
      <td>${(s.signals_brutos || 0).toLocaleString('pt-BR')}</td>
      <td>${(s.signals_dedup  || 0).toLocaleString('pt-BR')}</td>
      <td>${(s.alto_volume    || 0).toLocaleString('pt-BR')}</td>
      <td><span class="ratio-pill ${rClass}">${ratioP}%</span></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════
// NAVEGAÇÃO
// ══════════════════════════════════════════════════════════════════
function switchModule(mod) {
  STATE.module = mod;

  // Sidebar (desktop)
  document.querySelectorAll('.nb[data-mod]').forEach(b => b.classList.toggle('active', b.dataset.mod === mod));
  // Bottom nav (mobile)
  document.querySelectorAll('.bn-btn[data-mod]').forEach(b => b.classList.toggle('active', b.dataset.mod === mod));

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${mod}`).classList.add('active');

  const fs = document.getElementById('filter-section');
  if (fs) { fs.style.opacity = mod === 'feed' ? '1' : '.35'; fs.style.pointerEvents = mod === 'feed' ? 'auto' : 'none'; }

  if (mod === 'charts') setTimeout(renderEventCharts, 60);
}

// ══════════════════════════════════════════════════════════════════
// EVENTOS DOM
// ══════════════════════════════════════════════════════════════════

// Sidebar desktop
document.querySelectorAll('.nb[data-mod]').forEach(btn => {
  btn.addEventListener('click', () => switchModule(btn.dataset.mod));
});

// Bottom nav mobile
document.querySelectorAll('.bn-btn[data-mod]').forEach(btn => {
  btn.addEventListener('click', () => switchModule(btn.dataset.mod));
});

// Filtro por magnitude removido — todos os sinais exibidos por padrão
STATE.filter = 'all';

// Quick search — sidebar desktop
document.querySelectorAll('.nb[data-quick]').forEach(btn => {
  btn.addEventListener('click', () => {
    STATE.query  = btn.dataset.quick;
    STATE.filter = 'all';
    document.getElementById('search').value = btn.dataset.quick;
    renderFeed();
  });
});

// Quick chips — mobile
document.querySelectorAll('.qc-btn[data-quick]').forEach(btn => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.quick;
    // Toggle: clicar de novo limpa o filtro
    if (STATE.query === q) {
      STATE.query = '';
      document.getElementById('search').value = '';
      document.querySelectorAll('.qc-btn').forEach(b => b.classList.remove('active'));
    } else {
      STATE.query = q;
      document.getElementById('search').value = q;
      document.querySelectorAll('.qc-btn').forEach(b => b.classList.toggle('active', b.dataset.quick === q));
    }
    STATE.filter = 'all';
    renderFeed();
  });
});

document.getElementById('search').addEventListener('input', e => {
  STATE.query = e.target.value.trim();
  // Deseleciona quick chips se o usuário digita manualmente
  document.querySelectorAll('.qc-btn').forEach(b => b.classList.remove('active'));
  renderFeed();
});

// ── Init ─────────────────────────────────────────────────────────
loadData();
