import { clearInterval } from 'node:timers';
import { go, goSync } from '@api3/promise-utils';
import axios from 'axios';
import { uniq } from 'lodash';
import { signedApiResponseSchema, type SignedData } from '../types';
import * as localDataStore from '../signed-data-store';
import { getState, setState } from '../state';
import { logger } from '../logger';
import { HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT, HTTP_SIGNED_DATA_API_HEADROOM } from '../constants';

// Express handler/endpoint path: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/server.ts#L33
// Actual handler fn: https://github.com/api3dao/signed-api/blob/b6e0d0700dd9e7547b37eaa65e98b50120220105/packages/api/src/handlers.ts#L81

/**
 * Shuts down intervals
 */
export const stopDataFetcher = () => {
  clearInterval(getState().dataFetcherInterval);
};

/**
 * Calls a remote signed data URL and inserts the result into the datastore
 * @param url
 */
const callSignedDataApi = async (url: string): Promise<SignedData[]> => {
  const result = await go(
    async () =>
      axios({
        method: 'get',
        timeout: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT - HTTP_SIGNED_DATA_API_HEADROOM / 2,
        url,
        headers: {
          Accept: 'application/json',
          // TODO add API key?
        },
      }),
    {
      attemptTimeoutMs: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT,
      totalTimeoutMs: HTTP_SIGNED_DATA_API_ATTEMPT_TIMEOUT + HTTP_SIGNED_DATA_API_HEADROOM / 2,
      retries: 0,
    }
  );

  if (!result.success) {
    throw new Error([`HTTP call failed: `, url, result.error].join('\n'));
  }

  const { data } = signedApiResponseSchema.parse(result.data.data);

  return Object.values(data);
};

export const runDataFetcher = async () => {
  const state = getState();
  const { config, dataFetcherInterval } = state;

  const fetchInterval = config.fetchInterval * 1000;

  if (!dataFetcherInterval) {
    const dataFetcherInterval = setInterval(runDataFetcher, fetchInterval);
    setState({ ...state, dataFetcherInterval });
  }

  const urls = uniq(
    Object.values(config.chains).flatMap((chain) =>
      Object.entries(chain.__Temporary__DapiDataRegistry.airnodeToSignedApiUrl).flatMap(
        ([airnodeAddress, baseUrl]) => `${baseUrl}/${airnodeAddress}`
      )
    )
  );

  return Promise.allSettled(
    urls.map(async (url) =>
      go(
        async () => {
          const payload = await callSignedDataApi(url);

          for (const element of payload) {
            const result = goSync(() => localDataStore.setStoreDataPoint(element));

            if (!result.success) {
              logger.warn('Error while storing datapoint in data store.', { ...result.error });
            }
          }
        },
        {
          retries: 0,
          totalTimeoutMs: fetchInterval + HTTP_SIGNED_DATA_API_HEADROOM,
          attemptTimeoutMs: fetchInterval + HTTP_SIGNED_DATA_API_HEADROOM - 100,
        }
      )
    )
  );
};