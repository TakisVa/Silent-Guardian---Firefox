document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const lastCleanEl      = $("lastClean");
  const cookiesClearedEl = $("cookiesCleared");
  const statusEl         = $("status");

  const cleanBtn = $("cleanNow");
  const smartBtn = $("smartProtection");
  const bulkBtn  = $("bulkOptOut");

  function formatDate(ts) {
    if (!ts) return "Never";
    const d = new Date(ts);
    return d.toLocaleString("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false
    });
  }

  function setStatus(active) {
    if (!statusEl) return;
    statusEl.textContent = active ? "● Active" : "● Inactive";
    statusEl.classList.toggle("active", active);
    statusEl.classList.toggle("inactive", !active);
  }

  async function refresh() {
    try {
      const data = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      if (!data?.state) return;

      if (lastCleanEl) lastCleanEl.textContent = formatDate(data.state.lastClean);
      if (cookiesClearedEl) cookiesClearedEl.textContent = data.state.cookiesCleared ?? 0;
      setStatus(!!data.state.active);
    } catch (e) {
      console.error("Refresh error:", e);
      setStatus(false);
    }
  }

  async function act(type) {
    try {
      await chrome.runtime.sendMessage({ type });
    } catch (e) {
      alert(`Action failed: ${e.message}`);
    }
    await refresh();
  }

  cleanBtn?.addEventListener("click", () => act("CLEAN_NOW"));
  smartBtn?.addEventListener("click", () => act("SMART_PROTECTION"));
  bulkBtn?.addEventListener("click", () => act("BULK_OPT_OUT"));

  // Whitelist & Blacklist
  function safeById(id) { return document.getElementById(id); }

  async function refreshLists() {
    const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });

    const wl = safeById("whitelistList");
    const bl = safeById("blacklistList");

    if (!wl || !bl) return;

    wl.innerHTML = bl.innerHTML = "";

    (res.whitelist || []).forEach(d => {
      const li = document.createElement("li");
      li.textContent = d;
      li.style.cursor = "pointer";
      li.onclick = async () => {
        await chrome.runtime.sendMessage({ type: "REMOVE_WHITELIST", domain: d });
        refreshLists();
      };
      wl.appendChild(li);
    });

    (res.blacklist || []).forEach(d => {
      const li = document.createElement("li");
      li.textContent = d;
      li.style.cursor = "pointer";
      li.onclick = async () => {
        await chrome.runtime.sendMessage({ type: "REMOVE_BLACKLIST", domain: d });
        refreshLists();
      };
      bl.appendChild(li);
    });
  }

  const addWhitelistBtn = safeById("addWhitelist");
  const addBlacklistBtn = safeById("addBlacklist");

  if (addWhitelistBtn) {
    addWhitelistBtn.addEventListener("click", async () => {
      const input = safeById("whitelistInput");
      const domain = input?.value.trim();
      if (!domain) return;
      await chrome.runtime.sendMessage({ type: "ADD_WHITELIST", domain });
      input.value = "";
      refreshLists();
    });
  }

  if (addBlacklistBtn) {
    addBlacklistBtn.addEventListener("click", async () => {
      const input = safeById("blacklistInput");
      const domain = input?.value.trim();
      if (!domain) return;
      await chrome.runtime.sendMessage({ type: "ADD_BLACKLIST", domain });
      input.value = "";
      refreshLists();
    });
  }

  refresh();
  refreshLists();
});