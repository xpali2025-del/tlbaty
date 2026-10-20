import "server-only"

import { client } from "@/sanity/client"

// ============================================
// طبقة قراءة لوحة الإدارة (/manage)
// تجلب المستندات الخام من Sanity بحقول قابلة للتعديل (تشمل _id ومراجع
// الأقسام/البراندات) — على عكس lib/data.ts التي تُرجع بيانات مُسقطة للعرض.
// كل الاستعلامات هنا تتجاوز كاش Next.js (no-store) لتعرض آخر حالة للمحرر.
// ============================================

async function adminFetch<T>(query: string, params: Record<string, unknown>, fallback: T): Promise<T> {
  if (!client) return fallback
  return client.fetch<T>(query, params, { cache: "no-store" })
}

// ---------- الأنواع ----------

export type AdminColor = { name: string; hex: string }

export type AdminProduct = {
  _id: string
  productId?: string
  name: string
  slug?: string
  description?: string
  price?: number
  oldPrice?: number
  categoryId?: string
  categoryName?: string
  categorySlug?: string
  subcategory?: string
  brandId?: string
  brandName?: string
  image?: string
  images: { url: string; ref: string }[]
  stock?: number
  isNew?: boolean
  isBestseller?: boolean
  badge?: string
  sortOrder?: number
  rating?: number
  reviewsCount?: number
  sku?: string
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  colors: AdminColor[]
  sizes: string[]
  tags?: string[]
}

export type AdminSubcategory = { name: string; slug?: string; description?: string }

export type AdminCategory = {
  _id: string
  name: string
  slug?: string
  description?: string
  image?: string
  sortOrder?: number
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  subcategories: AdminSubcategory[]
  productCount: number
}

export type AdminBrand = {
  _id: string
  name: string
  slug?: string
  description?: string
  image?: string
  featured?: boolean
  sortOrder?: number
  metaTitle?: string
  metaDescription?: string
  keywords?: string[]
  productCount: number
}

export type AdminSlide = {
  _id: string
  title: string
  subtitle?: string
  cta?: string
  href?: string
  image?: string
  sortOrder?: number
}

export type AdminCoupon = {
  _id: string
  code: string
  discount: number
  type: "percent" | "fixed"
  minOrder?: number
  description?: string
}

export type AdminReview = {
  _id: string
  name: string
  rating: number
  comment: string
  date?: string
  avatar?: string
}

export type AdminAd = {
  _id: string
  title: string
  image?: string
  href?: string
  active?: boolean
  frequency?: number
  sortOrder?: number
  categoryIds: string[]
}

export type AdminSettings = {
  _id: string
  name?: string
  tagline?: string
  description?: string
  logo?: string
  phone?: string
  whatsapp?: string
  email?: string
  address?: string
  workingHours?: string
  social?: { instagram?: string; facebook?: string; tiktok?: string }
  copyright?: string
} | null

/** حساب دفع كما يُعرض في لوحة الإدارة (يشمل المعطّل). */
export type AdminPaymentAccount = {
  _id: string
  providerName: string
  accountDisplayName?: string
  accountHolderName?: string
  accountNumber?: string
  image?: string
  imageRef?: string
  instructions?: string
  isActive: boolean
  sortOrder: number
  createdAt?: string
  updatedAt?: string
  /** عدد الطلبات لا يُحسب هنا لأن الطلبات في مشروع Sanity مستقل. */
}

// ---------- الاستعلامات ----------

const PRODUCTS = /* groq */ `*[_type == "product"] | order(coalesce(sortOrder, 0) asc, name asc){
  _id, productId, name, "slug": slug.current, description, price, oldPrice,
  "categoryId": category._ref, "categoryName": category->name, "categorySlug": category->slug.current,
  subcategory,
  "brandId": brand._ref, "brandName": brand->name,
  "image": mainImage.asset->url,
  "images": coalesce(images[]{ "url": asset->url, "ref": asset._ref }, []),
  stock, isNew, isBestseller, badge, sortOrder, rating, reviewsCount, sku,
  metaTitle, metaDescription, keywords,
  "colors": coalesce(colors[]{ name, hex }, []),
  "sizes": coalesce(sizes, []),
  tags
}`

const CATEGORIES = /* groq */ `*[_type == "category"] | order(coalesce(sortOrder, 0) asc, name asc){
  _id, name, "slug": slug.current, description, "image": image.asset->url, sortOrder,
  metaTitle, metaDescription, keywords,
  "subcategories": coalesce(subcategories[]{ name, "slug": slug.current, description }, []),
  "productCount": count(*[_type == "product" && references(^._id)])
}`

const BRANDS = /* groq */ `*[_type == "brand"] | order(coalesce(sortOrder, 0) asc, name asc){
  _id, name, "slug": slug.current, description, "image": image.asset->url, featured, sortOrder,
  metaTitle, metaDescription, keywords,
  "productCount": count(*[_type == "product" && references(^._id)])
}`

const SLIDES = /* groq */ `*[_type == "slide"] | order(coalesce(sortOrder, 0) asc){
  _id, title, subtitle, cta, href, "image": image.asset->url, sortOrder
}`

const COUPONS = /* groq */ `*[_type == "coupon"] | order(_createdAt desc){
  _id, code, discount, type, minOrder, description
}`

const REVIEWS = /* groq */ `*[_type == "review"] | order(date desc){
  _id, name, rating, comment, date, "avatar": avatar.asset->url
}`

const ADS = /* groq */ `*[_type == "ad"] | order(coalesce(sortOrder, 0) asc){
  _id, title, "image": image.asset->url, href, active, frequency, sortOrder,
  "categoryIds": coalesce(categories[]._ref, [])
}`

const SETTINGS = /* groq */ `*[_type == "siteSettings"][0]{
  _id, name, tagline, description, "logo": logo.asset->url,
  phone, whatsapp, email, address, workingHours, social, copyright
}`

const PAYMENT_ACCOUNTS = /* groq */ `*[_type == "paymentAccount"] | order(coalesce(sortOrder, 0) asc, providerName asc){
  _id, providerName, accountDisplayName, accountHolderName, accountNumber,
  "image": image.asset->url, "imageRef": image.asset._ref,
  instructions, "isActive": coalesce(isActive, true), "sortOrder": coalesce(sortOrder, 0),
  "createdAt": coalesce(createdAt, _createdAt), "updatedAt": coalesce(updatedAt, _updatedAt)
}`

// ---------- الدوال ----------

export const getAdminProducts = () => adminFetch<AdminProduct[]>(PRODUCTS, {}, [])
export const getAdminCategories = () => adminFetch<AdminCategory[]>(CATEGORIES, {}, [])
export const getAdminBrands = () => adminFetch<AdminBrand[]>(BRANDS, {}, [])
export const getAdminSlides = () => adminFetch<AdminSlide[]>(SLIDES, {}, [])
export const getAdminCoupons = () => adminFetch<AdminCoupon[]>(COUPONS, {}, [])
export const getAdminReviews = () => adminFetch<AdminReview[]>(REVIEWS, {}, [])
export const getAdminAds = () => adminFetch<AdminAd[]>(ADS, {}, [])
export const getAdminSettings = () => adminFetch<AdminSettings>(SETTINGS, {}, null)
export const getAdminPaymentAccounts = () =>
  adminFetch<AdminPaymentAccount[]>(PAYMENT_ACCOUNTS, {}, [])
