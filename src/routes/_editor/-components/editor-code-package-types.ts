/**
 * Export indexes for the packages a Theme is allowed to use in the isolated
 * build. Monaco cannot read the Theme's server-side node_modules, so these
 * compact declarations are the source for its completion and auto-import
 * worker. Keep additions aligned with the compiler allowlist and pinned
 * Theme toolchain instead of exposing arbitrary package names.
 */
export type ThemePackageTypeManifest = {
  readonly values: readonly string[];
  readonly types: readonly string[];
};

const TANSTACK_REACT_ROUTER_VALUES = [
  "AbsoluteToPath", "ActiveLinkOptions", "ActiveOptions", "AnyContext", "AnyPathParams", "AnyRedirect", "AnyRootRoute", "AnyRoute", "AnyRouteMatch", "AnyRouteWithContext", "AnyRouter", "AnyRouterWithContext",
  "AnySchema", "AnySerializationAdapter", "AnyValidator", "AnyValidatorAdapter", "AnyValidatorFn", "AnyValidatorObj", "Asset", "Assign", "AsyncRouteComponent", "Await", "AwaitOptions", "BaseRouteOptions",
  "BeforeLoadContextOptions", "BeforeLoadContextParameter", "Block", "BlockerFn", "BuildLocationFn", "BuildNextOptions", "CatchBoundary", "CatchNotFound", "ClientOnly", "CommitLocationOptions", "Constrain", "ContextAsyncReturnType",
  "ContextOptions", "ContextReturnType", "ControllablePromise", "ControlledPromise", "CreateFileRoute", "CreateLazyFileRoute", "CreateLinkProps", "DEFAULT_PROTOCOL_ALLOWLIST", "DefaultGlobalNotFound", "DefaultRouteTypes", "DefaultValidator", "DeferredPromise",
  "DeferredPromiseState", "ErrorComponent", "ErrorComponentProps", "ErrorRouteComponent", "ErrorRouteProps", "Expand", "FileBaseRouteOptions", "FileRoute", "FileRouteLoader", "FileRouteTypes", "FileRoutesByPath", "FullSearchSchemaOption",
  "HeadContent", "HistoryLocation", "HistoryState", "InferAllContext", "InferAllParams", "InferDescendantToPaths", "InferFrom", "InferFullSearchSchema", "InferFullSearchSchemaInput", "InferMaskFrom", "InferMaskTo", "InferSelected",
  "InferShouldThrow", "InferStrict", "InferStructuralSharing", "InferTo", "InjectedHtmlEntry", "IntersectAssign", "LazyRoute", "LazyRouteOptions", "Link", "LinkComponent", "LinkComponentProps", "LinkOptions",
  "LinkProps", "ListenerFn", "LoaderFnContext", "LocationRewrite", "LocationRewriteFunction", "LooseAsyncReturnType", "LooseReturnType", "MakeMatchRouteOptions", "MakeOptionalPathParams", "MakeRemountDepsOptionsUnion", "MakeRouteMatch", "MakeRouteMatchUnion",
  "Manifest", "Match", "MatchLocation", "MatchRoute", "MatchRouteOptions", "Matches", "MergeAll", "MetaDescriptor", "Navigate", "NavigateFn", "NavigateOptions", "NotFoundError",
  "NotFoundRoute", "NotFoundRouteComponent", "NotFoundRouteProps", "Outlet", "ParamsOptions", "ParseParamsFn", "ParsedLocation", "ParsedPath", "PathParamOptions", "PreloadableObj", "Redirect", "RedirectOptions",
  "Register", "RegisteredRouter", "RegisteredSerializableInput", "RelativeToCurrentPath", "RelativeToParentPath", "RelativeToPath", "RelativeToPathAutoComplete", "RemountDepsOptions", "RemoveLeadingSlashes", "RemoveTrailingSlashes", "ResolveAllContext", "ResolveAllParamsFromParent",
  "ResolveFullPath", "ResolveFullSearchSchema", "ResolveFullSearchSchemaInput", "ResolveId", "ResolveLoaderData", "ResolveOptionalParams", "ResolveParams", "ResolveRelativePath", "ResolveRequiredParams", "ResolveRoute", "ResolveRouteContext", "ResolveSearchValidatorInput",
  "ResolveSearchValidatorInputFn", "ResolveValidatorInput", "ResolveValidatorInputFn", "ResolveValidatorOutput", "ResolveValidatorOutputFn", "ResolvedRedirect", "RootRoute", "RootRouteId", "RootRouteOptions", "Route", "RouteApi", "RouteById",
  "RouteComponent", "RouteConstraints", "RouteContext", "RouteContextFn", "RouteContextOptions", "RouteContextParameter", "RouteIds", "RouteLinkEntry", "RouteLoaderFn", "RouteMask", "RouteMatch", "RouteOptions",
  "RoutePathOptions", "RoutePathOptionsIntersection", "RouteTypes", "Router", "RouterConstructorOptions", "RouterContextOptions", "RouterContextProvider", "RouterEvent", "RouterEvents", "RouterHistory", "RouterListener", "RouterManagedTag",
  "RouterOptions", "RouterProps", "RouterProvider", "RouterState", "ScriptOnce", "Scripts", "ScrollRestoration", "SearchFilter", "SearchMiddleware", "SearchParamError", "SearchParamOptions", "SearchParser",
  "SearchSchemaInput", "SearchSerializer", "Serializable", "SerializableExtensions", "SerializationAdapter", "SerializerExtensions", "ShouldBlockFn", "StaticDataRouteOption", "StringifyParamsFn", "ToMaskOptions", "ToOptions", "ToPathOption",
  "ToSubOptions", "TrailingSlashOption", "TrimPath", "TrimPathLeft", "TrimPathRight", "UpdatableRouteOptions", "UpdatableStaticRouteOption", "UseBlockerOpts", "UseLinkPropsOptions", "UseMatchRouteOptions", "UseNavigateResult", "ValidateFromPath",
  "ValidateId", "ValidateLinkOptions", "ValidateLinkOptionsArray", "ValidateNavigateOptions", "ValidateNavigateOptionsArray", "ValidateParams", "ValidateRedirectOptions", "ValidateRedirectOptionsArray", "ValidateSearch", "ValidateToPath", "ValidateUseParamsOptions", "ValidateUseParamsResult",
  "ValidateUseSearchOptions", "ValidateUseSearchResult", "Validator", "ValidatorAdapter", "ValidatorFn", "ValidatorObj", "cleanPath", "composeRewrites", "createBrowserHistory", "createControlledPromise", "createFileRoute", "createHashHistory",
  "createHistory", "createLazyFileRoute", "createLazyRoute", "createLink", "createMemoryHistory", "createRootRoute", "createRootRouteWithContext", "createRoute", "createRouteMask", "createRouter", "createRouterConfig", "createSerializationAdapter",
  "deepEqual", "defaultParseSearch", "defaultStringifySearch", "defer", "functionalUpdate", "getRouteApi", "interpolatePath", "isMatch", "isNotFound", "isPlainArray", "isPlainObject", "isRedirect",
  "joinPaths", "lazyFn", "lazyRouteComponent", "linkOptions", "notFound", "parseSearchWith", "reactUse", "redirect", "replaceEqualDeep", "resolvePath", "retainSearchParams", "rootRouteId",
  "rootRouteWithContext", "stringifySearchWith", "stripSearchParams", "trimPath", "trimPathLeft", "trimPathRight", "useAwaited", "useBlocker", "useCanGoBack", "useChildMatches", "useElementScrollRestoration", "useHydrated",
  "useLayoutEffect", "useLinkProps", "useLoaderData", "useLoaderDeps", "useLocation", "useMatch", "useMatchRoute", "useMatches", "useNavigate", "useParams", "useParentMatches", "useRouteContext",
  "useRouter", "useRouterState", "useSearch", "useTags",
] as const;

const TANSTACK_REACT_START_VALUES = [
  "Hydrate", "HydrateOptions", "HydrateProps", "HydrationInteractionEvent", "HydrationInteractionEvents", "HydrationPrefetchStrategy", "HydrationStrategy", "HydrationWhen", "createClientOnlyFn", "createCsrfMiddleware", "createIsomorphicFn", "createMiddleware",
  "createServerFn", "createServerOnlyFn", "createStart", "useServerFn",
] as const;

