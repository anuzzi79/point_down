// ======= Config: usa SEMPRE l'ID scoperto (customfield_10022) =======
const SP_FIELD_ID_FIXED = "customfield_10022";         // ← risultato della “pesca”
const SP_FIELD_NAME_FIXED = "Story Points (fixed)";    // etichetta informativa

// URL fisso della board (Active sprints)
const BOARD_URL_FIXED = "https://facilitygrid.atlassian.net/jira/software/c/projects/FGC/boards/34";

// ======= Locking via Jira Issue Properties (bulk + filter) =======
const PD_LOCK_KEY = "point_down_lock";
const PD_LOCK_TTL_MS = 60_000;
const PD_LOCK_WAIT_TOTAL_MS = 30_000;
const PD_LOCK_POLL_MS = 900;
const PD_TASK_POLL_MS = 800;
const PD_TASK_POLL_MAX = 20;

// === Default dinâmico para filtros de status (usado se storage não tiver valor) ===
const DEFAULT_STATUS_FILTERS = {
    "To Do": false,
    "In Progress": true,
    "Blocked": true,
    "Need Reqs": true,
    "Done": false,
    // nuovi status opzionali (default: deselezionati)
    "Code Review": false,
    "Testing": false,
    "QA": false,
};

// ======= Helpers base =======
function setStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
    console.log('[point_down]', msg);
}
function setStatusSaving(active) {
    const el = document.getElementById('status');
    if (!el) return;
    el.classList.toggle('status-pulsing', !!active);
}

function setStatusTwoLinks(sprintLabel, sprintHref, boardLabel, boardHref) {
    const el = document.getElementById('status');
    if (!el) return;
    el.innerHTML = "";

    const aSprint = document.createElement('a');
    aSprint.textContent = sprintLabel;
    aSprint.href = sprintHref;
    aSprint.target = "_blank";
    aSprint.rel = "noopener noreferrer";

    const aBoard = document.createElement('a');
    aBoard.textContent = boardLabel;
    aBoard.href = boardHref;
    aBoard.target = "_blank";
    aBoard.rel = "noopener noreferrer";
    aBoard.style.marginLeft = "16px"; // ← più separazione tra “Go to Sprint!” e “Board”

    el.appendChild(aSprint);
    el.appendChild(aBoard);

    console.log('[point_down] status links ->', { sprintHref, boardHref });
}

function b64(s) { return btoa(s); }
function headers(email, token) {
    return {
        "Authorization": `Basic ${b64(`${email}:${token}`)}`,
        "Accept": "application/json",
        "Content-Type": "application/json"
    };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function fetchWithTimeout(url, opts = {}, ms = 20000) {
    // Retry/backoff centralizzato per gestire 503/5xx e risposte HTML (error page)
    const maxRetries = 3;
    let attempt = 0;
    let backoff = 300;

    while (true) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        try {
            const res = await fetch(url, {
                ...opts,
                headers: { "Accept": "application/json", ...(opts.headers || {}) },
                signal: ctrl.signal
            });

            const contentType = res.headers.get('content-type') || '';
            const isServerError = res.status >= 500 && res.status < 600;
            const looksLikeHtmlError = contentType.includes('text/html');

            if ((isServerError || looksLikeHtmlError) && attempt < maxRetries) {
                attempt++;
                console.warn(`[point_down] transient error (status=${res.status}, html=${looksLikeHtmlError}). Retry ${attempt}/${maxRetries}…`);
                clearTimeout(t);
                await sleep(backoff + Math.floor(Math.random() * 200));
                backoff *= 2;
                continue;
            }

            return res;
        } catch (e) {
            if (attempt < maxRetries) {
                attempt++;
                console.warn(`[point_down] network error: ${e?.message || e}. Retry ${attempt}/${maxRetries}…`);
                clearTimeout(t);
                await sleep(backoff + Math.floor(Math.random() * 200));
                backoff *= 2;
                continue;
            }
            throw e;
        } finally {
            clearTimeout(t);
        }
    }
}

