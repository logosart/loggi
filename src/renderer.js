const SESSION_KEY = 'bipeunico.session';
const LEGACY_SESSION_KEY = 'autoscanner.session';

const state = {
  config: null,
  automationConfig: null,
  session: null,
  user: null,
  subscription: null,
  memberships: [],
  organization: null,
  team: {
    usedSeats: null,
    pendingInvites: null
  },
  automation: null,
  history: []
};

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.setTimeout(() => toast.classList.add('hidden'), 3600);
}

function setBadge(element, label, mode) {
  element.textContent = label;
  element.className = `badge ${mode}`;
}

function showView(viewId) {
  const targetButton = document.querySelector(`.nav-item[data-view="${viewId}"]`);
  if (targetButton?.classList.contains('hidden')) return;

  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  targetButton?.classList.add('active');
  $(viewId).classList.add('active');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
}

function isSubscriptionActive(subscription) {
  if (!subscription) return false;
  const activeStatuses = new Set(['active', 'trialing']);
  const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  return activeStatuses.has(subscription.status) && (!periodEnd || periodEnd > new Date());
}

function hasBusinessAdminAccess() {
  if (!isSubscriptionActive(state.subscription) || state.subscription.plan_type !== 'business') return false;
  return state.memberships.some((membership) => (
    membership.organization_id === state.subscription.organization_id
    && membership.status === 'active'
    && ['owner', 'admin'].includes(membership.role)
  ));
}

function planLabel(subscription) {
  if (!subscription) return '-';
  if (subscription.plan_type === 'business') return 'Empresarial';
  return 'Pessoal';
}

function getFriendlyError(error) {
  const message = String(error?.message || error || '');

  if (message.includes('anonymous_provider_disabled')) {
    return 'Cadastro desativado no Supabase. Ative login por e-mail ou crie o usuário pelo painel.';
  }

  if (message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (message.includes('Email not confirmed')) return 'Confirme o e-mail do usuário antes de entrar.';
  if (message.includes('User already registered')) return 'Este e-mail já tem uma conta. Use Entrar.';
  if (message.includes('duplicate key')) return 'Este convite já existe para esta organização.';
  if (message.includes('violates row-level security')) return 'Você não tem permissão para executar esta ação.';

  return message;
}

function missingColumnFromError(error) {
  const message = String(error?.message || error || '');
  return message.match(/'([^']+)' column/)?.[1] || null;
}

async function supabaseFetch(path, options = {}) {
  const { supabaseUrl, supabaseAnonKey } = state.config;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('A conexão do aplicativo não está configurada. Fale com o suporte.');
  }

  if (!navigator.onLine) {
    throw new Error('Sem conexão com a internet. Conecte-se e tente novamente.');
  }

  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${state.session?.access_token || supabaseAnonKey}`,
    'Content-Type': 'application/json',
    ...options.headers
  };

  const response = await fetch(`${supabaseUrl}${path}`, { ...options, headers });
  if (!response.ok) throw new Error(await response.text() || `Erro HTTP ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

function saveSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.localStorage.removeItem(LEGACY_SESSION_KEY);
}

async function refreshSessionIfNeeded() {
  if (!state.session?.refresh_token) return false;

  try {
    const { supabaseUrl, supabaseAnonKey } = state.config;
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: state.session.refresh_token })
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.access_token) throw new Error(result?.error || 'Refresh failed');

    state.session = result;
    state.user = result.user;
    saveSession(result);
    return true;
  } catch {
    logout({ silent: true });
    return false;
  }
}

async function signIn(email, password) {
  const result = await supabaseFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  state.session = result;
  state.user = result.user;
  saveSession(result);
  await refreshAccess();
  render();
  showView(isSubscriptionActive(state.subscription) ? 'automationView' : 'subscriptionView');
}

async function signUp(email, password) {
  const result = await supabaseFetch('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (result.access_token) {
    state.session = result;
    state.user = result.user;
    saveSession(result);
  }

  await refreshAccess();
  render();
  if (state.user) showView('subscriptionView');
}

