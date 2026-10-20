import type { SchemaTypeDefinition } from "sanity"
import { productType } from "./product"
import { categoryType } from "./category"
import { brandType } from "./brand"
import { slideType } from "./slide"
import { couponType } from "./coupon"
import { reviewType } from "./review"
import { adType } from "./ad"
import { settingsType } from "./settings"
import { manageUserType } from "./manageUser"
import { shippingZoneType } from "./shipping"
import { paymentAccountType } from "./paymentAccount"

export const schemaTypes: SchemaTypeDefinition[] = [
  productType,
  categoryType,
  brandType,
  slideType,
  couponType,
  reviewType,
  adType,
  settingsType,
  manageUserType,
  shippingZoneType,
  paymentAccountType,
]
