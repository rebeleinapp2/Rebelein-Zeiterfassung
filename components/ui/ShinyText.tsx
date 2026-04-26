import React from 'react';
import { cn } from '@/lib/utils';

interface ShinyTextProps {
  text: string;
  className?: string;
  shimmerWidth?: number;
}

export const ShinyText: React.FC<ShinyTextProps> = ({ 
  text, 
  className,
  shimmerWidth = 100 
}) => {
  return (
    <div
      className={cn(
        "text-neutral-600/50 dark:text-neutral-400/50 bg-clip-text inline-block",
        "bg-gradient-to-r from-transparent via-white to-transparent bg-[length:200%_100%] animate-shine",
        className
      )}
      style={{
        backgroundImage: `linear-gradient(120deg, rgba(255, 255, 255, 0) 40%, rgba(255, 255, 255, 0.8) 50%, rgba(255, 255, 255, 0) 60%)`,
        backgroundSize: `${shimmerWidth}% 100%`,
        WebkitBackgroundClip: "text",
        animationDuration: '2s',
      }}
    >
      {text}
    </div>
  );
};
