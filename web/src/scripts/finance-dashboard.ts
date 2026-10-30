// The finance dashboard: draws the charts with Chart.js from the rows the page embeds, and lets a
// person be switched off from the numbers by clicking their name in a legend. Everything is worked
// out in the browser with the same functions the server uses (lib/finance.ts), so a click needs no
// request and the charts glide to their new shape.
import { mountLive, settled } from './live';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type TooltipItem,
} from 'chart.js';
import { personHex, withAlpha } from '../lib/chart';
import {
  byCategory,
  cashflow,
  dashboardFigures,
  daysIn,
  peopleIn,
  percent,
  rupiah,
  rupiahShort,
  summarize,
  toggleHidden,
  withoutPeople,
  type CashflowPoint,
  type CategoryShare,
  type Trx,
  type Window,
} from '../lib/finance';

interface Payload {
  rows: Trx[];
  categories: { id: number; nama: string; jenis: string }[];
  members: { id: number; name: string }[];
  win: Window;
  hidden: string[];
  single: boolean;
}

// The page content is swapped when the dates or the person change, so the charts are built again each time
// (and the old ones taken down first).
mountLive((root) => {
  const dataEl = root.querySelector('#finance-data');
  if (dataEl) return start(JSON.parse(dataEl.textContent ?? '{}') as Payload);
});

