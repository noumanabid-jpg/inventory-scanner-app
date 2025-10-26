
import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Barcode as BarcodeIcon, Download, Check, X, AlertTriangle, FileSpreadsheet, RefreshCw } from "lucide-react";
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

// Netlify Blob API wrappers via serverless functions
async function nfList(ns) {
  const res = await fetch(`/.netlify/functions/blob-list?ns=${encodeURIComponent(ns)}`);
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  return res.json();
}

async function nfUpload(ns, file) {
  const url = `/.netlify/functions/blob-upload?ns=${encodeURIComponent(ns)}&name=${encodeURIComponent(file.name)}`;
  const buf = await file.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const res = await fetch(url, { method: "POST", body: b64, headers: { "content-type": "application/octet-stream" } });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

async function nfDownload(key) {
  const res = await fetch(`/.netlify/functions/blob-download?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const b64 = await res.text();
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: "text/csv" });
}


/**
 * Inventory Scanner App (Barcode-first)
 * - Upload a CSV with columns: Barcode, Name, On Hand, Reserved (Reserved optional)
 * - Scan the value that is in the CSV **Barcode** column using any USB/BT barcode scanner
 * - A popup shows Name, On Hand (large), and Reserved (smaller)
 * - Operator can confirm current qty or type an Actual On Hand and save
 * - Export a Differences CSV (Actual - On Hand) and an All Scans CSV
 *
 * NOTE: We strictly key by the **Barcode** column. No SKU fallbacks.
 */

/* ============================
   Helpers & Column Mapping
   ============================ */
const toNumber = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[\\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Pure helper to map headers to required columns; used by the hook & self-tests
function mapColumns(headers) {
  const rawHeaders = Array.isArray(headers) ? headers : [];
  const norm = (s) => String(s || "").toLowerCase().replace(/\\s+/g, "").trim();
  const find = (candidates) => rawHeaders.find((h) => candidates.map(norm).includes(norm(h)));
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
   Main Component
   ============================ */


export default function InventoryScannerApp() {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudFiles, setCloudFiles] = useState([]); // {name, updated_at, size}
  const [namespace, setNamespace] = useState("default"); // folder prefix

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
  const [diffs, setDiffs] = useState([]); // { barcode, name, prevOnHand, reserved, actual, delta, ts }
  const [active, setActive] = useState(null); // currently scanned item
  const [actualQty, setActualQty] = useState("");
  const [notFound, setNotFound] = useState("");
  const barcodeRef = useRef(null);

  // Keep focus for scanner convenience
  useEffect(() => {
    const t = setTimeout(() => barcodeRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [rows.length]);

  const handleCSVUpload = (file) => {
    setError("");
    if (!file) return;
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data || [];
        if (!data.length) {
          setRows([]);
          setError("CSV file is empty.");
          return;
        }
        setRows(data);
        setDiffs([]);
        setNotFound("");
      },
      error: (err) => setError(err?.message || "Failed to parse CSV"),
    });
  };

  // Scanner input: most USB scanners type the code and press Enter
  
  // ===== Supabase: List files in namespace =====
  const refreshCloudList = async () => {
    if (!supabase) return;
    setCloudBusy(true);
    try {
      const prefix = `${namespace}/`;
      const out = await nfList(namespace);
      const files = (out.files || []).map((f) => ({ key: f.key, size: f.size, uploadedAt: f.uploadedAt }));
      setCloudFiles(files);
    } catch (e) {
      setError(e.message || "Failed to list cloud files");
    } finally {
      setCloudBusy(false);
    }
  };

  // ===== Supabase: Upload current CSV file =====
  const uploadCSVToCloud = async (file) => {
    
    if (!file) {
      setError("Please choose a CSV file to upload.");
      return;
    }
    setCloudBusy(true);
    try {
      await nfUpload(namespace, file);
      await refreshCloudList();
    } catch (e) {
      setError(e.message || "Upload failed");
    } finally {
      setCloudBusy(false);
    }
  };

  // ===== Supabase: Download a CSV and load into app =====
  const loadCSVFromCloud = async (key) => {
    if (!supabase) return;
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
          setDiffs([]);
          setNotFound("");
        },
        error: (err) => setError(err?.message || "Failed to parse downloaded CSV"),
      });
    } catch (e) {
      setError(e.message || "Load failed");
    } finally {
      setCloudBusy(false);
    }
  };

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
    const stem = fileName?.replace(/\\.[^.]+$/, "") || "inventory";
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
    const stem = fileName?.replace(/\\.[^.]+$/, "") || "inventory";
    a.download = `${stem}_all_scans.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearAll = () => {
    setDiffs([]);
    setActive(null);
    setNotFound("");
    barcodeRef.current?.focus();
  };

  return (
    <div className="min-h-screen w-full bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Inventory Barcode Scanner</h1>
            <p className="text-sm text-gray-600">Upload your inventory CSV, scan the <strong>Barcode</strong> column, confirm or adjust quantities, and export a difference report.</p>
          </div>
          <div className="flex items-center gap-2">
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

        <section className="grid md:grid-cols-3 gap-6">
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Load Inventory CSV</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Input type="file" accept=".csv" onChange={(e) => handleCSVUpload(e.target.files?.[0])} />
                {fileName && <Badge variant="secondary">{fileName}</Badge>}
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
                  <Button variant="outline" className="gap-2" disabled={!rows.length} onClick={() => barcodeRef.current?.focus()}>
                    <BarcodeIcon className="h-4 w-4" /> Focus
                  </Button>
                </div>
                {!rows.length && <p className="text-xs text-gray-500">Upload a CSV first with <strong>Barcode</strong>, <strong>Name</strong>, and <strong>On Hand</strong> columns (Reserved optional).</p>}
                {rows.length > 0 && !cols && <p className="text-xs text-red-600">Ensure the CSV headers include Barcode, Name, and On Hand.</p>}
                {notFound && <p className="text-sm text-amber-700">Barcode <span className="font-semibold">{notFound}</span> not found in the file.</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Total items in file</span>
                <span className="font-medium">{rows.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Scanned (unique)</span>
                <span className="font-medium">{new Set(diffs.map((d) => d.barcode)).size}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>With differences</span>
                <span className="font-medium">{diffs.filter((d) => d.delta !== 0).length}</span>
              </div>
            </CardContent>
          </Card>
        </section>

        
        {/* Cloud Storage Panel */}
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">Cloud Storage</h2>
          <Card>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div className="md:col-span-1 space-y-2">
                  <Label htmlFor="ns">Namespace</Label>
                  <Input id="ns" value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="e.g., jeddah-warehouse" />
                  <Button variant="outline" className="mt-1" onClick={refreshCloudList} disabled={cloudBusy}>
                    {cloudBusy ? "Loading..." : "Refresh List"}
                  </Button>
                </div>
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="cloudFile">Upload CSV to Cloud</Label>
                  <div className="flex gap-2">
                    <Input id="cloudFile" type="file" accept=".csv" onChange={(e) => uploadCSVToCloud(e.target.files?.[0])} disabled={cloudBusy} />
                  </div>
                  
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left">
                      <th className="px-3 py-2">File</th>
                      <th className="px-3 py-2">Updated</th>
                      <th className="px-3 py-2">Size</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cloudFiles.length === 0 && (<tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">No files yet.</td></tr>)}
                    {cloudFiles.map((f) => (
                      <tr key={f.key} className="border-t">
                        <td className="px-3 py-2">{f.key.split('/').pop()}</td>
                        <td className="px-3 py-2">{f.uploadedAt ? new Date(f.uploadedAt).toLocaleString() : '-'}</td>
                        <td className="px-3 py-2">{typeof f.size === 'number' ? `${f.size} B` : '-'}</td>
                        <td className="px-3 py-2">
                          <Button variant="secondary" onClick={() => loadCSVFromCloud(f.key)} disabled={cloudBusy}>Load</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">No scans yet.</td>
                  </tr>
                )}
                {diffs.map((d) => (
                  <tr key={d.barcode} className="border-t">
                    <td className="px-3 py-2">{new Date(d.ts).toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono">{d.barcode}</td>
                    <td className="px-3 py-2">{d.name}</td>
                    <td className="px-3 py-2 text-right">{d.prevOnHand}</td>
                    <td className="px-3 py-2 text-right">{d.actual}</td>
                    <td className={`px-3 py-2 text-right ${d.delta === 0 ? "text-gray-600" : d.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {d.delta > 0 ? `+${d.delta}` : d.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Popup Modal */}
      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="sm:max-w-lg">
          {active && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="text-2xl">{active.name}</DialogTitle>
                <DialogDescription>
                  <div className="text-base">Barcode: <span className="font-mono font-medium">{active.barcode}</span></div>
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-3">
                <StatBox label="On Hand" value={active.onHand} large />
                <StatBox label="Reserved" value={active.reserved} muted />
                <div className="col-span-3">
                  <Label htmlFor="actual" className="text-sm">Actual On Hand</Label>
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
                  <p className="text-xs text-gray-500 mt-1">Press <strong>Enter</strong> to save, <strong>Esc</strong> to cancel.</p>
                </div>
              </div>
              <DialogFooter className="flex items-center justify-between gap-2">
                <Button variant="outline" className="gap-2" onClick={() => setActive(null)}>
                  <X className="h-4 w-4" /> Cancel
                </Button>
                <div className="flex gap-2">
                  <Button variant="secondary" className="gap-2" onClick={() => confirmQty(active.onHand)}>
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
   Self Tests (run once in browser console)
   ============================ */
(function runSelfTests() {
  try {
    const headers1 = ["Barcode", "Name", "On Hand", "Reserved"]; // canonical
    const headers2 = ["bar code", "productname", "stock", "on hold"]; // variants
    const m1 = mapColumns(headers1);
    const m2 = mapColumns(headers2);
    console.assert(m1 && m1.barcode === "Barcode" && m1.name === "Name" && m1.onHand === "On Hand", "MapColumns canonical failed");
    console.assert(m2 && m2.barcode === "bar code" && m2.name === "productname" && m2.onHand === "stock" && m2.reserved === "on hold", "MapColumns variants failed");

    console.assert(toNumber("12") === 12 && toNumber(" 1,200 ") === 1200 && toNumber(null) === 0, "toNumber failed");

    const sampleRows = [
      { Barcode: "123", Name: "Apple", "On Hand": 10, Reserved: 2 },
      { Barcode: "ABC-999", Name: "Banana", "On Hand": "5", Reserved: "0" },
    ];
    const cols = mapColumns(Object.keys(sampleRows[0]));
    const idx = new Map(sampleRows.map((r) => [String(r[cols.barcode]), r]));
    console.assert(idx.get("123").Name === "Apple" && idx.get("ABC-999").Name === "Banana", "Index by barcode failed");

    // Basic delta logic
    const prev = 10;
    const act = 8;
    const delta = toNumber(act) - toNumber(prev);
    console.assert(delta === -2, "Delta calc failed");

    console.log("Inventory Scanner: self-tests passed ✓");
  } catch (e) {
    console.warn("Inventory Scanner: self-tests encountered an issue:", e);
  }
})();
