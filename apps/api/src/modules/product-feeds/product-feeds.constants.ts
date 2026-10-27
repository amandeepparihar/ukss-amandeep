/**
 * Product Feeds Module - Static Constants
 *
 * Country definitions, currency maps, encoding fixes, FIFA team list,
 * and feed type definitions. Ported from:
 *   - ukss-feed/build_data.php (encoded chars, fileTypes, CURRENT_SEASON)
 *   - ukss-feed/shipping.php (countryISOcode, euCountries, country_currency)
 *   - ukss-feed/create_xml_feed.php (countriesList, fifaWorldCupTeams)
 */

import type { CountryCode, CountryInfo, FeedType } from './product-feeds.types';

/**
 * The 9 target countries/regions that receive product feeds.
 * Source: create_xml_feed.php `countriesList()`
 */
export const COUNTRIES_LIST: Record<CountryCode, CountryInfo> = {
  UK: { currency: 'GBP', file: 'United-Kingdom' },
  EU: { currency: 'EUR', file: 'eu-countries' },
  US: { currency: 'USD', file: 'United-States-of-America' },
  AU: { currency: 'AUD', file: 'Australia' },
  CA: { currency: 'CAD', file: 'Canada' },
  NZ: { currency: 'NZD', file: 'New-Zealand' },
  AE: { currency: 'AED', file: 'United-Arab-Emirates' },
  SG: { currency: 'SGD', file: 'Singapore' },
  CH: { currency: 'CHF', file: 'Switzerland' },
};

/**
 * 12 EU member countries whose shipping is bundled into the EU feed.
 * Source: shipping.php `$euCountries`
 */
export const EU_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'FI', 'FR', 'GR', 'IT',
  'PT', 'SK', 'ES', 'IE', 'NL', 'DE',
];

/**
 * Country code -> currency code. Used by XML generator to set the `link`
 * query string `currency=` parameter per country.
 * Source: create_xml_feed.php `$country_currency`
 */
export const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  US: 'USD',
  UK: 'GBP',
  AU: 'AUD',
  CA: 'CAD',
  NZ: 'NZD',
  AE: 'AED',
  SG: 'SGD',
  CH: 'CHF',
  EU: 'EUR',
  IE: 'EUR', DE: 'EUR', NL: 'EUR', AT: 'EUR',
  BE: 'EUR', FI: 'EUR', FR: 'EUR', GR: 'EUR',
  IT: 'EUR', PT: 'EUR', SK: 'EUR', ES: 'EUR',
};

/**
 * 33 ISO country codes for which shipping methods are loaded.
 * Source: shipping.php `$countryISOcode`
 */
export const SHIPPING_COUNTRY_CODES: readonly string[] = [
  'US', 'GB', 'AU', 'CA', 'DK', 'NZ', 'AE', 'IN', 'MY', 'NO',
  'SG', 'SE', 'CH', 'IE', 'DE', 'NL', 'AT', 'BE', 'HR', 'CY',
  'EE', 'FI', 'FR', 'GR', 'IT', 'LV', 'LT', 'LU', 'MT', 'PT',
  'SK', 'SI', 'ES',
];

/**
 * Feed types generated per country.
 * Source: build_data.php `$fileTypes`
 */
export const FEED_TYPES: readonly FeedType[] = [
  'all',
  'facebook',
  'shoptimized',
  'marketplace',
];

/**
 * Character-encoding fixes for common mojibake in product titles.
 * Source: build_data.php `$encoded`
 */
export const ENCODING_FIXES: Record<string, string> = {
  'ÃƒÂ©': 'é',
  'ÃƒÂ³': 'ó',
  'ÃƒÂ­': 'í',
  'ÃƒÂ£': 'ã',
  'ÃƒÂ±': 'ñ',
  'ÃƒÆ\u2019Ã‚Â­': 'í',
};

/**
 * National teams eligible for the FIFA World Cup feed filter.
 * Source: build_data.php `$fifaWorldCupTeams` (#165022)
 */
export const FIFA_WORLD_CUP_TEAMS: readonly string[] = [
  'canada', 'mexico', 'usa', 'algeria', 'argentina', 'australia',
  'austria', 'belgium', 'brazil', 'cape verde', 'colombia', 'croatia',
  'ivory coast', 'ecuador', 'egypt', 'england', 'france', 'germany',
  'ghana', 'haiti', 'iran', 'japan', 'jordan', 'south korea',
  'morocco', 'netherlands', 'new zealand', 'norway', 'panama',
  'paraguay', 'portugal', 'qatar', 'saudi arabia', 'scotland',
  'senegal', 'south africa', 'spain', 'switzerland', 'tunisia',
  'uruguay', 'uzbekistan',
];

/**
 * XML namespace for Google Shopping feed elements.
 */
export const GOOGLE_SHOPPING_NAMESPACE = 'http://base.google.com/ns/1.0';

/**
 * Hardcoded override for UK SuperSaver shipping cost in GBP.
 * Source: build_data.php / shipping.php uses MODULE_SHIPPING_SUPERSAVER_COST
 */
export const UK_SUPERSAVER_COST = '5.25';

/**
 * Website root URL for building product links.
 * Source: build_data.php `$websiteRoot`
 */
export const WEBSITE_ROOT = 'https://www.uksoccershop.com/';

/**
 * Max title length after `improveTitle()` attribute appending.
 * Source: build_data_functions.php `improveTitle()`
 */
export const MAX_TITLE_LENGTH = 150;
