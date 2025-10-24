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

// Palavras padrão para perfil DEV (Squad Mode)
const DEFAULT_DEV_WORDS = ["Support DEV", "Buffer"];

function areDefaultDevWords(list) {
    if (!Array.isArray(list)) return false;
    const norm = (arr) => arr.map(s => String(s).trim().toLowerCase()).sort();
    const a = norm(list);
    const b = norm(DEFAULT_DEV_WORDS);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
    return true;
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
// Squad Mode (DEV-only)
const squadModeSection = document.getElementById('squadModeSection');
const squadModeBox = document.getElementById('squadModeBox');
const squadEpicBox = document.getElementById('squadEpicBox');
// Elementos que podem ser reposicionados
const searchWordsBox = document.getElementById('searchWordsBox');
const searchCodesBox = document.getElementById('searchCodesBox');
const statusFiltersBox = document.getElementById('statusFiltersBox');

function placeSearchWordsBoxInDev(isDev) {
    if (!searchWordsBox) return;
    if (isDev) {
        // Move para dentro de Squad Mode
        if (squadModeBox && searchWordsBox.parentElement !== squadModeBox) {
            // Inserir ANTES do bloco de épicos para manter a ordem desejada
            squadModeBox.insertBefore(searchWordsBox, squadEpicBox || squadModeBox.firstChild);
        }
    } else {
        // Retorna para Avançadas antes da seção de códigos, se existir
        const parent = searchCodesBox?.parentElement || advancedSection;
        if (parent && searchWordsBox.parentElement !== parent) {
            parent.insertBefore(searchWordsBox, searchCodesBox || parent.firstChild);
        }
    }
}

function findScheduleHeader() {
    let node = alarmEl;
    while (node && node.previousElementSibling) {
        node = node.previousElementSibling;
        if (node.tagName === 'H2') return node;
    }
    return alarmEl; // fallback
}

function placeStatusFiltersInMain({ dev = false, qa = false } = {}) {
    if (!statusFiltersBox) return;
    if (dev) {
        const beforeNode = document.getElementById('squadModeSection');
        const parent = document.body;
        if (beforeNode && statusFiltersBox.parentElement !== parent) {
            parent.insertBefore(statusFiltersBox, beforeNode);
        }
        statusFiltersBox.style.marginTop = '16px';
        return;
    }
    if (qa) {
        const beforeNode = findScheduleHeader();
        const parent = document.body;
        if (beforeNode && statusFiltersBox.parentElement !== parent) {
            parent.insertBefore(statusFiltersBox, beforeNode);
        }
        statusFiltersBox.style.marginTop = '16px';
        return;
    }
    const insertBefore = document.getElementById('searchWordsBox') || searchCodesBox;
    if (advancedSection && statusFiltersBox.parentElement !== advancedSection) {
        if (insertBefore && insertBefore.parentElement === advancedSection) {
            advancedSection.insertBefore(statusFiltersBox, insertBefore);
        } else {
            advancedSection.appendChild(statusFiltersBox);
        }
    }
    statusFiltersBox.style.marginTop = '0';
}
// Role flags
const isDevEl = document.getElementById('isDev');
const isQaEl = document.getElementById('isQa');
// Procure por palavra
const searchWordInputEl = document.getElementById('searchWordInput');
const addSearchWordBtn = document.getElementById('addSearchWordBtn');
const searchWordsListEl = document.getElementById('searchWordsList');
let searchWords = [];

// ✅ Procure por código
const searchCodeInputEl = document.getElementById('searchCodeInput');
const addSearchCodeBtn = document.getElementById('addSearchCodeBtn');
const searchCodesListEl = document.getElementById('searchCodesList');
let searchCodes = []; // array de strings numéricas (ex.: "9683")

// ✅ Squad Mode: épicos (FGC-1234) — armazenamento separado
const squadEpicInputEl = document.getElementById('squadEpicInput');
const addSquadEpicBtn = document.getElementById('addSquadEpicBtn');
const squadEpicListEl = document.getElementById('squadEpicList');
let squadEpicCodes = []; // array de strings numéricas

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
    "To Do": true,
    "In Progress": true,
    "Blocked": true,
    "Need Reqs": true,
    "Done": true,
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
isDevEl?.addEventListener('change', () => { 
    if (isDevEl.checked) {
        applyStatusPreset(PRESET_DEV_STATUS);
    }
    // mostrar/ocultar Squad Mode
    if (squadModeSection) {
        squadModeSection.style.display = isDevEl.checked ? 'block' : 'none';
        squadModeSection.setAttribute('aria-hidden', String(!isDevEl.checked));
    }
    // reposicionar UI de palavras
    placeSearchWordsBoxInDev(!!isDevEl.checked);
    // reposicionar filtros de status
    placeStatusFiltersInMain({ dev: !!isDevEl.checked, qa: false });
    // se entrou em DEV e ainda não há palavras, aplicar defaults DEV
    if (isDevEl.checked && Array.isArray(searchWords) && searchWords.length === 0) {
        searchWords.push(...DEFAULT_DEV_WORDS);
        renderSearchWords();
        chrome.storage.sync.set({ searchWords }).catch(() => {});
    }
});
isQaEl?.addEventListener('change', () => { 
    if (isQaEl.checked) {
        applyStatusPreset(PRESET_QA_STATUS);
        // Regras adicionais para perfil QA: desmarcar card de teste e fim de semana
        if (forceTestCardEl) forceTestCardEl.checked = false;
        if (enableWeekendEl) enableWeekendEl.checked = false;
        // Para QA, palavras devem ficar vazias por padrão se apenas defaults DEV estiverem presentes
        if (areDefaultDevWords(searchWords)) {
            searchWords = [];
            renderSearchWords();
            chrome.storage.sync.set({ searchWords }).catch(() => {});
        }
    }
});

// tornar Dev/QA mutuamente exclusivos
isDevEl?.addEventListener('change', () => { if (isDevEl.checked) { isQaEl.checked = false; applyStatusPreset(PRESET_DEV_STATUS); } });
isQaEl?.addEventListener('change', () => { 
    if (isQaEl.checked) { 
        isDevEl.checked = false; 
        applyStatusPreset(PRESET_QA_STATUS); 
        // Garantir políticas QA também aqui
        if (forceTestCardEl) forceTestCardEl.checked = false;
        if (enableWeekendEl) enableWeekendEl.checked = false;
    } 
    // esconder Squad Mode e retornar UI
    if (squadModeSection) {
        squadModeSection.style.display = 'none';
        squadModeSection.setAttribute('aria-hidden', 'true');
    }
    placeSearchWordsBoxInDev(false);
    placeStatusFiltersInMain({ dev: false, qa: !!isQaEl.checked });
});

function renderSearchWords() {
    searchWordsListEl.innerHTML = '';
    (searchWords || []).forEach((w, idx) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const txt = document.createElement('span');
        txt.textContent = w;
        const rm = document.createElement('span');
        rm.className = 'remove';
        rm.textContent = '×';
        rm.title = 'Remover';
        rm.addEventListener('click', async () => {
            searchWords.splice(idx, 1);
            renderSearchWords();
            await chrome.storage.sync.set({ searchWords });
        });
        chip.appendChild(txt);
        chip.appendChild(rm);
        searchWordsListEl.appendChild(chip);
    });
}

