// إجراءات اللوحة كما تستدعيها الشاشات: نفس الأسماء، لكنها ترمي (في المتصفح) برسالة الخادم عند الفشل،
// لأن الإجراءات نفسها تعيد الخطأ كقيمة (Next.js يُخفي نص الأخطاء المرمية في الإنتاج).
// كل الشاشات تستورد من هنا فلا يمرّ فشل بصمت إن لم تُستعمل القيمة المعادة.
import { unwrapAll } from "@/lib/action-result"
import * as main from "./actions"
import * as orders from "./orders-actions"
import * as paymentAccounts from "./payment-accounts-actions"
import * as shipping from "./shipping-actions"
import * as uploads from "./upload-actions"

export const {
  generateProductSlug,
  saveProduct,
  backfillImagePalettes,
  getPaletteBackfillStatus,
  deleteProduct,
  toggleProductFlag,
  saveCategory,
  deleteCategory,
  saveBrand,
  deleteBrand,
  saveSlide,
  deleteSlide,
  saveCoupon,
  deleteCoupon,
  saveReview,
  deleteReview,
  saveAd,
  toggleAdActive,
  deleteAd,
  saveSettings,
  saveUser,
  deleteUser,
  toggleUserActive,
  fetchWhatsappStatus,
} = unwrapAll(main)

export const { updatePaymentStatus, deleteOrder, fetchOrdersPage } = unwrapAll({
  updatePaymentStatus: orders.updatePaymentStatus,
  deleteOrder: orders.deleteOrder,
  fetchOrdersPage: orders.fetchOrdersPage,
})

export const { savePaymentAccount, togglePaymentAccount, updatePaymentAccountOrder, deletePaymentAccount, removePaymentAccountImage } =
  unwrapAll(paymentAccounts)

export const { saveCurrencies, saveShippingZone, deleteShippingZone } = unwrapAll(shipping)

export const { requestImageUpload, requestImageUploads, requestVideoUpload } = unwrapAll(uploads)
