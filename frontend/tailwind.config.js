export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Brand colors sampled directly from the ALMTech logo gradient.
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#7ab8ee',
          400: '#0086cd', // electric (right side of logo)
          500: '#076cc8',
          600: '#0950b9', // primary (mid-left)
          700: '#163e93', // deepest (far left)
          800: '#0f2d7a',
          900: '#0a1f5c',
        },
        ink: {
          900: '#0b1220',
          700: '#1e293b',
          500: '#475569',
          400: '#64748b',
          300: '#94a3b8',
          200: '#cbd5e1',
          100: '#e2e8f0',
          50: '#f1f5f9',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 1px 1px rgba(15,23,42,0.03)',
        card: '0 1px 3px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04)',
        lift: '0 8px 24px -8px rgba(9,80,185,0.18)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(90deg, #163e93 0%, #0950b9 50%, #0086cd 100%)',
        'brand-soft': 'linear-gradient(135deg, #eff6ff 0%, #ffffff 60%)',
      },
    },
  },
  plugins: [],
};
