import "server-only"
import { logAuthEvent } from "./audit"
import { createSession } from "./session"
import { createCustomer, getCustomerByPhone, touchLastLogin } from "./store"

/**
 * Final step shared by every login path once the phone is proven: find or create the customer,
 * refuse blocked accounts, open the session, and write the audit trail.
 */
export async function completeLogin(input: {
  phone: string
  ip: string
  userAgent: string
}): Promise<{ ok: true } | { ok: false; error: "ACCOUNT_BLOCKED" }> {
  const { phone, ip, userAgent } = input
  let customer = await getCustomerByPhone(phone)
  if (!customer) {
    customer = await createCustomer(phone)
    await logAuthEvent({ event: "account_created", phone, customerId: customer.id, ip, userAgent })
  } else {
    if (customer.status === "blocked") return { ok: false, error: "ACCOUNT_BLOCKED" }
    await touchLastLogin(customer.id)
  }
  await createSession({ customerId: customer.id, ip, userAgent })
  await logAuthEvent({ event: "login", phone, customerId: customer.id, ip, userAgent })
  return { ok: true }
}
