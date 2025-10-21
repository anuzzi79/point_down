// options.js — versão standalone (sem import)

async function testAuthStandalone({ baseUrl, email, token }) {
    const auth = btoa(`${email}:${token}`);
    const r = await fetch(`${baseUrl}/rest/api/3/myself`, {
        headers: { "Authorization": `Basic ${auth}`, "Accept": "application/json" }
    });
    return r.ok;
}

// === Default dinâmico para filtros de status ===
const DEFAULT_STATUS_FILTERS = {
    "To Do": false,
    "In Progress": true,
    "Blocked": true,
    "Need Reqs": true,
    "Done": false,
    // ✅ Novos estados
    "Code Review": true,
    "Testing": true,
    "QA": true,
};

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
// Role flags
const isDevEl = document.getElementById('isDev');
const isQaEl = document.getElementById('isQa');

// Checkboxes de Status
const stTodoEl = document.getElementById('st_todo');
const stInProgressEl = document.getElementById('st_inprogress');
const stBlockedEl = document.getElementById('st_blocked');
const stNeedReqsEl = document.getElementById('st_needreqs');
const stDoneEl = document.getElementById('st_done');
// ✅ Novos
const stCodeReviewEl = document.getElementById('st_codereview');
const stTestingEl = document.getElementById('st_testing');
const stQaEl = document.getElementById('st_qa');

// Presets de status conforme os screenshots
const PRESET_DEV_STATUS = {
    "To Do": false,
    "In Progress": true,
    "Blocked": true,
    "Need Reqs": true,
    "Done": false,
    "Code Review": true,
    "Testing": true,
    "QA": true,
};
const PRESET_QA_STATUS = {
    "To Do": false,
    "In Progress": true,
    "Blocked": true,
    "Need Reqs": true,
    "Done": false,
    "Code Review": false,
    "Testing": false,
    "QA": false,
};

function applyStatusPreset(preset) {
    stTodoEl.checked = !!preset["To Do"]; 
    stInProgressEl.checked = !!preset["In Progress"]; 
    stBlockedEl.checked = !!preset["Blocked"]; 
    stNeedReqsEl.checked = !!preset["Need Reqs"]; 
    stDoneEl.checked = !!preset["Done"]; 
    stCodeReviewEl.checked = !!preset["Code Review"]; 
    stTestingEl.checked = !!preset["Testing"]; 
    stQaEl.checked = !!preset["QA"]; 
}

// Ao marcar uma role, aplicamos o preset correspondente (última ação vence)
isDevEl?.addEventListener('change', () => { if (isDevEl.checked) applyStatusPreset(PRESET_DEV_STATUS); });
isQaEl?.addEventListener('change', () => { if (isQaEl.checked) applyStatusPreset(PRESET_QA_STATUS); });

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
    const isDev = !!isDevEl?.checked;
    const isQa = !!isQaEl?.checked;

    // monta objeto de filtros de status a partir das checkboxes
    const statusFilters = {
        "To Do": !!stTodoEl?.checked,
        "In Progress": !!stInProgressEl?.checked,
        "Blocked": !!stBlockedEl?.checked,
        "Need Reqs": !!stNeedReqsEl?.checked,
        "Done": !!stDoneEl?.checked,
        // ✅ Novos
        "Code Review": !!stCodeReviewEl?.checked,
        "Testing": !!stTestingEl?.checked,
        "QA": !!stQaEl?.checked,
    };

    // valida e normaliza alarmTime
    let alarmTime = (alarmEl.value || '').trim(); // "HH:MM"
    if (!/^\d{2}:\d{2}$/.test(alarmTime)) {
        alarmTime = undefined; // cai no default background (17:50)
    }

    await chrome.storage.sync.set({
        baseUrl, email, token, jql, alarmTime,
        forceTestCard, enableQueueLock, enableWeekend,
        statusFilters,
        isDev, isQa
    });

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

(function applyStatusToUI(statusFilters) {
    // aplica valores nas checkboxes (helper)
    const src = statusFilters || DEFAULT_STATUS_FILTERS;
    stTodoEl.checked = !!src["To Do"];
    stInProgressEl.checked = !!src["In Progress"];
    stBlockedEl.checked = !!src["Blocked"];
    stNeedReqsEl.checked = !!src["Need Reqs"];
    stDoneEl.checked = !!src["Done"];
    // ✅ Novos
    stCodeReviewEl.checked = !!src["Code Review"];
    stTestingEl.checked = !!src["Testing"];
    stQaEl.checked = !!src["QA"];
})();

(async function init() {
    const {
        baseUrl, email, token, jql, alarmTime,
        forceTestCard, enableQueueLock, enableWeekend,
        statusFilters, isDev, isQa
    } = await chrome.storage.sync.get([
        "baseUrl", "email", "token", "jql", "alarmTime",
        "forceTestCard", "enableQueueLock", "enableWeekend",
        "statusFilters", "isDev", "isQa"
    ]);

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

    // === Defaults para as opções do screenshot ===
    // Card de teste: DESMARCADO por padrão
    forceTestCardEl.checked = (typeof forceTestCard === 'boolean') ? forceTestCard : false;
    // Lock cooperativo: MARCADO por padrão
    enableQueueLockEl.checked = (typeof enableQueueLock === 'boolean') ? enableQueueLock : true;
    // Notificações no fim de semana: DESMARCADO por padrão
    enableWeekendEl.checked = (typeof enableWeekend === 'boolean') ? enableWeekend : false;

    // Status filters (aplica defaults se não existir no storage)
    (function applyStatusToUI(statusFilters) {
        const src = statusFilters && typeof statusFilters === 'object'
            ? statusFilters
            : DEFAULT_STATUS_FILTERS;
        stTodoEl.checked = !!src["To Do"];
        stInProgressEl.checked = !!src["In Progress"];
        stBlockedEl.checked = !!src["Blocked"];
        stNeedReqsEl.checked = !!src["Need Reqs"];
        stDoneEl.checked = !!src["Done"];
        // ✅ Novos
        stCodeReviewEl.checked = !!src["Code Review"];
        stTestingEl.checked = !!src["Testing"];
        stQaEl.checked = !!src["QA"];
    })(statusFilters);

    // Role flags defaults: desmarcados se ausentes
    isDevEl.checked = (typeof isDev === 'boolean') ? isDev : false;
    isQaEl.checked = (typeof isQa === 'boolean') ? isQa : false;

    // Avançadas permanece oculta até clique
    advancedSection.style.display = 'none';
    advancedBtn.setAttribute('aria-expanded', 'false');
})();
