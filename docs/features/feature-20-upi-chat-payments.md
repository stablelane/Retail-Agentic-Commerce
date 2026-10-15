# Feature 20: Pay in Chat with UPI ReservePay (Pine Labs P3P)

**Goal**: Let a shopper finish the whole purchase inside the chat overlay: browse, add tickets, set up a UPI ReservePay mandate, and pay. Payment runs the Pine Labs Payments Protocol (P3P) handshake against the Pine Labs sandbox: the merchant answers with an HTTP 402 challenge, the shopper's wallet service enforces spending policy in code, mints a one-time token bound to that challenge, and the merchant captures the debit and returns a signed receipt. The card checkout page stays as the fallback.

**Status**: ✅ Implemented (offline-tested; live sandbox run pending credentials)
**Priority**: P1
**Dependencies**: Feature 18 (chat agent), Feature 19 (events catalogue, AED), the `india-agent-pay/` prototype (sibling folder, same P3P SDKs)
**Protocol references**: [ACP spec](../specs/acp-spec.md), Pine Labs P3P server/client SDKs 1.3.0 (`pinelabs-online-p3p-server-sdk`, `pinelabs-online-p3p-client-sdk`, already in `pyproject.toml` and `uv.lock`)

---

## 1. Decisions

| Question | Decision | Why |
|---|---|---|
| Protocol depth | Full P3P handshake (402 → token → capture → receipt) | The handshake is the demo's thesis. The prototype already implements both halves offline. Direct debit is the fallback if the sandbox 402 path misbehaves with real keys. |
| Currency | **No conversion.** ACP session, bag, order page and chat prices stay AED. Only the merchant's P3P challenge labels the same integer as INR (1500 fils → ₹1500 paise). | Pine Labs sandbox is INR only. One label change beats touching the catalogue, the formatter and every test. The Pine Labs receipt will read ₹ while the order page reads AED; the payment block says so. |
| Who is the payer | The PSP service (port 8001) becomes the shopper's UPI wallet: it holds the Pine Labs client, the mandate, the spend ledger and the policy guard. | Keeps Pine Labs secrets out of the Next.js runtime and the LLM. Mirrors `india-agent-pay/agent.py`. |
| Who is the payee | The merchant service (port 8000) holds the P3P server SDK and a pay route beside the ACP routes. | ACP has no 402 status; the P3P route is a shared (non-ACP) route that calls the existing completion logic. Mirrors `india-agent-pay/merchant.py`. |
| Customer identity | Mobile number. Default is a new `mobile` field on the mock user; the shopper may give another 10-digit number. Any number works in sandbox. | One persona across clients, no auth work. |
| Spending limits | Per-transaction cap and daily budget live in PSP settings and are enforced in the P3P `onChallenge` hook before a token exists. The mandate amount is the bank-side cap. | Limits outside the LLM; two independent caps. |
| Sandbox outcomes | Every catalogue price is ≥ 1500 minor units, so every debit lands in the "₹5 and above succeeds" band. | No pending (202) handling needed for the demo. See §8. |

Sandbox rules (from Pine Labs): mandates auto-approve, debit under ₹2 fails, ₹2–4.99 returns 202 pending, ≥ ₹5 succeeds, idempotency keys enforced.

---

## 2. Flow

```mermaid
sequenceDiagram
    participant B as Browser (chat)
    participant C as /api/chat (storefront :3002)
    participant W as PSP = wallet (:8001)
    participant M as Merchant (:8000)
    participant P as Pine Labs sandbox

    Note over B,M: Browse + add_to_cart as today; bag mirrored to one ACP session

    B->>C: "set up UPI for ₹2000"
    C->>W: POST /upi/mandates {mobile, amount, validity_days}
    W->>P: POST /mpp/v1/pre-authorize (server SDK create_mandate)
    P-->>W: mandate_id, deep_link, status
    W-->>C: mandate (stored in upi_mandate table)
    C-->>B: block upi_mandate (status, deep link, amount)
    B->>W: GET /api/proxy/psp/upi/mandates/{id} (poll until approved; sandbox: seconds)

    B->>C: "pay with UPI"
    C->>C: require cart.sessionId and no cart change this turn
    C->>W: POST /upi/pay {checkout_session_id, mobile}
    W->>M: GET /p3p/checkout_sessions/{id}/pay (P3P client, no credential)
    M->>M: decide_payment → challenge (amount = session total, currency INR)
    M-->>W: 402 + WWW-Authenticate challenge
    W->>W: guard(): INR, ≤ per-txn cap, ≤ daily budget, ≤ mandate available; reserve in ledger
    W->>P: POST /mpp/v1/token (one-time token bound to challenge + mandate)
    W->>M: GET same URL + P3P-Credential header (SDK retry)
    M->>M: decide_payment → verify credential
    M->>P: POST /mpp/v1/debit (capture, idempotency key = session id)
    M->>M: complete_checkout_session_from_data(provider=pinelabs); post-purchase task
    M-->>W: 200 session {order} + Payment-Receipt header
    W-->>C: {status: paid, order_id, receipt, total, spent_today}
    C-->>B: block upi_payment + cart_update {items: []}
```

