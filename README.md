# 🏺 FieldPack: archaeology trip planner

A web app for planning archaeological field trips (survey, testing, excavation, monitoring), with a soft spot for the California Channel Islands. It uses **your Excel workbook as the database** of gear (supplies, containers, clothing, tools and so on) and connects to **the AI of your choice** for detailed trip analysis.

The look is inspired by the California Channel Islands: deep channel blues, kelp greens, island-fox orange, coreopsis gold and sandstone, on topo-map paper with chunky outdoor-gear buttons. It has an island terrain with an animated sea-arch scene, a ferry transport preset, and snorkel, sea-kayak, tidepooling and birding activities, plus island-ready sample gear (wetsuit, PFD, marine VHF, animal-proof food canister, sand stakes and more). It supports light and dark ("night at anchor") modes.

**Archaeology defaults:** new trips start as a 5-day island trip by ferry for a crew of 4, planned around survey and excavation. The sample inventory includes an **Archaeology** kit: trowels, 1/8" and 1/4" shaker screens, buckets, line level and unit stakes, tapes, Munsell chart, pin flags, artifact bags and tags, photo scale and north arrow, field forms, permits binder, sub-meter GNSS, kneeling pads, specimen boxes and a mattock. The AI is prompted as an archaeology logistics planner: it scales screening kit to the crew, plans for packing finds and samples out, covers recording, permits and site confidentiality, and island landing and water constraints. Visual touches include an excavation unit, shell midden and pin flags in the trip scene, a site-map scale bar with north arrow, a stratigraphic-profile strip, and history entries styled as field tags.

