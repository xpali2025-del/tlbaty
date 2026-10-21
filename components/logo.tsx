import Link from "next/link"
import Image from "next/image"

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center ${className}`}
      aria-label="تاج لاين - الرئيسية"
    >
      <Image
        src="/logo.png"
        alt="تاج لاين"
        width={200}
        height={100}
        priority
        className="h-auto w-auto max-h-12"
      />
    </Link>
  )
}
