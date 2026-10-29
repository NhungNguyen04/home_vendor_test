/**
 * The Vendor Onboarding Tracker front end.
 *
 * Plain DOM and fetch - no framework, no build step. One state object, one
 * render function; every interaction updates the state and re-renders.
 */

const state = {
  coordinator: null,
  vendors: [],
  stages: [],
  thresholdDays: 7,
  asOf: null,
  clockFrozen: false,
  filters: { search: '', stage: '', stuckOnly: false },
  expandedVendorId: null,
  historyByVendor: {},
  messages: {},
};

const $ = (id) => document.getElementById(id);

// ----------------------------------------------------------------- helpers

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  if (response.status !== 204) {
    payload = await response.json().catch(() => null);
  }

  return { status: response.status, ok: response.ok, payload };
}

function formatTimestamp(iso) {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stageClass(stage) {
  const index = state.stages.indexOf(stage);
  return `stage-badge stage-${index === -1 ? 0 : index}`;
}

/**
 * Is this move a step back down the workflow?
 *
 * The ordered list of stages comes down with the vendors, so the browser can
 * tell forward from backward without asking the server.
 */
function isBackwardMove(vendor, target) {
  const from = state.stages.indexOf(vendor.stage);
  const to = state.stages.indexOf(target);
  return from !== -1 && to !== -1 && to < from;
}

// ------------------------------------------------------------------- views

function showLogin() {
  $('dashboard-view').hidden = true;
  $('login-view').hidden = false;
  $('login-error').hidden = true;
}

async function showDashboard() {
  $('login-view').hidden = true;
  $('dashboard-view').hidden = false;

  $('who-name').textContent = state.coordinator?.name ?? '—';
  $('who-email').textContent = state.coordinator?.email ?? '';

  await loadVendors();
}

// ------------------------------------------------------------------ data

async function loadVendors() {
  const { status, payload } = await api('/api/vendors');

  if (status === 401) {
    state.coordinator = null;
    showLogin();
    return;
  }

  if (status !== 200 || !payload) {
    setMessage(null, 'error', 'The vendor list could not be loaded.');
    render();
    return;
  }

  state.vendors = payload.vendors;
  state.stages = payload.stages;
  state.thresholdDays = payload.stuckThresholdDays;
  state.asOf = payload.asOf;
  state.clockFrozen = payload.clockFrozen;

  populateStageFilter();
  render();
}

function populateStageFilter() {
  const select = $('filter-stage');
  const current = select.value;

  if (select.dataset.filled === 'true') return;

  select.replaceChildren(el('option', { value: '', text: 'All stages' }));
  for (const stage of state.stages) {
    select.appendChild(el('option', { value: stage, text: stage }));
  }
  select.dataset.filled = 'true';
  select.value = current;
}

function visibleVendors() {
  const search = state.filters.search.trim().toLowerCase();

  return state.vendors.filter((vendor) => {
    if (state.filters.stage && vendor.stage !== state.filters.stage) return false;
    if (state.filters.stuckOnly && vendor.isStuck !== true) return false;
    if (!search) return true;
    return (
      vendor.name.toLowerCase().includes(search) ||
      vendor.region.toLowerCase().includes(search)
    );
  });
}

function setMessage(vendorId, kind, text) {
  if (vendorId === null) {
    $('login-error').textContent = text;
    $('login-error').hidden = false;
    return;
  }
  state.messages[vendorId] = { kind, text };
}

// ----------------------------------------------------------------- render

function render() {
  renderSummary();
  renderClock();
  renderRows();
}

function renderSummary() {
  const stuck = state.vendors.filter((v) => v.isStuck === true).length;
  const unknown = state.vendors.filter((v) => v.isStuck === null).length;
  const healthy = state.vendors.filter((v) => v.isStuck === false).length;

  $('stat-total').textContent = state.vendors.length;
  $('stat-stuck').textContent = stuck;
  $('stat-unknown').textContent = unknown;
  $('stat-healthy').textContent = healthy;
  $('stat-threshold').textContent = state.thresholdDays;
}

function renderClock() {
  $('clock-value').textContent = state.asOf ? formatTimestamp(state.asOf) : '—';
  $('clock-chip').hidden = !state.clockFrozen;
}

function renderRows() {
  const tbody = $('vendor-rows');
  const vendors = visibleVendors();

  tbody.replaceChildren();
  $('empty-state').hidden = vendors.length > 0;

  for (const vendor of vendors) {
    tbody.appendChild(renderVendorRow(vendor));

    if (state.expandedVendorId === vendor.id) {
      tbody.appendChild(renderHistoryRow(vendor));
    }
  }
}

function renderVendorRow(vendor) {
  const cells = [
    el('td', {}, [
      el('div', { class: 'vendor-name', text: vendor.name }),
      vendor.notes ? el('p', { class: 'vendor-notes', text: vendor.notes }) : null,
    ]),
    el('td', { text: vendor.region }),
    el('td', {}, [
      el('span', { class: stageClass(vendor.stage), text: vendor.stage }),
      vendor.stage === 'KYC Docs Received'
        ? el('span', {
            class: 'kyc-hint',
            text: 'If KYC verification failed, leave the vendor in this stage.',
          })
        : null,
    ]),
    el('td', { text: vendor.owner?.name ?? '—' }),
    el('td', { class: 'time-cell' }, [
      el('span', { text: vendor.durationLabel }),
      el('span', {
        class: 'stage-since',
        text: vendor.stageEnteredAt
          ? `since ${formatTimestamp(vendor.stageEnteredAt)}`
          : 'no stage-entry time recorded',
      }),
    ]),
    el('td', {}, [renderStatus(vendor)]),
    el('td', {}, [renderAction(vendor)]),
  ];

  const row = el('tr', { class: vendor.isStuck === true ? 'is-stuck' : '' }, cells);

  const message = state.messages[vendor.id];
  if (message) {
    row.appendChild(
      el('td', { colspan: '7' }, [
        el('p', {
          class: `row-message row-message-${message.kind}`,
          text: message.text,
        }),
      ]),
    );
  }

  return row;
}

function renderStatus(vendor) {
  if (vendor.isStuck === true) {
    return el('span', { class: 'status status-stuck', text: `Stuck · ${vendor.durationLabel}` });
  }
  if (vendor.isStuck === null) {
    return el('span', {
      class: 'status status-unknown',
      text: 'No stage-entry time',
    });
  }
  return el('span', { class: 'status status-ok', text: 'Not stuck' });
}

function renderAction(vendor) {
  const select = el('select', { 'aria-label': `New stage for ${vendor.name}` });
  for (const stage of state.stages) {
    select.appendChild(el('option', { value: stage, text: stage }));
  }
  select.value = vendor.stage;

  // Moving a vendor back is rework, so the coordinator has to say why. The
  // server insists on it too; this is here so the reason is captured rather
  // than rejected.
  const reason = el('input', {
    type: 'text',
    placeholder: 'Why is the vendor moving back?',
    'aria-label': `Reason for moving ${vendor.name} back`,
  });
  reason.hidden = true;

  const update = el('button', {
    type: 'button',
    class: 'btn',
    text: 'Update',
    onclick: () => updateStage(vendor.id, select.value, reason.value),
  });

  // The button is toggled through the DOM property, not through el()'s
  // attribute map: el() turns `false` into disabled="false", and a present
  // boolean attribute disables the button whatever its value says.
  const sync = () => {
    const backward = isBackwardMove(vendor, select.value);
    reason.hidden = !backward;
    if (!backward) reason.value = '';
    update.disabled = backward && reason.value.trim() === '';
  };

  select.addEventListener('change', sync);
  reason.addEventListener('input', sync);
  sync();

  const toggle = el('button', {
    type: 'button',
    class: 'history-toggle',
    text:
      state.expandedVendorId === vendor.id
        ? 'Hide history'
        : `Show history (${vendor.version - 1})`,
    onclick: () => toggleHistory(vendor.id),
  });

  return el('div', {}, [
    el('div', { class: 'action' }, [select, update, reason]),
    toggle,
  ]);
}

function renderHistoryRow(vendor) {
  const entries = state.historyByVendor[vendor.id];

  let content;
  if (entries === undefined) {
    content = el('p', { class: 'empty', text: 'Loading history…' });
  } else if (entries.length === 0) {
    content = el('p', {
      class: 'empty',
      text: 'No changes have been recorded for this vendor yet.',
    });
  } else {
    const items = entries.map((entry) =>
      el('li', {}, [
        el('div', { class: 'transition' }, [
          el('span', { text: entry.previousStage ?? 'Imported' }),
          el('span', { class: 'arrow', text: '→' }),
          el('span', { text: entry.newStage }),
        ]),
        el('div', {
          class: 'meta',
          text: `${entry.changedBy.name} · ${formatTimestamp(entry.changedAt)}`,
        }),
        entry.reason
          ? el('div', { class: 'reason', text: `Reason: ${entry.reason}` })
          : null,
      ]),
    );
    content = el('ul', { class: 'timeline' }, items);
  }

  return el('tr', { class: 'history-row' }, [
    el('td', { colspan: '7' }, [
      el('div', { class: 'history-inner' }, [
        el('h3', { text: `History · ${vendor.name}` }),
        content,
      ]),
    ]),
  ]);
}

// --------------------------------------------------------------- actions

async function updateStage(vendorId, stage, reason) {
  const vendor = state.vendors.find((v) => v.id === vendorId);
  if (!vendor) return;

  delete state.messages[vendorId];

  const body = { stage, expectedVersion: vendor.version };
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (trimmedReason !== '') body.reason = trimmedReason;

  const { status, payload } = await api(`/api/vendors/${vendorId}/stage`, {
    method: 'PATCH',
    body,
  });

  if (status === 200) {
    if (payload.changed) {
      setMessage(vendorId, 'info', `${vendor.name} moved to ${stage}.`);
    } else {
      setMessage(
        vendorId,
        'info',
        `${vendor.name} is already in ${stage}. Nothing was changed.`,
      );
    }
    delete state.historyByVendor[vendorId];
    await loadVendors();
    return;
  }

  if (status === 409) {
    // Somebody else changed this vendor. Their change stands; ours was not
    // applied, and the row is refreshed so the coordinator sees the truth.
    setMessage(
      vendorId,
      'conflict',
      payload?.error?.message ??
        'This vendor was changed by someone else. Your change was not applied.',
    );
    await loadVendors();
    return;
  }

  setMessage(
    vendorId,
    'error',
    payload?.error?.message ?? 'The stage change could not be saved.',
  );
  render();
}

async function toggleHistory(vendorId) {
  if (state.expandedVendorId === vendorId) {
    state.expandedVendorId = null;
    render();
    return;
  }

  state.expandedVendorId = vendorId;
  render();

  const { status, payload } = await api(`/api/vendors/${vendorId}/history`);

  if (status === 200) {
    state.historyByVendor[vendorId] = payload.history;
  } else {
    state.historyByVendor[vendorId] = [];
  }
  render();
}

async function handleLogin(event) {
  event.preventDefault();

  const email = $('email').value.trim();
  const password = $('password').value;
  const error = $('login-error');
  error.hidden = true;

  if (!email || !password) {
    error.textContent = 'Enter your email address and password.';
    error.hidden = false;
    return;
  }

  const { status, payload } = await api('/api/login', {
    method: 'POST',
    body: { email, password },
  });

  if (status !== 200) {
    error.textContent = payload?.error?.message ?? 'Sign in failed.';
    error.hidden = false;
    return;
  }

  state.coordinator = payload.coordinator;
  $('password').value = '';
  await showDashboard();
}

async function handleLogout() {
  await api('/api/logout', { method: 'POST' });
  state.coordinator = null;
  state.vendors = [];
  state.expandedVendorId = null;
  state.historyByVendor = {};
  state.messages = {};
  showLogin();
}

// ----------------------------------------------------------------- wiring

$('login-form').addEventListener('submit', handleLogin);

$('logout-button').addEventListener('click', handleLogout);

$('refresh-button').addEventListener('click', () => loadVendors());

$('filter-search').addEventListener('input', (event) => {
  state.filters.search = event.target.value;
  renderRows();
});

$('filter-stage').addEventListener('change', (event) => {
  state.filters.stage = event.target.value;
  renderRows();
});

$('filter-stuck').addEventListener('change', (event) => {
  state.filters.stuckOnly = event.target.checked;
  renderRows();
});

$('filter-reset').addEventListener('click', () => {
  state.filters = { search: '', stage: '', stuckOnly: false };
  $('filter-search').value = '';
  $('filter-stage').value = '';
  $('filter-stuck').checked = false;
  renderRows();
});

for (const button of document.querySelectorAll('.demo-link')) {
  button.addEventListener('click', () => {
    $('email').value = button.dataset.email;
    $('password').value = 'ops1234';
    $('login-form').requestSubmit();
  });
}

// -------------------------------------------------------------------- boot

(async function boot() {
  const { status, payload } = await api('/api/me');

  if (status === 200 && payload?.coordinator) {
    state.coordinator = payload.coordinator;
    await showDashboard();
  } else {
    showLogin();
  }
})();
