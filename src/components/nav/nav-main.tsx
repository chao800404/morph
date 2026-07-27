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
import { Link, useLocation } from "@tanstack/react-router";
import { getIconByName } from "../icon-map";

export function NavMain({ items, title }: NavMainProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const isPathActive = (url: string) =>
    pathname === url || pathname.startsWith(`${url}/`);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu className="text-zinc-600 dark:text-zinc-400">
        {items?.map((item) => {
          const activeSubIndex =
            item.items?.findIndex((subItem) => isPathActive(subItem.url)) ?? -1;
          const isActive =
            item.isActive ||
            isPathActive(item.url) ||
            activeSubIndex >= 0;
          const isOpen = isPathActive(item.url) || activeSubIndex >= 0;
          const Icon =
            typeof item.icon === "string"
              ? getIconByName(item.icon)
              : item.icon;

          return (
            <Collapsible
              key={item.title}
              asChild
              open={isOpen}
            >
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  isActive={isActive}
                >
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
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
