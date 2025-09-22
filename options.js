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

document.getElementById('saveBtn').addEventListener('click', async () => {
    const baseUrl = (baseUrlEl.value || '').trim();
    const email = (emailEl.value || '').trim();
    const token = (tokenEl.value || '').trim();
    const jql = (jqlEl.value || '').trim();

    // valida e normaliza alarmTime
    let alarmTime = (alarmEl.value || '').trim(); // "HH:MM"
    if (!/^\d{2}:\d{2}$/.test(alarmTime)) {
        // se vazio/inválido, deixa undefined para cair no default (17:50)
        alarmTime = undefined;
    }

    await chrome.storage.sync.set({ baseUrl, email, token, jql, alarmTime });
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
    const { baseUrl, email, token, jql, alarmTime } =
        await chrome.storage.sync.get(["baseUrl", "email", "token", "jql", "alarmTime"]);

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
})();
