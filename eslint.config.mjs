import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', 'drizzle/**', 'node_modules/**', 'worker/**/node_modules/**'] },
]

export default config