const LUCIDE_REACT_VALUES = [
  "AArrowDown", "AArrowDownIcon", "AArrowUp", "AArrowUpIcon", "ALargeSmall", "ALargeSmallIcon", "Accessibility", "AccessibilityIcon", "Activity", "ActivityIcon", "ActivitySquare", "ActivitySquareIcon",
  "AirVent", "AirVentIcon", "Airplay", "AirplayIcon", "AlarmCheck", "AlarmCheckIcon", "AlarmClock", "AlarmClockCheck", "AlarmClockCheckIcon", "AlarmClockIcon", "AlarmClockMinus", "AlarmClockMinusIcon",
  "AlarmClockOff", "AlarmClockOffIcon", "AlarmClockPlus", "AlarmClockPlusIcon", "AlarmMinus", "AlarmMinusIcon", "AlarmPlus", "AlarmPlusIcon", "AlarmSmoke", "AlarmSmokeIcon", "Album", "AlbumIcon",
  "AlertCircle", "AlertCircleIcon", "AlertOctagon", "AlertOctagonIcon", "AlertTriangle", "AlertTriangleIcon", "AlignCenter", "AlignCenterHorizontal", "AlignCenterHorizontalIcon", "AlignCenterIcon", "AlignCenterVertical", "AlignCenterVerticalIcon",
  "AlignEndHorizontal", "AlignEndHorizontalIcon", "AlignEndVertical", "AlignEndVerticalIcon", "AlignHorizontalDistributeCenter", "AlignHorizontalDistributeCenterIcon", "AlignHorizontalDistributeEnd", "AlignHorizontalDistributeEndIcon", "AlignHorizontalDistributeStart", "AlignHorizontalDistributeStartIcon", "AlignHorizontalJustifyCenter", "AlignHorizontalJustifyCenterIcon",
  "AlignHorizontalJustifyEnd", "AlignHorizontalJustifyEndIcon", "AlignHorizontalJustifyStart", "AlignHorizontalJustifyStartIcon", "AlignHorizontalSpaceAround", "AlignHorizontalSpaceAroundIcon", "AlignHorizontalSpaceBetween", "AlignHorizontalSpaceBetweenIcon", "AlignJustify", "AlignJustifyIcon", "AlignLeft", "AlignLeftIcon",
  "AlignRight", "AlignRightIcon", "AlignStartHorizontal", "AlignStartHorizontalIcon", "AlignStartVertical", "AlignStartVerticalIcon", "AlignVerticalDistributeCenter", "AlignVerticalDistributeCenterIcon", "AlignVerticalDistributeEnd", "AlignVerticalDistributeEndIcon", "AlignVerticalDistributeStart", "AlignVerticalDistributeStartIcon",
  "AlignVerticalJustifyCenter", "AlignVerticalJustifyCenterIcon", "AlignVerticalJustifyEnd", "AlignVerticalJustifyEndIcon", "AlignVerticalJustifyStart", "AlignVerticalJustifyStartIcon", "AlignVerticalSpaceAround", "AlignVerticalSpaceAroundIcon", "AlignVerticalSpaceBetween", "AlignVerticalSpaceBetweenIcon", "Ambulance", "AmbulanceIcon",
  "Ampersand", "AmpersandIcon", "Ampersands", "AmpersandsIcon", "Amphora", "AmphoraIcon", "Anchor", "AnchorIcon", "Angry", "AngryIcon", "Annoyed", "AnnoyedIcon",
  "Antenna", "AntennaIcon", "Anvil", "AnvilIcon", "Aperture", "ApertureIcon", "AppWindow", "AppWindowIcon", "AppWindowMac", "AppWindowMacIcon", "Apple", "AppleIcon",
  "Archive", "ArchiveIcon", "ArchiveRestore", "ArchiveRestoreIcon", "ArchiveX", "ArchiveXIcon", "AreaChart", "AreaChartIcon", "Armchair", "ArmchairIcon", "ArrowBigDown", "ArrowBigDownDash",
  "ArrowBigDownDashIcon", "ArrowBigDownIcon", "ArrowBigLeft", "ArrowBigLeftDash", "ArrowBigLeftDashIcon", "ArrowBigLeftIcon", "ArrowBigRight", "ArrowBigRightDash", "ArrowBigRightDashIcon", "ArrowBigRightIcon", "ArrowBigUp", "ArrowBigUpDash",
  "ArrowBigUpDashIcon", "ArrowBigUpIcon", "ArrowDown", "ArrowDown01", "ArrowDown01Icon", "ArrowDown10", "ArrowDown10Icon", "ArrowDownAZ", "ArrowDownAZIcon", "ArrowDownAz", "ArrowDownAzIcon", "ArrowDownCircle",
  "ArrowDownCircleIcon", "ArrowDownFromLine", "ArrowDownFromLineIcon", "ArrowDownIcon", "ArrowDownLeft", "ArrowDownLeftFromCircle", "ArrowDownLeftFromCircleIcon", "ArrowDownLeftFromSquare", "ArrowDownLeftFromSquareIcon", "ArrowDownLeftIcon", "ArrowDownLeftSquare", "ArrowDownLeftSquareIcon",
  "ArrowDownNarrowWide", "ArrowDownNarrowWideIcon", "ArrowDownRight", "ArrowDownRightFromCircle", "ArrowDownRightFromCircleIcon", "ArrowDownRightFromSquare", "ArrowDownRightFromSquareIcon", "ArrowDownRightIcon", "ArrowDownRightSquare", "ArrowDownRightSquareIcon", "ArrowDownSquare", "ArrowDownSquareIcon",
  "ArrowDownToDot", "ArrowDownToDotIcon", "ArrowDownToLine", "ArrowDownToLineIcon", "ArrowDownUp", "ArrowDownUpIcon", "ArrowDownWideNarrow", "ArrowDownWideNarrowIcon", "ArrowDownZA", "ArrowDownZAIcon", "ArrowDownZa", "ArrowDownZaIcon",
  "ArrowLeft", "ArrowLeftCircle", "ArrowLeftCircleIcon", "ArrowLeftFromLine", "ArrowLeftFromLineIcon", "ArrowLeftIcon", "ArrowLeftRight", "ArrowLeftRightIcon", "ArrowLeftSquare", "ArrowLeftSquareIcon", "ArrowLeftToLine", "ArrowLeftToLineIcon",
  "ArrowRight", "ArrowRightCircle", "ArrowRightCircleIcon", "ArrowRightFromLine", "ArrowRightFromLineIcon", "ArrowRightIcon", "ArrowRightLeft", "ArrowRightLeftIcon", "ArrowRightSquare", "ArrowRightSquareIcon", "ArrowRightToLine", "ArrowRightToLineIcon",
  "ArrowUp", "ArrowUp01", "ArrowUp01Icon", "ArrowUp10", "ArrowUp10Icon", "ArrowUpAZ", "ArrowUpAZIcon", "ArrowUpAz", "ArrowUpAzIcon", "ArrowUpCircle", "ArrowUpCircleIcon", "ArrowUpDown",
  "ArrowUpDownIcon", "ArrowUpFromDot", "ArrowUpFromDotIcon", "ArrowUpFromLine", "ArrowUpFromLineIcon", "ArrowUpIcon", "ArrowUpLeft", "ArrowUpLeftFromCircle", "ArrowUpLeftFromCircleIcon", "ArrowUpLeftFromSquare", "ArrowUpLeftFromSquareIcon", "ArrowUpLeftIcon",
  "ArrowUpLeftSquare", "ArrowUpLeftSquareIcon", "ArrowUpNarrowWide", "ArrowUpNarrowWideIcon", "ArrowUpRight", "ArrowUpRightFromCircle", "ArrowUpRightFromCircleIcon", "ArrowUpRightFromSquare", "ArrowUpRightFromSquareIcon", "ArrowUpRightIcon", "ArrowUpRightSquare", "ArrowUpRightSquareIcon",
  "ArrowUpSquare", "ArrowUpSquareIcon", "ArrowUpToLine", "ArrowUpToLineIcon", "ArrowUpWideNarrow", "ArrowUpWideNarrowIcon", "ArrowUpZA", "ArrowUpZAIcon", "ArrowUpZa", "ArrowUpZaIcon", "ArrowsUpFromLine", "ArrowsUpFromLineIcon",
  "Asterisk", "AsteriskIcon", "AsteriskSquare", "AsteriskSquareIcon", "AtSign", "AtSignIcon", "Atom", "AtomIcon", "AudioLines", "AudioLinesIcon", "AudioWaveform", "AudioWaveformIcon",
  "Award", "AwardIcon", "Axe", "AxeIcon", "Axis3D", "Axis3DIcon", "Axis3d", "Axis3dIcon", "Baby", "BabyIcon", "Backpack", "BackpackIcon",
  "Badge", "BadgeAlert", "BadgeAlertIcon", "BadgeCent", "BadgeCentIcon", "BadgeCheck", "BadgeCheckIcon", "BadgeDollarSign", "BadgeDollarSignIcon", "BadgeEuro", "BadgeEuroIcon", "BadgeHelp",
  "BadgeHelpIcon", "BadgeIcon", "BadgeIndianRupee", "BadgeIndianRupeeIcon", "BadgeInfo", "BadgeInfoIcon", "BadgeJapaneseYen", "BadgeJapaneseYenIcon", "BadgeMinus", "BadgeMinusIcon", "BadgePercent", "BadgePercentIcon",
  "BadgePlus", "BadgePlusIcon", "BadgePoundSterling", "BadgePoundSterlingIcon", "BadgeQuestionMark", "BadgeQuestionMarkIcon", "BadgeRussianRuble", "BadgeRussianRubleIcon", "BadgeSwissFranc", "BadgeSwissFrancIcon", "BadgeTurkishLira", "BadgeTurkishLiraIcon",
  "BadgeX", "BadgeXIcon", "BaggageClaim", "BaggageClaimIcon", "Ban", "BanIcon", "Banana", "BananaIcon", "Bandage", "BandageIcon", "Banknote", "BanknoteArrowDown",
  "BanknoteArrowDownIcon", "BanknoteArrowUp", "BanknoteArrowUpIcon", "BanknoteIcon", "BanknoteX", "BanknoteXIcon", "BarChart", "BarChart2", "BarChart2Icon", "BarChart3", "BarChart3Icon", "BarChart4",
  "BarChart4Icon", "BarChartBig", "BarChartBigIcon", "BarChartHorizontal", "BarChartHorizontalBig", "BarChartHorizontalBigIcon", "BarChartHorizontalIcon", "BarChartIcon", "Barcode", "BarcodeIcon", "Barrel", "BarrelIcon",
  "Baseline", "BaselineIcon", "Bath", "BathIcon", "Battery", "BatteryCharging", "BatteryChargingIcon", "BatteryFull", "BatteryFullIcon", "BatteryIcon", "BatteryLow", "BatteryLowIcon",
  "BatteryMedium", "BatteryMediumIcon", "BatteryPlus", "BatteryPlusIcon", "BatteryWarning", "BatteryWarningIcon", "Beaker", "BeakerIcon", "Bean", "BeanIcon", "BeanOff", "BeanOffIcon",
  "Bed", "BedDouble", "BedDoubleIcon", "BedIcon", "BedSingle", "BedSingleIcon", "Beef", "BeefIcon", "Beer", "BeerIcon", "BeerOff", "BeerOffIcon",
  "Bell", "BellDot", "BellDotIcon", "BellElectric", "BellElectricIcon", "BellIcon", "BellMinus", "BellMinusIcon", "BellOff", "BellOffIcon", "BellPlus", "BellPlusIcon",
  "BellRing", "BellRingIcon", "BetweenHorizonalEnd", "BetweenHorizonalEndIcon", "BetweenHorizonalStart", "BetweenHorizonalStartIcon", "BetweenHorizontalEnd", "BetweenHorizontalEndIcon", "BetweenHorizontalStart", "BetweenHorizontalStartIcon", "BetweenVerticalEnd", "BetweenVerticalEndIcon",
  "BetweenVerticalStart", "BetweenVerticalStartIcon", "BicepsFlexed", "BicepsFlexedIcon", "Bike", "BikeIcon", "Binary", "BinaryIcon", "Binoculars", "BinocularsIcon", "Biohazard", "BiohazardIcon",
  "Bird", "BirdIcon", "Bitcoin", "BitcoinIcon", "Blend", "BlendIcon", "Blinds", "BlindsIcon", "Blocks", "BlocksIcon", "Bluetooth", "BluetoothConnected",
  "BluetoothConnectedIcon", "BluetoothIcon", "BluetoothOff", "BluetoothOffIcon", "BluetoothSearching", "BluetoothSearchingIcon", "Bold", "BoldIcon", "Bolt", "BoltIcon", "Bomb", "BombIcon",
  "Bone", "BoneIcon", "Book", "BookA", "BookAIcon", "BookAlert", "BookAlertIcon", "BookAudio", "BookAudioIcon", "BookCheck", "BookCheckIcon", "BookCopy",
  "BookCopyIcon", "BookDashed", "BookDashedIcon", "BookDown", "BookDownIcon", "BookHeadphones", "BookHeadphonesIcon", "BookHeart", "BookHeartIcon", "BookIcon", "BookImage", "BookImageIcon",
  "BookKey", "BookKeyIcon", "BookLock", "BookLockIcon", "BookMarked", "BookMarkedIcon", "BookMinus", "BookMinusIcon", "BookOpen", "BookOpenCheck", "BookOpenCheckIcon", "BookOpenIcon",
  "BookOpenText", "BookOpenTextIcon", "BookPlus", "BookPlusIcon", "BookTemplate", "BookTemplateIcon", "BookText", "BookTextIcon", "BookType", "BookTypeIcon", "BookUp", "BookUp2",
  "BookUp2Icon", "BookUpIcon", "BookUser", "BookUserIcon", "BookX", "BookXIcon", "Bookmark", "BookmarkCheck", "BookmarkCheckIcon", "BookmarkIcon", "BookmarkMinus", "BookmarkMinusIcon",
  "BookmarkPlus", "BookmarkPlusIcon", "BookmarkX", "BookmarkXIcon", "BoomBox", "BoomBoxIcon", "Bot", "BotIcon", "BotMessageSquare", "BotMessageSquareIcon", "BotOff", "BotOffIcon",
  "BottleWine", "BottleWineIcon", "BowArrow", "BowArrowIcon", "Box", "BoxIcon", "BoxSelect", "BoxSelectIcon", "Boxes", "BoxesIcon", "Braces", "BracesIcon",
  "Brackets", "BracketsIcon", "Brain", "BrainCircuit", "BrainCircuitIcon", "BrainCog", "BrainCogIcon", "BrainIcon", "BrickWall", "BrickWallFire", "BrickWallFireIcon", "BrickWallIcon",
  "BrickWallShield", "BrickWallShieldIcon", "Briefcase", "BriefcaseBusiness", "BriefcaseBusinessIcon", "BriefcaseConveyorBelt", "BriefcaseConveyorBeltIcon", "BriefcaseIcon", "BriefcaseMedical", "BriefcaseMedicalIcon", "BringToFront", "BringToFrontIcon",
  "Brush", "BrushCleaning", "BrushCleaningIcon", "BrushIcon", "Bubbles", "BubblesIcon", "Bug", "BugIcon", "BugOff", "BugOffIcon", "BugPlay", "BugPlayIcon",
  "Building", "Building2", "Building2Icon", "BuildingIcon", "Bus", "BusFront", "BusFrontIcon", "BusIcon", "Cable", "CableCar", "CableCarIcon", "CableIcon",
  "Cake", "CakeIcon", "CakeSlice", "CakeSliceIcon", "Calculator", "CalculatorIcon", "Calendar", "Calendar1", "Calendar1Icon", "CalendarArrowDown", "CalendarArrowDownIcon", "CalendarArrowUp",
  "CalendarArrowUpIcon", "CalendarCheck", "CalendarCheck2", "CalendarCheck2Icon", "CalendarCheckIcon", "CalendarClock", "CalendarClockIcon", "CalendarCog", "CalendarCogIcon", "CalendarDays", "CalendarDaysIcon", "CalendarFold",
  "CalendarFoldIcon", "CalendarHeart", "CalendarHeartIcon", "CalendarIcon", "CalendarMinus", "CalendarMinus2", "CalendarMinus2Icon", "CalendarMinusIcon", "CalendarOff", "CalendarOffIcon", "CalendarPlus", "CalendarPlus2",
  "CalendarPlus2Icon", "CalendarPlusIcon", "CalendarRange", "CalendarRangeIcon", "CalendarSearch", "CalendarSearchIcon", "CalendarSync", "CalendarSyncIcon", "CalendarX", "CalendarX2", "CalendarX2Icon", "CalendarXIcon",
  "Camera", "CameraIcon", "CameraOff", "CameraOffIcon", "CandlestickChart", "CandlestickChartIcon", "Candy", "CandyCane", "CandyCaneIcon", "CandyIcon", "CandyOff", "CandyOffIcon",
  "Cannabis", "CannabisIcon", "Captions", "CaptionsIcon", "CaptionsOff", "CaptionsOffIcon", "Car", "CarFront", "CarFrontIcon", "CarIcon", "CarTaxiFront", "CarTaxiFrontIcon",
  "Caravan", "CaravanIcon", "CardSim", "CardSimIcon", "Carrot", "CarrotIcon", "CaseLower", "CaseLowerIcon", "CaseSensitive", "CaseSensitiveIcon", "CaseUpper", "CaseUpperIcon",
  "CassetteTape", "CassetteTapeIcon", "Cast", "CastIcon", "Castle", "CastleIcon", "Cat", "CatIcon", "Cctv", "CctvIcon", "ChartArea", "ChartAreaIcon",
  "ChartBar", "ChartBarBig", "ChartBarBigIcon", "ChartBarDecreasing", "ChartBarDecreasingIcon", "ChartBarIcon", "ChartBarIncreasing", "ChartBarIncreasingIcon", "ChartBarStacked", "ChartBarStackedIcon", "ChartCandlestick", "ChartCandlestickIcon",
  "ChartColumn", "ChartColumnBig", "ChartColumnBigIcon", "ChartColumnDecreasing", "ChartColumnDecreasingIcon", "ChartColumnIcon", "ChartColumnIncreasing", "ChartColumnIncreasingIcon", "ChartColumnStacked", "ChartColumnStackedIcon", "ChartGantt", "ChartGanttIcon",
  "ChartLine", "ChartLineIcon", "ChartNetwork", "ChartNetworkIcon", "ChartNoAxesColumn", "ChartNoAxesColumnDecreasing", "ChartNoAxesColumnDecreasingIcon", "ChartNoAxesColumnIcon", "ChartNoAxesColumnIncreasing", "ChartNoAxesColumnIncreasingIcon", "ChartNoAxesCombined", "ChartNoAxesCombinedIcon",
  "ChartNoAxesGantt", "ChartNoAxesGanttIcon", "ChartPie", "ChartPieIcon", "ChartScatter", "ChartScatterIcon", "ChartSpline", "ChartSplineIcon", "Check", "CheckCheck", "CheckCheckIcon", "CheckCircle",
  "CheckCircle2", "CheckCircle2Icon", "CheckCircleIcon", "CheckIcon", "CheckLine", "CheckLineIcon", "CheckSquare", "CheckSquare2", "CheckSquare2Icon", "CheckSquareIcon", "ChefHat", "ChefHatIcon",
  "Cherry", "CherryIcon", "ChevronDown", "ChevronDownCircle", "ChevronDownCircleIcon", "ChevronDownIcon", "ChevronDownSquare", "ChevronDownSquareIcon", "ChevronFirst", "ChevronFirstIcon", "ChevronLast", "ChevronLastIcon",
  "ChevronLeft", "ChevronLeftCircle", "ChevronLeftCircleIcon", "ChevronLeftIcon", "ChevronLeftSquare", "ChevronLeftSquareIcon", "ChevronRight", "ChevronRightCircle", "ChevronRightCircleIcon", "ChevronRightIcon", "ChevronRightSquare", "ChevronRightSquareIcon",
  "ChevronUp", "ChevronUpCircle", "ChevronUpCircleIcon", "ChevronUpIcon", "ChevronUpSquare", "ChevronUpSquareIcon", "ChevronsDown", "ChevronsDownIcon", "ChevronsDownUp", "ChevronsDownUpIcon", "ChevronsLeft", "ChevronsLeftIcon",
  "ChevronsLeftRight", "ChevronsLeftRightEllipsis", "ChevronsLeftRightEllipsisIcon", "ChevronsLeftRightIcon", "ChevronsRight", "ChevronsRightIcon", "ChevronsRightLeft", "ChevronsRightLeftIcon", "ChevronsUp", "ChevronsUpDown", "ChevronsUpDownIcon", "ChevronsUpIcon",
  "Chrome", "ChromeIcon", "Chromium", "ChromiumIcon", "Church", "ChurchIcon", "Cigarette", "CigaretteIcon", "CigaretteOff", "CigaretteOffIcon", "Circle", "CircleAlert",
  "CircleAlertIcon", "CircleArrowDown", "CircleArrowDownIcon", "CircleArrowLeft", "CircleArrowLeftIcon", "CircleArrowOutDownLeft", "CircleArrowOutDownLeftIcon", "CircleArrowOutDownRight", "CircleArrowOutDownRightIcon", "CircleArrowOutUpLeft", "CircleArrowOutUpLeftIcon", "CircleArrowOutUpRight",
  "CircleArrowOutUpRightIcon", "CircleArrowRight", "CircleArrowRightIcon", "CircleArrowUp", "CircleArrowUpIcon", "CircleCheck", "CircleCheckBig", "CircleCheckBigIcon", "CircleCheckIcon", "CircleChevronDown", "CircleChevronDownIcon", "CircleChevronLeft",
  "CircleChevronLeftIcon", "CircleChevronRight", "CircleChevronRightIcon", "CircleChevronUp", "CircleChevronUpIcon", "CircleDashed", "CircleDashedIcon", "CircleDivide", "CircleDivideIcon", "CircleDollarSign", "CircleDollarSignIcon", "CircleDot",
  "CircleDotDashed", "CircleDotDashedIcon", "CircleDotIcon", "CircleEllipsis", "CircleEllipsisIcon", "CircleEqual", "CircleEqualIcon", "CircleFadingArrowUp", "CircleFadingArrowUpIcon", "CircleFadingPlus", "CircleFadingPlusIcon", "CircleGauge",
  "CircleGaugeIcon", "CircleHelp", "CircleHelpIcon", "CircleIcon", "CircleMinus", "CircleMinusIcon", "CircleOff", "CircleOffIcon", "CircleParking", "CircleParkingIcon", "CircleParkingOff", "CircleParkingOffIcon",
  "CirclePause", "CirclePauseIcon", "CirclePercent", "CirclePercentIcon", "CirclePlay", "CirclePlayIcon", "CirclePlus", "CirclePlusIcon", "CirclePoundSterling", "CirclePoundSterlingIcon", "CirclePower", "CirclePowerIcon",
  "CircleQuestionMark", "CircleQuestionMarkIcon", "CircleSlash", "CircleSlash2", "CircleSlash2Icon", "CircleSlashIcon", "CircleSlashed", "CircleSlashedIcon", "CircleSmall", "CircleSmallIcon", "CircleStar", "CircleStarIcon",
  "CircleStop", "CircleStopIcon", "CircleUser", "CircleUserIcon", "CircleUserRound", "CircleUserRoundIcon", "CircleX", "CircleXIcon", "CircuitBoard", "CircuitBoardIcon", "Citrus", "CitrusIcon",
  "Clapperboard", "ClapperboardIcon", "Clipboard", "ClipboardCheck", "ClipboardCheckIcon", "ClipboardClock", "ClipboardClockIcon", "ClipboardCopy", "ClipboardCopyIcon", "ClipboardEdit", "ClipboardEditIcon", "ClipboardIcon",
  "ClipboardList", "ClipboardListIcon", "ClipboardMinus", "ClipboardMinusIcon", "ClipboardPaste", "ClipboardPasteIcon", "ClipboardPen", "ClipboardPenIcon", "ClipboardPenLine", "ClipboardPenLineIcon", "ClipboardPlus", "ClipboardPlusIcon",
  "ClipboardSignature", "ClipboardSignatureIcon", "ClipboardType", "ClipboardTypeIcon", "ClipboardX", "ClipboardXIcon", "Clock", "Clock1", "Clock10", "Clock10Icon", "Clock11", "Clock11Icon",
  "Clock12", "Clock12Icon", "Clock1Icon", "Clock2", "Clock2Icon", "Clock3", "Clock3Icon", "Clock4", "Clock4Icon", "Clock5", "Clock5Icon", "Clock6",
  "Clock6Icon", "Clock7", "Clock7Icon", "Clock8", "Clock8Icon", "Clock9", "Clock9Icon", "ClockAlert", "ClockAlertIcon", "ClockArrowDown", "ClockArrowDownIcon", "ClockArrowUp",
  "ClockArrowUpIcon", "ClockFading", "ClockFadingIcon", "ClockIcon", "ClockPlus", "ClockPlusIcon", "ClosedCaption", "ClosedCaptionIcon", "Cloud", "CloudAlert", "CloudAlertIcon", "CloudCheck",
  "CloudCheckIcon", "CloudCog", "CloudCogIcon", "CloudDownload", "CloudDownloadIcon", "CloudDrizzle", "CloudDrizzleIcon", "CloudFog", "CloudFogIcon", "CloudHail", "CloudHailIcon", "CloudIcon",
  "CloudLightning", "CloudLightningIcon", "CloudMoon", "CloudMoonIcon", "CloudMoonRain", "CloudMoonRainIcon", "CloudOff", "CloudOffIcon", "CloudRain", "CloudRainIcon", "CloudRainWind", "CloudRainWindIcon",
  "CloudSnow", "CloudSnowIcon", "CloudSun", "CloudSunIcon", "CloudSunRain", "CloudSunRainIcon", "CloudUpload", "CloudUploadIcon", "Cloudy", "CloudyIcon", "Clover", "CloverIcon",
  "Club", "ClubIcon", "Code", "Code2", "Code2Icon", "CodeIcon", "CodeSquare", "CodeSquareIcon", "CodeXml", "CodeXmlIcon", "Codepen", "CodepenIcon",
  "Codesandbox", "CodesandboxIcon", "Coffee", "CoffeeIcon", "Cog", "CogIcon", "Coins", "CoinsIcon", "Columns", "Columns2", "Columns2Icon", "Columns3",
  "Columns3Cog", "Columns3CogIcon", "Columns3Icon", "Columns4", "Columns4Icon", "ColumnsIcon", "ColumnsSettings", "ColumnsSettingsIcon", "Combine", "CombineIcon", "Command", "CommandIcon",
  "Compass", "CompassIcon", "Component", "ComponentIcon", "Computer", "ComputerIcon", "ConciergeBell", "ConciergeBellIcon", "Cone", "ConeIcon", "Construction", "ConstructionIcon",
  "Contact", "Contact2", "Contact2Icon", "ContactIcon", "ContactRound", "ContactRoundIcon", "Container", "ContainerIcon", "Contrast", "ContrastIcon", "Cookie", "CookieIcon",
  "CookingPot", "CookingPotIcon", "Copy", "CopyCheck", "CopyCheckIcon", "CopyIcon", "CopyMinus", "CopyMinusIcon", "CopyPlus", "CopyPlusIcon", "CopySlash", "CopySlashIcon",
  "CopyX", "CopyXIcon", "Copyleft", "CopyleftIcon", "Copyright", "CopyrightIcon", "CornerDownLeft", "CornerDownLeftIcon", "CornerDownRight", "CornerDownRightIcon", "CornerLeftDown", "CornerLeftDownIcon",
  "CornerLeftUp", "CornerLeftUpIcon", "CornerRightDown", "CornerRightDownIcon", "CornerRightUp", "CornerRightUpIcon", "CornerUpLeft", "CornerUpLeftIcon", "CornerUpRight", "CornerUpRightIcon", "Cpu", "CpuIcon",
  "CreativeCommons", "CreativeCommonsIcon", "CreditCard", "CreditCardIcon", "Croissant", "CroissantIcon", "Crop", "CropIcon", "Cross", "CrossIcon", "Crosshair", "CrosshairIcon",
  "Crown", "CrownIcon", "Cuboid", "CuboidIcon", "CupSoda", "CupSodaIcon", "CurlyBraces", "CurlyBracesIcon", "Currency", "CurrencyIcon", "Cylinder", "CylinderIcon",
  "Dam", "DamIcon", "Database", "DatabaseBackup", "DatabaseBackupIcon", "DatabaseIcon", "DatabaseZap", "DatabaseZapIcon", "DecimalsArrowLeft", "DecimalsArrowLeftIcon", "DecimalsArrowRight", "DecimalsArrowRightIcon",
  "Delete", "DeleteIcon", "Dessert", "DessertIcon", "Diameter", "DiameterIcon", "Diamond", "DiamondIcon", "DiamondMinus", "DiamondMinusIcon", "DiamondPercent", "DiamondPercentIcon",
  "DiamondPlus", "DiamondPlusIcon", "Dice1", "Dice1Icon", "Dice2", "Dice2Icon", "Dice3", "Dice3Icon", "Dice4", "Dice4Icon", "Dice5", "Dice5Icon",
  "Dice6", "Dice6Icon", "Dices", "DicesIcon", "Diff", "DiffIcon", "Disc", "Disc2", "Disc2Icon", "Disc3", "Disc3Icon", "DiscAlbum",
  "DiscAlbumIcon", "DiscIcon", "Divide", "DivideCircle", "DivideCircleIcon", "DivideIcon", "DivideSquare", "DivideSquareIcon", "Dna", "DnaIcon", "DnaOff", "DnaOffIcon",
  "Dock", "DockIcon", "Dog", "DogIcon", "DollarSign", "DollarSignIcon", "Donut", "DonutIcon", "DoorClosed", "DoorClosedIcon", "DoorClosedLocked", "DoorClosedLockedIcon",
  "DoorOpen", "DoorOpenIcon", "Dot", "DotIcon", "DotSquare", "DotSquareIcon", "Download", "DownloadCloud", "DownloadCloudIcon", "DownloadIcon", "DraftingCompass", "DraftingCompassIcon",
  "Drama", "DramaIcon", "Dribbble", "DribbbleIcon", "Drill", "DrillIcon", "Drone", "DroneIcon", "Droplet", "DropletIcon", "DropletOff", "DropletOffIcon",
  "Droplets", "DropletsIcon", "Drum", "DrumIcon", "Drumstick", "DrumstickIcon", "Dumbbell", "DumbbellIcon", "Ear", "EarIcon", "EarOff", "EarOffIcon",
  "Earth", "EarthIcon", "EarthLock", "EarthLockIcon", "Eclipse", "EclipseIcon", "Edit", "Edit2", "Edit2Icon", "Edit3", "Edit3Icon", "EditIcon",
  "Egg", "EggFried", "EggFriedIcon", "EggIcon", "EggOff", "EggOffIcon", "Ellipsis", "EllipsisIcon", "EllipsisVertical", "EllipsisVerticalIcon", "Equal", "EqualApproximately",
  "EqualApproximatelyIcon", "EqualIcon", "EqualNot", "EqualNotIcon", "EqualSquare", "EqualSquareIcon", "Eraser", "EraserIcon", "EthernetPort", "EthernetPortIcon", "Euro", "EuroIcon",
  "EvCharger", "EvChargerIcon", "Expand", "ExpandIcon", "ExternalLink", "ExternalLinkIcon", "Eye", "EyeClosed", "EyeClosedIcon", "EyeIcon", "EyeOff", "EyeOffIcon",
  "Facebook", "FacebookIcon", "Factory", "FactoryIcon", "Fan", "FanIcon", "FastForward", "FastForwardIcon", "Feather", "FeatherIcon", "Fence", "FenceIcon",
  "FerrisWheel", "FerrisWheelIcon", "Figma", "FigmaIcon", "File", "FileArchive", "FileArchiveIcon", "FileAudio", "FileAudio2", "FileAudio2Icon", "FileAudioIcon", "FileAxis3D",
  "FileAxis3DIcon", "FileAxis3d", "FileAxis3dIcon", "FileBadge", "FileBadge2", "FileBadge2Icon", "FileBadgeIcon", "FileBarChart", "FileBarChart2", "FileBarChart2Icon", "FileBarChartIcon", "FileBox",
  "FileBoxIcon", "FileChartColumn", "FileChartColumnIcon", "FileChartColumnIncreasing", "FileChartColumnIncreasingIcon", "FileChartLine", "FileChartLineIcon", "FileChartPie", "FileChartPieIcon", "FileCheck", "FileCheck2", "FileCheck2Icon",
  "FileCheckIcon", "FileClock", "FileClockIcon", "FileCode", "FileCode2", "FileCode2Icon", "FileCodeIcon", "FileCog", "FileCog2", "FileCog2Icon", "FileCogIcon", "FileDiff",
  "FileDiffIcon", "FileDigit", "FileDigitIcon", "FileDown", "FileDownIcon", "FileEdit", "FileEditIcon", "FileHeart", "FileHeartIcon", "FileIcon", "FileImage", "FileImageIcon",
  "FileInput", "FileInputIcon", "FileJson", "FileJson2", "FileJson2Icon", "FileJsonIcon", "FileKey", "FileKey2", "FileKey2Icon", "FileKeyIcon", "FileLineChart", "FileLineChartIcon",
  "FileLock", "FileLock2", "FileLock2Icon", "FileLockIcon", "FileMinus", "FileMinus2", "FileMinus2Icon", "FileMinusIcon", "FileMusic", "FileMusicIcon", "FileOutput", "FileOutputIcon",
  "FilePen", "FilePenIcon", "FilePenLine", "FilePenLineIcon", "FilePieChart", "FilePieChartIcon", "FilePlay", "FilePlayIcon", "FilePlus", "FilePlus2", "FilePlus2Icon", "FilePlusIcon",
  "FileQuestion", "FileQuestionIcon", "FileQuestionMark", "FileQuestionMarkIcon", "FileScan", "FileScanIcon", "FileSearch", "FileSearch2", "FileSearch2Icon", "FileSearchIcon", "FileSignature", "FileSignatureIcon",
  "FileSliders", "FileSlidersIcon", "FileSpreadsheet", "FileSpreadsheetIcon", "FileStack", "FileStackIcon", "FileSymlink", "FileSymlinkIcon", "FileTerminal", "FileTerminalIcon", "FileText", "FileTextIcon",
  "FileType", "FileType2", "FileType2Icon", "FileTypeIcon", "FileUp", "FileUpIcon", "FileUser", "FileUserIcon", "FileVideo", "FileVideo2", "FileVideo2Icon", "FileVideoCamera",
  "FileVideoCameraIcon", "FileVideoIcon", "FileVolume", "FileVolume2", "FileVolume2Icon", "FileVolumeIcon", "FileWarning", "FileWarningIcon", "FileX", "FileX2", "FileX2Icon", "FileXIcon",
  "Files", "FilesIcon", "Film", "FilmIcon", "Filter", "FilterIcon", "FilterX", "FilterXIcon", "Fingerprint", "FingerprintIcon", "FireExtinguisher", "FireExtinguisherIcon",
  "Fish", "FishIcon", "FishOff", "FishOffIcon", "FishSymbol", "FishSymbolIcon", "Flag", "FlagIcon", "FlagOff", "FlagOffIcon", "FlagTriangleLeft", "FlagTriangleLeftIcon",
  "FlagTriangleRight", "FlagTriangleRightIcon", "Flame", "FlameIcon", "FlameKindling", "FlameKindlingIcon", "Flashlight", "FlashlightIcon", "FlashlightOff", "FlashlightOffIcon", "FlaskConical", "FlaskConicalIcon",
  "FlaskConicalOff", "FlaskConicalOffIcon", "FlaskRound", "FlaskRoundIcon", "FlipHorizontal", "FlipHorizontal2", "FlipHorizontal2Icon", "FlipHorizontalIcon", "FlipVertical", "FlipVertical2", "FlipVertical2Icon", "FlipVerticalIcon",
  "Flower", "Flower2", "Flower2Icon", "FlowerIcon", "Focus", "FocusIcon", "FoldHorizontal", "FoldHorizontalIcon", "FoldVertical", "FoldVerticalIcon", "Folder", "FolderArchive",
  "FolderArchiveIcon", "FolderCheck", "FolderCheckIcon", "FolderClock", "FolderClockIcon", "FolderClosed", "FolderClosedIcon", "FolderCode", "FolderCodeIcon", "FolderCog", "FolderCog2", "FolderCog2Icon",
  "FolderCogIcon", "FolderDot", "FolderDotIcon", "FolderDown", "FolderDownIcon", "FolderEdit", "FolderEditIcon", "FolderGit", "FolderGit2", "FolderGit2Icon", "FolderGitIcon", "FolderHeart",
  "FolderHeartIcon", "FolderIcon", "FolderInput", "FolderInputIcon", "FolderKanban", "FolderKanbanIcon", "FolderKey", "FolderKeyIcon", "FolderLock", "FolderLockIcon", "FolderMinus", "FolderMinusIcon",
  "FolderOpen", "FolderOpenDot", "FolderOpenDotIcon", "FolderOpenIcon", "FolderOutput", "FolderOutputIcon", "FolderPen", "FolderPenIcon", "FolderPlus", "FolderPlusIcon", "FolderRoot", "FolderRootIcon",
  "FolderSearch", "FolderSearch2", "FolderSearch2Icon", "FolderSearchIcon", "FolderSymlink", "FolderSymlinkIcon", "FolderSync", "FolderSyncIcon", "FolderTree", "FolderTreeIcon", "FolderUp", "FolderUpIcon",
  "FolderX", "FolderXIcon", "Folders", "FoldersIcon", "Footprints", "FootprintsIcon", "ForkKnife", "ForkKnifeCrossed", "ForkKnifeCrossedIcon", "ForkKnifeIcon", "Forklift", "ForkliftIcon",
  "FormInput", "FormInputIcon", "Forward", "ForwardIcon", "Frame", "FrameIcon", "Framer", "FramerIcon", "Frown", "FrownIcon", "Fuel", "FuelIcon",
  "Fullscreen", "FullscreenIcon", "FunctionSquare", "FunctionSquareIcon", "Funnel", "FunnelIcon", "FunnelPlus", "FunnelPlusIcon", "FunnelX", "FunnelXIcon", "GalleryHorizontal", "GalleryHorizontalEnd",
  "GalleryHorizontalEndIcon", "GalleryHorizontalIcon", "GalleryThumbnails", "GalleryThumbnailsIcon", "GalleryVertical", "GalleryVerticalEnd", "GalleryVerticalEndIcon", "GalleryVerticalIcon", "Gamepad", "Gamepad2", "Gamepad2Icon", "GamepadIcon",
  "GanttChart", "GanttChartIcon", "GanttChartSquare", "GanttChartSquareIcon", "Gauge", "GaugeCircle", "GaugeCircleIcon", "GaugeIcon", "Gavel", "GavelIcon", "Gem", "GemIcon",
  "GeorgianLari", "GeorgianLariIcon", "Ghost", "GhostIcon", "Gift", "GiftIcon", "GitBranch", "GitBranchIcon", "GitBranchPlus", "GitBranchPlusIcon", "GitCommit", "GitCommitHorizontal",
  "GitCommitHorizontalIcon", "GitCommitIcon", "GitCommitVertical", "GitCommitVerticalIcon", "GitCompare", "GitCompareArrows", "GitCompareArrowsIcon", "GitCompareIcon", "GitFork", "GitForkIcon", "GitGraph", "GitGraphIcon",
  "GitMerge", "GitMergeIcon", "GitPullRequest", "GitPullRequestArrow", "GitPullRequestArrowIcon", "GitPullRequestClosed", "GitPullRequestClosedIcon", "GitPullRequestCreate", "GitPullRequestCreateArrow", "GitPullRequestCreateArrowIcon", "GitPullRequestCreateIcon", "GitPullRequestDraft",
  "GitPullRequestDraftIcon", "GitPullRequestIcon", "Github", "GithubIcon", "Gitlab", "GitlabIcon", "GlassWater", "GlassWaterIcon", "Glasses", "GlassesIcon", "Globe", "Globe2",
  "Globe2Icon", "GlobeIcon", "GlobeLock", "GlobeLockIcon", "Goal", "GoalIcon", "Gpu", "GpuIcon", "Grab", "GrabIcon", "GraduationCap", "GraduationCapIcon",
  "Grape", "GrapeIcon", "Grid", "Grid2X2", "Grid2X2Check", "Grid2X2CheckIcon", "Grid2X2Icon", "Grid2X2Plus", "Grid2X2PlusIcon", "Grid2X2X", "Grid2X2XIcon", "Grid2x2",
  "Grid2x2Check", "Grid2x2CheckIcon", "Grid2x2Icon", "Grid2x2Plus", "Grid2x2PlusIcon", "Grid2x2X", "Grid2x2XIcon", "Grid3X3", "Grid3X3Icon", "Grid3x2", "Grid3x2Icon", "Grid3x3",
  "Grid3x3Icon", "GridIcon", "Grip", "GripHorizontal", "GripHorizontalIcon", "GripIcon", "GripVertical", "GripVerticalIcon", "Group", "GroupIcon", "Guitar", "GuitarIcon",
  "Ham", "HamIcon", "Hamburger", "HamburgerIcon", "Hammer", "HammerIcon", "Hand", "HandCoins", "HandCoinsIcon", "HandFist", "HandFistIcon", "HandGrab",
  "HandGrabIcon", "HandHeart", "HandHeartIcon", "HandHelping", "HandHelpingIcon", "HandIcon", "HandMetal", "HandMetalIcon", "HandPlatter", "HandPlatterIcon", "Handbag", "HandbagIcon",
  "Handshake", "HandshakeIcon", "HardDrive", "HardDriveDownload", "HardDriveDownloadIcon", "HardDriveIcon", "HardDriveUpload", "HardDriveUploadIcon", "HardHat", "HardHatIcon", "Hash", "HashIcon",
  "HatGlasses", "HatGlassesIcon", "Haze", "HazeIcon", "HdmiPort", "HdmiPortIcon", "Heading", "Heading1", "Heading1Icon", "Heading2", "Heading2Icon", "Heading3",
  "Heading3Icon", "Heading4", "Heading4Icon", "Heading5", "Heading5Icon", "Heading6", "Heading6Icon", "HeadingIcon", "HeadphoneOff", "HeadphoneOffIcon", "Headphones", "HeadphonesIcon",
  "Headset", "HeadsetIcon", "Heart", "HeartCrack", "HeartCrackIcon", "HeartHandshake", "HeartHandshakeIcon", "HeartIcon", "HeartMinus", "HeartMinusIcon", "HeartOff", "HeartOffIcon",
  "HeartPlus", "HeartPlusIcon", "HeartPulse", "HeartPulseIcon", "Heater", "HeaterIcon", "HelpCircle", "HelpCircleIcon", "HelpingHand", "HelpingHandIcon", "Hexagon", "HexagonIcon",
  "Highlighter", "HighlighterIcon", "History", "HistoryIcon", "Home", "HomeIcon", "Hop", "HopIcon", "HopOff", "HopOffIcon", "Hospital", "HospitalIcon",
  "Hotel", "HotelIcon", "Hourglass", "HourglassIcon", "House", "HouseHeart", "HouseHeartIcon", "HouseIcon", "HousePlug", "HousePlugIcon", "HousePlus", "HousePlusIcon",
  "HouseWifi", "HouseWifiIcon", "IceCream", "IceCream2", "IceCream2Icon", "IceCreamBowl", "IceCreamBowlIcon", "IceCreamCone", "IceCreamConeIcon", "IceCreamIcon", "Icon", "IdCard",
  "IdCardIcon", "IdCardLanyard", "IdCardLanyardIcon", "Image", "ImageDown", "ImageDownIcon", "ImageIcon", "ImageMinus", "ImageMinusIcon", "ImageOff", "ImageOffIcon", "ImagePlay",
  "ImagePlayIcon", "ImagePlus", "ImagePlusIcon", "ImageUp", "ImageUpIcon", "ImageUpscale", "ImageUpscaleIcon", "Images", "ImagesIcon", "Import", "ImportIcon", "Inbox",
  "InboxIcon", "Indent", "IndentDecrease", "IndentDecreaseIcon", "IndentIcon", "IndentIncrease", "IndentIncreaseIcon", "IndianRupee", "IndianRupeeIcon", "Infinity", "InfinityIcon", "Info",
  "InfoIcon", "Inspect", "InspectIcon", "InspectionPanel", "InspectionPanelIcon", "Instagram", "InstagramIcon", "Italic", "ItalicIcon", "IterationCcw", "IterationCcwIcon", "IterationCw",
  "IterationCwIcon", "JapaneseYen", "JapaneseYenIcon", "Joystick", "JoystickIcon", "Kanban", "KanbanIcon", "KanbanSquare", "KanbanSquareDashed", "KanbanSquareDashedIcon", "KanbanSquareIcon", "Kayak",
  "KayakIcon", "Key", "KeyIcon", "KeyRound", "KeyRoundIcon", "KeySquare", "KeySquareIcon", "Keyboard", "KeyboardIcon", "KeyboardMusic", "KeyboardMusicIcon", "KeyboardOff",
  "KeyboardOffIcon", "Lamp", "LampCeiling", "LampCeilingIcon", "LampDesk", "LampDeskIcon", "LampFloor", "LampFloorIcon", "LampIcon", "LampWallDown", "LampWallDownIcon", "LampWallUp",
  "LampWallUpIcon", "LandPlot", "LandPlotIcon", "Landmark", "LandmarkIcon", "Languages", "LanguagesIcon", "Laptop", "Laptop2", "Laptop2Icon", "LaptopIcon", "LaptopMinimal",
  "LaptopMinimalCheck", "LaptopMinimalCheckIcon", "LaptopMinimalIcon", "Lasso", "LassoIcon", "LassoSelect", "LassoSelectIcon", "Laugh", "LaughIcon", "Layers", "Layers2", "Layers2Icon",
  "Layers3", "Layers3Icon", "LayersIcon", "Layout", "LayoutDashboard", "LayoutDashboardIcon", "LayoutGrid", "LayoutGridIcon", "LayoutIcon", "LayoutList", "LayoutListIcon", "LayoutPanelLeft",
  "LayoutPanelLeftIcon", "LayoutPanelTop", "LayoutPanelTopIcon", "LayoutTemplate", "LayoutTemplateIcon", "Leaf", "LeafIcon", "LeafyGreen", "LeafyGreenIcon", "Lectern", "LecternIcon", "LetterText",
  "LetterTextIcon", "Library", "LibraryBig", "LibraryBigIcon", "LibraryIcon", "LibrarySquare", "LibrarySquareIcon", "LifeBuoy", "LifeBuoyIcon", "Ligature", "LigatureIcon", "Lightbulb",
  "LightbulbIcon", "LightbulbOff", "LightbulbOffIcon", "LineChart", "LineChartIcon", "LineSquiggle", "LineSquiggleIcon", "Link", "Link2", "Link2Icon", "Link2Off", "Link2OffIcon",
  "LinkIcon", "Linkedin", "LinkedinIcon", "List", "ListCheck", "ListCheckIcon", "ListChecks", "ListChecksIcon", "ListChevronsDownUp", "ListChevronsDownUpIcon", "ListChevronsUpDown", "ListChevronsUpDownIcon",
  "ListCollapse", "ListCollapseIcon", "ListEnd", "ListEndIcon", "ListFilter", "ListFilterIcon", "ListFilterPlus", "ListFilterPlusIcon", "ListIcon", "ListIndentDecrease", "ListIndentDecreaseIcon", "ListIndentIncrease",
  "ListIndentIncreaseIcon", "ListMinus", "ListMinusIcon", "ListMusic", "ListMusicIcon", "ListOrdered", "ListOrderedIcon", "ListPlus", "ListPlusIcon", "ListRestart", "ListRestartIcon", "ListStart",
  "ListStartIcon", "ListTodo", "ListTodoIcon", "ListTree", "ListTreeIcon", "ListVideo", "ListVideoIcon", "ListX", "ListXIcon", "Loader", "Loader2", "Loader2Icon",
  "LoaderCircle", "LoaderCircleIcon", "LoaderIcon", "LoaderPinwheel", "LoaderPinwheelIcon", "Locate", "LocateFixed", "LocateFixedIcon", "LocateIcon", "LocateOff", "LocateOffIcon", "LocationEdit",
  "LocationEditIcon", "Lock", "LockIcon", "LockKeyhole", "LockKeyholeIcon", "LockKeyholeOpen", "LockKeyholeOpenIcon", "LockOpen", "LockOpenIcon", "LogIn", "LogInIcon", "LogOut",
  "LogOutIcon", "Logs", "LogsIcon", "Lollipop", "LollipopIcon", "LucideAArrowDown", "LucideAArrowUp", "LucideALargeSmall", "LucideAccessibility", "LucideActivity", "LucideActivitySquare", "LucideAirVent",
  "LucideAirplay", "LucideAlarmCheck", "LucideAlarmClock", "LucideAlarmClockCheck", "LucideAlarmClockMinus", "LucideAlarmClockOff", "LucideAlarmClockPlus", "LucideAlarmMinus", "LucideAlarmPlus", "LucideAlarmSmoke", "LucideAlbum", "LucideAlertCircle",
  "LucideAlertOctagon", "LucideAlertTriangle", "LucideAlignCenter", "LucideAlignCenterHorizontal", "LucideAlignCenterVertical", "LucideAlignEndHorizontal", "LucideAlignEndVertical", "LucideAlignHorizontalDistributeCenter", "LucideAlignHorizontalDistributeEnd", "LucideAlignHorizontalDistributeStart", "LucideAlignHorizontalJustifyCenter", "LucideAlignHorizontalJustifyEnd",
  "LucideAlignHorizontalJustifyStart", "LucideAlignHorizontalSpaceAround", "LucideAlignHorizontalSpaceBetween", "LucideAlignJustify", "LucideAlignLeft", "LucideAlignRight", "LucideAlignStartHorizontal", "LucideAlignStartVertical", "LucideAlignVerticalDistributeCenter", "LucideAlignVerticalDistributeEnd", "LucideAlignVerticalDistributeStart", "LucideAlignVerticalJustifyCenter",
  "LucideAlignVerticalJustifyEnd", "LucideAlignVerticalJustifyStart", "LucideAlignVerticalSpaceAround", "LucideAlignVerticalSpaceBetween", "LucideAmbulance", "LucideAmpersand", "LucideAmpersands", "LucideAmphora", "LucideAnchor", "LucideAngry", "LucideAnnoyed", "LucideAntenna",
  "LucideAnvil", "LucideAperture", "LucideAppWindow", "LucideAppWindowMac", "LucideApple", "LucideArchive", "LucideArchiveRestore", "LucideArchiveX", "LucideAreaChart", "LucideArmchair", "LucideArrowBigDown", "LucideArrowBigDownDash",
  "LucideArrowBigLeft", "LucideArrowBigLeftDash", "LucideArrowBigRight", "LucideArrowBigRightDash", "LucideArrowBigUp", "LucideArrowBigUpDash", "LucideArrowDown", "LucideArrowDown01", "LucideArrowDown10", "LucideArrowDownAZ", "LucideArrowDownAz", "LucideArrowDownCircle",
  "LucideArrowDownFromLine", "LucideArrowDownLeft", "LucideArrowDownLeftFromCircle", "LucideArrowDownLeftFromSquare", "LucideArrowDownLeftSquare", "LucideArrowDownNarrowWide", "LucideArrowDownRight", "LucideArrowDownRightFromCircle", "LucideArrowDownRightFromSquare", "LucideArrowDownRightSquare", "LucideArrowDownSquare", "LucideArrowDownToDot",
  "LucideArrowDownToLine", "LucideArrowDownUp", "LucideArrowDownWideNarrow", "LucideArrowDownZA", "LucideArrowDownZa", "LucideArrowLeft", "LucideArrowLeftCircle", "LucideArrowLeftFromLine", "LucideArrowLeftRight", "LucideArrowLeftSquare", "LucideArrowLeftToLine", "LucideArrowRight",
  "LucideArrowRightCircle", "LucideArrowRightFromLine", "LucideArrowRightLeft", "LucideArrowRightSquare", "LucideArrowRightToLine", "LucideArrowUp", "LucideArrowUp01", "LucideArrowUp10", "LucideArrowUpAZ", "LucideArrowUpAz", "LucideArrowUpCircle", "LucideArrowUpDown",
  "LucideArrowUpFromDot", "LucideArrowUpFromLine", "LucideArrowUpLeft", "LucideArrowUpLeftFromCircle", "LucideArrowUpLeftFromSquare", "LucideArrowUpLeftSquare", "LucideArrowUpNarrowWide", "LucideArrowUpRight", "LucideArrowUpRightFromCircle", "LucideArrowUpRightFromSquare", "LucideArrowUpRightSquare", "LucideArrowUpSquare",
  "LucideArrowUpToLine", "LucideArrowUpWideNarrow", "LucideArrowUpZA", "LucideArrowUpZa", "LucideArrowsUpFromLine", "LucideAsterisk", "LucideAsteriskSquare", "LucideAtSign", "LucideAtom", "LucideAudioLines", "LucideAudioWaveform", "LucideAward",
  "LucideAxe", "LucideAxis3D", "LucideAxis3d", "LucideBaby", "LucideBackpack", "LucideBadge", "LucideBadgeAlert", "LucideBadgeCent", "LucideBadgeCheck", "LucideBadgeDollarSign", "LucideBadgeEuro", "LucideBadgeHelp",
  "LucideBadgeIndianRupee", "LucideBadgeInfo", "LucideBadgeJapaneseYen", "LucideBadgeMinus", "LucideBadgePercent", "LucideBadgePlus", "LucideBadgePoundSterling", "LucideBadgeQuestionMark", "LucideBadgeRussianRuble", "LucideBadgeSwissFranc", "LucideBadgeTurkishLira", "LucideBadgeX",
  "LucideBaggageClaim", "LucideBan", "LucideBanana", "LucideBandage", "LucideBanknote", "LucideBanknoteArrowDown", "LucideBanknoteArrowUp", "LucideBanknoteX", "LucideBarChart", "LucideBarChart2", "LucideBarChart3", "LucideBarChart4",
  "LucideBarChartBig", "LucideBarChartHorizontal", "LucideBarChartHorizontalBig", "LucideBarcode", "LucideBarrel", "LucideBaseline", "LucideBath", "LucideBattery", "LucideBatteryCharging", "LucideBatteryFull", "LucideBatteryLow", "LucideBatteryMedium",
  "LucideBatteryPlus", "LucideBatteryWarning", "LucideBeaker", "LucideBean", "LucideBeanOff", "LucideBed", "LucideBedDouble", "LucideBedSingle", "LucideBeef", "LucideBeer", "LucideBeerOff", "LucideBell",
  "LucideBellDot", "LucideBellElectric", "LucideBellMinus", "LucideBellOff", "LucideBellPlus", "LucideBellRing", "LucideBetweenHorizonalEnd", "LucideBetweenHorizonalStart", "LucideBetweenHorizontalEnd", "LucideBetweenHorizontalStart", "LucideBetweenVerticalEnd", "LucideBetweenVerticalStart",
  "LucideBicepsFlexed", "LucideBike", "LucideBinary", "LucideBinoculars", "LucideBiohazard", "LucideBird", "LucideBitcoin", "LucideBlend", "LucideBlinds", "LucideBlocks", "LucideBluetooth", "LucideBluetoothConnected",
  "LucideBluetoothOff", "LucideBluetoothSearching", "LucideBold", "LucideBolt", "LucideBomb", "LucideBone", "LucideBook", "LucideBookA", "LucideBookAlert", "LucideBookAudio", "LucideBookCheck", "LucideBookCopy",
  "LucideBookDashed", "LucideBookDown", "LucideBookHeadphones", "LucideBookHeart", "LucideBookImage", "LucideBookKey", "LucideBookLock", "LucideBookMarked", "LucideBookMinus", "LucideBookOpen", "LucideBookOpenCheck", "LucideBookOpenText",
  "LucideBookPlus", "LucideBookTemplate", "LucideBookText", "LucideBookType", "LucideBookUp", "LucideBookUp2", "LucideBookUser", "LucideBookX", "LucideBookmark", "LucideBookmarkCheck", "LucideBookmarkMinus", "LucideBookmarkPlus",
  "LucideBookmarkX", "LucideBoomBox", "LucideBot", "LucideBotMessageSquare", "LucideBotOff", "LucideBottleWine", "LucideBowArrow", "LucideBox", "LucideBoxSelect", "LucideBoxes", "LucideBraces", "LucideBrackets",
  "LucideBrain", "LucideBrainCircuit", "LucideBrainCog", "LucideBrickWall", "LucideBrickWallFire", "LucideBrickWallShield", "LucideBriefcase", "LucideBriefcaseBusiness", "LucideBriefcaseConveyorBelt", "LucideBriefcaseMedical", "LucideBringToFront", "LucideBrush",
  "LucideBrushCleaning", "LucideBubbles", "LucideBug", "LucideBugOff", "LucideBugPlay", "LucideBuilding", "LucideBuilding2", "LucideBus", "LucideBusFront", "LucideCable", "LucideCableCar", "LucideCake",
  "LucideCakeSlice", "LucideCalculator", "LucideCalendar", "LucideCalendar1", "LucideCalendarArrowDown", "LucideCalendarArrowUp", "LucideCalendarCheck", "LucideCalendarCheck2", "LucideCalendarClock", "LucideCalendarCog", "LucideCalendarDays", "LucideCalendarFold",
  "LucideCalendarHeart", "LucideCalendarMinus", "LucideCalendarMinus2", "LucideCalendarOff", "LucideCalendarPlus", "LucideCalendarPlus2", "LucideCalendarRange", "LucideCalendarSearch", "LucideCalendarSync", "LucideCalendarX", "LucideCalendarX2", "LucideCamera",
  "LucideCameraOff", "LucideCandlestickChart", "LucideCandy", "LucideCandyCane", "LucideCandyOff", "LucideCannabis", "LucideCaptions", "LucideCaptionsOff", "LucideCar", "LucideCarFront", "LucideCarTaxiFront", "LucideCaravan",
  "LucideCardSim", "LucideCarrot", "LucideCaseLower", "LucideCaseSensitive", "LucideCaseUpper", "LucideCassetteTape", "LucideCast", "LucideCastle", "LucideCat", "LucideCctv", "LucideChartArea", "LucideChartBar",
  "LucideChartBarBig", "LucideChartBarDecreasing", "LucideChartBarIncreasing", "LucideChartBarStacked", "LucideChartCandlestick", "LucideChartColumn", "LucideChartColumnBig", "LucideChartColumnDecreasing", "LucideChartColumnIncreasing", "LucideChartColumnStacked", "LucideChartGantt", "LucideChartLine",
  "LucideChartNetwork", "LucideChartNoAxesColumn", "LucideChartNoAxesColumnDecreasing", "LucideChartNoAxesColumnIncreasing", "LucideChartNoAxesCombined", "LucideChartNoAxesGantt", "LucideChartPie", "LucideChartScatter", "LucideChartSpline", "LucideCheck", "LucideCheckCheck", "LucideCheckCircle",
  "LucideCheckCircle2", "LucideCheckLine", "LucideCheckSquare", "LucideCheckSquare2", "LucideChefHat", "LucideCherry", "LucideChevronDown", "LucideChevronDownCircle", "LucideChevronDownSquare", "LucideChevronFirst", "LucideChevronLast", "LucideChevronLeft",
  "LucideChevronLeftCircle", "LucideChevronLeftSquare", "LucideChevronRight", "LucideChevronRightCircle", "LucideChevronRightSquare", "LucideChevronUp", "LucideChevronUpCircle", "LucideChevronUpSquare", "LucideChevronsDown", "LucideChevronsDownUp", "LucideChevronsLeft", "LucideChevronsLeftRight",
  "LucideChevronsLeftRightEllipsis", "LucideChevronsRight", "LucideChevronsRightLeft", "LucideChevronsUp", "LucideChevronsUpDown", "LucideChrome", "LucideChromium", "LucideChurch", "LucideCigarette", "LucideCigaretteOff", "LucideCircle", "LucideCircleAlert",
  "LucideCircleArrowDown", "LucideCircleArrowLeft", "LucideCircleArrowOutDownLeft", "LucideCircleArrowOutDownRight", "LucideCircleArrowOutUpLeft", "LucideCircleArrowOutUpRight", "LucideCircleArrowRight", "LucideCircleArrowUp", "LucideCircleCheck", "LucideCircleCheckBig", "LucideCircleChevronDown", "LucideCircleChevronLeft",
  "LucideCircleChevronRight", "LucideCircleChevronUp", "LucideCircleDashed", "LucideCircleDivide", "LucideCircleDollarSign", "LucideCircleDot", "LucideCircleDotDashed", "LucideCircleEllipsis", "LucideCircleEqual", "LucideCircleFadingArrowUp", "LucideCircleFadingPlus", "LucideCircleGauge",
  "LucideCircleHelp", "LucideCircleMinus", "LucideCircleOff", "LucideCircleParking", "LucideCircleParkingOff", "LucideCirclePause", "LucideCirclePercent", "LucideCirclePlay", "LucideCirclePlus", "LucideCirclePoundSterling", "LucideCirclePower", "LucideCircleQuestionMark",
  "LucideCircleSlash", "LucideCircleSlash2", "LucideCircleSlashed", "LucideCircleSmall", "LucideCircleStar", "LucideCircleStop", "LucideCircleUser", "LucideCircleUserRound", "LucideCircleX", "LucideCircuitBoard", "LucideCitrus", "LucideClapperboard",
  "LucideClipboard", "LucideClipboardCheck", "LucideClipboardClock", "LucideClipboardCopy", "LucideClipboardEdit", "LucideClipboardList", "LucideClipboardMinus", "LucideClipboardPaste", "LucideClipboardPen", "LucideClipboardPenLine", "LucideClipboardPlus", "LucideClipboardSignature",
  "LucideClipboardType", "LucideClipboardX", "LucideClock", "LucideClock1", "LucideClock10", "LucideClock11", "LucideClock12", "LucideClock2", "LucideClock3", "LucideClock4", "LucideClock5", "LucideClock6",
  "LucideClock7", "LucideClock8", "LucideClock9", "LucideClockAlert", "LucideClockArrowDown", "LucideClockArrowUp", "LucideClockFading", "LucideClockPlus", "LucideClosedCaption", "LucideCloud", "LucideCloudAlert", "LucideCloudCheck",
  "LucideCloudCog", "LucideCloudDownload", "LucideCloudDrizzle", "LucideCloudFog", "LucideCloudHail", "LucideCloudLightning", "LucideCloudMoon", "LucideCloudMoonRain", "LucideCloudOff", "LucideCloudRain", "LucideCloudRainWind", "LucideCloudSnow",
  "LucideCloudSun", "LucideCloudSunRain", "LucideCloudUpload", "LucideCloudy", "LucideClover", "LucideClub", "LucideCode", "LucideCode2", "LucideCodeSquare", "LucideCodeXml", "LucideCodepen", "LucideCodesandbox",
  "LucideCoffee", "LucideCog", "LucideCoins", "LucideColumns", "LucideColumns2", "LucideColumns3", "LucideColumns3Cog", "LucideColumns4", "LucideColumnsSettings", "LucideCombine", "LucideCommand", "LucideCompass",
  "LucideComponent", "LucideComputer", "LucideConciergeBell", "LucideCone", "LucideConstruction", "LucideContact", "LucideContact2", "LucideContactRound", "LucideContainer", "LucideContrast", "LucideCookie", "LucideCookingPot",
  "LucideCopy", "LucideCopyCheck", "LucideCopyMinus", "LucideCopyPlus", "LucideCopySlash", "LucideCopyX", "LucideCopyleft", "LucideCopyright", "LucideCornerDownLeft", "LucideCornerDownRight", "LucideCornerLeftDown", "LucideCornerLeftUp",
  "LucideCornerRightDown", "LucideCornerRightUp", "LucideCornerUpLeft", "LucideCornerUpRight", "LucideCpu", "LucideCreativeCommons", "LucideCreditCard", "LucideCroissant", "LucideCrop", "LucideCross", "LucideCrosshair", "LucideCrown",
  "LucideCuboid", "LucideCupSoda", "LucideCurlyBraces", "LucideCurrency", "LucideCylinder", "LucideDam", "LucideDatabase", "LucideDatabaseBackup", "LucideDatabaseZap", "LucideDecimalsArrowLeft", "LucideDecimalsArrowRight", "LucideDelete",
  "LucideDessert", "LucideDiameter", "LucideDiamond", "LucideDiamondMinus", "LucideDiamondPercent", "LucideDiamondPlus", "LucideDice1", "LucideDice2", "LucideDice3", "LucideDice4", "LucideDice5", "LucideDice6",
  "LucideDices", "LucideDiff", "LucideDisc", "LucideDisc2", "LucideDisc3", "LucideDiscAlbum", "LucideDivide", "LucideDivideCircle", "LucideDivideSquare", "LucideDna", "LucideDnaOff", "LucideDock",
  "LucideDog", "LucideDollarSign", "LucideDonut", "LucideDoorClosed", "LucideDoorClosedLocked", "LucideDoorOpen", "LucideDot", "LucideDotSquare", "LucideDownload", "LucideDownloadCloud", "LucideDraftingCompass", "LucideDrama",
  "LucideDribbble", "LucideDrill", "LucideDrone", "LucideDroplet", "LucideDropletOff", "LucideDroplets", "LucideDrum", "LucideDrumstick", "LucideDumbbell", "LucideEar", "LucideEarOff", "LucideEarth",
  "LucideEarthLock", "LucideEclipse", "LucideEdit", "LucideEdit2", "LucideEdit3", "LucideEgg", "LucideEggFried", "LucideEggOff", "LucideEllipsis", "LucideEllipsisVertical", "LucideEqual", "LucideEqualApproximately",
  "LucideEqualNot", "LucideEqualSquare", "LucideEraser", "LucideEthernetPort", "LucideEuro", "LucideEvCharger", "LucideExpand", "LucideExternalLink", "LucideEye", "LucideEyeClosed", "LucideEyeOff", "LucideFacebook",
  "LucideFactory", "LucideFan", "LucideFastForward", "LucideFeather", "LucideFence", "LucideFerrisWheel", "LucideFigma", "LucideFile", "LucideFileArchive", "LucideFileAudio", "LucideFileAudio2", "LucideFileAxis3D",
  "LucideFileAxis3d", "LucideFileBadge", "LucideFileBadge2", "LucideFileBarChart", "LucideFileBarChart2", "LucideFileBox", "LucideFileChartColumn", "LucideFileChartColumnIncreasing", "LucideFileChartLine", "LucideFileChartPie", "LucideFileCheck", "LucideFileCheck2",
  "LucideFileClock", "LucideFileCode", "LucideFileCode2", "LucideFileCog", "LucideFileCog2", "LucideFileDiff", "LucideFileDigit", "LucideFileDown", "LucideFileEdit", "LucideFileHeart", "LucideFileImage", "LucideFileInput",
  "LucideFileJson", "LucideFileJson2", "LucideFileKey", "LucideFileKey2", "LucideFileLineChart", "LucideFileLock", "LucideFileLock2", "LucideFileMinus", "LucideFileMinus2", "LucideFileMusic", "LucideFileOutput", "LucideFilePen",
  "LucideFilePenLine", "LucideFilePieChart", "LucideFilePlay", "LucideFilePlus", "LucideFilePlus2", "LucideFileQuestion", "LucideFileQuestionMark", "LucideFileScan", "LucideFileSearch", "LucideFileSearch2", "LucideFileSignature", "LucideFileSliders",
  "LucideFileSpreadsheet", "LucideFileStack", "LucideFileSymlink", "LucideFileTerminal", "LucideFileText", "LucideFileType", "LucideFileType2", "LucideFileUp", "LucideFileUser", "LucideFileVideo", "LucideFileVideo2", "LucideFileVideoCamera",
  "LucideFileVolume", "LucideFileVolume2", "LucideFileWarning", "LucideFileX", "LucideFileX2", "LucideFiles", "LucideFilm", "LucideFilter", "LucideFilterX", "LucideFingerprint", "LucideFireExtinguisher", "LucideFish",
  "LucideFishOff", "LucideFishSymbol", "LucideFlag", "LucideFlagOff", "LucideFlagTriangleLeft", "LucideFlagTriangleRight", "LucideFlame", "LucideFlameKindling", "LucideFlashlight", "LucideFlashlightOff", "LucideFlaskConical", "LucideFlaskConicalOff",
  "LucideFlaskRound", "LucideFlipHorizontal", "LucideFlipHorizontal2", "LucideFlipVertical", "LucideFlipVertical2", "LucideFlower", "LucideFlower2", "LucideFocus", "LucideFoldHorizontal", "LucideFoldVertical", "LucideFolder", "LucideFolderArchive",
  "LucideFolderCheck", "LucideFolderClock", "LucideFolderClosed", "LucideFolderCode", "LucideFolderCog", "LucideFolderCog2", "LucideFolderDot", "LucideFolderDown", "LucideFolderEdit", "LucideFolderGit", "LucideFolderGit2", "LucideFolderHeart",
  "LucideFolderInput", "LucideFolderKanban", "LucideFolderKey", "LucideFolderLock", "LucideFolderMinus", "LucideFolderOpen", "LucideFolderOpenDot", "LucideFolderOutput", "LucideFolderPen", "LucideFolderPlus", "LucideFolderRoot", "LucideFolderSearch",
  "LucideFolderSearch2", "LucideFolderSymlink", "LucideFolderSync", "LucideFolderTree", "LucideFolderUp", "LucideFolderX", "LucideFolders", "LucideFootprints", "LucideForkKnife", "LucideForkKnifeCrossed", "LucideForklift", "LucideFormInput",
  "LucideForward", "LucideFrame", "LucideFramer", "LucideFrown", "LucideFuel", "LucideFullscreen", "LucideFunctionSquare", "LucideFunnel", "LucideFunnelPlus", "LucideFunnelX", "LucideGalleryHorizontal", "LucideGalleryHorizontalEnd",
  "LucideGalleryThumbnails", "LucideGalleryVertical", "LucideGalleryVerticalEnd", "LucideGamepad", "LucideGamepad2", "LucideGanttChart", "LucideGanttChartSquare", "LucideGauge", "LucideGaugeCircle", "LucideGavel", "LucideGem", "LucideGeorgianLari",
  "LucideGhost", "LucideGift", "LucideGitBranch", "LucideGitBranchPlus", "LucideGitCommit", "LucideGitCommitHorizontal", "LucideGitCommitVertical", "LucideGitCompare", "LucideGitCompareArrows", "LucideGitFork", "LucideGitGraph", "LucideGitMerge",
  "LucideGitPullRequest", "LucideGitPullRequestArrow", "LucideGitPullRequestClosed", "LucideGitPullRequestCreate", "LucideGitPullRequestCreateArrow", "LucideGitPullRequestDraft", "LucideGithub", "LucideGitlab", "LucideGlassWater", "LucideGlasses", "LucideGlobe", "LucideGlobe2",
  "LucideGlobeLock", "LucideGoal", "LucideGpu", "LucideGrab", "LucideGraduationCap", "LucideGrape", "LucideGrid", "LucideGrid2X2", "LucideGrid2X2Check", "LucideGrid2X2Plus", "LucideGrid2X2X", "LucideGrid2x2",
  "LucideGrid2x2Check", "LucideGrid2x2Plus", "LucideGrid2x2X", "LucideGrid3X3", "LucideGrid3x2", "LucideGrid3x3", "LucideGrip", "LucideGripHorizontal", "LucideGripVertical", "LucideGroup", "LucideGuitar", "LucideHam",
  "LucideHamburger", "LucideHammer", "LucideHand", "LucideHandCoins", "LucideHandFist", "LucideHandGrab", "LucideHandHeart", "LucideHandHelping", "LucideHandMetal", "LucideHandPlatter", "LucideHandbag", "LucideHandshake",
  "LucideHardDrive", "LucideHardDriveDownload", "LucideHardDriveUpload", "LucideHardHat", "LucideHash", "LucideHatGlasses", "LucideHaze", "LucideHdmiPort", "LucideHeading", "LucideHeading1", "LucideHeading2", "LucideHeading3",
  "LucideHeading4", "LucideHeading5", "LucideHeading6", "LucideHeadphoneOff", "LucideHeadphones", "LucideHeadset", "LucideHeart", "LucideHeartCrack", "LucideHeartHandshake", "LucideHeartMinus", "LucideHeartOff", "LucideHeartPlus",
  "LucideHeartPulse", "LucideHeater", "LucideHelpCircle", "LucideHelpingHand", "LucideHexagon", "LucideHighlighter", "LucideHistory", "LucideHome", "LucideHop", "LucideHopOff", "LucideHospital", "LucideHotel",
  "LucideHourglass", "LucideHouse", "LucideHouseHeart", "LucideHousePlug", "LucideHousePlus", "LucideHouseWifi", "LucideIceCream", "LucideIceCream2", "LucideIceCreamBowl", "LucideIceCreamCone", "LucideIdCard", "LucideIdCardLanyard",
  "LucideImage", "LucideImageDown", "LucideImageMinus", "LucideImageOff", "LucideImagePlay", "LucideImagePlus", "LucideImageUp", "LucideImageUpscale", "LucideImages", "LucideImport", "LucideInbox", "LucideIndent",
  "LucideIndentDecrease", "LucideIndentIncrease", "LucideIndianRupee", "LucideInfinity", "LucideInfo", "LucideInspect", "LucideInspectionPanel", "LucideInstagram", "LucideItalic", "LucideIterationCcw", "LucideIterationCw", "LucideJapaneseYen",
  "LucideJoystick", "LucideKanban", "LucideKanbanSquare", "LucideKanbanSquareDashed", "LucideKayak", "LucideKey", "LucideKeyRound", "LucideKeySquare", "LucideKeyboard", "LucideKeyboardMusic", "LucideKeyboardOff", "LucideLamp",
  "LucideLampCeiling", "LucideLampDesk", "LucideLampFloor", "LucideLampWallDown", "LucideLampWallUp", "LucideLandPlot", "LucideLandmark", "LucideLanguages", "LucideLaptop", "LucideLaptop2", "LucideLaptopMinimal", "LucideLaptopMinimalCheck",
  "LucideLasso", "LucideLassoSelect", "LucideLaugh", "LucideLayers", "LucideLayers2", "LucideLayers3", "LucideLayout", "LucideLayoutDashboard", "LucideLayoutGrid", "LucideLayoutList", "LucideLayoutPanelLeft", "LucideLayoutPanelTop",
  "LucideLayoutTemplate", "LucideLeaf", "LucideLeafyGreen", "LucideLectern", "LucideLetterText", "LucideLibrary", "LucideLibraryBig", "LucideLibrarySquare", "LucideLifeBuoy", "LucideLigature", "LucideLightbulb", "LucideLightbulbOff",
  "LucideLineChart", "LucideLineSquiggle", "LucideLink", "LucideLink2", "LucideLink2Off", "LucideLinkedin", "LucideList", "LucideListCheck", "LucideListChecks", "LucideListChevronsDownUp", "LucideListChevronsUpDown", "LucideListCollapse",
  "LucideListEnd", "LucideListFilter", "LucideListFilterPlus", "LucideListIndentDecrease", "LucideListIndentIncrease", "LucideListMinus", "LucideListMusic", "LucideListOrdered", "LucideListPlus", "LucideListRestart", "LucideListStart", "LucideListTodo",
  "LucideListTree", "LucideListVideo", "LucideListX", "LucideLoader", "LucideLoader2", "LucideLoaderCircle", "LucideLoaderPinwheel", "LucideLocate", "LucideLocateFixed", "LucideLocateOff", "LucideLocationEdit", "LucideLock",
  "LucideLockKeyhole", "LucideLockKeyholeOpen", "LucideLockOpen", "LucideLogIn", "LucideLogOut", "LucideLogs", "LucideLollipop", "LucideLuggage", "LucideMSquare", "LucideMagnet", "LucideMail", "LucideMailCheck",
  "LucideMailMinus", "LucideMailOpen", "LucideMailPlus", "LucideMailQuestion", "LucideMailQuestionMark", "LucideMailSearch", "LucideMailWarning", "LucideMailX", "LucideMailbox", "LucideMails", "LucideMap", "LucideMapMinus",
  "LucideMapPin", "LucideMapPinCheck", "LucideMapPinCheckInside", "LucideMapPinHouse", "LucideMapPinMinus", "LucideMapPinMinusInside", "LucideMapPinOff", "LucideMapPinPen", "LucideMapPinPlus", "LucideMapPinPlusInside", "LucideMapPinX", "LucideMapPinXInside",
  "LucideMapPinned", "LucideMapPlus", "LucideMars", "LucideMarsStroke", "LucideMartini", "LucideMaximize", "LucideMaximize2", "LucideMedal", "LucideMegaphone", "LucideMegaphoneOff", "LucideMeh", "LucideMemoryStick",
  "LucideMenu", "LucideMenuSquare", "LucideMerge", "LucideMessageCircle", "LucideMessageCircleCode", "LucideMessageCircleDashed", "LucideMessageCircleHeart", "LucideMessageCircleMore", "LucideMessageCircleOff", "LucideMessageCirclePlus", "LucideMessageCircleQuestion", "LucideMessageCircleQuestionMark",
  "LucideMessageCircleReply", "LucideMessageCircleWarning", "LucideMessageCircleX", "LucideMessageSquare", "LucideMessageSquareCode", "LucideMessageSquareDashed", "LucideMessageSquareDiff", "LucideMessageSquareDot", "LucideMessageSquareHeart", "LucideMessageSquareLock", "LucideMessageSquareMore", "LucideMessageSquareOff",
  "LucideMessageSquarePlus", "LucideMessageSquareQuote", "LucideMessageSquareReply", "LucideMessageSquareShare", "LucideMessageSquareText", "LucideMessageSquareWarning", "LucideMessageSquareX", "LucideMessagesSquare", "LucideMic", "LucideMic2", "LucideMicOff", "LucideMicVocal",
  "LucideMicrochip", "LucideMicroscope", "LucideMicrowave", "LucideMilestone", "LucideMilk", "LucideMilkOff", "LucideMinimize", "LucideMinimize2", "LucideMinus", "LucideMinusCircle", "LucideMinusSquare", "LucideMonitor",
  "LucideMonitorCheck", "LucideMonitorCog", "LucideMonitorDot", "LucideMonitorDown", "LucideMonitorOff", "LucideMonitorPause", "LucideMonitorPlay", "LucideMonitorSmartphone", "LucideMonitorSpeaker", "LucideMonitorStop", "LucideMonitorUp", "LucideMonitorX",
  "LucideMoon", "LucideMoonStar", "LucideMoreHorizontal", "LucideMoreVertical", "LucideMountain", "LucideMountainSnow", "LucideMouse", "LucideMouseOff", "LucideMousePointer", "LucideMousePointer2", "LucideMousePointerBan", "LucideMousePointerClick",
  "LucideMousePointerSquareDashed", "LucideMove", "LucideMove3D", "LucideMove3d", "LucideMoveDiagonal", "LucideMoveDiagonal2", "LucideMoveDown", "LucideMoveDownLeft", "LucideMoveDownRight", "LucideMoveHorizontal", "LucideMoveLeft", "LucideMoveRight",
  "LucideMoveUp", "LucideMoveUpLeft", "LucideMoveUpRight", "LucideMoveVertical", "LucideMusic", "LucideMusic2", "LucideMusic3", "LucideMusic4", "LucideNavigation", "LucideNavigation2", "LucideNavigation2Off", "LucideNavigationOff",
  "LucideNetwork", "LucideNewspaper", "LucideNfc", "LucideNonBinary", "LucideNotebook", "LucideNotebookPen", "LucideNotebookTabs", "LucideNotebookText", "LucideNotepadText", "LucideNotepadTextDashed", "LucideNut", "LucideNutOff",
  "LucideOctagon", "LucideOctagonAlert", "LucideOctagonMinus", "LucideOctagonPause", "LucideOctagonX", "LucideOmega", "LucideOption", "LucideOrbit", "LucideOrigami", "LucideOutdent", "LucidePackage", "LucidePackage2",
  "LucidePackageCheck", "LucidePackageMinus", "LucidePackageOpen", "LucidePackagePlus", "LucidePackageSearch", "LucidePackageX", "LucidePaintBucket", "LucidePaintRoller", "LucidePaintbrush", "LucidePaintbrush2", "LucidePaintbrushVertical", "LucidePalette",
  "LucidePalmtree", "LucidePanda", "LucidePanelBottom", "LucidePanelBottomClose", "LucidePanelBottomDashed", "LucidePanelBottomInactive", "LucidePanelBottomOpen", "LucidePanelLeft", "LucidePanelLeftClose", "LucidePanelLeftDashed", "LucidePanelLeftInactive", "LucidePanelLeftOpen",
  "LucidePanelLeftRightDashed", "LucidePanelRight", "LucidePanelRightClose", "LucidePanelRightDashed", "LucidePanelRightInactive", "LucidePanelRightOpen", "LucidePanelTop", "LucidePanelTopBottomDashed", "LucidePanelTopClose", "LucidePanelTopDashed", "LucidePanelTopInactive", "LucidePanelTopOpen",
  "LucidePanelsLeftBottom", "LucidePanelsLeftRight", "LucidePanelsRightBottom", "LucidePanelsTopBottom", "LucidePanelsTopLeft", "LucidePaperclip", "LucideParentheses", "LucideParkingCircle", "LucideParkingCircleOff", "LucideParkingMeter", "LucideParkingSquare", "LucideParkingSquareOff",
  "LucidePartyPopper", "LucidePause", "LucidePauseCircle", "LucidePauseOctagon", "LucidePawPrint", "LucidePcCase", "LucidePen", "LucidePenBox", "LucidePenLine", "LucidePenOff", "LucidePenSquare", "LucidePenTool",
  "LucidePencil", "LucidePencilLine", "LucidePencilOff", "LucidePencilRuler", "LucidePentagon", "LucidePercent", "LucidePercentCircle", "LucidePercentDiamond", "LucidePercentSquare", "LucidePersonStanding", "LucidePhilippinePeso", "LucidePhone",
  "LucidePhoneCall", "LucidePhoneForwarded", "LucidePhoneIncoming", "LucidePhoneMissed", "LucidePhoneOff", "LucidePhoneOutgoing", "LucidePi", "LucidePiSquare", "LucidePiano", "LucidePickaxe", "LucidePictureInPicture", "LucidePictureInPicture2",
  "LucidePieChart", "LucidePiggyBank", "LucidePilcrow", "LucidePilcrowLeft", "LucidePilcrowRight", "LucidePilcrowSquare", "LucidePill", "LucidePillBottle", "LucidePin", "LucidePinOff", "LucidePipette", "LucidePizza",
  "LucidePlane", "LucidePlaneLanding", "LucidePlaneTakeoff", "LucidePlay", "LucidePlayCircle", "LucidePlaySquare", "LucidePlug", "LucidePlug2", "LucidePlugZap", "LucidePlugZap2", "LucidePlus", "LucidePlusCircle",
  "LucidePlusSquare", "LucidePocket", "LucidePocketKnife", "LucidePodcast", "LucidePointer", "LucidePointerOff", "LucidePopcorn", "LucidePopsicle", "LucidePoundSterling", "LucidePower", "LucidePowerCircle", "LucidePowerOff",
  "LucidePowerSquare", "LucidePresentation", "LucidePrinter", "LucidePrinterCheck", "LucideProjector", "LucideProportions", "LucidePuzzle", "LucidePyramid", "LucideQrCode", "LucideQuote", "LucideRabbit", "LucideRadar",
  "LucideRadiation", "LucideRadical", "LucideRadio", "LucideRadioReceiver", "LucideRadioTower", "LucideRadius", "LucideRailSymbol", "LucideRainbow", "LucideRat", "LucideRatio", "LucideReceipt", "LucideReceiptCent",
  "LucideReceiptEuro", "LucideReceiptIndianRupee", "LucideReceiptJapaneseYen", "LucideReceiptPoundSterling", "LucideReceiptRussianRuble", "LucideReceiptSwissFranc", "LucideReceiptText", "LucideReceiptTurkishLira", "LucideRectangleCircle", "LucideRectangleEllipsis", "LucideRectangleGoggles", "LucideRectangleHorizontal",
  "LucideRectangleVertical", "LucideRecycle", "LucideRedo", "LucideRedo2", "LucideRedoDot", "LucideRefreshCcw", "LucideRefreshCcwDot", "LucideRefreshCw", "LucideRefreshCwOff", "LucideRefrigerator", "LucideRegex", "LucideRemoveFormatting",
  "LucideRepeat", "LucideRepeat1", "LucideRepeat2", "LucideReplace", "LucideReplaceAll", "LucideReply", "LucideReplyAll", "LucideRewind", "LucideRibbon", "LucideRocket", "LucideRockingChair", "LucideRollerCoaster",
  "LucideRose", "LucideRotate3D", "LucideRotate3d", "LucideRotateCcw", "LucideRotateCcwKey", "LucideRotateCcwSquare", "LucideRotateCw", "LucideRotateCwSquare", "LucideRoute", "LucideRouteOff", "LucideRouter", "LucideRows",
  "LucideRows2", "LucideRows3", "LucideRows4", "LucideRss", "LucideRuler", "LucideRulerDimensionLine", "LucideRussianRuble", "LucideSailboat", "LucideSalad", "LucideSandwich", "LucideSatellite", "LucideSatelliteDish",
  "LucideSaudiRiyal", "LucideSave", "LucideSaveAll", "LucideSaveOff", "LucideScale", "LucideScale3D", "LucideScale3d", "LucideScaling", "LucideScan", "LucideScanBarcode", "LucideScanEye", "LucideScanFace",
  "LucideScanHeart", "LucideScanLine", "LucideScanQrCode", "LucideScanSearch", "LucideScanText", "LucideScatterChart", "LucideSchool", "LucideSchool2", "LucideScissors", "LucideScissorsLineDashed", "LucideScissorsSquare", "LucideScissorsSquareDashedBottom",
  "LucideScreenShare", "LucideScreenShareOff", "LucideScroll", "LucideScrollText", "LucideSearch", "LucideSearchCheck", "LucideSearchCode", "LucideSearchSlash", "LucideSearchX", "LucideSection", "LucideSend", "LucideSendHorizonal",
  "LucideSendHorizontal", "LucideSendToBack", "LucideSeparatorHorizontal", "LucideSeparatorVertical", "LucideServer", "LucideServerCog", "LucideServerCrash", "LucideServerOff", "LucideSettings", "LucideSettings2", "LucideShapes", "LucideShare",
  "LucideShare2", "LucideSheet", "LucideShell", "LucideShield", "LucideShieldAlert", "LucideShieldBan", "LucideShieldCheck", "LucideShieldClose", "LucideShieldEllipsis", "LucideShieldHalf", "LucideShieldMinus", "LucideShieldOff",
  "LucideShieldPlus", "LucideShieldQuestion", "LucideShieldQuestionMark", "LucideShieldUser", "LucideShieldX", "LucideShip", "LucideShipWheel", "LucideShirt", "LucideShoppingBag", "LucideShoppingBasket", "LucideShoppingCart", "LucideShovel",
  "LucideShowerHead", "LucideShredder", "LucideShrimp", "LucideShrink", "LucideShrub", "LucideShuffle", "LucideSidebar", "LucideSidebarClose", "LucideSidebarOpen", "LucideSigma", "LucideSigmaSquare", "LucideSignal",
  "LucideSignalHigh", "LucideSignalLow", "LucideSignalMedium", "LucideSignalZero", "LucideSignature", "LucideSignpost", "LucideSignpostBig", "LucideSiren", "LucideSkipBack", "LucideSkipForward", "LucideSkull", "LucideSlack",
  "LucideSlash", "LucideSlashSquare", "LucideSlice", "LucideSliders", "LucideSlidersHorizontal", "LucideSlidersVertical", "LucideSmartphone", "LucideSmartphoneCharging", "LucideSmartphoneNfc", "LucideSmile", "LucideSmilePlus", "LucideSnail",
  "LucideSnowflake", "LucideSoapDispenserDroplet", "LucideSofa", "LucideSortAsc", "LucideSortDesc", "LucideSoup", "LucideSpace", "LucideSpade", "LucideSparkle", "LucideSparkles", "LucideSpeaker", "LucideSpeech",
  "LucideSpellCheck", "LucideSpellCheck2", "LucideSpline", "LucideSplinePointer", "LucideSplit", "LucideSplitSquareHorizontal", "LucideSplitSquareVertical", "LucideSpool", "LucideSpotlight", "LucideSprayCan", "LucideSprout", "LucideSquare",
  "LucideSquareActivity", "LucideSquareArrowDown", "LucideSquareArrowDownLeft", "LucideSquareArrowDownRight", "LucideSquareArrowLeft", "LucideSquareArrowOutDownLeft", "LucideSquareArrowOutDownRight", "LucideSquareArrowOutUpLeft", "LucideSquareArrowOutUpRight", "LucideSquareArrowRight", "LucideSquareArrowUp", "LucideSquareArrowUpLeft",
  "LucideSquareArrowUpRight", "LucideSquareAsterisk", "LucideSquareBottomDashedScissors", "LucideSquareChartGantt", "LucideSquareCheck", "LucideSquareCheckBig", "LucideSquareChevronDown", "LucideSquareChevronLeft", "LucideSquareChevronRight", "LucideSquareChevronUp", "LucideSquareCode", "LucideSquareDashed",
  "LucideSquareDashedBottom", "LucideSquareDashedBottomCode", "LucideSquareDashedKanban", "LucideSquareDashedMousePointer", "LucideSquareDashedTopSolid", "LucideSquareDivide", "LucideSquareDot", "LucideSquareEqual", "LucideSquareFunction", "LucideSquareGanttChart", "LucideSquareKanban", "LucideSquareLibrary",
  "LucideSquareM", "LucideSquareMenu", "LucideSquareMinus", "LucideSquareMousePointer", "LucideSquareParking", "LucideSquareParkingOff", "LucideSquarePause", "LucideSquarePen", "LucideSquarePercent", "LucideSquarePi", "LucideSquarePilcrow", "LucideSquarePlay",
  "LucideSquarePlus", "LucideSquarePower", "LucideSquareRadical", "LucideSquareRoundCorner", "LucideSquareScissors", "LucideSquareSigma", "LucideSquareSlash", "LucideSquareSplitHorizontal", "LucideSquareSplitVertical", "LucideSquareSquare", "LucideSquareStack", "LucideSquareStar",
  "LucideSquareStop", "LucideSquareTerminal", "LucideSquareUser", "LucideSquareUserRound", "LucideSquareX", "LucideSquaresExclude", "LucideSquaresIntersect", "LucideSquaresSubtract", "LucideSquaresUnite", "LucideSquircle", "LucideSquircleDashed", "LucideSquirrel",
  "LucideStamp", "LucideStar", "LucideStarHalf", "LucideStarOff", "LucideStars", "LucideStepBack", "LucideStepForward", "LucideStethoscope", "LucideSticker", "LucideStickyNote", "LucideStopCircle", "LucideStore",
  "LucideStretchHorizontal", "LucideStretchVertical", "LucideStrikethrough", "LucideSubscript", "LucideSubtitles", "LucideSun", "LucideSunDim", "LucideSunMedium", "LucideSunMoon", "LucideSunSnow", "LucideSunrise", "LucideSunset",
  "LucideSuperscript", "LucideSwatchBook", "LucideSwissFranc", "LucideSwitchCamera", "LucideSword", "LucideSwords", "LucideSyringe", "LucideTable", "LucideTable2", "LucideTableCellsMerge", "LucideTableCellsSplit", "LucideTableColumnsSplit",
  "LucideTableConfig", "LucideTableOfContents", "LucideTableProperties", "LucideTableRowsSplit", "LucideTablet", "LucideTabletSmartphone", "LucideTablets", "LucideTag", "LucideTags", "LucideTally1", "LucideTally2", "LucideTally3",
  "LucideTally4", "LucideTally5", "LucideTangent", "LucideTarget", "LucideTelescope", "LucideTent", "LucideTentTree", "LucideTerminal", "LucideTerminalSquare", "LucideTestTube", "LucideTestTube2", "LucideTestTubeDiagonal",
  "LucideTestTubes", "LucideText", "LucideTextAlignCenter", "LucideTextAlignEnd", "LucideTextAlignJustify", "LucideTextAlignStart", "LucideTextCursor", "LucideTextCursorInput", "LucideTextInitial", "LucideTextQuote", "LucideTextSearch", "LucideTextSelect",
  "LucideTextSelection", "LucideTextWrap", "LucideTheater", "LucideThermometer", "LucideThermometerSnowflake", "LucideThermometerSun", "LucideThumbsDown", "LucideThumbsUp", "LucideTicket", "LucideTicketCheck", "LucideTicketMinus", "LucideTicketPercent",
  "LucideTicketPlus", "LucideTicketSlash", "LucideTicketX", "LucideTickets", "LucideTicketsPlane", "LucideTimer", "LucideTimerOff", "LucideTimerReset", "LucideToggleLeft", "LucideToggleRight", "LucideToilet", "LucideToolCase",
  "LucideTornado", "LucideTorus", "LucideTouchpad", "LucideTouchpadOff", "LucideTowerControl", "LucideToyBrick", "LucideTractor", "LucideTrafficCone", "LucideTrain", "LucideTrainFront", "LucideTrainFrontTunnel", "LucideTrainTrack",
  "LucideTramFront", "LucideTransgender", "LucideTrash", "LucideTrash2", "LucideTreeDeciduous", "LucideTreePalm", "LucideTreePine", "LucideTrees", "LucideTrello", "LucideTrendingDown", "LucideTrendingUp", "LucideTrendingUpDown",
  "LucideTriangle", "LucideTriangleAlert", "LucideTriangleDashed", "LucideTriangleRight", "LucideTrophy", "LucideTruck", "LucideTruckElectric", "LucideTurkishLira", "LucideTurntable", "LucideTurtle", "LucideTv", "LucideTv2",
  "LucideTvMinimal", "LucideTvMinimalPlay", "LucideTwitch", "LucideTwitter", "LucideType", "LucideTypeOutline", "LucideUmbrella", "LucideUmbrellaOff", "LucideUnderline", "LucideUndo", "LucideUndo2", "LucideUndoDot",
  "LucideUnfoldHorizontal", "LucideUnfoldVertical", "LucideUngroup", "LucideUniversity", "LucideUnlink", "LucideUnlink2", "LucideUnlock", "LucideUnlockKeyhole", "LucideUnplug", "LucideUpload", "LucideUploadCloud", "LucideUsb",
  "LucideUser", "LucideUser2", "LucideUserCheck", "LucideUserCheck2", "LucideUserCircle", "LucideUserCircle2", "LucideUserCog", "LucideUserCog2", "LucideUserLock", "LucideUserMinus", "LucideUserMinus2", "LucideUserPen",
  "LucideUserPlus", "LucideUserPlus2", "LucideUserRound", "LucideUserRoundCheck", "LucideUserRoundCog", "LucideUserRoundMinus", "LucideUserRoundPen", "LucideUserRoundPlus", "LucideUserRoundSearch", "LucideUserRoundX", "LucideUserSearch", "LucideUserSquare",
  "LucideUserSquare2", "LucideUserStar", "LucideUserX", "LucideUserX2", "LucideUsers", "LucideUsers2", "LucideUsersRound", "LucideUtensils", "LucideUtensilsCrossed", "LucideUtilityPole", "LucideVariable", "LucideVault",
  "LucideVectorSquare", "LucideVegan", "LucideVenetianMask", "LucideVenus", "LucideVenusAndMars", "LucideVerified", "LucideVibrate", "LucideVibrateOff", "LucideVideo", "LucideVideoOff", "LucideVideotape", "LucideView",
  "LucideVoicemail", "LucideVolleyball", "LucideVolume", "LucideVolume1", "LucideVolume2", "LucideVolumeOff", "LucideVolumeX", "LucideVote", "LucideWallet", "LucideWallet2", "LucideWalletCards", "LucideWalletMinimal",
  "LucideWallpaper", "LucideWand", "LucideWand2", "LucideWandSparkles", "LucideWarehouse", "LucideWashingMachine", "LucideWatch", "LucideWaves", "LucideWavesLadder", "LucideWaypoints", "LucideWebcam", "LucideWebhook",
  "LucideWebhookOff", "LucideWeight", "LucideWheat", "LucideWheatOff", "LucideWholeWord", "LucideWifi", "LucideWifiCog", "LucideWifiHigh", "LucideWifiLow", "LucideWifiOff", "LucideWifiPen", "LucideWifiSync",
  "LucideWifiZero", "LucideWind", "LucideWindArrowDown", "LucideWine", "LucideWineOff", "LucideWorkflow", "LucideWorm", "LucideWrapText", "LucideWrench", "LucideX", "LucideXCircle", "LucideXOctagon",
  "LucideXSquare", "LucideYoutube", "LucideZap", "LucideZapOff", "LucideZoomIn", "LucideZoomOut", "Luggage", "LuggageIcon", "MSquare", "MSquareIcon", "Magnet", "MagnetIcon",
  "Mail", "MailCheck", "MailCheckIcon", "MailIcon", "MailMinus", "MailMinusIcon", "MailOpen", "MailOpenIcon", "MailPlus", "MailPlusIcon", "MailQuestion", "MailQuestionIcon",
  "MailQuestionMark", "MailQuestionMarkIcon", "MailSearch", "MailSearchIcon", "MailWarning", "MailWarningIcon", "MailX", "MailXIcon", "Mailbox", "MailboxIcon", "Mails", "MailsIcon",
  "Map", "MapIcon", "MapMinus", "MapMinusIcon", "MapPin", "MapPinCheck", "MapPinCheckIcon", "MapPinCheckInside", "MapPinCheckInsideIcon", "MapPinHouse", "MapPinHouseIcon", "MapPinIcon",
  "MapPinMinus", "MapPinMinusIcon", "MapPinMinusInside", "MapPinMinusInsideIcon", "MapPinOff", "MapPinOffIcon", "MapPinPen", "MapPinPenIcon", "MapPinPlus", "MapPinPlusIcon", "MapPinPlusInside", "MapPinPlusInsideIcon",
  "MapPinX", "MapPinXIcon", "MapPinXInside", "MapPinXInsideIcon", "MapPinned", "MapPinnedIcon", "MapPlus", "MapPlusIcon", "Mars", "MarsIcon", "MarsStroke", "MarsStrokeIcon",
  "Martini", "MartiniIcon", "Maximize", "Maximize2", "Maximize2Icon", "MaximizeIcon", "Medal", "MedalIcon", "Megaphone", "MegaphoneIcon", "MegaphoneOff", "MegaphoneOffIcon",
  "Meh", "MehIcon", "MemoryStick", "MemoryStickIcon", "Menu", "MenuIcon", "MenuSquare", "MenuSquareIcon", "Merge", "MergeIcon", "MessageCircle", "MessageCircleCode",
  "MessageCircleCodeIcon", "MessageCircleDashed", "MessageCircleDashedIcon", "MessageCircleHeart", "MessageCircleHeartIcon", "MessageCircleIcon", "MessageCircleMore", "MessageCircleMoreIcon", "MessageCircleOff", "MessageCircleOffIcon", "MessageCirclePlus", "MessageCirclePlusIcon",
  "MessageCircleQuestion", "MessageCircleQuestionIcon", "MessageCircleQuestionMark", "MessageCircleQuestionMarkIcon", "MessageCircleReply", "MessageCircleReplyIcon", "MessageCircleWarning", "MessageCircleWarningIcon", "MessageCircleX", "MessageCircleXIcon", "MessageSquare", "MessageSquareCode",
  "MessageSquareCodeIcon", "MessageSquareDashed", "MessageSquareDashedIcon", "MessageSquareDiff", "MessageSquareDiffIcon", "MessageSquareDot", "MessageSquareDotIcon", "MessageSquareHeart", "MessageSquareHeartIcon", "MessageSquareIcon", "MessageSquareLock", "MessageSquareLockIcon",
  "MessageSquareMore", "MessageSquareMoreIcon", "MessageSquareOff", "MessageSquareOffIcon", "MessageSquarePlus", "MessageSquarePlusIcon", "MessageSquareQuote", "MessageSquareQuoteIcon", "MessageSquareReply", "MessageSquareReplyIcon", "MessageSquareShare", "MessageSquareShareIcon",
  "MessageSquareText", "MessageSquareTextIcon", "MessageSquareWarning", "MessageSquareWarningIcon", "MessageSquareX", "MessageSquareXIcon", "MessagesSquare", "MessagesSquareIcon", "Mic", "Mic2", "Mic2Icon", "MicIcon",
  "MicOff", "MicOffIcon", "MicVocal", "MicVocalIcon", "Microchip", "MicrochipIcon", "Microscope", "MicroscopeIcon", "Microwave", "MicrowaveIcon", "Milestone", "MilestoneIcon",
  "Milk", "MilkIcon", "MilkOff", "MilkOffIcon", "Minimize", "Minimize2", "Minimize2Icon", "MinimizeIcon", "Minus", "MinusCircle", "MinusCircleIcon", "MinusIcon",
  "MinusSquare", "MinusSquareIcon", "Monitor", "MonitorCheck", "MonitorCheckIcon", "MonitorCog", "MonitorCogIcon", "MonitorDot", "MonitorDotIcon", "MonitorDown", "MonitorDownIcon", "MonitorIcon",
  "MonitorOff", "MonitorOffIcon", "MonitorPause", "MonitorPauseIcon", "MonitorPlay", "MonitorPlayIcon", "MonitorSmartphone", "MonitorSmartphoneIcon", "MonitorSpeaker", "MonitorSpeakerIcon", "MonitorStop", "MonitorStopIcon",
  "MonitorUp", "MonitorUpIcon", "MonitorX", "MonitorXIcon", "Moon", "MoonIcon", "MoonStar", "MoonStarIcon", "MoreHorizontal", "MoreHorizontalIcon", "MoreVertical", "MoreVerticalIcon",
  "Mountain", "MountainIcon", "MountainSnow", "MountainSnowIcon", "Mouse", "MouseIcon", "MouseOff", "MouseOffIcon", "MousePointer", "MousePointer2", "MousePointer2Icon", "MousePointerBan",
  "MousePointerBanIcon", "MousePointerClick", "MousePointerClickIcon", "MousePointerIcon", "MousePointerSquareDashed", "MousePointerSquareDashedIcon", "Move", "Move3D", "Move3DIcon", "Move3d", "Move3dIcon", "MoveDiagonal",
  "MoveDiagonal2", "MoveDiagonal2Icon", "MoveDiagonalIcon", "MoveDown", "MoveDownIcon", "MoveDownLeft", "MoveDownLeftIcon", "MoveDownRight", "MoveDownRightIcon", "MoveHorizontal", "MoveHorizontalIcon", "MoveIcon",
  "MoveLeft", "MoveLeftIcon", "MoveRight", "MoveRightIcon", "MoveUp", "MoveUpIcon", "MoveUpLeft", "MoveUpLeftIcon", "MoveUpRight", "MoveUpRightIcon", "MoveVertical", "MoveVerticalIcon",
  "Music", "Music2", "Music2Icon", "Music3", "Music3Icon", "Music4", "Music4Icon", "MusicIcon", "Navigation", "Navigation2", "Navigation2Icon", "Navigation2Off",
  "Navigation2OffIcon", "NavigationIcon", "NavigationOff", "NavigationOffIcon", "Network", "NetworkIcon", "Newspaper", "NewspaperIcon", "Nfc", "NfcIcon", "NonBinary", "NonBinaryIcon",
  "Notebook", "NotebookIcon", "NotebookPen", "NotebookPenIcon", "NotebookTabs", "NotebookTabsIcon", "NotebookText", "NotebookTextIcon", "NotepadText", "NotepadTextDashed", "NotepadTextDashedIcon", "NotepadTextIcon",
  "Nut", "NutIcon", "NutOff", "NutOffIcon", "Octagon", "OctagonAlert", "OctagonAlertIcon", "OctagonIcon", "OctagonMinus", "OctagonMinusIcon", "OctagonPause", "OctagonPauseIcon",
  "OctagonX", "OctagonXIcon", "Omega", "OmegaIcon", "Option", "OptionIcon", "Orbit", "OrbitIcon", "Origami", "OrigamiIcon", "Outdent", "OutdentIcon",
  "Package", "Package2", "Package2Icon", "PackageCheck", "PackageCheckIcon", "PackageIcon", "PackageMinus", "PackageMinusIcon", "PackageOpen", "PackageOpenIcon", "PackagePlus", "PackagePlusIcon",
  "PackageSearch", "PackageSearchIcon", "PackageX", "PackageXIcon", "PaintBucket", "PaintBucketIcon", "PaintRoller", "PaintRollerIcon", "Paintbrush", "Paintbrush2", "Paintbrush2Icon", "PaintbrushIcon",
  "PaintbrushVertical", "PaintbrushVerticalIcon", "Palette", "PaletteIcon", "Palmtree", "PalmtreeIcon", "Panda", "PandaIcon", "PanelBottom", "PanelBottomClose", "PanelBottomCloseIcon", "PanelBottomDashed",
  "PanelBottomDashedIcon", "PanelBottomIcon", "PanelBottomInactive", "PanelBottomInactiveIcon", "PanelBottomOpen", "PanelBottomOpenIcon", "PanelLeft", "PanelLeftClose", "PanelLeftCloseIcon", "PanelLeftDashed", "PanelLeftDashedIcon", "PanelLeftIcon",
  "PanelLeftInactive", "PanelLeftInactiveIcon", "PanelLeftOpen", "PanelLeftOpenIcon", "PanelLeftRightDashed", "PanelLeftRightDashedIcon", "PanelRight", "PanelRightClose", "PanelRightCloseIcon", "PanelRightDashed", "PanelRightDashedIcon", "PanelRightIcon",
  "PanelRightInactive", "PanelRightInactiveIcon", "PanelRightOpen", "PanelRightOpenIcon", "PanelTop", "PanelTopBottomDashed", "PanelTopBottomDashedIcon", "PanelTopClose", "PanelTopCloseIcon", "PanelTopDashed", "PanelTopDashedIcon", "PanelTopIcon",
  "PanelTopInactive", "PanelTopInactiveIcon", "PanelTopOpen", "PanelTopOpenIcon", "PanelsLeftBottom", "PanelsLeftBottomIcon", "PanelsLeftRight", "PanelsLeftRightIcon", "PanelsRightBottom", "PanelsRightBottomIcon", "PanelsTopBottom", "PanelsTopBottomIcon",
  "PanelsTopLeft", "PanelsTopLeftIcon", "Paperclip", "PaperclipIcon", "Parentheses", "ParenthesesIcon", "ParkingCircle", "ParkingCircleIcon", "ParkingCircleOff", "ParkingCircleOffIcon", "ParkingMeter", "ParkingMeterIcon",
  "ParkingSquare", "ParkingSquareIcon", "ParkingSquareOff", "ParkingSquareOffIcon", "PartyPopper", "PartyPopperIcon", "Pause", "PauseCircle", "PauseCircleIcon", "PauseIcon", "PauseOctagon", "PauseOctagonIcon",
  "PawPrint", "PawPrintIcon", "PcCase", "PcCaseIcon", "Pen", "PenBox", "PenBoxIcon", "PenIcon", "PenLine", "PenLineIcon", "PenOff", "PenOffIcon",
  "PenSquare", "PenSquareIcon", "PenTool", "PenToolIcon", "Pencil", "PencilIcon", "PencilLine", "PencilLineIcon", "PencilOff", "PencilOffIcon", "PencilRuler", "PencilRulerIcon",
  "Pentagon", "PentagonIcon", "Percent", "PercentCircle", "PercentCircleIcon", "PercentDiamond", "PercentDiamondIcon", "PercentIcon", "PercentSquare", "PercentSquareIcon", "PersonStanding", "PersonStandingIcon",
  "PhilippinePeso", "PhilippinePesoIcon", "Phone", "PhoneCall", "PhoneCallIcon", "PhoneForwarded", "PhoneForwardedIcon", "PhoneIcon", "PhoneIncoming", "PhoneIncomingIcon", "PhoneMissed", "PhoneMissedIcon",
  "PhoneOff", "PhoneOffIcon", "PhoneOutgoing", "PhoneOutgoingIcon", "Pi", "PiIcon", "PiSquare", "PiSquareIcon", "Piano", "PianoIcon", "Pickaxe", "PickaxeIcon",
  "PictureInPicture", "PictureInPicture2", "PictureInPicture2Icon", "PictureInPictureIcon", "PieChart", "PieChartIcon", "PiggyBank", "PiggyBankIcon", "Pilcrow", "PilcrowIcon", "PilcrowLeft", "PilcrowLeftIcon",
  "PilcrowRight", "PilcrowRightIcon", "PilcrowSquare", "PilcrowSquareIcon", "Pill", "PillBottle", "PillBottleIcon", "PillIcon", "Pin", "PinIcon", "PinOff", "PinOffIcon",
  "Pipette", "PipetteIcon", "Pizza", "PizzaIcon", "Plane", "PlaneIcon", "PlaneLanding", "PlaneLandingIcon", "PlaneTakeoff", "PlaneTakeoffIcon", "Play", "PlayCircle",
  "PlayCircleIcon", "PlayIcon", "PlaySquare", "PlaySquareIcon", "Plug", "Plug2", "Plug2Icon", "PlugIcon", "PlugZap", "PlugZap2", "PlugZap2Icon", "PlugZapIcon",
  "Plus", "PlusCircle", "PlusCircleIcon", "PlusIcon", "PlusSquare", "PlusSquareIcon", "Pocket", "PocketIcon", "PocketKnife", "PocketKnifeIcon", "Podcast", "PodcastIcon",
  "Pointer", "PointerIcon", "PointerOff", "PointerOffIcon", "Popcorn", "PopcornIcon", "Popsicle", "PopsicleIcon", "PoundSterling", "PoundSterlingIcon", "Power", "PowerCircle",
  "PowerCircleIcon", "PowerIcon", "PowerOff", "PowerOffIcon", "PowerSquare", "PowerSquareIcon", "Presentation", "PresentationIcon", "Printer", "PrinterCheck", "PrinterCheckIcon", "PrinterIcon",
  "Projector", "ProjectorIcon", "Proportions", "ProportionsIcon", "Puzzle", "PuzzleIcon", "Pyramid", "PyramidIcon", "QrCode", "QrCodeIcon", "Quote", "QuoteIcon",
  "Rabbit", "RabbitIcon", "Radar", "RadarIcon", "Radiation", "RadiationIcon", "Radical", "RadicalIcon", "Radio", "RadioIcon", "RadioReceiver", "RadioReceiverIcon",
  "RadioTower", "RadioTowerIcon", "Radius", "RadiusIcon", "RailSymbol", "RailSymbolIcon", "Rainbow", "RainbowIcon", "Rat", "RatIcon", "Ratio", "RatioIcon",
  "Receipt", "ReceiptCent", "ReceiptCentIcon", "ReceiptEuro", "ReceiptEuroIcon", "ReceiptIcon", "ReceiptIndianRupee", "ReceiptIndianRupeeIcon", "ReceiptJapaneseYen", "ReceiptJapaneseYenIcon", "ReceiptPoundSterling", "ReceiptPoundSterlingIcon",
  "ReceiptRussianRuble", "ReceiptRussianRubleIcon", "ReceiptSwissFranc", "ReceiptSwissFrancIcon", "ReceiptText", "ReceiptTextIcon", "ReceiptTurkishLira", "ReceiptTurkishLiraIcon", "RectangleCircle", "RectangleCircleIcon", "RectangleEllipsis", "RectangleEllipsisIcon",
  "RectangleGoggles", "RectangleGogglesIcon", "RectangleHorizontal", "RectangleHorizontalIcon", "RectangleVertical", "RectangleVerticalIcon", "Recycle", "RecycleIcon", "Redo", "Redo2", "Redo2Icon", "RedoDot",
  "RedoDotIcon", "RedoIcon", "RefreshCcw", "RefreshCcwDot", "RefreshCcwDotIcon", "RefreshCcwIcon", "RefreshCw", "RefreshCwIcon", "RefreshCwOff", "RefreshCwOffIcon", "Refrigerator", "RefrigeratorIcon",
  "Regex", "RegexIcon", "RemoveFormatting", "RemoveFormattingIcon", "Repeat", "Repeat1", "Repeat1Icon", "Repeat2", "Repeat2Icon", "RepeatIcon", "Replace", "ReplaceAll",
  "ReplaceAllIcon", "ReplaceIcon", "Reply", "ReplyAll", "ReplyAllIcon", "ReplyIcon", "Rewind", "RewindIcon", "Ribbon", "RibbonIcon", "Rocket", "RocketIcon",
  "RockingChair", "RockingChairIcon", "RollerCoaster", "RollerCoasterIcon", "Rose", "RoseIcon", "Rotate3D", "Rotate3DIcon", "Rotate3d", "Rotate3dIcon", "RotateCcw", "RotateCcwIcon",
  "RotateCcwKey", "RotateCcwKeyIcon", "RotateCcwSquare", "RotateCcwSquareIcon", "RotateCw", "RotateCwIcon", "RotateCwSquare", "RotateCwSquareIcon", "Route", "RouteIcon", "RouteOff", "RouteOffIcon",
  "Router", "RouterIcon", "Rows", "Rows2", "Rows2Icon", "Rows3", "Rows3Icon", "Rows4", "Rows4Icon", "RowsIcon", "Rss", "RssIcon",
  "Ruler", "RulerDimensionLine", "RulerDimensionLineIcon", "RulerIcon", "RussianRuble", "RussianRubleIcon", "Sailboat", "SailboatIcon", "Salad", "SaladIcon", "Sandwich", "SandwichIcon",
  "Satellite", "SatelliteDish", "SatelliteDishIcon", "SatelliteIcon", "SaudiRiyal", "SaudiRiyalIcon", "Save", "SaveAll", "SaveAllIcon", "SaveIcon", "SaveOff", "SaveOffIcon",
  "Scale", "Scale3D", "Scale3DIcon", "Scale3d", "Scale3dIcon", "ScaleIcon", "Scaling", "ScalingIcon", "Scan", "ScanBarcode", "ScanBarcodeIcon", "ScanEye",
  "ScanEyeIcon", "ScanFace", "ScanFaceIcon", "ScanHeart", "ScanHeartIcon", "ScanIcon", "ScanLine", "ScanLineIcon", "ScanQrCode", "ScanQrCodeIcon", "ScanSearch", "ScanSearchIcon",
  "ScanText", "ScanTextIcon", "ScatterChart", "ScatterChartIcon", "School", "School2", "School2Icon", "SchoolIcon", "Scissors", "ScissorsIcon", "ScissorsLineDashed", "ScissorsLineDashedIcon",
  "ScissorsSquare", "ScissorsSquareDashedBottom", "ScissorsSquareDashedBottomIcon", "ScissorsSquareIcon", "ScreenShare", "ScreenShareIcon", "ScreenShareOff", "ScreenShareOffIcon", "Scroll", "ScrollIcon", "ScrollText", "ScrollTextIcon",
  "Search", "SearchCheck", "SearchCheckIcon", "SearchCode", "SearchCodeIcon", "SearchIcon", "SearchSlash", "SearchSlashIcon", "SearchX", "SearchXIcon", "Section", "SectionIcon",
  "Send", "SendHorizonal", "SendHorizonalIcon", "SendHorizontal", "SendHorizontalIcon", "SendIcon", "SendToBack", "SendToBackIcon", "SeparatorHorizontal", "SeparatorHorizontalIcon", "SeparatorVertical", "SeparatorVerticalIcon",
  "Server", "ServerCog", "ServerCogIcon", "ServerCrash", "ServerCrashIcon", "ServerIcon", "ServerOff", "ServerOffIcon", "Settings", "Settings2", "Settings2Icon", "SettingsIcon",
  "Shapes", "ShapesIcon", "Share", "Share2", "Share2Icon", "ShareIcon", "Sheet", "SheetIcon", "Shell", "ShellIcon", "Shield", "ShieldAlert",
  "ShieldAlertIcon", "ShieldBan", "ShieldBanIcon", "ShieldCheck", "ShieldCheckIcon", "ShieldClose", "ShieldCloseIcon", "ShieldEllipsis", "ShieldEllipsisIcon", "ShieldHalf", "ShieldHalfIcon", "ShieldIcon",
  "ShieldMinus", "ShieldMinusIcon", "ShieldOff", "ShieldOffIcon", "ShieldPlus", "ShieldPlusIcon", "ShieldQuestion", "ShieldQuestionIcon", "ShieldQuestionMark", "ShieldQuestionMarkIcon", "ShieldUser", "ShieldUserIcon",
  "ShieldX", "ShieldXIcon", "Ship", "ShipIcon", "ShipWheel", "ShipWheelIcon", "Shirt", "ShirtIcon", "ShoppingBag", "ShoppingBagIcon", "ShoppingBasket", "ShoppingBasketIcon",
  "ShoppingCart", "ShoppingCartIcon", "Shovel", "ShovelIcon", "ShowerHead", "ShowerHeadIcon", "Shredder", "ShredderIcon", "Shrimp", "ShrimpIcon", "Shrink", "ShrinkIcon",
  "Shrub", "ShrubIcon", "Shuffle", "ShuffleIcon", "Sidebar", "SidebarClose", "SidebarCloseIcon", "SidebarIcon", "SidebarOpen", "SidebarOpenIcon", "Sigma", "SigmaIcon",
  "SigmaSquare", "SigmaSquareIcon", "Signal", "SignalHigh", "SignalHighIcon", "SignalIcon", "SignalLow", "SignalLowIcon", "SignalMedium", "SignalMediumIcon", "SignalZero", "SignalZeroIcon",
  "Signature", "SignatureIcon", "Signpost", "SignpostBig", "SignpostBigIcon", "SignpostIcon", "Siren", "SirenIcon", "SkipBack", "SkipBackIcon", "SkipForward", "SkipForwardIcon",
  "Skull", "SkullIcon", "Slack", "SlackIcon", "Slash", "SlashIcon", "SlashSquare", "SlashSquareIcon", "Slice", "SliceIcon", "Sliders", "SlidersHorizontal",
  "SlidersHorizontalIcon", "SlidersIcon", "SlidersVertical", "SlidersVerticalIcon", "Smartphone", "SmartphoneCharging", "SmartphoneChargingIcon", "SmartphoneIcon", "SmartphoneNfc", "SmartphoneNfcIcon", "Smile", "SmileIcon",
  "SmilePlus", "SmilePlusIcon", "Snail", "SnailIcon", "Snowflake", "SnowflakeIcon", "SoapDispenserDroplet", "SoapDispenserDropletIcon", "Sofa", "SofaIcon", "SortAsc", "SortAscIcon",
  "SortDesc", "SortDescIcon", "Soup", "SoupIcon", "Space", "SpaceIcon", "Spade", "SpadeIcon", "Sparkle", "SparkleIcon", "Sparkles", "SparklesIcon",
  "Speaker", "SpeakerIcon", "Speech", "SpeechIcon", "SpellCheck", "SpellCheck2", "SpellCheck2Icon", "SpellCheckIcon", "Spline", "SplineIcon", "SplinePointer", "SplinePointerIcon",
  "Split", "SplitIcon", "SplitSquareHorizontal", "SplitSquareHorizontalIcon", "SplitSquareVertical", "SplitSquareVerticalIcon", "Spool", "SpoolIcon", "Spotlight", "SpotlightIcon", "SprayCan", "SprayCanIcon",
  "Sprout", "SproutIcon", "Square", "SquareActivity", "SquareActivityIcon", "SquareArrowDown", "SquareArrowDownIcon", "SquareArrowDownLeft", "SquareArrowDownLeftIcon", "SquareArrowDownRight", "SquareArrowDownRightIcon", "SquareArrowLeft",
  "SquareArrowLeftIcon", "SquareArrowOutDownLeft", "SquareArrowOutDownLeftIcon", "SquareArrowOutDownRight", "SquareArrowOutDownRightIcon", "SquareArrowOutUpLeft", "SquareArrowOutUpLeftIcon", "SquareArrowOutUpRight", "SquareArrowOutUpRightIcon", "SquareArrowRight", "SquareArrowRightIcon", "SquareArrowUp",
  "SquareArrowUpIcon", "SquareArrowUpLeft", "SquareArrowUpLeftIcon", "SquareArrowUpRight", "SquareArrowUpRightIcon", "SquareAsterisk", "SquareAsteriskIcon", "SquareBottomDashedScissors", "SquareBottomDashedScissorsIcon", "SquareChartGantt", "SquareChartGanttIcon", "SquareCheck",
  "SquareCheckBig", "SquareCheckBigIcon", "SquareCheckIcon", "SquareChevronDown", "SquareChevronDownIcon", "SquareChevronLeft", "SquareChevronLeftIcon", "SquareChevronRight", "SquareChevronRightIcon", "SquareChevronUp", "SquareChevronUpIcon", "SquareCode",
  "SquareCodeIcon", "SquareDashed", "SquareDashedBottom", "SquareDashedBottomCode", "SquareDashedBottomCodeIcon", "SquareDashedBottomIcon", "SquareDashedIcon", "SquareDashedKanban", "SquareDashedKanbanIcon", "SquareDashedMousePointer", "SquareDashedMousePointerIcon", "SquareDashedTopSolid",
  "SquareDashedTopSolidIcon", "SquareDivide", "SquareDivideIcon", "SquareDot", "SquareDotIcon", "SquareEqual", "SquareEqualIcon", "SquareFunction", "SquareFunctionIcon", "SquareGanttChart", "SquareGanttChartIcon", "SquareIcon",
  "SquareKanban", "SquareKanbanIcon", "SquareLibrary", "SquareLibraryIcon", "SquareM", "SquareMIcon", "SquareMenu", "SquareMenuIcon", "SquareMinus", "SquareMinusIcon", "SquareMousePointer", "SquareMousePointerIcon",
  "SquareParking", "SquareParkingIcon", "SquareParkingOff", "SquareParkingOffIcon", "SquarePause", "SquarePauseIcon", "SquarePen", "SquarePenIcon", "SquarePercent", "SquarePercentIcon", "SquarePi", "SquarePiIcon",
  "SquarePilcrow", "SquarePilcrowIcon", "SquarePlay", "SquarePlayIcon", "SquarePlus", "SquarePlusIcon", "SquarePower", "SquarePowerIcon", "SquareRadical", "SquareRadicalIcon", "SquareRoundCorner", "SquareRoundCornerIcon",
  "SquareScissors", "SquareScissorsIcon", "SquareSigma", "SquareSigmaIcon", "SquareSlash", "SquareSlashIcon", "SquareSplitHorizontal", "SquareSplitHorizontalIcon", "SquareSplitVertical", "SquareSplitVerticalIcon", "SquareSquare", "SquareSquareIcon",
  "SquareStack", "SquareStackIcon", "SquareStar", "SquareStarIcon", "SquareStop", "SquareStopIcon", "SquareTerminal", "SquareTerminalIcon", "SquareUser", "SquareUserIcon", "SquareUserRound", "SquareUserRoundIcon",
  "SquareX", "SquareXIcon", "SquaresExclude", "SquaresExcludeIcon", "SquaresIntersect", "SquaresIntersectIcon", "SquaresSubtract", "SquaresSubtractIcon", "SquaresUnite", "SquaresUniteIcon", "Squircle", "SquircleDashed",
  "SquircleDashedIcon", "SquircleIcon", "Squirrel", "SquirrelIcon", "Stamp", "StampIcon", "Star", "StarHalf", "StarHalfIcon", "StarIcon", "StarOff", "StarOffIcon",
  "Stars", "StarsIcon", "StepBack", "StepBackIcon", "StepForward", "StepForwardIcon", "Stethoscope", "StethoscopeIcon", "Sticker", "StickerIcon", "StickyNote", "StickyNoteIcon",
  "StopCircle", "StopCircleIcon", "Store", "StoreIcon", "StretchHorizontal", "StretchHorizontalIcon", "StretchVertical", "StretchVerticalIcon", "Strikethrough", "StrikethroughIcon", "Subscript", "SubscriptIcon",
  "Subtitles", "SubtitlesIcon", "Sun", "SunDim", "SunDimIcon", "SunIcon", "SunMedium", "SunMediumIcon", "SunMoon", "SunMoonIcon", "SunSnow", "SunSnowIcon",
  "Sunrise", "SunriseIcon", "Sunset", "SunsetIcon", "Superscript", "SuperscriptIcon", "SwatchBook", "SwatchBookIcon", "SwissFranc", "SwissFrancIcon", "SwitchCamera", "SwitchCameraIcon",
  "Sword", "SwordIcon", "Swords", "SwordsIcon", "Syringe", "SyringeIcon", "Table", "Table2", "Table2Icon", "TableCellsMerge", "TableCellsMergeIcon", "TableCellsSplit",
  "TableCellsSplitIcon", "TableColumnsSplit", "TableColumnsSplitIcon", "TableConfig", "TableConfigIcon", "TableIcon", "TableOfContents", "TableOfContentsIcon", "TableProperties", "TablePropertiesIcon", "TableRowsSplit", "TableRowsSplitIcon",
  "Tablet", "TabletIcon", "TabletSmartphone", "TabletSmartphoneIcon", "Tablets", "TabletsIcon", "Tag", "TagIcon", "Tags", "TagsIcon", "Tally1", "Tally1Icon",
  "Tally2", "Tally2Icon", "Tally3", "Tally3Icon", "Tally4", "Tally4Icon", "Tally5", "Tally5Icon", "Tangent", "TangentIcon", "Target", "TargetIcon",
  "Telescope", "TelescopeIcon", "Tent", "TentIcon", "TentTree", "TentTreeIcon", "Terminal", "TerminalIcon", "TerminalSquare", "TerminalSquareIcon", "TestTube", "TestTube2",
  "TestTube2Icon", "TestTubeDiagonal", "TestTubeDiagonalIcon", "TestTubeIcon", "TestTubes", "TestTubesIcon", "Text", "TextAlignCenter", "TextAlignCenterIcon", "TextAlignEnd", "TextAlignEndIcon", "TextAlignJustify",
  "TextAlignJustifyIcon", "TextAlignStart", "TextAlignStartIcon", "TextCursor", "TextCursorIcon", "TextCursorInput", "TextCursorInputIcon", "TextIcon", "TextInitial", "TextInitialIcon", "TextQuote", "TextQuoteIcon",
  "TextSearch", "TextSearchIcon", "TextSelect", "TextSelectIcon", "TextSelection", "TextSelectionIcon", "TextWrap", "TextWrapIcon", "Theater", "TheaterIcon", "Thermometer", "ThermometerIcon",
  "ThermometerSnowflake", "ThermometerSnowflakeIcon", "ThermometerSun", "ThermometerSunIcon", "ThumbsDown", "ThumbsDownIcon", "ThumbsUp", "ThumbsUpIcon", "Ticket", "TicketCheck", "TicketCheckIcon", "TicketIcon",
  "TicketMinus", "TicketMinusIcon", "TicketPercent", "TicketPercentIcon", "TicketPlus", "TicketPlusIcon", "TicketSlash", "TicketSlashIcon", "TicketX", "TicketXIcon", "Tickets", "TicketsIcon",
  "TicketsPlane", "TicketsPlaneIcon", "Timer", "TimerIcon", "TimerOff", "TimerOffIcon", "TimerReset", "TimerResetIcon", "ToggleLeft", "ToggleLeftIcon", "ToggleRight", "ToggleRightIcon",
  "Toilet", "ToiletIcon", "ToolCase", "ToolCaseIcon", "Tornado", "TornadoIcon", "Torus", "TorusIcon", "Touchpad", "TouchpadIcon", "TouchpadOff", "TouchpadOffIcon",
  "TowerControl", "TowerControlIcon", "ToyBrick", "ToyBrickIcon", "Tractor", "TractorIcon", "TrafficCone", "TrafficConeIcon", "Train", "TrainFront", "TrainFrontIcon", "TrainFrontTunnel",
  "TrainFrontTunnelIcon", "TrainIcon", "TrainTrack", "TrainTrackIcon", "TramFront", "TramFrontIcon", "Transgender", "TransgenderIcon", "Trash", "Trash2", "Trash2Icon", "TrashIcon",
  "TreeDeciduous", "TreeDeciduousIcon", "TreePalm", "TreePalmIcon", "TreePine", "TreePineIcon", "Trees", "TreesIcon", "Trello", "TrelloIcon", "TrendingDown", "TrendingDownIcon",
  "TrendingUp", "TrendingUpDown", "TrendingUpDownIcon", "TrendingUpIcon", "Triangle", "TriangleAlert", "TriangleAlertIcon", "TriangleDashed", "TriangleDashedIcon", "TriangleIcon", "TriangleRight", "TriangleRightIcon",
  "Trophy", "TrophyIcon", "Truck", "TruckElectric", "TruckElectricIcon", "TruckIcon", "TurkishLira", "TurkishLiraIcon", "Turntable", "TurntableIcon", "Turtle", "TurtleIcon",
  "Tv", "Tv2", "Tv2Icon", "TvIcon", "TvMinimal", "TvMinimalIcon", "TvMinimalPlay", "TvMinimalPlayIcon", "Twitch", "TwitchIcon", "Twitter", "TwitterIcon",
  "Type", "TypeIcon", "TypeOutline", "TypeOutlineIcon", "Umbrella", "UmbrellaIcon", "UmbrellaOff", "UmbrellaOffIcon", "Underline", "UnderlineIcon", "Undo", "Undo2",
  "Undo2Icon", "UndoDot", "UndoDotIcon", "UndoIcon", "UnfoldHorizontal", "UnfoldHorizontalIcon", "UnfoldVertical", "UnfoldVerticalIcon", "Ungroup", "UngroupIcon", "University", "UniversityIcon",
  "Unlink", "Unlink2", "Unlink2Icon", "UnlinkIcon", "Unlock", "UnlockIcon", "UnlockKeyhole", "UnlockKeyholeIcon", "Unplug", "UnplugIcon", "Upload", "UploadCloud",
  "UploadCloudIcon", "UploadIcon", "Usb", "UsbIcon", "User", "User2", "User2Icon", "UserCheck", "UserCheck2", "UserCheck2Icon", "UserCheckIcon", "UserCircle",
  "UserCircle2", "UserCircle2Icon", "UserCircleIcon", "UserCog", "UserCog2", "UserCog2Icon", "UserCogIcon", "UserIcon", "UserLock", "UserLockIcon", "UserMinus", "UserMinus2",
  "UserMinus2Icon", "UserMinusIcon", "UserPen", "UserPenIcon", "UserPlus", "UserPlus2", "UserPlus2Icon", "UserPlusIcon", "UserRound", "UserRoundCheck", "UserRoundCheckIcon", "UserRoundCog",
  "UserRoundCogIcon", "UserRoundIcon", "UserRoundMinus", "UserRoundMinusIcon", "UserRoundPen", "UserRoundPenIcon", "UserRoundPlus", "UserRoundPlusIcon", "UserRoundSearch", "UserRoundSearchIcon", "UserRoundX", "UserRoundXIcon",
  "UserSearch", "UserSearchIcon", "UserSquare", "UserSquare2", "UserSquare2Icon", "UserSquareIcon", "UserStar", "UserStarIcon", "UserX", "UserX2", "UserX2Icon", "UserXIcon",
  "Users", "Users2", "Users2Icon", "UsersIcon", "UsersRound", "UsersRoundIcon", "Utensils", "UtensilsCrossed", "UtensilsCrossedIcon", "UtensilsIcon", "UtilityPole", "UtilityPoleIcon",
  "Variable", "VariableIcon", "Vault", "VaultIcon", "VectorSquare", "VectorSquareIcon", "Vegan", "VeganIcon", "VenetianMask", "VenetianMaskIcon", "Venus", "VenusAndMars",
  "VenusAndMarsIcon", "VenusIcon", "Verified", "VerifiedIcon", "Vibrate", "VibrateIcon", "VibrateOff", "VibrateOffIcon", "Video", "VideoIcon", "VideoOff", "VideoOffIcon",
  "Videotape", "VideotapeIcon", "View", "ViewIcon", "Voicemail", "VoicemailIcon", "Volleyball", "VolleyballIcon", "Volume", "Volume1", "Volume1Icon", "Volume2",
  "Volume2Icon", "VolumeIcon", "VolumeOff", "VolumeOffIcon", "VolumeX", "VolumeXIcon", "Vote", "VoteIcon", "Wallet", "Wallet2", "Wallet2Icon", "WalletCards",
  "WalletCardsIcon", "WalletIcon", "WalletMinimal", "WalletMinimalIcon", "Wallpaper", "WallpaperIcon", "Wand", "Wand2", "Wand2Icon", "WandIcon", "WandSparkles", "WandSparklesIcon",
  "Warehouse", "WarehouseIcon", "WashingMachine", "WashingMachineIcon", "Watch", "WatchIcon", "Waves", "WavesIcon", "WavesLadder", "WavesLadderIcon", "Waypoints", "WaypointsIcon",
  "Webcam", "WebcamIcon", "Webhook", "WebhookIcon", "WebhookOff", "WebhookOffIcon", "Weight", "WeightIcon", "Wheat", "WheatIcon", "WheatOff", "WheatOffIcon",
  "WholeWord", "WholeWordIcon", "Wifi", "WifiCog", "WifiCogIcon", "WifiHigh", "WifiHighIcon", "WifiIcon", "WifiLow", "WifiLowIcon", "WifiOff", "WifiOffIcon",
  "WifiPen", "WifiPenIcon", "WifiSync", "WifiSyncIcon", "WifiZero", "WifiZeroIcon", "Wind", "WindArrowDown", "WindArrowDownIcon", "WindIcon", "Wine", "WineIcon",
  "WineOff", "WineOffIcon", "Workflow", "WorkflowIcon", "Worm", "WormIcon", "WrapText", "WrapTextIcon", "Wrench", "WrenchIcon", "X", "XCircle",
  "XCircleIcon", "XIcon", "XOctagon", "XOctagonIcon", "XSquare", "XSquareIcon", "Youtube", "YoutubeIcon", "Zap", "ZapIcon", "ZapOff", "ZapOffIcon",
  "ZoomIn", "ZoomInIcon", "ZoomOut", "ZoomOutIcon", "createLucideIcon", "icons",
] as const;

