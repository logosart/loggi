const state = {
  config: null,
  session: null,
  user: null,
  subscription: null,
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

async function signIn(email, password) {
  const result = await supabaseFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  state.session = result;
  state.user = result.user;
  window.localStorage.setItem('autoscanner.session', JSON.stringify(result));
  await refreshSubscription();
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
    window.localStorage.setItem('autoscanner.session', JSON.stringify(result));
  }

  await refreshSubscription();
  render();
}

async function refreshSubscription() {
  if (!state.user) {
    state.subscription = null;
    return;
  }

  const table = state.config.subscriptionTable || 'subscriptions';
  const query = `/rest/v1/${table}?select=status,current_period_end&user_id=eq.${state.user.id}&order=current_period_end.desc&limit=1`;
  const rows = await supabaseFetch(query, {
    method: 'GET',
    headers: { Prefer: 'return=representation' }
  });

  state.subscription = rows[0] || null;
}

function restoreSession() {
  const raw = window.localStorage.getItem('autoscanner.session');
  if (!raw) return;

  try {
    const session = JSON.parse(raw);
    if (!session?.access_token || !session?.user) return;
    state.session = session;
    state.user = session.user;
  } catch {
    window.localStorage.removeItem('autoscanner.session');
  }
}

function logout() {
  state.session = null;
  state.user = null;
  state.subscription = null;
  window.localStorage.removeItem('autoscanner.session');
  render();
}

function render() {
  const active = isSubscriptionActive(state.subscription);
  $('sessionLabel').textContent = state.user ? 'Conectado' : 'Desconectado';
  $('userValue').textContent = state.user?.email || '-';
  $('subscriptionValue').textContent = state.subscription?.status || '-';
  $('periodValue').textContent = formatDate(state.subscription?.current_period_end);
  $('supabaseUrlValue').textContent = state.config?.supabaseUrl ? 'Configurado' : 'Não configurado';
  $('subscriptionTableValue').textContent = state.config?.subscriptionTable ? 'Configurada' : 'Não configurada';
  $('billingUrlValue').textContent = state.config?.billingUrl ? 'Configurada' : 'Não configurada';

  setBadge($('subscriptionBadge'), active ? 'Assinatura ativa' : state.user ? 'Assinatura inativa' : 'Não conectado', active ? 'ok' : state.user ? 'bad' : 'neutral');

  const running = Boolean(state.automation?.running);
  setBadge($('runnerBadge'), running ? 'Rodando' : 'Parado', running ? 'ok' : 'neutral');
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
      showToast(error.message);
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
      showToast(error.message);
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
      await refreshSubscription();
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
