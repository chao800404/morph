"use client";

import { motion } from "motion/react";

interface BgVideoProps {
    videoSrc: string;
}

export const BgVideo = ({ videoSrc }: BgVideoProps) => {
    return (
        <motion.video
            initial={{ opacity: 0, scale: 1.2 }}
            animate={{ opacity: 0.2, scale: 1 }}
            transition={{ duration: 1 }}
            className="absolute opacity-20 z-10 top-0 left-0 w-full h-full object-cover"
            src={videoSrc}
            autoPlay
            loop
            muted
            controls={false}
        />
    );
};