// Estesa per includere também statusFilters dalle Opções
async function getAuth() {
    const {
        baseUrl, email, token, jql, forceTestCard, enableQueueLock, statusFilters, isDev, isQa
    } = await chrome.storage.sync.get([
        "baseUrl", "email", "token", "jql", "forceTestCard", "enableQueueLock", "statusFilters", "isDev", "isQa"
    ]);

    if (!baseUrl || !email || !token) {
        throw new Error("Credenciais Jira não configuradas. Abra 'opções' e preencha Base URL, Email e Token.");
    }
    // === Defaults para as opções do screenshot ===
    const _forceTestCard = (typeof forceTestCard === 'boolean') ? forceTestCard : false; // default: DESABILITADO
    const _enableQueueLock = (typeof enableQueueLock === 'boolean') ? enableQueueLock : true; // default: HABILITADO

    // aplica defaults se não houver nada salvo
    const _statusFilters = (statusFilters && typeof statusFilters === 'object')
        ? statusFilters
        : DEFAULT_STATUS_FILTERS;

    return {
        baseUrl, email, token, jql,
        forceTestCard: _forceTestCard,
        enableQueueLock: _enableQueueLock,
        statusFilters: _statusFilters,
        isDev: !!isDev,
        isQa: !!isQa
    };
}

// ======= JQL helper: monta cláusula de status a partir das opções =======
function buildStatusClauseFromOptions(statusFilters) {
    const enabled = Object.entries(statusFilters || {})
        .filter(([, v]) => !!v)
        .map(([k]) => k)
        .filter(Boolean);

    if (enabled.length === 0) {
        return "(status IS EMPTY)";
    }
    const quoted = enabled.map(s => `"${s.replace(/"/g, '\\"')}"`).join(", ");
    return `status IN (${quoted})`;
}

/** Combina JQL base + filtro status (sempre somado) */
function jqlWithDynamicStatuses(baseJql, statusFilters) {
    const statusClause = buildStatusClauseFromOptions(statusFilters);
    const trimmed = (baseJql || "").trim();
    if (!trimmed) return statusClause;
    return `(${trimmed}) AND ${statusClause}`;
}

// ======= Jira: field cache + resolve SP field =======
let FIELD_CACHE = null;

async function resolveStoryPointsFieldId() {
    if (FIELD_CACHE?.spFieldId) return FIELD_CACHE.spFieldId;

    if (SP_FIELD_ID_FIXED) {
        FIELD_CACHE = { spFieldId: SP_FIELD_ID_FIXED, spFieldName: SP_FIELD_NAME_FIXED };
        console.log('[point_down] Story Points field (fixed):', FIELD_CACHE.spFieldName, FIELD_CACHE.spFieldId);
        return FIELD_CACHE.spFieldId;
    }

    throw new Error("SP field fallback não suportado neste build.");
}

// ======= Jira: search helper via /search/jql (POST + nextPageToken) =======
async function fetchIssuesByJql(finalJql, spFieldId) {
    const { baseUrl, email, token } = await getAuth();
    // ➕ chiediamo anche 'status' per poter mostrare la **name** precisa
    const fields = ["summary", spFieldId, "status"];
    let nextPageToken = null;
    const maxResults = 100;
    const all = [];

    while (true) {
        const body = JSON.stringify({
            jql: finalJql,
            fields,
            maxResults,
            nextPageToken
        });

        const r = await fetchWithTimeout(`${baseUrl}/rest/api/3/search/jql`, {
            method: "POST",
            headers: headers(email, token),
            body
        }, 30000);

        if (!r.ok) {
            const txt = await r.text().catch(() => "");
            throw new Error("Falha no /search/jql: " + (txt || r.status));
        }

        const data = await r.json();
        if (Array.isArray(data.issues)) all.push(...data.issues);

        if (data.isLast || !data.nextPageToken) break;
        nextPageToken = data.nextPageToken;
    }

    // ⚠️ PRIMA prendeva la category ("To Do/In Progress/Done") → mostrava "To Do" anche quando lo status era "Blocked".
    //    Ora preferiamo SEMPRE il nome esatto dello status (st.name) e usiamo la category solo come fallback.
    return all.map(it => {
        const st = it.fields.status || {};
        const stName = st.name || "Unknown";
        const stCat = (st.statusCategory && st.statusCategory.name) || "Unknown";
        return {
            key: it.key,
            summary: it.fields.summary,
            sp: it.fields[spFieldId] ?? 0,
            _id: it.id,
            statusName: stName,
            statusCat: stCat
        };
    }).sort((a, b) => (b.sp || 0) - (a.sp || 0));
}

