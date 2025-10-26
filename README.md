# Inventory Barcode Scanner (CSV + Barcode)

React + Vite app. Upload a CSV with columns **Barcode, Name, On Hand** (optional **Reserved**). Scan a barcode with any USB/BT scanner, adjust the quantity, and export difference reports.

## Quick Start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy on Netlify
- New Site > Import from Git or Deploy manually by dropping the folder
- Build command: `npm run build`
- Publish directory: `dist`
- Node version: 18+ recommended

---

## Cloud Save/Load (Netlify Blobs)

1. Create a Supabase project → **Storage** → create bucket named `inventory`.
2. In **Project Settings → API**, copy **Project URL** and **anon public key**.
3. In Netlify → Site settings → **Environment variables**, add:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
4. (Optional but recommended) In **Storage → Policies** for the `inventory` bucket, add policies to allow:
   - Public read on objects
   - Insert/update by anon (or restrict to authenticated users)
5. In the app, open **Cloud Storage** section:
   - Set a **Namespace** (e.g., `jeddah-warehouse`).
   - Upload CSV to cloud; it will appear in the list.
   - Click **Load** to fetch a file back into the app.
