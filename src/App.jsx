import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  Upload,
  Barcode as BarcodeIcon,
  Download,
  Check,
  X,
  AlertTriangle,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

/* ─────────────────────────────
   Helpers & Column Detection
   ───────────────────────────── */

const toNumber = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// If downloaded text is base64, decode it.
function decodeMaybeBase64(s) {
  if (!s) return s;
  const t = String(s).trim();
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(t)) return s;
  try {
    const decoded = atob(t.replace(/\s+/g, ""));
    if (/[,;\t|]/.test(decoded)) return decoded;
    return s;
  } catch {
    return s;
  }
}

// Try multiple CSV parsing strategies until we get rows
function parseCSVSmart(text) {
  if (!text || !text.trim()) return { rows: [], headers: [], reason: "CSV text is empty" };

  const sanitize = (x) => x?.replace(/\uFEFF/g, ""); // strip BOM

  const strategies = [
    { name: "auto", opts: { header: true, skipEmptyLines: "greedy", delimitersToGuess: [",", "\t", ";", "|"] } },
    { name: "comma", opts: { header: true, skipEmptyLines: "greedy", delimiter: "," } },
    { name: "tab", opts: { header: true, skipEmptyLines: "greedy", delimiter: "\t" } },
    { name: "semicolon", opts: { header: true, skipEmptyLines: "greedy", delimiter: ";" } },
    { name: "pipe", opts: { header: true, skipEmptyLines: "greedy", delimiter: "|" } },
  ];

  for (const s of strategies) {
    let parsed;
    try {
      parsed = Papa.parse(sanitize(text), {
        ...s.opts,
        transformHeader: (h) => sanitize(String(h || "").trim()),
        worker: false,
      });
    } catch {
      continue;
    }
    const data = Array.isArray(parsed?.data) ? parsed.data : [];
    if (data.length > 0) {
      const headers = Object.keys(data[0] || {});
      return { rows: data, headers, reason: null, strategy: s.name };
    }
  }

  const firstLine = sanitize(text).split(/\r?\n/)[0]?.slice(0, 200) || "";
  return { rows: [], headers: [], reason: `No rows parsed. First line: "${firstLine}"` };
}

// Normalize a barcode/string for matching
function normCode(v) {
  let s = String(v ?? "");
  s = s.replace(/\uFEFF/g, ""); // strip BOM
  s = s.trim();
  s = s.replace(/\s+/g, ""); // remove internal spaces
  s = s.replace(/[^\w-]/g, ""); // keep letters/numbers/_/-
  return s;
}

// For numeric codes, also return a variant without leading zeros
function normVariants(v) {
  const a = normCode(v);
  if (/^\d+$/.test(a)) {
    const b = a.replace(/^0+/, "");
    return b && b !== a ? [a, b] : [a];
  }
  return [a];
}

function mapColumns(headers) {
  const raw = Array.isArray(headers) ? headers : [];
  const norm = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/\uFEFF/g, "")
      .replace(/[()]/g, "")
      .replace(/[\s_/|-]+/g, "")
      .trim();

  const find = (aliases) => raw.find((h) => aliases.map(norm).includes(norm(h)));

  const cols = {
    barcode: find(["barcode", "bar code", "sku", "itemcode", "itemid", "productcode", "upc", "ean", "gtin", "code"]),
    name: find(["name", "productname", "title", "item", "itemname", "description", "product", "producttitle"]),
    onHand: find([
      "onhand",
      "on hand",
      "onhandnew",
      "on hand new",
      "onhand(noteditable)",
      "onhandnew(noteditable)",
      "qtyonhand",
      "quantityonhand",
      "stock",
      "qty",
      "quantity",
      "available",
      "availableqty",
      "availablequantity",
      "available(noteditable)",
      "onhand(new)",
    ]),
    reserved: find([
      "reserved",
      "allocated",
      "onhold",
      "on hold",
      "committed",
      "committed(noteditable)",
      "allocatedqty",
    ]),
  };

  if (!cols.barcode || !cols.name || !cols.onHand) return null;
  return cols;
}

