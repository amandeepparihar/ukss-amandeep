/**
 * Origin details of a product code family — country of origin + HS Code.
 * PMS #166509 (US Tariff Issue — Phase II), building on PMS #166225 / #166526.
 *
 * The origin details are the two fields a parcel leaving the UK is declared
 * with: the country the goods were made in (product_lists.country_of_origin_id
 * + the denormalised country_of_origin) and the commodity code they are
 * classified under (product_lists.hs_code). Both are properties of the PRODUCT,
 * not of the size, so both are held on the PARENT product code and carried by
 * every child of it. A child code looks like KY2217-498752, its parent KY2217;
 * product_lists.parent_product_lists_id = 0 means the code is not a child, in
 * which case it is its own parent.
 *
 * Why this file exists: before #166509 Stock2 wrote the country to the one row
 * being edited and nothing else. Once the HS Code follows the family rule in
 * SMS, a value saved here against a child size would silently disagree with
 * what SMS Checkpoint 1 then reads, and the scan gun would ask for it again. So
 * the family rule is ported and applied to BOTH fields, which also changes the
 * behaviour of the country of origin — that is deliberate, it is what stops the
 * two systems disagreeing about the same column.
 *
 * These three functions are ported one-for-one from
 * app/models/product_list.php in the SMS repository
 * (getProductCodeFamilyDetails / getOriginDetailsFamilyConflicts /
 * saveOriginDetailsForFamily) so the two can be read side by side. Keep them
 * that way: a change to the rule belongs in both.
 *
 * product_lists has no Prisma model, so every access here is raw SQL. All
 * column names verified against live zenc_main_db (CLAUDE.md Rule 6).
 */

