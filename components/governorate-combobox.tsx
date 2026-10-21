"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { MapPin, ChevronDown, Check, Search } from "lucide-react"
import { YEMEN_GOVERNORATES, normalizeArabic } from "@/lib/yemen-governorates"

type Props = {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function GovernorateCombobox({ id, value, onChange, placeholder = "اختر المدينة" }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const filtered = useMemo(() => {
    const q = normalizeArabic(query)
    if (!q) return [...YEMEN_GOVERNORATES]
    return YEMEN_GOVERNORATES.filter((g) => normalizeArabic(g).includes(q))
  }, [query])

  // إغلاق القائمة عند النقر خارجها
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [open])

  // تركيز حقل البحث عند الفتح
  useEffect(() => {
    if (open) {
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery("")
    }
  }, [open])

  // إبقاء العنصر النشط ظاهراً
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, open])

  function select(gov: string) {
    onChange(gov)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const gov = filtered[activeIndex]
      if (gov) select(gov)
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <MapPin className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full bg-background border border-input rounded-xl pr-10 pl-9 py-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary flex items-center justify-between"
      >
        <span className={value ? "text-foreground" : "text-muted-foreground"}>
          {value || placeholder}
        </span>
      </button>
      <ChevronDown
        className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      />

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-input bg-popover shadow-lg overflow-hidden">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="اكتب اسم المدينة..."
              className="w-full bg-background border border-input rounded-lg pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <ul ref={listRef} role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground text-center">لا توجد مدينة مطابقة</li>
            ) : (
              filtered.map((gov, index) => {
                const selected = gov === value
                const active = index === activeIndex
                return (
                  <li
                    key={gov}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(gov)}
                    className={`flex items-center justify-between gap-2 px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                      active ? "bg-muted" : ""
                    } ${selected ? "font-bold text-primary" : "text-foreground"}`}
                  >
                    <span>{gov}</span>
                    {selected && <Check className="w-4 h-4 shrink-0" aria-hidden="true" />}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