function useColumns(rows) {
  return useMemo(() => {
    if (!rows?.length) return null;
    const headers = Object.keys(rows[0] || {});
    return mapColumns(headers);
  }, [rows]);
}

/* ─────────────────────────────
   Netlify Functions helpers
   ───────────────────────────── */

async function nfList(ns) {
  const res = await fetch(`/.netlify/functions/blob-list?ns=${encodeURIComponent(ns)}`);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`List failed: ${res.status}${msg ? ` – ${msg}` : ""}`);
  }
  const out = await res.json();
  const files = (out.files || [])
    .map((f) => ({
      key: f.key || f.name || f.id,
      size: f.size ?? f.bytes ?? null,
      uploadedAt: f.uploadedAt || f.uploaded_at || null,
    }))
    .filter((f) => f.key && /\.csv$/i.test(f.key));
  return { ...out, files };
}

// Convert ArrayBuffer -> base64 in chunks (avoids call-stack overflow)
function bufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function nfUpload(ns, file) {
  const url = `/.netlify/functions/blob-upload?ns=${encodeURIComponent(ns)}&name=${encodeURIComponent(file.name)}`;
  const buf = await file.arrayBuffer();
  const b64 = bufferToBase64(buf);
  const res = await fetch(url, { method: "POST", body: b64, headers: { "content-type": "application/octet-stream" } });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Upload failed: ${res.status}${msg ? ` – ${msg}` : ""}`);
  }
  return res.json();
}

// Server may return plain CSV text or base64 string → we handle both.
async function nfDownload(key) {
  const res = await fetch(`/.netlify/functions/blob-download?key=${encodeURIComponent(key)}`);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Download failed: ${res.status}${msg ? ` – ${msg}` : ""}`);
  }
  const text = await res.text();
  return new Blob([text], { type: "text/plain; charset=utf-8" });
}