function start(data: Payload): () => void {
  const stop = new AbortController();
  Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Filler);
  const style = getComputedStyle(document.body);
  Chart.defaults.font.family = style.fontFamily;
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#6b6b6b';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) Chart.defaults.animation = false;
  else Chart.defaults.animation = { duration: 450, easing: 'easeOutCubic' };

  const win = data.win;
  const days = daysIn(win);
  const people = data.single ? [] : peopleIn(data.rows, win.start, win.end, data.members);
  const stacked = people.length > 1;
  // Who the bars are made of: the people when there are several, otherwise one piece.
  const series = stacked ? people : [{ key: 'all', name: 'All' }];
  let hidden = new Set(data.hidden.filter((k) => people.some((w) => w.key === k)));
  if (hidden.size >= people.length) hidden = new Set();

  const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector);
  const bucketName = { day: 'day', week: 'week', month: 'month' }[win.bucket];

  // ---- state shared by the tooltips and plugins: replaced on every update ----------------------
  let points: CashflowPoint[] = [];
  const shares: Record<'expense' | 'income', CategoryShare[]> = { expense: [], income: [] };

  const money = (value: unknown) => rupiah(Number(value));
  const axisMoney = (value: unknown) => rupiahShort(Number(value)).replace('Rp ', '');
  const tooltipBase = { backgroundColor: '#0f0e12', titleColor: '#ffffff', bodyColor: '#ffffff', footerColor: '#cccccc', cornerRadius: 0, padding: 10, boxPadding: 4 };

  // ---- chart 1: income and expense per bucket, stacked by person -------------------------------
  function barSets() {
    return (['income', 'expense'] as const).flatMap((kind) =>
      series.map((who, i) => ({
        label: stacked ? `${kind === 'income' ? 'Income' : 'Expense'} · ${who.name}` : kind === 'income' ? 'Income' : 'Expense',
        stack: kind,
        data: points.map((p) => (who.key === 'all' ? p[kind] : (p.people[who.key]?.[kind] ?? 0))),
        backgroundColor: (ctx: { dataIndex: number }) => (points[ctx.dataIndex]?.partial ? withAlpha(personHex(kind, i), 0.45) : personHex(kind, i)),
        borderWidth: 0,
        categoryPercentage: 0.85,
        barPercentage: 0.95,
      })),
    );
  }

  const cashflowCanvas = $<HTMLCanvasElement>('[data-chart="cashflow"]')!;
  const cashflowChart = new Chart<'bar', number[], string>(cashflowCanvas, {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 10, maxRotation: 0 } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#e5e5e5' }, border: { display: false }, ticks: { callback: axisMoney, maxTicksLimit: 6 } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipBase,
          filter: (item: TooltipItem<'bar'>) => Number(item.raw) > 0,
          callbacks: {
            title: (items: TooltipItem<'bar'>[]) => {
              const p = points[items[0]?.dataIndex ?? 0];
              return p ? `${p.label}${p.partial ? ` (part of the ${bucketName})` : ''}` : '';
            },
            label: (item: TooltipItem<'bar'>) => `${item.dataset.label}: ${money(item.raw)}`,
            footer: (items: TooltipItem<'bar'>[]) => {
              const p = points[items[0]?.dataIndex ?? 0];
              return p ? `Net ${money(p.net)}` : '';
            },
          },
        },
      },
    },
  });

  // ---- chart 2: running net ----------------------------------------------------------------------
  const netChart = new Chart<'line', number[], string>($<HTMLCanvasElement>('[data-chart="net"]')!, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{ label: 'Running net', data: [], borderColor: '#0071bb', backgroundColor: 'rgba(0, 113, 187, 0.1)', fill: 'origin', tension: 0.25, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: '#0071bb' }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 10, maxRotation: 0 } },
        y: { grid: { color: '#e5e5e5' }, border: { display: false }, ticks: { callback: axisMoney, maxTicksLimit: 6 } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipBase,
          callbacks: {
            label: (item: TooltipItem<'line'>) => `Running net: ${money(item.raw)}`,
            footer: (items: TooltipItem<'line'>[]) => {
              const p = points[items[0]?.dataIndex ?? 0];
              return p ? `This ${bucketName}: ${money(p.net)}` : '';
            },
          },
        },
      },
    },
  });

  // ---- charts 3 and 4: where the money went / came from ------------------------------------------
  function shareChart(kind: 'expense' | 'income', canvasName: string) {
    const canvas = $<HTMLCanvasElement>(`[data-chart="${canvasName}"]`)!;
    const chart = new Chart<'bar', number[], string>(canvas, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 150 } }, // the amounts are written here, in a column
        scales: {
          x: { stacked: true, display: false, beginAtZero: true },
          y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, color: '#000000', font: { size: 12 } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipBase,
            filter: (item: TooltipItem<'bar'>) => Number(item.raw) > 0,
            callbacks: {
              title: (items: TooltipItem<'bar'>[]) => shares[kind][items[0]?.dataIndex ?? 0]?.name ?? '',
              label: (item: TooltipItem<'bar'>) => (stacked ? `${item.dataset.label}: ${money(item.raw)}` : money(item.raw)),
              footer: (items: TooltipItem<'bar'>[]) => {
                const row = shares[kind][items[0]?.dataIndex ?? 0];
                return row ? `Total ${money(row.total)} · ${percent(row.share)} · ${row.count} transactions` : '';
              },
            },
          },
        },
      },
      plugins: [
        {
          id: 'amounts',
          afterDatasetsDraw(c) {
            const { ctx, scales, width } = c;
            ctx.save();
            ctx.font = `12px ${style.fontFamily}`;
            ctx.fillStyle = '#000000';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            shares[kind].forEach((row, i) => ctx.fillText(`${money(row.total)} · ${percent(row.share)}`, width - 2, scales.y.getPixelForValue(i)));
            ctx.restore();
          },
        },
      ],
    });
    return chart;
  }
  const spendChart = shareChart('expense', 'spend');
  const sourceChart = shareChart('income', 'source');

  function updateShare(kind: 'expense' | 'income', chart: Chart<'bar', number[], string>, list: CategoryShare[]) {
    shares[kind] = list;
    const box = $<HTMLElement>(`[data-share-box="${kind}"]`)!;
    const empty = $<HTMLElement>(`[data-empty="${kind}"]`)!;
    box.hidden = list.length === 0;
    empty.hidden = list.length > 0;
    box.style.height = `${Math.max(1, list.length) * 34 + 12}px`;
    chart.data.labels = list.map((c) => c.name);
    chart.data.datasets = series.map((who, i) => ({
      label: who.name,
      data: list.map((c) => (who.key === 'all' ? c.total : (c.people[who.key] ?? 0))),
      backgroundColor: personHex(kind, i),
      borderWidth: 0,
      barPercentage: 0.7,
      categoryPercentage: 1,
    }));
    chart.update();
  }

  // ---- text around the charts --------------------------------------------------------------------
  const setText = (name: string, text: string) => {
    const el = $<HTMLElement>(`[data-fig="${name}"]`);
    if (el) el.textContent = text;
  };

  function renderTable() {
    const holder = $<HTMLElement>('[data-cashflow-table]')!;
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const [text, num] of [[bucketName, false], ['Income', true], ['Expense', true], ['Savings', true], ['Net', true], ...(stacked ? [['Expense by person', false] as [string, boolean]] : [])] as [string, boolean][]) {
      const th = document.createElement('th');
      th.textContent = text;
      if (num) th.className = 'num';
      head.append(th);
    }
    const body = table.createTBody();
    for (const p of points) {
      const row = body.insertRow();
      [p.label, money(p.income), money(p.expense), money(p.savings), money(p.net)].forEach((text, i) => {
        const cell = row.insertCell();
        cell.textContent = text;
        if (i) cell.className = 'num';
      });
      if (stacked) {
        row.insertCell().textContent = people.filter((w) => p.people[w.key]?.expense).map((w) => `${w.name} ${money(p.people[w.key].expense)}`).join(' · ') || '—';
      }
    }
    holder.replaceChildren(table);
  }

  function renderBiggest(visible: Trx[]) {
    const list = $<HTMLElement>('[data-biggest]')!;
    const empty = $<HTMLElement>('[data-empty="biggest"]')!;
    const top = visible
      .filter((t) => t.jenis === 'pengeluaran' && t.tanggal >= win.start && t.tanggal <= win.end)
      .sort((a, b) => Number(b.nominal) - Number(a.nominal))
      .slice(0, 5);
    const categoryName = new Map(data.categories.map((c) => [c.id, c.nama]));
    const memberName = new Map(data.members.map((m) => [m.id, m.name]));
    empty.hidden = top.length > 0;
    list.hidden = top.length === 0;
    list.replaceChildren(
      ...top.map((t) => {
        const row = document.createElement('div');
        row.className = 'share-row';
        row.style.gridTemplateColumns = '90px 1fr auto';
        const day = document.createElement('span');
        day.textContent = t.tanggal.slice(5);
        const what = document.createElement('span');
        what.append(document.createTextNode(t.deskripsi || '—'), document.createElement('br'));
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = `${t.kategori ? (categoryName.get(t.kategori) ?? 'Uncategorised') : 'Uncategorised'} · ${t.member ? (memberName.get(t.member) ?? '—') : '—'}`;
        what.append(sub);
        const amount = document.createElement('span');
        amount.className = 'num';
        amount.textContent = money(t.nominal);
        row.append(day, what, amount);
        return row;
      }),
    );
  }

  // ---- legends: click a name to leave that person out of everything on the page -------------------
  function renderLegends() {
    document.querySelectorAll<HTMLElement>('[data-legend]').forEach((legend) => {
      legend.hidden = !stacked;
      if (!stacked) return;
      const kinds: ('income' | 'expense')[] = legend.dataset.legend === 'both' ? ['income', 'expense'] : [legend.dataset.legend as 'income' | 'expense'];
      const nodes: Node[] = [];
      for (const kind of kinds) {
        if (kinds.length > 1) {
          const label = document.createElement('span');
          label.className = 'legend-label';
          label.textContent = kind === 'income' ? 'Income (left bar)' : 'Expense (right bar)';
          nodes.push(label);
        }
        people.forEach((who, i) => {
          const off = hidden.has(who.key);
          const onlyOne = !off && hidden.size === people.length - 1; // the last person still counted
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'legend-item';
          button.dataset.person = who.key;
          button.setAttribute('aria-pressed', String(!off));
          if (onlyOne) button.setAttribute('aria-disabled', 'true');
          button.title = onlyOne ? 'At least one person has to stay in the numbers' : off ? `Count ${who.name} again` : `Leave ${who.name} out of the numbers`;
          const swatch = document.createElement('i');
          swatch.className = 'swatch';
          swatch.style.background = off ? 'transparent' : personHex(kind, i);
          swatch.style.border = `1px solid ${personHex(kind, i)}`;
          button.append(swatch, document.createTextNode(` ${who.name}`));
          nodes.push(button);
        });
      }
      legend.replaceChildren(...nodes);
    });
  }

  function remember() {
    const url = new URL(location.href);
    if (hidden.size) url.searchParams.set('hide', [...hidden].join(','));
    else url.searchParams.delete('hide');
    history.replaceState(null, '', url);
    settled();
  }

  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-legend] .legend-item');
    if (button) {
      const next = toggleHidden([...hidden], button.dataset.person!, people.map((w) => w.key));
      if (next.length === hidden.size && !hidden.has(button.dataset.person!)) return; // the last person stays
      hidden = new Set(next);
      remember();
      update();
      return;
    }
    if ((event.target as HTMLElement).closest('[data-count-all]')) {
      hidden = new Set();
      remember();
      update();
    }
  }, { signal: stop.signal });

  // Changing the dates or the person fetches the page again: take the current choice along.
  $<HTMLFormElement>('[data-filterbar]')?.addEventListener('submit', (event) => {
    const form = event.currentTarget as HTMLFormElement;
    form.querySelector('input[name="hide"]')?.remove();
    if (hidden.size && !data.single) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'hide';
      input.value = [...hidden].join(',');
      form.append(input);
    }
  });

  // ---- one update for everything --------------------------------------------------------------------
  function update() {
    const visible = withoutPeople(data.rows, [...hidden]);
    const now = summarize(visible, win.start, win.end);
    const before = summarize(visible, win.prevStart, win.prevEnd);
    points = cashflow(visible, win);

    const f = dashboardFigures(now, before, days);
    setText('income-value', f.income.value);
    setText('income-delta', f.income.delta);
    setText('expense-value', f.expense.value);
    setText('expense-delta', f.expense.delta);
    setText('savings-value', f.savings.value);
    setText('savings-delta', f.savings.delta);
    setText('net-value', f.net.value);
    setText('net-label', f.net.label);
    setText('net-sub', f.net.sub);
    setText('average-value', f.average.value);
    setText('average-sub', f.average.sub);
    $<HTMLElement>('[data-fig="income-delta"]')?.setAttribute('data-good', String(f.income.good));
    $<HTMLElement>('[data-fig="expense-delta"]')?.setAttribute('data-good', String(f.expense.good));
    $<HTMLElement>('[data-fig="savings-delta"]')?.setAttribute('data-good', String(f.savings.good));

    cashflowChart.data.labels = points.map((p) => p.label);
    const sets = barSets();
    if (cashflowChart.data.datasets.length === sets.length) sets.forEach((s, i) => (cashflowChart.data.datasets[i].data = s.data));
    else cashflowChart.data.datasets = sets;
    cashflowChart.update();

    netChart.data.labels = points.map((p) => p.label);
    netChart.data.datasets[0].data = points.map((p) => p.cumulative);
    (netChart.data.datasets[0] as { pointRadius: number }).pointRadius = points.length <= 31 ? 2.5 : 0;
    netChart.update();

    updateShare('expense', spendChart, byCategory(visible, data.categories, 'pengeluaran', win.start, win.end));
    updateShare('income', sourceChart, byCategory(visible, data.categories, 'pemasukan', win.start, win.end, 5));
    const totals = { expense: now.expense, income: now.income };
    for (const kind of ['expense', 'income'] as const) {
      const el = $<HTMLElement>(`[data-total="${kind}"]`);
      if (el) el.textContent = money(totals[kind]);
    }

    renderTable();
    renderBiggest(visible);
    renderLegends();

    const note = $<HTMLElement>('[data-hidden-note]');
    if (note) {
      note.hidden = hidden.size === 0;
      if (hidden.size) {
        const names = people.filter((w) => hidden.has(w.key)).map((w) => w.name).join(', ');
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'arrow-link';
        again.dataset.countAll = '';
        again.textContent = 'count everyone';
        note.replaceChildren(document.createTextNode(`Not counted in the numbers and charts below: ${names}. `), again);
      }
    }
  }

  update();

  return () => {
    stop.abort();
    for (const chart of [cashflowChart, netChart, spendChart, sourceChart]) chart.destroy();
  };
}
