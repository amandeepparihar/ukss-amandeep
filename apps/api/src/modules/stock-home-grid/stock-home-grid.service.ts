import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { MysteryProductBody, RemapCheckQuery, RemapSizeBody, SupplierBarcodeFetchQuery, SupplierBarcodeSavePayload, SupplierBarcodeUniqueQuery } from "./stock-home-grid.schema";
import { Prisma } from "@prisma/client";
import { BadRequestError } from "../../lib/errors";
import { directUpdateGridRow, requestGridRebuild } from "../deliveries/stock-grid-cache";

interface TeamLetter {
    team_letter: string
}

export class RemapError extends Error {
    constructor(public readonly code: 'FC_BLOCKED' | 'SIBLING_CONFLICT' | 'NOT_FOUND', message: string) {
        super(message);
        this.name = 'RemapError';
    }
}

// service for get teams letter
export async function getTeamLetters() {
    const logger = getLogger();

    logger.info("Fetching team letters for Home Stock Grid")

    const rows = await prisma.$queryRawUnsafe(`             
                SELECT
                    DISTINCT 
                    UPPER(LEFT(team_name, 1)) AS team_letter
                FROM
                    teams
                WHERE
                    team_name IS NOT NULL
                    AND TRIM(team_name) != ''
                ORDER BY
                    team_letter ASC;   
                        `
    ) as TeamLetter[];

    logger.info("Successfully fetched teams letters for Home Stock Grid");

    return rows.map((r) => ({ letter: r.team_letter }));
}


export async function addMysteryProduct(productBody: MysteryProductBody) {
    const logger = getLogger();

    logger.info({ productBody }, "Adding Product to Mystery Product List");

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {

        // NOTE: productBody.size_id is the grid DEFAULT size id (the SlickGrid column
        // `option_<default_options_values_id>` value = legacy $_POST['size'] in
        // get_data_from_grid_size). It is NOT the potvpto PK that legacy's
        // add_to_mystery_product_list received under the same name. This query resolves
        // that default size id -> potvpto.products_options_values_id (mapped_size_id),
        // which is the value legacy stores in mystery_products_mapping.mapped_product_size_id.
        const variantResolutionQuery = `
      SELECT
        potvpto.products_options_values_id AS mapped_size_id,
        pl.product_code
      FROM product_quantities AS pq
      INNER JOIN product_lists AS pl
          ON pl.product_lists_id = pq.product_lists_id
      INNER JOIN box_lists AS bl
          ON pq.box_lists_id = bl.box_lists_id
      INNER JOIN products_options_values_to_products_options AS potvpto
          ON pq.size_id = potvpto.products_options_values_to_products_options_id
      INNER JOIN manufacturers_sizes_to_default_sizes AS msds
          ON pq.size_id = msds.manufacturers_options_values_id
      WHERE pq.product_lists_id = ?
        AND bl.box_code = ?
        AND msds.default_options_values_id = ?
      LIMIT 1;
    `;

        const variants = await tx.$queryRawUnsafe(variantResolutionQuery, productBody.product_lists_id, productBody.box_code, productBody.size_id) as any[];

        if (!variants.length) {
            throw new BadRequestError('Could not resolve unique product variant using provided grid details.');
        }

        const resolvedVariant = variants[0];

        // 2. Resolve the  products_id from the new_products table
        const prodResult = await tx.$queryRawUnsafe(`SELECT products_id FROM new_products WHERE products_model = ? LIMIT 1;`, resolvedVariant.product_code) as any[];

        if (!prodResult.length) {
            throw new BadRequestError(`Product ID not found for the given product code.`);
        }
        const mappedProductId = prodResult[0].products_id;


        // 3. Deduplicate check before insert
        const existing = await tx.$queryRawUnsafe(`SELECT 1 FROM mystery_products_mapping WHERE mapped_product_id = ? AND mapped_product_size_id = ? AND mapped_product_model = ? AND added_from_sms = 1 LIMIT 1;`, mappedProductId, resolvedVariant.mapped_size_id, resolvedVariant.product_code) as any[];

        if (existing.length > 0) {
            return { success: true, message: 'Product already exists in mystery product list.' };
        }

        // 4. Perform the single Mystery Map Insert
        await tx.$queryRawUnsafe(
            `INSERT INTO mystery_products_mapping ( mapped_product_id,  mapped_product_size_id,  mapped_product_model,  added_from_sms,  created_at,  updated_at) VALUES (?, ?, ?, 1, NOW(), NOW());`,
            mappedProductId,
            resolvedVariant.mapped_size_id,
            resolvedVariant.product_code
        );

        // 5. Update the cache row
        await directUpdateGridRow(
            {
                set: {
                    modified: new Date().toISOString().slice(0, 19).replace('T', ' '),
                },
                where: {
                    byProductListsIdAndBoxcode: {
                        productListsId: productBody.product_lists_id,
                        boxcode: productBody.box_code,
                    },
                },
                callerTag: 'addToMysteryList',
            },
            tx
        );

        return { success: true, message: "Product added to mystery product list successfully." };
    })

    logger.info({ productBody }, "Successfully Added Product to Mystery Product List");

    return result;
}