// JQL padrão (assignee = currentUser)
async function fetchCurrentSprintIssues() {
    const { jql, statusFilters } = await getAuth();

    const base = (jql && jql.trim())
        ? jql.trim()
        : 'sprint in openSprints() AND assignee = currentUser()';

    const finalJql = jqlWithDynamicStatuses(base, statusFilters);
    const spFieldId = await resolveStoryPointsFieldId();
    return fetchIssuesByJql(finalJql, spFieldId);
}

/* -----------------------------------------------------------------------
   SPECIAL: Exploratory / Regression cards (independent of assignee)
   - broader matching with prefix support (explor*, regres*, regression)
   - search in summary AND description
   - **APPLIES the same status filters from Options**
----------------------------------------------------------------------- */
const SPECIAL_TERMS = [
    "explor",        // covers exploratory, explorar, exploration
    "explorat",      // explicit prefix for 'exploratory'
    "regres",        // covers regress, regression
    "regress",
    "regression",
    "exploratory"
];

function buildSpecialClause() {
    // Build OR of (summary ~ "term" OR summary ~ "term*" OR description ~ "term" OR description ~ "term*")
    const parts = [];
    for (const t of SPECIAL_TERMS) {
        const term = t.replace(/"/g, '\\"');
        parts.push(
            `(summary ~ "${term}" OR summary ~ "${term}*" OR description ~ "${term}" OR description ~ "${term}*")`
        );
    }
    return parts.join(" OR ");
}

// JQL especial (explorat*/regres*) — sem assignee, **com filtros de status das opções**
async function fetchSpecialSprintIssues() {
    const { statusFilters } = await getAuth();
    const spFieldId = await resolveStoryPointsFieldId();

    const clause = buildSpecialClause();
    const baseJql = `sprint in openSprints() AND (${clause})`;

    // ⬇️ Applica le stesse regole di filtro di status della lista principale
    const specialJql = jqlWithDynamicStatuses(baseJql, statusFilters);

    return fetchIssuesByJql(specialJql, spFieldId);
}

/** Fetch por chave específica */
async function fetchIssueByKey(issueKey) {
    const { baseUrl, email, token } = await getAuth();
    const spFieldId = await resolveStoryPointsFieldId();
    const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent("summary," + spFieldId + ",status")}`;

    const r = await fetchWithTimeout(url, { headers: headers(email, token) }, 20000);
    if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`Falha ao buscar issue ${issueKey}: ` + (txt || r.status));
    }
    const data = await r.json();
    const st = data.fields?.status || {};
    const stName = st.name || "Unknown";
    const stCat = (st.statusCategory && st.statusCategory.name) || "Unknown";
    return {
        key: data.key,
        summary: data.fields?.summary || "(sem resumo)",
        sp: data.fields?.[spFieldId] ?? 0,
        _id: data.id,
        statusName: stName,
        statusCat: stCat
    };
}

// ======= Jira: update SP =======
async function updateStoryPoints(issueKey, newValue) {
    const { baseUrl, email, token } = await getAuth();
    const spFieldId = await resolveStoryPointsFieldId();
    const body = { fields: { [spFieldId]: newValue } };
    const r = await fetchWithTimeout(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
        method: "PUT",
        headers: headers(email, token),
        body: JSON.stringify(body)
    }, 15000);
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`Falha ao salvar SP em ${issueKey}: ` + (t || r.status));
    }
    return true;
}

// ======= Lock helpers =======
function nowIsoPlus(ms) { return new Date(Date.now() + ms).toISOString(); }
function randNonce() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
async function pollTask(locationUrl, { email, token }) {
    for (let i = 0; i < PD_TASK_POLL_MAX; i++) {
        await new Promise(r => setTimeout(r, PD_TASK_POLL_MS));
        const rr = await fetchWithTimeout(locationUrl, { headers: { "Authorization": `Basic ${b64(`${email}:${token}`)}`, "Accept": "application/json" } }, 20000);
        if (!rr.ok) continue;
        const task = await rr.json().catch(() => null);
        const st = (task && (task.status || task.state || task.currentStatus || task.elementType)) || "";
        if (/COMPLETE|SUCCESS/i.test(st)) return true;
        if (/FAILED|ERROR/i.test(st)) return false;
    }
    return false;
}
async function bulkSetPropertyFiltered(propKey, body) {
    const { baseUrl, email, token } = await getAuth();
    const url = `${baseUrl}/rest/api/3/issue/properties/${encodeURIComponent(propKey)}`;
    const r = await fetchWithTimeout(url, {
        method: "PUT",
        headers: headers(email, token),
        body: JSON.stringify(body)
    }, 20000);
    if (!(r.status === 303 || r.status === 202 || r.status === 200)) {
        const t = await r.text().catch(() => "");
        throw new Error(`Falha ao iniciar bulk property update: ${t || r.status}`);
    }
    const loc = r.headers.get("location");
    if (!loc) return true;
    return pollTask(loc, { email, token });
}
async function bulkDeletePropertyFiltered(propKey, body) {
    const { baseUrl, email, token } = await getAuth();
    const url = `${baseUrl}/rest/api/3/issue/properties/${encodeURIComponent(propKey)}`;
    const r = await fetchWithTimeout(url, {
        method: "DELETE",
        headers: headers(email, token),
        body: JSON.stringify(body)
    }, 20000);
    if (!(r.status === 303 || r.status === 202 || r.status === 200 || r.status === 204)) {
        const t = await r.text().catch(() => "");
        throw new Error(`Falha ao iniciar bulk property delete: ${t || r.status}`);
    }
    const loc = r.headers.get("location");
    if (!loc) return true;
    return pollTask(loc, { email, token });
}
async function getIssueProperty(issueKey, propKey) {
    const { baseUrl, email, token } = await getAuth();
    const r = await fetchWithTimeout(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/properties/${encodeURIComponent(propKey)}`, {
        headers: headers(email, token)
    }, 15000);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Erro ao ler property: ${r.status}`);
    const data = await r.json().catch(() => null);
    return data?.value ?? null;
}
async function acquireLockOrWait(issue) {
    const { email, enableQueueLock } = await getAuth();
    if (!enableQueueLock) return null;

    const entityId = Number(issue._id);
    if (!entityId || !Number.isFinite(entityId)) {
        throw new Error(`ID numerico dell'issue non disponível para o lock (${issue.key}). Abra o modal novamente.`);
    }

    const myLock = {
        owner: email,
        nonce: randNonce(),
        expiresAt: nowIsoPlus(PD_LOCK_TTL_MS)
    };

    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < PD_LOCK_WAIT_TOTAL_MS) {
        attempt++;

        const okCreate = await bulkSetPropertyFiltered(PD_LOCK_KEY, {
            filter: { entityIds: [entityId], hasProperty: false },
            value: myLock
        });
        if (okCreate) {
            const v = await getIssueProperty(issue.key, PD_LOCK_KEY).catch(() => null);
            if (v && v.nonce === myLock.nonce) return myLock;
        }

        const existing = await getIssueProperty(issue.key, PD_LOCK_KEY).catch(() => null);
        const exp = existing?.expiresAt && Date.parse(existing.expiresAt);
        const isExpired = !exp || (Date.now() > exp);

        if (existing && isExpired) {
            const takeover = await bulkSetPropertyFiltered(PD_LOCK_KEY, {
                filter: { entityIds: [entityId], hasProperty: true, currentValue: existing },
                value: myLock
            });
            if (takeover) {
                const v2 = await getIssueProperty(issue.key, PD_LOCK_KEY).catch(() => null);
                if (v2 && v2.nonce === myLock.nonce) return myLock;
            }
        }

        const sleepMs = PD_LOCK_POLL_MS + Math.floor(Math.random() * 400);
        setStatus(`Aguardando fila em ${issue.key}… (tentativa ${attempt})`);
        await new Promise(r => setTimeout(r, sleepMs));
    }

    throw new Error(`Timeout aguardando fila para ${issue.key}. Tente novamente.`);
}
async function releaseLock(issue, myLock) {
    const { enableQueueLock } = await getAuth();
    if (!enableQueueLock || !myLock) return true;
    const entityId = Number(issue._id);
    if (!entityId) return true;

    await bulkDeletePropertyFiltered(PD_LOCK_KEY, {
        entityIds: [entityId],
        currentValue: myLock
    }).catch(() => { });
    return true;
}

