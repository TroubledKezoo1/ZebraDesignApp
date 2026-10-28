/* Touch: one finger edits like the mouse does, two fingers pan and pinch-zoom the label. */
(function () {
  "use strict";
  var cv = document.getElementById("cv"), wrap = document.getElementById("cwrap");
  if (!cv || !wrap) return;
  var mode = null, last = null, lastTap = { t: 0, x: 0, y: 0 }, pinch = null;

  function mouse(type, target, t) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, buttons: type === "mouseup" ? 0 : 1, clientX: t.clientX, clientY: t.clientY }));
  }
  function mid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) }; }

  cv.addEventListener("touchstart", function (e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      var t = e.touches[0], now = Date.now();
      if (now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 24) {
        mouse("mousedown", cv, t); mouse("mouseup", window, t); mouse("dblclick", cv, t); lastTap.t = 0; mode = "none"; return;
      }
      lastTap = { t: now, x: t.clientX, y: t.clientY };
      mode = "one"; last = t; mouse("mousedown", cv, t);
    } else if (e.touches.length === 2) {
      if (mode === "one" && last) mouse("mouseup", window, last);   // a second finger ends the edit
      mode = "two"; pinch = mid(e.touches[0], e.touches[1]);
    }
  }, { passive: false });

  cv.addEventListener("touchmove", function (e) {
    e.preventDefault();
    if (mode === "one" && e.touches.length === 1) {
      last = e.touches[0]; mouse("mousemove", window, last);
    } else if (mode === "two" && e.touches.length >= 2 && pinch) {
      var m = mid(e.touches[0], e.touches[1]);
      wrap.scrollLeft -= m.x - pinch.x; wrap.scrollTop -= m.y - pinch.y;
      if (pinch.d > 0 && Math.abs(m.d - pinch.d) > 6) {
        wrap.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, clientX: m.x, clientY: m.y, deltaY: m.d > pinch.d ? -1 : 1 }));
        pinch.d = m.d;
      }
      pinch.x = m.x; pinch.y = m.y;
    }
  }, { passive: false });

  function end(e) {
    e.preventDefault();
    if (mode === "one" && last) mouse("mouseup", window, last);
    if (e.touches.length === 0) { mode = null; last = null; pinch = null; }
  }
  cv.addEventListener("touchend", end, { passive: false });
  cv.addEventListener("touchcancel", end, { passive: false });
})();