addSearchWordBtn?.addEventListener('click', async () => {
    const raw = (searchWordInputEl.value || '').trim();
    if (!raw) return;
    const word = raw.replace(/\s+/g, ' ');
    if (!searchWords.includes(word)) {
        searchWords.push(word);
        renderSearchWords();
        await chrome.storage.sync.set({ searchWords });
    }
    searchWordInputEl.value = '';
    searchWordInputEl.focus();
});

// ✅ Codes chips
function renderSearchCodes() {
    searchCodesListEl.innerHTML = '';
    (searchCodes || []).forEach((num, idx) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const txt = document.createElement('span');
        txt.textContent = `FGC-${num}`;
        const rm = document.createElement('span');
        rm.className = 'remove';
        rm.textContent = '×';
        rm.title = 'Remover';
        rm.addEventListener('click', async () => {
            searchCodes.splice(idx, 1);
            renderSearchCodes();
            await chrome.storage.sync.set({ searchCodes });
        });
        chip.appendChild(txt);
        chip.appendChild(rm);
        searchCodesListEl.appendChild(chip);
    });
}

// ✅ Render épicos no estilo chips "FGC-<num>"
function renderSquadEpics() {
    if (!squadEpicListEl) return;
    squadEpicListEl.innerHTML = '';
    (squadEpicCodes || []).forEach((num, idx) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const txt = document.createElement('span');
        txt.textContent = `FGC-${num}`;
        const rm = document.createElement('span');
        rm.className = 'remove';
        rm.textContent = '×';
        rm.title = 'Remover';
        rm.addEventListener('click', async () => {
            squadEpicCodes.splice(idx, 1);
            renderSquadEpics();
            await chrome.storage.sync.set({ squadEpicCodes });
        });
        chip.appendChild(txt);
        chip.appendChild(rm);
        squadEpicListEl.appendChild(chip);
    });
}

