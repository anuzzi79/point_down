// background.js (MV3, type: module)

// Chave do alarme
const ALARM_NAME = "point_down_alarm";

// Default se o usuário não configurar
const DEFAULT_HOUR = 17;
const DEFAULT_MINUTE = 50;

// Util: abre o modal.html em nova aba
function openModalTab() {
    chrome.tabs.create({ url: chrome.runtime.getURL("modal.html") });
}

// Lê hora/minuto do storage (formato "HH:MM"), cai no default se faltar
async function getScheduledTime() {
    const { alarmTime } = await chrome.storage.sync.get(["alarmTime"]);
    if (typeof alarmTime === "string") {
        const m = alarmTime.match(/^(\d{1,2}):(\d{2})$/);
        if (m) {
            const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
            const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
            return { hour: h, minute: min };
        }
    }
    return { hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE };
}

// Agenda o alarme para o próximo horário configurado (local)
async function scheduleDailyAlarm() {
    const { hour, minute } = await getScheduledTime();

    // Cancela alarme atual (se existir) para evitar duplicados
    await chrome.alarms.clear(ALARM_NAME);

    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
        // horário de hoje já passou -> agenda para amanhã
        next.setDate(next.getDate() + 1);
    }

    chrome.alarms.create(ALARM_NAME, {
        when: next.getTime(),
        periodInMinutes: 24 * 60, // repete diariamente
    });

    console.log(
        `[point_down] Alarme agendado para ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (local)`
    );
}

// Primeira configuração / início do navegador
chrome.runtime.onInstalled.addListener(() => {
    scheduleDailyAlarm();
});
chrome.runtime.onStartup.addListener(() => {
    scheduleDailyAlarm();
});

// Reagenda automaticamente quando o usuário muda o horário nas Options
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.alarmTime) {
        scheduleDailyAlarm();
    }
});

// Disparo por alarme → abre DIRETO o modal (sem notificação)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        openModalTab();
    }
});

// Disparo por atalho (Ctrl+B) → abre o modal
chrome.commands.onCommand.addListener((command) => {
    if (command === "show_point_down") {
        openModalTab();
    }
});

// (Opcional) Ainda deixamos uma função de notificação se quiser usar no futuro:
function fireNotification() {
    chrome.notifications.create("point_down_daily", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Precisa baixar o ponto",
        message: "Clique aqui para abrir o point_down e ajustar seus Story Points da sprint atual.",
        priority: 2,
    });
    chrome.notifications.onClicked.addListener((notifId) => {
        if (notifId === "point_down_daily") {
            openModalTab();
            chrome.notifications.clear("point_down_daily");
        }
    });
}
