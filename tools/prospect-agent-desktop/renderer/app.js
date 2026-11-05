/* Binds the view-model (model.js) to the page. Every value is written with textContent: nothing from the app is ever parsed as HTML. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var api = window.agent;
  var model = window.AgentModel;
  var lastView = null;
  var copyTimer = null;

  function setText(id, text) { var el = $(id); if (el && el.textContent !== (text || "")) el.textContent = text || ""; }
  function setTone(id, tone) { var el = $(id); if (el) el.setAttribute("data-tone", tone || "idle"); }
  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
  function bar(id, percent) {
    var el = $(id);
    if (!el) return;
    var fill = el.firstElementChild;
    if (percent === null || percent === undefined) { el.classList.add("indeterminate"); fill.style.width = ""; }
    else { el.classList.remove("indeterminate"); fill.style.width = Math.max(0, Math.min(100, percent)) + "%"; }
  }
  function button(id, b) { var el = $(id); el.textContent = b.label; el.disabled = !!b.disabled; }

  function render(view) {
    lastView = view;
    var m = model.describe(view, Date.now());
    $("pill").setAttribute("data-level", m.level);
    setText("pill-text", m.headline);
    setText("version", "v" + view.snapshot.agentVersion);
    setText("detail", m.detail);
    show("setup", m.setupRequired);

    setText("crm-text", m.crm.text); setTone("crm-text", m.crm.tone); setText("crm-sub", m.crm.sub);
    setText("codex-text", m.codex.text); setTone("codex-text", m.codex.tone); setText("codex-sub", m.codex.sub);
    show("btn-codex-login", m.codex.login);
    setText("data-title", m.data.title); setTone("data-title", m.data.tone);
    setText("data-l1", m.data.lines[0]); setText("data-l2", m.data.lines[1]); setText("data-health", m.data.health);
    setText("worker-text", m.worker.text); setTone("worker-text", m.worker.tone); setText("worker-error", m.worker.error);

    show("active", !!m.active);
    if (m.active) {
      setText("active-title", m.active.title); setText("active-stage", m.active.stage); setText("active-progress", m.active.progressText);
      show("active-bar", m.active.percent !== null); if (m.active.percent !== null) bar("active-bar", m.active.percent);
    }

    button("btn-start", m.buttons.start); button("btn-stop", m.buttons.stop); button("btn-test", m.buttons.test); button("btn-update", m.buttons.update);
    var t = $("test-result");
    t.hidden = !m.test;
    if (m.test) { t.textContent = m.test.text; t.className = "result " + m.test.tone; }
    show("update", m.update.visible);
    if (m.update.visible) { setText("update-label", m.update.label); setText("update-detail", m.update.detail); bar("update-bar", m.update.percent); }
    var note = $("update-note");
    note.hidden = !m.updateNote;
    if (m.updateNote) note.textContent = m.updateNote;

    $("chk-app").checked = m.settings.startAppWithWindows;
    $("chk-app").disabled = !m.settings.autostartAvailable;
    $("chk-agent").checked = m.settings.startAgentAutomatically;
    show("autostart-note", !!m.settings.autostartNote); setText("autostart-note", m.settings.autostartNote);
    setText("diag-text", view.diagnostics);
  }

  function refresh() { return api.getView().then(render); }

  $("btn-start").addEventListener("click", function () { api.start().then(refresh); });
  $("btn-stop").addEventListener("click", function () {
    api.stop(false).then(function (r) { if (r && r.ok === false && r.reason === "run_active") $("modal").hidden = false; else refresh(); });
  });
  $("modal-cancel").addEventListener("click", function () { $("modal").hidden = true; });
  $("modal-stop").addEventListener("click", function () { $("modal").hidden = true; api.stop(true).then(refresh); });
  $("btn-test").addEventListener("click", function () { api.testCodex().then(refresh); });
  $("btn-update").addEventListener("click", function () { api.updateData(false).then(refresh); });
  $("btn-codex-login").addEventListener("click", function () { api.openCodexLogin(); });
  $("btn-open-crm").addEventListener("click", function () { api.openCrm("prospecting"); });
  $("btn-open-crm-active").addEventListener("click", function () { api.openCrm("prospecting"); });
  $("btn-crm-settings").addEventListener("click", function () { api.openCrm("settings"); });
  $("chk-app").addEventListener("change", function (e) { api.setSetting("startAppWithWindows", e.target.checked); });
  $("chk-agent").addEventListener("change", function (e) { api.setSetting("startAgentAutomatically", e.target.checked); });
  $("btn-logs").addEventListener("click", function () { api.openLogs(); });
  $("btn-copy").addEventListener("click", function () {
    api.copyDiagnostics().then(function () {
      show("copy-note", true);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { show("copy-note", false); }, 3000);
    });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { if (!$("modal").hidden) $("modal").hidden = true; else api.hide(); } });

  api.onView(render);
  refresh();
  // "Last heartbeat 12 s ago" moves on its own between state changes.
  setInterval(function () { if (lastView) render(lastView); }, 5000);
})();
