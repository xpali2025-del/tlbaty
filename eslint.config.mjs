import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// The React Compiler-era rules below flag patterns in existing code that work correctly
// (e.g. setState inside effects to sync from props). They stay visible as warnings.
const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
    },
  },
  { ignores: ['.next/**', 'drizzle/**', 'node_modules/**', 'worker/**/node_modules/**', 'sanity/**'] },
]

export default config
