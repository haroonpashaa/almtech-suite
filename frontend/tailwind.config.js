export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Brand colors sampled directly from the ALMTech logo gradient.
        brand: {
          25: '#f5f9ff',
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
          600: '#334155',
          500: '#475569',
          400: '#64748b',
          300: '#94a3b8',
          200: '#cbd5e1',
          100: '#e2e8f0',
          50: '#f1f5f9',
          25: '#f7f9fc', // app canvas
        },
      },
      // Layered, low-opacity elevation scale — depth without heavy drop shadows.
      boxShadow: {
        xs: '0 1px 2px rgba(15,23,42,0.04)',
        soft: '0 1px 2px rgba(15,23,42,0.05), 0 1px 1px rgba(15,23,42,0.03)',
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.05)',
        pop: '0 4px 14px -2px rgba(16,24,40,0.10), 0 2px 6px -2px rgba(16,24,40,0.06)',
        lift: '0 14px 34px -14px rgba(9,80,185,0.28)',
        'inner-t': 'inset 0 1px 0 0 rgba(255,255,255,0.6)',
        focus: '0 0 0 3px rgba(7,108,200,0.18)',
      },
      borderRadius: {
        '4xl': '1.75rem',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(90deg, #163e93 0%, #0950b9 50%, #0086cd 100%)',
        'brand-gradient-br': 'linear-gradient(135deg, #163e93 0%, #0950b9 55%, #0086cd 100%)',
        'brand-soft': 'linear-gradient(135deg, #eff6ff 0%, #ffffff 60%)',
        'sheen': 'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 100%)',
        'grid-fade':
          'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)',
      },
      backgroundSize: {
        grid: '22px 22px',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
        'fade-up': 'fade-up 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scale-in 0.16s cubic-bezier(0.16,1,0.3,1) both',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
