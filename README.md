# 🏝️🏺 FieldPack: island archaeology trip planner

A web app for planning archaeological field trips (survey, testing, excavation, monitoring), with a soft spot for the California Channel Islands. It uses **your Excel workbook as the database** of gear (supplies, containers, clothing, tools and so on) and connects to **the AI of your choice** for detailed trip analysis.

The look is inspired by the California Channel Islands: deep channel blues, kelp greens, island-fox orange, coreopsis gold and sandstone, on topo-map paper with chunky outdoor-gear buttons. It has an island terrain with an animated sea-arch scene, a ferry transport preset, and snorkel, sea-kayak, tidepooling and birding activities, plus island-ready sample gear (wetsuit, PFD, marine VHF, animal-proof food canister, sand stakes and more). It supports light and dark ("night at anchor") modes.

**Archaeology defaults:** new trips start as a 5-day island trip by ferry for a crew of 4, planned around survey and excavation. The sample inventory includes an **Archaeology** kit: trowels, 1/8" and 1/4" shaker screens, buckets, line level and unit stakes, tapes, Munsell chart, pin flags, artifact bags and tags, photo scale and north arrow, field forms, permits binder, sub-meter GNSS, kneeling pads, specimen boxes and a mattock. The AI is prompted as an archaeology logistics planner: it scales screening kit to the crew, plans for packing finds and samples out, covers recording, permits and site confidentiality, and island landing and water constraints. Visual touches include an excavation unit, shell midden and pin flags in the trip scene, a site-map scale bar with north arrow, a stratigraphic-profile strip, and history entries styled as field tags.

![tabs](https://img.shields.io/badge/views-Quick%20Plan%20·%20Pack%20Board%20·%20Inventory%20·%20History%20·%20Settings-2f6f4e)

## Features

| | |
|---|---|
| 🗺️ **Quick Planner** | Pick dates, party size, terrain, activities, transport (with weight and volume presets), must-haves and notes. A live trip card previews the plan. |
| ⚡ **Auto-pack** | A local engine scores every item against the trip and computes quantities (per person, per person per day for consumables). It trims to your weight and volume limits, chooses containers, then bin-packs items into them. |
| 🎒 **Pack Board** | A visual load-out. Bags fill up as you pack. Drag gear from the shelf into containers, and use the weight, container-fill and transport-volume gauges, the weight-by-category bar, and the over-limit and over-owned warnings. |
| 🤖 **AI analyst** | Sends the trip brief, your full inventory and the current board to Claude, OpenAI, Gemini, or any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter…). You get back a Markdown plan with a packing table, a weight check, risks and gaps, and consumables. You can apply its machine-readable packing list to the board in one click, add its suggested missing items to inventory, and ask follow-up questions. |
| 🧾 **Inventory** | Card grid with search, category filters and sort. Quick-add bar, plus a detailed editor with an emoji picker, dimensions, container capacity and max load, per-person and consumable rules, and use-case and environment tags. |
| 📜 **History** | Every saved trip goes to the workbook's **Trips** sheet, with its requirements, totals, packing list and AI analysis. You can reopen, duplicate or change the status (planned → packed → in field → completed). |
| 📗 **Excel sync** | In Chrome or Edge the app reads and **writes back into the same .xlsx file** (File System Access API), with optional auto-save. Other browsers download an updated copy. Other sheets in your workbook are left alone. |

## Run it

No build step is needed. It is static HTML/JS, but it must be served over http(s), not opened via `file://`:

```bash
cd field-trip-planner
python3 -m http.server 8080      # or: npm start
# open http://localhost:8080 in Chrome or Edge
```

On first launch you can open an existing workbook, create a new one (seeded with ~48 sample items), or just explore with sample data. A ready-made workbook is in [`sample/fieldpack-sample-database.xlsx`](sample/fieldpack-sample-database.xlsx).

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

Configure under **Settings → AI connection**. Keys are kept in the browser's localStorage only and are never written to the workbook.

| Provider | Default model | Notes |
|---|---|---|
| Anthropic Claude | `claude-opus-5-5` | Called directly from the browser (`anthropic-dangerous-direct-browser-access`). On current models, server-side refusal fallback is enabled. |
| OpenAI | `gpt-4o` | Any chat-completions model. |
| Google Gemini | `gemini-2.5-flash` | `generateContent` API. |
| OpenAI-compatible | `llama3.1` | Set a base URL, e.g. `http://localhost:11434/v1` for Ollama (start it with `OLLAMA_ORIGINS=*`). |

> Because calls run in the browser, anyone using this machine's browser profile can use the stored key. Use a key with a spending limit, or a local model.

## Project structure

```
index.html            app shell
css/styles.css        theme (light/dark), board visuals, responsive layout
js/app.js             views, events, drag & drop, workbook + AI flows
js/store.js           state, categories, transport presets, localStorage
js/planner.js         auto-pack engine, bin packing, plan statistics
js/excel.js           SheetJS read/write, file handles, column mapping
js/ai.js              provider adapters, trip-brief prompt, JSON plan parsing
js/sample-data.js     seed inventory
sample/               sample workbook
```

## Ideas for next steps

- Excel Online / OneDrive sync via Microsoft Graph
- Weather forecast lookup for the destination and dates
- Printable packing checklist per person
- Trip debriefs: log what was used or unused to improve future suggestions
