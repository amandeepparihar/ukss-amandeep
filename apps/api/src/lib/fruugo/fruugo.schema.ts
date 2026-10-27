import { z } from 'zod';

/**
 * Zod schemas for Fruugo XML order data validation
 */

// Fruugo Attribute Schema
export const FruugoAttributeSchema = z.object({
  'o:attributeName': z.string(),
  'o:attributeValue': z.string(),
});

// Fruugo Order Line Schema
export const FruugoOrderLineSchema = z.object({
  'o:productId': z.string().optional(),
  'o:skuId': z.string(),
  'o:skuName': z.string(),
  'o:fruugoProductId': z.string(),
  'o:fruugoSkuId': z.string(),
  'o:currencyCode': z.string(),
  'o:itemPriceInclVat': z.string(),
  'o:itemVat': z.string(),
  'o:totalPriceInclVat': z.string().optional(),
  'o:totalVat': z.string().optional(),
  'o:vatPercentage': z.string().optional(),
  'o:totalNumberOfItems': z.string(),
  'o:pendingItems': z.string().optional(),
  'o:confirmedItems': z.string().optional(),
  'o:shippedItems': z.string().optional(),
  'o:cancelledItems': z.string().optional(),
  'o:returnAnnouncedItems': z.string().optional(),
  'o:returnedItems': z.string().optional(),
  'o:itemsWithException': z.string().optional(),
  'o:attributes': z.object({
    'o:attribute': z.union([
      FruugoAttributeSchema,
      z.array(FruugoAttributeSchema),
    ]),
  }).optional(),
});

// Fruugo Shipping Address Schema
export const FruugoShippingAddressSchema = z.object({
  'o:firstName': z.string(),
  'o:lastName': z.string(),
  'o:streetAddress': z.string(),
  'o:city': z.string(),
  'o:province': z.string().optional(),
  'o:postalCode': z.string(),
  'o:countryCode': z.string(),
  'o:phoneNumber': z.string().optional(),
});

// Fruugo Order Schema
export const FruugoOrderSchema = z.object({
  'o:customerOrderId': z.string(),
  'o:orderId': z.string(),
  'o:orderDate': z.string(),
  'o:orderReleaseDate': z.string(),
  'o:orderStatus': z.string(),
  'o:customerLanguageCode': z.string().optional(),
  'o:shippingAddress': FruugoShippingAddressSchema,
  'o:shippingMethod': z.string().optional(),
  'o:shippingCostInclVAT': z.string(),
  'o:shippingCostVAT': z.string().optional(),
  'o:orderLines': z.object({
    'o:orderLine': z.union([
      FruugoOrderLineSchema,
      z.array(FruugoOrderLineSchema),
    ]),
  }),
  'o:shipments': z.object({
    'o:shipment': z.union([
      z.object({
        'o:shipmentId': z.string().optional(),
        'o:shippingDate': z.string().optional(),
        'o:shipmentLines': z.object({
          'o:shipmentLine': z.union([
            z.object({
              'o:fruugoProductId': z.string(),
              'o:fruugoSkuId': z.string(),
              'o:quantity': z.string(),
            }),
            z.array(z.object({
              'o:fruugoProductId': z.string(),
              'o:fruugoSkuId': z.string(),
              'o:quantity': z.string(),
            })),
          ]).optional(),
        }).optional(),
      }),
      z.array(z.object({
        'o:shipmentId': z.string().optional(),
        'o:shippingDate': z.string().optional(),
        'o:shipmentLines': z.object({
          'o:shipmentLine': z.union([
            z.object({
              'o:fruugoProductId': z.string(),
              'o:fruugoSkuId': z.string(),
              'o:quantity': z.string(),
            }),
            z.array(z.object({
              'o:fruugoProductId': z.string(),
              'o:fruugoSkuId': z.string(),
              'o:quantity': z.string(),
            })),
          ]).optional(),
        }).optional(),
      })),
    ]).optional(),
  }).optional(),
  'o:fruugoTax': z.union([z.string(), z.boolean()]).optional(),
  'o:fruugoEORI': z.string().optional(),
});

// Fruugo Orders XML Root Schema
export const FruugoOrdersXMLSchema = z.object({
  'o:orders': z.object({
    // merchantId can be parsed as number by XML parser, so accept both and coerce to string
    '@_merchantId': z.union([z.string(), z.number()]).transform(val => String(val)).optional(),
    '@_xmlns:o': z.string().optional(),
    // Preprocess: Normalize o:order to always be an array, then validate as array
    'o:order': z.preprocess(
      (val) => {
        // If it's already an array, return as is
        if (Array.isArray(val)) {
          return val;
        }
        // If it's a single object, wrap it in an array
        if (val && typeof val === 'object') {
          return [val];
        }
        // If it's undefined or null, return empty array
        return [];
      },
      z.array(FruugoOrderSchema)
    ),
  }),
});

// Type exports inferred from schemas
export type FruugoAttribute = z.infer<typeof FruugoAttributeSchema>;
export type FruugoOrderLine = z.infer<typeof FruugoOrderLineSchema>;
export type FruugoShippingAddress = z.infer<typeof FruugoShippingAddressSchema>;
export type FruugoOrder = z.infer<typeof FruugoOrderSchema>;
export type FruugoOrdersXML = z.infer<typeof FruugoOrdersXMLSchema>;
