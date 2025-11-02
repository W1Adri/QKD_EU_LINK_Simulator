const SESSION_KEY = 'qkd_auth_session';
const API_BASE = '/api';

const elements = {
  authForm: document.getElementById('authForm'),
  authUsername: document.getElementById('authUsername'),
  authPassword: document.getElementById('authPassword'),
  authFeedback: document.getElementById('authFeedback'),
  authSummary: document.getElementById('authSummary'),
  authGreeting: document.getElementById('authGreeting'),
  logoutButton: document.getElementById('logoutButton'),
  chatForm: document.getElementById('chatForm'),
  chatMessage: document.getElementById('chatMessage'),
  chatLog: document.getElementById('chatLog'),
  chatHint: document.getElementById('chatHint'),
  chatStatus: document.getElementById('chatStatus'),
  btnRefreshChats: document.getElementById('btnRefreshChats'),
  btnUserCount: document.getElementById('btnUserCount'),
  userCountLabel: document.getElementById('userCountLabel'),
};

let session = loadSessionFromStorage();

function loadSessionFromStorage() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'number' && typeof parsed.username === 'string') {
      return parsed;
    }
  } catch (error) {
    console.warn('No se pudo leer la sesión almacenada:', error);
  }
  localStorage.removeItem(SESSION_KEY);
  return null;
}

function persistSession() {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function setAuthFeedback(message, status = 'info') {
  if (!elements.authFeedback) return;
  elements.authFeedback.textContent = message || '';
  if (message) {
    if (status === 'error' || status === 'success') {
      elements.authFeedback.dataset.status = status;
    } else {
      delete elements.authFeedback.dataset.status;
    }
  } else {
    delete elements.authFeedback.dataset.status;
  }
}

function setChatStatus(message, status = 'info') {
  if (!elements.chatStatus) return;
  elements.chatStatus.textContent = message || '';
  if (message) {
    if (status === 'error' || status === 'success') {
      elements.chatStatus.dataset.status = status;
    } else {
      delete elements.chatStatus.dataset.status;
    }
  } else {
    delete elements.chatStatus.dataset.status;
  }
}

function updateAuthUI(feedbackMessage) {
  const loggedIn = Boolean(session);

  if (elements.authForm) {
    elements.authForm.hidden = loggedIn;
  }
  if (elements.authSummary) {
    elements.authSummary.hidden = !loggedIn;
    if (loggedIn && elements.authGreeting) {
      elements.authGreeting.textContent = `Sesión iniciada como ${session.username}`;
    } else if (elements.authGreeting) {
      elements.authGreeting.textContent = '';
    }
  }
  if (elements.logoutButton) {
    elements.logoutButton.disabled = !loggedIn;
  }
  if (elements.chatForm) {
    elements.chatForm.classList.toggle('is-disabled', !loggedIn);
    const submitButton = elements.chatForm.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = !loggedIn;
    }
  }
  if (elements.chatMessage) {
    elements.chatMessage.disabled = !loggedIn;
    if (!loggedIn) {
      elements.chatMessage.value = '';
    }
  }
  if (elements.chatHint) {
    elements.chatHint.hidden = loggedIn;
  }
  if (loggedIn) {
    setAuthFeedback(feedbackMessage || 'Sesión activa.', 'success');
  } else {
    setAuthFeedback(feedbackMessage || 'Inicia sesión o regístrate para participar.', 'info');
  }
}

function sanitizeText(value) {
  return (value || '').toString().trim();
}

async function fetchJSON(url, { method = 'GET', body, headers } = {}) {
  const options = { method, headers: headers ? { ...headers } : {} };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      console.warn('Respuesta no JSON:', error);
    }
  }
  if (!response.ok) {
    const detail = (payload && (payload.detail || payload.message)) || response.statusText;
    throw new Error(detail);
  }
  return payload;
}

