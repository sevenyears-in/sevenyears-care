/* Seven Years — customer reviews for sevenyears.in
   Usage (WordPress "Custom HTML" block):
     <div id="sy-reviews"></div>            (add data-heading="none" inside an existing reviews section)
     <script src="https://care.sevenyears.in/reviews-widget.js" defer></script>
*/
(function () {
  var API = "https://care.sevenyears.in/api/public/reviews?limit=12";
  var host = document.getElementById("sy-reviews");
  if (!host) return;
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var css =
    ":host{display:block}" +
    ".wrap{font-family:Poppins,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#161616;max-width:1180px;margin:0 auto;padding:8px 4px}" +
    ".head{text-align:center;margin:0 auto 28px;max-width:640px}" +
    ".eyebrow{font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#ff5e79;margin:0}" +
    ".title{font-size:clamp(26px,4vw,38px);line-height:1.15;font-weight:800;margin:8px 0 6px}" +
    ".sub{font-size:15px;color:rgba(22,22,22,.6);margin:0}" +
    ".avg{display:inline-flex;align-items:center;gap:8px;margin-top:14px;padding:6px 14px;border-radius:999px;background:#fff7e6;font-weight:700;font-size:14px}" +
    ".grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}" +
    ".card{position:relative;background:#fff;border-radius:24px;padding:24px 22px 20px;box-shadow:0 10px 30px -12px rgba(22,22,22,.18);border:1px solid rgba(22,22,22,.06);display:flex;flex-direction:column;overflow:hidden}" +
    ".card:before{content:'';position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,#ff5e79,#8883d7,#f39237,#0fa8bf)}" +
    ".stars{color:#f5a524;font-size:18px;letter-spacing:2px}" +
    ".stars span{color:rgba(22,22,22,.15)}" +
    ".q{font-size:15px;line-height:1.65;margin:12px 0 18px;flex:1}" +
    ".who{display:flex;align-items:center;gap:12px}" +
    ".av{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;flex-shrink:0}" +
    ".name{font-weight:700;font-size:14px;margin:0}" +
    ".meta{font-size:12px;color:rgba(22,22,22,.5);margin:2px 0 0}" +
    ".note{margin-top:14px;font-size:11px;color:rgba(22,22,22,.4)}" +
    ".more{display:block;margin:22px auto 0;padding:12px 22px;border-radius:16px;border:0;background:#161616;color:#fff;font:inherit;font-weight:700;cursor:pointer}" +
    ".empty{text-align:center;color:rgba(22,22,22,.5);padding:24px}";

  var COLOURS = ["#ff5e79", "#8883d7", "#f39237", "#0fa8bf"];
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // text only — never HTML
    return e;
  }
  function fmt(d) {
    try {
      return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    } catch (e) {
      return "";
    }
  }

  var style = document.createElement("style");
  style.textContent = css;
  root.appendChild(style);
  var wrap = el("div", "wrap");
  root.appendChild(wrap);

  // data-heading="none" when the page already has its own heading (e.g. "Parents tell the story").
  var head = el("div", "head");
  if (host.getAttribute("data-heading") !== "none") {
    head.appendChild(el("p", "eyebrow", "Little ones love it"));
    head.appendChild(el("h2", "title", "Parents tell the story"));
    head.appendChild(el("p", "sub", "Real feedback from Seven Years families."));
  }
  wrap.appendChild(head);

  fetch(API)
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      var list = (data && data.reviews) || [];
      if (!list.length) {
        wrap.appendChild(el("p", "empty", "Reviews from our families will appear here soon."));
        return;
      }
      var avg = list.reduce(function (a, r) { return a + r.rating; }, 0) / list.length;
      var badge = el("div", "avg", "★ " + avg.toFixed(1) + " from " + list.length + " recent review" + (list.length === 1 ? "" : "s"));
      head.appendChild(badge);

      var grid = el("div", "grid");
      wrap.appendChild(grid);
      var shown = 0;
      function render(n) {
        list.slice(shown, shown + n).forEach(function (r, i) {
          var card = el("article", "card");
          var stars = el("div", "stars", "★★★★★".slice(0, r.rating));
          stars.appendChild(el("span", "", "★★★★★".slice(r.rating)));
          stars.setAttribute("aria-label", r.rating + " out of 5 stars");
          card.appendChild(stars);
          card.appendChild(el("p", "q", r.summary));
          var who = el("div", "who");
          var av = el("div", "av", (r.name || "S").trim().charAt(0).toUpperCase());
          av.style.background = COLOURS[(shown + i) % COLOURS.length];
          who.appendChild(av);
          var info = el("div");
          info.appendChild(el("p", "name", r.name));
          info.appendChild(el("p", "meta", [r.store ? "Seven Years " + r.store : "Seven Years", fmt(r.date)].filter(Boolean).join(" · ")));
          who.appendChild(info);
          card.appendChild(who);
          card.appendChild(el("p", "note", "Summary generated from customer feedback"));
          grid.appendChild(card);
        });
        shown = Math.min(list.length, shown + n);
      }
      render(6);
      if (list.length > 6) {
        var more = el("button", "more", "Show more reviews");
        more.addEventListener("click", function () {
          render(6);
          if (shown >= list.length) more.remove();
        });
        wrap.appendChild(more);
      }
    })
    .catch(function () {
      wrap.appendChild(el("p", "empty", "Reviews could not be loaded right now."));
    });
})();
