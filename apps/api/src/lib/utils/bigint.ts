/**
 * BigInt → Number coercion for Prisma `$queryRaw` results.
 *
 * MySQL INT columns come back as native BigInt values from `$queryRaw`, and
 * `JSON.stringify` throws on BigInt. Almost every raw-SQL site in this codebase
 * needs to flatten them before returning the rows over HTTP, so this is the
 * shared place for that conversion.
 *
 * Use for any value that is safely within the JS Number range (≤ 2^53 − 1).
 * For values larger than that — none today, but worth flagging — switch the
 * caller to keep the BigInt and serialize as a string explicitly.
 */
export function toBigIntSafe<T>(rows: T[]): T[] {
  return rows.map((row) => {
    const obj = { ...row } as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'bigint') {
        obj[key] = Number(obj[key]);
      }
    }
    return obj as T;
  });
}