export async function getSupplierBarcodeData({ product_lists_id, size }: SupplierBarcodeFetchQuery) {
    const logger = getLogger();

    logger.info({ product_lists_id, size }, "Fetching supplier barcode data for Home Stock Grid");

    // NOTE: pov here resolves the ACTUAL VARIANT size name via
    // potvpto.products_options_values_id, mirroring the CakePHP joins array actually
    // executed (index_controller.php L4561-4568), NOT the stale SQL comment in legacy
    // that referenced msds.default_options_values_id. msds is still joined and used in
    // the WHERE clause below to filter on the grid/default size. This branch also
    // intentionally has NO box_code filter -- it GROUP_CONCATs boxes across ALL boxes
    // for the barcode, grouped by pq.barcode.
    const sql = `
      SELECT
          pq.product_lists_id,
          pl.product_code,
          pl.product_name,
          pq.size_id,
          pq.barcode,
          s.season,
          pq.supplier_barcode_1,
          pov.products_options_values_name AS size_name,
          potvpto.products_options_values_id AS variant_size_id,
          TRIM(TRAILING ',' FROM GROUP_CONCAT(bl.box_code)) AS boxes
      FROM product_quantities AS pq
      INNER JOIN product_lists AS pl
          ON pl.product_lists_id = pq.product_lists_id
      INNER JOIN box_lists AS bl
          ON pq.box_lists_id = bl.box_lists_id
      INNER JOIN products_options_values_to_products_options AS potvpto
          ON pq.size_id = potvpto.products_options_values_to_products_options_id
      INNER JOIN seasons AS s
          ON s.seasons_id = pl.seasons_id
      INNER JOIN manufacturers_sizes_to_default_sizes AS msds
          ON pq.size_id = msds.manufacturers_options_values_id
      INNER JOIN products_options_values AS pov
          ON pov.products_options_values_id = potvpto.products_options_values_id
      WHERE pq.product_lists_id = ?
        AND msds.default_options_values_id = ?
      GROUP BY pq.barcode
      LIMIT 1;
    `;

    const rows = await prisma.$queryRawUnsafe(sql, product_lists_id, size) as any[];

    // Benign empty state: legacy returns HTTP 200 {status:false} here
    // (index_controller.php L4660-4662), NOT an error. Return rather than throw so a
    // deleted/mismatched variant does not surface as a 500 (error toasts / false alerts).
    if (!rows.length) {
        return { success: false, message: 'Data Not Fetched From the database.' };
    }

    const row = rows[0];

    logger.info({ product_lists_id, size }, "Successfully fetched supplier barcode data for Home Stock Grid");

    return {
        success: true,
        data: {
            product_code: row.product_code,
            product_name: row.product_name,
            size_name: row.size_name,
            season: row.season,
            barcode: row.barcode,
            supplier_barcode_1: row.supplier_barcode_1,
            boxes: row.boxes,
            // Number() guards against BigInt columns -> Fastify JSON-serialization 500.
            product_lists_id: Number(row.product_lists_id),
            // size_id = product_quantities.size_id (legacy pq_size_id); the future save
            // endpoint keys its UPDATE WHERE on this. NOT potvpto.products_options_values_id.
            size_id: Number(row.size_id),
            // sizeId = potvpto.products_options_values_id (the VARIANT POV id, legacy `sizeId`
            // at index_controller.php L4627) -- display/parity only, distinct from size_id above.
            sizeId: Number(row.variant_size_id),
        },
    };
}


