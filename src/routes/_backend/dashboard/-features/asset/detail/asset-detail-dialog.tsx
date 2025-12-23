"use client";

import { AssetProperties } from "@/app/(backend)/dashboard/_components/card/assets-card/client/asset-properties";
import { useAssetsStore } from "@/app/(backend)/dashboard/_views/global/contents/assets/_stores/assets.store";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useMediaQuery } from "@/hooks/use-media-query";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { AnimatePresence, motion, useAnimate, useDragControls, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { AssetFeatureMotionButton } from "../../../_components/button/asset-feature-motion-button";
import { AssetPropertyHeader } from "../../../_components/card/assets-card/client/asset-property-header.client";

export function AssetDetailDialog() {
    const isDesktop = useMediaQuery("(min-width: 1280px)");
    const isLargeScreen = useMediaQuery("(min-width: 1024px)");
    const drawerRef = useRef<HTMLDivElement>(null);
    const controls = useDragControls();
    const y = useMotionValue(0);
    const [score, animate] = useAnimate();

    const { activeItem, setActiveItem } = useAssetsStore(
        useShallow(state => ({
            activeItem: state.activeItem,
            setActiveItem: state.setActiveItem,
        }))
    );

    // 計算 dashboard-content 的透明度
    // 使用 opacity 創造視覺層次感，完全不影響 sticky 定位
    // 當 y = 0 (dialog 完全打開) 時，opacity = 0.6 (半透明)
    // 當 y 增加時，opacity 逐漸接近 1.0 (完全不透明)
    // 假設拖動 200px 時完全還原
    const dashboardOpacity = useTransform(y, [0, 200], [0.6, 1.0]);

    // 當對話框打開且是小螢幕時，禁用 body 滾動
    useEffect(() => {
        if (activeItem?.type !== "asset") return;
        const shouldLockScroll = !!activeItem && !isLargeScreen;

        if (shouldLockScroll) {
            document.body.style.overflow = "hidden";
            document.body.style.height = "100svh";
        } else {
            document.body.style.overflow = "";
            document.body.style.height = "";
        }

        return () => {
            document.body.style.overflow = "";
            document.body.style.height = "";
        };
    }, [activeItem, isLargeScreen]);

    // 控制 dashboard-content 的透明度效果
    useEffect(() => {
        const dashboardContent = document.getElementById("dashboard-content");
        if (!dashboardContent) return;

        // 找到內部的實際內容容器（通常是第一個子元素）
        const contentWrapper = dashboardContent.firstElementChild as HTMLElement;
        if (!contentWrapper) return;

        const isActive = !!activeItem && activeItem.type === "asset" && !isLargeScreen;

        if (isActive) {
            // 訂閱 dashboardOpacity 的變化
            const unsubscribe = dashboardOpacity.on("change", (latest: number) => {
                // 只改變透明度，完全不影響定位和佈局
                contentWrapper.style.opacity = `${latest}`;
                contentWrapper.style.transition = "opacity 0.3s ease-out";
            });

            // 初始設置為半透明狀態
            contentWrapper.style.opacity = "0.6";
            contentWrapper.style.transition = "opacity 0.3s ease-out";

            return () => {
                unsubscribe();
                // 關閉時重置
                contentWrapper.style.opacity = "";
                contentWrapper.style.transition = "";
            };
        } else {
            // 如果對話框關閉，重置透明度
            contentWrapper.style.opacity = "";
            contentWrapper.style.transition = "";
        }
    }, [activeItem, isLargeScreen, dashboardOpacity]);

    // 根據螢幕尺寸決定動畫方向
    const lockedIsLargeScreenRef = useRef(isLargeScreen);
    const wasActiveRef = useRef(false);
    const prevIsLargeScreenRef = useRef(isLargeScreen);
    const isActive = !!activeItem && activeItem.type !== "folder";

    if (isActive && !wasActiveRef.current) {
        lockedIsLargeScreenRef.current = isLargeScreen;
    }
    wasActiveRef.current = isActive;

    const lockedIsLargeScreen = lockedIsLargeScreenRef.current;

    // 當螢幕尺寸改變且 dialog 已打開時，執行動畫
    useEffect(() => {
        if (!isActive) return;

        const prevIsLargeScreen = prevIsLargeScreenRef.current;

        // 從大螢幕變成小螢幕
        if (prevIsLargeScreen && !isLargeScreen) {
            // 重置 y 值並執行從底部滑上來的動畫
            y.set(0);
            animate("#drawer", { y: 0 }, { duration: 0.3, ease: "easeInOut" });
        }
        // 從小螢幕變成大螢幕
        else if (!prevIsLargeScreen && isLargeScreen) {
            // 執行從右側滑入的動畫
            animate("#drawer", { x: 0 }, { duration: 0.3, ease: "easeInOut" });
        }

        prevIsLargeScreenRef.current = isLargeScreen;
    }, [isLargeScreen, isActive, animate, y]);

    const animationVariants = lockedIsLargeScreen
        ? {
              initial: { x: "100%", opacity: 1 },
              animate: { x: 0, opacity: 1 },
              exit: { x: "100%", opacity: 0 },
          }
        : {
              initial: { y: "100%", opacity: 1 },
              animate: { y: 0, opacity: 1 },
              exit: { y: "100%", opacity: 0 },
          };

    const handleClose = async () => {
        if (isLargeScreen) return;
        animate(score.current, { opacity: [1, 0] });

        const yStart = typeof y.get() === "number" ? y.get() : 0;
        const drawerHeight = drawerRef.current?.offsetHeight || 0;

        await animate("#drawer", { y: [yStart, yStart + drawerHeight] });

        setActiveItem(undefined);
    };

    if (isDesktop) return null;
    if (!activeItem || activeItem.type === "folder") return null;

    const isAsset = activeItem.type === "asset";

    return (
        !!activeItem && (
            <motion.div
                className={cn(
                    "fixed top-0 right-0 h-dvh overflow-hidden p-3 pt-12 z-50 max-w-sm w-full pointer-events-none",
                    "max-lg:max-w-full max-lg:p-0"
                )}
                ref={score}
            >
                {/* 背景遮罩：使用實時 isLargeScreen，響應螢幕尺寸變化 */}
                {!isLargeScreen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={handleClose}
                        className="absolute inset-0 z-10 bg-black/50 backdrop-blur-xs pointer-events-auto"
                    />
                )}

                <motion.div
                    id="drawer"
                    ref={drawerRef}
                    // 拖曳功能：使用實時 isLargeScreen
                    drag={!isLargeScreen ? "y" : false}
                    dragConstraints={!isLargeScreen ? { top: 0, bottom: 0 } : undefined}
                    dragElastic={!isLargeScreen ? { top: 0, bottom: 0.5 } : undefined}
                    dragControls={!isLargeScreen ? controls : undefined}
                    transition={{ ease: "easeInOut" }}
                    dragListener={!isLargeScreen}
                    className={cn(
                        "shadow-sm/20 border relative z-20 flex flex-col bg-card h-full dark:shadow-elevation-modal rounded-lg pointer-events-auto",
                        "will-change-transform",
                        "max-lg:h-4/5 max-lg:w-full max-lg:shadow-none max-lg:border-t-[0.5px] max-lg:boder-zinc-700 max-lg:absolute max-lg:bottom-0 max-lg:rounded-b-none"
                    )}
                    onDragEnd={() => {
                        if (y.get() > 30) {
                            handleClose();
                        }
                    }}
                    // 動畫方向：使用鎖定的 lockedIsLargeScreen，避免動畫進行中切換方向
                    initial={animationVariants.initial}
                    animate={animationVariants.animate}
                    exit={animationVariants.exit}
                    style={!isLargeScreen ? { y } : undefined}
                >
                    <AnimatePresence>
                        {!isLargeScreen && (
                            <motion.div
                                key="feature-button"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1, delay: 0 } }}
                                transition={{ delay: 0.5, type: "spring", stiffness: 300, damping: 25 }}
                                className="absolute right-2 -top-16"
                            >
                                <AssetFeatureMotionButton
                                    type={isAsset ? "asset" : "folder"}
                                    id={activeItem.id}
                                    assetUrl={isAsset && activeItem.type === "asset" ? activeItem.src : undefined}
                                    name={activeItem.name}
                                    fileType={isAsset && activeItem.type === "asset" ? activeItem.fileType : undefined}
                                    size={isAsset && activeItem.type === "asset" ? activeItem.size : undefined}
                                    alt={isAsset && activeItem.type === "asset" ? activeItem.alt : undefined}
                                    caption={isAsset && activeItem.type === "asset" ? activeItem.caption : undefined}
                                    tags={
                                        isAsset && activeItem.type === "asset" ? activeItem.tags?.join(", ") : undefined
                                    }
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <div className="flex items-center justify-between border-b p-2">
                        <div className={cn("flex items-center gap-2", "max-lg:hidden")}>
                            <Button variant="ghost" size="icon" onClick={() => setActiveItem(undefined)}>
                                <X className="size-4 text-muted-foreground" />
                            </Button>
                            <Kbd className={cn("border text-xs")}>esc</Kbd>
                        </div>
                        <div className="max-lg:hidden">
                            <AssetPropertyHeader
                                type={isAsset ? "asset" : "folder"}
                                id={activeItem.id}
                                assetUrl={isAsset && activeItem.type === "asset" ? activeItem.src : undefined}
                                name={activeItem.name}
                                fileType={isAsset && activeItem.type === "asset" ? activeItem.fileType : undefined}
                                size={isAsset && activeItem.type === "asset" ? activeItem.size : undefined}
                                alt={isAsset && activeItem.type === "asset" ? activeItem.alt : undefined}
                                caption={isAsset && activeItem.type === "asset" ? activeItem.caption : undefined}
                                tags={isAsset && activeItem.type === "asset" ? activeItem.tags?.join(", ") : undefined}
                            />
                        </div>
                        {/* 拖曳手柄：使用實時 isLargeScreen */}
                        {!isLargeScreen && (
                            <button onPointerDown={e => controls.start(e)} className="w-full pb-3 flex justify-center">
                                <div className="rounded-full touch-none cursor-grab active:cursor-grabbing w-14 bg-zinc-600 h-1" />
                            </button>
                        )}
                    </div>
                    <div className="flex-1 min-h-0">
                        <AssetProperties />
                    </div>
                </motion.div>
            </motion.div>
        )
    );
}