const LUCIDE_REACT_TYPES = [
  "IconNode", "LucideIcon", "LucideProps", "SVGAttributes",
] as const;

const TAILWIND_MERGE_VALUES = [
  "ClassNameValue", "ClassValidator", "Config", "ConfigExtension", "DefaultClassGroupIds", "DefaultThemeGroupIds", "ExperimentalParseClassNameParam", "ExperimentalParsedClassName", "createTailwindMerge", "extendTailwindMerge", "fromTheme", "getDefaultConfig",
  "isAny", "isAnyNonArbitrary", "isArbitraryImage", "isArbitraryLength", "isArbitraryNumber", "isArbitraryPosition", "isArbitraryShadow", "isArbitrarySize", "isArbitraryValue", "isArbitraryVariable", "isArbitraryVariableFamilyName", "isArbitraryVariableImage",
  "isArbitraryVariableLength", "isArbitraryVariablePosition", "isArbitraryVariableShadow", "isArbitraryVariableSize", "isFraction", "isInteger", "isNumber", "isPercent", "isTshirtSize", "mergeConfigs", "twJoin", "twMerge",
  "validators",
] as const;

const CLASS_VARIANCE_AUTHORITY_VALUES = [
  "cva", "cx",
] as const;

const CLASS_VARIANCE_AUTHORITY_TYPES = [
  "CxOptions", "CxReturn", "VariantProps",
] as const;