// ======= UI =======
const listEl = document.getElementById('list');
const specialSectionEl = document.getElementById('specialSection');
const specialListEl = document.getElementById('specialList');
const mainZeroToggleEl = document.getElementById('mainZeroToggle');
const specialZeroToggleEl = document.getElementById('specialZeroToggle');

const saveBtn = document.getElementById('saveBtn');
const saveExitBtn = document.getElementById('saveExitBtn');
const exitBtn = document.getElementById('exitBtn');
const refreshBtn = document.getElementById('refreshBtn');

let MODEL_MAIN = [];
let MODEL_SPECIAL = [];
let SAVING = false;
let watchdog = null;

// Flags di filtro zerados (default: occultati)
let HIDE_ZERO_MAIN = true;
let HIDE_ZERO_SPECIAL = true;

/* ---- PULSE control (Save) -------------------------------------------- */
function anyDirty() {
    return MODEL_MAIN.some(m => m.dirty) || MODEL_SPECIAL.some(m => m.dirty);
}
function startSavePulse() {
    saveBtn?.classList.add('save-pulsing');
}
function stopSavePulse() {
    saveBtn?.classList.remove('save-pulsing'); // torna al colore standard
}
function updateSavePulse() {
    if (anyDirty()) startSavePulse();
    else stopSavePulse();
}

