# Orders Module — Database Column Issues Root Cause Analysis

## Summary

During the first deployment of the Orders module (SPEC-01, SPEC-02, SPEC-04) to staging, **14 database column/table name mismatches** were found causing API errors. All were fixed across PRs #192, #193, and #194.

---

## Issue Inventory

### 1. `store` → `store_management`

| | |
|---|---|
| **Used in code** | `listing.service.ts:197` — `FROM store WHERE store_url NOT LIKE '%http%'` |
| **Actual table** | `store_management` |
| **PHP source** | `orders.php:3670` — `FROM ".TABLE_STORE."` where `TABLE_STORE = DB_PREFIX . 'store_management'` |
| **Spec reference** | SPEC-02 REQ-02-007: "Dropdown from `store` table" |
| **Root cause** | The spec said "store table" (using the PHP constant name `TABLE_STORE` loosely). The implementing agent took "store" literally instead of looking up the constant definition in `database_tables.php:137`. |

### 2. `is_jit` → `jit_marked`

| | |
|---|---|
| **Used in code** | `listing.query-builder.ts:299` — `op_jit.is_jit = 0` |
| **Actual column** | `orders_products.jit_marked` (enum `'yes'`/`'no'`) |
| **PHP source** | `orders.php:1165,1184` — `jit_marked` used throughout, never `is_jit` |
| **Spec reference** | SPEC-02 REQ-02-020: "non-JIT" (conceptual, no column name given). SPEC-05/06/09 all use `jit_marked` correctly. |
| **Root cause** | The listing spec described the concept ("non-JIT") without specifying the column name. The implementing agent invented `is_jit` as a boolean column name instead of checking the actual schema. |

### 3. `backorder = 'ONBACKORDER'` → `backorder = 'Yes'`

| | |
|---|---|
| **Used in code** | `listing.query-builder.ts:303` — `op_fc.backorder = 'ONBACKORDER'` |
| **Actual values** | `enum('Yes','No','Cancelled','Replacement')` |
| **PHP source** | Not directly comparable — PHP uses different logic for FC backorder detection |
| **Spec reference** | SPEC-02 REQ-02-020: "FC ONBACKORDER" (row class name, not enum value) |
| **Root cause** | The spec's row class name `dataTableONBACKORDER` was confused with the actual enum value. The implementing agent used the CSS class name as the database value. |

### 4. `amazon_order_id` → `amazon_orders_id`

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT — `o.amazon_order_id` |
| **Actual column** | `orders.amazon_orders_id` |
| **PHP source** | `orders.php:3167,7619` — always `amazon_orders_id` |
| **Spec reference** | SPEC-02 REQ-02-013: form field `amazon_order_id`, searches `orders.amazon_orders_id` (spec was correct!) |
| **Root cause** | The spec correctly distinguished between the HTML form field name (`amazon_order_id`) and the DB column (`amazon_orders_id`). The implementing agent used the form field name for the SELECT query. |

### 5. `mplaza_order_id` → `mplaza_orders_id`

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT |
| **Actual column** | `orders.mplaza_orders_id` |
| **Root cause** | Same pattern as #4. Agent dropped the `s` from `orders`. |

### 6. `tesco_order_id` → `tesco_customer_order_id`

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT |
| **Actual column** | `orders.tesco_customer_order_id` |
| **Root cause** | Agent guessed a simplified name. The actual column has `customer_` prefix. |

### 7. `ebay_order_id` → `ebay_orders_id`

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT |
| **Actual column** | `orders.ebay_orders_id` |
| **Root cause** | Same pattern as #4/#5. |

### 8. `fruugo_order_id` → `fruugo_orders_id`

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT |
| **Actual column** | `orders.fruugo_orders_id` |
| **Root cause** | Same pattern as #4/#5/#7. |

### 9. `priceministerorderid` → `priceminister_order_id`

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT — `o.priceministerorderid` |
| **Actual column** | `orders.priceminister_order_id` |
| **PHP source** | `orders.php:3301` — `priceminister_order_id` |
| **Spec reference** | SPEC-02 REQ-02-013: correctly says `orders.priceminister_order_id` |
| **Root cause** | Agent used a camelCase-style concatenation instead of the actual underscore-separated column name. |

### 10. `shopify_order_id` → `multisite_shopify_order_id`

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT |
| **Actual column** | `orders.multisite_shopify_order_id` |
| **PHP source** | `orders.php:3433` — `multisite_shopify_order_id` |
| **Spec reference** | SPEC-10: correctly says `orders.multisite_shopify_order_id` |
| **Root cause** | Agent simplified the column name, dropping the `multisite_` prefix. |

### 11. `riskified_decision` → `riskified_status`

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT |
| **Actual column** | `orders.riskified_status` |
| **Root cause** | Agent invented a column name. The actual column is `riskified_status`, and there's also `riskified_description` — but no `riskified_decision`. |

### 12. `affiliate_publishers_id` → `affiliate_id`

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT |
| **Actual column** | `orders.affiliate_id` |
| **Root cause** | Agent used the related table's column name (`affiliate_publishers_names.publishers_id`) as the orders table column name. The orders table uses a simpler `affiliate_id`. |

