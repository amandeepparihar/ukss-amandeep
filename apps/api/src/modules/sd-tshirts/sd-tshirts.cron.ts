import { getPendingListings } from './sd-tshirts.service';
import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { buildCsvString } from './sd-tshirts.csv';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// this function creates the soap body with the csv string created and then calls the SD api and gets the response
async function callBulkUploadStock(
  csvString: string
): Promise<{ status: string; fileName: string }> {
  const encryptedLogin = process.env.SELLER_DYNAMICS_ENCRYPTED_LOGIN;
  const retailerId = process.env.SELLER_DYNAMICS_RETAILER_ID;
  const baseUrl = process.env.SD_BASE_URL;

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <tns:BulkUploadStock xmlns:tns="https://my.sellerdynamics.com/">
      <tns:encryptedLogin>${encryptedLogin}</tns:encryptedLogin>
      <tns:retailerId>${retailerId}</tns:retailerId>
      <tns:stockString>${escapeXml(csvString)}</tns:stockString>
      <tns:importName>UKSS T-Shirts Import</tns:importName>
      <tns:retailerMarketplaceName>Amazon.co.uk</tns:retailerMarketplaceName>
      <tns:updateExistingItemsStock>false</tns:updateExistingItemsStock>
      <tns:updateExistingItemsCost>false</tns:updateExistingItemsCost>
    </tns:BulkUploadStock>
  </soap:Body>
</soap:Envelope>`;

  getLogger('sd-tshirts-cron').info('calling BulkUploadStock SOAP API');

  const response = await fetch(`${baseUrl}/api/SellerDynamicsAPI.asmx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'https://my.sellerdynamics.com/BulkUploadStock',
    },
    body: soapBody,
  });

  getLogger('sd-tshirts-cron').info(
    { httpStatus: response.status, httpStatusText: response.statusText },
    'HTTP response received'
  );

  const responseText = await response.text();

  getLogger('sd-tshirts-cron').info({ responseText }, 'BulkUploadStock response received');

  const status = responseText.match(/<status>(.*?)<\/status>/)?.[1] ?? 'Unknown';
  const fileName = responseText.match(/<fileName>(.*?)<\/fileName>/)?.[1] ?? '';

  return { status, fileName };
}

// this is the parent function. first it calls getPendingListings, then buildCsvString, then callBulkUploadStock. and based on the response updates the rows in marketplace_listings table
export async function runDailyBulkUpload() {
  getLogger('sd-tshirts-cron').info('starting daily bulk upload cron');

  // 1. fetch pending listings
  const listings = await getPendingListings();

  if (listings.length === 0) {
    getLogger('sd-tshirts-cron').info('no pending listings found, exiting');
    return;
  }

  getLogger('sd-tshirts-cron').info({ count: listings.length }, 'pending listings fetched');

  // 2. build csv
  const csvString = buildCsvString(listings);

  getLogger('sd-tshirts-cron').info({ csvString }, 'csv built successfully');

  // 3. call SD bulk upload
  let status = 'Unknown';
  let fileName = '';
  let errorMessage = '';

  try {
    const result = await callBulkUploadStock(csvString);
    status = result.status;
    fileName = result.fileName;
  } catch (err: any) {
    errorMessage = err.message ?? 'Unknown error';
    getLogger('sd-tshirts-cron').error({ err }, 'BulkUploadStock call failed');
  }

  const listingIds = listings.map((l) => l.marketplaceListingsId);
  const maxRetries = Number(process.env.SD_MAX_RETRIES) || 3;

  if (status === 'Success') {
    // 4. update all listings to confirmed
    await prisma.marketplaceListing.updateMany({
      where: { marketplaceListingsId: { in: listingIds } },
      data: {
        marketplaceListingStatus: 'confirmed',
        retryCount: 0,
        lastSyncedAt: new Date(),
        lastSyncStatus: 'success',
      },
    });

    getLogger('sd-tshirts-cron').info(
      { fileName, count: listingIds.length },
      'listings marked as confirmed'
    );
  } else {
    // 4. increment retry count, mark inactive if >= maxRetries
    for (const listing of listings) {
      const newRetryCount = listing.retryCount + 1;
      const newStatus = newRetryCount >= maxRetries ? 'inactive' : 'draft';

      await prisma.marketplaceListing.update({
        where: { marketplaceListingsId: listing.marketplaceListingsId },
        data: {
          retryCount: newRetryCount,
          marketplaceListingStatus: newStatus,
          lastSyncStatus: 'failed',
          apiLastErrorCode: 'BULK_UPLOAD_FAILED',
          apiLastErrorMessage: errorMessage || 'SD API returned non-success status',
        },
      });
    }

    getLogger('sd-tshirts-cron').info({ count: listings.length }, 'listings retry counts updated');
  }

  // 5. audit log
  const customisableCount = listings.filter((l) => l.isCustomisable).length;

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'BULK_UPLOAD',
      resource: 'SdTshirts',
      newValues: {
        status,
        fileName,
        listingCount: listingIds.length,
        // Flag split, so the upload can be checked without re-reading the CSV log line.
        custCount: customisableCount,
        podCount: listingIds.length - customisableCount,
      },
    },
  });

  getLogger('sd-tshirts-cron').info('daily bulk upload cron completed');
}

