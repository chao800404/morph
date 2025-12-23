import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import LoadingBar, { LoadingBarRef } from "react-top-loading-bar";

export const TopLoader = () => {
  const ref = useRef<LoadingBarRef>(null);
  const isLoading = useRouterState({ select: (s) => s.isLoading });

  useEffect(() => {
    if (isLoading) {
      ref.current?.start();
    } else {
      ref.current?.complete();
    }
  }, [isLoading]);

  return <LoadingBar color="#f11946" ref={ref} shadow={true} />;
};
