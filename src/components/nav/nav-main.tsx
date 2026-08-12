import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Link } from "@tanstack/react-router";
import { getIconByName } from "../icon-map";

export function NavMain({ items, title, activePathname }: NavMainProps & { activePathname: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu className="text-zinc-600 dark:text-zinc-400">
        {items?.map((item) => (
          <NavMainItem key={item.title} item={item} activePathname={activePathname} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

const NavMainItem = ({
  item,
  activePathname,
}: {
  item: NavMainProps["items"][number];
  activePathname: string;
}) => {
  const isPathActive = (url: string) =>
    activePathname === url || activePathname.startsWith(`${url}/`);
  const activeSubIndex =
    item.items?.findIndex((subItem) => isPathActive(subItem.url)) ?? -1;
  const direct = isPathActive(item.url);
  const isActive = Boolean(item.isActive || direct || activeSubIndex >= 0);
  const isOpen = direct || activeSubIndex >= 0;
  const Icon =
    typeof item.icon === "string" ? getIconByName(item.icon) : item.icon;

  return (
    <Collapsible asChild open={isOpen}>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
          <Link to={item.url}>
            {item.icon && <Icon />}
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
        {item.items?.length ? (
          <>
            <CollapsibleContent>
              <SidebarMenuSub>
                {item.items?.map((subItem, index) => {
                  return (
                    <SidebarMenuSubItem
                      showLine={activeSubIndex > index}
                      key={subItem.title}
                      isActive={index === activeSubIndex}
                    >
                      <SidebarMenuSubButton
                        isActive={index === activeSubIndex}
                        asChild
                      >
                        <Link to={subItem.url}>
                          <span>{subItem.title}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  );
                })}
              </SidebarMenuSub>
            </CollapsibleContent>
          </>
        ) : null}
      </SidebarMenuItem>
    </Collapsible>
  );
};
