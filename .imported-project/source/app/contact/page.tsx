"use client"

import { useState } from "react"
import { MapPin, Phone, Send, Instagram, Facebook } from "lucide-react"
import { Header } from "@/components/header"
import { FooterClient } from "@/components/footer-client"
import { MobileNav } from "@/components/mobile-nav"
import { useToast } from "@/hooks/use-toast"
import { SITE_CONFIG } from "@/lib/site"

// نتعامل مع الميتاتاجز في صفحة layout أبوية أو نخترق بـ "use client" - سنستخدم Head منفصل في layout
export default function ContactPage() {
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [message, setMessage] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const msg = `*رسالة جديدة من الموقع*\n\nالاسم: ${name}\nالهاتف: ${phone}\nالرسالة: ${message}`
    window.open(`https://wa.me/${SITE_CONFIG.contact.whatsapp}?text=${encodeURIComponent(msg)}`, "_blank")
    toast({ title: "تم إرسال رسالتك", description: "سنتواصل معك قريباً" })
    setName("")
    setPhone("")
    setMessage("")
  }

  return (
    <>
      <Header />
      <main className="pb-24 lg:pb-12 mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2 text-center">تواصل معنا</h1>
        <p className="text-muted-foreground text-sm text-center mb-8">
          نسعد بتواصلكم معنا في أي وقت
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* بيانات التواصل - ثابتة في HTML للـ SEO */}
          <div className="space-y-3">
            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-bold text-lg mb-4">معلومات التواصل</h2>
              <ul className="space-y-4">
                <li className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">اتصل بنا الآن</p>
                    <a href={`tel:${SITE_CONFIG.contact.phone}`} className="font-bold hover:text-primary" dir="ltr">
                      {SITE_CONFIG.contact.phoneDisplay}
                    </a>
                  </div>
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">موقع المتجر</p>
                    <p className="font-bold">{SITE_CONFIG.contact.addressFull}</p>
                  </div>
                </li>
              </ul>
              <div className="flex gap-2 mt-5 pt-5 border-t border-border">
                <a
                  href={SITE_CONFIG.social.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700"
                  aria-label="واتساب"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347" /></svg>
                </a>
                <a href={SITE_CONFIG.social.instagram} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-secondary text-foreground flex items-center justify-center hover:bg-primary hover:text-primary-foreground" aria-label="انستغرام">
                  <Instagram className="w-4 h-4" />
                </a>
                <a href={SITE_CONFIG.social.facebook} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-secondary text-foreground flex items-center justify-center hover:bg-primary hover:text-primary-foreground" aria-label="فيسبوك">
                  <Facebook className="w-4 h-4" />
                </a>
              </div>
            </div>

            {/* خريطة - استبدال البلوب بصورة ثابتة */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="aspect-[5/3] bg-secondary relative">
                <iframe
                  src="https://www.openstreetmap.org/export/embed.html?bbox=44.18%2C15.34%2C44.22%2C15.36&layer=mapnik"
                  className="w-full h-full"
                  loading="lazy"
                  title="موقع المتجر على الخريطة"
                />
              </div>
              <div className="p-4 text-sm">
                <p className="font-bold flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-primary" /> موقع المتجر
                </p>
                <p className="text-muted-foreground">{SITE_CONFIG.contact.addressFull}</p>
              </div>
            </div>
          </div>

          {/* نموذج التواصل */}
          <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-5 h-fit">
            <h2 className="font-bold text-lg mb-4">أرسل لنا رسالة</h2>
            <div className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="الاسم الكامل"
                required
                className="w-full bg-background border border-input rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="رقم الهاتف"
                required
                dir="ltr"
                className="w-full bg-background border border-input rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary text-right"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="رسالتك"
                rows={5}
                required
                className="w-full bg-background border border-input rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              <button
                type="submit"
                className="w-full bg-primary text-primary-foreground rounded-full py-3 font-bold hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                إرسال الرسالة
              </button>
            </div>
          </form>
        </div>
      </main>
      <FooterClient />
      <MobileNav />
    </>
  )
}