### 13. `fraud_status` on orders table → only on `customers` table

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT — `o.fraud_status` |
| **Actual location** | `customers.fraud_status` (separate query) |
| **PHP source** | `orders.php:7249` — `select fraud_status from TABLE_CUSTOMERS where customers_id = ...` |
| **Spec reference** | SPEC-04 REQ-04-005/022: references `fraud_status` but SPEC-15 correctly says `customers.fraud_status` |
| **Root cause** | The edit page spec mentioned `fraud_status` without always specifying the table. The implementing agent put it in the main orders SELECT instead of the separate customer query. |

### 14. `mo_baselinker_order_source` — column doesn't exist

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT, mapped to `baselinkerSource` in response |
| **Actual column** | Does not exist in any table |
| **PHP source** | No reference in `orders.php` or anywhere in the SMS codebase |
| **Spec reference** | SPEC-04 REQ-04-018: "Baselinker source in parentheses if `mo_baselinker_order_source` not empty" |
| **Root cause** | The spec itself fabricated this column name. It was likely inferred from the `mo_marketplace_orders` table prefix and the concept of Baselinker integration, but the column was never created. This is a **spec error**. |

### 15. `extra_option` on orders table → only on `customers_tickets` table

| | |
|---|---|
| **Used in code** | `details.service.ts` ORDER_SELECT — `o.extra_option` |
| **Actual location** | `customers_tickets.extra_option` |
| **PHP source** | `orders.php:2907` — `Select extra_option from customers_tickets where orders_id = ...` |
| **Spec reference** | SPEC-04 REQ-04-010: "extra_option=4 means cancellation requested" |
| **Root cause** | Same pattern as #13. The spec referenced the field without specifying the table. The implementing agent added it to the main orders SELECT. |

### 16. `admin_firstname` + `admin_lastname` → `admin_name`

| | |
|---|---|
| **Used in code** | `details.service.ts:218` — `a.admin_firstname, a.admin_lastname` |
| **Actual column** | `admin.admin_name` (single column) |
| **PHP source** | `orders.php:3727` — `select admin_name from TABLE_ADMIN` |
| **Spec reference** | SPEC-04 REQ-04-004: says "admin name" conceptually, never specifies column names |
| **Root cause** | Agent assumed a typical first/last name split pattern. The SMS admin table uses a single `admin_name` column. |

---

## Root Cause Analysis

### Why did the specs have wrong column names?

The issues fall into **three categories**:

#### Category 1: Spec was correct, implementing agent got it wrong (6 issues)
Issues #4, #5, #7, #8, #9, #10

The specs either correctly specified the DB column or didn't specify column names at all (just marketplace names). The implementing agent:
- Used HTML form field names instead of DB column names
- Dropped prefixes (`multisite_`, `customer_`)
- Dropped the plural `s` from `_orders_id` → `_order_id`
- Used camelCase concatenation instead of underscores

**Prevention**: Always verify column names against `INFORMATION_SCHEMA.COLUMNS` before writing `$queryRaw` statements.

#### Category 2: Spec was ambiguous, implementing agent assumed wrong table (4 issues)
Issues #1, #13, #15, #16

The specs referenced a column/concept without specifying which table it belongs to:
- `fraud_status` → on `customers`, not `orders`
- `extra_option` → on `customers_tickets`, not `orders`
- `store` → PHP constant `TABLE_STORE` maps to `store_management`
- `admin_name` → single column, not first/last split

**Prevention**: Specs should always use `table.column` format. When implementing against a shared legacy DB, look up the PHP source for the actual query.

#### Category 3: Spec fabricated a column that doesn't exist (2 issues)
Issues #2, #3, #11, #12, #14

These columns were invented either by the spec or the implementing agent:
- `mo_baselinker_order_source` — fabricated entirely in the spec
- `is_jit` — agent invented based on the concept "non-JIT"
- `riskified_decision` — agent invented; actual is `riskified_status`
- `affiliate_publishers_id` — agent used the lookup table's column name

**Prevention**: Never assume column names. Every raw SQL column must be verified against the actual database schema.

---

## Prevention Rules

1. **Always verify against the actual DB** before writing any `$queryRaw` / `$queryRawUnsafe` statement:
   ```sql
   SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='zenc_main_db' AND TABLE_NAME='orders'
   AND COLUMN_NAME IN ('col1','col2',...);
   ```

2. **Check the PHP source** (`/mnt/2tbdisk/proxmox-home-dir/ukss/UKSS-Production/webadmin/orders.php`) for the exact query being migrated. Don't infer column names from spec descriptions.

3. **Specs must use `table.column` format** when referencing database fields. Ambiguous references like "fraud_status" without a table name lead to wrong table assumptions.

4. **Test against staging DB before deployment**. The `.env.staging` file contains credentials for direct DB access during development.

5. **ZenCart constant names ≠ table names**. Always look up the constant definition in `database_tables.php`. `TABLE_STORE` → `store_management`, not `store`.