function normalizeSubscription(row) {
  return {
    plan_type: 'personal',
    organization_id: null,
    ...row
  };
}

async function fetchSubscriptions(queryBase, columns) {
  const selectedColumns = [...columns];

  while (true) {
    try {
      const rows = await supabaseFetch(
        `${queryBase}select=${selectedColumns.join(',')}&order=current_period_end.desc`,
        { method: 'GET' }
      );
      return rows.map(normalizeSubscription);
    } catch (error) {
      const column = missingColumnFromError(error);
      const index = selectedColumns.indexOf(column);
      if (index === -1 || selectedColumns.length <= 3) throw error;
      selectedColumns.splice(index, 1);
    }
  }
}

function pickBestSubscription(rows) {
  const activeRows = rows.filter(isSubscriptionActive);
  const candidates = activeRows.length ? activeRows : rows;
  return candidates.sort((a, b) => {
    if (a.plan_type === b.plan_type) return 0;
    return a.plan_type === 'business' ? -1 : 1;
  })[0] || null;
}

async function refreshAccess() {
  if (!state.user) {
    state.subscription = null;
    state.memberships = [];
    state.organization = null;
    state.team = { usedSeats: null, pendingInvites: null };
    return;
  }

  const table = state.config.subscriptionTable || 'subscriptions';
  const subscriptionColumns = 'id,user_id,organization_id,plan_type,status,current_period_end';
  const subscriptionColumnList = subscriptionColumns.split(',');
  const personalRows = await fetchSubscriptions(
    `/rest/v1/${table}?user_id=eq.${state.user.id}&`,
    subscriptionColumnList
  );

  try {
    state.memberships = await supabaseFetch(
      `/rest/v1/organization_memberships?select=organization_id,role,status,organizations(name,invite_limit)&user_id=eq.${state.user.id}&status=eq.active`,
      { method: 'GET' }
    );
  } catch {
    state.memberships = [];
  }

  const organizationIds = state.memberships.map((membership) => membership.organization_id);
  let organizationRows = [];
  if (organizationIds.length) {
    const ids = organizationIds.join(',');
    organizationRows = await fetchSubscriptions(
      `/rest/v1/${table}?organization_id=in.(${ids})&`,
      subscriptionColumnList
    );
  }

  state.subscription = pickBestSubscription([...personalRows, ...organizationRows]);
  const activeMembership = state.memberships.find((membership) => (
    membership.organization_id === state.subscription?.organization_id
  ));
  state.organization = activeMembership?.organizations || null;

  await refreshTeamStats();
}

async function refreshTeamStats() {
  if (!state.subscription?.organization_id || !hasBusinessAdminAccess()) {
    state.team = { usedSeats: null, pendingInvites: null };
    return;
  }

  const organizationId = state.subscription.organization_id;
  const memberships = await supabaseFetch(
    `/rest/v1/organization_memberships?select=id&organization_id=eq.${organizationId}&status=eq.active`,
    { method: 'GET' }
  );
  const invitations = await supabaseFetch(
    `/rest/v1/organization_invitations?select=id&organization_id=eq.${organizationId}&status=eq.pending`,
    { method: 'GET' }
  );

  state.team = {
    usedSeats: memberships.length,
    pendingInvites: invitations.length
  };
}

async function createInvitation(email) {
  if (!hasBusinessAdminAccess()) {
    throw new Error('Convites estão disponíveis apenas para administradores do plano empresarial.');
  }

  await supabaseFetch('/rest/v1/organization_invitations', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      organization_id: state.subscription.organization_id,
      email: email.trim().toLowerCase(),
      invited_by: state.user.id
    })
  });

  await refreshTeamStats();
  render();
}

