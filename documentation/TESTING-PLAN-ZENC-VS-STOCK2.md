# Testing Plan: Zenc vs Stock2 — Orders Module Comparison

**Created:** 2026-02-28
**Purpose:** Systematically test all implemented functionality across 6 completed specs, comparing zenc (legacy) vs stock2-staging (new system). Report mismatches as GitHub issues.

**Credentials:**
- Zenc: https://zenc.uksoccershop.com/webadmin/ (basic auth: footykit/worldcup2017, app login: nsrivastava2/tEst@#987xy)
- Stock2: https://stock2-staging.uksoccershop.com/login (admin@example.com/Admin@123)

---

## Phase 1: Inventory of Implemented Functionality

### Step 1: Catalog all implemented API endpoints and frontend pages
- Read all routes files in `apps/api/src/modules/orders/`
- Read all pages/components in `apps/web/src/pages/orders/`
- Produce a complete list of functionality with endpoint → UI mapping

---

## Phase 2: Order Listing Page (SPEC-02)

### Step 2: Test listing page — counts and tab counts
- Open both systems on the same status filter (e.g., "Pending", "Processing", etc.)
- Compare: total order count, tab counts (Ship By Today/Tomorrow/Two Days/After Two Days/To Be Refund)
- For each status dropdown option, compare the count shown
- **Test data:** Use status IDs that have orders (check on zenc first)

### Step 3: Test listing page — table row data
- Pick 5-10 specific orders visible on both systems
- Compare each column: Order ID, Payment Method, Customer Name, Ship Date, Order Total, Date Purchased, Status, Order Type, Sift Score, Risk Score
- Check row color coding matches between systems

### Step 4: Test listing page — filters and search
- Test status dropdown filter (3-4 different statuses)
- Test seller dropdown filter
- Test order ID search (direct navigation)
- Test general search (by customer name, email, postcode)
- Test product name/model search
- Test marketplace search (Amazon order ID)
- Test sort options (Default, Status Changed, Order Value)
- Test date interval filter (3/6/12 months)

### Step 5: Test listing page — pagination
- Compare page sizes
- Navigate to page 2, 3 on both systems — same orders?
- Test pagination with active filters

---

## Phase 3: Order Details Panel (SPEC-03)

### Step 6: Test order details panel — metadata display
- Click on 5 different orders on listing page
- Compare panel data: order ID, date, customer name, email, IP, payment method, shipping method, last modified
- Check Prime indicator display
- Check marketplace order ID display

### Step 7: Test order details panel — products display
- For the same 5 orders, compare products shown in the panel
- Check: product name, quantity, product code, attributes (size, personalization)
- Check SMS quantity display (blue number, OFS, N/A)
- Check supplier info per product

### Step 8: Test order details panel — action buttons and controls
- Check Edit/Delete button presence
- Check status dropdown population (same statuses listed?)
- Check notify customer checkbox behavior
- Check rejection buttons visibility (with permission)

---

## Phase 4: Order Edit Page Layout (SPEC-04)

### Step 9: Test edit page — header and navigation
- Open 3-4 orders in edit mode on both systems
- Compare: heading (Order #ID), Prev/Next navigation
- Test Prev/Next — do they navigate to the same orders?

### Step 10: Test edit page — customer info section
- Compare: customer name, company, address, phone, email, IP
- Check Priority/Approve labels
- Check fraud status button text

### Step 11: Test edit page — delivery and billing addresses
- Compare delivery address fields
- Compare billing address fields
- Check billing/shipping mismatch indicator

### Step 12: Test edit page — marketplace order IDs
- For marketplace orders (Amazon, eBay, Fruugo, etc.), compare displayed IDs
- Check GREEN FC Order ID if applicable
- Check Baselinker source display

### Step 13: Test edit page — order metadata and tracking
- Compare: processing archive number, date purchased, ship-by-date
- Compare tracking numbers (order products, DHL, Royal Mail, DPD)
- Compare last scan date

### Step 14: Test edit page — payment info and previous orders
- Compare payment method display
- Compare 4 previous orders links and color coding
- Compare affiliate commission display

### Step 15: Test edit page — status history
- Compare full status history table (date, admin, status, comments)
- Verify ordering (newest first)

### Step 16: Test edit page — toolbar buttons
- Compare which buttons are visible/hidden for different order types
- Check: Fraud, Process, Refund, Return, PDF Invoice, Back, Email, FC buttons

### Step 17: Test edit page — order totals section
- Compare order total, subtotal, shipping, tax amounts
- Compare currency display

---

## Phase 5: Products Table (SPEC-05)

### Step 18: Test products table — product rows and data
- For 5 orders with 2+ products, compare full products table
- Check: quantity, product name, attributes (size, personalization, badge/sponsor)
- Check product code/model
- Check row background colors (priority rules)

### Step 19: Test products table — SMS quantity and supplier info
- Compare SMS stock quantity for each product
- Compare supplier assignment display
- Compare "Last Ordered" supplier info

### Step 20: Test products table — financial columns
- Compare: Tax, Total Inc Tax, Total Inc GBP Tax for each product
- Compare backorder product display (green rows)

### Step 21: Test products table — checkboxes and action columns
- Check Pick column (checkbox state, SMS qty)
- Check Box Number values
- Check JIT checkbox state
- Check Shipped/Return/Exchange checkboxes
- Check Arrived checkbox state

---

## Phase 6: Order Status Management (SPEC-07)

### Step 22: Test status dropdown and templates
- Compare status dropdown options on edit page (same statuses, same order?)
- Test loading predefined comment templates — compare template text
- Check reply templates dropdown

### Step 23: Test status history display
- For 5 orders, compare the full status history entries
- Verify: date, admin name, status name, comments, notification flag

---

## Phase 7: Issue Reporting

### Step 24: Compile all mismatches
- For each mismatch found, create a GitHub issue with:
  - Title: `[Zenc-Stock2 Mismatch] <description>`
  - Body: order ID, field name, zenc value, stock2 value, screenshot if applicable
  - Label: `orders-porting`, `bug`

---

## Execution Notes

- **Each step = one session** to avoid context overflow
- **Do NOT fix anything** — only report as GitHub issues
- Steps 2-23 each require fetching data from both zenc and stock2
- For zenc, use WebFetch with basic auth or Playwright E2E
- For stock2, use the API directly or WebFetch
- Use the same order IDs on both systems for apples-to-apples comparison
- Pick orders across different statuses, marketplaces, and stores for coverage