Failure paths: guard raises → no token minted → `{status: refused, reason}`; Pine Labs error → reservation released → `{status: failed}`; merchant 202 → `{status: pending}` (reported, not resolved, §8); session not ready or already completed → merchant 405/200 as today.

---

## 3. Merchant changes (`src/merchant`)

| File | Change |
|---|---|
| `services/psp.py` (empty stub today) | `PineLabsOnlineServerConfig` built from settings (`env=SANDBOX`, `paymentGateway=PineLabsOnline`, `availablePaymentMethods=[RESERVE_PAY]`), one `PineLabsOnlineP3P.create(...)` instance, and `decide_upi_payment(credential_header, session_id, total) -> PaymentDecision` wrapping `decide_payment` with `ChargeOptions(amount=Amount(value=total, currency="INR"), resource=f"/p3p/checkout_sessions/{session_id}/pay", merchantOrderReference=session_id, description=f"{brand_name} order {session_id}")`. Logs a warning when credentials are unset (challenges still work; captures fail). |
| `api/routes/p3p.py` (new) | `GET /p3p/checkout_sessions/{session_id}/pay`, `dependencies=[Depends(verify_api_key)]`. Load session (404 if missing). If `order_json` is set, return the session response with 200 (idempotent; never charge twice). Read `total` from `totals_json`. Call `decide_upi_payment`. If `action != "proceed"`, return `JSONResponse(problem_details or pending_body, status=decision.status, headers=decision.headers)`. Otherwise call `complete_checkout_session_from_data(db, session_id, payment_data={"token": <Pine Labs debit id, else receipt header>, "provider": "pinelabs"}, buyer=None)`, queue `trigger_post_purchase_flow` exactly as the ACP complete route does (items from `response.line_items`, name from session buyer, language `en`), and return the session response with `decision.headers` (carries `Payment-Receipt`). Map `InvalidStateTransitionError` and `InsufficientSeatsError` to 405 via `_handle_service_error`. |
| `domain/checkout/models.py` | `PaymentProviderEnum.PINELABS = "pinelabs"`. |
| `config.py` | `pinelabs_client_id: str = ""`, `pinelabs_client_secret: str = ""`, `pinelabs_merchant_id: str = ""`. |
| `main.py` | `app.include_router(p3p_router)`. |

Architecture note: the route lives under `api/routes/` (shared), not `protocols/acp/`, and calls the protocol-agnostic `complete_checkout_session_from_data`. No ACP↔UCP import is introduced, so the boundary test stays green.

---

## 4. PSP / wallet changes (`src/payment`)