refreshBtn.addEventListener('click', () => init());
exitBtn.addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: "pd:closed" }); } catch { }
    window.close();
});

saveBtn.addEventListener('click', async () => {
    const ok = await doSave(false);
    if (ok) await init();
});

saveExitBtn.addEventListener('click', async () => {
    const ok = await doSave(true);
    if (ok) {
        try { chrome.runtime.sendMessage({ type: "pd:closed" }); } catch { }
        window.close();
    }
});

window.addEventListener('beforeunload', () => {
    try { chrome.runtime.sendMessage({ type: "pd:closed" }); } catch { }
});

function normStatusKey(s) {
    const t = String(s || "").toLowerCase().trim();
    if (!t) return "unknown";
    if (t.includes("in progress")) return "inprogress";
    if (t.includes("blocked")) return "blocked";
    if (t.includes("need req")) return "needreqs";   // copre Need Reqs/Need Recs
    if (t.includes("to do")) return "todo";
    if (t.includes("done")) return "done";
    // nuovi status (classe dedicata per gestione colore da JS)
    if (t.includes("code review")) return "review";
    if (t.includes("testing")) return "testing";
    if (t === "qa" || t.includes(" qa")) return "qa";
    return "unknown";
}

function renderList(targetEl, arr) {
    targetEl.innerHTML = '';
    const tpl = document.getElementById('itemTpl');
    arr.forEach(item => {
        const node = tpl.content.cloneNode(true);
        const keyA = node.querySelector('.key');
        const sumD = node.querySelector('.summary');
        const spI = node.querySelector('.sp');
        const upB = node.querySelector('.up');
        const dnB = node.querySelector('.down');
        const dirtyEl = node.querySelector('.dirty');
        const statusEl = node.querySelector('.status-label');

        keyA.textContent = item.key;
        keyA.href = `${item._baseUrl}/browse/${encodeURIComponent(item.key)}`;
        sumD.textContent = item.summary || '(sem resumo)';
        spI.value = (item.newSp ?? item.sp ?? 0);

        // === Status label (preferisci nome esatto; fallback categoria) ===
        const sName = item.statusName || item.statusCat || 'Unknown';
        const classKey = normStatusKey(sName) || normStatusKey(item.statusCat);
        statusEl.textContent = sName;
        statusEl.classList.add(`st-${classKey}`);
        // Forza colore bianco per i nuovi status richiesti senza toccare il CSS
        if (classKey === 'review' || classKey === 'testing' || classKey === 'qa') {
            statusEl.style.color = '#ffffff';
        }

        const setDirty = (d) => { 
            item.dirty = d; 
            dirtyEl.classList.toggle('hidden', !d); 
            updateSavePulse();             // ← aggiorna pulsazione del Save
        };
        const clampHalf = (v) => { let n = Math.round((parseFloat(v) || 0) * 2) / 2; return n < 0 ? 0 : n; };

        const onChanged = () => {
            setDirty(true);
            // Re-render per applicare subito eventuale filtro "zerados"
            render();
        };

        upB.addEventListener('click', () => { const nv = clampHalf((+spI.value) + 0.5); spI.value = nv; item.newSp = nv; onChanged(); });
        dnB.addEventListener('click', () => { const nv = clampHalf((+spI.value) - 0.5); spI.value = nv; item.newSp = nv; onChanged(); });
        spI.addEventListener('change', () => { const nv = clampHalf(spI.value); spI.value = nv; item.newSp = nv; onChanged(); });

        targetEl.appendChild(node);
    });
}