const REACT_VALUES = [
  "Children", "Component", "Fragment", "Profiler", "PureComponent", "StrictMode", "Suspense", "act", "cache", "captureOwnerStack", "cloneElement", "createContext",
  "createElement", "createRef", "forwardRef", "isValidElement", "lazy", "memo", "startTransition", "use", "useActionState", "useCallback", "useContext", "useDebugValue",
  "useDeferredValue", "useEffect", "useId", "useImperativeHandle", "useInsertionEffect", "useLayoutEffect", "useMemo", "useOptimistic", "useReducer", "useRef", "useState", "useSyncExternalStore",
  "useTransition", "version",
] as const;

const REACT_TYPES = [
  "AriaAttributes", "Attributes", "ChangeEvent", "ChangeEventHandler", "ComponentProps", "ComponentPropsWithRef", "ComponentPropsWithoutRef", "ComponentType", "CSSProperties", "Dispatch", "FC", "FormEvent",
  "FormEventHandler", "HTMLAttributes", "InputHTMLAttributes", "KeyboardEvent", "KeyboardEventHandler", "MouseEvent", "MouseEventHandler", "MutableRefObject", "PropsWithChildren", "ReactElement", "ReactNode", "Ref",
  "RefObject", "SetStateAction", "SVGAttributes", "SyntheticEvent", "TextareaHTMLAttributes",
] as const;