| File | Change |
|---|---|
| `config.py` | `pinelabs_client_id`, `pinelabs_client_secret`, `pinelabs_merchant_id` (all `""`), `merchant_api_url: str = "http://localhost:8000"`, `merchant_api_key: str = ""`, `upi_max_per_txn: int = 500_000` (₹5000 in paise; the dearest ticket is 230000), `upi_daily_budget: int = 1_000_000`, `upi_mandate_validity_days: int = 30`. |
| `db/models.py` | `UpiMandate(id, mobile (indexed), amount_blocked, amount_available, status, deep_link, expires_at, created_at)`. `UpiDebit(id = idempotency key (session id), mandate_id, checkout_session_id, amount, status: reserved/captured/pending/failed, created_at)`. Daily spend = `SUM(amount)` over today's rows with status in (reserved, captured, pending). This replaces the prototype's `spend.json` and its `_reserved` module state. `init_payment_tables` picks both up through `create_all`. |
| `services/pinelabs.py` (empty stub today) | Lazily built server SDK instance (mandates) and client SDK instance (paying), both from the same three credentials, `env=SANDBOX`. `create_mandate(db, mobile, amount, validity_days) -> UpiMandate` via `PineLabsOnlineP3P.create_mandate(CreateMandateOptions(mobileNumber, customerReference=mobile, amount=Amount(value, "INR"), paymentMethod=RESERVE_PAY, validityInDays, description))`, stored locally. `refresh_mandate(db, mandate_id)` via `get_mandate`, updates status and `amount_available`. `active_mandate(db, mobile)` returns the newest approved, unexpired row. `LimitExceeded(Exception)`. `make_guard(db, mandate, settings)` returns the `onChallenge` callable: `extract_amount_paise(challenge)`; refuse unless currency is INR, amount ≤ `upi_max_per_txn`, spent_today + amount ≤ `upi_daily_budget`, amount ≤ `mandate.amount_available`; on pass insert `UpiDebit(status=reserved)` and commit. `pay(db, session_id, mobile) -> dict`: find mandate (raise `MandateRequired`), build `ClientRuntimeContext(customerReference=mobile, mobileNumber=mobile, paymentMethod=RESERVE_PAY)`, create the client with `onChallenge=make_guard(...)`, call `client.get(f"{merchant_api_url}/p3p/checkout_sessions/{session_id}/pay", context=ctx, headers={"Authorization": f"Bearer {merchant_api_key}"})`. 200 → mark captured, return `{status: "paid", order_id, receipt: r.headers["Payment-Receipt"], total, currency: "INR", spent_today}`; 202 → mark pending, return `{status: "pending", detail}`; `LimitExceeded` → `{status: "refused", reason}` (no row written); `P3PError` or non-2xx → delete the reservation, return `{status: "failed", code, detail}`. The client instance is per call because the guard closes over the request's db session. |
| `api/routes/upi.py` (empty stub today) | Router prefix `/upi`, every route behind `verify_psp_api_key`. `POST /mandates` body `{mobile: ^[6-9]\d{9}$, amount: int > 0, validity_days?: int}` → 201 mandate. `GET /mandates/{mandate_id}` → refreshed mandate. `GET /mandates?mobile=` → `active_mandate` or 404 `mandate_required`. `POST /pay` body `{checkout_session_id: ^checkout_[A-Za-z0-9_-]+$, mobile}` → the `pay` dict; 409 `mandate_required` when there is no active mandate; 503 `pinelabs_not_configured` when credentials are unset. Pydantic schemas live in `api/schemas.py` next to the card ones. |
| `main.py` | `app.include_router(upi_router)`. |

---

## 5. Storefront changes (`src/storefront`)

