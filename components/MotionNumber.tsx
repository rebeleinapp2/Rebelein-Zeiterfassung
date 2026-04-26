import React, { useEffect, useState } from 'react';
import { animate } from 'framer-motion';

interface MotionNumberProps {
    value: number;
    className?: string;
    duration?: number;
}

export const MotionNumber: React.FC<MotionNumberProps> = ({ value, className = "", duration = 1.5 }) => {
    const [displayValue, setDisplayValue] = useState(0);

    useEffect(() => {
        const controls = animate(displayValue, value, {
            duration,
            ease: "easeOut",
            onUpdate: (latest) => setDisplayValue(Math.round(latest))
        });
        return () => controls.stop();
    }, [value, duration]); // React on value change

    return <span className={className}>{displayValue}</span>;
};