const REACT_JSX_RUNTIME_VALUES = [
  "Fragment", "jsx", "jsxs",
] as const;

const REACT_JSX_RUNTIME_TYPES = [
  "JSX",
] as const;

const REACT_JSX_DEV_RUNTIME_VALUES = [
  "Fragment", "jsxDEV",
] as const;

const REACT_JSX_DEV_RUNTIME_TYPES = [
  "JSX",
] as const;

const REACT_DOM_VALUES = [
  "createPortal", "flushSync", "preconnect", "prefetchDNS", "preinit", "preinitModule", "preload", "requestFormReset", "useFormState", "useFormStatus", "version",
] as const;

const REACT_DOM_TYPES = [
  "FormStatus", "Root",
] as const;

const REACT_DOM_CLIENT_VALUES = [
  "createRoot", "hydrateRoot",
] as const;

const REACT_DOM_CLIENT_TYPES = [
  "Root",
] as const;

const CLSX_VALUES = [
  "clsx",
] as const;

const CLSX_TYPES = [
  "ClassArray", "ClassDictionary", "ClassValue",
] as const;

const PACKAGE_MODULE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  react: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
  "react-dom": ["react-dom", "react-dom/client"],
};

const BASE_DECLARED_EXPORTS: Readonly<Record<string, {
  values: ReadonlySet<string>;
  types: ReadonlySet<string>;
}>> = {
  clsx: { values: new Set(["clsx", "default"]), types: new Set(["ClassValue", "ClassDictionary", "ClassArray"]) },
  "@tanstack/react-router": {
    values: new Set(["HeadContent", "Link", "Outlet", "RouterProvider", "Scripts", "createRootRoute", "createRootRouteWithContext", "createFileRoute", "createRouter"]),
    types: new Set([
      "HeadContentProps",
      "LinkElementProps",
      "LinkOptions",
      "LinkProps",
      "RouteAuthoringOptions",
      "RouteOptions",
      "RouterProviderProps",
      "RouterOptions",
    ]),
  },
  "@tanstack/react-start": {
    values: new Set(["createServerFn"]),
    types: new Set(["ServerFnBuilder", "ServerFnOptions"]),
  },
};
const TYPE_ONLY_EXPORTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "@tanstack/react-router": new Set([
    "AbsoluteToPath", "ActiveLinkOptions", "ActiveOptions", "AnyContext", "AnyPathParams", "AnyRedirect", "AnyRootRoute", "AnyRoute", "AnyRouteMatch", "AnyRouteWithContext", "AnyRouter", "AnyRouterWithContext",
    "AnySchema", "AnySerializationAdapter", "AnyValidator", "AnyValidatorAdapter", "AnyValidatorFn", "AnyValidatorObj", "Assign", "AsyncRouteComponent", "AwaitOptions", "BaseRouteOptions", "BeforeLoadContextOptions", "BeforeLoadContextParameter",
    "BlockerFn", "BuildLocationFn", "BuildNextOptions", "CommitLocationOptions", "Constrain", "ContextAsyncReturnType", "ContextOptions", "ContextReturnType", "ControllablePromise", "ControlledPromise", "CreateFileRoute", "CreateLazyFileRoute",
    "CreateLinkProps", "DefaultRouteTypes", "DefaultValidator", "DeferredPromise", "DeferredPromiseState", "ErrorComponentProps", "ErrorRouteComponent", "ErrorRouteProps", "Expand", "FileBaseRouteOptions", "FileRouteTypes", "FileRoutesByPath",
    "FullSearchSchemaOption", "HistoryLocation", "HistoryState", "InferAllContext", "InferAllParams", "InferDescendantToPaths", "InferFrom", "InferFullSearchSchema", "InferFullSearchSchemaInput", "InferMaskFrom", "InferMaskTo", "InferSelected",
    "InferShouldThrow", "InferStrict", "InferStructuralSharing", "InferTo", "InjectedHtmlEntry", "IntersectAssign", "LazyRouteOptions", "LinkComponent", "LinkComponentProps", "LinkOptions", "LinkProps", "ListenerFn",
    "LoaderFnContext", "LocationRewrite", "LocationRewriteFunction", "LooseAsyncReturnType", "LooseReturnType", "MakeMatchRouteOptions", "MakeOptionalPathParams", "MakeRemountDepsOptionsUnion", "MakeRouteMatch", "MakeRouteMatchUnion", "Manifest", "MatchLocation",
    "MatchRouteOptions", "MergeAll", "MetaDescriptor", "NavigateFn", "NavigateOptions", "NotFoundError", "NotFoundRouteComponent", "NotFoundRouteProps", "ParamsOptions", "ParseParamsFn", "ParsedLocation", "ParsedPath",
    "PathParamOptions", "PreloadableObj", "Redirect", "RedirectOptions", "Register", "RegisteredRouter", "RegisteredSerializableInput", "RelativeToCurrentPath", "RelativeToParentPath", "RelativeToPath", "RelativeToPathAutoComplete", "RemountDepsOptions",
    "RemoveLeadingSlashes", "RemoveTrailingSlashes", "ResolveAllContext", "ResolveAllParamsFromParent", "ResolveFullPath", "ResolveFullSearchSchema", "ResolveFullSearchSchemaInput", "ResolveId", "ResolveLoaderData", "ResolveOptionalParams", "ResolveParams", "ResolveRelativePath",
    "ResolveRequiredParams", "ResolveRoute", "ResolveRouteContext", "ResolveSearchValidatorInput", "ResolveSearchValidatorInputFn", "ResolveValidatorInput", "ResolveValidatorInputFn", "ResolveValidatorOutput", "ResolveValidatorOutputFn", "ResolvedRedirect", "RootRouteId", "RootRouteOptions",
    "RouteById", "RouteComponent", "RouteConstraints", "RouteContext", "RouteContextFn", "RouteContextOptions", "RouteContextParameter", "RouteIds", "RouteLinkEntry", "RouteLoaderFn", "RouteMask", "RouteMatch",
    "RouteOptions", "RoutePathOptions", "RoutePathOptionsIntersection", "RouteTypes", "RouterConstructorOptions", "RouterContextOptions", "RouterEvent", "RouterEvents", "RouterHistory", "RouterListener", "RouterManagedTag", "RouterOptions",
    "RouterProps", "RouterState", "SearchFilter", "SearchMiddleware", "SearchParamOptions", "SearchParser", "SearchSchemaInput", "SearchSerializer", "Serializable", "SerializableExtensions", "SerializationAdapter", "SerializerExtensions",
    "ShouldBlockFn", "StaticDataRouteOption", "StringifyParamsFn", "ToMaskOptions", "ToOptions", "ToPathOption", "ToSubOptions", "TrailingSlashOption", "TrimPath", "TrimPathLeft", "TrimPathRight", "UpdatableRouteOptions",
    "UpdatableStaticRouteOption", "UseBlockerOpts", "UseLinkPropsOptions", "UseMatchRouteOptions", "UseNavigateResult", "ValidateFromPath", "ValidateId", "ValidateLinkOptions", "ValidateLinkOptionsArray", "ValidateNavigateOptions", "ValidateNavigateOptionsArray", "ValidateParams",
    "ValidateRedirectOptions", "ValidateRedirectOptionsArray", "ValidateSearch", "ValidateToPath", "ValidateUseParamsOptions", "ValidateUseParamsResult", "ValidateUseSearchOptions", "ValidateUseSearchResult", "Validator", "ValidatorAdapter", "ValidatorFn", "ValidatorObj",
  ]),
  "@tanstack/react-start": new Set([
    "HydrateOptions", "HydrateProps", "HydrationInteractionEvent", "HydrationInteractionEvents", "HydrationPrefetchStrategy", "HydrationStrategy", "HydrationWhen",
  ]),
  "tailwind-merge": new Set([
    "ClassNameValue", "ClassValidator", "Config", "ConfigExtension", "DefaultClassGroupIds", "DefaultThemeGroupIds", "ExperimentalParseClassNameParam", "ExperimentalParsedClassName",
  ]),
  "class-variance-authority": new Set([
  ]),
};