async function openCheckout(planType) {
  if (!state.user || !state.session?.access_token) {
    throw new Error('Entre na sua conta antes de assinar.');
  }

  if (!navigator.onLine) {
    throw new Error('Sem conexão com a internet. Conecte-se e tente novamente.');
  }

  const billingUrl = state.config?.billingUrl || '';
  if (!billingUrl) {
    throw new Error('A cobrança do aplicativo não está configurada. Fale com o suporte.');
  }

  if (!billingUrl.includes('/functions/v1/') && !billingUrl.includes('.functions.supabase.co')) {
    await window.desktopApi.openBilling(billingUrl);
    return;
  }

  const organizationName = planType === 'business'
    ? window.prompt('Nome da empresa ou equipe')
    : '';

  if (planType === 'business' && !organizationName?.trim()) {
    throw new Error('Informe o nome da empresa para continuar.');
  }

  const response = await fetch(billingUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      planType,
      organizationName: organizationName?.trim() || undefined
    })
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.url) {
    throw new Error(result?.error || 'Não foi possível criar o checkout.');
  }

  await window.desktopApi.openBilling(result.url);
}

function restoreSession() {
  const raw = window.localStorage.getItem(SESSION_KEY) || window.localStorage.getItem(LEGACY_SESSION_KEY);
  if (!raw) return;

  try {
    const session = JSON.parse(raw);
    if (!session?.access_token || !session?.user) return;
    state.session = session;
    state.user = session.user;
    saveSession(session);
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
  }
}

function logout(options = {}) {
  state.session = null;
  state.user = null;
  state.subscription = null;
  state.memberships = [];
  state.organization = null;
  state.team = { usedSeats: null, pendingInvites: null };
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(LEGACY_SESSION_KEY);
  if (!options.silent) showView('accountView');
  render();
}

function renderAutomationConfig() {
  const config = state.automationConfig || {};
  $('copyDelayInput').value = config.copyDelayMs ?? 80;
  $('pasteDelayInput').value = config.pasteDelayMs ?? 80;
  $('enterDelayInput').value = config.enterDelayMs ?? 120;
  $('returnDelayInput').value = config.returnDelayMs ?? 80;
  $('queueIntervalInput').value = config.queueIntervalMs ?? 500;
  $('returnSelectAllInput').checked = config.returnSelectAll !== false;

  const queue = state.automation?.queue || config.queue || {};
  $('queueFileName').textContent = queue.fileName || 'Nenhuma lista importada';
  $('queueCount').textContent = `${queue.count || 0} códigos carregados`;
}

function statusLabel(status) {
  if (status === 'enviado') return 'Enviado';
  if (status === 'destino_fechado') return 'Destino fechado';
  return status || '-';
}

function sourceLabel(source) {
  if (source === 'manual') return 'Manual';
  if (source === 'planilha') return 'Planilha';
  return source || '-';
}

function getFilteredHistory() {
  const search = $('historySearchInput').value.trim().toLowerCase();
  const from = $('historyFromInput').value;
  const to = $('historyToInput').value;
  const source = $('historySourceInput').value;
  const status = $('historyStatusInput').value;

  return state.history.filter((row) => {
    const date = String(row.createdAt || '').slice(0, 10);
    const haystack = `${row.createdAt} ${row.code} ${row.source} ${row.status}`.toLowerCase();

    if (search && !haystack.includes(search)) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    if (source && row.source !== source) return false;
    if (status && row.status !== status) return false;
    return true;
  });
}

function renderHistory() {
  const rows = getFilteredHistory();
  $('historyCountBadge').textContent = `${rows.length} registro${rows.length === 1 ? '' : 's'}`;

  if (!rows.length) {
    $('historyTableBody').innerHTML = '<tr><td colspan="4">Nenhum registro encontrado.</td></tr>';
    return;
  }

  $('historyTableBody').innerHTML = rows.map((row) => `
    <tr>
      <td>${row.createdAt || '-'}</td>
      <td>${row.code || '-'}</td>
      <td>${sourceLabel(row.source)}</td>
      <td>${statusLabel(row.status)}</td>
    </tr>
  `).join('');
}

async function refreshHistory() {
  state.history = await window.desktopApi.getHistory();
  renderHistory();
}

