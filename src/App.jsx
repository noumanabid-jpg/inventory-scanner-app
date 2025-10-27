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

/**
 * Cloud-only Inventory Scanner
 * - All CSVs live in Netlify Blobs (by namespace).
 * - Choose a cloud CSV to work with; when selected, we also load its related scans JSON.
 * - Confirming counts auto-saves scans JSON for that CSV (debounced, no recursion).
 */

/* ============================
   Helpers & Column Mapping
   ============================ */
const toNumber = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function mapColumns(headers) {
  const raw = Array.isArray(headers) ? headers : [];
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "").trim();
  const find = (names) => raw.find((h) => names.map(norm).includes(norm(h)));
  const cols = {
    barcode: find(["barcode", "bar code"]),
    name: find(["name", "productname", "title"]),
    onHand: find(["onhand", "on hand", "stock", "qty", "quantity", "available"]),
    reserved: find(["reserved", "allocated", "onhold", "on hold"]),
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

/* ============================
   Netlify Functions helpers
   ============================ */
async function nfList(ns) {
  const res = await fetch(`/.netlify/functions/blob-list?ns=${encodeURIComponent(ns)}`);
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  return res.json();
}

// Convert ArrayBuffer -> base64 safely (chunked; avoids call stack overflow)
function bufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000; // 32KB chunks
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
  const b64 = bufferToBase64(buf); // keep the chunked encoder you already added
  const res = await fetch(url, {
    method: "POST",
    body: b64,
    headers: { "content-type": "application/octet-stream" },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Upload failed: ${res.status}${msg ? ` – ${msg}` : ""}`);
  }
  return res.json();
}

async function nfDownload(key) {
  const res = await fetch(`/.netlify/functions/blob-download?key=${encodeURIComponent(key)}`);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Download failed: ${res.status}${msg ? ` – ${msg}` : ""}`);
  }
  const b64 = await res.text();
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: "text/csv" });
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

/* ============================
   Main Component
   ============================ */