const JSX_COMPONENT_EXPORTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "@tanstack/react-router": new Set([
    "Asset",
    "Await",
    "Block",
    "CatchBoundary",
    "CatchNotFound",
    "ClientOnly",
    "DefaultGlobalNotFound",
    "ErrorComponent",
    "Match",
    "MatchRoute",
    "Matches",
    "Navigate",
    "NotFoundRoute",
    "RouterContextProvider",
    "ScrollRestoration",
  ]),
  "@tanstack/react-start": new Set(["Hydrate"]),
  react: new Set(["Fragment", "Profiler", "PureComponent", "StrictMode", "Suspense"]),
  "react/jsx-runtime": new Set(["Fragment"]),
  "react/jsx-dev-runtime": new Set(["Fragment"]),
};

/**
 * The browser worker does not have the package's transitive declaration tree,
 * so a small set of public prop contracts is kept here for the components
 * users are most likely to author in a Theme. These contracts intentionally
 * describe the stable public surface (rather than copying internal generic
 * route types) so completion remains useful without making the worker load
 * untrusted package code.
 */
const RICH_TYPE_DECLARATIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "@tanstack/react-router": {
    AssetProps:
      "export type AssetProps = { as?: string; children?: unknown; [attribute: string]: unknown; };",
    AwaitOptions:
      "export type AwaitOptions = { promise: Promise<unknown>; };",
    AwaitProps:
      "export type AwaitProps = AwaitOptions & { fallback?: unknown; children: (result: unknown) => unknown; };",
    CatchBoundaryProps:
      "export type CatchBoundaryProps = { getResetKey: () => string | number; children: unknown; errorComponent?: (props: Record<string, unknown>) => JSX.Element; onCatch?: (error: Error, errorInfo: unknown) => void; };",
    ClientOnlyProps:
      "export type ClientOnlyProps = { children: unknown; fallback?: unknown; };",
    ErrorComponentProps:
      "export type ErrorComponentProps = { error?: unknown; reset?: () => void; info?: unknown; };",
    HeadContentProps:
      "export type HeadContentProps = { assetCrossOrigin?: string; };",
    NavigateOptions:
      "export type NavigateOptions = { to?: string; from?: string; params?: Record<string, unknown>; search?: unknown; hash?: string; state?: unknown; replace?: boolean; resetScroll?: boolean; startTransition?: boolean; viewTransition?: boolean; reloadDocument?: boolean; };",
    RouterProps:
      "export type RouterProps = { router: unknown; context?: Record<string, unknown>; routeTree?: unknown; defaultPreload?: boolean | 'intent' | 'viewport' | 'render'; defaultPreloadDelay?: number; basepath?: string; };",
    ScrollRestorationOptions:
      "export type ScrollRestorationOptions = { getKey?: (location: unknown) => string; };",
  },
  "@tanstack/react-start": {
    HydrationPrefetchFunction:
      "export type HydrationPrefetchFunction = (context: unknown) => unknown;",
    HydrationPrefetchStrategy:
      "export type HydrationPrefetchStrategy = { _s?: (context: unknown) => unknown; };",
    HydrationStrategy:
      "export type HydrationStrategy = { _t?: string; _h?: (props: HydrateProps) => JSX.Element; _s?: (context: unknown) => unknown; };",
    HydrationWhen:
      "export type HydrationWhen = HydrationStrategy | (() => HydrationStrategy);",
    HydrateOptions:
      "export type HydrateOptions = { when: HydrationWhen; fallback?: unknown; onHydrated?: () => void; prefetch?: HydrationPrefetchStrategy | HydrationPrefetchFunction; split?: boolean; };",
    HydrateProps:
      "export type HydrateProps = HydrateOptions & { children: unknown; };",
  },
  "lucide-react": {
    IconNode:
      "export type IconNode = ReadonlyArray<readonly [string, Record<string, string>]>;",
    LucideIcon:
      "export type LucideIcon = (props: LucideProps) => JSX.Element;",
    LucideProps:
      "export type LucideProps = { color?: string; size?: string | number; strokeWidth?: string | number; absoluteStrokeWidth?: boolean; className?: string; style?: Record<string, string | number | undefined>; stroke?: string; fill?: string; children?: unknown; [attribute: string]: unknown; };",
    SVGAttributes:
      "export type SVGAttributes = { color?: string; fill?: string; stroke?: string; strokeWidth?: string | number; className?: string; style?: Record<string, string | number | undefined>; [attribute: string]: unknown; };",
  },
  react: {
    AriaAttributes:
      "export type AriaAttributes = { 'aria-label'?: string; 'aria-hidden'?: boolean | 'true' | 'false'; 'aria-describedby'?: string; };",
    ComponentProps:
      "export type ComponentProps<T> = T extends keyof JSX.IntrinsicElements ? JSX.IntrinsicElements[T] : T extends (props: infer P) => unknown ? P : Record<string, unknown>;",
    ComponentPropsWithRef:
      "export type ComponentPropsWithRef<T> = ComponentProps<T> & { ref?: unknown; };",
    ComponentPropsWithoutRef:
      "export type ComponentPropsWithoutRef<T> = ComponentProps<T>;",
    ComponentType:
      "export type ComponentType<P = Record<string, unknown>> = (props: P) => ReactElement | null;",
    CSSProperties:
      "export type CSSProperties = { [property: string]: string | number | undefined; };",
    Dispatch:
      "export type Dispatch<A> = (value: A) => void;",
    FC:
      "export type FC<P = Record<string, unknown>> = (props: P & { children?: ReactNode }) => ReactElement | null;",
    HTMLAttributes:
      "export type HTMLAttributes<T = unknown> = AriaAttributes & { id?: string; title?: string; role?: string; className?: string; style?: CSSProperties; children?: ReactNode; onClick?: (event: unknown) => void; onChange?: (event: unknown) => void; onSubmit?: (event: unknown) => void; [attribute: string]: unknown; };",
    InputHTMLAttributes:
      "export type InputHTMLAttributes<T = unknown> = HTMLAttributes<T> & { type?: string; value?: string | number; defaultValue?: string | number; placeholder?: string; name?: string; checked?: boolean; disabled?: boolean; readOnly?: boolean; required?: boolean; onChange?: (event: unknown) => void; };",
    PropsWithChildren:
      "export type PropsWithChildren<P> = P & { children?: ReactNode; };",
    ReactElement: "export type ReactElement = JSX.Element;",
    ReactNode: "export type ReactNode = unknown;",
    MutableRefObject:
      "export type MutableRefObject<T> = { current: T; };",
    Ref: "export type Ref<T> = { current: T | null } | ((value: T | null) => void);",
    RefObject:
      "export type RefObject<T> = { readonly current: T | null; };",
    SetStateAction:
      "export type SetStateAction<S> = S | ((previousState: S) => S);",
    SVGAttributes:
      "export type SVGAttributes<T = unknown> = HTMLAttributes<T> & { viewBox?: string; width?: string | number; height?: string | number; fill?: string; stroke?: string; strokeWidth?: string | number; };",
    TextareaHTMLAttributes:
      "export type TextareaHTMLAttributes<T = unknown> = HTMLAttributes<T> & { value?: string | number; defaultValue?: string | number; placeholder?: string; rows?: number; cols?: number; disabled?: boolean; readOnly?: boolean; required?: boolean; onChange?: (event: unknown) => void; };",
  },
};

