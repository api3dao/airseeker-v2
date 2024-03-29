import { z } from 'zod';

import { type EvmAddress, evmAddressSchema, type EvmId, evmIdSchema } from './config/schema';

export type AirnodeAddress = EvmAddress;
export type TemplateId = EvmId;
export type PrivateKey = string;
export type BeaconId = EvmId;
export type ChainId = string;
export type ProviderName = string;
export type SignedApiUrl = string;
export type DapiNameOrDataFeedId = string;

// Taken from https://github.com/api3dao/signed-api/blob/main/packages/api/src/schema.ts
export const signedDataSchema = z.object({
  airnode: evmAddressSchema,
  templateId: evmIdSchema,
  timestamp: z.string(),
  encodedValue: z.string(),
  signature: z.string(),
});

export type SignedData = z.infer<typeof signedDataSchema>;

export const signedApiResponseSchema = z.object({
  count: z.number().positive(),
  data: z.record(signedDataSchema),
});
