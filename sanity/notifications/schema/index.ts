import type { SchemaTypeDefinition } from "sanity"
import { notificationType } from "./notification"

// مخططات مشروع الإشعارات وحده. لا تُضاف هذه الأنواع لمخططات
// مشروع المحتوى (sanity/schemaTypes) ولا مشروع الطلبات (sanity/orders/schema).
export const notificationsSchemaTypes: SchemaTypeDefinition[] = [notificationType]