addSearchCodeBtn?.addEventListener('click', async () => {
    // permite que o usuário digite qualquer coisa; extraímos apenas dígitos
    const raw = (searchCodeInputEl.value || '').trim();
    const onlyDigits = raw.replace(/\D+/g, '');
    if (!onlyDigits) return;
    // evita duplicados
    if (!searchCodes.includes(onlyDigits)) {
        searchCodes.push(onlyDigits);
        renderSearchCodes();
        await chrome.storage.sync.set({ searchCodes });
    }
    searchCodeInputEl.value = '';
    searchCodeInputEl.focus();
});

// ✅ Add épico
addSquadEpicBtn?.addEventListener('click', async () => {
    const raw = (squadEpicInputEl?.value || '').trim();
    const onlyDigits = raw.replace(/\D+/g, '');
    if (!onlyDigits) return;
    if (!squadEpicCodes.includes(onlyDigits)) {
        squadEpicCodes.push(onlyDigits);
        renderSquadEpics();
        await chrome.storage.sync.set({ squadEpicCodes });
    }
    if (squadEpicInputEl) {
        squadEpicInputEl.value = '';
        squadEpicInputEl.focus();
    }
});

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
        isDev, isQa,
        searchWords,
        searchCodes,
        squadEpicCodes
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
        statusFilters, isDev, isQa, searchWords: storedSearchWords,
        searchCodes: storedSearchCodes,
        squadEpicCodes: storedSquadEpicCodes
    } = await chrome.storage.sync.get([
        "baseUrl", "email", "token", "jql", "alarmTime",
        "forceTestCard", "enableQueueLock", "enableWeekend",
        "statusFilters", "isDev", "isQa", "searchWords", "searchCodes", "squadEpicCodes"
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
    // refletir exclusividade visual
    if (isDevEl.checked && isQaEl.checked) { isQaEl.checked = false; }

    // Se já estiver no perfil QA ao carregar, aplicar políticas QA
    if (isQaEl.checked) {
        if (forceTestCardEl) forceTestCardEl.checked = false;
        if (enableWeekendEl) enableWeekendEl.checked = false;
    }

    // Exibir Squad Mode apenas para DEV
    if (squadModeSection) {
        squadModeSection.style.display = isDevEl.checked ? 'block' : 'none';
        squadModeSection.setAttribute('aria-hidden', String(!isDevEl.checked));
    }

    // Posicionar corretamente a caixa de palavras conforme perfil atual
    placeSearchWordsBoxInDev(!!isDevEl.checked);
    // Posicionar corretamente filtros de status conforme perfil atual
    placeStatusFiltersInMain({ dev: !!isDevEl.checked, qa: !!isQaEl.checked });

    // carrega palavras
    searchWords = Array.isArray(storedSearchWords) ? storedSearchWords.filter(Boolean) : [];
    // Se estiver em DEV e ainda não houver palavras, definir defaults DEV
    if (isDevEl.checked && searchWords.length === 0) {
        searchWords = [...DEFAULT_DEV_WORDS];
        await chrome.storage.sync.set({ searchWords }).catch(() => {});
    }
    // Se estiver em QA e as palavras forem apenas os defaults de DEV, limpar para padrão vazio
    if (isQaEl.checked && areDefaultDevWords(searchWords)) {
        searchWords = [];
        await chrome.storage.sync.set({ searchWords }).catch(() => {});
    }
    renderSearchWords();

    // ✅ carrega códigos (somente dígitos)
    searchCodes = Array.isArray(storedSearchCodes)
        ? storedSearchCodes.map(s => String(s).replace(/\D+/g, '')).filter(Boolean)
        : [];
    renderSearchCodes();

    // ✅ carrega épicos (somente dígitos)
    squadEpicCodes = Array.isArray(storedSquadEpicCodes)
        ? storedSquadEpicCodes.map(s => String(s).replace(/\D+/g, '')).filter(Boolean)
        : [];
    renderSquadEpics();

    // Avançadas permanece oculta até clique
    advancedSection.style.display = 'none';
    advancedBtn.setAttribute('aria-expanded', 'false');
})();
