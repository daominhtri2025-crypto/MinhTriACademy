"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { Accordion } from "@/components/Accordion";
import { starters } from "@/lib/data";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-slate-900 text-sm text-slate-400">Đang tải editor…</div>,
});

type Lang = keyof typeof starters;
type Tab = "output" | "input" | "tests";
type Verdict = { stdin: string; expected: string; actual: string; pass: boolean };

const PYODIDE_VERSION = "0.26.4";
const TESTS = [{ stdin: "10", expected: "30" }, { stdin: "7", expected: "12" }, { stdin: "1", expected: "0" }];

/* ───────── Pyodide loader (chạy Python THẬT trên trình duyệt) ───────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyPromise: Promise<any> | null = null;
function loadPy() {
  if (pyPromise) return pyPromise;
  pyPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
    s.onload = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolve(await (window as any).loadPyodide({ indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/` }));
      } catch (e) { pyPromise = null; reject(e); }
    };
    s.onerror = () => { pyPromise = null; reject(new Error("Không tải được Pyodide (kiểm tra kết nối / CSP).")); };
    document.head.appendChild(s);
  });
  return pyPromise;
}

async function runPython(code: string, stdin: string) {
  const py = await loadPy();
  const out: string[] = [];
  const err: string[] = [];
  const lines = stdin.split("\n");
  py.setStdin({ stdin: () => (lines.length ? lines.shift() : undefined) });
  py.setStdout({ batched: (s: string) => out.push(s) });
  py.setStderr({ batched: (s: string) => err.push(s) });
  try { await py.runPythonAsync(code); }
  catch (e) { err.push(String((e as Error).message).split("\n").slice(-4).join("\n")); }
  return { stdout: out.join("\n"), stderr: err.join("\n") };
}

/* ───────── Scratch: mô phỏng đơn giản (repeat / move / turn) ───────── */
function simulateScratch(src: string) {
  const pts: [number, number][] = [[0, 0]];
  let x = 0, y = 0, dir = 90;
  const lines = src.split("\n").map((l) => l.trim());
  const step = (l: string) => {
    const mv = l.match(/^move\s+(-?\d+)\s+steps/i); const tn = l.match(/^turn\s+(-?\d+)\s+degrees/i);
    if (mv) { const d = +mv[1]; x += d * Math.sin((dir * Math.PI) / 180); y += d * Math.cos((dir * Math.PI) / 180); pts.push([x, y]); }
    if (tn) dir += +tn[1];
  };
  for (let i = 0; i < lines.length; i++) {
    const r = lines[i].match(/^repeat\s+(\d+)/i);
    if (r) {
      const body: string[] = []; let j = i + 1;
      while (j < lines.length && !/^end$/i.test(lines[j])) body.push(lines[j++]);
      for (let k = 0; k < Math.min(+r[1], 360); k++) body.forEach(step);
      i = j;
    } else step(lines[i]);
  }
  const say = src.match(/say\s+"([^"]*)"/i)?.[1];
  return { pts, say };
}

