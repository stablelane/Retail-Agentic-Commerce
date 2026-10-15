# Feature Breakdown: Agentic Commerce Blueprint

This document breaks down the project requirements into discrete, implementable features. Each feature is self-contained and can be tackled incrementally.

---

## Feature Overview

| # | Feature | Priority | Dependencies | Status |
|---|---------|----------|--------------|--------|
| 1 | [Project Foundation & Setup](./feature-01-project-foundation.md) | P0 | None | ✅ Complete |
| 2 | [Database Schema & Seed Data](./feature-02-database-schema.md) | P0 | Feature 1 | ✅ Complete |
| 3 | [ACP Core Endpoints (CRUD)](./feature-03-acp-endpoints.md) | P0 | Feature 2 | ✅ Complete |
| 4 | [API Security & Validation](./feature-04-api-security.md) | P0 | Feature 3 | ✅ Complete |
| 5 | [PSP - Delegated Payments](./feature-05-psp-payments.md) | P1 | Feature 2 | ✅ Complete |
| 6 | [Promotion Agent (NAT)](./feature-06-promotion-agent.md) | P1 | Features 3, 4 | ✅ Complete |
| 7 | [Recommendation Agent (NAT)](./feature-07-recommendation-agent.md) | P1 | Features 3, 4 | ✅ Complete |
| 8 | [Post-Purchase Agent (NAT)](./feature-08-post-purchase-agent.md) | P1 | Features 3, 4 | ✅ Complete (webhook deferred to F11) |
| 9 | [Client Agent Simulator (Frontend)](./feature-09-client-simulator.md) | P1 | Feature 3 | ✅ Complete |
| 10 | [Multi-Panel Protocol Inspector UI](./feature-10-protocol-inspector.md) | P2 | Feature 9 | ✅ Complete |
| 11 | [Webhook Integration](./feature-11-webhook-integration.md) | P2 | Feature 8 | ✅ Complete |
| 12 | [Agent Panel Checkout Flow Simulation](./feature-12-checkout-simulation.md) | P1 | Feature 9 | ✅ Complete |
| 13 | [Integration of UI and ACP Server](./feature-13-ui-acp-integration.md) | P1 | Features 3, 5, 9, 12 | ✅ Complete |
| 14 | [Enhanced Checkout (Payment & Shipping)](./feature-14-enhanced-checkout.md) | P1 | Feature 13 | ✅ Complete |
| 15 | [Multi-Language Post-Purchase Messages](./feature-15-multi-language.md) | P2 | Feature 8 | ✅ Complete |
| 16 | [Apps SDK Integration (Merchant Iframe)](./feature-16-apps-sdk.md) | P1 | Features 7, 9, 13 |  ✅ Complete |
| 17 | [UCP Protocol Integration](./feature-17-ucp-integration.md) | P1 | Features 3, 4, 5, 6, 7, 8 |  ✅ Complete |
| 18 | [Matter Storefront + AI Shopping Chat](./feature-18-matter-storefront.md) | P1 | Features 3, 5, 7, 8, 11, 14, 16 | ✅ Complete |
| 19 | [Dubai Events Catalogue + Itinerary Booking](./feature-19-dubai-events.md) | P1 | Feature 18 | ✅ Complete |

---

## Implementation Order

### Phase 1: Foundation (Features 1-4)
Build the core infrastructure and ACP-compliant API.

1. **Feature 1**: Project Foundation & Setup
2. **Feature 2**: Database Schema & Seed Data
3. **Feature 3**: ACP Core Endpoints
4. **Feature 4**: API Security & Validation

### Phase 2: Intelligence (Features 5-8)
Add payment processing and intelligent agents.

5. **Feature 5**: PSP - Delegated Payments
6. **Feature 6**: Promotion Agent
7. **Feature 7**: Recommendation Agent
8. **Feature 8**: Post-Purchase Agent

### Phase 3: Experience (Features 9-13)
Build the frontend, observability layer, and backend integration.

9. **Feature 9**: Client Agent Simulator
10. **Feature 10**: Multi-Panel Protocol Inspector
11. **Feature 11**: Webhook Integration
12. **Feature 12**: Agent Panel Checkout Flow Simulation
13. **Feature 13**: Integration of UI and ACP Server

### Phase 4: Polish (Features 14-15)
Enhance checkout experience and internationalization.

14. **Feature 14**: Enhanced Checkout (Payment & Shipping)
15. **Feature 15**: Multi-Language Post-Purchase Messages

