try {
  const result = extractPageContent();
  document.documentElement.setAttribute("data-apogee-result", JSON.stringify(result));
} catch (e) {
  document.documentElement.setAttribute("data-apogee-result", JSON.stringify({ error: e.message || String(e) }));
}
