// ======= Config: usa SEMPRE l'ID scoperto (customfield_10022) =======
const SP_FIELD_ID_FIXED = "customfield_10022";         // ← risultato della “pesca”
const SP_FIELD_NAME_FIXED = "Story Points (fixed)";    // etichetta informativa

// URL fisso della board (Active sprints)
const BOARD_URL_FIXED = "https://facilitygrid.atlassian.net/jira/software/c/projects/FGC/boards/34";

// ======= Locking via Jira Issue Properties (bulk + filter) =======
const PD_LOCK_KEY = "point_down_lock";
const PD_LOCK_TTL_MS = 60_000;        // lock dura 60s (auto-expira)
const PD_LOCK_WAIT_TOTAL_MS = 30_000; // attesa massima in coda
const PD_LOCK_POLL_MS = 900;          // backoff base tra tentativi
const PD_TASK_POLL_MS = 800;          // polling stato task di bulk op
const PD_TASK_POLL_MAX = 20;          // max tentativi polling task

// ======= Helpers base =======
function setStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
    console.log('[point_down]', msg);
}

// Mostra due link separati nello status: "Go to Sprint!" e "Board"
function setStatusTwoLinks(sprintLabel, sprintHref, boardLabel, boardHref) {
    const el = document.getElementById('status');
    if (!el) return;
    el.innerHTML = "";

    const aSprint = document.createElement('a');
    aSprint.textContent = sprintLabel;
    aSprint.href = sprintHref;
    aSprint.target = "_blank";
    aSprint.rel = "noopener noreferrer";

    const spacer = document.createTextNode("   ");

    const aBoard = document.createElement('a');
    aBoard.textContent = boardLabel;
    aBoard.href = boardHref;
    aBoard.target = "_blank";
    aBoard.rel = "noopener noreferrer";

    el.appendChild(aSprint);
    el.appendChild(spacer);
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
async function fetchWithTimeout(url, opts = {}, ms = 20000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
        clearTimeout(t);
    }
}

// Estesa per includere anche forceTestCard ed enableQueueLock dalle Options
async function getAuth() {
    const { baseUrl, email, token, jql, forceTestCard, enableQueueLock } =
        await chrome.storage.sync.get(["baseUrl", "email", "token", "jql", "forceTestCard", "enableQueueLock"]);
    if (!baseUrl || !email || !token) {
        throw new Error("Credenciais Jira não configuradas. Abra 'opções' e preencha Base URL, Email e Token.");
    }
    const _forceTestCard = (typeof forceTestCard === 'boolean') ? forceTestCard : true;
    const _enableQueueLock = (typeof enableQueueLock === 'boolean') ? enableQueueLock : true; // default ON
    return { baseUrl, email, token, jql, forceTestCard: _forceTestCard, enableQueueLock: _enableQueueLock };
}

// ======= JQL helper: forza status IN ("In Progress","Blocked","Need Reqs","Done") =======
function jqlWithInProgress(baseJql) {
    const trimmed = (baseJql || "").trim();
    const STATUSES = ["In Progress", "Blocked", "Need Reqs", "Done"];
    const clause = `status IN (${STATUSES.map(s => `"${s}"`).join(", ")})`;
    if (!trimmed) return clause;
    return `(${trimmed}) AND ${clause}`;
}

// ======= Jira: field cache + resolve SP field =======
let FIELD_CACHE = null;

/**
 * Resolve o ID do campo de Story Points.
 * Prioriza o ID FIXO descoberto (customfield_10022) per garantire che
 * lemos/escrevemos exatamente o campo certo.
 */
