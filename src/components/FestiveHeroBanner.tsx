import React from 'react';
import { ArrowRight, Scale, Sparkles } from 'lucide-react';

interface FestiveHeroBannerProps {
  onExploreDeals: () => void;
  onCompareFlagships: () => void;
}

export const FestiveHeroBanner: React.FC<FestiveHeroBannerProps> = ({
  onExploreDeals,
  onCompareFlagships,
}) => {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#07090e] border border-slate-800 shadow-2xl text-white">
      {/* Background Graphic: 3 Futuristic Cyber Smartphones angled in 3D over circuit traces */}
      <div 
        className="absolute inset-0 bg-cover bg-right md:bg-[center_right_-2rem] lg:bg-right opacity-65 md:opacity-90 pointer-events-none"
        style={{
          backgroundImage: `url('/images/flagship-fest-phones.jpg')`,
        }}
      />

      {/* Dark gradient overlay from left to right to ensure 100% legibility of left typography */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#07090e] via-[#07090e]/95 via-45% md:via-55% to-transparent pointer-events-none" />

      {/* Subtle orange/neon ambient glow */}
      <div className="pointer-events-none absolute left-10 top-0 h-64 w-64 rounded-full bg-[#ff5500]/10 blur-3xl" />

      <div className="relative z-10 mx-auto flex flex-col md:flex-row items-center justify-between px-6 py-10 sm:px-12 md:py-14 lg:py-16">
        {/* Left Content Matching User's Image */}
        <div className="w-full md:max-w-xl lg:max-w-2xl text-left">
          {/* 1. Orange Badge: LIMITED TIME FESTIVE OFFER */}
          <div className="inline-block rounded-md bg-[#ff5500] px-3.5 py-1.5 text-[11px] sm:text-xs font-black uppercase tracking-wider text-white shadow-md shadow-[#ff5500]/25">
            LIMITED TIME FESTIVE OFFER
          </div>

          {/* 2. Main Title: Flagship Phones Fest */}
          <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl font-sans drop-shadow-sm">
            Flagship Phones Fest
          </h1>

          {/* 3. Orange Sub-Title: Up to 40% Off */}
          <p className="mt-2 text-2xl font-black text-[#ff5500] sm:text-4xl lg:text-5xl tracking-tight">
            Up to 40% Off
          </p>

          {/* 4. Description Paragraph */}
          <p className="mt-4 max-w-lg text-xs leading-relaxed text-slate-300 sm:text-sm md:text-base font-normal">
            Get crazy exchange bonuses, no-cost EMI up to 12 months, and instant 10% bank discount on major credit cards.
          </p>

          {/* 5. CTA Buttons */}
          <div className="mt-7 flex flex-wrap items-center gap-3.5">
            {/* Explore Deals: White pill button */}
            <button
              onClick={onExploreDeals}
              className="flex items-center gap-2 rounded-xl bg-white px-7 py-3 text-xs sm:text-sm font-bold text-slate-900 shadow-xl transition duration-200 hover:bg-slate-100 hover:scale-102 active:scale-98 cursor-pointer"
            >
              <span>Explore Deals</span>
            </button>

            {/* Compare Premium Models: Transparent with border */}
            <button
              onClick={onCompareFlagships}
              className="flex items-center gap-2 rounded-xl border border-white/60 bg-black/25 px-6 py-3 text-xs sm:text-sm font-semibold text-white backdrop-blur transition duration-200 hover:border-white hover:bg-white/10 hover:scale-102 active:scale-98 cursor-pointer"
            >
              <span>Compare Premium Models</span>
            </button>
          </div>
        </div>

        {/* Right Side: Spacer & Vertical Pager Indicators */}
        <div className="hidden md:flex items-center justify-end pr-2 pl-4">
          {/* Vertical Pager Dots matching Image */}
          <div className="flex flex-col items-center gap-2">
            <span className="h-6 w-1.5 rounded-full bg-[#ff5500] shadow-sm shadow-[#ff5500]/50" />
            <span className="h-1.5 w-1.5 rounded-full bg-slate-500/80" />
            <span className="h-1.5 w-1.5 rounded-full bg-slate-500/80" />
          </div>
        </div>
      </div>
    </div>
  );
};
