import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const fixturesDir = join(here, "..", "fixtures");

function readFixture(name) {
  return readFileSync(join(fixturesDir, name), "utf8");
}

export function readJsonFixture(name) {
  return JSON.parse(readFixture(name));
}

function refuseNetwork(what, option) {
  return () => {
    const error = new Error(
      `This extractor called ${what}, but the test didn't stub it. ` +
        `Pass \`${option}\` to loadExtractors() with a fake response.`,
    );
    setImmediate(() => {
      throw error;
    });
    throw error;
  };
}

export function loadExtractors({
  files,
  url,
  fixture,
  html,
  fetch: fetchStub,
  chrome: chromeStub,
}) {
  if (!files?.length) throw new Error("loadExtractors needs at least one file");
  if (!url) throw new Error("loadExtractors needs a url");
  if (!fixture && html === undefined) {
    throw new Error("loadExtractors needs either `fixture` or `html`");
  }

  const source = fixture ? readFixture(fixture) : html;
  const { window, document } = parseHTML(source);

  const location = new URL(url);
  for (const target of [window, document]) {
    try {
      Object.defineProperty(target, "location", {
        value: location,
        configurable: true,
      });
    } catch {
      // intent: some environments don't allow redefining location, ignore
    }
  }

  const sandbox = {
    window,
    document,
    location,
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    NodeFilter: window.NodeFilter,
    getComputedStyle: window.getComputedStyle?.bind(window),
    fetch: fetchStub || refuseNetwork("fetch()", "fetch"),
    chrome: chromeStub || {
      runtime: {
        sendMessage: refuseNetwork("chrome.runtime.sendMessage()", "chrome"),
      },
    },
    DOMParser: window.DOMParser,
    navigator: window.navigator || { language: "en" },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  for (const file of files) {
    const path = join(contentDir, file);
    vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  }

  return context;
}
