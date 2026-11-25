import React from 'react';

interface BrandLogoProps {
  variant?: 'light' | 'dark';
  compact?: boolean;
  subtitle?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'dark',
  compact = false,
  subtitle,
}) => {
  const isLightOnNavy = variant === 'light';
  const titleColor = isLightOnNavy ? 'text-white' : 'text-primary';
  const subColor = isLightOnNavy ? 'text-on-primary-container' : 'text-on-surface-variant';
  const iconBoxBg = isLightOnNavy ? 'bg-secondary text-white' : 'bg-primary text-white';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <span
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${iconBoxBg}`}
      >
        <svg
          className="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          <path d="M8 7h6" />
          <path d="M8 11h8" />
        </svg>
      </span>
      <span className="flex flex-col text-left">
        <span
          className={`font-headline text-base font-extrabold tracking-tight leading-none ${titleColor}`}
        >
          {compact ? 'VIDHYA' : 'VIDHYA LIBRARY'}
        </span>
        {subtitle && (
          <span className={`font-label text-[11px] font-semibold mt-0.5 leading-none ${subColor}`}>
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
};
