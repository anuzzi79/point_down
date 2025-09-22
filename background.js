// background.js (MV3, type: module)

// ====== Config / costanti ======
const ALARM_NAME = "point_down_alarm";
const DEFAULT_HOUR = 17;
const DEFAULT_MINUTE = 50;

// Icone "normali" (quelle del manifest)
const ICON_PATHS = {
    16: "icons/icon16.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
};

// ====== Util: apri il modal in una nuova tab ======
function openModalTab() {
    chrome.tabs.create({ url: chrome.runtime.getURL("modal.html") });
}

// ====== Lettura orario programmato ======
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

// ====== Scheduling alarme quotidiano ======
async function scheduleDailyAlarm() {
    const { hour, minute } = await getScheduledTime();

    await chrome.alarms.clear(ALARM_NAME);

    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
        next.setDate(next.getDate() + 1);
    }

    chrome.alarms.create(ALARM_NAME, {
        when: next.getTime(),
        periodInMinutes: 24 * 60, // ogni giorno
    });

    console.log(
        `[point_down] Alarme agendado para ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (local)`
    );
}

// Prime installazioni / avvio browser
chrome.runtime.onInstalled.addListener(() => scheduleDailyAlarm());
chrome.runtime.onStartup.addListener(() => scheduleDailyAlarm());

// Re-programma quando cambia l'orario nelle Options
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.alarmTime) scheduleDailyAlarm();
});

// ====== Lampeggio icona ======
let blinkInterval = null;
let blinkStopTimeout = null;
let blinkStateOn = false;
let blankImages = null;  // cache ImageData trasparente
let blinkMode = "icon";  // "icon" (preferito) oppure "badge" (fallback)

/**
 * Crea (e cache) ImageData trasparenti per 16/48/128 px.
 * In caso di ambiente senza ImageData, passa in "badge mode".
 */
function ensureBlankImages() {
    if (blankImages) return blankImages;
    try {
        const sizes = [16, 48, 128];
        const map = {};
        for (const s of sizes) {
            // ImageData RGBA zero = completamente trasparente
            map[s] = new ImageData(s, s);
        }
        blankImages = map;
        blinkMode = "icon";
    } catch (e) {
        // Fallback: non possiamo creare ImageData qui → usa badge "•"
        blinkMode = "badge";
        chrome.action.setBadgeBackgroundColor({ color: "#ff3333" });
    }
    return blankImages;
}

function setIconOn() {
    if (blinkMode === "icon") {
        chrome.action.setIcon({ path: ICON_PATHS });
    } else {
        // badge mode: spegni il puntino
        chrome.action.setBadgeText({ text: "" });
    }
}

function setIconOff() {
    if (blinkMode === "icon") {
        ensureBlankImages();
        chrome.action.setIcon({ imageData: blankImages });
    } else {
        // badge mode: accendi un puntino come "blink"
        chrome.action.setBadgeText({ text: "•" });
    }
}

function startBlinking() {
    if (blinkInterval) return; // già lampeggiando
    ensureBlankImages();
    blinkStateOn = false;
    setIconOff();

    // toggle ogni 333ms
    blinkInterval = setInterval(() => {
        blinkStateOn = !blinkStateOn;
        if (blinkStateOn) setIconOn();
        else setIconOff();
    }, 333);

    // stop automatico dopo 5 minuti in ogni caso
    blinkStopTimeout = setTimeout(stopBlinking, 5 * 60 * 1000);
}

function stopBlinking() {
    if (blinkInterval) {
        clearInterval(blinkInterval);
        blinkInterval = null;
    }
    if (blinkStopTimeout) {
        clearTimeout(blinkStopTimeout);
        blinkStopTimeout = null;
    }
    setIconOn(); // ripristina icona normale
}

// ====== Eventi che attivano il modal / blink ======

// Al suono dell'allarme: apri modal e inizia lampeggio
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        startBlinking();
        openModalTab();
    }
});

// ⚠️ RIMOSSO: listener per chrome.commands (Ctrl+B) — non più supportato

// Messaggi dal modal per terminare il lampeggio
chrome.runtime.onMessage.addListener((msg) => {
    try {
        if (!msg || !msg.type) return;

        // a) stop se l'utente ha salvato con modifiche
        if (msg.type === "pd:saved" && typeof msg.changedCount === "number") {
            if (msg.changedCount > 0) stopBlinking();
        }

        // b) stop se l'utente ha chiuso il modal
        if (msg.type === "pd:closed") {
            stopBlinking();
        }
    } catch (e) {
        console.warn("[point_down] listener error:", e);
    }
});

// (opzionale) Notifiche legacy – non usate nel flusso corrente
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
