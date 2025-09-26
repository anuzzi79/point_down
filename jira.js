// jira.js — versão compatível com /rest/api/3/search/jql (pagina com nextPageToken)
// (mantido aqui para compat; o modal usa sua própria implementação standalone)

function jqlWithInProgress(baseJql) {
    const trimmed = (baseJql || "").trim();
    if (!trimmed) return 'status IN ("In Progress", "Blocked")';
    return `(${trimmed}) AND status IN ("In Progress", "Blocked")`;
}

export async function fetchCurrentSprintIssues() {
    const { baseUrl, email, token, jql } = await getAuth();
    const spFieldId = await resolveStoryPointsFieldId();

    const base = (jql && jql.trim().length > 0)
        ? jql.trim()
        : 'sprint in openSprints() AND assignee = currentUser() AND statusCategory != Done';

    // Enforce universalmente: status deve ser "In Progress" ou "Blocked"
    const finalJql = jqlWithInProgress(base);

    const fields = ["summary", spFieldId];

    let nextPageToken = null;        // começa em null
    const maxResults = 100;          // ajuste se quiser (limites podem variar)
    const all = [];

    while (true) {
        const body = JSON.stringify({
            jql: finalJql,
            fields,
            maxResults,
            nextPageToken      // null na 1ª chamada; depois o token retornado
        });

        const r = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
            method: "POST",
            headers: {
                "Authorization": `Basic ${btoa(`${email}:${token}`)}`,
                "Accept": "application/json",
                "Content-Type": "application/json"
            },
            body
        });

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

// Nota: neste arquivo não está definida getAuth()/resolveStoryPointsFieldId(),
// pois o modal atual usa uma versão standalone. Mantivemos apenas o fetch para compat.
