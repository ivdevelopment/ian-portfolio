/* Pure view-model for the status window: turns the app's state into the words, tones and button states shown. No DOM access here, so it is
 * unit-tested in Node. Loaded as a classic script in the window (window.AgentModel) and required directly by the tests. */
(function (root) {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function formatDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  function formatCount(n) {
    return Number(n).toLocaleString("en");
  }

  function ago(ms, now) {
    if (!ms) return null;
    var s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 5) return "just now";
    if (s < 60) return s + " s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    return Math.round(m / 60) + " h ago";
  }

  function describeCrm(s, now) {
    var c = s.crm;
    if (s.worker === "stopped" || s.worker === "error") {
      if (c.state === "rejected") return { text: "Rejected", sub: "Connect this device again from CRM Settings.", tone: "bad" };
      return { text: "Not connected", sub: "The agent is stopped.", tone: "idle" };
    }
    if (c.state === "connected") return { text: "Connected", sub: c.lastHeartbeat ? "Last heartbeat " + ago(c.lastHeartbeat, now) : null, tone: "ok" };
    if (c.state === "offline") return { text: "Offline", sub: "Retrying…", tone: "warn" };
    if (c.state === "rejected") return { text: "Rejected", sub: "Connect this device again from CRM Settings.", tone: "bad" };
    return { text: "Connecting…", sub: null, tone: "warn" };
  }

  function describeCodex(s) {
    var c = s.codex;
    switch (c.state) {
      case "ready":
        return { text: "Ready" + (c.version ? " · " + c.version : ""), sub: null, tone: "ok", login: false };
      case "not_authenticated":
        return { text: "Sign-in required", sub: "Sign in with ChatGPT in Codex.", tone: "warn", login: true };
      case "not_installed":
        return { text: "Not installed", sub: "Install the Codex CLI, then sign in.", tone: "bad", login: false };
      case "usage_limit":
        return { text: "Usage limit reached", sub: "Try again when your ChatGPT allowance resets.", tone: "warn", login: false };
      case "error":
        return { text: "Not ready", sub: c.note || null, tone: "bad", login: false };
      default:
        return { text: "Not checked yet", sub: null, tone: "idle", login: false };
    }
  }

  function describeData(s) {
    var d = s.businessData;
    if (!d.ready) return { title: "Not installed", lines: ["Download the Belgium business data to enable searches."], health: "Index health: missing", tone: "bad", installed: false };
    var lines = ["Updated: " + (formatDate(d.dataDate) || "date unknown"), formatCount(d.businesses) + " businesses"];
    var health = d.health === "ok" ? "OK" : d.health === "aging" ? "Getting old" : d.health === "stale" ? "Stale" : "Missing";
    return { title: "Belgium OSM", lines: lines, health: "Index health: " + health, tone: d.health === "ok" ? "ok" : "warn", installed: true };
  }

  function describeWorker(s) {
    var map = { stopped: ["Stopped", "idle"], starting: ["Starting…", "warn"], running: ["Running", "ok"], stopping: ["Stopping…", "warn"], error: ["Error", "bad"] };
    var m = map[s.worker] || map.stopped;
    var error = s.worker === "error" || (s.lastError && s.worker !== "running") ? (s.lastError && s.lastError.message) || null : null;
    return { text: m[0], tone: m[1], error: error };
  }

  function describeActive(s) {
    var a = s.activeRun;
    if (!a) return null;
    var progress = a.total ? a.done + " / " + a.total : null;
    return { title: a.location ? a.modeLabel + " · " + a.location : a.modeLabel, stage: a.stage, progressText: progress, percent: a.total ? Math.round((a.done / a.total) * 100) : null };
  }

  function describeTest(s) {
    var t = s.tasks.codexTest;
    if (t.state === "running") return { text: "Testing…", tone: "warn" };
    var r = t.result;
    if (!r) return null;
    switch (r.state) {
      case "ready":
        return { text: "Codex ready" + (r.version ? " · " + r.version : "") + (r.ms ? " (" + (r.ms / 1000).toFixed(1) + " s)" : ""), tone: "ok" };
      case "sign_in_required":
        return { text: "Codex sign-in required", tone: "warn" };
      case "not_installed":
        return { text: "Codex not installed", tone: "bad" };
      case "usage_limit":
        return { text: "Usage limit reached", tone: "warn" };
      default:
        return { text: "Test failed", tone: "bad" };
    }
  }

  function describeUpdate(s) {
    var u = s.tasks.businessUpdate;
    if (u.state !== "running") return { visible: false, label: u.label || "", percent: null, detail: null };
    var detail = null;
    if (u.stage === "downloading" && u.bytes !== null) detail = Math.round(u.bytes / 1e6) + " MB" + (u.total ? " of " + Math.round(u.total / 1e6) + " MB" : "");
    return { visible: true, label: u.label, percent: u.percent, detail: detail };
  }

  function describe(view, now) {
    now = now || Date.now();
    var s = view.snapshot;
    var o = view.overall;
    var busy = s.worker === "starting" || s.worker === "stopping";
    var startable = (s.worker === "stopped" || s.worker === "error") && s.setup.configured;
    var update = describeUpdate(s);
    var updateFailed = !update.visible && s.tasks.businessUpdate.label === "Update failed";
    return {
      level: o.level,
      headline: o.label,
      detail: o.detail,
      setupRequired: !s.setup.configured && (s.worker === "stopped" || s.worker === "error"),
      crm: describeCrm(s, now),
      codex: describeCodex(s),
      data: describeData(s),
      worker: describeWorker(s),
      active: describeActive(s),
      test: describeTest(s),
      update: update,
      updateNote: updateFailed ? "Business source update failed" : null,
      buttons: {
        start: { label: s.worker === "starting" ? "Starting…" : "Start Agent", disabled: !startable },
        stop: { label: s.worker === "stopping" ? "Stopping…" : "Stop Agent", disabled: s.worker !== "running" },
        test: { label: s.tasks.codexTest.state === "running" ? "Testing…" : "Test Codex", disabled: s.tasks.codexTest.state === "running" || busy },
        update: { label: update.visible ? "Updating…" : "Update business data", disabled: update.visible || !!s.activeRun },
      },
      settings: {
        startAppWithWindows: !!view.settings.startAppWithWindows,
        startAgentAutomatically: !!view.settings.startAgentAutomatically,
        autostartAvailable: !!view.autostartAvailable,
        autostartNote: view.autostartAvailable ? null : "Available in the installed app.",
      },
    };
  }

  var api = { describe: describe, formatDate: formatDate, formatCount: formatCount, ago: ago };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AgentModel = api;
})(typeof window !== "undefined" ? window : this);