### Phase 5: Apps SDK Integration (Feature 16)
Demonstrate alternative merchant-controlled checkout experience.

16. **Feature 16**: Apps SDK Integration (Merchant Iframe)
    - Tab switcher for Native ACP vs Apps SDK modes
    - Merchant-owned iframe with full UI control
    - ARAG-powered recommendations carousel (3 items)
    - Shopping cart with multi-item support
    - Loyalty points display for pre-authenticated user
    - Same ACP payment flow as native approach

### Phase 6: UCP Protocol Integration (Feature 17)
Add industry-standard UCP alongside existing ACP implementation.

17. **Feature 17**: UCP Protocol Integration
    - **Protocol toggle** in Merchant Activity Panel (ACP ↔ UCP tabs)
    - UCP discovery endpoint (`GET /.well-known/ucp`)
    - UCP checkout via `POST /a2a` (`message/send`, JSON-RPC 2.0)
    - **A2A transport only** (REST transport intentionally removed)
    - Capability negotiation with platform profiles
    - UCP-specific status values and error handling
    - Merchant Activity Panel tab for UCP/A2A protocol events
    - Shared NAT agents serving both ACP and UCP
    - Payment handler specifications for UCP
    - **Same client agent flow** - UI unchanged, only backend protocol switches
    - Scope: Discovery + Checkout (A2A only); other capabilities/transports out of scope

### Phase 7: Consumer Storefront (Feature 18)
Add a first-party, Matter-styled storefront whose primary interaction is an LLM shopping assistant.

18. **Feature 18**: Matter Storefront + AI Shopping Chat
    - New Next.js app at `src/storefront` (port 3002); design tokens from `docs/design/matter-design-system.md`
    - Pages: Home, Catalog, Product Detail, Bag, Checkout, Orders, Account, Contact
    - Chat overlay driven by Nemotron (NIM) with OpenAI-style tool calling and SSE streaming; deterministic fallbacks when no LLM key
    - Search and recommendations via Apps SDK MCP tools; cart and checkout directly against ACP endpoints through server-side proxies
    - Client-side cart mirrored to a single ACP checkout session (same pattern as the Apps SDK widget)
    - Loyalty display for the pre-authenticated mock user; same ACP + PSP payment flow
    - Post-purchase `shipping_update` webhooks surfaced as chat notifications
    - Merchant API additions: `GET /products` list + enrichment (`compare_at_price`), `GET /orders/{id}?email=` with deterministic status progression, `WEBHOOK_URL` fan-out
    - Scope: ACP only; no UCP, real payments, auth, or points redemption

### Phase 8: Dubai Events (Feature 19)
Replace the apparel catalogue with Visit Dubai events for 1 Oct–31 Dec 2026. The storefront books e-tickets; the chat agent plans a day-by-day itinerary.

19. **Feature 19**: Dubai Events Catalogue + Itinerary Booking
    - One product per event, one `EventSession` per performance; the bag line id is the session id
    - Mock seats per performance, decremented when checkout completes; digital e-ticket, no shipping address; currency AED
    - Catalogue generated from `src/data/visitdubai_2026q4.json` by `scripts/scrape_visitdubai.py` (dev-only Playwright; not called at runtime)
    - Catalog date chips, session picker, bag grouped by day; chat tools take `session_id` and date ranges
    - Theme, layout and components stay as in Feature 18

### Phase 9: Pay in Chat (Feature 20)
Finish the purchase inside the chat overlay with a UPI ReservePay mandate on the Pine Labs P3P sandbox.

20. **Feature 20**: UPI Chat Payments (Pine Labs P3P)
    - Full P3P handshake: merchant 402 challenge → PSP wallet guard (per-payment cap, daily budget, mandate balance) mints a token → merchant captures and returns `Payment-Receipt`
    - Merchant `GET /p3p/checkout_sessions/{id}/pay`; PSP `/upi/mandates` and `/upi/pay`
    - Chat tools `setup_upi_mandate` and `pay_with_upi`, blocks `upi_mandate` and `upi_payment`; card checkout stays as fallback
    - No currency conversion: the AED amount is charged as the same integer in INR

---

## Non-Functional Requirements (Apply to All Features)

| NFR | Requirement | Target |
|-----|-------------|--------|
| NFR-LAT | Response latency | <10s for typical operations |
| NFR-LAN | Multilingual support | EN, ES, FR |
| NFR-NIM | Inference configuration | NVIDIA API or local Docker |
| NFR-SEC | Transport security | HTTPS-only (except local dev) |
| NFR-SQL | SQL injection prevention | Parameterized queries only |