export async function checkSupplierBarcodeUnique({ barcode }: SupplierBarcodeUniqueQuery) {
    const logger = getLogger();

    logger.info({ barcode }, "Checking supplier barcode uniqueness for Home Stock Grid");

    const sql = `
      SELECT
          pq.barcode,
          pq.supplier_barcode_1,
          pl.product_code,
          pov.products_options_values_name AS size_name
      FROM product_quantities AS pq
      LEFT JOIN product_lists AS pl
          ON pl.product_lists_id = pq.product_lists_id
      INNER JOIN products_options_values_to_products_options AS potvpto
          ON pq.size_id = potvpto.products_options_values_to_products_options_id
      INNER JOIN products_options_values AS pov
          ON pov.products_options_values_id = potvpto.products_options_values_id
      WHERE (
          pq.barcode = ?
          OR pq.supplier_barcode_1 = ?
      )
      LIMIT 1;
    `;

    const rows = await prisma.$queryRawUnsafe(
        sql,
        barcode, barcode
    ) as any[];

    logger.info({ barcode, found: rows.length > 0 }, "Successfully checked supplier barcode uniqueness for Home Stock Grid");

    if (!rows.length) {
        return {
            success: true,
            isNew: true, // legacy `new`
            message: 'New Barcode',
        };
    }

    const row = rows[0];

    // Ordered check mirroring legacy: first matching column (in this priority order) wins.
    const candidateFields: Array<'barcode' | 'supplier_barcode_1'> = [
        'barcode',
        'supplier_barcode_1',
    ];

    let foundField: string | null = null;
    for (const field of candidateFields) {
        if (row[field] !== null && row[field] !== undefined && String(row[field]) === barcode) {
            foundField = field;
            break;
        }
    }

    if (foundField === 'barcode') {
        return {
            success: true,
            isNew: false,
            foundField,
            message: `Barcode <b>${barcode}</b> is already assigned with product code <b>${row.product_code ?? ''}</b> and size <b>${row.size_name}</b>`,
        };
    }

    if (foundField) {
        return {
            success: true,
            isNew: false,
            foundField,
            message: `Barcode is already used for <b>${foundField}</b> with product code <b>${row.product_code ?? ''}</b> and size <b>${row.size_name}</b> and actual barcode is <b>${row.barcode}</b>`,
        };
    }

    return { success: false, isNew: false, foundField: null, message: null };
}


export async function saveSupplierBarcode(payload: SupplierBarcodeSavePayload) {
    const logger = getLogger();

    logger.info({ payload }, "Saving Barcode for this payload");

    const candidates = [
        payload.supplier_barcode_1,
    ]
        .map((v) => (v ?? '').trim())
        .filter((v) => v !== '');

    if (candidates.length > 0) {
        // 1. Reject duplicates within the submitted set itself.
        if (new Set(candidates).size !== candidates.length) {
            return { success: false, message: 'The same supplier barcode was entered more than once.' };
        }

        // 2. Reject a supplier barcode equal to the product's own primary barcode.
        if (candidates.includes(payload.barcode)) {
            return { success: false, message: `Supplier barcode ${payload.barcode} matches the product's own barcode.` };
        }

        // 3. Reject collisions with any OTHER stock row's barcode / supplier_barcode_*.
        const placeholders = candidates.map(() => '?').join(', ');
        const collisionSql = `
          SELECT pq.barcode
          FROM product_quantities AS pq
          WHERE (
              pq.barcode              IN (${placeholders})
              OR pq.supplier_barcode_1 IN (${placeholders})
          )
          AND NOT (
              pq.barcode = ? AND pq.size_id = ? AND pq.product_lists_id = ?
          )
          LIMIT 1;
        `;
        const collisionParams = [
            ...candidates, ...candidates,
            payload.barcode, payload.size_id, payload.product_lists_id,
        ];
        const collisions = (await prisma.$queryRawUnsafe(collisionSql, ...collisionParams)) as any[];
        if (collisions.length > 0) {
            logger.warn({ payload }, 'Supplier barcode save rejected: value already assigned to another product');
            return { success: false, message: 'One or more supplier barcodes are already assigned to another product.' };
        }
    }

    const sql = `
      UPDATE product_quantities
SET supplier_barcode_1 = ?,
    fc_update_product_bit = 0
WHERE barcode = ?
  AND size_id = ?
  AND product_lists_id = ?;
    `;

    const affected = await prisma.$executeRawUnsafe(
        sql,
        payload.supplier_barcode_1 || null, payload.barcode, payload.size_id, payload.product_lists_id
    ) as number;

    if (affected === 0) {
        return { success: false, message: 'No matching stock row found — nothing was updated.' };
    }

    logger.info({ payload }, "Successfully added supplier barcode for Home Stock Grid");

    return { success: true, message: 'Successfully added supplier barcode' };
}




