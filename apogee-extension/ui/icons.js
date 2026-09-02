// Icon sources live in assets/icons/*.svg. Vite inlines each file at build time, so the popup ships one bundle with no per-icon requests, and the markup lands in the light DOM where app.css can still style `.ico svg` and `.f`.
const FILES = import.meta.glob("../assets/icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const ICONS = Object.fromEntries(
  Object.entries(FILES).map(([path, markup]) => [
    path.slice(path.lastIndexOf("/") + 1, -".svg".length),
    markup.trim().replace("<svg", '<svg aria-hidden="true"'),
  ]),
);

function applyIcons(root = document) {
  root.querySelectorAll("[data-ico]").forEach((el) => {
    const glyph = ICONS[el.getAttribute("data-ico")];
    if (glyph) {
      el.innerHTML = glyph;
    }
  });
}

export function icon(name) {
  return `<span class="ico" aria-hidden="true">${ICONS[name] || ""}</span>`;
}

applyIcons();