function render() {
  const active = isSubscriptionActive(state.subscription);
  const businessAdmin = hasBusinessAdminAccess();
  const inviteLimit = state.organization?.invite_limit || 10;
  const usedInvitedSeats = state.team.usedSeats === null ? null : Math.max(state.team.usedSeats - 1, 0);
  const running = Boolean(state.automation?.running);
  const signedIn = Boolean(state.user);

  document.querySelectorAll('.nav-item.auth-only').forEach((button) => {
    button.classList.toggle('hidden', !signedIn);
  });

  $('sessionLabel').textContent = signedIn ? 'Conectado' : 'Desconectado';
  $('sidebarPlan').textContent = active ? `Plano ${planLabel(state.subscription).toLowerCase()} ativo` : 'Sem plano ativo';
  $('accountSubtitle').textContent = signedIn
    ? 'Sua conta está conectada. A assinatura fica em uma aba separada.'
    : 'Entre com o e-mail autorizado para acessar o Bipe Único.';

  $('authForm').classList.toggle('hidden', signedIn);
  $('accountSummary').classList.toggle('hidden', !signedIn);
  $('billingPanel').classList.toggle('hidden', !signedIn || active);
  $('teamNavButton').classList.toggle('hidden', !signedIn || !businessAdmin);

  if (!signedIn && !$('accountView').classList.contains('active')) {
    showView('accountView');
  }

  if (signedIn && !businessAdmin && $('teamView').classList.contains('active')) {
    showView(active ? 'automationView' : 'subscriptionView');
  }

  $('userValue').textContent = state.user?.email || '-';
  $('planValue').textContent = active ? `${planLabel(state.subscription)} (${state.subscription.status})` : '-';
  $('periodValue').textContent = formatDate(state.subscription?.current_period_end);
  $('subscriptionStatusValue').textContent = active ? 'Ativa' : signedIn ? 'Pendente' : '-';

  setBadge(
    $('accountBadge'),
    signedIn ? 'Conectado' : 'Não conectado',
    signedIn ? 'ok' : 'neutral'
  );

  setBadge(
    $('subscriptionBadge'),
    active ? `Plano ${planLabel(state.subscription).toLowerCase()} ativo` : signedIn ? 'Assinatura inativa' : 'Não conectado',
    active ? 'ok' : signedIn ? 'bad' : 'neutral'
  );
  setBadge($('teamBadge'), businessAdmin ? 'Empresarial ativo' : 'Plano empresarial', businessAdmin ? 'ok' : 'neutral');
  setBadge($('runnerBadge'), running ? 'Rodando' : active ? 'Pronto' : 'Plano necessário', running ? 'ok' : active ? 'neutral' : 'bad');

  $('organizationValue').textContent = state.organization?.name || '-';
  $('seatsValue').textContent = usedInvitedSeats === null ? '-' : `${usedInvitedSeats}/${inviteLimit}`;
  $('pendingInvitesValue').textContent = state.team.pendingInvites === null ? '-' : String(state.team.pendingInvites);
  $('inviteButton').disabled = !businessAdmin;
  $('inviteEmail').disabled = !businessAdmin;

  $('ahkPath').textContent = state.automation?.autohotkeyPath || 'Não encontrado';
  $('installAhkButton').textContent = state.automation?.autohotkeyPath ? 'AutoHotkey instalado' : 'Instalar AutoHotkey';
  $('installAhkButton').disabled = Boolean(state.automation?.autohotkeyPath);
  $('startButton').disabled = !active || running;
  $('stopButton').disabled = !running;
  $('importCodesButton').disabled = !active;
  $('clearCodesButton').disabled = !active;
  $('automationConfigForm').querySelectorAll('input, button').forEach((input) => {
    if (input.id !== 'openFolderButton') input.disabled = !active;
  });

  renderAutomationConfig();
  renderHistory();
}

function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });
}

