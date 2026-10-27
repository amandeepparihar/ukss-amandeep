import { prisma } from '../prisma';
import { createLogger, type Logger } from '../logger';

const defaultLogger = createLogger('common-utils');

/**
 * Get currency details (conversion rate and symbol)
 */

export async function getCurrencyDetails(currencyCode: string, logger?: Logger): Promise<{ conversionRate: number; symbol: string } | null> {
    const log = logger || defaultLogger;
    try {
        log.info({ currencyCode }, 'Getting currency details');

        const currency = await prisma.currency.findFirst({
            where: {
                code: currencyCode,
            },
            select: {
                value: true,
                symbolRight: true,
                symbolLeft: true,
            }
        })

        if (!currency || !currency.value) {
            log.warn({ currencyCode }, 'Currency not found or missing conversion rate');
            return null;
        }

        // Prefer symbolLeft, fallback to symbolRight
        const symbol = currency.symbolLeft || currency.symbolRight || '';
        const conversionRate = Number(currency.value);

        log.debug({
            currencyCode,
            conversionRate,
            symbol
        }, 'Currency details retrieved successfully');

        return {
            conversionRate,
            symbol,
        };
    } catch (error) {
        log.error({ error, currencyCode }, 'Failed to fetch currency details');
        return null;
    }
}


/**
 * Get date 3 days ago in ISO 8601 format
 */
export async function getThreeDaysAgoDate(): Promise<string> {
    const date = new Date();
    date.setDate(date.getDate() - 3);
    date.setHours(0, 0, 0, 0); // Set to midnight UTC
    return date.toISOString();
}

/**
 * Get country name from country ISO code
 */
export async function getCountryNameFromIsoCode(countryIsoCode: string, logger?: Logger): Promise<string> {
    const log = logger || defaultLogger;
    try {
        log.info({ countryIsoCode }, 'Getting country name from ISO code');

        const country = await prisma.country.findFirst({
            where: {
                OR: [
                    { countriesIsoCode2: countryIsoCode },
                    { countriesIsoCode3: countryIsoCode },
                ],
            },
            select: {
                countriesName: true,
            },
        });

        return country?.countriesName || countryIsoCode;
    } catch (error) {
        log.error({ error, countryIsoCode }, 'Error getting country name');
        return countryIsoCode;
    }
}