const SESSION_KEY = 'bipeunico.session';
const LEGACY_SESSION_KEY = 'autoscanner.session';

const state = {
  config: null,
  session: null,
  user: null,
  subscription: null,
  memberships: [],
  organization: null,
  team: {
    usedSeats: null,
    pendingInvites: null
  },
  automation: null
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
    return 'Cadastro desativado no Supabase. Em Authentication > Providers, ative Email ou crie o usuário pelo painel do Supabase.';
  }

  if (message.includes('Invalid login credentials')) {
    return 'E-mail ou senha incorretos.';
  }

  if (message.includes('Email not confirmed')) {
    return 'Confirme o e-mail do usuário no Supabase antes de entrar.';
  }

  if (message.includes('User already registered')) {
    return 'Este e-mail já tem uma conta. Use Entrar.';
  }

  if (message.includes('duplicate key')) {
    return 'Este convite já existe para esta organização.';
  }

  if (message.includes('violates row-level security')) {
    return 'Você não tem permissão para executar esta ação ou o limite de convites foi atingido.';
  }

  return message;
}

async function supabaseFetch(path, options = {}) {
  const { supabaseUrl, supabaseAnonKey } = state.config;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_ANON_KEY no arquivo .env.');
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
  const personalQuery = `/rest/v1/${table}?select=${subscriptionColumns}&user_id=eq.${state.user.id}&order=current_period_end.desc`;
  const personalRows = await supabaseFetch(personalQuery, { method: 'GET' });

  state.memberships = await supabaseFetch(
    `/rest/v1/organization_memberships?select=organization_id,role,status,organizations(name,invite_limit)&user_id=eq.${state.user.id}&status=eq.active`,
    { method: 'GET' }
  );

  const organizationIds = state.memberships.map((membership) => membership.organization_id);
  let organizationRows = [];
  if (organizationIds.length) {
    const ids = organizationIds.join(',');
    organizationRows = await supabaseFetch(
      `/rest/v1/${table}?select=${subscriptionColumns}&organization_id=in.(${ids})&order=current_period_end.desc`,
      { method: 'GET' }
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

function logout() {
  state.session = null;
  state.user = null;
  state.subscription = null;
  state.memberships = [];
  state.organization = null;
  state.team = { usedSeats: null, pendingInvites: null };
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(LEGACY_SESSION_KEY);
  render();
}

function render() {
  const active = isSubscriptionActive(state.subscription);
  const businessAdmin = hasBusinessAdminAccess();
  const inviteLimit = state.organization?.invite_limit || 10;
  const usedInvitedSeats = state.team.usedSeats === null ? null : Math.max(state.team.usedSeats - 1, 0);
  const running = Boolean(state.automation?.running);

  $('sessionLabel').textContent = state.user ? 'Conectado' : 'Desconectado';
  $('userValue').textContent = state.user?.email || '-';
  $('planValue').textContent = active ? `${planLabel(state.subscription)} (${state.subscription.status})` : '-';
  $('periodValue').textContent = formatDate(state.subscription?.current_period_end);
  $('supabaseUrlValue').textContent = state.config?.supabaseUrl ? 'Configurado' : 'Não configurado';
  $('subscriptionTableValue').textContent = state.config?.subscriptionTable ? 'Configurada' : 'Não configurada';
  $('billingUrlValue').textContent = state.config?.billingUrl ? 'Configurada' : 'Não configurada';

  setBadge($('subscriptionBadge'), active ? `Plano ${planLabel(state.subscription).toLowerCase()} ativo` : state.user ? 'Assinatura inativa' : 'Não conectado', active ? 'ok' : state.user ? 'bad' : 'neutral');
  setBadge($('teamBadge'), businessAdmin ? 'Empresarial ativo' : active && state.subscription?.plan_type === 'business' ? 'Membro empresarial' : 'Plano pessoal', businessAdmin ? 'ok' : 'neutral');
  setBadge($('runnerBadge'), running ? 'Rodando' : 'Parado', running ? 'ok' : 'neutral');

  $('organizationValue').textContent = state.organization?.name || '-';
  $('seatsValue').textContent = usedInvitedSeats === null ? '-' : `${usedInvitedSeats}/${inviteLimit}`;
  $('pendingInvitesValue').textContent = state.team.pendingInvites === null ? '-' : String(state.team.pendingInvites);
  $('inviteButton').disabled = !businessAdmin;
  $('inviteEmail').disabled = !businessAdmin;

  $('ahkPath').textContent = state.automation?.autohotkeyPath || 'Não encontrado';
  $('automationDir').textContent = state.automation?.automationDir || '-';
  $('installAhkButton').textContent = state.automation?.autohotkeyPath ? 'AutoHotkey instalado' : 'Instalar AutoHotkey';
  $('installAhkButton').disabled = Boolean(state.automation?.autohotkeyPath);
  $('startButton').disabled = !active || running;
  $('stopButton').disabled = !running;
}

function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
      button.classList.add('active');
      $(button.dataset.view).classList.add('active');
    });
  });
}

function bindActions() {
  $('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await signIn($('email').value, $('password').value);
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

  $('billingButton').addEventListener('click', async () => {
    try {
      await window.desktopApi.openBilling(state.config?.billingUrl);
    } catch (error) {
      showToast(getFriendlyError(error));
    }
  });

  $('inviteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await createInvitation($('inviteEmail').value);
      $('inviteEmail').value = '';
      showToast('Convite registrado. O envio do e-mail deve ser feito pelo backend.');
    } catch (error) {
      showToast(`Falha ao criar convite: ${getFriendlyError(error)}`);
    }
  });

  $('installAhkButton').addEventListener('click', async () => {
    try {
      const result = await window.desktopApi.installAutoHotkey();
      if (result.alreadyInstalled) {
        showToast('AutoHotkey já está instalado.');
      } else {
        showToast('Abrindo o instalador oficial do AutoHotkey v2.');
      }
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

  $('openFolderButton').addEventListener('click', () => window.desktopApi.openAutomationFolder());
}

async function init() {
  bindNavigation();
  bindActions();
  state.config = await window.desktopApi.getConfig();
  restoreSession();
  if (state.user) {
    try {
      await refreshAccess();
    } catch (error) {
      showToast(`Não foi possível verificar a assinatura: ${getFriendlyError(error)}`);
    }
  }
  state.automation = await window.desktopApi.getAutomationStatus();
  window.desktopApi.onAutomationStatus((status) => {
    state.automation = status;
    render();
  });
  render();
}

init();