| File | Change |
|---|---|
| `lib/commerce/user.ts` | `MOCK_USER.mobile = "9876543210"`. |
| `lib/money.ts` | `formatPaise(paise)` using `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })`. `formatCents` stays AED. |
| `lib/commerce/upi.ts` (empty stub today) | `import "server-only"`. Server-side PSP client for the executor using `getPspConfig()` (bearer key, JSON): `createMandate`, `getActiveMandate`, `payWithUpi`. Throws `PspApiError(status, code)`; a 404/409 with `mandate_required` is a normal outcome, not an error. Also exports `MOBILE = /^[6-9]\d{9}$/` and `MANDATE_ID = /^[A-Za-z0-9_-]{1,80}$/`. |
| `lib/commerce/proxy-allowlist.ts` | `PSP_PROXY_RULES` gains `{ method: "GET", path: ["upi", "mandates", MANDATE_ID] }` so the mandate block can poll from the browser. Nothing else is exposed to the browser. |
| `lib/agent/types.ts` | Two blocks. `UpiMandateBlock { type: "upi_mandate"; mandateId; mobile; amountBlocked; amountAvailable; status; deepLink: string \| null; expiresAt: string \| null }`. `UpiPaymentBlock { type: "upi_payment"; status: "paid" \| "pending" \| "refused" \| "failed"; orderId: string \| null; email: string; total: number \| null; receipt: string \| null; reason: string \| null; spentToday: number \| null }`. Add both to `UIBlock`. |
| `lib/chat/session.ts` | `BLOCK_TYPES` + `isRenderableBlock` cases: `upi_mandate` needs `typeof mandateId === "string"`; `upi_payment` needs `typeof status === "string"`. |
| `lib/agent/tools.ts` | Tools `setup_upi_mandate { amount_cents?: int 500..10_000_000, mobile?: MOBILE }` and `pay_with_upi { mobile?: MOBILE }` in `TOOL_NAMES`, `TOOL_LABELS` ("Setting up UPI…", "Paying with UPI…"), zod schemas and function schemas. Description for `pay_with_upi`: "Pay the bag from the shopper's UPI ReservePay mandate. Call only after the shopper confirms. Returns mandate_required when no mandate exists." |
| `lib/agent/executor.ts` | `ExecutorDeps` gains `upi: { createMandate, getActiveMandate, payWithUpi }`. `setupUpiMandate`: amount defaults to the larger of the current session total and 200000; call `createMandate`; emit `upi_mandate`. `payWithUpi`: fail `empty_bag` when no items; fail `cart_not_synced` with the message "the bag just changed, ask the shopper to say pay again" when `ctx.cartChanged` or `!ctx.cart.sessionId`; `getCheckoutSession` and fail `session_not_ready` unless status is `ready_for_payment`; `getActiveMandate` → on `mandate_required` return `{ ok: false, result: { error: "mandate_required" }, blocks: [] }` so the model calls `setup_upi_mandate`; call `payWithUpi`; emit `upi_payment`; on `paid` also emit `cartUpdate: { items: [], sessionId: null }`. Compact result mirrors the block fields. |
| `components/chat/blocks/UpiMandateBlock.tsx` (empty stub today) | Surface panel: mobile, blocked amount in INR (`formatPaise`), status pill, "Open UPI app" link when `deepLink` is http(s) (reuse `safeHttpUrl` logic). While status is not approved, poll `/api/proxy/psp/upi/mandates/{id}` every 2 s for up to 60 s and update in place. Footer: "Sandbox: approves automatically." |
| `components/chat/blocks/UpiPaymentBlock.tsx` (new) | Paid: "Paid ₹X via UPI" (`formatPaise`), receipt id truncated, `View order` → `orderHref(orderId, email)` via `useBlockActions().navigate`, and `saveRecentOrder` on mount so `/account` lists it. Caption: "Charged in INR by the Pine Labs sandbox; your order shows the same amount in AED." Pending: "Payment is processing" + reason. Refused: reason from the guard, and a hint to ask for a smaller bag or a larger mandate. Failed: detail + "Try the checkout page" link. |
| `components/chat/blocks/BlockRenderer.tsx` | Two cases. |
| `lib/agent/prompt.ts` | Rule 4 becomes: "To pay, first confirm the bag, then call pay_with_upi. If it returns mandate_required, call setup_upi_mandate (ask the shopper for the amount, default ₹2000) and then pay_with_upi again. Never ask for card details. start_checkout only if the shopper prefers card. Payment amounts are the same integers as the AED prices, charged as INR in this sandbox." Rule 13 gains: after add_to_cart, payment needs the next message, because the bag syncs between turns. |
| `lib/agent/router.ts` | Before the `checkout` branch: `/\b(upi|mandate|reserve ?pay)\b/` → `setup_upi_mandate`; `/\b(pay|buy)\b/` → `pay_with_upi` ("Paying from your UPI mandate."); `checkout|check out` stays `start_checkout`. |
| `lib/agent/intents.ts` | `FOLLOW_UP_SUGGESTIONS` entries for both tools (`["Pay with UPI", "View my bag"]`, `["Track my order", "Help me choose"]`). The chip list is unchanged. |

No change to the ACP proxy, the card checkout page, the cart store or the session syncer. The empty `cart_update` after a paid outcome clears the bag through the existing `applyCartUpdate` path; the syncer's cancel on a completed session already swallows the 405.

---

## 6. Configuration and deployment

