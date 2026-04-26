import React, { useRef, useEffect } from 'react';

interface DragScrollContainerProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}

export const DragScrollContainer: React.FC<DragScrollContainerProps> = ({ children, className = "", ...props }) => {
    const sliderRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const slider = sliderRef.current;
        if (!slider) return;

        let isDown = false;
        let startX: number;
        let startY: number;
        let scrollLeft: number;
        let scrollTop: number;
        let dragged = false;

        // Momentum / inertia variables
        let velX = 0;
        let velY = 0;
        let momentumID: number;
        let lastMouseX: number;
        let lastMouseY: number;
        let lastTime: number;

        const cancelMomentumTracking = () => {
            cancelAnimationFrame(momentumID);
        };

        const momentumLoop = () => {
            if (!slider) return;
            
            // Friction factor (0.95 gives a smooth but reasonable slow-down)
            velX *= 0.95;
            velY *= 0.95;

            slider.scrollLeft += velX;
            slider.scrollTop += velY;

            // Stop if velocity is very small to avoid endless animation loop
            if (Math.abs(velX) > 0.5 || Math.abs(velY) > 0.5) {
                momentumID = requestAnimationFrame(momentumLoop);
            }
        };

        const onMouseDown = (e: MouseEvent) => {
            isDown = true;
            dragged = false;
            slider.style.cursor = 'grabbing';
            startX = e.pageX - slider.offsetLeft;
            startY = e.pageY - slider.offsetTop;
            scrollLeft = slider.scrollLeft;
            scrollTop = slider.scrollTop;
            
            lastMouseX = e.pageX;
            lastMouseY = e.pageY;
            lastTime = performance.now();
            
            // Stop any ongoing momentum
            cancelMomentumTracking();
        };

        const onMouseLeave = () => {
            if (!isDown) return;
            isDown = false;
            slider.style.cursor = 'grab';
            momentumID = requestAnimationFrame(momentumLoop);
        };

        const onMouseUp = () => {
            isDown = false;
            slider.style.cursor = 'grab';
            
            // Kick off momentum scroll
            momentumID = requestAnimationFrame(momentumLoop);
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isDown) return;
            
            const x = e.pageX - slider.offsetLeft;
            const y = e.pageY - slider.offsetTop;
            
            // Track walk distance to determine if it's a drag or a click
            const walkX = (x - startX);
            const walkY = (y - startY);
            
            if (Math.abs(walkX) > 5 || Math.abs(walkY) > 5) {
                dragged = true;
            }

            // Move the scroll
            slider.scrollLeft = scrollLeft - walkX;
            slider.scrollTop = scrollTop - walkY;

            // Calculate velocity for momentum
            const now = performance.now();
            const elapsed = now - lastTime;
            
            if (elapsed > 0) {
                // Invert the velocity so it scrolls in the right direction
                velX = -(e.pageX - lastMouseX) / elapsed * 15; 
                velY = -(e.pageY - lastMouseY) / elapsed * 15; 
            }
            
            lastMouseX = e.pageX;
            lastMouseY = e.pageY;
            lastTime = now;
        };

        const onClick = (e: MouseEvent) => {
            if (dragged) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        slider.addEventListener('mousedown', onMouseDown);
        slider.addEventListener('mouseleave', onMouseLeave);
        slider.addEventListener('mouseup', onMouseUp);
        slider.addEventListener('mousemove', onMouseMove);
        // Use capture phase to stop clicks on child elements if we dragged
        slider.addEventListener('click', onClick, { capture: true });

        // Init cursor
        slider.style.cursor = 'grab';

        return () => {
            slider.removeEventListener('mousedown', onMouseDown);
            slider.removeEventListener('mouseleave', onMouseLeave);
            slider.removeEventListener('mouseup', onMouseUp);
            slider.removeEventListener('mousemove', onMouseMove);
            slider.removeEventListener('click', onClick, { capture: true });
            cancelMomentumTracking();
        };
    }, []);

    return (
        <div ref={sliderRef} className={`select-none ${className}`} {...props}>
            {children}
        </div>
    );
};
