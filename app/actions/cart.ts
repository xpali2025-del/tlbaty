'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { readCart, writeCart } from '@/lib/cart'

const id = z.string().uuid()

export async function addToCart(formData: FormData) {
  const productId = id.parse(formData.get('productId'))
  const cart = await readCart()
  const line = cart.find((l) => l.productId === productId)
  if (line) line.qty = Math.min(99, line.qty + 1)
  else cart.push({ productId, qty: 1 })
  await writeCart(cart)
  revalidatePath('/cart')
}

export async function setCartQty(formData: FormData) {
  const productId = id.parse(formData.get('productId'))
  const qty = z.coerce.number().int().min(0).max(99).parse(formData.get('qty'))
  const cart = (await readCart()).filter((l) => l.productId !== productId)
  if (qty > 0) cart.push({ productId, qty })
  await writeCart(cart)
  revalidatePath('/cart')
}