export async function checkRemapAllowed(input: RemapCheckQuery): Promise<{
    blocked: boolean;
    reason?: string;
    barcode?: string;
    fc_product_id?: number | null;
    productCode?: string;
    productName?: string;
    current?: { sizeOptionId: number | null; sizeGroupId: number | null; currentDefaultSizeId: number | null; currentSizeId: number | null };
}> {
    const logger = getLogger();
    logger.info(input, 'Checking if remap is allowed');

    // pq.size_id is a chart-specific manufacturers_options_values_id, but the
    // caller sends the normalized default_options_values_id -- resolve via
    // manufacturers_sizes_to_default_sizes instead of comparing pq.size_id directly.
    // The matched msds row also yields the CURRENT size option / group used to
    // pre-select the modal's dependent dropdowns.
    const sql = `
        SELECT pq.barcode, pq.fc_product_id,
               pl.product_code, pl.product_name,
               msds.manufacturers_options_id AS size_option_id,
               msds.sms_size_groups_id       AS size_group_id,
               pq.size_id AS current_size_id
        FROM product_quantities pq
        INNER JOIN box_lists bl ON bl.box_lists_id = pq.box_lists_id
        INNER JOIN manufacturers_sizes_to_default_sizes msds ON msds.manufacturers_options_values_id = pq.size_id
        INNER JOIN product_lists pl ON pl.product_lists_id = pq.product_lists_id
        WHERE pq.product_lists_id = ?
          AND msds.default_options_values_id = ?
          AND bl.box_code = ?
        LIMIT 1
    `;

    const rows = await prisma.$queryRawUnsafe(sql, input.productListsId, input.sizeId, input.boxCode) as any[];

    if (!rows.length) {
        return { blocked: true, reason: 'No product_quantities row found for the given identifiers' };
    }

    const row = rows[0];
    // Number() guards against BigInt raw-column values breaking JSON serialization.
    const current = {
        sizeOptionId: row.size_option_id == null ? null : Number(row.size_option_id),
        sizeGroupId: row.size_group_id == null ? null : Number(row.size_group_id),
        currentDefaultSizeId: Number(input.sizeId),
        currentSizeId: row.current_size_id == null ? null : Number(row.current_size_id),
    };

    if (row.fc_product_id !== null) {
        return {
            blocked: true,
            reason: 'Remapping is not allowed. This product is already created on FC.',
            barcode: row.barcode,
            fc_product_id: row.fc_product_id == null ? null : Number(row.fc_product_id),
            productCode: row.product_code,
            productName: row.product_name,
            current,
        };
    }

    return {
        blocked: false,
        barcode: row.barcode,
        productCode: row.product_code,
        productName: row.product_name,
        current,
    };
}

export type RemapValidateResult =
    | { result: 'ok'; targetActualSizeId: number; oldSizeId: number; targetSizeGroupId: number | null }
    | { result: 'source_not_found'; message: string }
    | { result: 'not_in_chart'; message: string }
    | { result: 'fc_blocked'; message: string }
    | { result: 'existing'; message: string; existingBarcode: string };