export default function InventoryScannerApp() {
  // Cloud / files
  const [namespace, setNamespace] = useState("default");
  const [cloudFiles, setCloudFiles] = useState([]); // {key,size,uploadedAt}
  const [cloudBusy, setCloudBusy] = useState(false);
  const [activeKey, setActiveKey] = useState(""); // currently selected CSV key

  // Data
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const cols = useColumns(rows);

  // Fast lookup by Barcode
  const index = useMemo(() => {
    if (!cols) return new Map();
    const m = new Map();
    for (const r of rows) {
      const k = String(r[cols.barcode] ?? "").trim();
      if (k) m.set(k, r);
    }
    return m;
  }, [rows, cols]);

  // Scans & UI state
  const [diffs, setDiffs] = useState([]); // persisted per-file
  const [active, setActive] = useState(null); // currently scanned item
  const [actualQty, setActualQty] = useState("");
  const [notFound, setNotFound] = useState("");
  const [saving, setSaving] = useState(false);
  const barcodeRef = useRef(null);

  // Tracks last successfully-saved payload to avoid redundant saves
  const lastSavedRef = useRef("");

  useEffect(() => {
    const t = setTimeout(() => barcodeRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [rows.length]);

  const refreshCloudList = async () => {
    setCloudBusy(true);
    try {
      const out = await nfList(namespace);
      setCloudFiles(
        (out.files || []).sort((a, b) =>
          (b.uploadedAt || "").localeCompare(a.uploadedAt || "")
        )
      );
    } catch (e) {
      setError(e.message || "Failed to list");
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudUploadThenLoad = async (file) => {
    if (!file) return;
    setCloudBusy(true);
    try {
      const up = await nfUpload(namespace, file);
      await refreshCloudList();
      // Load the uploaded file from the cloud (not from local)
      await handleChooseCloudFile(up.key);
    } catch (e) {
      setError(e.message || "Upload+Load failed");
    } finally {
      setCloudBusy(false);
      const input = document.getElementById("hiddenUpload");
      if (input) input.value = "";
    }
  };

  const scansKeyFor = (fileKey) => {
    const base = (fileKey || "").split("/").pop()?.replace(/\.[^.]+$/, "") || "file";
    const prefix = (fileKey || "").split("/").slice(0, -1).join("/");
    return `${prefix}/scans/${base}.json`;
  };

  const loadCSVFromCloud = async (key) => {
    setCloudBusy(true);
    try {
      const blob = await nfDownload(key);
      const text = await blob.text();
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          setRows(res.data || []);
          setFileName(key.split("/").pop());
          setDiffs([]); // will be replaced by loadScansForActive
          setNotFound("");
        },
        error: (err) => setError(err?.message || "Failed to parse CSV"),
      });
    } catch (e) {
      setError(e.message || "Load failed");
    } finally {
      setCloudBusy(false);
    }
  };

  const loadScansForActive = async (fileKey) => {
    try {
      const key = scansKeyFor(fileKey);
      const res = await nfGetJSON(key);
      if (res && Array.isArray(res.diffs)) {
        setDiffs(res.diffs);
        lastSavedRef.current = JSON.stringify({ diffs: res.diffs });
      } else if (res && res.data && Array.isArray(res.data.diffs)) {
        setDiffs(res.data.diffs);
        lastSavedRef.current = JSON.stringify({ diffs: res.data.diffs });
      } else {
        setDiffs([]);
        lastSavedRef.current = JSON.stringify({ diffs: [] });
      }
    } catch {
      setDiffs([]);
      lastSavedRef.current = JSON.stringify({ diffs: [] });
    }
  };

  const handleChooseCloudFile = async (key) => {
    setActiveKey(key);
    await loadCSVFromCloud(key);
    await loadScansForActive(key);
    barcodeRef.current?.focus();
  };

  /* ============================
     Debounced auto-save of scans
     (no recursion, skip unchanged)
     ============================ */
  useEffect(() => {
    if (!activeKey) return;

    const payload = JSON.stringify({ diffs });
    if (payload === lastSavedRef.current) return; // nothing changed since last save

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        setSaving(true); // keeps the "Saving…" indicator
        await nfPutJSON(scansKeyFor(activeKey), { diffs });
        lastSavedRef.current = payload;
      } catch (e) {
        console.warn("Save JSON failed:", e);
      } finally {
        setSaving(false);
      }
    }, 800); // debounce delay

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeKey, diffs]);

  /* ============================
     Scanning & actions
     ============================ */
  const onBarcodeScan = (e) => {
    if (e.key !== "Enter") return;
    const code = e.currentTarget.value.trim();
    if (!code) return;
    if (!cols) {
      setError("Missing required columns: Barcode, Name, and On Hand.");
      return;
    }

    const r = index.get(code);
    if (!r) {
      setActive(null);
      setNotFound(code);
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

  /* ============================
     UI
     ============================ */
  return (
    <div className="min-h-screen w-full bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Inventory Barcode Scanner
            </h1>
            <p className="text-sm text-gray-600">
              Choose a <strong>cloud CSV</strong>, scan the <strong>Barcode</strong>, confirm or adjust
              quantities, and export a difference report.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-gray-500 mr-2">Saving…</span>}
            <Button variant="outline" onClick={clearAll} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Reset
            </Button>
            <Button onClick={exportDifferencesCSV} className="gap-2" disabled={!diffs.length}>
              <Download className="h-4 w-4" /> Diff CSV
            </Button>
            <Button
              variant="secondary"
              onClick={exportAllScansCSV}
              className="gap-2"
              disabled={!diffs.length}
            >
              <FileSpreadsheet className="h-4 w-4" /> All Scans
            </Button>
          </div>
        </header>

        <section className="grid md:grid-cols-3 gap-6">
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" /> Load Inventory CSV (Cloud)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ns">Namespace</Label>
                  <Input
                    id="ns"
                    value={namespace}
                    onChange={(e) => setNamespace(e.target.value)}
                    placeholder="e.g., jeddah-warehouse"
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={refreshCloudList} disabled={cloudBusy}>
                      Refresh
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => document.getElementById("hiddenUpload").click()}
                      disabled={cloudBusy}
                    >
                      Upload to Cloud
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
                  <Label>Select Cloud File</Label>
                  <select
                    className="w-full border rounded-xl p-2"
                    value={activeKey || ""}
                    onChange={(e) => handleChooseCloudFile(e.target.value)}
                  >
                    <option value="">Choose...</option>
                    {cloudFiles.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.key.split("/").pop()} —{" "}
                        {f.uploadedAt ? new Date(f.uploadedAt).toLocaleString() : "-"}
                      </option>
                    ))}
                  </select>
                  {fileName && <Badge variant="secondary">{fileName}</Badge>}
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 text-red-600 text-sm">
                  <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
                </div>
              )}
              <Separator />
              <div className="grid gap-2">
                <Label htmlFor="barcode">Scan Barcode</Label>
                <div className="flex gap-2">
                  <Input
                    id="barcode"
                    ref={barcodeRef}
                    placeholder="Focus here and scan barcode..."
                    onKeyDown={onBarcodeScan}
                    disabled={!rows.length}
                  />
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={!rows.length}
                    onClick={() => barcodeRef.current?.focus()}
                  >
                    <BarcodeIcon className="h-4 w-4" /> Focus
                  </Button>
                </div>
                {!rows.length && (
                  <p className="text-xs text-gray-500">
                    Choose or upload a cloud CSV first with <strong>Barcode</strong>,{" "}
                    <strong>Name</strong>, and <strong>On Hand</strong> columns.
                  </p>
                )}
                {rows.length > 0 && !cols && (
                  <p className="text-xs text-red-600">
                    Ensure the CSV headers include Barcode, Name, and On Hand.
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Total items</span>
                <span className="font-medium">{rows.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Scanned (unique)</span>
                <span className="font-medium">
                  {new Set(diffs.map((d) => d.barcode)).size}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>With differences</span>
                <span className="font-medium">{diffs.filter((d) => d.delta !== 0).length}</span>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">Recent Scans</h2>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Barcode</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 text-right">Prev On Hand</th>
                  <th className="px-3 py-2 text-right">Actual</th>
                  <th className="px-3 py-2 text-right">Delta</th>
                </tr>
              </thead>
              <tbody>
                {diffs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                      No scans yet.
                    </td>
                  </tr>
                )}
                {diffs.map((d) => (
                  <tr key={d.barcode} className="border-t">
                    <td className="px-3 py-2">{new Date(d.ts).toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono">{d.barcode}</td>
                    <td className="px-3 py-2">{d.name}</td>
                    <td className="px-3 py-2 text-right">{d.prevOnHand}</td>
                    <td className="px-3 py-2 text-right">{d.actual}</td>
                    <td
                      className={`px-3 py-2 text-right ${
                        d.delta === 0
                          ? "text-gray-600"
                          : d.delta > 0
                          ? "text-emerald-600"
                          : "text-rose-600"
                      }`}
                    >
                      {d.delta > 0 ? `+${d.delta}` : d.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Popup Modal for confirming Actual */}
      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="sm:max-w-lg">
          {active && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="text-2xl">{active.name}</DialogTitle>
                <DialogDescription>
                  <div className="text-base">
                    Barcode: <span className="font-mono font-medium">{active.barcode}</span>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-3">
                <StatBox label="On Hand" value={active.onHand} large />
                <StatBox label="Reserved" value={active.reserved} muted />
                <div className="col-span-3">
                  <Label htmlFor="actual" className="text-sm">
                    Actual On Hand
                  </Label>
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
                    className="text-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Press <strong>Enter</strong> to save, <strong>Esc</strong> to cancel.
                  </p>
                </div>
              </div>
              <DialogFooter className="flex items-center justify-between gap-2">
                <Button variant="outline" className="gap-2" onClick={() => setActive(null)}>
                  <X className="h-4 w-4" /> Cancel
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="gap-2"
                    onClick={() => confirmQty(active.onHand)}
                  >
                    <Check className="h-4 w-4" /> Confirm current ({active.onHand})
                  </Button>
                  <Button className="gap-2" onClick={() => confirmQty(actualQty)}>
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

function StatBox({ label, value, large, muted }) {
  return (
    <Card className={`border-2 ${muted ? "border-gray-200" : "border-gray-300"}`}>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
        <div className={`${large ? "text-3xl" : "text-xl"} font-semibold`}>{value}</div>
      </CardContent>
    </Card>
  );
}

/* ============================
   Self Tests (console)
   ============================ */
(function runSelfTests() {
  try {
    const m = mapColumns(["Barcode", "Name", "On Hand", "Reserved"]);
    console.assert(m && m.barcode && m.name && m.onHand, "mapColumns failed");
    console.log("Inventory Scanner: self-tests passed ✓");
  } catch (e) {
    console.warn("Inventory Scanner: self-tests encountered an issue:", e);
  }
})();
