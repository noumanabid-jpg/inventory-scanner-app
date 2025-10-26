# Inventory Barcode Scanner — Cloud Only (Netlify)

React + Vite app that uses **Netlify Blobs** (via Netlify Functions) to store CSVs and **persist scans per file**.

## Cloud-only workflow
- Choose a **namespace** (e.g., `jeddah-warehouse`) and click **Refresh** to list cloud CSVs.
- **Upload to Cloud** selects a local CSV but immediately uploads it; the app then loads it from cloud (no local processing).
- When you load a CSV, its related **scans** are fetched from `scans/<file>.json`. Every change auto-saves back to cloud.

## Deploy on Netlify
- Build command: `npm run build`
- Publish directory: `dist`
- Functions: `netlify/functions` (auto-detected)

## Local dev
```bash
npm install
npm run dev
```