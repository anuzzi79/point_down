// ======= Config: usa SEMPRE l'ID scoperto (customfield_10022) =======
const SP_FIELD_ID_FIXED = "customfield_10022";         // ← risultato della “pesca”
const SP_FIELD_NAME_FIXED = "Story Points (fixed)";    // etichetta informativa

// ======= Helpers base =======
function setStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
    console.log('[point_down]', msg);
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
async function getAuth() {
    const { baseUrl, email, token, jql } = await chrome.storage.sync.get(["baseUrl", "email", "token", "jql"]);
    if (!baseUrl || !email || !token) {
        throw new Error("Credenciais Jira não configuradas. Abra 'opções' e preencha Base URL, Email e Token.");
    }
    return { baseUrl, email, token, jql };
}

// ======= Jira: field cache + resolve SP field =======
let FIELD_CACHE = null;

/**
 * Resolve o ID do campo de Story Points.
 * Prioriza o ID FIXO descoberto (customfield_10022) para garantir que
 * lemos/escrevemos exatamente o campo certo.
 */
async function resolveStoryPointsFieldId() {
    if (FIELD_CACHE?.spFieldId) return FIELD_CACHE.spFieldId;

    // 1) Usa SEMPRE o ID fixo descoberto pela “pesca”
    if (SP_FIELD_ID_FIXED) {
        FIELD_CACHE = { spFieldId: SP_FIELD_ID_FIXED, spFieldName: SP_FIELD_NAME_FIXED };
        console.log('[point_down] Story Points field (fixed):', FIELD_CACHE.spFieldName, FIELD_CACHE.spFieldId);
        return FIELD_CACHE.spFieldId;
    }

    // 2) (fallback — não deve acontecer porque temos o fixo)
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

// ======= Jira: search via /search/jql (POST + nextPageToken) =======
async function fetchCurrentSprintIssues() {
    const { baseUrl, email, token, jql } = await getAuth();
    const spFieldId = await resolveStoryPointsFieldId();

    const finalJql = (jql && jql.trim()) ? jql.trim()
        : 'sprint in openSprints() AND assignee = currentUser() AND statusCategory != Done';

    const fields = ["summary", spFieldId];
    let nextPageToken = null;
    const maxResults = 100;
    const all = [];

    while (true) {
        const body = JSON.stringify({
            jql: finalJql,
            fields,
            maxResults,
            nextPageToken // null na 1ª chamada
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

    return all.map(it => ({
        key: it.key,
        summary: it.fields.summary,
        sp: it.fields[spFieldId] ?? 0,
    }));
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

// ======= UI =======
const listEl = document.getElementById('list');
const saveBtn = document.getElementById('saveBtn');
const saveExitBtn = document.getElementById('saveExitBtn');
const exitBtn = document.getElementById('exitBtn');
const refreshBtn = document.getElementById('refreshBtn');

let MODEL = [];
let SAVING = false;
let watchdog = null;

refreshBtn.addEventListener('click', () => init());
exitBtn.addEventListener('click', () => window.close());
saveBtn.addEventListener('click', async () => { await doSave(false); });
saveExitBtn.addEventListener('click', async () => { const ok = await doSave(true); if (ok) window.close(); });

function render() {
    listEl.innerHTML = '';
    const tpl = document.getElementById('itemTpl');
    MODEL.forEach(item => {
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

        listEl.appendChild(node);
    });
}

async function doSave(exitAfter) {
    if (SAVING) return false;
    SAVING = true;
    setStatus('Salvando alterações…');
    try {
        const dirty = MODEL.filter(m => m.dirty && (m.newSp ?? m.sp) !== m.sp);
        for (const it of dirty) {
            await updateStoryPoints(it.key, it.newSp);
            it.sp = it.newSp;
            it.dirty = false;
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
        if (!exitAfter) setTimeout(() => setStatus(''), 4000);
    }
}

async function init() {
    setStatus('Carregando issues da sprint atual...');
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
        setStatus('⏳ Demorando… verifique: opções salvas? token válido? acesso ao board? (Veja Console F12)');
    }, 12000);

    try {
        const { baseUrl } = await getAuth();
        const spId = await resolveStoryPointsFieldId();
        const spName = (FIELD_CACHE && FIELD_CACHE.spFieldName) ? FIELD_CACHE.spFieldName : spId;
        setStatus(`Carregando issues da sprint atual... [SP: ${spName} (${spId})]`);

        const issues = await fetchCurrentSprintIssues();
        MODEL = issues.map(x => ({ ...x, _baseUrl: baseUrl, dirty: false }));
        clearTimeout(watchdog);
        setStatus(
            (issues.length ? `Encontradas ${issues.length} issue(s).` : 'Nenhuma issue na sprint atual.') +
            ` • Campo SP: ${spName} (${spId})`
        );
        render();
    } catch (e) {
        clearTimeout(watchdog);
        console.error(e);
        setStatus('❌ ' + (e?.message || e));
    }
}

// Start
init();
