/**
 * Product Feeds - Gzip Compressor
 *
 * Streaming gzip using Node's zlib. Matches the PHP system's two
 * modes:
 *
 *   - `compressFile(in, out)` -- equivalent to `gzip -f <in>`: produces
 *     `<in>.gz` and DELETES the original `<in>`.
 *   - `compressAndKeepOriginal(in)` -- equivalent to `gzip -c <in> > <in>.gz`:
 *     produces `<in>.gz` and PRESERVES `<in>` on disk.
 *
 * Original semantics (from create_xml_feed.php lines 87-94):
 *   - UK `_all.xml` + US `_all.xml` -> keep uncompressed (compressAndKeepOriginal)
 *   - All other feeds             -> gzip -f (delete original)
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

async function streamGzip(inputPath: string, outputPath: string): Promise<void> {
  await pipeline(
    createReadStream(inputPath),
    createGzip(),
    createWriteStream(outputPath),
  );
}

/**
 * Compress `inputPath` to `outputPath` (defaults to `<inputPath>.gz`)
 * and delete the original. Equivalent to `gzip -f`.
 */
export async function compressFile(
  inputPath: string,
  outputPath?: string,
): Promise<string> {
  const target = outputPath ?? `${inputPath}.gz`;
  await streamGzip(inputPath, target);
  await unlink(inputPath);
  return target;
}

/**
 * Compress `inputPath` to `<inputPath>.gz` and keep the original.
 * Equivalent to `gzip -c input > input.gz`.
 */
export async function compressAndKeepOriginal(inputPath: string): Promise<string> {
  const target = `${inputPath}.gz`;
  await streamGzip(inputPath, target);
  return target;
}
