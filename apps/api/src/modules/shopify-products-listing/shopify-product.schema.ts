import z from "zod";

export const StoreIdAndLimitParams = z.object({
  id: z.coerce.number().int().positive(), // Numeric store ID from StoreManagement table
  all: z.string().optional(),
});

export const StoreIdNumericParamSchema = z.object({
  id: z.coerce.number().int().positive(), // Numeric store ID from StoreManagement table
});

export const TokenCredentialsSchema = z.object({
  ShopUrl: z.string(),
  ApiKey: z.string(),
  SharedSecret: z.string(),
  AccessToken: z.string(),
  StoreName: z.string(),
});

export type TokenCredentials = z.infer<typeof TokenCredentialsSchema>;