import { prisma, Prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { toBigIntSafe } from '../../lib/utils/bigint';
import { resolveCountryOfOrigin } from './products-lookup.service';
import type { TxClient } from './products.types';

// ---------------------------------------------------------------------------
// HS Code shape
// ---------------------------------------------------------------------------

/**
 * Put an HS Code that has been typed in into the shape it is stored in, and say
 * whether what was typed is an HS Code at all.
 *
 * Unlike the country there is no master table to validate against — there is no
 * list of commodity codes in the system and suppliers send them as free text —
 * so this rule stands in for one. The codes are written down in as many ways as
 * there are people writing them down: 9505.10.00, 9505 10 00 and 95051000 are
 * the one code, so every non-digit is stripped and the digits are what gets
 * stored. Six digits is the international heading every code carries and ten is
 * the longest national code, so anything outside that is not a commodity code
 * and is refused rather than stored for somebody to trip over later.
 *
 * This is the ONE copy of the rule on this side — the Zod schema and this
 * service both call it, so what is accepted cannot drift between the two. It
 * mirrors ProductList::sanitiseHsCode() in SMS.
 *
 * @returns the digits when there are 6–10 of them, otherwise null.
 */
export function sanitiseHsCode(hsCode: string | null | undefined): string | null {
  if (hsCode == null) return null;
  const digitsOnly = String(hsCode).replace(/[^0-9]/g, '');
  if (digitsOnly.length < 6 || digitsOnly.length > 10) return null;
  return digitsOnly;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProductCodeFamilyDetails {
  product_lists_id: number;
  product_code: string;
  country_of_origin_id: number | null;
  country_of_origin: string | null;
  hs_code: string | null;
  is_child: boolean;
  parent_product_lists_id: number;
  parent_product_code: string;
  parent_country_of_origin_id: number | null;
  parent_country_of_origin: string | null;
  parent_hs_code: string | null;
}

export interface CountryOfOriginConflict {
  countries_id: number;
  country_of_origin: string | null;
  product_code: string;
}

export interface HsCodeConflict {
  hs_code: string;
  product_code: string;
}

export interface OriginDetailsFamilyConflicts {
  country_of_origin: CountryOfOriginConflict[];
  hs_code: HsCodeConflict[];
}

export interface SaveOriginDetailsResult {
  status: boolean;
  msg: string;
  parent_product_code: string;
  country_of_origin: string;
  hs_code: string;
  children_updated: number;
  /** Barcodes put back in the queue of the Green FC update cron — see resetFcUpdateProductBitForHsCodeChange. */
  fc_barcodes_requeued: number;
}

interface FamilyRow {
  product_lists_id: number;
  product_code: string;
  parent_product_lists_id: number;
  country_of_origin_id: number | null;
  country_of_origin: string | null;
  hs_code: string | null;
}

// ---------------------------------------------------------------------------
// getProductCodeFamilyDetails
// ---------------------------------------------------------------------------

/**
 * Fetch a product code along with the parent product code of its family, which
 * is what the origin details of the family are kept against.
 *
 * Returns null for a product code that is not in product_lists, or whose
 * parent_product_lists_id points at a product_lists row that is no longer
 * there — those are the two cases where there is nothing to hold the origin
 * details.
 *
 * Ported from ProductList::getProductCodeFamilyDetails().
 */
export async function getProductCodeFamilyDetails(
  productCode: string,
  client: TxClient | typeof prisma = prisma,
): Promise<ProductCodeFamilyDetails | null> {
  const ownRows = toBigIntSafe(
    await client.$queryRaw<FamilyRow[]>(Prisma.sql`
      SELECT product_lists_id, product_code, parent_product_lists_id,
             country_of_origin_id, country_of_origin, hs_code
      FROM product_lists
      WHERE product_code = ${productCode}
      LIMIT 1
    `),
  );

  if (ownRows.length === 0) return null;

  const own = ownRows[0];
  // A product code which is not a child is its own parent.
  const isChild = Number(own.parent_product_lists_id) > 0;
  const parentProductListsId = isChild
    ? Number(own.parent_product_lists_id)
    : Number(own.product_lists_id);

  const parentRows = toBigIntSafe(
    await client.$queryRaw<FamilyRow[]>(Prisma.sql`
      SELECT product_lists_id, product_code, parent_product_lists_id,
             country_of_origin_id, country_of_origin, hs_code
      FROM product_lists
      WHERE product_lists_id = ${parentProductListsId}
      LIMIT 1
    `),
  );

  if (parentRows.length === 0) return null;

  const parent = parentRows[0];

  return {
    product_lists_id: Number(own.product_lists_id),
    product_code: own.product_code,
    country_of_origin_id: own.country_of_origin_id == null ? null : Number(own.country_of_origin_id),
    country_of_origin: own.country_of_origin,
    hs_code: own.hs_code,
    is_child: isChild,
    parent_product_lists_id: Number(parent.product_lists_id),
    parent_product_code: parent.product_code,
    parent_country_of_origin_id:
      parent.country_of_origin_id == null ? null : Number(parent.country_of_origin_id),
    parent_country_of_origin: parent.country_of_origin,
    parent_hs_code: parent.hs_code,
  };
}

// ---------------------------------------------------------------------------
// getOriginDetailsFamilyConflicts
// ---------------------------------------------------------------------------

/**
 * Find out whether the origin details about to be saved against a product code
 * disagree with what the rest of that product code's family is already holding,
 * so the form can ask which of them the family is to be given.
 *
 * Both directions are covered, per field: a child being given a value its
 * parent disagrees with, and a parent being given one which one of its children
 * disagrees with. The product code being saved is left out of the comparison,
 * as its value is the one being replaced.
 *
 * A BLANK FIELD IS A FIELD THAT IS NOT BEING CHANGED and raises no conflict of
 * its own — that is what lets a caller send one of the two. The incoming HS Code
 * is sanitised before it is compared, so 9505.10.00 is not read as disagreeing
 * with the 95051000 already stored. Codes are compared as strings, never
 * numerically: 0950510 and 950510 are two different codes of different lengths.
 *
 * The children are read grouped by their origin details rather than row by row —
 * the biggest family in the system has over 500 children and this keeps it to a
 * handful of rows. Grouping by the two fields together means one country can come
 * back on several rows, once per HS Code its children hold, so the first product
 * code found per value is the one kept (the parent is looked at first, so the
 * parent is what gets named when the parent is one of the ones disagreeing).
 *
 * Ported from ProductList::getOriginDetailsFamilyConflicts().
 */
export async function getOriginDetailsFamilyConflicts(
  productCode: string,
  countryOfOriginId: number | null | undefined,
  hsCode: string | null | undefined,
  client: TxClient | typeof prisma = prisma,
): Promise<OriginDetailsFamilyConflicts> {
  const conflicts: OriginDetailsFamilyConflicts = { country_of_origin: [], hs_code: [] };

  const countriesId = Number(countryOfOriginId ?? 0);
  const checkCountryOfOrigin = Number.isFinite(countriesId) && countriesId > 0;

  const sanitisedHsCode = sanitiseHsCode(hsCode);
  const checkHsCode = sanitisedHsCode !== null;

  // Neither field is being changed, so there is nothing which could disagree.
  if (!checkCountryOfOrigin && !checkHsCode) return conflicts;

  const family = await getProductCodeFamilyDetails(productCode, client);
  // There is no family to disagree with.
  if (family === null) return conflicts;

  const countryConflicts = new Map<number, CountryOfOriginConflict>();
  const hsCodeConflicts = new Map<string, HsCodeConflict>();

  // The parent, unless the parent is the product code being saved itself.
  if (family.parent_product_lists_id !== family.product_lists_id) {
    if (
      checkCountryOfOrigin &&
      family.parent_country_of_origin_id != null &&
      family.parent_country_of_origin_id > 0 &&
      family.parent_country_of_origin_id !== countriesId
    ) {
      countryConflicts.set(family.parent_country_of_origin_id, {
        countries_id: family.parent_country_of_origin_id,
        country_of_origin: family.parent_country_of_origin,
        product_code: family.parent_product_code,
      });
    }

    if (
      checkHsCode &&
      family.parent_hs_code != null &&
      family.parent_hs_code !== '' &&
      family.parent_hs_code !== sanitisedHsCode
    ) {
      hsCodeConflicts.set(family.parent_hs_code, {
        hs_code: family.parent_hs_code,
        product_code: family.parent_product_code,
      });
    }
  }

  // Only the children holding something in a field which is being changed are
  // worth reading, so the predicate is built from which of the two was sent. A
  // country-only save therefore reads exactly the rows it read before the HS
  // Code existed. A NULL hs_code does not match `<> ''`, which is what is
  // wanted: a child which has not got one is not disagreeing about it.
  const valuePredicates: Prisma.Sql[] = [];
  if (checkCountryOfOrigin) valuePredicates.push(Prisma.sql`country_of_origin_id > 0`);
  if (checkHsCode) valuePredicates.push(Prisma.sql`hs_code <> ''`);

  const childRows = toBigIntSafe(
    await client.$queryRaw<
      Array<{
        country_of_origin_id: number | null;
        country_of_origin: string | null;
        hs_code: string | null;
        a_product_code: string;
      }>
    >(Prisma.sql`
      SELECT country_of_origin_id, country_of_origin, hs_code,
             MIN(product_code) AS a_product_code
      FROM product_lists
      WHERE parent_product_lists_id = ${family.parent_product_lists_id}
        AND product_lists_id <> ${family.product_lists_id}
        AND (${Prisma.join(valuePredicates, ' OR ')})
      GROUP BY country_of_origin_id, country_of_origin, hs_code
    `),
  );

  for (const child of childRows) {
    const childCountryId = child.country_of_origin_id == null ? 0 : Number(child.country_of_origin_id);

    // Checked on the row here rather than being left to the predicate, as a row
    // can now be in the result for its HS Code alone and have no country at all.
    if (
      checkCountryOfOrigin &&
      childCountryId > 0 &&
      childCountryId !== countriesId &&
      !countryConflicts.has(childCountryId)
    ) {
      countryConflicts.set(childCountryId, {
        countries_id: childCountryId,
        country_of_origin: child.country_of_origin,
        product_code: child.a_product_code,
      });
    }

    if (
      checkHsCode &&
      child.hs_code != null &&
      child.hs_code !== '' &&
      child.hs_code !== sanitisedHsCode &&
      !hsCodeConflicts.has(child.hs_code)
    ) {
      hsCodeConflicts.set(child.hs_code, {
        hs_code: child.hs_code,
        product_code: child.a_product_code,
      });
    }
  }

  conflicts.country_of_origin = Array.from(countryConflicts.values());
  conflicts.hs_code = Array.from(hsCodeConflicts.values());

  return conflicts;
}

// ---------------------------------------------------------------------------
// resetFcUpdateProductBitForHsCodeChange
// ---------------------------------------------------------------------------

/**
 * Put the barcodes of a product code family back in the queue of the Green FC
 * update cron, so an HS Code that has just been changed is actually carried out
 * to the warehouse instead of sitting in the database.
 *
 * The FC update cron (SMS `FcFulfillmentCenterController::update_product_on_fc`)
 * is NOT a nightly sweep of the catalogue. It picks up a barcode only while
 * `product_quantities.fc_update_product_bit` IS NULL or is not 1, and sets it to
 * 1 as soon as it has pushed it — a queue that drains. At the time of writing,
 * 588,878 of the 588,904 barcodes that exist on Green FC sit on 1. A barcode not
 * put back in that queue is never looked at again, so the commodity code the
 * warehouse holds stays whatever it was at the last push. Writing hs_code is
 * therefore only half the job; this is the other half, and it lives next to the
 * write rather than in any one route.
 *
 * THE TWO COLUMNS ARE ON DIFFERENT TABLES, which is what makes this two steps
 * rather than one: hs_code is on product_lists (one value per product code) while
 * fc_update_product_bit is on product_quantities (one per barcode, i.e. per
 * size). One HS Code change has to reach every barcode of every product code in
 * the family, and the biggest family in the system has over 500 children.
 *
 * ONLY THE BARCODES ACTUALLY ABOUT TO CHANGE are requeued — that is the hs_code
 * condition. Every save of the product form sends the HS Code along whether it
 * was touched or not, so without it a 500-child family would be queued for a
 * push on every save of any field, for nothing.
 *
 * Barcodes with no fc_product_id are left alone: they have never been created on
 * Green FC, and the create payload sends the HS Code with the product, so there
 * is nothing to catch up on.
 *
 * The country of origin gets none of this — Green FC is never sent one. All
 * three FC product payloads carry CommodityCode and no country, so a country of
 * origin change has nothing to go out to.
 *
 * MUST run BEFORE the HS Code is written: once product_lists holds the new code
 * the hs_code condition matches nothing and every barcode is passed over.
 *
 * Done through the Prisma models rather than raw SQL. A single cross-table
 * `UPDATE … INNER JOIN` would be one round trip instead of two, but neither
 * updateMany nor any other ORM call can express a join in its WHERE, so the
 * choice is raw SQL or two steps. Two steps it is: the id list is one integer per
 * product code in the family, so even the largest family in the system (500+
 * children) is a few hundred integers, which is a cheap `IN` and nothing like the
 * cost of losing schema-checked column names. Both calls take the same `client`,
 * so they stay inside the caller's transaction.
 *
 * Ported from ProductList::resetFcUpdateProductBitForHsCodeChange(), which does
 * keep the raw join — CakePHP 1.x updateAll() cannot see ProductList columns in a
 * ProductQuantity condition at all.
 *
 * @returns the number of barcodes requeued, 0 when the family already held this code.
 */
export async function resetFcUpdateProductBitForHsCodeChange(
  parentProductListsId: number,
  sanitisedHsCode: string,
  client: TxClient | typeof prisma = prisma,
): Promise<number> {
  const log = getLogger();

  if (!parentProductListsId || sanitisedHsCode === '') {
    return 0;
  }

  // The parent and every child of it, minus the codes already holding this code.
  // The null branch is written out rather than relying on `not`: a bare
  // `hsCode: { not: x }` leans on how the ORM chooses to treat NULL, and getting
  // that wrong would skip every code whose HS Code has never been set — which is
  // currently all of them.
  const familyCodes = await client.productList.findMany({
    where: {
      OR: [
        { productListsId: parentProductListsId },
        { parentProductListsId: parentProductListsId },
      ],
      AND: [{ OR: [{ hsCode: null }, { hsCode: { not: sanitisedHsCode } }] }],
    },
    select: { productListsId: true },
  });

  if (familyCodes.length === 0) {
    return 0;
  }

  const { count: barcodesRequeued } = await client.productQuantity.updateMany({
    where: {
      productListsId: { in: familyCodes.map((c) => c.productListsId) },
      // Never created on Green FC — the create payload carries the HS Code with
      // the product, so there is nothing to catch up on.
      fcProductId: { not: null },
      // Already queued, so leaving it alone keeps the count honest: what comes
      // back is the number of barcodes this call actually put back in the queue.
      AND: [{ OR: [{ fcUpdateProductBit: null }, { fcUpdateProductBit: { not: 0 } }] }],
    },
    data: { fcUpdateProductBit: 0 },
  });

  if (barcodesRequeued > 0) {
    log.info(
      { parentProductListsId, hsCode: sanitisedHsCode, productCodesInFamily: familyCodes.length, barcodesRequeued },
      'Requeued barcodes for the Green FC update cron so the new HS Code reaches the warehouse',
    );
  }

  return barcodesRequeued;
}

// ---------------------------------------------------------------------------
// saveOriginDetailsForFamily
// ---------------------------------------------------------------------------

/**
 * Make the origin details the ones the complete product code family holds, by
 * saving them against the parent product code and putting them on every child.
 *
 * This is the one place a family's origin details are written on this side.
 * Which values the family is to be given is the caller's decision; this only
 * writes them.
 *
 * EITHER FIELD ON ITS OWN IS ENOUGH, and the field that was not sent is left
 * exactly as it is on the parent and on every child — the SET list is built from
 * the fields actually supplied, so a save carrying only a country never blanks
 * the HS Code across a 500-child family. A field that WAS sent but is not valid
 * is refused and said so, rather than quietly passed over: that is somebody
 * having typed something wrong.
 *
 * The parent is worked out here from the product code given, so a caller cannot
 * make this write against some other product code, and it is read back after the
 * write so the children are only touched once the parent is proved to hold what
 * was asked for. One UPDATE for the whole family rather than a write per child.
 *
 * When the HS Code is being changed, the family's barcodes are also put back in
 * the queue of the Green FC update cron — see
 * resetFcUpdateProductBitForHsCodeChange for why writing the column is only half
 * the job, and why that has to happen before the write.
 *
 * Ported from ProductList::saveOriginDetailsForFamily().
 */
export async function saveOriginDetailsForFamily(
  productCode: string,
  countryOfOriginId: number | null | undefined,
  hsCode: string | null | undefined,
  client: TxClient | typeof prisma = prisma,
): Promise<SaveOriginDetailsResult> {
  // getLogger() is resolved HERE and not at module scope on purpose: the
  // executionId lives in AsyncLocalStorage and is only present at call time, so a
  // logger built when this module was imported would log without one. Not taken
  // as a parameter either — a caller passing a createLogger() logger would
  // silently drop the executionId again.
  const log = getLogger();

  const result: SaveOriginDetailsResult = {
    status: false,
    msg: '',
    parent_product_code: '',
    country_of_origin: '',
    hs_code: '',
    children_updated: 0,
    fc_barcodes_requeued: 0,
  };

  // Which of the two fields is being written is worked out first, and it is what
  // every step below goes by.
  let saveCountryOfOrigin = false;
  let countriesId = 0;
  if (countryOfOriginId != null && String(countryOfOriginId) !== '') {
    countriesId = Number(countryOfOriginId);
    if (!Number.isFinite(countriesId) || !Number.isInteger(countriesId) || countriesId <= 0) {
      result.msg = 'Country of origin is not valid.';
      log.warn({ productCode, countryOfOriginId }, result.msg);
      return result;
    }
    saveCountryOfOrigin = true;
  }

  let saveHsCode = false;
  let sanitisedHsCode = '';
  if (hsCode != null && String(hsCode).trim() !== '') {
    const sanitised = sanitiseHsCode(hsCode);
    if (sanitised === null) {
      result.msg = 'HS Code is not valid. It has to be 6 to 10 digits.';
      log.warn({ productCode, hsCode }, result.msg);
      return result;
    }
    sanitisedHsCode = sanitised;
    saveHsCode = true;
  }

  if (!saveCountryOfOrigin && !saveHsCode) {
    // Nothing is written without a value to write. A call carrying neither
    // would otherwise blank a family that has neither, instead of leaving it be.
    result.msg = 'Country of origin or HS Code is required.';
    log.warn({ productCode }, result.msg);
    return result;
  }

  const family = await getProductCodeFamilyDetails(productCode, client);
  if (family === null) {
    result.msg = `Product code ${productCode} or its parent product code does not exist in the system.`;
    log.warn({ productCode }, result.msg);
    return result;
  }

  result.parent_product_code = family.parent_product_code;

  // Put the family's barcodes back in the Green FC queue BEFORE the HS Code is
  // written — once product_lists holds the new code this can no longer tell which
  // barcodes are about to change. See resetFcUpdateProductBitForHsCodeChange.
  if (saveHsCode) {
    result.fc_barcodes_requeued = await resetFcUpdateProductBitForHsCodeChange(
      family.parent_product_lists_id,
      sanitisedHsCode,
      client,
    );
  }

  // Field by field, so a parent already holding one of the two is still saved
  // for the other.
  let parentNeedsSaving = false;
  let countryName: string | null = null;

  if (saveCountryOfOrigin) {
    if (
      family.parent_country_of_origin_id === countriesId &&
      family.parent_country_of_origin != null &&
      family.parent_country_of_origin !== ''
    ) {
      // The parent already holds it. The name has to be there along with the id,
      // as the name is what goes on the children — a parent holding the id with
      // the name missing goes through the write below, which re-derives it.
      result.country_of_origin = family.parent_country_of_origin;
      countryName = family.parent_country_of_origin;
    } else {
      parentNeedsSaving = true;
    }
  }

  if (saveHsCode) {
    if (family.parent_hs_code === sanitisedHsCode) {
      result.hs_code = family.parent_hs_code;
    } else {
      parentNeedsSaving = true;
    }
  }

  if (parentNeedsSaving) {
    // The country name is derived from the countries table and never trusted
    // from the caller, so the stored id and name can never disagree. Reuses the
    // existing resolver rather than writing the lookup again.
    if (saveCountryOfOrigin && countryName == null) {
      const country = await resolveCountryOfOrigin(client as TxClient, countriesId, log);
      if (country.id == null) {
        result.msg = `Country of origin ${countriesId} is not a country in the system.`;
        log.warn({ productCode, countriesId }, result.msg);
        return result;
      }
      countryName = country.name;
    }

    const parentSets: Prisma.Sql[] = [];
    if (saveCountryOfOrigin) {
      parentSets.push(Prisma.sql`country_of_origin_id = ${countriesId}`);
      parentSets.push(Prisma.sql`country_of_origin = ${countryName}`);
    }
    if (saveHsCode) {
      parentSets.push(Prisma.sql`hs_code = ${sanitisedHsCode}`);
    }

    await client.$executeRaw(Prisma.sql`
      UPDATE product_lists
      SET ${Prisma.join(parentSets, ', ')}
      WHERE product_lists_id = ${family.parent_product_lists_id}
    `);

    // Read the parent back: every field that was asked for has to be sitting
    // there before the children are touched, so a parent that could not be
    // written never leaves its children holding details it has not got itself.
    const savedRows = toBigIntSafe(
      await client.$queryRaw<
        Array<{ country_of_origin_id: number | null; country_of_origin: string | null; hs_code: string | null }>
      >(Prisma.sql`
        SELECT country_of_origin_id, country_of_origin, hs_code
        FROM product_lists
        WHERE product_lists_id = ${family.parent_product_lists_id}
        LIMIT 1
      `),
    );

    const saved = savedRows[0];

    if (
      saveCountryOfOrigin &&
      (saved == null ||
        saved.country_of_origin == null ||
        saved.country_of_origin === '' ||
        Number(saved.country_of_origin_id) !== countriesId)
    ) {
      result.msg = `Country of origin could not be saved against the parent product code ${family.parent_product_code}.`;
      log.error({ productCode, countriesId, parentProductCode: family.parent_product_code }, result.msg);
      return result;
    }

    if (saveHsCode && (saved == null || saved.hs_code !== sanitisedHsCode)) {
      result.msg = `HS Code could not be saved against the parent product code ${family.parent_product_code}.`;
      log.error({ productCode, hsCode: sanitisedHsCode, parentProductCode: family.parent_product_code }, result.msg);
      return result;
    }

    if (saveCountryOfOrigin) result.country_of_origin = saved.country_of_origin ?? '';
    if (saveHsCode) result.hs_code = saved.hs_code ?? '';
  }

  // Only the fields that were supplied go into the SET list, so sending one of
  // the two does not blank the other across the family.
  const childSets: Prisma.Sql[] = [];
  if (saveCountryOfOrigin) {
    childSets.push(Prisma.sql`country_of_origin_id = ${countriesId}`);
    childSets.push(Prisma.sql`country_of_origin = ${result.country_of_origin}`);
  }
  if (saveHsCode) {
    childSets.push(Prisma.sql`hs_code = ${result.hs_code}`);
  }

  // One UPDATE driven off the parent_product_lists_id index. The count back is
  // the number of rows MySQL CHANGED, not matched, so a family already in line
  // comes back as 0 even though it has children.
  result.children_updated = await client.$executeRaw(Prisma.sql`
    UPDATE product_lists
    SET ${Prisma.join(childSets, ', ')}
    WHERE parent_product_lists_id = ${family.parent_product_lists_id}
  `);

  result.status = true;

  log.info(
    {
      productCode,
      parentProductCode: family.parent_product_code,
      childrenUpdated: result.children_updated,
      countryOfOrigin: saveCountryOfOrigin ? result.country_of_origin : 'not being changed',
      hsCode: saveHsCode ? result.hs_code : 'not being changed',
    },
    'Origin details put across the product code family',
  );

  return result;
}