async function resolveStoryPointsFieldId() {
    if (FIELD_CACHE?.spFieldId) return FIELD_CACHE.spFieldId;

    if (SP_FIELD_ID_FIXED) {
        FIELD_CACHE = { spFieldId: SP_FIELD_ID_FIXED, spFieldName: SP_FIELD_NAME_FIXED };
        console.log('[point_down] Story Points field (fixed):', FIELD_CACHE.spFieldName, FIELD_CACHE.spFieldId);
        return FIELD_CACHE.spFieldId;
    }

    // (fallback non usato perché abbiamo il fisso)
    const { baseUrl, email, token } = await getAuth();
    const r = await fetchWithTimeout(`${baseUrl}/rest/api/3/field`, {
        headers: headers(email, token)
    });
    if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error("Falha ao buscar campos do Jira. " + (txt || r.status));
    }
    const fields = await r.json();
    const candidates = ["Story Points", "Story Point Estimate", "Story point estimate", "Story points", "Story Point"];
    let match = null;
    for (const f of fields) {
        const name = (f.name || "").toLowerCase();
        if (candidates.some(c => name === c.toLowerCase())) { match = f; break; }
    }
    if (!match) throw new Error("Campo de Story Points não encontrado por nome. Ajuste o nome/ID.");
    FIELD_CACHE = { spFieldId: match.id, spFieldName: match.name || match.id };
    console.log('[point_down] Story Points field (resolved):', FIELD_CACHE.spFieldName, FIELD_CACHE.spFieldId);
    return match.id;
}

// ======= Jira: search helper via /search/jql (POST + nextPageToken) =======
async function fetchIssuesByJql(finalJql, spFieldId) {
    const { baseUrl, email, token } = await getAuth();
    const fields = ["summary", spFieldId];
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

    // ordinamento per punti residui (sp) decrescente
    return all.map(it => ({
        key: it.key,
        summary: it.fields.summary,
        sp: it.fields[spFieldId] ?? 0,
        _id: it.id // teniamo anche l'ID numerico per i lock
    })).sort((a, b) => (b.sp || 0) - (a.sp || 0));
}

// JQL padrão (assignee = currentUser) — già respeita custom JQL salvo nas opções
async function fetchCurrentSprintIssues() {
    const { jql } = await getAuth();
    const base = (jql && jql.trim())
        ? jql.trim()
        : 'sprint in openSprints() AND assignee = currentUser() AND statusCategory != Done';
    const finalJql = jqlWithInProgress(base);
    const spFieldId = await resolveStoryPointsFieldId();
    return fetchIssuesByJql(finalJql, spFieldId);
}

// JQL especial: títulos contendo explorat* ou regres*/regress* (independente de assignee)
async function fetchSpecialSprintIssues() {
    const spFieldId = await resolveStoryPointsFieldId();
    const specialBase =
        'sprint in openSprints() AND (summary ~ "explorat" OR summary ~ "regres" OR summary ~ "regress")';
    const specialJql = jqlWithInProgress(specialBase);
    return fetchIssuesByJql(specialJql, spFieldId);
}

/**
 * Fetch diretto per uma issue específica por chave
 */
