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

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu className="text-zinc-600 dark:text-zinc-400">
        {items?.map((item) => {
          const isActive = item.isActive || pathname === item.url;
          const Icon =
            typeof item.icon === "string"
              ? getIconByName(item.icon)
              : item.icon;

          return (
            <Collapsible
              key={item.title}
              asChild
              open={pathname.includes(item.url)}
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
                          const activeIndex =
                            item.items?.findIndex(
                              (item) => item.url === pathname,
                            ) || 0;
                          return (
                            <SidebarMenuSubItem
                              showLine={activeIndex > index}
                              key={subItem.title}
                              isActive={index === activeIndex}
                            >
                              <SidebarMenuSubButton
                                isActive={index === activeIndex}
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
