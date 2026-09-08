// Tiny CDP (Chrome DevTools Protocol) client using Node's built-in WebSocket.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connectCdp(port, timeoutMs = 20000) {
  const t0 = Date.now();
  let targets = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(3000),
      });
      targets = await res.json();
      if (targets.length) break;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  if (!targets || !targets.length) throw new Error(`CDP not reachable on :${port}`);
  // Prefer the main page target (our BrowserWindow), not devtools.
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
  if (!page) throw new Error("no page target: " + JSON.stringify(targets.map((t) => t.type + ":" + t.url)));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error("ws error"));
    }),
    sleep(timeoutMs).then(() => {
      throw new Error("ws open timeout");
    }),
  ]);

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };

  const send = (method, params = {}, timeoutMs2 = 15000) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs2}ms`));
      }, timeoutMs2);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable", {}, 5000).catch(() => {});

  /** Evaluate an expression in the page; returns the JSON value. */
  const evaluate = async (expression, { awaitPromise = true } = {}) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails, null, 1).slice(0, 600));
    }
    return r.result?.value;
  };

  return {
    send,
    evaluate,
    close: () => ws.close(),
    /** Poll an evaluator until truthy. */
    waitFor: async (label, evalExpr, timeoutMs = 8000) => {
      const t0 = Date.now();
      let last = null;
      while (Date.now() - t0 < timeoutMs) {
        try {
          last = await evaluate(evalExpr);
          if (last) return last;
        } catch (e) {
          last = e.message;
        }
        await sleep(120);
      }
      throw new Error(`waitFor('${label}') timeout; last=${JSON.stringify(last)?.slice(0, 300)}`);
    },
    screenshot: async (outFile) => {
      const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(outFile, Buffer.from(r.data, "base64"));
      return outFile;
    },
  };
}
