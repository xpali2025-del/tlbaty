# قياس زمن الحفظ في لوحة التحكم

أدوات المرحلة 0 من `docs/admin-instant-save-plan.md`. تُستعمل نفسها لقياس «قبل» و«بعد» كل مرحلة.

## المتطلبات
- Postgres محلي بقاعدة اختبار مهيأة (الترحيلات مطبّقة وفيها بيانات)، ومتغيراتها في ملف مثل `/tmp/e2e.env`:
  `DATABASE_URL SESSION_SECRET MANAGE_SESSION_SECRET MANAGE_USERNAME MANAGE_PASSWORD NODE_ENV`.
- متغيرات R2 وهمية **عند البناء والتشغيل معاً** (لا يوجد R2 حقيقي): `R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_PUBLIC_URL`.
- Playwright (مثبّت في البيئة) و`sharp` (من اعتماديات المشروع).

## الخطوات
```bash
# 1) صور اختبار (3 صور ~3.6MB)
node scripts/bench/make-fixtures.mjs /tmp/fixtures 3

# 2) بناء نظيف بمتغيرات R2 الوهمية
export R2_ACCOUNT_ID=bench R2_ACCESS_KEY_ID=benchkey R2_SECRET_ACCESS_KEY=benchsecret R2_BUCKET=bench R2_PUBLIC_URL=https://cdn.bench.test
rm -rf .next && pnpm build

# 3) وسيط التأخير: 50ms لكل اتجاه = 100ms ذهاباً وإياباً للقاعدة
DELAY_MS=50 node scripts/bench/latency-proxy.mjs &

# 4) الخادم عبر الوسيط
set -a; . /tmp/e2e.env; set +a
export DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5433/DB?sslmode=disable" NODE_ENV=production
npx next start -p 3311 &

# 5) القياس
FIXTURES=/tmp/fixtures ROUNDS=10 WARMUP=1 OUT=/tmp/results.json node scripts/bench/admin-save.mjs
```
(في الخطوة 4 استبدل منفذ الرابط 5432 بـ 5433، منفذ الوسيط.)

## متغيرات اختيارية
`ONLY=products-edit-price,settings-text` لسيناريوهات محددة · `ROUNDS` · `WARMUP` · `RTT_MS` (الافتراضي 165).

## ما تعنيه الأعمدة
| العمود | المعنى |
|---|---|
| A | من الضغط على «حفظ» حتى تعود الواجهة للمدير (تُغلق النافذة، أو يرجع زر الإعدادات) |
| B | حتى يصل رد آخر طلب إلى الخادم (اكتمال الحفظ) |
| قبل أول طلب | الضغط على الصور والتحقق قبل أول طلب شبكة |
| U | حتى اكتمال رفع آخر صورة إلى R2 |
| طلب الحفظ | مدة آخر إجراء خادم (الحفظ نفسه، بما فيه إعادة الرسم) |
| استعلامات | عدد استعلامات القاعدة حتى استقرار الصفحة |

## حدود القياس (اذكرها عند عرض النتائج)
- الشبكة محاكاة بنموذج صريح (4G: رفع 1.5 Mbps، تنزيل 9 Mbps، زمن ذهاب وإياب 165 ms) على طلبات الإجراءات ورفع R2 فقط.
- R2 وهمي: يرد 200 بعد زمن الإرسال المحاكى.
- معالج الجهاز غير مُبطَّأ: ضغط الصور على الجوال أبطأ مما هنا.
- متصفح Chromium المرفق لا يفك ترميز H.264: لا يمكن تشغيل إعلان الفيديو، فيُحسب زمن رفعه تحليلياً لا قياساً.
- مع 10 قياسات، p95 (الرتبة الأقرب) يساوي أكبر قيمة.

## فحص الرفع عند الاختيار (ليس ضمن CI)
`scripts/e2e/preupload.e2e.mjs` و`scripts/e2e/admin-save-foundation.e2e.mjs`: نفس خطوات البناء والتشغيل أعلاه ثم
`set -a; . /tmp/e2e.env; set +a; FIXTURES=/tmp/fixtures node scripts/e2e/preupload.e2e.mjs` (و`WIDTH=390` للهاتف).
فيديو الإعلان يحتاج `ad-test.mp4` في مجلد الصور: `ffmpeg -f lavfi -i testsrc=size=1200x600:rate=10 -t 3 -c:v libvpx-vp9 -b:v 300k -an $FIXTURES/ad-test.mp4`
(متصفح Chromium المرفق لا يفك H.264، ويفك VP9 داخل MP4).
سكربت القياس `admin-save.mjs` ينتظر الآن انتهاء الرفع المسبق قبل الضغط على «حفظ» (يقيس ما يلي الحفظ لمن اختار صوره قبله).

## مكتبة الاتصال بقاعدة البيانات (المرحلة 6)
- `db-driver.mjs`: مقارنة postgres.js وnode-postgres مباشرة عبر وسيط التأخير.
- `storefront.mjs`: زمن صفحات المتجر (`PATHS` لتحديدها).
- تشغيل الخادم بمكتبة بعينها: `DB_DRIVER=pg` (الافتراضي postgres.js). اختبارات الحزمة على Postgres حقيقي: `TEST_DB_DRIVER=pg|postgres TEST_DATABASE_URL=postgresql://USER:PASS@HOST:5432/postgres pnpm vitest run`.
- ملاحظة: كابح تسجيل الدخول في الذاكرة (8 محاولات لكل اسم مستخدم): أعد تشغيل الخادم قبل كل تشغيل لفحوص المتصفح.
