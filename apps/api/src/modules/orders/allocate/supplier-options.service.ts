import { getSupplierFreeQuantity } from './free-quantity.service';
import { deriveLineMetadata, getManufacturerFilteredSuppliers } from './allocate.queries';
import type { SupplierOptionsResponse, SupplierOptionLine } from './allocate.types';

export async function getSupplierOptions(orderId: number, orderProductIds: number[]): Promise<SupplierOptionsResponse> {
  const lines: SupplierOptionLine[] = [];
  for (const opid of orderProductIds) {
    const metadata = await deriveLineMetadata(orderId, opid);
    if (!metadata) continue;
    const freeQuantity = await getSupplierFreeQuantity({
      productId: metadata.productId,
      optionValueId: metadata.productsOptionsValuesId,
      pvtId: metadata.pvtId,
      defaultOptionValueId: metadata.defaultOptionValueId,
    });
    lines.push({ metadata, freeQuantity });
  }
  const manufacturerIds = [...new Set(lines.map(l => l.metadata.manufacturersId))];
  const suppliers = await getManufacturerFilteredSuppliers(manufacturerIds);
  return { lines, suppliers };
}
