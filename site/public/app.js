const config = window.BIPE_SITE_CONFIG || {};
let session = null;

const $ = (id) => document.getElementById(id);

function setMessage(message) {
  $('sessionMessage').textContent = message;
}

function friendlyError(error) {
  const message = String(error?.message || error || '');
  if (message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (message.includes('User already registered')) return 'Este e-mail já tem uma conta. Use Entrar.';
  return message;
}

async function supabaseFetch(path, options = {}) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Site sem configuração do Supabase.');
  }

  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${session?.access_token || config.supabaseAnonKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.msg || result?.error_description || result?.error || `Erro HTTP ${response.status}`);
  return result;
}

async function signIn(email, password) {
  session = await supabaseFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  window.localStorage.setItem('bipeunico.site.session', JSON.stringify(session));
  setMessage(`Conectado como ${session.user.email}. Agora escolha um plano.`);
}

async function signUp(email, password) {
  const result = await supabaseFetch('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (result.access_token) {
    session = result;
    window.localStorage.setItem('bipeunico.site.session', JSON.stringify(session));
  }
  setMessage('Conta criada. Se o Supabase pedir confirmação, confirme o e-mail antes de assinar.');
}

async function openCheckout(planType) {
  if (!session?.access_token) {
    location.hash = '#entrar';
    setMessage('Entre ou crie sua conta antes de assinar.');
    return;
  }

  if (!config.billingUrl) throw new Error('Checkout não configurado.');

  const organizationName = planType === 'business'
    ? window.prompt('Nome da empresa ou equipe')
    : '';

  if (planType === 'business' && !organizationName?.trim()) {
    throw new Error('Informe o nome da empresa para continuar.');
  }

  const response = await fetch(config.billingUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      planType,
      organizationName: organizationName?.trim() || undefined
    })
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.url) {
    throw new Error(result?.error || 'Não foi possível abrir o checkout.');
  }

  window.location.href = result.url;
}

function restoreSession() {
  try {
    const raw = window.localStorage.getItem('bipeunico.site.session');
    if (!raw) return;
    const restored = JSON.parse(raw);
    if (!restored?.access_token) return;
    session = restored;
    setMessage(`Conectado como ${session.user.email}.`);
  } catch {
    window.localStorage.removeItem('bipeunico.site.session');
  }
}

function bind() {
  const downloadUrl = config.downloadUrl || '/downloads/Bipe-Unico.exe';
  $('downloadTopButton').href = downloadUrl;
  $('downloadHeroButton').href = downloadUrl;

  $('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await signIn($('email').value, $('password').value);
      $('password').value = '';
    } catch (error) {
      setMessage(friendlyError(error));
    }
  });

  $('signupButton').addEventListener('click', async () => {
    try {
      await signUp($('email').value, $('password').value);
      $('password').value = '';
    } catch (error) {
      setMessage(friendlyError(error));
    }
  });

  document.querySelectorAll('.checkout-button').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await openCheckout(button.dataset.plan);
      } catch (error) {
        setMessage(friendlyError(error));
        location.hash = '#entrar';
      }
    });
  });
}

restoreSession();
bind();
