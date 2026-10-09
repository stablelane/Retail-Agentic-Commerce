# Feature 19: Dubai Events Catalogue + Itinerary Booking

**Goal**: Replace the apparel catalogue with Dubai events and attractions from [visitdubai.com](https://www.visitdubai.com/en/festivals-and-events/dubai-events-calendar) for 1 Oct – 31 Dec 2026. The storefront becomes an event booking site, the chat agent plans a day-by-day itinerary, checks seat availability per date, and books e-tickets through the existing ACP checkout. Theme, layout and components stay as they are.

**Status**: ✅ Complete
**Priority**: P1
**Dependencies**: Feature 18
**Design reference**: [Matter Design System](../design/matter-design-system.md) (unchanged)

---

## 1. Plausibility and hard limits

| Question | Answer |
|---|---|
| Can we book real seats on visitdubai.com? | **No.** It is a Government of Dubai destination-marketing site. No ticketing, no inventory, no public API. "Book" buttons hand off to third-party vendors we have no credentials for. |
| Can we show real seat availability? | **No.** The site never shows it. Seats are **mock inventory we own** (see §3). Booking is real against our own merchant, PSP and webhooks, exactly like the apparel demo. |
| Can we scrape it? | **Yes, with a real browser only.** Akamai returns `Access Denied` to curl/httpx. The listing is rendered client-side. `robots.txt` allows the calendar path (it blocks `*?category`, `*?tags` style query URLs, which we do not need). Rate-limit to one request per second. Scrape once, commit the raw JSON, never scrape at runtime. |
| Upgrade path to real bookings | A vendor integration (Platinumlist, Tiqets, GetYourGuide). New feature, out of scope. |

Images and copy scraped from the site belong to Visit Dubai / DET. Fine for an internal demo; replace before anything public.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Event vs. date granularity | **One `Product` per event, one `EventSession` row per date** | A product-per-date (floated earlier) explodes recurring shows: La Perle alone would be ~90 cards and ~90 Milvus vectors. Sessions keep search, recommendations and the grid at one card per event. |
| Line item identity | `item.id` = **session id** (`evt_la-perle_2026-10-12`) | ACP `Item` is `{id, quantity}` and stays untouched. Merchant resolves session → product in the one shared lookup. |
| Seat inventory | `EventSession.seats_left`, decremented on checkout complete | `Product.stock_count` is never decremented today, so availability was fake. Seats live per date, where they matter. |
| Fulfillment | Single zero-cost **digital e-ticket** option, no address | Events do not ship. `generate_fulfillment_options` returns one `DigitalFulfillmentOption`; address no longer gates payment for ACP. |
| Currency | **AED** (minor unit = fils, same `*_cents` fields) | Visit Dubai prices are AED. One default on `CheckoutSession.currency`, one storefront formatter. |
| Free events | **Skipped in v1** | Zero-total checkout through the PSP is untested. Add when a free event is wanted; verify PSP accepts `amount: 0`. |
| Calendar UI | **No new page, no month grid.** Catalog page gains a date chip row. Home grid is sorted by next session. | Same page, same cards, same chips keeps the theme. Month grid is a lot of layout for ~40 events; the chat is the planner. |
| Itinerary UI | **The bag is the itinerary.** Bag groups line items by session date. | No new block, no new state. Add a saved-itinerary page when someone asks to edit a plan later. |
| Scraper | `scripts/scrape_visitdubai.py` with **Playwright**, dev-only dependency | The only client Akamai lets through. Output is committed JSON; the catalogue is generated from it. |

---

## 3. Data model

### 3.1 Catalogue file `src/data/product_catalog.py`

`ProductData` gains three fields. Everything else keeps its name so the SQLite seeder, Milvus seeder, promotion agent and products API need no renames.

```python
class ProductData(TypedDict):
    id: str                      # "evt_la-perle"
    sku: str                     # "EVT-LAPERLE"
    name: str
    price_cents: int             # AED fils, lowest "from" price
    stock_count: int             # sum of session seats (display only)
    min_margin: float            # keep 0.10, promotion agent reads it
    image_url: str               # "/evt_la-perle.jpg"
    category: str                # live-entertainment | family | sports | attractions | tours
    subcategory: str             # e.g. "theatre", "concert", "theme-park"
    description: str             # ≤ 2000 chars (Milvus text cap)
    attributes: list[str]
    lifecycle: str               # "mature"
    demand_velocity: str         # "flat"
    compare_at_price_cents: NotRequired[int | None]
    venue: str                   # NEW  "Al Habtoor City"
    source_url: str              # NEW  visitdubai.com detail URL
    sessions: list[SessionData]  # NEW


class SessionData(TypedDict):
    id: str          # "evt_la-perle_2026-10-12T20:00"
    starts_at: str   # ISO 8601, Asia/Dubai offset
    seats: int
```

Seats are invented. Seed per category: arena 500, theatre 120, attraction 300, tour 20, family 200. Mark the constant with `# ponytail: mock capacity, replace with vendor inventory when a booking API exists`.

### 3.2 DB `src/merchant/db/models.py`

```python
class Product(SQLModel, table=True):
    ...
    venue: str = Field(default="")

class EventSession(SQLModel, table=True):
    id: str = Field(primary_key=True)
    product_id: str = Field(foreign_key="product.id", index=True)
    starts_at: datetime = Field(index=True)
    seats_left: int
```

Seeder (`database.py::seed_data`) inserts sessions from the catalogue. Dev: delete the SQLite file. Docker: recreate the `acp-data` volume.

### 3.3 Raw scrape `src/data/visitdubai_2026q4.json` (committed)

One object per event: `slug, name, category, subcategory, description, venue, image_url, source_url, price_aed_from, booking_domain, dates: [{starts_at}]`. The catalogue generator reads this file; nobody reads the website at runtime.

---

## 4. Scraper `scripts/scrape_visitdubai.py`

Playwright (Chromium, headed or headless) because Akamai blocks plain HTTP clients and the list is client-rendered.

1. Open the calendar page. Set the date filter to 1 Oct – 31 Dec 2026, leave **Free** off. Click **Show results**.
2. **Preferred**: intercept the XHR the filter widget fires (`page.on("response")`), record the endpoint and payload, replay it with pagination. **Fallback**: scroll/paginate the rendered cards and collect detail URLs.
3. Visit each detail page at ≤ 1 req/s. Extract name, description, category, venue, image, price (“From AED …”), date list / show times, booking link domain. Prefer JSON-LD `Event` if present; otherwise CSS selectors.
4. Expand date ranges into explicit sessions. Recurring shows: one session per listed performance day at the listed show time; cap at one per day if times are not shown.
5. Download hero images to `src/storefront/public/evt_<slug>.jpg` and `src/ui/public/`.
6. Write `src/data/visitdubai_2026q4.json`. A second function regenerates the `PRODUCTS` list in `product_catalog.py` from it.

Target: 30–60 events. Skip events with no date or no price. Log skips. Dev dependency only (`pyproject.toml` `dev` extra); not installed in Docker images.

---

## 5. Backend changes (Merchant API)

| File | Change |
|---|---|
| `db/models.py` | `Product.venue`, new `EventSession` table (§3.2) |
| `db/database.py` | Seed sessions |
| `domain/checkout/service.py` | The three `select(Product).where(Product.id == item.id)` lookups go through one helper `resolve_line_item(db, item_id) -> (Product, EventSession)`. Raises the existing product-not-found error when the session is unknown. Rejects `quantity > seats_left` with the existing line-item validation error. On complete: `seats_left -= quantity`. `# ponytail: no row lock; SQLite single-writer is enough for the demo, use SELECT … FOR UPDATE on Postgres` |
| `domain/checkout/calculations.py` | `generate_fulfillment_options()` returns `[{"type": "digital", "id": "eticket", "title": "E-ticket", "subtitle": "Sent to your email", "subtotal": 0, "tax": 0, "total": 0}]` regardless of address. `check_ready_for_payment` drops the address requirement. Line-item `name` becomes `"La Perle · Sat 12 Oct, 20:00"` so receipts and the bag read correctly. |
| `db/models.py` `CheckoutSession.currency` | default `"AED"` |
| `api/routes/products.py` | `ProductResponse` gains `venue`, `sessions: [{id, starts_at, seats_left}]`. `GET /products?date=YYYY-MM-DD` filters to products with a session on that day (Asia/Dubai). `GET /products?from=&to=` for the agent. |
| `services/catalog_metadata.py` | Expose `venue`; no other change |
| `protocols/acp/services/post_purchase_webhook.py` | Message text “Your tickets are ready” instead of shipping copy. Event type stays `shipping_update` (spec contract). |
| `api/routes/orders.py` | Fulfillment line reads “E-ticket”; status progression collapses to `confirmed → tickets_issued`. |
| `src/agents/configs/recommendation-ultrafast.yml` | Replace apparel category list |
| `src/agents/scripts/seed_milvus.py` | No schema change. Reseed with `FORCE_RESEED=true`. |

---

## 6. Storefront changes (`src/storefront`)

| Area | Change |
|---|---|
| `lib/commerce/catalog.ts` | `CATEGORIES` → five event categories. `PRODUCT_ID_PATTERN` accepts `evt_` ids and session ids. Add `sessionDate(id)` helper. |
| `lib/content/home.ts`, `lib/content/launcher.ts` | Dubai copy. Hero: “What’s on in Dubai this season”. Grid title: “This week in Dubai”. Launcher: “Plan my weekend”, “Family days out”, “Concerts in December”. |
| `components/store/Nav.tsx` | “Catalog” → “What’s On” (route stays `/catalog`) |
| `components/store/CategoryFilters.tsx` | Second chip row: **All**, next 7 days, **Pick a date** (`<input type="date" min=2026-10-01 max=2026-12-31>`, native). Chips are links to `?date=`. |
| `app/catalog/page.tsx` | Read `date`, pass to `listProducts({category, date})`, sort by next session |
| `app/page.tsx` | Sort grid by next session |
| `components/store/ProductCard.tsx` | Two lines under the name: venue · next date. Price label “From AED 350”. |
| `app/products/[id]/page.tsx` | Native `<select>` of sessions showing date, time and “12 seats left”. Sold-out sessions disabled. `AddToBag` takes the **session id** and a quantity capped at `seats_left`. Button text “Book seats”. |
| `components/store/BagContents.tsx` | Group line items by session date with a day header. Rename page title “Your itinerary”. |
| `app/checkout/*`, `ShippingSelector.tsx` | Remove address step. Show “E-ticket · Free” as the fulfillment row. Buyer email stays. |
| `components/store/Price.tsx` | `Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" })` |
| `components/orders/*` | “Tickets issued” copy |
| `public/` | `evt_*.jpg` from the scraper, new `hero.jpg` |

Nothing changes in `globals.css` or the design tokens.

---

## 7. Chat agent changes (`src/storefront/lib/agent`)

| File | Change |
|---|---|
| `tools.ts` | Category enum swap. `list_catalog` gains `date_from?`, `date_to?` (ISO dates) → `GET /products?from=&to=`. `add_to_cart` takes `session_id` instead of `product_id`. `get_product_details` returns `sessions[]` compactly: `[{id, starts_at, seats_left}]`. |
| `prompt.ts` | Add planning rules: ask for travel dates and party size if missing; plan one day at a time; never place two sessions that overlap (assume 3 h per event unless `ends_at` given); only add a session when `seats_left ≥ party size`; say “sold out, nearest date is …” otherwise; summarise the plan as a day-by-day list before `start_checkout`. |
| `intents.ts`, `router.ts` | Replace apparel chips and keyword routes with event ones (“this weekend”, “with kids”, “concerts”, “theme parks”). |
| `executor.ts` | Carousel subtitle for `list_catalog` with a date filter becomes the day label (“Sat 12 Oct”). No new block type. |

No new tools. The carousel block already renders a day’s options; the cart block already renders the itinerary.

---

## 8. Phases

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Scraper + committed `visitdubai_2026q4.json` + generated catalogue + images | ≥ 30 events, every session inside 1 Oct – 31 Dec 2026, all prices > 0 |
| 1 | Backend: models, seeder, session resolver, seat decrement, digital fulfillment, AED, products API filters | `pytest tests/merchant` green; a session cannot be booked past `seats_left`; checkout completes without an address |
| 2 | Storefront pages: categories, date chips, card, detail session picker, bag grouping, checkout without address, AED | `pnpm test`, `pnpm lint`, `pnpm build` green; manual walk-through books two sessions on two days |
| 3 | Chat: tools, prompt, intents | Scripted conversation “3 days in Dubai, 2 adults 1 child, 12–14 Dec” yields a non-overlapping plan, refuses a sold-out session, completes checkout, order shows “Tickets issued” |
| 4 | Docs: this file, `index.md`, `AGENTS.md` quick map, `docs/architecture.md` catalogue note, env examples if currency surfaces there | `rg` path check from `AGENTS.md` returns nothing |

Phase 0 is the long pole and is content work. Phases 1–3 are each roughly six files.

---

## 9. Acceptance criteria

- Catalogue contains only Visit Dubai events with sessions between 2026-10-01 and 2026-12-31 (Asia/Dubai).
- `GET /products?date=2026-12-13` returns only events with a session that day.
- Adding a session with `quantity > seats_left` is rejected; completing checkout decrements `seats_left` by `quantity`.
- Checkout reaches `ready_for_payment` with buyer email and no address; the only fulfillment option is the digital e-ticket at 0.
- All prices render as AED in the storefront, bag, checkout, orders and chat.
- Chat plans a multi-day itinerary with no overlapping sessions and books it end-to-end.
- Catalog, home, bag and checkout pages use existing components and tokens only; no new CSS classes.

---

## 10. Verification

```bash
# Phase 0
uv run python scripts/scrape_visitdubai.py --from 2026-10-01 --to 2026-12-31
uv run python -c "from src.data.product_catalog import PRODUCTS; assert len(PRODUCTS) >= 30"

# Phase 1
rm -f data/*.db && uv run pytest tests/merchant -q

# Phase 2
cd src/storefront && pnpm lint && pnpm test && pnpm build

# Milvus
FORCE_RESEED=true docker compose up milvus-seeder
```

---

## 11. Out of scope

- Real vendor booking (Platinumlist, Tiqets, GetYourGuide).
- Free events and zero-total checkout.
- Month-grid calendar component.
- Saved or editable itinerary page.
- Runtime scraping or scheduled refresh of the catalogue.
- Hotels, flights, transport between venues.
- UCP transport (storefront stays ACP-only, as in Feature 18).
