import React from 'react';

interface BrandLogoProps {
  variant?: 'light' | 'dark';
  compact?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'light', compact = false }) => {
  const textColor = variant === 'dark' ? 'text-[#0E0713]' : 'text-white';
  return (
    <span className={`inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 ${textColor}`}>
      <svg
        width="32"
        height="32"
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="36" height="36" rx="8" fill="#3D2C56" stroke="#B5ADC6" strokeWidth="1.2" />
        <path
          d="M9 12.5C9 11.6716 9.67157 11 10.5 11H16.5C17.3284 11 18 11.6716 18 12.5V25.5C17.2 24.7 16 24.2 14.5 24.2H10.5C9.67157 24.2 9 23.5284 9 22.7V12.5Z"
          stroke="#B5ADC6"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M27 12.5C27 11.6716 26.3284 11 25.5 11H19.5C18.6716 11 18 11.6716 18 12.5V25.5C18.8 24.7 20 24.2 21.5 24.2H25.5C26.3284 24.2 27 23.5284 27 22.7V12.5Z"
          stroke="#B5ADC6"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M18 7.5C18 7.5 19.8 9.2 19.8 10.6C19.8 11.5941 18.9941 12.4 18 12.4C17.0059 12.4 16.2 11.5941 16.2 10.6C16.2 9.2 18 7.5 18 7.5Z"
          fill="#FFFFFF"
        />
      </svg>
      <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
        {compact ? 'VIDHYA' : 'VIDHYA LIBRARY'}
      </span>
    </span>
  );
};
