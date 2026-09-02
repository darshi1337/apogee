import { cleanText } from "./cleaner.js";
import { getMaxChunkChars, getMaxChunks } from "../engines/modelLimits.js";
import { streamInTargetLanguage } from "../language/languageOutput.js";

const OOM_PATTERN =
  /out of memory|oom|buffer allocation|gpubuffer|allocation failed|memory limit/i;

function isOomError(err) {
  return OOM_PATTERN.test(err?.message || "");
}

// For a long input that exceeds the model's chunk budget, the previous
// pipeline silently dropped chunks via stratified sampling. Now we keep
// full coverage: map every chunk to a partial, then tree-fold the
// partials in groups of `fanIn` until fewer than `maxChunks`
// intermediates remain, then run the final reduce. Each group emits
// its own streamed partial, so the consumer can interleave or buffer.
function pickFanIn(partialCount, maxChunks) {
  // Caller guarantees partialCount > maxChunks (while guard in reduceTree),
  // so no need for the <= branch.
  return Math.max(2, Math.ceil(partialCount / maxChunks));
}

function choosePartialChunks(chunks, maxChunks, selectChunksFn, onProgress) {
  if (chunks.length <= maxChunks) return chunks;
  if (selectChunksFn) {
    try {
      const selected = selectChunksFn(chunks, maxChunks);
      if (Array.isArray(selected) && selected.length) {
        if (selected.length < chunks.length) {
          onProgress?.({
            stage: "truncated",
            kept: selected.length,
            total: chunks.length,
          });
        }
        return selected;
      }
    } catch {
      // Fall through to the default.
    }
  }
  // No selector (or it failed): keep every chunk and rely on the
  // tree-reduce stage to fold the surplus. The point of issue #148 is
  // exactly that "drop material you don't have time to map" is the
  // wrong default.
  return chunks;
}

async function* streamReduceStep(chatStreamFn, host, model, partials, opts) {
  const { signal, buildReduce, depth, onProgress, index, total } = opts;
  if (signal?.aborted) return "";
  onProgress?.({ stage: "reduce", depth, index, total });
  let out = "";
  try {
    for await (const token of chatStreamFn(host, model, buildReduce(partials), {
      signal,
    })) {
      if (signal?.aborted) return out;
      yield token;
      out += token;
    }
  } catch (err) {
    if (signal?.aborted || isOomError(err)) {
      // OOM mid-reduce: signal the caller and stop the tree. The
      // outer driver will fall back to a final reduce with whatever
      // partials we have accumulated.
      if (isOomError(err)) {
        opts.onOom?.(err);
      }
      return out;
    }
    throw err;
  }
  return out;
}

async function collectStream(generator) {
  let out = "";
  for await (const token of generator) {
    out += token;
  }
  return out;
}

async function reduceTree({
  partials,
  maxChunks,
  host,
  model,
  signal,
  buildReduce,
  chatStreamFn,
  onProgress,
  onOom,
}) {
  // Tree-reduce partials in groups of `fanIn` until fewer than
  // `maxChunks` remain. Each round is one model call per group; the
  // final round is also a model call but produces the streamed
  // output the caller ultimately sees.
  //
  // An OOM during the tree is treated the same way as an OOM during
  // the map stage: bail out and use whatever partials we have
  // already produced (plus any still-unmerged groups) so the caller
  // still gets a streamed final reduce instead of nothing.
  let current = partials;
  let depth = 1;
  let hitOom = false;
  while (current.length > maxChunks) {
    if (signal?.aborted) return current;
    const fanIn = pickFanIn(current.length, maxChunks);
    const next = [];
    const total = Math.ceil(current.length / fanIn);
    for (let i = 0; i < current.length; i += fanIn) {
      if (signal?.aborted || hitOom) {
        return [...next, ...current.slice(i)];
      }
      const group = current.slice(i, i + fanIn);
      const stepOpts = {
        signal,
        buildReduce,
        depth,
        onProgress,
        index: Math.floor(i / fanIn),
        total,
        onOom: (err) => {
          hitOom = true;
          onOom?.(err);
        },
      };
      let merged;
      try {
        merged = await collectStream(
          streamReduceStep(chatStreamFn, host, model, group, stepOpts),
        );
      } catch (err) {
        if (isOomError(err)) {
          stepOpts.onOom(err);
          return [...next, ...current.slice(i)];
        }
        throw err;
      }
      // OOM signaled via onOom inside streamReduceStep does not throw;
      // treat it as failure of this group and preserve its originals.
      if (hitOom) {
        return [...next, ...current.slice(i)];
      }
      const trimmed = merged.trim();
      if (trimmed) next.push(trimmed);
    }
    if (next.length === 0) return current;
    current = next;
    depth += 1;
  }
  return current;
}

export async function* mapReduceStream(
  { text, model, host, signal, language },
  {
    chunkTextFn,
    chatStreamFn,
    onProgress,
    detectLanguageFn,
    translateFn,
    selectChunksFn,
  },
  { buildSingle, buildMap, buildReduce },
) {
  const cleaned = cleanText(text);
  let chunks = chunkTextFn(cleaned, getMaxChunkChars(model));

  const maxChunks = getMaxChunks(model);
  if (chunks.length > maxChunks) {
    chunks = choosePartialChunks(chunks, maxChunks, selectChunksFn, onProgress);
  }
  if (signal?.aborted) return;

  const chat = (prompt, opts) => chatStreamFn(host, model, prompt, opts);
  const streamFinal = (finalPrompt) =>
    streamInTargetLanguage(chat, finalPrompt, language, {
      signal,
      detectLanguageFn,
      translateFn,
      onFallback: () => onProgress?.({ stage: "translate" }),
    });

  if (chunks.length <= 1) {
    if (signal?.aborted) return;
    yield* streamFinal(buildSingle(chunks[0] || ""));
    return;
  }

  const partials = [];
  let hitOom = false;
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) return;
    onProgress?.({ stage: "map", index: i, total: chunks.length });
    let partial = "";
    try {
      for await (const token of chatStreamFn(
        host,
        model,
        buildMap(chunks[i], i, chunks.length),
        { signal },
      )) {
        if (signal?.aborted) return;
        partial += token;
      }
      if (partial.trim()) {
        partials.push(partial.trim());
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (isOomError(err)) {
        hitOom = true;
        onProgress?.({ stage: "oom_fallback", index: i });
        break;
      }
      throw err;
    }
  }

  if (signal?.aborted) return;
  if (partials.length === 0) return;

  let intermediates = partials;
  if (!hitOom && intermediates.length > maxChunks) {
    intermediates = await reduceTree({
      partials: intermediates,
      maxChunks,
      host,
      model,
      signal,
      buildReduce,
      chatStreamFn,
      onProgress,
      onOom: (_err) => {
        hitOom = true;
        onProgress?.({ stage: "oom_fallback", index: -1 });
      },
    });
  }

  if (signal?.aborted) return;
  if (intermediates.length === 0) return;
  onProgress?.({ stage: "reduce" });
  try {
    yield* streamFinal(buildReduce(intermediates));
  } catch (err) {
    if (isOomError(err)) {
      onProgress?.({ stage: "oom_fallback", index: -1 });
      // Final reduce OOM means even the folded intermediates are too large
      // (e.g. tree was aborted mid-way and intermediates > maxChunks).
      // Fall back to streaming the concatenated partials without a model
      // call so the user still gets coverage of every chunk.
      for (const p of intermediates) {
        if (signal?.aborted) return;
        yield p + "\n\n";
      }
      return;
    }
    throw err;
  }
}
