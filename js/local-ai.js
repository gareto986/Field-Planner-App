// Free, built-in AI: an open-weight model that runs entirely in the browser on
// the user's GPU via WebLLM (WebGPU). No key, no account, nothing leaves the
// machine. The model downloads once on first use and is cached by the browser.

const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
// Context window: 8K fits the full trip brief. If the GPU runs out of memory we
// drop to a 4K "low-memory mode" (smaller brief/answers) for the rest of the session.
let lowMemory = false;
const contextTokens = () => (lowMemory ? 4096 : 8192);
const maxAnswerTokens = () => (lowMemory ? 1024 : 2048);
export const isLowMemory = () => lowMemory;

export const LOCAL_MODELS = [
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 3B', size: '≈2 GB download', vram: '≈2.5 GB GPU memory', note: 'Recommended: good balance of quality and speed' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', size: '≈2 GB download', vram: '≈2.3 GB GPU memory', note: 'Alternative with a similar footprint' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B', size: '≈1 GB download', vram: '≈1.6 GB GPU memory', note: 'Lightweight, for older laptops; simpler answers' },
  { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 7B', size: '≈4.5 GB download', vram: '≈5 GB GPU memory', note: 'Best answers; needs a strong GPU' },
];
export const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0].id;

export const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator;

// Some browsers expose the WebGPU API but have no usable GPU adapter
// (old drivers, blocklisted GPUs, remote desktops). Ask for a real adapter once.
let gpuCheck = null;
export function gpuStatus() {
  gpuCheck ||= (async () => {
    if (!hasWebGPU()) return { ok: false, message: 'This browser does not support WebGPU, which the built-in AI needs. Use a recent Chrome or Edge, or connect a cloud AI in Settings.' };
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return { ok: true, message: 'This browser and computer support the built-in AI (WebGPU).' };
    } catch { /* fall through */ }
    return { ok: false, message: 'WebGPU is available but no compatible graphics adapter was found (often old GPU drivers or a remote desktop). Try updating your graphics drivers, or connect a cloud AI in Settings.' };
  })();
  return gpuCheck;
}

let lib = null;
let engine = null;
let engineModel = null;
let loading = null;
let progressListener = null;

export const onLocalProgress = fn => { progressListener = fn; };
export const loadedModel = () => engineModel;

async function webllm() {
  lib ||= await import(WEBLLM_URL);
  return lib;
}

export async function isModelCached(model) {
  try { return await (await webllm()).hasModelInCache(model); } catch { return false; }
}

/** Download (first time) and load the model onto the GPU. */
export async function loadLocalModel(model) {
  if (engine && engineModel === model) return engine;
  const gpu = await gpuStatus();
  if (!gpu.ok) throw new Error(gpu.message);
  if (loading) await loading.catch(() => {});
  if (engine && engineModel === model) return engine;
  loading = (async () => {
    const w = await webllm();
    const chatOpts = { context_window_size: contextTokens() };
    const report = r => progressListener?.(r);
    engineModel = null; // nothing is reliably loaded until reload() finishes
    try {
      if (engine) await engine.reload(model, chatOpts);
      else engine = await w.CreateMLCEngine(model, { initProgressCallback: report }, chatOpts);
    } catch (e) {
      // A failed (re)load can leave the engine empty; start fresh next time.
      try { await engine?.unload(); } catch { /* ignore */ }
      engine = null;
      throw friendly(e);
    }
    engineModel = model;
    report({ progress: 1, text: 'Model ready' });
    return engine;
  })();
  try { return await loading; } finally { loading = null; }
}

// WebLLM silently unloads the model when the GPU "device is lost" (out of GPU
// memory, driver reset, laptop sleep). Those surface later as these errors.
const lostModel = e => /ModelNotLoaded|Model not loaded|device (was )?lost|DeviceLost|GPUDevice|out of memory|OOM/i.test(`${e?.name} ${e?.message}`);

function friendly(e) {
  if (!lostModel(e)) return e;
  return new Error('The built-in AI ran out of graphics memory (or the GPU reset). Close other heavy tabs/apps and try again, or pick a smaller model (Qwen 2.5 1.5B) in Settings → AI.');
}

async function forgetEngine() {
  try { await engine?.unload(); } catch { /* ignore */ }
  engine = null; engineModel = null;
}

/** Chat with the local model. Keeps the first message (trip brief) plus the latest turns to fit the context window. */
export async function localChat(model, system, messages) {
  const run = async () => {
    const eng = await loadLocalModel(model);
    const keep = lowMemory ? 2 : 3;
    const trimmed = messages.length > keep + 1 ? [messages[0], ...messages.slice(-keep)] : messages;
    const res = await eng.chat.completions.create({
      messages: [{ role: 'system', content: system }, ...trimmed],
      max_tokens: maxAnswerTokens(),
      temperature: 0.4,
    });
    const text = res.choices?.[0]?.message?.content || '(empty response)';
    return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  };
  try {
    return await run();
  } catch (e) {
    if (!lostModel(e)) throw e;
    // The model was dropped from the GPU: reload it (in low-memory mode) and try once more.
    lowMemory = true;
    await forgetEngine();
    progressListener?.({ progress: 0, text: 'Reloading the built-in AI in low-memory mode…' });
    try { return await run(); } catch (e2) { await forgetEngine(); throw friendly(e2); }
  }
}