function renderChatMessages(messages) {
  if (!elements.chatLog) return;
  elements.chatLog.textContent = '';
  if (!messages || messages.length === 0) {
    return;
  }
  const fragment = document.createDocumentFragment();
  messages.forEach((item) => {
    const container = document.createElement('article');
    container.className = 'chat-message';

    const meta = document.createElement('span');
    meta.className = 'chat-message__meta';
    meta.textContent = `${item.username} · ${formatTimestamp(item.created_at)}`;

    const text = document.createElement('p');
    text.className = 'chat-message__text';
    text.textContent = item.message;

    container.append(meta, text);
    fragment.appendChild(container);
  });
  elements.chatLog.appendChild(fragment);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('es-ES', {
    hour12: false,
  });
}

async function loadChats(showStatus = false) {
  try {
    const data = await fetchJSON(`${API_BASE}/chats?limit=100`);
    renderChatMessages(data || []);
    if (showStatus) {
      setChatStatus('Chat actualizado.', 'success');
    } else {
      setChatStatus('');
    }
  } catch (error) {
    console.error(error);
    setChatStatus(`No se pudieron cargar los mensajes: ${error.message}`, 'error');
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!elements.authUsername || !elements.authPassword) return;
  const intent = event.submitter?.value || 'login';
  const username = sanitizeText(elements.authUsername.value);
  const password = sanitizeText(elements.authPassword.value);

  if (!username || !password) {
    setAuthFeedback('Introduce usuario y contraseña.', 'error');
    return;
  }

  try {
    const endpoint = intent === 'register' ? `${API_BASE}/users` : `${API_BASE}/login`;
    const payload = await fetchJSON(endpoint, {
      method: 'POST',
      body: { username, password },
    });
    session = { id: payload.id, username: payload.username, created_at: payload.created_at };
    persistSession();
    elements.authPassword.value = '';
    updateAuthUI(payload.message || (intent === 'register' ? 'Registro correcto.' : 'Inicio de sesión correcto.'));
    await loadChats();
  } catch (error) {
    console.error(error);
    setAuthFeedback(error.message, 'error');
  }
}

async function handleLogout() {
  try {
    await fetchJSON(`${API_BASE}/logout`, { method: 'POST' });
  } catch (error) {
    console.warn('Fallo al cerrar sesión en el servidor:', error);
  }
  session = null;
  persistSession();
  updateAuthUI('Sesión cerrada.');
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (!session || !elements.chatMessage) {
    setChatStatus('Debes iniciar sesión para enviar mensajes.', 'error');
    return;
  }
  const message = sanitizeText(elements.chatMessage.value);
  if (!message) {
    setChatStatus('Escribe un mensaje antes de enviar.', 'error');
    return;
  }
  try {
    await fetchJSON(`${API_BASE}/chats`, {
      method: 'POST',
      body: { user_id: session.id, message },
    });
    elements.chatMessage.value = '';
    await loadChats();
    setChatStatus('Mensaje enviado.', 'success');
  } catch (error) {
    console.error(error);
    setChatStatus(`No se pudo enviar el mensaje: ${error.message}`, 'error');
  }
}

async function handleUserCount() {
  try {
    const data = await fetchJSON(`${API_BASE}/users/count`);
    if (elements.userCountLabel) {
      elements.userCountLabel.textContent = `${data.count} usuario${data.count === 1 ? '' : 's'} registrados`;
    }
  } catch (error) {
    console.error(error);
    if (elements.userCountLabel) {
      elements.userCountLabel.textContent = 'No disponible';
    }
    setChatStatus(`No se pudo obtener el recuento: ${error.message}`, 'error');
  }
}

function setupEventListeners() {
  elements.authForm?.addEventListener('submit', handleAuthSubmit);
  elements.logoutButton?.addEventListener('click', handleLogout);
  elements.chatForm?.addEventListener('submit', handleChatSubmit);
  elements.btnRefreshChats?.addEventListener('click', () => loadChats(true));
  elements.btnUserCount?.addEventListener('click', handleUserCount);
}

async function bootstrap() {
  updateAuthUI();
  setupEventListeners();
  if (session) {
    try {
      const data = await fetchJSON(`${API_BASE}/users/${session.id}`);
      session = { id: data.id, username: data.username, created_at: data.created_at };
      persistSession();
    } catch (error) {
      console.warn('La sesión almacenada ya no es válida:', error);
      session = null;
      persistSession();
    }
    updateAuthUI();
  }
  await loadChats();
}

bootstrap();
