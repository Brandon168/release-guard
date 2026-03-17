import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      '.agents/**',
      '.next/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'presentation/dist/**',
      'next-env.d.ts',
    ],
  },
];

export default config;
