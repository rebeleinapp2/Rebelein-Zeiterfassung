import React, { ReactNode, useRef, useState } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  hoverEffect?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className = "", onClick, hoverEffect = false }) => {
  return (
    <div
      onClick={onClick}
      className={`
        relative overflow-hidden
        bg-slate-900/30 backdrop-blur-2xl
        border border-white/15
        shadow-2xl shadow-black/40
        rounded-3xl p-6
        text-card-foreground
        transition-all duration-500 ease-out
        ${hoverEffect && onClick ? 'hover:bg-slate-900/50 hover:border-white/25 hover:scale-[1.01] hover:-translate-y-0.5 cursor-pointer' : ''}
        ${className}
      `}
    >
      {/* Light sweep effect */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/5 to-transparent z-0" />
      <div className="relative z-10 h-full">
        {children}
      </div>
    </div>
  );
};

export const GlassInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <div className="relative group">
    <input
      {...props}
      className={`
        w-full
        bg-black/30 backdrop-blur-md
        border border-white/10
        shadow-[inset_0_2px_10px_rgba(0,0,0,0.3)]
        rounded-2xl px-5 py-3.5
        text-sm ring-offset-background
        text-foreground placeholder:text-muted-foreground/40
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1
        transition-all duration-300
        disabled:opacity-50 disabled:cursor-not-allowed
        ${props.className || ''}
      `}
    />
  </div>
);

export const GlassButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'secondary' | 'ghost' }> = ({ children, variant = 'primary', className, ...props }) => {
  
  const variantClasses = {
    primary: "bg-gradient-to-br from-emerald-600 to-emerald-800 after:bg-gradient-to-br after:from-emerald-500 after:to-emerald-700 shadow-emerald-900/20",
    danger: "bg-gradient-to-br from-red-600 to-red-800 after:bg-gradient-to-br after:from-red-500 after:to-red-700 shadow-red-900/20",
    secondary: "bg-gradient-to-br from-slate-700 to-slate-900 after:bg-gradient-to-br after:from-slate-600 after:to-slate-800 shadow-slate-950/20",
    ghost: "bg-transparent hover:bg-white/5 shadow-none after:hidden"
  };

  const baseStyle = "bubbleeffectbtn w-full py-2 px-4 md:px-5 active:scale-95 transition-all duration-300 text-[11px] md:text-xs tracking-widest font-black";

  return (
    <button
      className={`${baseStyle} ${variantClasses[variant]} ${className || ''}`}
      {...props}
    >
      <span className="flex items-center justify-center gap-2 drop-shadow-md">
        {children}
      </span>
    </button>
  );
};