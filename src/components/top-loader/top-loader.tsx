import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import LoadingBar, { LoadingBarRef } from "react-top-loading-bar";

type TopLoaderProps = {
  ignoreSearchOnly?: boolean;
};

export const TopLoader = ({ ignoreSearchOnly = false }: TopLoaderProps) => {
  const ref = useRef<LoadingBarRef>(null);
  const shouldShow = useRouterState({
    select: (state) =>
      state.isLoading &&
      (!ignoreSearchOnly ||
        !state.resolvedLocation ||
        state.location.pathname !== state.resolvedLocation.pathname),
  });

  useEffect(() => {
    if (shouldShow) {
      ref.current?.start();
    } else {
      ref.current?.complete();
    }
  }, [shouldShow]);

  return <LoadingBar color="#f11946" ref={ref} shadow={true} />;
};
