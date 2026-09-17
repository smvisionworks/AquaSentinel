// Tailwind CDN configuration for AquaSentinel.
// Loaded after the Tailwind CDN script and before any markup that uses
// these utility extensions.
tailwind.config = {
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                display: ['Space Grotesk', 'sans-serif'],
            },
            colors: {
                aquaDark: '#0a0f1d',
                aquaCard: 'rgba(15, 23, 42, 0.7)',
                aquaBorder: 'rgba(56, 189, 248, 0.15)',
                aquaNeon: '#38bdf8',
                aquaGlow: 'rgba(56, 189, 248, 0.25)',
            }
        }
    }
};