Root `env.example` and `.env` (new block, next to the PSP settings):

```env
# Pine Labs P3P sandbox (dashboard → Test mode → Settings → API Keys). Shared by merchant (payee) and PSP (payer).
PINELABS_CLIENT_ID=
PINELABS_CLIENT_SECRET=
PINELABS_MERCHANT_ID=
# Wallet policy, in paise (same integers as the AED fils prices)
UPI_MAX_PER_TXN=500000
UPI_DAILY_BUDGET=1000000
# PSP → merchant call for the P3P pay route
MERCHANT_API_URL=http://localhost:8000
```

`docker-compose.yml`: `merchant` gets the three `PINELABS_*` values; `psp` gets the three `PINELABS_*` values plus `MERCHANT_API_URL=http://merchant:8000`, `MERCHANT_API_KEY=${MERCHANT_API_KEY:-merchant-api-key-12345}`, `UPI_MAX_PER_TXN`, `UPI_DAILY_BUDGET`. Both Dockerfiles install from the root `uv.lock`, which already contains the SDKs. The storefront needs nothing new: it reuses `PSP_API_URL` and `PSP_API_KEY`.

Docs: add Feature 20 to `docs/features/index.md`; add the row "UPI chat payments → this file" and the two new routes to `AGENTS.md` (documentation table, quick map); one line under Payments in `docs/architecture.md`. Run the local-path guard from `AGENTS.md`.

---

## 7. Tests and verification

Offline (no credentials; challenges are local HMAC, captures are not reached):

- `tests/merchant/api/test_p3p_pay.py`: create a session through the ACP fixtures, `GET /p3p/checkout_sessions/{id}/pay` without a credential → 402, `WWW-Authenticate` decodes (client SDK `decode_challenge`) to the session total and currency `INR`; unknown session → 404; completed session → 200 with the order and no new challenge; missing merchant API key → 401.
- `tests/payment/api/test_upi.py`: `make_guard` refuses a challenge above the per-transaction cap, refuses when today's ledger plus amount exceeds the budget, refuses when the mandate has less available, reserves on pass (ledger row exists); `POST /upi/mandates` with the server SDK's `create_mandate` monkeypatched stores and returns the mandate; `GET /upi/mandates?mobile=` 404s before and 200s after; `POST /upi/pay` without a mandate → 409; without credentials → 503. Settings are set the way `tests/payment/conftest.py` sets `PSP_API_KEY`.
- `src/storefront/__tests__/agent-executor.test.ts`: `pay_with_upi` returns `cart_not_synced` after an `add_to_cart` in the same context; returns `mandate_required` when the wallet has none; on `paid` emits one `upi_payment` block and an empty `cart_update`; `setup_upi_mandate` emits `upi_mandate`.
- `src/storefront/__tests__/chat-blocks.test.tsx`: both blocks render each status; the payment block links to the order with the signed-in email.
- Existing gates: `ruff check src/ tests/ && ruff format --check src/ tests/ && pyright src/ && pytest tests/`; in `src/storefront`: `pnpm test:run && pnpm lint && pnpm format:check && pnpm typecheck`; `tests/merchant/architecture/test_protocol_import_boundaries.py` still green.

Runtime, before credentials:

```bash
curl -s -D - -o /dev/null "http://localhost:8000/p3p/checkout_sessions/$SESSION_ID/pay" -H "Authorization: Bearer $MERCHANT_API_KEY"   # expect 402 + WWW-Authenticate
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST http://localhost:8001/upi/pay -H "Authorization: Bearer $PSP_API_KEY" -H "Content-Type: application/json" \
  -d "{\"checkout_session_id\":\"$SESSION_ID\",\"mobile\":\"9876543210\"}"   # expect 503 pinelabs_not_configured
```

Runtime, with sandbox credentials (the live path has never been exercised in this repo; expect surprises here first):

