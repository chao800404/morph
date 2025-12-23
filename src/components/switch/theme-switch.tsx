"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "tanstack-theme-kit";
import { CircleHalfSolidIcon } from "../ui/icons/circle-half-solid-icon";

export const ThemeSwitch = () => {
  const { theme, setTheme } = useTheme();
  const check = theme === "dark";

  return (
    <div className="flex gap-2 items-center w-full relative">
      <CircleHalfSolidIcon />
      <div className="flex items-center w-full space-x-2 justify-between">
        <Label className="font-normal" htmlFor="theme-mode">
          Theme
        </Label>

        <Switch
          checked={check}
          onCheckedChange={(checked) =>
            setTheme(() => (checked ? "dark" : "light"))
          }
          id="theme-mode"
          className="ml-auto duration-0"
        />
      </div>
    </div>
  );
};
