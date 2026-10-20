'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { readCart, writeCart } from '@/lib/cart'
import { EmailBelongsToAccountError, resolveCustomer } from '@/lib/queries/customers'
import { createOrder, OutOfStockError } from '@/lib/queries/orders'
import { getAuthUser } from '@/lib/supabase/server'

export type CheckoutState = { error?: string }

const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().max(30).optional(),
})

export async function checkout(_: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const cart = await readCart()
  if (cart.length === 0) return { error: 'السلة فارغة' }

  const user = await getAuthUser()
  const parsed = contactSchema.safeParse({
    name: formData.get('name'),
    // A signed-in user's email always comes from the verified session.
    email: user?.email ?? formData.get('email'),
    phone: formData.get('phone') || undefined,
  })
  if (!parsed.success) return { error: 'تحقق من الاسم والبريد الإلكتروني' }

  let orderId: string
  try {
    const customer = await resolveCustomer({
      auth: user?.email
        ? { id: user.id, email: user.email, emailConfirmed: !!user.email_confirmed_at }
        : null,
      contact: parsed.data,
    })
    const order = await createOrder({ customerId: customer.id, items: cart })
    orderId = order.id
  } catch (e) {
    if (e instanceof EmailBelongsToAccountError) return { error: 'هذا البريد مسجّل لدينا، سجّل الدخول لإتمام الطلب' }
    if (e instanceof OutOfStockError) return { error: 'أحد المنتجات غير متوفر بالكمية المطلوبة، عدّل السلة' }
    throw e
  }
  await writeCart([])
  redirect(`/orders/${orderId}`)
}
