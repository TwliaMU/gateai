import React, { useMemo } from 'react';

function seededRandom(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const NightSky: React.FC = () => {
  const stars = useMemo(() => {
    const rand = seededRandom(20261028);
    return Array.from({ length: 90 }, (_, i) => ({
      id: i,
      left: rand() * 100,
      top: rand() * 62,
      size: 1 + rand() * 2,
      opacity: 0.35 + rand() * 0.65,
      delay: rand() * 4,
      duration: 2.5 + rand() * 3
    }));
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <style>{`@media (prefers-reduced-motion: reduce) { .animate-pulse, .night-meteor { animation: none !important; } } @keyframes night-shoot { 0% { transform: translate(0, 0) rotate(-28deg); opacity: 0; } 8% { opacity: 1; } 22% { transform: translate(-180px, 105px) rotate(-28deg); opacity: 0; } 100% { transform: translate(-180px, 105px) rotate(-28deg); opacity: 0; } }`}</style>
      <div className="absolute inset-0 bg-gradient-to-b from-[#070d24] via-[#131c3f] to-[#0b1226]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(99,102,241,0.25),transparent_60%)]" />
      {stars.map(s => (
        <span
          key={s.id}
          className="absolute rounded-full bg-white animate-pulse"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`
          }}
        />
      ))}
      <div
        className="absolute right-[12%] top-[12%] w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-[#fef9c3]"
        style={{ boxShadow: '0 0 30px 10px rgba(254, 240, 138, 0.35), 0 0 80px 30px rgba(254, 240, 138, 0.15)' }}
      />
      <div
        className="night-meteor absolute right-[22%] top-[8%] w-24 h-1.5 rounded-full bg-gradient-to-r from-white to-transparent"
        style={{ animation: 'night-shoot 9s ease-in-out infinite' }}
      />
      <svg className="absolute bottom-0 left-0 w-full h-[38%] text-[#1e293b]" viewBox="0 0 1440 320" preserveAspectRatio="none" fill="currentColor">
        <path d="M0,224 L120,160 L240,208 L360,128 L480,192 L600,144 L720,208 L840,160 L960,224 L1080,176 L1200,208 L1320,160 L1440,192 L1440,320 L0,320 Z" opacity="0.6" />
      </svg>
      <svg className="absolute bottom-0 left-0 w-full h-[26%] text-[#0f172a]" viewBox="0 0 1440 320" preserveAspectRatio="none" fill="currentColor">
        <path d="M0,256 L180,192 L360,240 L540,176 L720,240 L900,192 L1080,256 L1260,208 L1440,240 L1440,320 L0,320 Z" />
      </svg>
    </div>
  );
};