// helper for cron 2
async function callGetProductsBySku(skus: string[]): Promise<string[]> {
  const encryptedLogin = process.env.SELLER_DYNAMICS_ENCRYPTED_LOGIN;
  const retailerId = process.env.SELLER_DYNAMICS_RETAILER_ID;
  const baseUrl = process.env.SD_BASE_URL;
  const skuListXml = skus.map((sku) => `<tns:string>${escapeXml(sku)}</tns:string>`).join('\n');
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <tns:GetProductsBySKU xmlns:tns="https://my.sellerdynamics.com/">
      <tns:encryptedLogin>${encryptedLogin}</tns:encryptedLogin>
      <tns:retailerId>${retailerId}</tns:retailerId>
      <tns:skuList>
        ${skuListXml}
      </tns:skuList>
    </tns:GetProductsBySKU>
  </soap:Body>
</soap:Envelope>`;
  getLogger('sd-tshirts-cron').info({ skuCount: skus.length }, 'calling GetProductsBySKU SOAP API');
  const response = await fetch(`${baseUrl}/api/SellerDynamicsAPI.asmx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'https://my.sellerdynamics.com/GetProductsBySKU',
    },
    body: soapBody,
  });
  getLogger('sd-tshirts-cron').info(
    { httpStatus: response.status },
    'GetProductsBySKU HTTP response'
  );
  const responseText = await response.text();
  getLogger('sd-tshirts-cron').info({ responseText }, 'GetProductsBySKU response received');
  // extract all SKU values that we received. like from example. <SKU>...</SKU> tags
  const skuMatches = [...responseText.matchAll(/<SKU>(.*?)<\/SKU>/g)];
  const returnedSkus = skuMatches.map((match) => match[1]);
  getLogger('sd-tshirts-cron').info({ returnedSkus }, 'SKUs returned by SD');
  return returnedSkus;
}

// cron 2 main function
export async function runHourlySkuCheck() {
  getLogger('sd-tshirts-cron').info('starting hourly SKU check cron');
  // fetch all confirmed listings
  const confirmedListings = await prisma.marketplaceListing.findMany({
    where: {
      marketplaceListingStatus: 'confirmed',
      storeId: Number(process.env.SELLER_DYNAMICS_STORE_ID) || 151,
    },
    orderBy: { createdAt: 'desc' },
    take: Number(process.env.SD_PENDING_LIMIT) || 50,
    select: {
      marketplaceListingsId: true,
      productsSku: true,
      retryCount: true,
    },
  });
  if (confirmedListings.length === 0) {
    getLogger('sd-tshirts-cron').info('no confirmed listings found, exiting');
    return;
  }
  getLogger('sd-tshirts-cron').info(
    { count: confirmedListings.length },
    'confirmed listings fetched'
  );
  const skus = confirmedListings.map((l) => l.productsSku).filter(Boolean) as string[];
  const maxRetries = Number(process.env.SD_MAX_RETRIES) || 3;
  // call SD
  const returnedSkus = await callGetProductsBySku(skus);
  // process results
  for (const listing of confirmedListings) {
    const isActive = returnedSkus.includes(listing.productsSku!);
    if (isActive) {
      await prisma.marketplaceListing.update({
        where: { marketplaceListingsId: listing.marketplaceListingsId },
        data: {
          marketplaceListingStatus: 'active',
          retryCount: 0,
          lastSyncStatus: 'success',
          lastSyncedAt: new Date(),
        },
      });
    } else {
      const newRetryCount = listing.retryCount + 1;
      const newStatus = newRetryCount >= maxRetries ? 'inactive' : 'confirmed';
      await prisma.marketplaceListing.update({
        where: { marketplaceListingsId: listing.marketplaceListingsId },
        data: {
          retryCount: newRetryCount,
          marketplaceListingStatus: newStatus,
          lastSyncStatus: 'failed',
        },
      });
    }
  }
  getLogger('sd-tshirts-cron').info(
    { total: confirmedListings.length, activeCount: returnedSkus.length },
    'SKU check completed'
  );
  // audit log
  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'SKU_CHECK',
      resource: 'SdTshirts',
      newValues: {
        totalChecked: confirmedListings.length,
        activeCount: returnedSkus.length,
      },
    },
  });
  getLogger('sd-tshirts-cron').info('hourly SKU check cron completed');
}
