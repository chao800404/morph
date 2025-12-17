"use client";

import { useEffect, useState } from "react";

interface CountdownTextProps {
    initialSeconds: number;
    onComplete?: () => void;
    prefix?: string;
    suffix?: string;
    format?: "seconds" | "mm:ss";
}

/**
 * A simple countdown text component
 *
 * @example
 * // Simple seconds countdown
 * <CountdownText
 *   initialSeconds={3}
 *   prefix="Redirecting in "
 *   suffix=" seconds"
 *   onComplete={() => router.push("/auth/sign-in")}
 * />
 *
 * @example
 * // Minutes and seconds format (5:00)
 * <CountdownText
 *   initialSeconds={300}
 *   format="mm:ss"
 *   prefix="Code expires in "
 *   onComplete={() => alert("Code expired")}
 * />
 */
export function CountdownText({
    initialSeconds,
    onComplete,
    prefix = "",
    suffix = "",
    format = "seconds",
}: CountdownTextProps) {
    const [seconds, setSeconds] = useState(initialSeconds);

    useEffect(() => {
        if (seconds <= 0) {
            onComplete?.();
            return;
        }

        const timer = setTimeout(() => {
            setSeconds(prev => prev - 1);
        }, 1000);

        return () => clearTimeout(timer);
    }, [seconds, onComplete]);

    const formatTime = (totalSeconds: number): string => {
        if (format === "mm:ss") {
            const minutes = Math.floor(totalSeconds / 60);
            const secs = totalSeconds % 60;
            return `${minutes}:${secs.toString().padStart(2, "0")}`;
        }
        return totalSeconds.toString();
    };

    return (
        <>
            {prefix}
            <span className="font-bold text-foreground mx-1">{formatTime(seconds)}</span>
            {suffix}
        </>
    );
}