/**
 * Read-only pre-write validation shared by remapSize (inside its transaction)
 * and the GET /remap-validate-size endpoint (via the base prisma client).
 * Performs the target-validity → FC guard → sibling-conflict checks WITHOUT writing.
 */
export async function validateRemapTarget(
    tx: Prisma.TransactionClient,
    input: { productListsId: number; barcode: string; targetSizeId: number; targetSizeGroupId?: number },
): Promise<RemapValidateResult> {
    // Step 1: current size_id (chart-specific manufacturers_options_values_id) — for oldSizeId + source check
    const currentRows = await tx.$queryRawUnsafe(
        `SELECT size_id FROM product_quantities WHERE product_lists_id = ? AND barcode = ? LIMIT 1`,
        input.productListsId, input.barcode
    ) as any[];
    if (!currentRows.length) {
        return { result: 'source_not_found', message: 'Source barcode not found in product_quantities.' };
    }
    const oldSizeId = Number(currentRows[0].size_id);

    // Step 2: validate the target size and resolve its size-group. Use the caller's group if given (a size can belong to >1 group); otherwise derive it from the size.
    let targetSizeGroupId: number | null = null;
    if (input.targetSizeGroupId != null) {
        const pairRow = await tx.$queryRawUnsafe(
            `SELECT sms_size_groups_id FROM manufacturers_sizes_to_default_sizes WHERE manufacturers_options_values_id = ? AND sms_size_groups_id = ? LIMIT 1`,
            input.targetSizeId, input.targetSizeGroupId
        ) as any[];
        if (!pairRow.length) {
            return { result: 'not_in_chart', message: 'Selected size is not valid for the chosen size group.' };
        }
        targetSizeGroupId = Number(input.targetSizeGroupId);
    } else {
        const targetRow = await tx.$queryRawUnsafe(
            `SELECT sms_size_groups_id FROM manufacturers_sizes_to_default_sizes WHERE manufacturers_options_values_id = ? LIMIT 1`,
            input.targetSizeId
        ) as any[];
        if (!targetRow.length) {
            return { result: 'not_in_chart', message: 'Selected size is not a valid size.' };
        }
        targetSizeGroupId = targetRow[0].sms_size_groups_id == null ? null : Number(targetRow[0].sms_size_groups_id);
    }
    const targetActualSizeId = Number(input.targetSizeId);

    // Step 3: FC guard on the target size
    const targetRows = await tx.$queryRawUnsafe(
        `SELECT fc_product_id, barcode FROM product_quantities WHERE product_lists_id = ? AND size_id = ? LIMIT 1`,
        input.productListsId, targetActualSizeId
    ) as any[];
    if (targetRows.length && targetRows[0].fc_product_id !== null) {
        return {
            result: 'fc_blocked',
            message: `Target size is already on FC (fc_product_id=${targetRows[0].fc_product_id}, barcode=${targetRows[0].barcode}). Cannot remap.`,
        };
    }

    // Step 4: sibling manufacturer-size conflict check
    const ignoreRows = await tx.$queryRawUnsafe(`
        SELECT DISTINCT ms2.manufacturers_options_values_id AS sibling_man_size_id
        FROM product_quantities pq
        INNER JOIN manufacturers_sizes_to_default_sizes ms ON ms.manufacturers_options_values_id = pq.size_id
        INNER JOIN manufacturers_sizes_to_default_sizes ms2 ON ms.default_options_values_id = ms2.default_options_values_id
        WHERE pq.product_lists_id = ? AND pq.barcode = ?
    `, input.productListsId, input.barcode) as any[];
    const ignoreSet = new Set(ignoreRows.map(r => Number(r.sibling_man_size_id)));

    const targetSiblingRows = await tx.$queryRawUnsafe(`
        SELECT DISTINCT ms2.manufacturers_options_values_id AS target_sibling_man_size_id
        FROM manufacturers_sizes_to_default_sizes ms
        INNER JOIN manufacturers_sizes_to_default_sizes ms2 ON ms.default_options_values_id = ms2.default_options_values_id
        WHERE ms.manufacturers_options_values_id = ?
    `, targetActualSizeId) as any[];

    for (const sibling of targetSiblingRows) {
        if (ignoreSet.has(Number(sibling.target_sibling_man_size_id))) continue;
        const existing = await tx.$queryRawUnsafe(
            `SELECT product_quantities_id, barcode FROM product_quantities WHERE product_lists_id = ? AND size_id = ? LIMIT 1`,
            input.productListsId, Number(sibling.target_sibling_man_size_id)
        ) as any[];
        if (existing.length) {
            return { result: 'existing', message: `Barcode ${existing[0].barcode} exists for the selected size.`, existingBarcode: existing[0].barcode };
        }
    }

    return { result: 'ok', targetActualSizeId, oldSizeId, targetSizeGroupId };
}