// Helper: filtra in base a HIDE_ZERO_*
function visibleItems(arr, hideZero) {
    if (!hideZero) return arr;
    return arr.filter(it => Number(it.newSp ?? it.sp ?? 0) !== 0);
}

function updateZeroToggles() {
    if (mainZeroToggleEl) {
        mainZeroToggleEl.textContent = HIDE_ZERO_MAIN ? "Mostra os cards zerados" : "Oculte os cards zerados";
        mainZeroToggleEl.onclick = () => { HIDE_ZERO_MAIN = !HIDE_ZERO_MAIN; render(); };
    }
    if (specialZeroToggleEl) {
        specialZeroToggleEl.textContent = HIDE_ZERO_SPECIAL ? "Mostra os cards zerados" : "Oculte os cards zerados";
        specialZeroToggleEl.onclick = () => { HIDE_ZERO_SPECIAL = !HIDE_ZERO_SPECIAL; render(); };
    }
}

function render() {
    // Applica filtro zerados per ciascuna sezione
    const mainVis = visibleItems(MODEL_MAIN, HIDE_ZERO_MAIN);
    renderList(listEl, mainVis);

    const specialVis = visibleItems(MODEL_SPECIAL, HIDE_ZERO_SPECIAL);
    if (specialVis.length > 0 || MODEL_SPECIAL.length > 0) {
        specialSectionEl.classList.remove('hidden');
        renderList(specialListEl, specialVis);
    } else {
        specialSectionEl.classList.add('hidden');
        specialListEl.innerHTML = '';
    }

    // Aggiorna i testi dei toggle
    updateZeroToggles();

    // al termine del render, assicura stato corretto del Save
    updateSavePulse();
}