![tabs](https://img.shields.io/badge/views-Quick%20Plan%20·%20Pack%20Board%20·%20Inventory%20·%20History%20·%20Settings-2f6f4e)

## Features

| | |
|---|---|
| 🗺️ **Quick Planner** | Pick dates and any trip length (quick picks up to a 3-month field season, with a calculated end date and an optional resupply interval), crew size, terrain, archaeology/research activities (add your own),  transport (with weight and volume presets), must-haves and notes. A live trip card previews the plan. |
| ⚡ **Auto-pack** | A local engine scores every item against the trip and computes quantities (per person, per person per day for consumables). It trims to your weight and volume limits, chooses containers, then bin-packs items into them. |
| 🎒 **Pack Board** | A visual load-out. Bags fill up as you pack. Drag gear from the shelf into containers, and use the weight, container-fill and transport-volume gauges, the weight-by-category bar, and the over-limit and over-owned warnings. |
| 🤖 **AI analyst** | Sends the trip brief, your full inventory and the current board to Claude, OpenAI, Gemini, or any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter…). You get back a Markdown plan with a packing table, a weight check, risks and gaps, and consumables. You can apply its machine-readable packing list to the board in one click, add its suggested missing items to inventory, and ask follow-up questions. |
| 🤖 **Add gear with AI** | Describe gear in plain words ("two 1/8 inch screens and 500 artifact bags"). The AI drafts complete records, estimating typical weights and sizes, and asks short follow-up questions when something that matters (quantity, model/size, container capacity) is unclear. Then it **checks weights and dimensions against manufacturer specs on the web**, matching on brand and model number (editable on each draft row). Claude uses its built-in web search and Gemini uses Google Search grounding; a saved Gemini or Claude key is used for spec checks even if your main AI is a free one. Otherwise the free lookup reads the manufacturer's product page, web search results (an optional free Tavily, Serper or Jina search key gives much better results; Marginalia otherwise), and the manufacturer's own site search, follows matching product links one hop, and lets the AI use only that page text. Configure it under **Settings → Spec lookups**. Each row shows ✅ verified (with the source link, saved in the item's notes) or ≈ estimate. Review and edit the draft, then add it in one click. |
| 🧾 **Inventory** | Card grid with search, category filters and sort. Quick-add bar, plus a detailed editor with an emoji picker, dimensions, container capacity and max load, per-person and consumable rules, and use-case and environment tags. |
| 📜 **History** | Every saved trip goes to the workbook's **Trips** sheet, with its requirements, totals, packing list and AI analysis. You can reopen, duplicate or change the status (planned → packed → in field → completed). |
| 📗 **Excel sync** | **Local file:** in Chrome or Edge the app reads and **writes back into the same .xlsx file** (File System Access API), with optional auto-save; other browsers download an updated copy. **Excel Online:** open and save workbooks in **OneDrive or SharePoint/Teams** after signing in with Microsoft (browse recent workbooks, open from a share link, or create one in OneDrive). Saves are conflict-safe: if a teammate changed the file in Excel Online meanwhile, you're asked before anything is overwritten. Other sheets in your workbook are always left alone. |

## Run it

**Windows (easiest, nothing to install):** double-click **`Start FieldPack.bat`**. A small window opens running a local web server (built-in PowerShell), and your browser opens to FieldPack. Close that window to stop it. If Windows SmartScreen warns about the file, click **More info → Run anyway**.

**Mac / Linux:** the app is static HTML/JS but must be served over http(s), not opened via `file://`:

```bash
git clone https://github.com/gareto986/Field-Planner-App.git
cd Field-Planner-App
python3 -m http.server 8080      # or: npm start
# open http://localhost:8080 in Chrome or Edge
```

**VS Code:** with the *Live Server* extension, right-click `index.html` → **Open with Live Server** (or click **Go Live** in the status bar).

Use **Chrome or Edge** for live two-way sync with your Excel file.

On first launch you can open an existing workbook, create a new one (seeded with ~74 sample items), or just explore with sample data. A ready-made workbook is in [`sample/fieldpack-sample-database.xlsx`](sample/fieldpack-sample-database.xlsx).

## Workbook layout

**Items** sheet (one row per item; headers are matched loosely, and `Weight (lb)` is converted automatically):

| Column | Meaning |
|---|---|
| ID, Name, Category, Icon | Category is one of Container, Clothing, Shelter, Sleep, Cooking, Food, Water, Navigation, Safety, Tools, Electronics, Science, Personal, Other |
| Weight (kg) | Per unit |
| Length / Width / Height (cm), Volume (L) | Volume is the packed size. If blank it is computed from the dimensions |
| Qty Owned | Planner warns if a plan uses more than you own |
| Use Cases, Environments | `;`-separated tags, e.g. `hiking; overnight`, `forest; mountain` or `all`. The tag `worn` means "worn, not packed" |
| Per Person | `Y` → one per traveler |
| Consumable, Per Person/Day | `Y` + rate → packs `rate × people × days` |
| Capacity (L), Max Load (kg) | For containers (bags, totes, cases, dry bags) |
| Notes, Last Updated | Free text |

**Trips** sheet: Request ID, Created, Status, Trip Name, Destination, Start Date, Days, People, Environments, Activities, Transport, Max Weight/Volume, Must-Haves, Requirements/Notes, Total Weight/Volume, Packing Summary, Packing List (JSON), AI Provider, AI Model, AI Analysis.

## AI providers

Configure under **Settings → AI connection**. Cloud API keys are kept in the browser's localStorage only and are never written to the workbook.

**No AI account? No problem.** FieldPack works out of the box with **free cloud AI that needs no key or sign-up**: open-weight models (gpt-oss-120b by default; Llama 3.3 70B, Qwen, Mistral) on [OVHcloud AI Endpoints](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities), hosted in France under EU data-protection rules. Anonymous use is limited to 2 requests per minute per model, so FieldPack automatically switches to the next open model when one is busy; an optional free OVHcloud key raises the limit to 400/minute. Trip details are sent to OVHcloud to be answered.

For confidential trips there's also a **free built-in AI**: an open-weight model (Qwen 2.5 3B by default; Llama 3.2 3B, Qwen 2.5 1.5B and Qwen 2.5 7B are also offered) that runs **entirely in your browser** on your computer's GPU via [WebLLM](https://github.com/mlc-ai/web-llm). There's no key, no cost, and your trip and inventory never leave the machine. The first analysis asks before downloading the model (≈1–4.5 GB depending on the model); after that it's cached and works offline. It needs a recent **Chrome or Edge** with WebGPU and a reasonably modern GPU. Small local models are slower and less thorough than big cloud models, so for the deepest analysis connect one of these:

| Provider | Default model | Notes |
|---|---|---|
| Free cloud, no key (OVHcloud) | `gpt-oss-120b` | Default. No account needed; 2 requests/min per model anonymously, with automatic model fallback. |
| Free built-in (WebLLM) | `Qwen2.5-3B-Instruct-q4f16_1-MLC` | Runs locally in the browser (WebGPU); 8K context, so FieldPack sends a compact brief with only the relevant inventory. |
| Free cloud models (OpenRouter) | `google/gemma-4-31b-it:free` | Free open-weight models (Gemma, Nemotron and others) with a free OpenRouter key, no credit card. The model list is loaded live. Daily limits apply, and free providers may log prompts, so keep confidential site details out of trip notes. |
| Anthropic Claude | `claude-opus-5-5` | Called directly from the browser (`anthropic-dangerous-direct-browser-access`). On current models, server-side refusal fallback is enabled. |
| OpenAI | `gpt-4o` | Any chat-completions model. |
| Google Gemini | `gemini-2.5-flash` | `generateContent` API. |
| OpenAI-compatible | `llama3.1` | Set a base URL, e.g. `http://localhost:11434/v1` for Ollama (start it with `OLLAMA_ORIGINS=*`). |

> **Why not OpenCode Zen's "Big Pickle"?** As of November 2026 its free models only work inside OpenCode's own apps, and its API doesn't allow calls from web pages, so a browser app can't use it. OpenRouter's free models are the closest web-friendly equivalent.

> Because calls run in the browser, anyone using this machine's browser profile can use the stored key. Use a key with a spending limit, or a local model.

## Units

FieldPack defaults to **imperial**: pounds/ounces, inches, cubic inches for item and pack volumes, and cubic feet for totals and limits. Switch to metric in **Settings → Preferences**. Values are stored internally in metric, and the Excel workbook is written with unit-labelled headers (e.g. `Weight (lb)`); when reading, FieldPack converts any unit in a header (kg, g, lb, oz, cm, mm, in, L, cu in, cu ft, gal).

## Excel Online setup (OneDrive / SharePoint)

**No Entra access? Use OneDrive sync (no setup, no admin).** Any workbook you own or can edit in OneDrive, SharePoint or Teams works:
1. Have the OneDrive app signed in on your computer (built into Windows 10/11; available for Mac).
2. Find the workbook in your OneDrive folder in File Explorer/Finder. For SharePoint/Teams files, click **Add shortcut to My files** (or **Sync**) in the browser library first.
3. Right-click it → **Always keep on this device**.
4. In FieldPack (Chrome or Edge): **Open → From this computer**, pick the file, and leave auto-save on. Every save goes to Excel Online automatically via the OneDrive app.

Avoid editing the same file in Excel at the same moment (OneDrive would keep both copies).

**Direct connection (Microsoft sign-in, any browser)** needs a one-time app registration:

Excel Online access uses Microsoft sign-in, which needs a free app registration (one time, about 5 minutes):

1. Open [Microsoft Entra → App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → **New registration**, name it *FieldPack*.
2. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (or your organization only).
3. Redirect URI: platform **Single-page application (SPA)**, value `<your FieldPack address>/auth-redirect.html`, e.g. `http://localhost:8080/auth-redirect.html` and/or `https://<you>.github.io/Field-Planner-App/auth-redirect.html`. Add one per address you use.
4. Copy the **Application (client) ID**. Either paste it in **Settings → Excel Online**, or put it in `js/config.js` (`msClientId`) so everyone using your published site can just sign in.
5. API permissions: Microsoft Graph delegated **User.Read** and **Files.ReadWrite.All** (a work tenant admin may need to grant consent).

## Google-powered spec checks for every user (optional relay)

"Add gear with AI" verifies specs best with Gemini + Google Search. Each user can paste their own free Gemini key (Settings → Spec lookups), but to give **everyone** that quality with **no keys**, run this small free relay that keeps **your** Gemini key secret on Cloudflare (never put an API key into the website code, because anyone could copy it):

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Workers & Pages → Create → Create Worker** (start from "Hello World"), name it e.g. `fieldpack-specs`, **Deploy**.
3. **Edit code**, replace everything with the contents of [`worker/spec-proxy.js`](worker/spec-proxy.js), **Deploy**.
4. Worker **Settings → Variables and Secrets → Add** one or both:
   - `SERPER_API_KEY`: type **Secret**, a free key from [serper.dev](https://serper.dev) (Google results, free tier, no card). Gives everyone real web search for the free lookup. (Or `TAVILY_API_KEY` from [tavily.com](https://app.tavily.com).)
   - `JINA_API_KEY` (optional): type **Secret**, a free key from [jina.ai](https://jina.ai). The relay reads product pages itself (`/read`) so lookups don't depend on each visitor's page-reader limit; this key helps with pages that need a browser to render.
   - `GEMINI_API_KEY`: type **Secret**, value = your key from [Google AI Studio](https://aistudio.google.com/apikey). Gives full Gemini + Google Search spec checks, but **Google Search grounding needs billing enabled** on that Google project (it's not part of Gemini's free tier). Without billing the app quietly falls back to the search-based lookup.
   - (optional) `GEMINI_MODEL`: type **Text**, to pin a model; otherwise the newest available Gemini Flash is picked automatically
   - `ALLOWED_ORIGINS`: type **Text**, value = `https://gareto986.github.io` (add `,http://localhost:8080` to also use it locally)
5. Copy the Worker's URL (e.g. `https://fieldpack-specs.<you>.workers.dev`) into `specProxyUrl` in [`js/config.js`](js/config.js) and push.

The relay only performs spec checks and spec searches (fixed prompt, max 8 items, short names and queries), only answers your site, and only receives gear names, brands and models, never trip details or site locations. Cloudflare's free plan covers 100,000 requests/day; Gemini's free tier has daily limits (enable billing in Google AI Studio for heavier use).

## Publish it as a web app (GitHub Pages)

FieldPack is a static site, so GitHub Pages can host it for free with no server:

1. In this repo on GitHub: **Settings → Pages**.
2. *Build and deployment* → Source: **Deploy from a branch**; Branch: **main**, folder **/ (root)** → **Save**.
3. After a minute it's live at **https://gareto986.github.io/Field-Planner-App/** (shown at the top of the Pages settings). Every push to `main` redeploys automatically.

Notes for a public site:
- Each visitor's data stays in **their own browser and their own Excel file**; nothing is shared between visitors and there's no server to run.
- AI works out of the box with the free built-in model (Chrome/Edge with WebGPU). Visitors can also connect their own cloud AI in Settings.
- For Excel Online, add `https://gareto986.github.io/Field-Planner-App/auth-redirect.html` as an SPA redirect URI in your app registration and set `msClientId` in `js/config.js`.
- Optional: use your own domain under **Settings → Pages → Custom domain**.

## Project structure

```
Start FieldPack.bat   Windows double-click launcher (runs serve.ps1)
serve.ps1             tiny PowerShell static web server
index.html            app shell
css/styles.css        theme (light/dark), board visuals, responsive layout
js/app.js             views, events, drag & drop, workbook + AI flows
js/store.js           state, categories, transport presets, localStorage
js/planner.js         auto-pack engine, bin packing, plan statistics
js/excel.js           SheetJS read/write, file handles, column mapping
js/ai.js              provider adapters, trip-brief prompt, JSON plan parsing
js/local-ai.js        free in-browser AI (WebLLM / WebGPU)
js/intake.js          "Add gear with AI" (drafts items, asks follow-up questions, verifies specs)
js/websearch.js       free web lookup for spec verification (Jina Reader + Marginalia)
js/emoji.js           icon library, search and name-based icon suggestions
js/onedrive.js        Excel Online: Microsoft sign-in (MSAL) + Microsoft Graph file access
js/config.js          site-wide settings for a published copy (Microsoft Client ID, spec relay URL)
worker/spec-proxy.js  optional Cloudflare Worker: Gemini + Google Search spec checks for all users
auth-redirect.html    Microsoft sign-in redirect page
js/sample-data.js     seed inventory
sample/               sample workbook
```

## Ideas for next steps

- Weather forecast lookup for the destination and dates
- Printable packing checklist per person
- Trip debriefs: log what was used or unused to improve future suggestions