const RICH_VALUE_TYPES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "@tanstack/react-router": {
    Await: "(props: AwaitProps) => JSX.Element",
    ClientOnly: "(props: ClientOnlyProps) => JSX.Element",
    CatchBoundary: "(props: CatchBoundaryProps) => JSX.Element",
    ErrorComponent: "(props: ErrorComponentProps) => JSX.Element",
    Link: "(props: LinkProps) => JSX.Element",
    Navigate: "(props: NavigateOptions) => JSX.Element",
    ScrollRestoration: "(props: ScrollRestorationOptions) => JSX.Element",
    linkOptions: "<T extends LinkOptions>(options: T) => T",
    useLinkProps: "(options: LinkOptions, forwardedRef?: unknown) => LinkElementProps",
    useNavigate:
      "(defaultOptions?: { from?: string }) => (options: NavigateOptions) => unknown",
  },
  "@tanstack/react-start": {
    Hydrate: "(props: HydrateProps) => JSX.Element",
    createServerFn: "(options?: ServerFnOptions) => ServerFnBuilder",
  },
  react: {
    cloneElement:
      "<P>(element: ReactElement, props?: Partial<P> & { children?: ReactNode }, ...children: ReactNode[]) => ReactElement",
    createElement:
      "(type: unknown, props?: Record<string, unknown> | null, ...children: ReactNode[]) => ReactElement",
    createContext:
      "<T>(defaultValue: T) => { Provider: (props: { value: T; children?: ReactNode }) => ReactElement; Consumer: (props: { children: (value: T) => ReactNode }) => ReactElement; }",
    forwardRef:
      "<T = unknown, P = Record<string, unknown>>(render: (props: P, ref: Ref<T>) => ReactElement | null) => (props: P) => ReactElement | null",
    memo:
      "<P = Record<string, unknown>>(component: (props: P) => ReactElement | null) => (props: P) => ReactElement | null",
    useCallback:
      "<T extends (...args: readonly unknown[]) => unknown>(callback: T, deps: readonly unknown[]) => T",
    useContext: "<T>(context: { _currentValue?: T }) => T",
    useDeferredValue: "<T>(value: T, initialValue?: T) => T",
    useEffect:
      "(effect: () => void | (() => void), deps?: readonly unknown[]) => void",
    useId: "() => string",
    useMemo:
      "<T>(factory: () => T, deps: readonly unknown[]) => T",
    useReducer:
      "<S, A>(reducer: (state: S, action: A) => S, initialState: S) => [S, (action: A) => void]",
    useRef:
      "<T>(initialValue: T) => { current: T }",
    useState:
      "<S>(initialState: S | (() => S)) => [S, (value: SetStateAction<S>) => void]",
    useTransition:
      "() => [boolean, (callback: () => void) => void]",
  },
};


