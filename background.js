// ---------- STATE ----------
let state = {
  cookiesCleared: 0,
  lastClean: null,
  lastError: null,
  active: false
};

let whitelist = [];
let blacklist = [];

const defaultWhitelist = ['google.com', 'amazon.com', 'facebook.com', 'hubspot.com'];

// === FIREFOX KEEP-ALIVE (Πιο επιθετικό) ===
setInterval(() => {
  // Απλό heartbeat
  chrome.runtime.sendMessage({ type: "KEEP_ALIVE" }, () => {});
}, 15000); // κάθε 15 δευτερόλεπτα

// Επιπλέον: Δημιουργούμε περιοδικό alarm για να ξυπνάμε το background
chrome.alarms.create("firefoxKeepAlive", { periodInMinutes: 0.5 }); // κάθε 30 δευτερόλεπτα

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "firefoxKeepAlive") {
    // Απλά για να κρατάμε το background ζωντανό
    console.log("Firefox keep-alive alarm triggered");
  }
});

// ---------- CONFIG LOADING ----------
async function loadConfigs() {
  try {
    const response = await fetch(chrome.runtime.getURL('config/cookie-categories.json'));
    const categories = await response.json();
    const freeBlacklist = [...(categories.free.ads || []), ...(categories.free.tracking || [])];
    blacklist = [...new Set([...blacklist, ...freeBlacklist])];
  } catch (e) {
    console.error("Config load error:", e);
  }
}

// ---------- STORAGE ----------
async function loadState() {
  try {
    const storedData = await chrome.storage.local.get(["state", "whitelist", "blacklist"]);
    const data = storedData || {};

    if (data.state) state = data.state;

    // ←←← ΑΥΤΗ ΕΙΝΑΙ Η ΔΙΟΡΘΩΣΗ ←←←
    // Βάζουμε τα defaults ΜΟΝΟ την ΠΡΩΤΗ φορά
    if (!data.whitelist) {
      whitelist = [...defaultWhitelist];
    } else {
      whitelist = data.whitelist;
    }

    blacklist = data.blacklist || [];

    await loadConfigs();
  } catch (e) {
    console.error("Storage load error:", e);
    whitelist = [...defaultWhitelist];
    blacklist = [];
  }
}

function saveState() {
  chrome.storage.local.set({ state });
}

function saveLists() {
  chrome.storage.local.set({ whitelist, blacklist });
}

// ---------- VALIDATION ----------
function validateDomain(domain) {
  domain = domain.toLowerCase();
  const tldRegex = /\.(com|net|org|io|co|uk|de|fr|gr|eu|app|site|ai|dev|biz|info|me|tv)$/i;
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain) && tldRegex.test(domain) && domain !== 'localhost';
}

// ---------- CLEAN LOGIC ----------
async function cleanCookies() {
  try {
    const cookies = await chrome.cookies.getAll({});
    let removed = 0;

    for (const cookie of cookies) {
      let shouldDelete = false;
      const domain = cookie.domain.replace(/^\./, "").toLowerCase();

      if (whitelist.some(w => domain.endsWith(w))) continue;
      if (blacklist.some(b => domain.endsWith(b))) shouldDelete = true;

      if (!shouldDelete) {
        if (cookie.hostOnly) continue;
        if (cookie.sameSite !== "no_restriction") continue;

        const nameLower = cookie.name.toLowerCase();
        if (nameLower.includes("sess") || nameLower.includes("auth") || 
            nameLower.includes("token") || nameLower.includes("sid") ||
            nameLower.includes("login") || nameLower.includes("cart") ||
            nameLower.includes("pref") || nameLower.includes("locale") ||
            nameLower.includes("user_id")) {
          continue;
        }
        shouldDelete = true;
      }

      if (!shouldDelete) continue;

      const url = (cookie.secure ? "https://" : "http://") + domain + cookie.path;
      try {
        await chrome.cookies.remove({ url, name: cookie.name });
        removed++;
      } catch (_) {}
    }

    if (removed > 0) {
      state.cookiesCleared += removed;
      state.lastClean = Date.now();
    }

    saveState();
    return { success: true, removed };
  } catch (e) {
    state.lastError = e.message || "Unknown error";
    saveState();
    return { success: false, error: state.lastError };
  }
}

// ---------- MESSAGING ----------
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  (async () => {
    await loadState();

    if (msg.type === "KEEP_ALIVE") {
      sendResponse({ status: "alive" });
      return;
    }

    if (msg.type === "CLEAN_NOW") {
      const res = await cleanCookies();
      sendResponse({ state, ...res });
      return;
    }

    if (msg.type === "GET_STATE") {
      sendResponse({ state, whitelist, blacklist });
      return;
    }

    if (msg.type === "SMART_PROTECTION") {
      state.active = !state.active;
      if (state.active) {
        chrome.alarms.create('periodicClean', { periodInMinutes: 30 });
      } else {
        chrome.alarms.clear('periodicClean');
      }
      saveState();
      sendResponse({ state });
      return;
    }

    if (msg.type === "BULK_OPT_OUT") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const res = await performBulkOptOut(tab.id);
        sendResponse(res);
      } else {
        sendResponse({ success: false, error: "No active tab" });
      }
      return;
    }

    // Add / Remove handlers
    if (msg.type === "ADD_WHITELIST") {
      let domain = msg.domain.trim().toLowerCase();
      if (blacklist.includes(domain)) {
        sendResponse({ error: "This domain is already in Blacklist!" });
        return;
      }
      if (validateDomain(domain) && !whitelist.includes(domain)) {
        whitelist.push(domain);
        saveLists();
      }
      sendResponse({ whitelist });
      return;
    }

    if (msg.type === "ADD_BLACKLIST") {
      let domain = msg.domain.trim().toLowerCase();
      if (whitelist.includes(domain)) {
        sendResponse({ error: "This domain is already in Whitelist!" });
        return;
      }
      if (validateDomain(domain) && !blacklist.includes(domain)) {
        blacklist.push(domain);
        saveLists();
      }
      sendResponse({ blacklist });
      return;
    }

    if (msg.type === "REMOVE_WHITELIST") {
      whitelist = whitelist.filter(d => d !== msg.domain.toLowerCase());
      saveLists();
      sendResponse({ whitelist });
      return;
    }

    if (msg.type === "REMOVE_BLACKLIST") {
      blacklist = blacklist.filter(d => d !== msg.domain.toLowerCase());
      saveLists();
      sendResponse({ blacklist });
      return;
    }

    sendResponse({ error: "Unknown message type" });
  })();

  return true;
});

loadState();