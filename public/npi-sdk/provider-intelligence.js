/* Provider Intelligence — embed loader (PROOF OF CONCEPT, not a production SDK)
 *
 *   <script src="https://<pi-host>/npi-sdk/provider-intelligence.js"></script>
 *   const session = ProviderIntelligence.open({
 *     referralType: "ENT",                                   // chosen by the clinician
 *     patientContext: { ref: "DEMO-PT-0001", age: 46 },      // synthetic id (+ age for the pediatric-fit rule)
 *     clinicContext: { id: "DEMO-CLINIC-001", searchOrigin: "Seattle, WA 98115" },
 *     onEvent: (type, detail) => { if (type === "destination:selected") ... },
 *   });
 *   session.close();
 *
 * Boundary:
 *   - The Provider Intelligence UI runs in its own document (a sandboxed iframe),
 *     so its CSS/JS never touch the host page. The loader's own chrome lives in a
 *     shadow root for the same reason.
 *   - Context goes over postMessage after a ready handshake — never in the URL.
 *   - Every message is checked for the expected window AND origin.
 *   - Events out: "ready", "destination:selected" { destination }, "close".
 * POC caveat: here the host and the UI are served from the same origin; a real
 * deployment would put the UI on its own origin so the sandbox also isolates storage.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var PI_ORIGIN = script ? new URL(script.src, location.href).origin : location.origin;
  var PI_PATH = "/npi-list/embed/provider-intelligence";
  var PROTOCOL = "pi-embed/1";

  function open(opts) {
    opts = opts || {};
    var onEvent = typeof opts.onEvent === "function" ? opts.onEvent : function () {};
    var host = document.createElement("div");
    host.setAttribute("data-provider-intelligence", "");
    var root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      "<style>" +
      ":host{all:initial}" +
      ".bd{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.45);display:flex;align-items:stretch;justify-content:flex-end}" +
      ".panel{width:min(1080px,100vw);height:100%;background:#fff;display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(0,0,0,.2)}" +
      ".bar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #e5e7eb;font:500 12px/1.4 system-ui,sans-serif;color:#475569;background:#f8fafc}" +
      ".bar b{color:#0f172a}.sp{flex:1}.x{all:unset;cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a}" +
      "iframe{flex:1;border:0;width:100%}" +
      "</style>" +
      '<div class="bd"><div class="panel" role="dialog" aria-label="Provider Intelligence">' +
      '<div class="bar"><b>Provider Intelligence</b><span>embedded service · isolated frame · postMessage boundary</span><span class="sp"></span><button class="x" type="button">Close</button></div>' +
      "</div></div>";
    var panel = root.querySelector(".panel");
    var frame = document.createElement("iframe");
    frame.title = "Provider Intelligence";
    // No top navigation, no forms-to-host, no modals; popups only for evidence links.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.src = PI_ORIGIN + PI_PATH; // no query string: context is sent by postMessage
    panel.appendChild(frame);

    var closed = false;
    function emit(type, detail) { try { onEvent(type, detail); } catch (e) { setTimeout(function () { throw e; }); } }
    function onMessage(ev) {
      if (ev.source !== frame.contentWindow || ev.origin !== PI_ORIGIN) return;
      var m = ev.data;
      if (!m || m.protocol !== PROTOCOL || typeof m.type !== "string") return;
      if (m.type === "ready") {
        frame.contentWindow.postMessage({ protocol: PROTOCOL, type: "init", referralType: String(opts.referralType || ""), patientContext: opts.patientContext || null, clinicContext: opts.clinicContext || null }, PI_ORIGIN);
        emit("ready", null);
      } else if (m.type === "destination:selected") {
        emit("destination:selected", { destination: m.destination });
        close();
      } else if (m.type === "close") {
        close();
      }
    }
    function close() {
      if (closed) return;
      closed = true;
      window.removeEventListener("message", onMessage);
      host.remove();
      emit("close", null);
    }
    root.querySelector(".x").addEventListener("click", close);
    window.addEventListener("message", onMessage);
    document.body.appendChild(host);
    return { close: close };
  }

  window.ProviderIntelligence = { version: "0.1.0-poc", open: open };
})();
