import { createLogger, type Logger } from '../logger';
import { config } from '../../config';
import { fetch, ProxyAgent } from 'undici';
import { ProductCustomOption } from './toffs-order-data.utils';

const defaultLogger = createLogger('toffs-token-utils');

export async function fetchToffsAccessToken(logger?: Logger): Promise<string | null> {
    const log = logger || defaultLogger;

    const url = config.TOFFS_API_TOKEN_URL || '';

    log.info({ url, proxyEnabled: config.TOFFS_PROXY_ENABLED }, 'Fetching TOFFS access token');

    try {
        const requestData = {
            'username': config.TOFFS_API_USERNAME,
            'password': config.TOFFS_API_PASSWORD,
        }

        if (!url) {
            log.error('TOFFS API token URL is not set');
            return null;
        }

        // Build headers - add browser-like headers when proxy is enabled
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        // When proxy is enabled, add Postman-like headers (matching PHP implementation)
        if (config.TOFFS_PROXY_ENABLED) {
            headers['Accept'] = 'application/json';
            headers['User-Agent'] = 'PostmanRuntime/7.39.0';
        }

        // Configure fetch options
        const fetchOptions: any = {
            method: 'POST',
            headers,
            body: JSON.stringify(requestData),
        };

        // If proxy is enabled, use undici with ProxyAgent
        if (config.TOFFS_PROXY_ENABLED) {
            const proxyUrl = `http://${config.TOFFS_PROXY_HOST}:${config.TOFFS_PROXY_PORT}`;
            const proxyAgent = new ProxyAgent({
                uri: proxyUrl,
                // Disable SSL verification when using proxy (matching PHP: CURLOPT_SSL_VERIFYPEER = false)
                requestTls: {
                    rejectUnauthorized: false,
                },
            });

            log.info({ proxyUrl }, 'Using proxy for TOFFS API request');

            // Use undici fetch with proxy agent
            fetchOptions.dispatcher = proxyAgent;
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            const errorText = await response.text();
            log.error({ errorText, status: response.status }, 'Failed to fetch TOFFS access token');
            return null;
        }

        // Handle response - can be JSON or plain string (matching PHP implementation)
        const responseText = await response.text();
        let accessToken: string;

        try {
            // Try to parse as JSON first
            const data = JSON.parse(responseText);
            accessToken = data.access_token || data;
        } catch {
            // If not JSON, treat as plain string and trim quotes (matching PHP: trim($response, '"'))
            accessToken = responseText.trim().replace(/^"|"$/g, '');
        }

        if (!accessToken) {
            log.error('Access token not found in response');
            return null;
        }

        return accessToken;
    } catch (error) {
        log.error({ error }, 'Failed to fetch TOFFS access token');
        return null;
    }
}


export async function getProductCustomOptionsMapping(
    baseSku: string,
    accessToken: string,
    logger?: Logger
): Promise<ProductCustomOption[]> {
    const log = logger || defaultLogger;
    log.info({ baseSku }, 'Getting product custom options mapping');

    const baseUrl = config.TOFFS_API_BASE_URL
    const url = `${baseUrl}/rest/V1/products/${baseSku}`


    log.info({ url }, 'Getting product custom options mapping URL');

    try {
        if (!url) {
            log.error('TOFFS API base URL is not set');
            return [];
        }

        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'authorization': `Bearer ${accessToken}`,
        }

        if (config.TOFFS_PROXY_ENABLED) {
            headers['accept'] = 'application/json';
            headers['user-agent'] = 'PostmanRuntime/7.39.0';
        }

        const fetchOptions: any = {
            method: 'GET',
            headers,
        }

        if (config.TOFFS_PROXY_ENABLED) {
            const proxyUrl = `http://${config.TOFFS_PROXY_HOST}:${config.TOFFS_PROXY_PORT}`;
            const proxyAgent = new ProxyAgent({
                uri: proxyUrl,
                // Disable SSL verification when using proxy (matching PHP: CURLOPT_SSL_VERIFYPEER = false)
                requestTls: {
                    rejectUnauthorized: false,
                },
            });

            log.info({ proxyUrl }, 'Using proxy for TOFFS API request');

            fetchOptions.dispatcher = proxyAgent;
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            const errorText = await response.text();
            log.error({ errorText, status: response.status }, 'Failed to fetch product custom options mapping');
            return [];
        }

        const data: any = await response.json();

        const customOptions: any[] = [];

        if (data.options.length > 0) {
            for (const option of data.options) {
                customOptions.push({
                    option_id: option.option_id,
                    title: option.title,
                    price: option.price,
                });
            }
        }

        return customOptions;
    } catch (error) {
        log.error({ error }, 'Failed to fetch product custom options mapping');
        return [];
    }


}