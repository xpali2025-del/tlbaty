import { Truck, Shield, Headphones, Lock } from "lucide-react"
import { STORE_FEATURES } from "@/lib/site"

const ICONS = {
  truck: Truck,
  shield: Shield,
  headphones: Headphones,
  lock: Lock,
}

export function FeatureBar() {
  return (
    <section className="bg-secondary/50 border-y border-border" aria-label="مميزات المتجر">
      <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        {STORE_FEATURES.map((feature) => {
          const Icon = ICONS[feature.icon as keyof typeof ICONS]
          return (
            <div key={feature.title} className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-foreground">{feature.title}</h3>
                <p className="text-xs text-muted-foreground line-clamp-1">{feature.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
