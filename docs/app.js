(function () {
  "use strict";

  function initReveal() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-split]"), function (el) {
      var nodes = Array.prototype.slice.call(el.childNodes);
      el.textContent = "";
      var i = 0;
      nodes.forEach(function (node) {
        if (node.nodeType === 1 && node.tagName === "BR") {
          el.appendChild(document.createElement("br"));
          return;
        }
        node.textContent.split(/(\s+)/).forEach(function (t) {
          if (t === "") return;
          if (/^\s+$/.test(t)) { el.appendChild(document.createTextNode(t)); return; }
          var s = document.createElement("span");
          s.className = "w";
          s.style.setProperty("--wi", i++);
          s.textContent = t;
          el.appendChild(s);
        });
      });
    });

    var targets = document.querySelectorAll(".reveal, [data-split]");
    if (!("IntersectionObserver" in window)) {
      Array.prototype.forEach.call(targets, function (t) { t.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    Array.prototype.forEach.call(targets, function (t) { io.observe(t); });
  }

  function ready() {
    initReveal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
