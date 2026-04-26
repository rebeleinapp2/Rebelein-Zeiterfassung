import React, { useRef, useState } from 'react';

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}

export const SpotlightCard: React.FC<SpotlightCardProps> = ({ children, className = "", ...props }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [opacity, setOpacity] = useState(0);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    return (
        <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setOpacity(1)}
            onMouseLeave={() => setOpacity(0)}
            className={`
                relative overflow-hidden group 
                bg-slate-900/30 backdrop-blur-2xl
                border border-white/15
                shadow-2xl shadow-black/40
                rounded-3xl
                transition-all duration-700 ease-out
                hover:shadow-primary/5 hover:border-white/20
                ${className}
            `}
            {...props}
        >
            {/* Spotlight Gradient */}
            <div
                className="pointer-events-none absolute -inset-px transition-opacity duration-500 z-0"
                style={{
                    opacity,
                    background: `radial-gradient(400px circle at ${position.x}px ${position.y}px, rgba(16, 185, 129, 0.12), transparent 70%)`,
                }}
            />
            
            {/* Ambient inner glow */}
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/5 to-transparent z-0 opacity-50" />

            <div className="relative z-10 h-full flex flex-col">
                {children}
            </div>
        </div>
    );
};
