import "server-only"
import { sql, type SQLWrapper } from "drizzle-orm"

/**
 * نفس تطبيع normalizeReference (lib/wallet/rules.ts) لكن في SQL لعمود مخزَّن كما كتبه العميل (أرقام حوالات الطلبات):
 * الأرقام العربية والفارسية ← لاتينية، حذف المسافات و/ و-، وأحرف كبيرة. فيتطابق «١٢٣ ٤٥٦» مع «123456».
 */
export function normalizedReferenceSql(column: SQLWrapper) {
  return sql`upper(regexp_replace(translate(${column}, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[[:space:]/-]+', '', 'g'))`
}