async function fetchIssueByKey(issueKey) {
    const { baseUrl, email, token } = await getAuth();
    const spFieldId = await resolveStoryPointsFieldId();
    const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent("summary," + spFieldId)}`;

    const r = await fetchWithTimeout(url, { headers: headers(email, token) }, 20000);
    if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`Falha ao buscar issue ${issueKey}: ` + (txt || r.status));
    }
    const data = await r.json();
    return {
        key: data.key,
        summary: data.fields?.summary || "(sem resumo)",
        sp: data.fields?.[spFieldId] ?? 0,
        _id: data.id
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
function nowIsoPlus(ms) {
    return new Date(Date.now() + ms).toISOString();
}
function randNonce() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
async function pollTask(locationUrl, { email, token }) {
    for (let i = 0; i < PD_TASK_POLL_MAX; i++) {
        await new Promise(r => setTimeout(r, PD_TASK_POLL_MS));
        const rr = await fetchWithTimeout(locationUrl, { headers: { "Authorization": `Basic ${b64(`${email}:${token}`)}`, "Accept": "application/json" } }, 20000);
        if (!rr.ok) continue;
        const task = await rr.json().catch(() => null);
        // le pagine Atlassian mostrano "COMPLETE"/"IN_PROGRESS"/"FAILED" nei task
        const st = (task && (task.status || task.state || task.currentStatus || task.elementType)) || "";
        if (/COMPLETE|SUCCESS/i.test(st)) return true;
        if (/FAILED|ERROR/i.test(st)) return false;
    }
    return false; // timeout polling
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
    // segue il location per stato task
    const loc = r.headers.get("location");
    if (!loc) {
        // alcuni ambienti possono rispondere 200/202 senza location; assumiamo OK
        return true;
    }
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

/**
 * Acquisisce lock cooperativo su una issue:
 *  1) tenta set property con filtro hasProperty=false (CAS create)
 *  2) se già presente:
 *      - se expired → takeover con filtro currentValue=oldLock
 *      - altrimenti attende e ritenta fino a timeout
 */
async function acquireLockOrWait(issue) {
    const { email, enableQueueLock } = await getAuth();
    if (!enableQueueLock) return null; // locking disattivato via options

    const entityId = Number(issue._id);
    if (!entityId || !Number.isFinite(entityId)) {
        throw new Error(`ID numerico dell'issue non disponibile per il lock (${issue.key}). Abra o modal novamente.`);
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

        // 1) tentativo CAS: crea lock solo se non esiste
        const okCreate = await bulkSetPropertyFiltered(PD_LOCK_KEY, {
            filter: { entityIds: [entityId], hasProperty: false },
            value: myLock
        });
        if (okCreate) {
            // conferma di possesso (verifica)
            const v = await getIssueProperty(issue.key, PD_LOCK_KEY).catch(() => null);
            if (v && v.nonce === myLock.nonce) return myLock; // lock acquisito
        }

        // 2) c'è un lock: controlliamo se scaduto
        const existing = await getIssueProperty(issue.key, PD_LOCK_KEY).catch(() => null);
        const exp = existing?.expiresAt && Date.parse(existing.expiresAt);
        const isExpired = !exp || (Date.now() > exp);

        if (existing && isExpired) {
            // CAS takeover: sostituisci solo se currentValue == existing
            const takeover = await bulkSetPropertyFiltered(PD_LOCK_KEY, {
                filter: { entityIds: [entityId], hasProperty: true, currentValue: existing },
                value: myLock
            });
            if (takeover) {
                const v2 = await getIssueProperty(issue.key, PD_LOCK_KEY).catch(() => null);
                if (v2 && v2.nonce === myLock.nonce) return myLock;
            }
        }

        // 3) attesa ritentando (backoff con jitter)
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

    // elimina lock solo se il valore corrente combacia col mio (evita race)
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

const saveBtn = document.getElementById('saveBtn');
const saveExitBtn = document.getElementById('saveExitBtn');
const exitBtn = document.getElementById('exitBtn');
const refreshBtn = document.getElementById('refreshBtn');

let MODEL_MAIN = [];
let MODEL_SPECIAL = [];
let SAVING = false;
let watchdog = null;

refreshBtn.addEventListener('click', () => init());
exitBtn.addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: "pd:closed" }); } catch { }
    window.close();
});

// ⬅️ Dopo ogni SALVA, se resti nel modale, facciamo REFRESH per “fotografare” il nuovo PTS
saveBtn.addEventListener('click', async () => {
    const ok = await doSave(false);
    if (ok) await init();  // ricarica lista → pts aggiornati da sorgente Jira
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

        keyA.textContent = item.key;
        keyA.href = `${item._baseUrl}/browse/${encodeURIComponent(item.key)}`;
        sumD.textContent = item.summary || '(sem resumo)';
        spI.value = (item.newSp ?? item.sp ?? 0);

        const setDirty = (d) => { item.dirty = d; dirtyEl.classList.toggle('hidden', !d); };
        const clampHalf = (v) => { let n = Math.round((parseFloat(v) || 0) * 2) / 2; return n < 0 ? 0 : n; };

        upB.addEventListener('click', () => { const nv = clampHalf((+spI.value) + 0.5); spI.value = nv; item.newSp = nv; setDirty(true); });
        dnB.addEventListener('click', () => { const nv = clampHalf((+spI.value) - 0.5); spI.value = nv; item.newSp = nv; setDirty(true); });
        spI.addEventListener('change', () => { const nv = clampHalf(spI.value); spI.value = nv; item.newSp = nv; setDirty(true); });

        targetEl.appendChild(node);
    });
}

function render() {
    renderList(listEl, MODEL_MAIN);

    if (MODEL_SPECIAL.length > 0) {
        specialSectionEl.classList.remove('hidden');
        renderList(specialListEl, MODEL_SPECIAL);
    } else {
        specialSectionEl.classList.add('hidden');
        specialListEl.innerHTML = '';
    }
}

