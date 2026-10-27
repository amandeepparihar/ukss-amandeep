/**
 * XML Utilities
 *
 * XML parsing and building utilities for marketplace integrations.
 * Used by: Fruugo, Walmart, Sportdeal
 */

import { XMLParser, XMLBuilder, type X2jOptions, type XmlBuilderOptions } from 'fast-xml-parser';
import { ParseError } from './errors';

/**
 * Options for XML parsing.
 */
export interface XmlParseOptions extends Partial<X2jOptions> {
  /** Preserve attribute order */
  preserveOrder?: boolean;
  /** Parse attributes */
  ignoreAttributes?: boolean;
  /** Attribute name prefix (default: '@_') */
  attributeNamePrefix?: string;
}

/**
 * Options for XML building.
 */
export interface XmlBuildOptions extends Partial<XmlBuilderOptions> {
  /** Include XML declaration */
  declaration?: boolean;
  /** Format output with indentation */
  format?: boolean;
  /** Attribute name prefix (default: '@_') */
  attributeNamePrefix?: string;
}

/**
 * Default parser options.
 */
const DEFAULT_PARSE_OPTIONS: XmlParseOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
};

/**
 * Default builder options.
 */
const DEFAULT_BUILD_OPTIONS: XmlBuildOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
};

/**
 * XML utilities object.
 */
export const xmlUtils = {
  /**
   * Parse XML string to JavaScript object.
   *
   * @param xml - XML string to parse
   * @param options - Parser options
   * @returns Parsed JavaScript object
   * @throws ParseError if parsing fails
   *
   * @example
   * const data = xmlUtils.parse<InventoryResponse>('<inventory><sku>ABC</sku></inventory>');
   * console.log(data.inventory.sku); // 'ABC'
   */
  parse<T>(xml: string, options?: XmlParseOptions): T {
    const parser = new XMLParser({
      ...DEFAULT_PARSE_OPTIONS,
      ...options,
    });

    try {
      return parser.parse(xml) as T;
    } catch (error) {
      throw new ParseError('Failed to parse XML', {
        rawContent: xml,
        expectedFormat: 'xml',
        cause: error as Error,
      });
    }
  },

  /**
   * Build XML string from JavaScript object.
   *
   * @param obj - JavaScript object to convert
   * @param options - Builder options
   * @returns XML string
   *
   * @example
   * const xml = xmlUtils.build({
   *   inventory: {
   *     sku: { '@_id': '123', '#text': 'ABC' }
   *   }
   * });
   * // <inventory><sku id="123">ABC</sku></inventory>
   */
  build(obj: unknown, options?: XmlBuildOptions): string {
    const builder = new XMLBuilder({
      ...DEFAULT_BUILD_OPTIONS,
      ...options,
    });

    let xml = builder.build(obj);

    // Add XML declaration if requested
    if (options?.declaration !== false) {
      xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
    }

    return xml;
  },

  /**
   * Escape special XML characters.
   *
   * @param str - String to escape
   * @returns Escaped string safe for XML
   *
   * @example
   * xmlUtils.escape('Tom & Jerry'); // 'Tom &amp; Jerry'
   * xmlUtils.escape('<script>'); // '&lt;script&gt;'
   */
  escape(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  /**
   * Unescape XML entities.
   *
   * @param str - String to unescape
   * @returns Unescaped string
   */
  unescape(str: string): string {
    if (!str) return '';
    return str
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  },

  /**
   * Check if a string is valid XML.
   *
   * @param xml - String to validate
   * @returns True if valid XML
   */
  isValid(xml: string): boolean {
    try {
      const parser = new XMLParser(DEFAULT_PARSE_OPTIONS);
      parser.parse(xml);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Extract value from XML using a simple path.
   *
   * @param obj - Parsed XML object
   * @param path - Dot-separated path to value
   * @returns Value at path or undefined
   *
   * @example
   * const data = xmlUtils.parse('<root><user><name>John</name></user></root>');
   * xmlUtils.getValue(data, 'root.user.name'); // 'John'
   */
  getValue<T = unknown>(obj: unknown, path: string): T | undefined {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current as T;
  },

  /**
   * Build XML for Fruugo inventory update.
   * Convenience method for common Fruugo pattern.
   *
   * @param skus - Array of SKU inventory items
   * @returns XML string for Fruugo API
   */
  buildFruugoInventory(
    skus: Array<{
      fruugoSkuId: string;
      availability: 'INSTOCK' | 'OUTOFSTOCK';
      itemsInStock: number;
    }>
  ): string {
    return this.build({
      'skus': {
        '@_xmlns': 'http://www.fruugo.com/inventory/upload',
        'sku': skus.map((item) => ({
          '@_fruugoSkuId': item.fruugoSkuId,
          'availability': item.availability,
          'itemsInStock': item.itemsInStock,
        })),
      },
    });
  },
};

export default xmlUtils;
