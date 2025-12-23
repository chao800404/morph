import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import React, { useState } from "react";

export const PasswordInput = ({
  className,
  ...props
}: React.ComponentProps<typeof InputGroupInput>) => {
  const [show, setShow] = useState(false);

  const handleOnShow = () => setShow((toggle) => !toggle);

  return (
    <InputGroup className={cn("bg-background rounded-md-plus")}>
      <InputGroupInput
        {...props}
        className={cn(className)}
        type={show ? "text" : "password"}
      />
      <InputGroupAddon
        className="border-l h-full  has-[>button]:mr-0 p-1"
        align="inline-end"
      >
        <InputGroupButton
          className="hover:bg-transparent z-20 has-[>svg]:px-1.5"
          onClick={handleOnShow}
        >
          {show ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
};