function ScratchStage({ code }: { code: string }) {
  const { pts, say } = useMemo(() => simulateScratch(code), [code]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs) - 10, maxX = Math.max(...xs) + 10, minY = Math.min(...ys) - 10, maxY = Math.max(...ys) + 10;
  const size = Math.max(maxX - minX, maxY - minY, 60);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${-p[1]}`).join(" ");
  return (
    <div className="grid h-full place-items-center bg-white p-3">
      <svg viewBox={`${minX} ${-maxY} ${size} ${size}`} className="h-full max-h-64 w-full max-w-64 rounded-xl border border-slate-200 bg-slate-50">
        <path d={path} fill="none" stroke="#1f8b3f" strokeWidth={size / 60} />
        <text x={pts.at(-1)![0]} y={-pts.at(-1)![1] - 4} fontSize={size / 10} textAnchor="middle">🐱</text>
        {say && <text x={(minX + maxX) / 2} y={-maxY + size / 8} fontSize={size / 14} textAnchor="middle" fill="#334155">💬 {say}</text>}
      </svg>
    </div>
  );
}

export default function IdePage() {
  const [lang, setLang] = useState<Lang>("python");
  const [codes, setCodes] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(starters).map(([k, v]) => [k, v.code])));
  const [tab, setTab] = useState<Tab>("output");
  const [stdin, setStdin] = useState("10");
  const [output, setOutput] = useState<{ text: string; error?: boolean; note?: string } | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[] | null>(null);
  const [busy, setBusy] = useState<"run" | "test" | null>(null);
  const [py, setPy] = useState<"idle" | "loading" | "ready">("idle");
  const busyRef = useRef(false);

  const code = codes[lang];

  const guard = useCallback(async (kind: "run" | "test", fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(kind);
    try { await fn(); } finally { busyRef.current = false; setBusy(null); }
  }, []);

  const ensurePy = async () => { if (py !== "ready") { setPy("loading"); await loadPy(); setPy("ready"); } };

  const run = () => guard("run", async () => {
    setTab("output"); setOutput(null);
    if (lang === "python") {
      try { await ensurePy(); } catch (e) { setOutput({ text: (e as Error).message, error: true }); setPy("idle"); return; }
      const r = await runPython(code, stdin);
      setOutput({ text: r.stderr || r.stdout || "(không có output)", error: !!r.stderr });
    } else if (lang === "scratch") {
      setOutput({ text: "Đã chạy mô phỏng — xem Stage bên trên.", note: "MÔ PHỎNG: chỉ hiểu repeat/move/turn/say. Production dùng scratch-vm." });
    } else {
      // MOCK: không biên dịch thật. Production: POST /v1/run → BullMQ → Judge0/Piston.
      setOutput({ text: "30", note: `MOCK: ${starters[lang].label} chưa biên dịch thật ở prototype — output cố định. Production gọi sandbox Judge0/Piston qua hàng đợi.` });
    }
  });

  const runTests = () => guard("test", async () => {
    setTab("tests"); setVerdicts(null);
    if (lang !== "python") {
      setVerdicts(TESTS.map((t) => ({ ...t, actual: "(mock)", pass: false })));
      return;
    }
    try { await ensurePy(); } catch { setPy("idle"); return; }
    const res: Verdict[] = [];
    for (const t of TESTS) {
      const r = await runPython(code, t.stdin);
      const actual = (r.stderr ? "ERROR" : r.stdout).trim();
      res.push({ ...t, actual, pass: actual === t.expected });
    }
    setVerdicts(res);
  });

  const passed = verdicts?.filter((v) => v.pass).length ?? 0;
  const isMockLang = lang === "java" || lang === "cpp";

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-slate-950 text-slate-200">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-slate-900 px-3 py-2">
        <Link href="/learn" className="mr-2 text-sm text-slate-400 hover:text-white">← LMS</Link>
        <div role="tablist" aria-label="Ngôn ngữ" className="flex rounded-lg bg-slate-800 p-1">
          {(Object.keys(starters) as Lang[]).map((k) => (
            <button key={k} role="tab" aria-selected={lang === k} onClick={() => setLang(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${lang === k ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
              {starters[k].label}
            </button>
          ))}
        </div>
        {(isMockLang || lang === "scratch") && <span className="rounded bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-300">{lang === "scratch" ? "MÔ PHỎNG" : "MOCK"}</span>}
        <div className="ml-auto flex gap-2">
          <button className="btn !bg-slate-700 !text-white hover:!bg-slate-600" onClick={() => setCodes((c) => ({ ...c, [lang]: starters[lang].code }))}>↺ Đặt lại</button>
          <button className="btn !bg-slate-700 !text-white hover:!bg-slate-600" disabled={!!busy} onClick={runTests}>{busy === "test" ? "Đang chấm…" : "✔ Chấm test"}</button>
          <button className="btn-primary" disabled={!!busy} onClick={run}>{busy === "run" ? "Đang chạy…" : "▶ Chạy code"}</button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_1fr]">
        {/* Đề bài */}
        <aside className="hidden space-y-4 overflow-y-auto border-r border-white/10 bg-slate-900 p-4 lg:block">
          <h2 className="font-bold text-white">Tổng các số chẵn</h2>
          <p className="text-sm leading-relaxed text-slate-300">Nhập số nguyên <b>N</b>, in ra tổng các số chẵn từ 1 đến N.</p>
          <table className="w-full text-xs text-slate-300">
            <thead className="text-slate-500"><tr><th className="text-left">Input</th><th className="text-left">Output</th></tr></thead>
            <tbody className="font-mono"><tr><td>10</td><td>30</td></tr><tr><td>7</td><td>12</td></tr></tbody>
          </table>
          <Accordion icon="💡" title="Gợi ý (Hint)" tone="amber">Duyệt <code>range(2, n + 1, 2)</code> hoặc kiểm tra <code>i % 2 == 0</code>.</Accordion>
          <Accordion icon="✅" title="Lời giải mẫu (Solution)" tone="green">
            <pre className="overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100"><code>{`n = int(input())\nprint(sum(range(2, n + 1, 2)))`}</code></pre>
          </Accordion>
        </aside>

        {/* Editor + Panel */}
        <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,40%)]">
          <div className="min-h-0">
            <Monaco height="100%" path={`main.${lang}`} language={starters[lang].monaco} theme="vs-dark" value={code}
              onChange={(v) => setCodes((c) => ({ ...c, [lang]: v ?? "" }))}
              options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 4 }} />
          </div>
          <div className="flex min-h-0 flex-col border-t border-white/10 bg-slate-900">
            <div role="tablist" className="flex border-b border-white/10 text-sm">
              {([["output", "Kết quả"], ["input", "Input (stdin)"], ["tests", `Test case${verdicts ? ` (${passed}/${verdicts.length})` : ""}`]] as [Tab, string][]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`px-4 py-2 font-medium transition ${tab === k ? "border-b-2 border-brand-400 text-white" : "text-slate-400 hover:text-slate-200"}`}>{l}</button>
              ))}
              {py === "loading" && <span className="ml-auto self-center px-3 text-xs text-amber-300">Đang tải Python lần đầu (~10 MB)…</span>}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-sm">
              {tab === "output" && (lang === "scratch" ? <div className="h-full"><ScratchStage code={code} /></div> :
                output ? (<>
                  {output.note && <div className="mb-2 rounded bg-amber-500/10 p-2 font-sans text-xs text-amber-300">{output.note}</div>}
                  <pre className={output.error ? "text-red-400" : "text-green-300"}>{output.text}</pre>
                </>) : <span className="text-slate-500">Nhấn “Chạy code” để xem kết quả.</span>)}
              {tab === "input" && (
                <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} spellCheck={false}
                  className="h-full w-full resize-none rounded-lg bg-slate-800 p-3 text-slate-100 outline-none focus:ring-2 focus:ring-brand-500" placeholder="Mỗi dòng là một lần input()" />
              )}
              {tab === "tests" && (verdicts ? (
                <ul className="space-y-2 font-sans">
                  {verdicts.map((v, i) => (
                    <li key={i} className={`flex items-center justify-between rounded-lg p-3 text-xs ${v.pass ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
                      <span className="font-mono">#{i + 1} · input {v.stdin} → mong đợi {v.expected}, nhận {v.actual}</span>
                      <b>{v.pass ? "PASS" : "FAIL"}</b>
                    </li>
                  ))}
                  {lang !== "python" && <li className="text-xs text-amber-300">Chấm test thật cho {starters[lang].label} cần sandbox server (chưa có ở prototype).</li>}
                </ul>
              ) : <span className="text-slate-500">Nhấn “Chấm test” để chạy các test case.</span>)}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