export const THEME_PACKAGE_TYPE_MANIFEST: Readonly<Record<string, ThemePackageTypeManifest>> = {
  "@tanstack/react-router": {
    values: TANSTACK_REACT_ROUTER_VALUES,
    types: [],
  },
  "@tanstack/react-start": {
    values: TANSTACK_REACT_START_VALUES,
    types: [],
  },
  "lucide-react": {
    values: LUCIDE_REACT_VALUES,
    types: LUCIDE_REACT_TYPES,
  },
  "tailwind-merge": {
    values: TAILWIND_MERGE_VALUES,
    types: [],
  },
  "class-variance-authority": {
    values: CLASS_VARIANCE_AUTHORITY_VALUES,
    types: CLASS_VARIANCE_AUTHORITY_TYPES,
  },
  "react": {
    values: REACT_VALUES,
    types: REACT_TYPES,
  },
  "react/jsx-runtime": {
    values: REACT_JSX_RUNTIME_VALUES,
    types: REACT_JSX_RUNTIME_TYPES,
  },
  "react/jsx-dev-runtime": {
    values: REACT_JSX_DEV_RUNTIME_VALUES,
    types: REACT_JSX_DEV_RUNTIME_TYPES,
  },
  "react-dom": {
    values: REACT_DOM_VALUES,
    types: REACT_DOM_TYPES,
  },
  "react-dom/client": {
    values: REACT_DOM_CLIENT_VALUES,
    types: REACT_DOM_CLIENT_TYPES,
  },
  "clsx": {
    values: CLSX_VALUES,
    types: CLSX_TYPES,
  },
};

export const DEFAULT_THEME_TYPE_PACKAGE_NAMES = Object.freeze(
  Object.keys(THEME_PACKAGE_TYPE_MANIFEST),
) as readonly string[];

type ThemePackageFile = {
  path: string;
  content: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeThemeFilePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function extractThemeDependencyNames(
  files: readonly ThemePackageFile[],
): string[] | undefined {
  const packageFile = files.find(
    (file) => normalizeThemeFilePath(file.path) === "package.json",
  );
  if (!packageFile) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageFile.content);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"]) {
    const dependencies = parsed[field];
    if (!isRecord(dependencies)) continue;
    for (const name of Object.keys(dependencies)) {
      if (name.length > 0 && !/[\s\u0000-\u001f]/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

function getModuleNames(packageNames: readonly string[]): string[] {
  const moduleNames = new Set<string>();
  for (const packageName of packageNames) {
    const aliases = PACKAGE_MODULE_ALIASES[packageName] ?? [packageName];
    for (const moduleName of aliases) {
      if (moduleName in THEME_PACKAGE_TYPE_MANIFEST) moduleNames.add(moduleName);
    }
  }
  return [...moduleNames].sort();
}

function renderValueType(moduleName: string, name: string): string {
  const richValueType = RICH_VALUE_TYPES[moduleName]?.[name];
  if (richValueType) return richValueType;
  if (moduleName === "lucide-react" && name !== "createLucideIcon" && name !== "icons") {
    return "(props: LucideProps) => JSX.Element";
  }
  if (moduleName === "lucide-react" && name === "icons") return "Record<string, unknown>";
  if (JSX_COMPONENT_EXPORTS[moduleName]?.has(name)) {
    return "(props: Record<string, unknown>) => JSX.Element";
  }
  if (moduleName === "tailwind-merge" && ["twJoin", "twMerge"].includes(name)) {
    return "(...args: readonly unknown[]) => string";
  }
  if (moduleName === "class-variance-authority" && name === "cx") {
    return "(...args: readonly unknown[]) => string";
  }
  if (moduleName === "class-variance-authority" && name === "cva") {
    return "(...args: readonly unknown[]) => (...args: readonly unknown[]) => string";
  }
  if (
    (moduleName === "react/jsx-runtime" && ["jsx", "jsxs"].includes(name)) ||
    (moduleName === "react/jsx-dev-runtime" && name === "jsxDEV")
  ) {
    return "(...args: readonly unknown[]) => JSX.Element";
  }
  return "(...args: readonly unknown[]) => unknown";
}

function renderModuleDeclaration(moduleName: string): string {
  const manifest = THEME_PACKAGE_TYPE_MANIFEST[moduleName];
  if (!manifest) return "";
  const base = BASE_DECLARED_EXPORTS[moduleName];
  const inferredTypeOnly = TYPE_ONLY_EXPORTS[moduleName] ?? new Set<string>();
  const typeNames = new Set([...manifest.types, ...inferredTypeOnly]);
  // BASE_DECLARED_EXPORTS is the managed allowlist, not a second declaration
  // source. Its values still need to be emitted so imports such as TanStack
  // Router's Link remain discoverable to Monaco's TypeScript worker.
  const values = manifest.values.filter((name) => !typeNames.has(name));
  const richTypes = Object.keys(RICH_TYPE_DECLARATIONS[moduleName] ?? {});
  const types = [...new Set([...typeNames, ...richTypes])].filter(
    (name) => !base?.types.has(name),
  );
  const lines = [`declare module "${moduleName}" {`];
  for (const name of values) lines.push(`  export const ${name}: ${renderValueType(moduleName, name)};`);
  for (const name of types) {
    const richType = RICH_TYPE_DECLARATIONS[moduleName]?.[name];
    lines.push(`  ${richType ?? `export type ${name} = unknown;`}`);
  }
  if (moduleName === "react") {
    lines.push(
      `  const React: {
    readonly Children: typeof Children;
    readonly Fragment: typeof Fragment;
    readonly Suspense: typeof Suspense;
    readonly cloneElement: typeof cloneElement;
    readonly createContext: typeof createContext;
    readonly createElement: typeof createElement;
    readonly forwardRef: typeof forwardRef;
    readonly memo: typeof memo;
    readonly useCallback: typeof useCallback;
    readonly useContext: typeof useContext;
    readonly useEffect: typeof useEffect;
    readonly useId: typeof useId;
    readonly useLayoutEffect: typeof useLayoutEffect;
    readonly useMemo: typeof useMemo;
    readonly useReducer: typeof useReducer;
    readonly useRef: typeof useRef;
    readonly useState: typeof useState;
    readonly useTransition: typeof useTransition;
  };`,
    );
    lines.push("  export default React;");
  }
  lines.push("}");
  return lines.join("\n");
}

export function renderThemePackageTypeDeclarations(
  packageNames: readonly string[],
): string {
  return getModuleNames(packageNames)
    .map(renderModuleDeclaration)
    .filter(Boolean)
    .join("\n\n");
}
