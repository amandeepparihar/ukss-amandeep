/**
 * Product Feeds - Generators Barrel Export
 *
 * Feed serialisers: XML (RSS 2.0 + Google Shopping), marketplace CSV,
 * and the gzip compressor shared between them.
 */

export { compressFile, compressAndKeepOriginal } from './feed-compressor.js';
export { generateXmlFeed, type XmlFeedOptions } from './xml-feed-generator.js';
export { generateMarketplaceCsv } from './csv-feed-generator.js';