async function nfPutJSON(key, data) {
  const res = await fetch(`/.netlify/functions/blob-put-json?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
  if (!res.ok) throw new Error(`Save JSON failed: ${res.status}`);
  return res.json();
}

async function nfGetJSON(key) {
  const res = await fetch(`/.netlify/functions/blob-get-json?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Get JSON failed: ${res.status}`);
  return res.json();
}

/* ─────────────────────────────
   Main Component (single export)
   ───────────────────────────── */

export default function InventoryScannerApp() {
  // Cloud / files
  const [namespace, setNamespace] = useState("default");
  const [cloudFiles, setCloudFiles] = useState([]); // {key,size,uploadedAt}
  const [cloudBusy, setCloudBusy] = useState(false);
  const [activeKey, setActiveKey] = useState("");

  // Data
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const cols = useColumns(rows);

  // Fast lookup by Barcode (with variants)
  const index = useMemo(() => {
    if (!cols) return new Map();
    const m = new Map();
    for (const r of rows) {
      const raw = r[cols.barcode];
      for (const key of normVariants(raw)) {
        if (key) m.set(key, r);
      }
    }
    return m;
  }, [rows, cols]);

  // Scans & UI state
  const [diffs, setDiffs] = useState([]); // persisted per-file
  const [active, setActive] = useState(null);
  const [actualQty, setActualQty] = useState("");
  const [notFound, setNotFound] = useState("");
  const [saving, setSaving] = useState(false);
  const barcodeRef = useRef(null);
  const lastSavedRef = useRef("");

  useEffect(() => {
    const t = setTimeout(() => barcodeRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [rows.length]);

  const refreshCloudList = async () => {
    setCloudBusy(true);
    try {
      const out = await nfList(namespace);
      const arr = out.files || [];
      arr.sort((a, b) => {
        const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
        const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        if (tb !== ta) return tb - ta; // newest first
        return (b.key || "").localeCompare(a.key || "");
      });
      setCloudFiles(arr);
    } catch (e) {
      setError(e.message || "Failed to list");
    } finally {
      setCloudBusy(false);
    }
  };

  // Upload → insert into list immediately → load → refresh
  const handleCloudUploadThenLoad = async (file) => {
    if (!file) return;
    setCloudBusy(true);
    try {
      const up = await nfUpload(namespace, file);
      if (/\.csv$/i.test(up.key)) {
        setCloudFiles((prev) => [{ key: up.key, uploadedAt: new Date().toISOString() }, ...prev]);
      }
      await handleChooseCloudFile(up.key);
      await refreshCloudList();
    } catch (e) {
      setError(e.message || "Upload+Load failed");
    } finally {
      setCloudBusy(false);
      const input = document.getElementById("hiddenUpload");
      if (input) input.value = "";
    }
  };

// JSON location for scans alongside the selected CSV
const scansKeyFor = (fileKey) => {
  const parts = String(fileKey || "").split("/");
  const base = (parts.pop() || "file").replace(/\.[^.]+$/, ""); // filename without extension
  const prefix = parts.join("/"); // may be ""
  // ✅ no accidental leading slash when there is no prefix
  return `${prefix ? prefix + "/" : ""}scans/${base}.json`;
};

  // Robust CSV parsing with base64 auto-decode + multiple strategies
  const loadCSVFromCloud = async (key) => {
    setCloudBusy(true);
    try {
      const blob = await nfDownload(key);
      const raw = await blob.text();          // may be CSV or base64
      const text = decodeMaybeBase64(raw);    // auto-decode if needed

      const result = parseCSVSmart(text);

      if (!result.rows.length) {
        setRows([]);
        setFileName(key.split("/").pop());
        setDiffs([]);
        setNotFound("");
        setError(result.reason || "Failed to parse CSV");
        console.warn("CSV parse failed. Debug:", result);
        return;
      }

      setRows(result.rows);
      setFileName(key.split("/").pop());
      setDiffs([]); // replaced by saved scans load
      setNotFound("");
      setError("");
      // console.log("CSV parsed via strategy:", result.strategy, "Headers:", result.headers);
    } catch (e) {
      setError(e.message || "Load failed");
    } finally {
      setCloudBusy(false);
    }
  };

const loadScansForActive = async (fileKey) => {
  // canonical
  const primary = scansKeyFor(fileKey);

  // fallbacks for older saves you might have:
  // - at repo root: "scans/<base>.json" (when there was no namespace/prefix)
  // - under explicit namespace folder (if a function used namespace directly)
  const parts = String(fileKey || "").split("/");
  const filename = (parts.pop() || "file");
  const base = filename.replace(/\.[^.]+$/, "");
  const namespaceFolder = parts[0] || ""; // e.g. "default"
  const fallbackRoot = `scans/${base}.json`;
  const fallbackNs = namespaceFolder ? `${namespaceFolder}/scans/${base}.json` : fallbackRoot;

  const candidates = Array.from(new Set([primary, fallbackNs, fallbackRoot]));

  // try in order until one works
  for (const key of candidates) {
    try {
      const res = await nfGetJSON(key);
      if (res && Array.isArray(res.diffs)) {
        setDiffs(res.diffs);
        lastSavedRef.current = JSON.stringify({ diffs: res.diffs });
        return;
      } else if (res && res.data && Array.isArray(res.data.diffs)) {
        setDiffs(res.data.diffs);
        lastSavedRef.current = JSON.stringify({ diffs: res.data.diffs });
        return;
      }
    } catch {
      // keep trying next candidate
    }
  }

  // nothing found — start fresh
  setDiffs([]);
  lastSavedRef.current = JSON.stringify({ diffs: [] });
};

  const handleChooseCloudFile = async (key) => {
    setActiveKey(key);
    await loadCSVFromCloud(key);
    await loadScansForActive(key);
    barcodeRef.current?.focus();
  };

  // Debounced auto-save of scans
  useEffect(() => {
    if (!activeKey) return;
    const payload = JSON.stringify({ diffs });
    if (payload === lastSavedRef.current) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        setSaving(true);
        await nfPutJSON(scansKeyFor(activeKey), { diffs });
        lastSavedRef.current = payload;
      } catch (e) {
        console.warn("Save JSON failed:", e);
      } finally {
        setSaving(false);
      }
    }, 800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeKey, diffs]);

  // Scanning & actions
  const onBarcodeScan = (e) => {
    if (e.key !== "Enter") return;
    const scanned = e.currentTarget.value;
    const candidates = normVariants(scanned);
    if (!candidates.length) return;
    if (!cols) {
      setError("Missing required columns: Barcode, Name, and On Hand.");
      return;
    }

    let r = null;
    for (const k of candidates) {
      r = index.get(k);
      if (r) break;
    }

    if (!r) {
      setActive(null);
      setNotFound(candidates[0]);
      e.currentTarget.select();
      return;
    }

    const item = {
      barcode: String(r[cols.barcode] ?? "").trim(),
      name: String(r[cols.name] ?? "").trim(),
      onHand: toNumber(r[cols.onHand]),
      reserved: toNumber(r[cols.reserved]),
    };
    setActive(item);
    setActualQty(String(item.onHand));
    setNotFound("");
    e.currentTarget.select();
  };

  const confirmQty = (actual) => {
    if (!active) return;
    const prev = active.onHand;
    const delta = toNumber(actual) - toNumber(prev);
    const entry = {
      barcode: active.barcode,
      name: active.name,
      prevOnHand: prev,
      reserved: active.reserved,
      actual: toNumber(actual),
      delta,
      ts: new Date().toISOString(),
    };
    setDiffs((d) => {
      const others = d.filter((x) => x.barcode !== entry.barcode);
      return [entry, ...others];
    });
    setActive(null);
  };

  const clearAll = () => {
    setDiffs([]);
    setActive(null);
    setNotFound("");
    barcodeRef.current?.focus();
  };

  const exportDifferencesCSV = () => {
    const data = diffs
      .filter((d) => d.delta !== 0)
      .map((d) => ({
        Barcode: d.barcode,
        Name: d.name,
        "Prev On Hand": d.prevOnHand,
        Reserved: d.reserved,
        "Actual On Hand": d.actual,
        Delta: d.delta,
        Timestamp: d.ts,
      }));
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stem = fileName?.replace(/\.[^.]+$/, "") || "inventory";
    a.download = `${stem}_differences.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllScansCSV = () => {
    const data = diffs.map((d) => ({
      Barcode: d.barcode,
      Name: d.name,
      "Prev On Hand": d.prevOnHand,
      Reserved: d.reserved,
      "Actual On Hand": d.actual,
      Delta: d.delta,
      Timestamp: d.ts,
    }));
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stem = fileName?.replace(/\.[^.]+$/, "") || "inventory";
    a.download = `${stem}_all_scans.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* UI (mobile-first) */
  return (
    <div className="min-h-screen w-full bg-gray-50 p-3 sm:p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-4 sm:space-y-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 sm:gap-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">
              Inventory Barcode Scanner
            </h1>
            <p className="text-xs sm:text-sm text-gray-600">
              Load a <strong>cloud CSV</strong>, scan <strong>barcodes</strong>, adjust quantities, and export results.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {saving && <span className="text-xs text-gray-500 self-center">Saving…</span>}
            <Button variant="outline" onClick={clearAll} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Reset
            </Button>
            <Button onClick={exportDifferencesCSV} className="gap-2" disabled={!diffs.length}>
              <Download className="h-4 w-4" /> Diff CSV
            </Button>
            <Button variant="secondary" onClick={exportAllScansCSV} className="gap-2" disabled={!diffs.length}>
              <FileSpreadsheet className="h-4 w-4" /> All Scans
            </Button>
          </div>
        </header>

        {/* Top controls */}
        <section className="grid md:grid-cols-3 gap-4 sm:gap-6">
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Upload className="h-5 w-5" /> Load Inventory CSV (Cloud)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="ns" className="text-xs sm:text-sm">Namespace</Label>
                  <Input
                    id="ns"
                    value={namespace}
                    onChange={(e) => setNamespace(e.target.value)}
                    placeholder="e.g., default or jeddah-warehouse"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={refreshCloudList} disabled={cloudBusy} className="flex-1 sm:flex-none">
                      Refresh
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => document.getElementById("hiddenUpload").click()}
                      disabled={cloudBusy}
                      className="flex-1 sm:flex-none"
                    >
                      Upload
                    </Button>
                    <input
                      id="hiddenUpload"
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => handleCloudUploadThenLoad(e.target.files?.[0])}
                    />
                  </div>
                </div>

                <div className="md:col-span-2 space-y-2">
                  <Label className="text-xs sm:text-sm">Select Cloud File</Label>
                  <div className="relative">
                    <select
                      className="w-full border rounded-xl p-2 pr-8 text-sm"
                      value={activeKey || ""}
                      onChange={(e) => handleChooseCloudFile(e.target.value)}
                    >
                      <option value="">Choose...</option>
                      {cloudFiles.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.key.split("/").pop()}
                          {f.uploadedAt ? ` — ${new Date(f.uploadedAt).toLocaleString()}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  {fileName && <Badge variant="secondary" className="text-xs">{fileName}</Badge>}
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 text-red-600 text-xs sm:text-sm">
                  <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
                </div>
              )}

              <Separator />

              <div className="grid gap-2">
                <Label htmlFor="barcode" className="text-xs sm:text-sm">Scan Barcode</Label>
                <div className="flex gap-2">
                  <Input
                    id="barcode"
                    ref={barcodeRef}
                    placeholder="Focus here and scan barcode..."
                    onKeyDown={onBarcodeScan}
                    disabled={!cols}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={!cols}
                    onClick={() => barcodeRef.current?.focus()}
                  >
                    <BarcodeIcon className="h-4 w-4" /> Focus
                  </Button>
                </div>

                {rows.length > 0 && (
                  <p className="text-xs text-gray-600">
                    Loaded <strong>{rows.length}</strong> rows.&nbsp;
                    {cols ? (
                      <>Detected: <strong>Barcode</strong>, <strong>Name</strong>, <strong>On Hand</strong>{cols.reserved ? ", " : ""}{cols.reserved ? <strong>Reserved</strong> : null}.</>
                    ) : (
                      <>Couldn’t find required headers in the CSV.</>
                    )}
                  </p>
                )}

                {notFound && (
                  <p className="text-sm text-amber-700">
                    Barcode <span className="font-semibold">{notFound}</span> not found in the file.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Progress card */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base sm:text-lg">Progress</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Total items</span><span className="font-medium">{rows.length}</span></div>
              <div className="flex items-center justify-between"><span>Scanned (unique)</span><span className="font-medium">{new Set(diffs.map((d) => d.barcode)).size}</span></div>
              <div className="flex items-center justify-between"><span>With differences</span><span className="font-medium">{diffs.filter((d) => d.delta !== 0).length}</span></div>
            </CardContent>
          </Card>
        </section>

        {/* Recent scans table */}
        <section className="grid gap-3 sm:gap-4">
          <h2 className="text-base sm:text-lg font-semibold">Recent Scans</h2>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="px-2 sm:px-3 py-2">Time</th>
                  <th className="px-2 sm:px-3 py-2">Barcode</th>
                  <th className="px-2 sm:px-3 py-2">Name</th>
                  <th className="px-2 sm:px-3 py-2 text-right">Prev On Hand</th>
                  <th className="px-2 sm:px-3 py-2 text-right">Actual</th>
                  <th className="px-2 sm:px-3 py-2 text-right">Delta</th>
                </tr>
              </thead>
              <tbody>
                {diffs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 sm:px-3 py-6 text-center text-gray-500">No scans yet.</td>
                  </tr>
                )}
                {diffs.map((d) => (
                  <tr key={d.barcode} className="border-t">
                    <td className="px-2 sm:px-3 py-2 whitespace-nowrap">{new Date(d.ts).toLocaleString()}</td>
                    <td className="px-2 sm:px-3 py-2 font-mono break-all">{d.barcode}</td>
                    <td className="px-2 sm:px-3 py-2">{d.name}</td>
                    <td className="px-2 sm:px-3 py-2 text-right">{d.prevOnHand}</td>
                    <td className="px-2 sm:px-3 py-2 text-right">{d.actual}</td>
                    <td className={`px-2 sm:px-3 py-2 text-right ${d.delta === 0 ? "text-gray-600" : d.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {d.delta > 0 ? `+${d.delta}` : d.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Mobile bottom bar for quick actions (shows after a file is loaded) */}
      {rows.length > 0 && (
        <div className="fixed bottom-3 inset-x-3 md:hidden">
          <div className="rounded-2xl shadow-lg border bg-white p-3 flex gap-2">
            <Button className="flex-1" onClick={exportDifferencesCSV} disabled={!diffs.length}>
              Diff CSV
            </Button>
            <Button variant="secondary" className="flex-1" onClick={exportAllScansCSV} disabled={!diffs.length}>
              All Scans
            </Button>
          </div>
        </div>
      )}

      {/* Modal to confirm actual qty */}
      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="sm:max-w-lg">
          {active && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="text-xl sm:text-2xl">{active.name}</DialogTitle>
                <DialogDescription>
                  <div className="text-sm sm:text-base">
                    Barcode: <span className="font-mono font-medium break-all">{active.barcode}</span>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatBox label="On Hand" value={active.onHand} large />
                <StatBox label="Reserved" value={active.reserved} muted />
                <div className="col-span-2 sm:col-span-3">
                  <Label htmlFor="actual" className="text-xs sm:text-sm">Actual On Hand</Label>
                  <Input
                    id="actual"
                    type="number"
                    inputMode="numeric"
                    value={actualQty}
                    onChange={(e) => setActualQty(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmQty(actualQty);
                      if (e.key === "Escape") setActive(null);
                    }}
                    className="text-base sm:text-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Press <strong>Enter</strong> to save, <strong>Esc</strong> to cancel.
                  </p>
                </div>
              </div>
              <DialogFooter className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <Button variant="outline" className="gap-2 w-full sm:w-auto" onClick={() => setActive(null)}>
                  <X className="h-4 w-4" /> Cancel
                </Button>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button variant="secondary" className="gap-2 flex-1 sm:flex-none" onClick={() => confirmQty(active.onHand)}>
                    <Check className="h-4 w-4" /> Confirm {active.onHand}
                  </Button>
                  <Button className="gap-2 flex-1 sm:flex-none" onClick={() => confirmQty(actualQty)}>
                    <Check className="h-4 w-4" /> Save Actual
                  </Button>
                </div>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Small stat card */
function StatBox({ label, value, large, muted }) {
  return (
    <Card className={`border-2 ${muted ? "border-gray-200" : "border-gray-300"}`}>
      <CardContent className="p-4">
        <div className="text-[10px] sm:text-xs uppercase tracking-wide text-gray-500">{label}</div>
        <div className={`${large ? "text-2xl sm:text-3xl" : "text-lg sm:text-xl"} font-semibold`}>{value}</div>
      </CardContent>
    </Card>
  );
}

/* Self-test */
(function () {
  try {
    const m = mapColumns(["Barcode", "Name", "On Hand", "Reserved"]);
    console.assert(m && m.barcode && m.name && m.onHand, "mapColumns failed");
  } catch {}
})();
