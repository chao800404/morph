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
import { Link, useRouterState } from "@tanstack/react-router";
import { getIconByName } from "../icon-map";

export function NavMain({ items, title }: NavMainProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu className="text-zinc-600 dark:text-zinc-400">
        {items?.map((item) => (
          <NavMainItem key={item.title} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

const NavMainItem = ({ item }: { item: NavMainProps["items"][number] }) => {
  // A scalar selector is deliberate: navigating between unrelated pages no
  // longer wakes every sidebar item. Only the old and new active item receive
  // a different value and render.
  const activeState = useRouterState({
    select: (state) => {
      const pathname = state.location.pathname;
      const isPathActive = (url: string) =>
        pathname === url || pathname.startsWith(`${url}/`);
      const activeSubIndex =
        item.items?.findIndex((subItem) => isPathActive(subItem.url)) ?? -1;
      const direct = isPathActive(item.url);
      return `${item.isActive || direct || activeSubIndex >= 0 ? 1 : 0}:${direct || activeSubIndex >= 0 ? 1 : 0}:${activeSubIndex}`;
    },
  });
  const [active, open, activeSubIndexValue] = activeState.split(":");
  const isActive = active === "1";
  const isOpen = open === "1";
  const activeSubIndex = Number(activeSubIndexValue);
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