async function doSave(exitAfter) {
    if (SAVING) return false;
    SAVING = true;
    setStatus('Salvando alterações…');
    try {
        const dirtyMain = MODEL_MAIN.filter(m => m.dirty && (m.newSp ?? m.sp) !== m.sp);
        const dirtySpec = MODEL_SPECIAL.filter(m => m.dirty && (m.newSp ?? m.sp) !== m.sp);
        const dirty = [...dirtyMain, ...dirtySpec];

        for (const it of dirty) {
            const PTS = typeof it.pts === 'number' ? it.pts : it.sp;
            const userNew = (typeof it.newSp === 'number') ? it.newSp : it.sp;
            const lova = (PTS - userNew);

            // ricalcola PAS dal server prima del write
            const { pas: PAS, idNum } = await (async () => {
                const { baseUrl, email, token } = await getAuth();
                const spFieldId = await resolveStoryPointsFieldId();
                const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(it.key)}?fields=${encodeURIComponent(spFieldId)}`;
                const r = await fetchWithTimeout(url, { headers: headers(email, token) }, 15000);
                if (!r.ok) throw new Error(`Falha ao obter valor atual no Jira (${it.key})`);
                const data = await r.json();
                return { pas: data?.fields?.[spFieldId] ?? 0, idNum: Number(data?.id) || Number(it._id) || null };
            })();

            // prepara baseline/O.B.T.
            const OBT = (PAS !== PTS);
            let NP;
            if (!OBT) {
                NP = userNew;
            } else {
                NP = Math.max(0, Math.round(((PAS - lova) || 0) * 2) / 2);
            }

            // === Corridoio di attesa: ACQUIRE LOCK (se abilitato) ===
            // assicuriamo che l'oggetto it abbia _id per la property bulk
            if (!it._id && idNum) it._id = idNum;
            let myLock = null;
            try {
                myLock = await acquireLockOrWait(it);
            } catch (lockErr) {
                console.warn(`[point_down] lock failure on ${it.key}:`, lockErr?.message || lockErr);
                setStatus(`❌ Não foi possível obter fila para ${it.key}. Pulando…`);
                continue; // salta questa issue mantenendo le altre
            }

            try {
                await updateStoryPoints(it.key, NP);

                // ⬅️ Nuova baseline immediata: PTS diventa NP (finché non arriva il refresh)
                it.sp = NP;
                it.newSp = NP;
                it.dirty = false;
                it.pts = NP;   // baseline al valore scritto
            } finally {
                // === RILASCIA LOCK ===
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
        // lo status potrà essere rimpiazzato dall’init() se resti nel modale
    }
}

async function init() {
    setStatus('Carregando issues da sprint atual...');
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
        setStatus('⏳ Demorando… verifique: opções salvas? token válido? acesso ao board? (Veja Console F12)');
    }, 12000);

    try {
        const { baseUrl, forceTestCard } = await getAuth();
        const spId = await resolveStoryPointsFieldId();
        const spName = (FIELD_CACHE && FIELD_CACHE.spFieldName) ? FIELD_CACHE.spFieldName : spId;
        setStatus(`Carregando issues da sprint atual... [SP: ${spName} (${spId})]`);

        const [mainIssues, specialIssues] = await Promise.all([
            fetchCurrentSprintIssues(),
            fetchSpecialSprintIssues()
        ]);

        // Opzione: forza l’import della card di test SOLO se abilitato in Options 
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

        // ⬅️ Alla ricarica, fotografiamo PTS = sp proveniente da Jira (nuova baseline )
        MODEL_MAIN = mainIssues.map(x => ({ ...x, _baseUrl: baseUrl, dirty: false, pts: x.sp }));
        MODEL_SPECIAL = specialsDedup.map(x => ({ ...x, _baseUrl: baseUrl, dirty: false, _special: true, pts: x.sp }));

        // Aggiungi la card forzata solo se non esiste già
        if (forcedIssue && !mainKeys.has(forcedIssue.key) && !MODEL_SPECIAL.some(i => i.key === forcedIssue.key)) {
            MODEL_MAIN.unshift({ ...forcedIssue, _baseUrl: baseUrl, dirty: false, pts: forcedIssue.sp, _forced: true });
            console.log("[point_down] FGC-9683 adicionada (opção habilitada).");
        }

        clearTimeout(watchdog);

        const sprintListUrl = `${baseUrl.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent('sprint in openSprints()')}`;
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
