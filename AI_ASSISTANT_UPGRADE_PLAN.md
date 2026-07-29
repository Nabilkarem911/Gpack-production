# AI Assistant Upgrade Plan — G.PACK 2.0

## Principles
- **Zero breakage**: All changes are ADDITIVE. No existing function/route/UI is modified destructively.
- **Backward compatible**: If AI is disabled, everything works as before.
- **Phase-by-phase**: Each phase is independently deployable and testable.

---

## Phase 1: Context-Aware AI (Priority: RED)
**Goal**: AI knows which page the user is on and filters responses accordingly.

### Backend
- [ ] Add `context` field to POST /api/ai-assistant/chat body (optional, ignored if missing)
- [ ] Inject context into system prompt dynamically (page name, entity IDs)
- [ ] No changes to existing ai-functions.js — context is passed to execute() as second arg

### Frontend (ai-assistant.js)
- [ ] Detect current SPA page from `window.location.hash`
- [ ] Detect context entities (client_id, order_id, etc.) from URL params or active modals
- [ ] Send `{ message, context: { page, entity_id, entity_type } }` instead of `{ message }`
- [ ] Fallback: if context detection fails, send `context: null` (same as current behavior)

### Testing
- [ ] Open warehouses page → ask "إيه اللي قارب على النفاد؟" → should filter by current warehouse if in stock modal
- [ ] Open client profile → ask "إيه آخر طلباته؟" → should use the open client automatically
- [ ] Open dashboard → ask general question → should work as before (no context)

---

## Phase 2: Daily Briefing (Priority: RED)
**Goal**: When user opens the app, AI proactively shows a morning summary.

### Backend
- [ ] New route: GET /api/ai-assistant/briefing — returns structured JSON (not AI-generated, pure SQL)
- [ ] Includes: overdue tasks count, pending quotes count, low stock count, outstanding payments total, today's sales
- [ ] Role-scoped: sales_rep sees only their data
- [ ] No changes to existing routes

### Frontend (ai-assistant.js)
- [ ] On first open each day (tracked via localStorage `ai_briefing_date`), auto-fetch briefing
- [ ] Render as a special "briefing card" in the chat (not a regular message)
- [ ] Badge on chat button: orange dot when briefing has alerts
- [ ] Dismissible: "لا تظهر اليوم" button
- [ ] Fallback: if briefing route fails, silently skip (no error to user)

### Testing
- [ ] First open of the day → briefing appears automatically
- [ ] Close and reopen → briefing does NOT reappear (localStorage check)
- [ ] Next day → briefing reappears
- [ ] Click "لا تظهر اليوم" → suppressed until tomorrow

---

## Phase 3: Rich Responses + Action Buttons (Priority: YELLOW)
**Goal**: AI responses include clickable action buttons that navigate or trigger modals.

### Backend
- [ ] AI response format extended: `{ reply: string, actions: [{ label, type, params }] }`
- [ ] Actions are hints from AI (e.g., "navigate:clients", "open_modal:quote", "filter:warehouse:5")
- [ ] System prompt updated to ask AI to suggest actions when relevant
- [ ] Actions are validated server-side (whitelist of allowed action types)

### Frontend (ai-assistant.js)
- [ ] Parse `actions` from response and render as buttons below the message
- [ ] Action types: `navigate` (SPA hash change), `open_modal` (trigger existing JS function), `filter` (set filter on current page)
- [ ] Each action calls existing JS functions — NO new business logic in the action handler

### Testing
- [ ] Ask "أكثر 5 منتجات مبيعاً" → response includes [📊 عرض في المخزون] button
- [ ] Ask "عروض الأسعار المعلقة" → response includes [➡️ فتح عرض السعر] buttons per quote
- [ ] Action buttons fail gracefully (try/catch, show toast on error)

---

## Phase 4: Smart Pricing Helper (Priority: YELLOW)
**Goal**: "اقترح سعر" button next to price fields in product/variant forms.

### Backend
- [ ] Reuse existing `suggestProductPrice` function — no new endpoint needed
- [ ] New route: GET /api/ai-assistant/suggest-price?product_name=X&target_margin=Y
- [ ] Returns structured JSON (not chat response)

### Frontend
- [ ] Add small "🤖" button next to selling_price inputs in products.js
- [ ] On click: fetch suggestion, show in a tooltip/popover
- [ ] User can accept (fills the input) or dismiss
- [ ] No changes to existing product save logic

