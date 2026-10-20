import 'server-only'
import { cookies } from 'next/headers'
import { z } from 'zod'

const cartSchema = z
  .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(99) }))
  .max(50)
export type CartLine = z.infer<typeof cartSchema>[number]

const COOKIE = 'cart'

export async function readCart(): Promise<CartLine[]> {
  const raw = (await cookies()).get(COOKIE)?.value
  if (!raw) return []
  try {
    return cartSchema.parse(JSON.parse(raw))
  } catch {
    return []
  }
}

export async function writeCart(lines: CartLine[]) {
  const store = await cookies()
  if (lines.length === 0) return store.delete(COOKIE)
  store.set(COOKIE, JSON.stringify(lines), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}
