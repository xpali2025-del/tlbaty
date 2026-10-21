import { store } from './common'

export const orderStatus = store.enum('order_status', [
  'new', 'confirmed', 'processing', 'ready', 'assigned',
  'on_the_way', 'delivered', 'failed', 'cancelled', 'returned',
])
export const paymentMethod = store.enum('payment_method', ['cash_on_delivery', 'manual_transfer'])
export const paymentStatus = store.enum('payment_status', [
  'pending_on_delivery', 'pending_verification', 'verified', 'rejected', 'paid', 'refunded', 'cancelled',
])
export const discountType = store.enum('discount_type', ['percent', 'fixed'])
export const courierStatus = store.enum('courier_status', ['active', 'suspended'])
export const customerStatus = store.enum('customer_status', ['active', 'blocked'])
export const manageUserRole = store.enum('manage_user_role', ['admin', 'editor'])
export const otpPurpose = store.enum('otp_purpose', ['login', 'change_phone'])
export const authEventType = store.enum('auth_event_type', [
  'otp_sent', 'otp_resent', 'otp_verified', 'otp_failed', 'otp_expired', 'rate_limited',
  'account_created', 'login', 'logout', 'logout_all', 'phone_changed',
])
export const notificationStatus = store.enum('notification_status', ['draft', 'published', 'archived'])
export const notificationPriority = store.enum('notification_priority', ['normal', 'important'])
export const linkPlacement = store.enum('link_placement', ['nav', 'footer'])
export const shippingIcon = store.enum('shipping_icon', ['express', 'standard', 'pickup'])
