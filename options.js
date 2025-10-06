// options.js — versão standalone (sem import)

async function testAuthStandalone({ baseUrl, email, token }) {
    const auth = btoa(`${email}:${token}`);
    const r = await fetch(`${baseUrl}/rest/api/3/myself`, {
        headers: { "Authorization": `Basic ${auth}`, "Accept": "application/json" }
    });
    return r.ok;
}

const baseUrlEl = document.getElementById('baseUrl');
const emailEl = document.getElementById('email');
const tokenEl = document.getElementById('token');
const jqlEl = document.getElementById('jql');
const alarmEl = document.getElementById('alarmTime');
const statusEl = document.getElementById('status');
const forceTestCardEl = document.getElementById('forceTestCard');
const enableQueueLockEl = document.getElementById('enableQueueLock');
const enableWeekendEl = document.getElementById('enableWeekend');
const advancedBtn = document.getElementById('advancedBtn');
const advancedSection = document.getElementById('advancedSection');

// Toggle sezione Avançadas (di default nascosta)
advancedBtn.addEventListener('click', () => {
    const visible = advancedSection.style.display === 'block';
    advancedSection.style.display = visible ? 'none' : 'block';
    advancedBtn.setAttribute('aria-expanded', String(!visible));
});

document.getElementById('saveBtn').addEventListener('click', async () => {
    const baseUrl = (baseUrlEl.value || '').trim();
    const email = (emailEl.value || '').trim();
    const token = (tokenEl.value || '').trim();
    const jql = (jqlEl.value || '').trim();
    const forceTestCard = !!forceTestCardEl?.checked;
    const enableQueueLock = !!enableQueueLockEl?.checked;
    const enableWeekend = !!enableWeekendEl?.checked;

    // valida e normaliza alarmTime
    let alarmTime = (alarmEl.value || '').trim(); // "HH:MM"
    if (!/^\d{2}:\d{2}$/.test(alarmTime)) {
        // se vazio/inválido, deixa undefined para cair no default (17:50)
        alarmTime = undefined;
    }

    await chrome.storage.sync.set({ baseUrl, email, token, jql, alarmTime, forceTestCard, enableQueueLock, enableWeekend });
    statusEl.textContent = '✔️ Configurações salvas.';
    setTimeout(() => statusEl.textContent = '', 2500);
});

document.getElementById('testBtn').addEventListener('click', async () => {
    statusEl.textContent = 'Testando...';
    try {
        const baseUrl = baseUrlEl.value.trim();
        const email = emailEl.value.trim();
        const token = tokenEl.value.trim();
        if (!baseUrl || !email || !token) {
            statusEl.textContent = '❌ Preencha Base URL, Email e Token.';
            return;
        }
        const ok = await testAuthStandalone({ baseUrl, email, token });
        statusEl.textContent = ok ? '✅ Conexão OK' : '❌ Falha de autenticação';
    } catch (e) {
        statusEl.textContent = '❌ Erro: ' + (e?.message || e);
    }
});

(async function init() {
    const { baseUrl, email, token, jql, alarmTime, forceTestCard, enableQueueLock, enableWeekend } =
        await chrome.storage.sync.get(["baseUrl", "email", "token", "jql", "alarmTime", "forceTestCard", "enableQueueLock", "enableWeekend"]);

    if (baseUrl) baseUrlEl.value = baseUrl;
    if (email) emailEl.value = email;
    if (token) tokenEl.value = token;
    if (jql) jqlEl.value = jql;

    // mostra valor salvo ou default "17:50"
    if (typeof alarmTime === "string" && /^\d{2}:\d{2}$/.test(alarmTime)) {
        alarmEl.value = alarmTime;
    } else {
        alarmEl.value = "17:50";
    }

    // Opções avançadas: default = habilitadas
    if (typeof forceTestCard === 'boolean') {
        forceTestCardEl.checked = forceTestCard;
    } else {
        forceTestCardEl.checked = true;
    }

    if (typeof enableQueueLock === 'boolean') {
        enableQueueLockEl.checked = enableQueueLock;
    } else {
        enableQueueLockEl.checked = true;
    }

    if (typeof enableWeekend === 'boolean') {
        enableWeekendEl.checked = enableWeekend;
    } else {
        enableWeekendEl.checked = true; // habilitada por padrão
    }

    // Avançadas rimane nascosta finché l’utente non clicca
    advancedSection.style.display = 'none';
    advancedBtn.setAttribute('aria-expanded', 'false');
})();