function bindActions() {
  $('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await signIn($('email').value, $('password').value);
      $('password').value = '';
      showToast('Login realizado.');
    } catch (error) {
      showToast(`Falha no login: ${getFriendlyError(error)}`);
    }
  });

  $('signupButton').addEventListener('click', async () => {
    try {
      await signUp($('email').value, $('password').value);
      showToast('Conta criada. Confirme o e-mail se o Supabase exigir confirmação.');
    } catch (error) {
      showToast(`Falha ao criar conta: ${getFriendlyError(error)}`);
    }
  });

  $('logoutButton').addEventListener('click', logout);

  $('personalBillingButton').addEventListener('click', async () => {
    try {
      await openCheckout('personal');
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  });

  $('businessBillingButton').addEventListener('click', async () => {
    try {
      await openCheckout('business');
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  });

  $('inviteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await createInvitation($('inviteEmail').value);
      $('inviteEmail').value = '';
      showToast('Convite registrado.');
    } catch (error) {
      showToast(`Falha ao criar convite: ${getFriendlyError(error)}`);
    }
  });

  $('installAhkButton').addEventListener('click', async () => {
    try {
      const result = await window.desktopApi.installAutoHotkey();
      showToast(result.alreadyInstalled ? 'AutoHotkey já está instalado.' : 'Abrindo instalador oficial do AutoHotkey v2.');
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  });

  $('startButton').addEventListener('click', async () => {
    try {
      await window.desktopApi.startAutomation({ subscriptionActive: isSubscriptionActive(state.subscription) });
      state.automation = await window.desktopApi.getAutomationStatus();
      render();
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  });

  $('stopButton').addEventListener('click', async () => {
    await window.desktopApi.stopAutomation();
    state.automation = await window.desktopApi.getAutomationStatus();
    render();
  });

  $('automationConfigForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      state.automationConfig = await window.desktopApi.saveAutomationConfig({
        copyDelayMs: $('copyDelayInput').value,
        pasteDelayMs: $('pasteDelayInput').value,
        enterDelayMs: $('enterDelayInput').value,
        returnDelayMs: $('returnDelayInput').value,
        queueIntervalMs: $('queueIntervalInput').value,
        returnSelectAll: $('returnSelectAllInput').checked
      });
      showToast('Tempos salvos. Reinicie a automação se ela estiver rodando.');
      render();
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  });

  $('importCodesButton').addEventListener('click', async () => {
    try {
      const queue = await window.desktopApi.importCodes();
      state.automation = { ...(state.automation || {}), queue };
      showToast(`${queue.count || 0} códigos importados.`);
      render();
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  });

  $('clearCodesButton').addEventListener('click', async () => {
    const queue = await window.desktopApi.clearCodes();
    state.automation = { ...(state.automation || {}), queue };
    showToast('Lista limpa.');
    render();
  });

  ['historySearchInput', 'historyFromInput', 'historyToInput', 'historySourceInput', 'historyStatusInput'].forEach((id) => {
    $(id).addEventListener('input', renderHistory);
    $(id).addEventListener('change', renderHistory);
  });

  $('refreshHistoryButton').addEventListener('click', async () => {
    try {
      await refreshHistory();
      showToast('Histórico atualizado.');
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  });

  $('exportHistoryButton').addEventListener('click', async () => {
    try {
      const result = await window.desktopApi.exportHistory(getFilteredHistory());
      if (result.exported) {
        showToast(`Excel exportado com ${result.count} registros.`);
      }
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  });

  $('openFolderButton').addEventListener('click', () => window.desktopApi.openAutomationFolder());
}

async function init() {
  bindNavigation();
  bindActions();
  state.config = await window.desktopApi.getConfig();
  state.automationConfig = await window.desktopApi.getAutomationConfig();
  restoreSession();
  if (state.user) {
    try {
      await refreshSessionIfNeeded();
      await refreshAccess();
    } catch (error) {
      logout({ silent: true });
      showView('accountView');
      showToast(`Sessão expirada. Entre novamente para verificar sua assinatura.`);
    }
  } else {
    showView('accountView');
  }
  state.automation = await window.desktopApi.getAutomationStatus();
  await refreshHistory();
  window.desktopApi.onAutomationStatus((status) => {
    state.automation = status;
    refreshHistory().catch(() => {});
    render();
  });
  render();
}

init();