### Testing
- [ ] Open product edit → click 🤖 → see suggested price → accept → price fills in
- [ ] Product with no sales history → shows cost-based suggestion
- [ ] Dismiss → nothing changes

---

## Phase 5: Predictive Analytics (Priority: GREEN)
**Goal**: New AI functions for forecasting and predictions.

### Backend (ai-functions.js — ADD new functions only)
- [ ] `getStockoutForecast` — predicts when stock will run out based on sales velocity
- [ ] `getSalesForecast` — predicts next month sales based on trend
- [ ] `getChurnRiskClients` — identifies clients with declining order frequency
- [ ] `getReorderSuggestions` — suggests what to reorder and from whom

### Frontend
- [ ] New suggestion chips for these functions
- [ ] No UI changes — responses render as tables in chat

### Testing
- [ ] "إمتى هينفد مخزون أكواب 250ml؟" → returns date estimate
- [ ] "كم نتوقع نبيع الشهر الجاي؟" → returns forecast
- [ ] "أي عملاء ممكن يسيبونا؟" → returns at-risk clients

---

## Phase 6: Natural Language → Actions (Priority: GREEN)
**Goal**: AI can execute operations (create quote, convert quote, add payment) with confirmation.

### Backend
- [ ] New "write" functions in a separate file `ai-actions.js` (not in ai-functions.js)
- [ ] Functions: `createQuote`, `convertQuoteToInvoice`, `addPayment`, `createProductionOrder`
- [ ] Two-step: AI proposes action → user confirms → action executes in a transaction
- [ ] All actions logged in `ai_action_log` table for audit
- [ ] Role-based: only managers can execute write actions

### Frontend
- [ ] Confirmation dialog rendered in chat (not browser confirm)
- [ ] Show action summary before execution
- [ ] Success/error feedback in chat

### Testing
- [ ] "اعمل عرض سعر للعميل أحمد بـ 100 كوب" → confirmation → quote created
- [ ] Sales rep tries write action → blocked with message
- [ ] Action fails → error shown, no partial data

---

## Phase 7: Global Smart Search (Priority: GREEN)
**Goal**: AI as universal search — returns navigation links.

### Backend
- [ ] New function `globalSearch` — searches across clients, products, orders, invoices, suppliers
- [ ] Returns categorized results with entity IDs

### Frontend
- [ ] Render search results as clickable links in chat
- [ ] Clicking navigates to the relevant page with the entity pre-selected

### Testing
- [ ] "فين فاتورة 123" → clickable link to invoice
- [ ] "دورلي على عميل اسمه أحمد" → list of matching clients as links

---

## Phase 8: Role-Based Experience (Priority: BLUE)
**Goal**: Different suggestions and default behaviors per role.

### Frontend
- [ ] SUGGESTIONS array becomes role-dependent
- [ ] Sales rep sees: "عروضي المعلقة", "عملائي", "أكثر منتجاتي"
- [ ] Manager sees: "أداء الفريق", "إجمالي المبيعات", "المستحقات"

### Backend
- [ ] System prompt adjusted per role (already partially done via _salesRepScope)

---

## Phase 9: Voice Input (Priority: BLUE)
**Goal**: Speech-to-text for the chat input.

### Frontend (ai-assistant.js only)
- [ ] Add microphone button next to send
- [ ] Use `webkitSpeechRecognition` with `lang: 'ar-SA'`
- [ ] Fallback: if not supported, button hidden (no error)

---

## Phase 10: Bulk Operations (Priority: BLUE)
**Goal**: AI can suggest and execute batch operations.

### Backend
- [ ] `bulkUpdatePrices` — apply percentage increase to category
- [ ] `bulkCreateReorders` — create purchase orders for low-stock items
- [ ] Same confirmation + audit log as Phase 6

---

## Implementation Order
1. **Phase 1** → Context-Aware (this session)
2. **Phase 2** → Daily Briefing (this session)
3. Phase 3 → Rich Responses (next session)
4. Phase 4 → Smart Pricing (next session)
5. Phase 5 → Predictive Analytics (next session)
6. Phase 6+ → Later phases

## Safety Checklist (Before Each Phase)
- [ ] No existing route signature changes
- [ ] No existing function renamed or removed
- [ ] All new code wrapped in feature checks (if AI disabled, skip)
- [ ] Frontend changes wrapped in try/catch
- [ ] Backend changes wrapped in try/catch
- [ ] No database schema changes unless new table (additive only)
- [ ] Cache version bumped for every modified frontend file