async function doSave(exitAfter) {
    if (SAVING) return false;
    SAVING = true;

    // appena parte il salvataggio:
    stopSavePulse();                    // ← smette di lampeggiare subito dopo il click
    setStatus('Salvando alterações…');  // testo di stato
    setStatusSaving(true);              // ← fa pulsare (azzurro → verde)

    try {
        const dirtyMain = MODEL_MAIN.filter(m => m.dirty && (m.newSp ?? m.sp) !== m.sp);
        const dirtySpec = MODEL_SPECIAL.filter(m => m.dirty && (m.newSp ?? m.sp) !== m.sp);
        const dirty = [...dirtyMain, ...dirtySpec];

        for (const it of dirty) {
            const PTS = typeof it.pts === 'number' ? it.pts : it.sp;
            const userNew = (typeof it.newSp === 'number') ? it.newSp : it.sp;
            const lova = (PTS - userNew);

            const { pas: PAS, idNum } = await (async () => {
                const { baseUrl, email, token } = await getAuth();
                const spFieldId = await resolveStoryPointsFieldId();
                const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(it.key)}?fields=${encodeURIComponent(spFieldId)}`;
                const r = await fetchWithTimeout(url, { headers: headers(email, token) }, 15000);
                if (!r.ok) throw new Error(`Falha ao obter valor atual no Jira (${it.key})`);
                const data = await r.json();
                return { pas: data?.fields?.[spFieldId] ?? 0, idNum: Number(data?.id) || Number(it._id) || null };
            })();

            const OBT = (PAS !== PTS);
            let NP;
            if (!OBT) {
                NP = userNew;
            } else {
                NP = Math.max(0, Math.round(((PAS - lova) || 0) * 2) / 2);
            }

            if (!it._id && idNum) it._id = idNum;
            let myLock = null;
            try {
                myLock = await acquireLockOrWait(it);
            } catch (lockErr) {
                console.warn(`[point_down] lock failure on ${it.key}:`, lockErr?.message || lockErr);
                setStatus(`❌ Não foi possível obter fila para ${it.key}. Pulando…`);
                continue;
            }

            try {
                await updateStoryPoints(it.key, NP);
                it.sp = NP;
                it.newSp = NP;
                it.dirty = false;
                it.pts = NP;
            } finally {
                try { await releaseLock(it, myLock); } catch { /* no-op */ }
            }
        }

        if (dirty.length > 0) {
            try { chrome.runtime.sendMessage({ type: "pd:saved", changedCount: dirty.length }); } catch { }
        }

        setStatus(dirty.length ? `✅ ${dirty.length} issue(s) atualizadas.` : 'Nada para salvar.');
        render();
        return true;
    } catch (e) {
        console.error(e);
        setStatus('❌ Erro ao salvar: ' + (e?.message || e));
        return false;
    } finally {
        SAVING = false;
        // termina la pulsazione dello stato al termine del ciclo
        setStatusSaving(false);
    }
}

async function init() {
    setStatus('Carregando issues da sprint atual...');
    setStatusSaving(false); // assicurati che lo stato non stia pulsando
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
        setStatus('⏳ Demorando… verifique: opções salvas? token válido? acesso ao board? (Veja Console F12)');
    }, 12000);

    // Reset default filtro: occultare zerados a ogni lancio
    HIDE_ZERO_MAIN = true;
    HIDE_ZERO_SPECIAL = true;
    updateZeroToggles();

    try {
        const { baseUrl, forceTestCard, isDev } = await getAuth();
        const spId = await resolveStoryPointsFieldId();
        const spName = (FIELD_CACHE && FIELD_CACHE.spFieldName) ? FIELD_CACHE.spFieldName : spId;
        setStatus(`Carregando issues da sprint atual... [SP: ${spName} (${spId})]`);

        let mainIssues = [];
        let specialIssues = [];
        if (isDev) {
            // Para DEV, não buscamos seção especial
            mainIssues = await fetchCurrentSprintIssues();
            specialIssues = [];
        } else {
            [mainIssues, specialIssues] = await Promise.all([
                fetchCurrentSprintIssues(),
                fetchSpecialSprintIssues()
            ]);
        }

        let forcedIssue = null;
        if (forceTestCard) {
            try {
                forcedIssue = await fetchIssueByKey("FGC-9683");
            } catch (e) {
                console.warn("[point_down] Não foi possível importar diretamente FGC-9683:", e?.message || e);
            }
        }

        const mainKeys = new Set(mainIssues.map(i => i.key));
        const specialsDedup = specialIssues.filter(i => !mainKeys.has(i.key));

        const { baseUrl: _b } = await getAuth();
        MODEL_MAIN = mainIssues.map(x => ({ ...x, _baseUrl: _b, dirty: false, pts: x.sp }));
        MODEL_SPECIAL = specialsDedup.map(x => ({ ...x, _baseUrl: _b, dirty: false, _special: true, pts: x.sp }));

        if (forcedIssue && !mainKeys.has(forcedIssue.key) && !MODEL_SPECIAL.some(i => i.key === forcedIssue.key)) {
            // Mantém também os novos campos de status
            const forcedWithStatus = { ...forcedIssue, _baseUrl: _b, dirty: false, pts: forcedIssue.sp };
            MODEL_MAIN.unshift(forcedWithStatus);
            console.log("[point_down] FGC-9683 adicionada (opção habilitada).");
        }

        clearTimeout(watchdog);

        const sprintListUrl = `${_b.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent('sprint in openSprints()')}`;
        const boardHref = BOARD_URL_FIXED;

        setStatusTwoLinks('Go to Sprint!', sprintListUrl, 'Board', boardHref);

        render();
    } catch (e) {
        clearTimeout(watchdog);
        console.error(e);
        setStatus('❌ ' + (e?.message || e));
    }
}

// Start
init();