```bash
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST http://localhost:8001/upi/mandates -H "Authorization: Bearer $PSP_API_KEY" -H "Content-Type: application/json" \
  -d '{"mobile":"9876543210","amount":200000}'                                 # expect 201, status approved within seconds
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST http://localhost:8001/upi/pay -H "Authorization: Bearer $PSP_API_KEY" -H "Content-Type: application/json" \
  -d "{\"checkout_session_id\":\"$SESSION_ID\",\"mobile\":\"9876543210\"}"   # expect 200 {"status":"paid","order_id":"order_…"}
curl -s "http://localhost:8000/checkout_sessions/$SESSION_ID" -H "Authorization: Bearer $MERCHANT_API_KEY" | jq '.status, .order.id'
curl -N -s http://localhost:3002/api/chat -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"pay with UPI"}],"cart":{"sessionId":"'$SESSION_ID'","items":[{"id":"'$LINE_ID'","quantity":1}]},"context":{"page":"bag"}}'
```

Acceptance: a shopper can add a ticket, set up a mandate, and pay without leaving the chat; the merchant log shows the 402 then the capture; the order page shows the order in AED and the chat block shows the INR receipt; a bag above the per-transaction cap is refused before any Pine Labs token call appears in the PSP log; the card checkout page still works unchanged.

---

## 8. Skipped, and when to add it

- **Pending debits (202).** No catalogue price falls in the ₹2–4.99 band. Add a `GET /p3p/checkout_sessions/{id}/pay/status` route (server SDK `get_debit_status(session_id)`, complete the session on success) and PSP polling when a sandbox run returns 202, or when a cheap test product is added to demo it.
- **Refunds, mandate revoke, mandate balance view.** Add when a demo script asks for them; the server SDK has `create_refund`, `revoke_mandate`, `get_mandate_balance`.
- **Pine Labs webhooks.** Need a public tunnel; polling covers the demo.
- **Grantex / AP2 / UCP wrapper.** Add when a counterparty must verify the agent's authority independently.
- **TypeScript SDK path (`p3p-client-sdk` on npm).** Would remove the PSP hop but duplicate the guard and move Pine Labs secrets into the storefront runtime.
- **Multiple customers per wallet.** The mobile defaults to the mock user; the table is keyed by mobile, so a second shopper is a parameter change, not a redesign.
- **Direct-debit fallback.** If the 402 path fails in the sandbox, the PSP can mint a token and call `capture` itself and the storefront can call the ACP complete route with the debit id. Everything in §4 except the merchant call survives that switch.

---

## 9. As built (differences from the plan above)

- Mandate approval is Pine Labs status `ACTIVE`. `UpiMandate` stores `amount` only; `amount_available` is computed from the local ledger (`amount` minus reserved, captured and pending debits), because the SDK reports 0 when Pine Labs omits the balance.
- `UpiDebit` also stores `mobile` (daily budget is per mobile). There is no `failed` status: a failed debit's row is deleted, so every row counts as spent.
- Exceptions are `MandateRequiredError`, `LimitExceededError`, `PineLabsNotConfiguredError`. The guard is `make_guard(db, mandate, session_id)`; settings are read inside it. A retry for the same session replaces its reservation instead of counting twice.
- The merchant pay route returns 405 `session_not_ready` before issuing a challenge when the session is not `ready_for_payment`, and 409 if completion fails after the capture (the debit id is in the log for a manual refund).
- In the storefront executor, PSP errors (`PspApiError`) become tool errors with the PSP code (`upi_unavailable` when the PSP gives none), so the model can fall back to `start_checkout`.

## 10. Task list

- [ ] Pine Labs dashboard: sign up, copy `sandbox_test_…`, `sandbox_secret_…` and the Merchant ID into `.env`.
- [x] Merchant: `services/psp.py`, `api/routes/p3p.py`, `PINELABS` provider enum, settings, router wiring, `test_p3p_pay.py`.
- [x] PSP: settings, `UpiMandate` + `UpiDebit` models, `services/pinelabs.py`, `api/routes/upi.py` + schemas, router wiring, `test_upi.py`.
- [x] Storefront: mock user mobile, `formatPaise`, `lib/commerce/upi.ts`, proxy rule, block types + renderable checks, two tools (schemas, labels, executor, suggestions), prompt rules, router keywords, two block components, renderer cases, executor and block tests.
- [x] Config: root `env.example`, `.env`, compose env for merchant and PSP.
- [x] Docs: features index, `AGENTS.md`, architecture note, local-path guard.
- [x] Run all gates offline.
- [ ] Run the live sandbox walk-through in §7 and record the evidence here.
