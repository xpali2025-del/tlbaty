export interface Product {
  id: string
  slug: string
  name: string
  description: string
  price: number
  oldPrice?: number
  image: string
  images: string[]
  /** سلاج القسم الرئيسي */
  category: string
  /** سلاج القسم الفرعي (اختياري) */
  subcategory?: string
  rating: number
  reviewsCount: number
  colors: { name: string; hex: string }[]
  sizes: string[]
  stock: number
  isNew?: boolean
  isBestseller?: boolean
  badge?: string
  tags?: string[]
  /** حقول SEO اختيارية لكل منتج */
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  brand?: string
  sku?: string
}

/** علامة تجارية (براند) */
export interface Brand {
  id: string
  slug: string
  name: string
  /** صورة/شعار البراند داخل public مثل /brands/toraf.png */
  image: string
  description?: string
  /** إبراز البراند في الواجهة */
  featured?: boolean
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  productCount?: number
}

/** قسم فرعي يتبع قسماً رئيسياً */
export interface Subcategory {
  id: string
  slug: string
  name: string
  description?: string
}

export interface Category {
  id: string
  slug: string
  name: string
  image: string
  productCount?: number
  /** وصف القسم لتقوية السيو */
  description?: string
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  /** الأقسام الفرعية التابعة لهذا القسم الرئيسي */
  subcategories?: Subcategory[]
}

export interface Slide {
  id: string
  title: string
  subtitle: string
  cta: string
  href: string
  image: string
}

/** طريقة توصيل واحدة ضمن منطقة توصيل */
export interface ShippingMethod {
  id: string
  name: string
  desc: string
  price: number
  icon: "express" | "standard" | "pickup"
}

/** طرق التوصيل المرتبطة بمحافظة (أو الإعداد الافتراضي لباقي المحافظات) */
export interface ShippingZone {
  id: string
  governorate: string
  isDefault: boolean
  methods: ShippingMethod[]
}

export interface Coupon {
  code: string
  discount: number // بالنسبة المئوية
  type: "percent" | "fixed"
  minOrder?: number
  description: string
}

/**
 * صورة إعلانية اختيارية تظهر بين المنتجات.
 * إن لم يوجد ملف ads.json أو كانت القائمة فارغة، لا تظهر أي إعلانات ولا يحدث أي خطأ.
 */
export interface Ad {
  id: string
  /** نص بديل للصورة (مهم للسيو وقارئات الشاشة) */
  title: string
  /** مسار الصورة داخل public مثل /ads/perfume-ad.png */
  image: string
  /** رابط اختياري عند الضغط على الإعلان */
  href?: string
  /** أقسام يظهر فيها الإعلان (سلاجات). فارغ أو يحتوي "all" = كل الأقسام */
  categories?: string[]
  /** تفعيل/إيقاف الإعلان. الافتراضي مفعّل */
  active?: boolean
  /** يظهر بعد كل كم منتج. الافتراضي 6 */
  frequency?: number
  /** ترتيب ظهور الإعلانات عند وجود أكثر من واحد */
  order?: number
}

export interface Review {
  id: string
  name: string
  rating: number
  comment: string
  date: string
  avatar?: string
}

export interface BlogPost {
  slug: string
  title: string
  excerpt: string
  content: string
  image: string
  date: string
  author: string
  readTime: string
}

export interface Offer {
  id: string
  title: string
  discount: string
  image: string
  href: string
}

export interface CartItem {
  productId: string
  name: string
  price: number
  image: string
  size: string
  color: string
  quantity: number
}

/**
 * عنصر في قائمة الرغبات — يُخزَّن في localStorage الخاص بالجهاز/المتصفح.
 * نحتفظ بالحقول اللازمة لعرض البطاقة وفتح نافذة اختيار الخيارات (الألوان/المقاسات)
 * دون الحاجة إلى إعادة الجلب من قاعدة البيانات.
 */
export interface WishlistItem {
  id: string
  slug: string
  name: string
  price: number
  oldPrice?: number
  image: string
  colors: { name: string; hex: string }[]
  sizes: string[]
}

/**
 * عنصر في «المنتجات المعروضة مؤخرًا» — يُخزَّن في localStorage الخاص بالجهاز.
 * يعيد استخدام نفس حقول عنصر الرغبات (WishlistItem) ويضيف الحقول اللازمة فقط
 * لعرض بطاقة المنتج وإضافته إلى السلة/الرغبات دون إعادة الجلب من قاعدة البيانات.
 */
export interface RecentlyViewedItem extends WishlistItem {
  images: string[]
  stock: number
  isNew?: boolean
  sku?: string
}

/**
 * نسخة خفيفة من المنتج لبطاقات القوائم التي تُمرَّر إلى مكوّنات المتصفح: تُسلسَل كاملة داخل HTML الصفحة،
 * فحذف الوصف الطويل وبقية الصور وحقول SEO يقلّل حجم الصفحة كثيراً. الوصف يُقتطع (يكفي للبحث داخل القائمة).
 */
export function toCardProduct(p: Product): Product {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description.slice(0, 120),
    price: p.price,
    oldPrice: p.oldPrice,
    image: p.image,
    images: p.image ? [p.image] : [],
    category: p.category,
    subcategory: p.subcategory,
    rating: p.rating,
    reviewsCount: p.reviewsCount,
    colors: p.colors,
    sizes: p.sizes,
    stock: p.stock,
    isNew: p.isNew,
    isBestseller: p.isBestseller,
    tags: p.tags,
    brand: p.brand,
  }
}