/** Route-facing wrapper — runs validateRemapTarget on the base client (no transaction needed for reads). */
export async function validateRemapSize(input: { productListsId: number; barcode: string; targetSizeId: number }): Promise<{ result: RemapValidateResult['result']; message: string; existingBarcode?: string }> {
    const v = await validateRemapTarget(prisma, input);
    return {
        result: v.result,
        message: 'message' in v ? v.message : '',
        existingBarcode: v.result === 'existing' ? v.existingBarcode : undefined,
    };
}

export async function remapSize(input: RemapSizeBody): Promise<{ ok: true; productListsId: number; barcode: string; targetSizeId: number; oldSizeId: number }> {
    const logger = getLogger();
    logger.info(input, 'Remapping barcode to new size');

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {

        // Steps 1-4: shared read-only validation (target-validity, FC guard, sibling conflict)
        const v = await validateRemapTarget(tx, input);
        if (v.result === 'source_not_found') throw new RemapError('NOT_FOUND', v.message);
        if (v.result === 'not_in_chart') throw new RemapError('NOT_FOUND', v.message);
        if (v.result === 'fc_blocked') throw new RemapError('FC_BLOCKED', v.message);
        if (v.result === 'existing') throw new RemapError('SIBLING_CONFLICT', v.message);
        const { targetActualSizeId, oldSizeId, targetSizeGroupId } = v;

        // Step 5: Core write — write the selected manufacturers_options_values_id (M)
        // directly (legacy parity), so a cross-size-group remap lands in the chosen chart.
        await tx.$executeRawUnsafe(
            `UPDATE product_quantities SET size_id = ?, sms_size_groups_id = ?, modified = NOW() WHERE product_lists_id = ? AND barcode = ?`,
            targetActualSizeId, targetSizeGroupId, input.productListsId, input.barcode
        );

        // Step 6: Check quantity_map for ZC sync decision
        const plRows = await tx.$queryRawUnsafe(
            `SELECT quantity_map FROM product_lists WHERE product_lists_id = ? LIMIT 1`,
            input.productListsId
        ) as any[];

        if (plRows.length && Number(plRows[0].quantity_map) === 1) {
            logger.warn(
                { productListsId: input.productListsId, barcode: input.barcode, targetSizeId: input.targetSizeId },
                'overwrite_size_sms skipped — ZC sync will happen through periodic cycles'
            );
        }

        // Step 7: Audit logging.
        // Legacy remap() does NOT write to stock_system_logs2 — it only calls
        // create_sms_quantity_log() (a CSV file) and addStockGridList() (grid
        // rebuild). The stock_system_logs2 table is shaped for *quantity*
        // changes (previous_qty/current_qty/povtpo_id), not size remaps, so a
        // meaningful DB row can't be formed. The grid cache rebuild via
        // requestGridRebuild (Step 8) is the durable audit trail; the CSV
        // logger is not replicated (no consumer reads it from Stock2).

        return { oldSizeId };
    });

    // Step 8: Grid cache refresh (outside transaction)
    await requestGridRebuild([input.productListsId], 'stock-home-grid/remap-size');

    return {
        ok: true,
        productListsId: input.productListsId,
        barcode: input.barcode,
        targetSizeId: input.targetSizeId,
        // Number() guards against BigInt columns -> Fastify JSON-serialization 500.
        oldSizeId: Number(result.oldSizeId),
    };
}
