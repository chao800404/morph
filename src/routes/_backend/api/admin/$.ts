import { orderDal } from "@/lib/order/dal/order.dal";
import { draftOrderEditDal } from "@/lib/order/dal/draft-order-edit.dal";
import { orderEditRequestDal } from "@/lib/order/dal/order-edit-request.dal";
import { orderEditService } from "@/lib/order/service/order-edit.service";
import {
  beginDraftOrderEdit,
  confirmDraftOrderEdit,
  addDraftOrderEditPromotions,
  removeDraftOrderEditPromotions,
  addDraftOrderEditShippingMethod,
  updateDraftOrderEditShippingMethod,
  updateDraftOrderEditShippingAction,
  removeDraftOrderEditShippingMethod,
  removeDraftOrderEditShippingAction,
  updateDraftOrderEditFields,
} from "@/lib/order/service/draft-order-edit.service";
import { orderWorkflowDal } from "@/lib/order/dal/order-workflow.dal";
import { orderReturnDal } from "@/lib/order/dal/order-return.dal";
import {
  hasOrderChangeNotificationEmail,
  notifyOrderClaimCreated,
  notifyOrderExchangeCreated,
} from "@/lib/order/service/order-change-notification.service";
import { customerDal } from "@/lib/customer/dal/customer.dal";
import { customerAddressDal } from "@/lib/customer/dal/customer-address.dal";
import { customerGroupDal } from "@/lib/customer/dal/customer-group.dal";
import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { inventoryWriteService } from "@/lib/inventory/service/inventory-write.service";
import { orderFulfillmentDal } from "@/lib/fulfillment/dal/order-fulfillment.dal";
import { locationFulfillmentProviderService } from "@/lib/fulfillment/service/location-fulfillment-provider.service";
import { productDal } from "@/lib/product/dal/product.dal";
import {
  productCategoryDal,
  productTagDal,
  productTypeDal,
} from "@/lib/product/dal/product-taxonomy.dal";
import { productCollectionDal } from "@/lib/product/dal/product-collection.dal";
import { productTaxonomyWriteService } from "@/lib/product/service/product-taxonomy-write.service";
import { productExportDal } from "@/lib/product/dal/product-export.dal";
import { createProductExportService } from "@/lib/product/service/product-export.service";
import { R2ProductImportStorage } from "@/lib/product/import/product-import-storage";
import { createProductImportService } from "@/lib/product/import/product-import.service";
import { createProductImportGroupApplier } from "@/lib/product/import/product-import-apply";
import { handleAdminProductImportsRequest } from "@/server/admin-api/product-imports";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { priceListDal } from "@/lib/pricing/dal/price-list.dal";
import { createAuth } from "@/auth";
import { hasAnyRole } from "@/server/middleware/auth.middleware";
import type { AdminApiAccess } from "@/server/admin-api/orders";
import { handleAdminOrdersRequest } from "@/server/admin-api/orders";
import { handleAdminOrderEditsRequest } from "@/server/admin-api/order-edits";
import { handleAdminDraftOrdersRequest } from "@/server/admin-api/draft-orders";
import { createDraftOrder } from "@/lib/order/service/draft-order-write.service";
import { convertDraftOrderAndNotifyCustomer } from "@/lib/order/service/order-notification.service";
import { handleAdminCustomersRequest } from "@/server/admin-api/customers";
import { handleAdminCustomerGroupsRequest } from "@/server/admin-api/customer-groups";
import { handleAdminCampaignsRequest } from "@/server/admin-api/campaigns";
import { handleAdminProductsRequest } from "@/server/admin-api/products";
import { handleAdminProductDictionariesRequest } from "@/server/admin-api/product-dictionaries";
import { handleAdminPriceListsRequest } from "@/server/admin-api/price-lists";
import { handleAdminPromotionsRequest } from "@/server/admin-api/promotions";
import { promotionDal } from "@/lib/promotion/dal/promotion.dal";
import { promotionWriteService } from "@/lib/promotion/service/promotion-write.service";
import { productWriteService } from "@/lib/product/service/product-write.service";
import { priceListWriteService } from "@/lib/pricing/service/price-list-write.service";
import { productVariantWriteService } from "@/lib/product/service/product-variant-write.service";
import { handleAdminReturnsRequest } from "@/server/admin-api/returns";
import { handleAdminOrderClaimsExchangesRequest } from "@/server/admin-api/order-claims-exchanges";
import { handleAdminInventoryItemsRequest } from "@/server/admin-api/inventory-items";
import { handleAdminInventoryExportsRequest } from "@/server/admin-api/inventory-exports";
import { handleAdminProductExportsRequest } from "@/server/admin-api/product-exports";
import { orderExportDal } from "@/lib/order/export/order-export.dal";
import { createOrderExportService } from "@/lib/order/export/order-export.service";
import { handleAdminOrderExportsRequest } from "@/server/admin-api/order-exports";
import { createInventoryExportService } from "@/lib/inventory/service/inventory-export.service";
import {
  R2CommerceExportStorage,
  type CommerceExportR2Bucket,
} from "@/lib/commerce-export/storage/commerce-export-storage";
import { reservationDal } from "@/lib/inventory/dal/reservation.dal";
import { reservationWriteService } from "@/lib/inventory/service/reservation-write.service";
import { handleAdminReservationsRequest } from "@/server/admin-api/reservations";
import { customerWriteService } from "@/lib/customer/service/customer-write.service";
import { customerAddressWriteService } from "@/lib/customer/service/customer-address-write.service";
import { campaignDal } from "@/lib/promotion/dal/campaign.dal";
import { campaignWriteService } from "@/lib/promotion/service/campaign-write.service";
import { shippingProfileDal } from "@/lib/shipping/dal/shipping-profile.dal";
import { shippingOptionTypeDal } from "@/lib/shipping/dal/shipping-option-type.dal";
import { shippingProfileWriteService } from "@/lib/shipping/service/shipping-profile-write.service";
import { shippingOptionTypeWriteService } from "@/lib/shipping/service/shipping-option-type-write.service";
import { handleAdminShippingConfigurationRequest } from "@/server/admin-api/shipping-configuration";
import { handleAdminLocationShippingOptionsRequest } from "@/server/admin-api/location-shipping-options";
import { locationShippingOptionsService } from "@/lib/shipping/service/location-shipping-options.service";
import { stockLocationDal } from "@/lib/stock-location/dal/stock-location.dal";
import { stockLocationWriteService } from "@/lib/stock-location/service/stock-location-write.service";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { regionDal } from "@/lib/region/dal/region.dal";
import { regionWriteService } from "@/lib/region/service/region-write.service";
import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { salesChannelWriteService } from "@/lib/sales-channel/service/sales-channel-write.service";
import { handleAdminSalesChannelsRequest } from "@/server/admin-api/sales-channels";
import { handleAdminRegionsRequest } from "@/server/admin-api/regions";
import { handleAdminLocationFulfillmentProvidersRequest } from "@/server/admin-api/location-fulfillment-providers";
import { handleAdminStockLocationsRequest } from "@/server/admin-api/stock-locations";
import { storeCreditDal } from "@/lib/store-credit/dal/store-credit.dal";
import { storeCreditWriteService } from "@/lib/store-credit/service/store-credit-write.service";
import { handleAdminStoreCreditAccountsRequest } from "@/server/admin-api/store-credit-accounts";
import { giftCardDal } from "@/lib/gift-card/dal/gift-card.dal";
import { giftCardWriteService } from "@/lib/gift-card/service/gift-card-write.service";
import { handleAdminGiftCardsRequest } from "@/server/admin-api/gift-cards";
import { handleAdminTaxRegionsRequest } from "@/server/admin-api/tax-regions";
import { handleAdminReferenceDataRequest } from "@/server/admin-api/reference-data";
import { handleAdminProductTaxonomyRequest } from "@/server/admin-api/product-taxonomy";
import {
  referenceDataDal,
  REFERENCE_DATA_KINDS,
} from "@/lib/commerce/reference-data";
import { referenceDataWriteService } from "@/lib/commerce/reference-data-write.service";
import { taxDal } from "@/lib/tax/dal/tax.dal";
import { taxWriteService } from "@/lib/tax/service/tax-write.service";
import { authenticateAdminSecretApiKey } from "@/server/admin-api/secret-api-key-auth";
import { handleAdminApiKeysRequest } from "@/server/admin-api/api-keys";
import { apiKeyWriteService } from "@/lib/api-key/service/api-key-write.service";
import { apiKeyDal } from "@/lib/api-key/dal/api-key.dal";
import { verifyApiKeyToken } from "@/lib/api-key/publishable-key";
import { handleAdminCurrenciesRequest } from "@/server/admin-api/currencies";
import { handleAdminStoresRequest } from "@/server/admin-api/stores";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

const authorize = async (apiRequest: Request): Promise<AdminApiAccess> => {
  const authorization = apiRequest.headers.get("authorization");
  if (/^Basic\s/i.test(authorization ?? "")) {
    try {
      const actor = await authenticateAdminSecretApiKey(authorization ?? "", {
        findActiveSecretById: (id) => apiKeyDal.findActiveSecretById(id),
        findSecretOwner: (userId) => apiKeyDal.findSecretOwner(userId),
        verifyToken: verifyApiKeyToken,
        recordSecretUse: (id) => apiKeyDal.recordSecretUse(id),
      });
      return actor
        ? { allowed: true, userId: actor.userId, role: actor.role }
        : {
            allowed: false,
            status: 401,
            error: "UNAUTHORIZED",
            message: "A valid active secret API key is required",
          };
    } catch {
      return {
        allowed: false,
        status: 401,
        error: "UNAUTHORIZED",
        message: "A valid active secret API key is required",
      };
    }
  }

  let session;
  try {
    session = await createAuth(env, apiRequest.url).api.getSession({
      headers: apiRequest.headers,
    });
  } catch {
    return {
      allowed: false,
      status: 401,
      error: "UNAUTHORIZED",
      message: "A signed-in commerce user is required",
    };
  }
  if (!session?.user) {
    return {
      allowed: false,
      status: 401,
      error: "UNAUTHORIZED",
      message: "A signed-in commerce user is required",
    };
  }
  const role = session.user.role;
  if (!role || !hasAnyRole(role, ["admin", "user"])) {
    return {
      allowed: false,
      status: 403,
      error: "FORBIDDEN",
      message: "Commerce access is not assigned to this account",
    };
  }
  return {
    allowed: true as const,
    userId: session.user.id,
    role,
  };
};

const handle = async ({ request }: { request: Request }) => {
  const path = new URL(request.url).pathname
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\/$/, "");
  if (path === "currencies" || path.startsWith("currencies/")) {
    return handleAdminCurrenciesRequest(request, path, {
      authorize,
      listCurrencies: () => currencyDal.listAvailable(),
    });
  }
  if (path === "stores" || path.startsWith("stores/")) {
    return handleAdminStoresRequest(request, path, {
      authorize,
      listStores: (input) => currencyDal.listAdminStores(input),
      findStore: (id) => currencyDal.getAdminStoreById(id),
      updateStore: (id, input) => currencyDal.updateAdminStore(id, input),
    });
  }
  if (
    path === "product-types" ||
    path.startsWith("product-types/") ||
    path === "product-tags" ||
    path.startsWith("product-tags/")
  ) {
    return handleAdminProductDictionariesRequest(request, path, {
      authorize,
      listTypes: (input) => productTypeDal.listPage(input),
      findType: (id) => productTypeDal.findById(id),
      createType: (input) =>
        productTaxonomyWriteService.createProductType(input),
      updateType: (input) =>
        productTaxonomyWriteService.updateProductType(input),
      deleteType: (id, actorId) =>
        productTaxonomyWriteService.deleteProductType(id, actorId),
      listTags: (input) => productTagDal.listPage(input),
      findTag: (id) => productTagDal.findById(id),
      createTag: (input) => productTaxonomyWriteService.createProductTag(input),
      updateTag: (input) => productTaxonomyWriteService.updateProductTag(input),
      deleteTag: (id, actorId) =>
        productTaxonomyWriteService.deleteProductTag(id, actorId),
    });
  }
  if (
    path === "product-categories" ||
    path.startsWith("product-categories/") ||
    path === "collections" ||
    path.startsWith("collections/")
  ) {
    return handleAdminProductTaxonomyRequest(request, path, {
      authorize,
      listCategories: (input) =>
        productCategoryDal.listPage({
          query: input.query,
          sortBy:
            input.sortBy === "name" ||
            input.sortBy === "createdAt" ||
            input.sortBy === "updatedAt"
              ? input.sortBy
              : "name",
          sortOrder: input.sortOrder,
          page: input.page,
          limit: input.limit,
        }),
      findCategory: (id) => productCategoryDal.findDetail(id),
      createCategory: (input) =>
        productTaxonomyWriteService.createCategory(input),
      updateCategory: (input) =>
        productTaxonomyWriteService.updateCategory(input),
      deleteCategories: (ids) =>
        productTaxonomyWriteService.deleteCategories(ids),
      manageCategoryProducts: (input) =>
        productTaxonomyWriteService.manageCategoryProducts(input),
      listCollections: (input) =>
        productCollectionDal.listPage({
          query: input.query,
          sortBy:
            input.sortBy === "title" ||
            input.sortBy === "createdAt" ||
            input.sortBy === "updatedAt"
              ? input.sortBy
              : "title",
          sortOrder: input.sortOrder,
          page: input.page,
          limit: input.limit,
        }),
      findCollection: (id) => productCollectionDal.findById(id),
      createCollection: (input) =>
        productTaxonomyWriteService.createCollection(input),
      updateCollection: (input) =>
        productTaxonomyWriteService.updateCollection(input),
      deleteCollections: (ids, actorId) =>
        productTaxonomyWriteService.deleteCollections(ids, actorId),
      manageCollectionProducts: (input) =>
        productTaxonomyWriteService.manageCollectionProducts(input),
    });
  }
  if (path === "api-keys" || path.startsWith("api-keys/")) {
    return handleAdminApiKeysRequest(request, path, {
      authorize,
      list: (input) => apiKeyDal.listAdminPage(input),
      find: (id, actorId) => apiKeyDal.findAdminById(id, actorId),
      create: (input, actorId) =>
        apiKeyWriteService.create({ ...input, createdBy: actorId }),
      updateTitle: (input) => apiKeyWriteService.updateTitle(input),
      manageSalesChannels: (input) =>
        apiKeyWriteService.manageSalesChannels(input),
      revoke: (input) => apiKeyWriteService.revoke(input),
      deleteRevoked: (input) => apiKeyWriteService.deleteRevoked(input),
    });
  }
  if (
    REFERENCE_DATA_KINDS.some(
      (kind) => path === kind || path.startsWith(`${kind}/`),
    )
  ) {
    return handleAdminReferenceDataRequest(request, path, {
      authorize,
      list: (input) => referenceDataDal.list(input),
      find: (kind, id) => referenceDataDal.find(kind, id),
      create: (input) => referenceDataWriteService.create(input),
      update: (input) => referenceDataWriteService.update(input),
      deleteMany: (input) => referenceDataWriteService.deleteMany(input),
    });
  }
  if (path === "gift-cards" || path.startsWith("gift-cards/")) {
    return handleAdminGiftCardsRequest(request, path, {
      authorize,
      list: (input) => giftCardDal.listPage(input),
      find: (id) => giftCardDal.findById(id),
      listTransactions: (input) => giftCardDal.listTransactions(input),
      create: (input) => giftCardWriteService.create(input),
      adjust: (input) => giftCardWriteService.adjust(input),
      setStatus: (input) => giftCardWriteService.setStatus(input),
      updateDetails: (input) => giftCardWriteService.updateDetails(input),
    });
  }
  if (
    path === "tax-regions" ||
    path.startsWith("tax-regions/") ||
    path === "tax-rates" ||
    path.startsWith("tax-rates/") ||
    path === "tax-providers"
  ) {
    return handleAdminTaxRegionsRequest(request, path, {
      authorize,
      listProviders: () => taxWriteService.listProviders(),
      listRegions: (input) => taxDal.listAdminRegionPage(input),
      findRegion: (id) => taxDal.findRegion(id),
      listRatesForRegionIds: (ids) => taxDal.listRatesForRegionIds(ids),
      listRates: (input) => taxDal.listAdminRatePage(input),
      findRate: (id) => taxDal.findRate(id),
      createRegion: (input, actorId) =>
        taxWriteService.createRegion(input, actorId),
      createProvince: (input, actorId) =>
        taxWriteService.createProvince(input, actorId),
      updateRegion: (input) => taxWriteService.updateRegion(input),
      deleteRegions: (ids) => taxWriteService.deleteRegions(ids),
      createRate: (input, actorId) =>
        taxWriteService.createRate(input, actorId),
      updateRate: (input) => taxWriteService.updateRate(input),
      deleteRates: (ids) => taxWriteService.deleteRates(ids),
    });
  }
  if (
    path === "store-credit-accounts" ||
    path.startsWith("store-credit-accounts/")
  ) {
    return handleAdminStoreCreditAccountsRequest(request, path, {
      authorize,
      listAccounts: (input) => storeCreditDal.listPage(input),
      findAccount: (id) => storeCreditDal.findById(id),
      listTransactions: (input) => storeCreditDal.listTransactions(input),
      createAccount: (input) => storeCreditWriteService.create(input),
      adjust: (input) => storeCreditWriteService.adjust(input),
      setStatus: (input) => storeCreditWriteService.setStatus(input),
    });
  }
  if (
    path === "inventory-items/export" ||
    /^inventory-items\/export\/[0-9a-f-]{36}$/i.test(path) ||
    /^workflows-executions\/export-inventory-items\/[0-9a-f-]{36}$/i.test(path)
  ) {
    const workerEnv = env as unknown as {
      R2_BUCKET?: CommerceExportR2Bucket;
      INVENTORY_EXPORT_QUEUE?: {
        send(message: {
          version: 1;
          type:
            | "inventory-export"
            | "product-export"
            | "order-export"
            | "product-import";
          transactionId: string;
        }): Promise<void>;
      };
    };
    const service = createInventoryExportService({
      storage: new R2CommerceExportStorage(workerEnv.R2_BUCKET),
      queue: workerEnv.INVENTORY_EXPORT_QUEUE,
      prepare: async () => {
        await inventoryDal.reconcileManagedVariants();
      },
      listItems: (input) => inventoryDal.listPage(input),
    });
    return handleAdminInventoryExportsRequest(request, { authorize, service });
  }
  if (path === "inventory-items" || path.startsWith("inventory-items/")) {
    return handleAdminInventoryItemsRequest(request, {
      authorize,
      listItems: async (input) => {
        await inventoryDal.reconcileManagedVariants();
        return inventoryDal.listPage(input);
      },
      findItem: (id, options) => inventoryDal.findById(id, options),
      createItem: (input) => inventoryWriteService.create(input),
      updateItem: (id, input) => inventoryWriteService.update(id, input),
      setLocationLevels: (id, levels) =>
        inventoryWriteService.setLocationLevels(id, levels),
      removeLocationLevels: (id, locationIds) =>
        inventoryWriteService.removeLocationLevels(id, locationIds),
      createLocationLevel: (input) =>
        inventoryWriteService.createLocationLevel(input),
      updateLocationLevel: (id, locationId, input) =>
        inventoryWriteService.updateLocationLevel(id, locationId, input),
      batchLocationLevels: (input) =>
        inventoryWriteService.batchLocationLevels(input),
      archiveItem: (id) => inventoryWriteService.archive(id),
    });
  }
  if (path === "reservations" || path.startsWith("reservations/")) {
    return handleAdminReservationsRequest(request, {
      authorize,
      listReservations: (input) => reservationDal.listPage(input),
      findReservation: (id) => reservationDal.findById(id),
      createReservation: (input, actorId) =>
        reservationWriteService.create({ ...input, createdBy: actorId }),
      updateReservation: (input) => reservationWriteService.update(input),
      deleteReservation: (id) => reservationWriteService.delete(id),
    });
  }
  if (/^locations\/[^/]+\/shipping-options(?:\/[^/]+)?$/.test(path)) {
    return handleAdminLocationShippingOptionsRequest(request, {
      authorize,
      ...locationShippingOptionsService,
    });
  }
  if (/^stock-locations\/[^/]+\/fulfillment-providers$/.test(path)) {
    return handleAdminLocationFulfillmentProvidersRequest(request, {
      authorize,
      findLocation: (id) => stockLocationDal.findById(id),
      batch: (input) => locationFulfillmentProviderService.batch(input),
    });
  }
  if (path === "sales-channels" || path.startsWith("sales-channels/")) {
    return handleAdminSalesChannelsRequest(request, path, {
      authorize,
      listSalesChannels: (input) => salesChannelDal.listPage(input),
      findSalesChannel: (id) => salesChannelDal.findById(id),
      countProducts: (ids) => salesChannelDal.countProducts(ids),
      getDefaultSalesChannelId: () => currencyDal.getDefaultSalesChannelId(),
      createSalesChannel: (input) => salesChannelWriteService.create(input),
      updateSalesChannel: (input) => salesChannelWriteService.update(input),
      deleteSalesChannels: (input) =>
        salesChannelWriteService.deleteMany(input),
      addProducts: (input) => salesChannelWriteService.addProducts(input),
      removeProducts: (input) => salesChannelWriteService.removeProducts(input),
    });
  }
  if (path === "regions" || path.startsWith("regions/")) {
    return handleAdminRegionsRequest(request, path, {
      authorize,
      listRegions: (input) => regionDal.listPage(input),
      findRegion: (id) => regionDal.findDetail(id),
      findRegions: (ids) => regionDal.findDetails(ids),
      createRegion: (input) => regionWriteService.create(input),
      updateRegion: (input) => regionWriteService.update(input),
      deleteRegions: (ids) => regionWriteService.deleteMany(ids),
    });
  }
  if (path === "stock-locations" || path.startsWith("stock-locations/")) {
    return handleAdminStockLocationsRequest(request, {
      authorize,
      listLocations: (input) => stockLocationDal.listPage(input),
      findLocation: (id) => stockLocationDal.findById(id),
      listChannelIds: (id) => stockLocationDal.listChannelIds(id),
      findSalesChannels: (ids) => salesChannelDal.findByIds(ids),
      listFulfillmentProviderIds: (id) =>
        stockLocationDal.listFulfillmentProviderIds(id),
      listFulfillmentSets: (id) => stockLocationDal.listFulfillmentSets(id),
      createLocation: (input) => stockLocationWriteService.create(input),
      updateLocation: (input) => stockLocationWriteService.update(input),
      deleteLocations: (ids) => stockLocationWriteService.deleteMany(ids),
      batchSalesChannels: (input) =>
        stockLocationWriteService.batchSalesChannels(input),
      createFulfillmentSet: (locationId, input) =>
        stockLocationWriteService.createFulfillmentSet(locationId, input),
    });
  }
  if (
    path === "shipping-profiles" ||
    path.startsWith("shipping-profiles/") ||
    path === "shipping-option-types" ||
    path.startsWith("shipping-option-types/")
  ) {
    return handleAdminShippingConfigurationRequest(request, {
      authorize,
      listProfiles: (input) => shippingProfileDal.listPage(input),
      findProfile: (id) => shippingProfileDal.findById(id),
      createProfile: (input) => shippingProfileWriteService.create(input),
      updateProfile: (input) => shippingProfileWriteService.update(input),
      deleteProfile: (id) => shippingProfileWriteService.delete(id),
      listTypes: (input) => shippingOptionTypeDal.listPage(input),
      findType: (id) => shippingOptionTypeDal.findById(id),
      createType: (input) => shippingOptionTypeWriteService.create(input),
      updateType: (input) => shippingOptionTypeWriteService.update(input),
      deleteType: (input) => shippingOptionTypeWriteService.delete(input),
    });
  }
  if (path === "customers" || path.startsWith("customers/")) {
    return handleAdminCustomersRequest(request, {
      authorize,
      listCustomers: (input) => customerDal.listPage(input),
      findCustomer: (id) => customerDal.findById(id),
      createCustomer: (input, actorId) =>
        customerWriteService.create(input, actorId),
      updateCustomer: (input) => customerWriteService.update(input),
      archiveCustomer: (id) => customerWriteService.archive([id]),
      listCustomerAddresses: (input) => customerAddressDal.listPage(input),
      findCustomerAddress: (input) => customerAddressDal.findById(input),
      createCustomerAddress: (input) =>
        customerAddressWriteService.create(input),
      updateCustomerAddress: (input) =>
        customerAddressWriteService.update(input),
      archiveCustomerAddress: (input) =>
        customerAddressWriteService.archive(input),
      batchCustomerGroups: (input) =>
        customerGroupDal.batchGroupsForCustomer(input),
    });
  }
  if (path === "customer-groups" || path.startsWith("customer-groups/")) {
    return handleAdminCustomerGroupsRequest(request, {
      authorize,
      listGroups: (input) => customerGroupDal.listPage(input),
      findGroup: (id) => customerGroupDal.findById(id),
      findActiveGroupByName: (name, excludeId) =>
        customerGroupDal.findActiveByName(name, excludeId),
      createGroup: (input) => customerGroupDal.create(input),
      updateGroup: (id, input, now) => customerGroupDal.update(id, input, now),
      archiveGroup: (id, now) => customerGroupDal.softDelete(id, now),
      listGroupMembers: (input) => customerGroupDal.listMembersPage(input),
      batchCustomersForGroup: (input) =>
        customerGroupDal.batchCustomersForGroup(input),
    });
  }
  if (path === "campaigns" || path.startsWith("campaigns/")) {
    return handleAdminCampaignsRequest(request, {
      authorize,
      listCampaigns: (input) => campaignDal.listPage(input),
      findCampaign: (id) => campaignDal.findById(id),
      createCampaign: (input) => campaignWriteService.create(input),
      updateCampaign: (id, input) => campaignWriteService.update(id, input),
      deleteCampaign: (id) => campaignWriteService.delete(id),
      managePromotions: (id, input) =>
        campaignWriteService.managePromotions(id, input),
    });
  }
  if (path === "price-lists" || path.startsWith("price-lists/")) {
    return handleAdminPriceListsRequest(request, {
      authorize,
      listPriceLists: (input) => priceListDal.listPage(input),
      findPriceList: (id) => priceListDal.findById(id),
      listPriceListPrices: (input) => priceListDal.listPricesPage(input),
      createPriceList: (input) => priceListWriteService.create(input),
      updatePriceList: (input) => priceListWriteService.updatePatch(input),
      archivePriceList: (id) => priceListWriteService.archive(id),
      batchPriceListPrices: (id, input) =>
        priceListWriteService.batchPrices(id, input),
    });
  }
  if (path === "promotions" || path.startsWith("promotions/")) {
    return handleAdminPromotionsRequest(request, {
      authorize,
      listPromotions: (input) => promotionDal.listPage(input),
      findPromotion: (id) => promotionDal.findById(id),
      createPromotion: (input, metadata) =>
        promotionWriteService.create(input, metadata),
      updatePromotion: (id, input) => promotionWriteService.update(id, input),
      deletePromotion: (id) => promotionWriteService.delete(id),
      batchRules: (id, scope, input) =>
        promotionDal.batchRules(id, scope, input),
    });
  }
  if (
    path === "products/import" ||
    path === "products/import/template" ||
    /^products\/import\/[0-9a-f-]{36}\/confirm$/i.test(path) ||
    /^workflows-executions\/import-products\/[0-9a-f-]{36}$/i.test(path)
  ) {
    const workerEnv = env as unknown as {
      R2_BUCKET?: CommerceExportR2Bucket;
      INVENTORY_EXPORT_QUEUE?: {
        send(message: {
          version: 1;
          type:
            | "inventory-export"
            | "product-export"
            | "order-export"
            | "product-import";
          transactionId: string;
          dispatchToken?: string;
        }): Promise<void>;
      };
    };
    const service = createProductImportService({
      storage: new R2ProductImportStorage(workerEnv.R2_BUCKET),
      queue: workerEnv.INVENTORY_EXPORT_QUEUE,
      applyGroup: createProductImportGroupApplier(
        getConfig().server.upload.maxAssetsPerRecord,
      ),
      findCategoriesByName: (names) => productCategoryDal.findByNames(names),
      findCategoryIds: (ids) => productCategoryDal.filterExisting(ids),
    });
    return handleAdminProductImportsRequest(request, { authorize, service });
  }
  if (
    path === "products/export" ||
    /^products\/export\/[0-9a-f-]{36}$/i.test(path) ||
    /^workflows-executions\/export-products\/[0-9a-f-]{36}$/i.test(path)
  ) {
    const workerEnv = env as unknown as {
      R2_BUCKET?: CommerceExportR2Bucket;
      INVENTORY_EXPORT_QUEUE?: {
        send(message: {
          version: 1;
          type:
            | "inventory-export"
            | "product-export"
            | "order-export"
            | "product-import";
          transactionId: string;
        }): Promise<void>;
      };
    };
    const service = createProductExportService({
      storage: new R2CommerceExportStorage(workerEnv.R2_BUCKET),
      queue: workerEnv.INVENTORY_EXPORT_QUEUE,
      listItems: (input) => productExportDal.listPage(input),
    });
    return handleAdminProductExportsRequest(request, { authorize, service });
  }
  if (path === "products" || path.startsWith("products/")) {
    return handleAdminProductsRequest(request, {
      authorize,
      maxAssets: getConfig().server.upload.maxAssetsPerRecord,
      listProducts: (input) => productDal.listPage(input),
      findProduct: (id) => productDal.findDetail(id),
      createProduct: (input, actorId) =>
        productWriteService.create(input, actorId),
      updateProduct: (input, actorId) =>
        productWriteService.update(input, actorId),
      deleteProducts: (input, actorId) =>
        productWriteService.delete(input, actorId),
      createVariant: (input, actorId) =>
        productVariantWriteService.create(input, actorId),
      updateVariant: (input, actorId) =>
        productVariantWriteService.update(input, actorId),
      updateInventoryKits: (inputs, actorId) =>
        productVariantWriteService.updateInventoryKits(inputs, actorId),
      deleteVariants: (input, actorId) =>
        productVariantWriteService.delete(input, actorId),
      findVariant: (id) => productVariantDal.findById(id),
      listVariants: (input) => productVariantDal.listPage(input),
    });
  }
  if (/^orders\/[^/]+\/(claims|exchanges)(\/|$)/.test(path)) {
    return handleAdminOrderClaimsExchangesRequest(request, {
      authorize,
      hasNotificationEmail: (orderId) =>
        hasOrderChangeNotificationEmail(orderId),
      notifyClaim: (input) => notifyOrderClaimCreated(input),
      notifyExchange: (input) => notifyOrderExchangeCreated(input),
      listClaims: (orderId) => orderReturnDal.listClaims(orderId),
      listExchanges: (orderId) => orderReturnDal.listExchanges(orderId),
      createRefundClaim: (input) => orderReturnDal.createRefundClaim(input),
      createReplacementClaim: (input) =>
        orderReturnDal.createReplacementClaim(input),
      createExchange: (input) => orderReturnDal.createExchange(input),
      cancelExchange: (input) => orderReturnDal.cancelExchange(input),
    });
  }
  if (
    path === "returns" ||
    path.startsWith("returns/") ||
    /^orders\/[^/]+\/returns$/.test(path)
  ) {
    return handleAdminReturnsRequest(request, {
      authorize,
      listReturns: (input) => orderReturnDal.listPage(input),
      findReturn: (id) => orderReturnDal.findById(id),
      createReturn: ({ createdBy, ...input }) =>
        orderReturnDal.create({ ...input, createdBy }),
      receiveReturn: (input) => orderReturnDal.receive(input),
      cancelReturn: (input) => orderReturnDal.cancel(input),
    });
  }
  if (
    path === "orders/export" ||
    /^orders\/export\/[0-9a-f-]{36}$/i.test(path) ||
    /^workflows-executions\/export-orders\/[0-9a-f-]{36}$/i.test(path)
  ) {
    const workerEnv = env as unknown as {
      R2_BUCKET?: CommerceExportR2Bucket;
      INVENTORY_EXPORT_QUEUE?: {
        send(message: {
          version: 1;
          type:
            | "inventory-export"
            | "product-export"
            | "order-export"
            | "product-import";
          transactionId: string;
        }): Promise<void>;
      };
    };
    const service = createOrderExportService({
      storage: new R2CommerceExportStorage(workerEnv.R2_BUCKET),
      queue: workerEnv.INVENTORY_EXPORT_QUEUE,
      listItems: (input) => orderExportDal.listPage(input),
    });
    return handleAdminOrderExportsRequest(request, { authorize, service });
  }
  if (path === "draft-orders" || path.startsWith("draft-orders/")) {
    return handleAdminDraftOrdersRequest(request, {
      authorize,
      listDraftOrders: (input) =>
        orderDal.listPage({ ...input, isDraftOrder: true }),
      findOrder: (id) => orderDal.findById(id),
      resolveRegionCurrencyCode: async (regionId) =>
        (await regionDal.findDetail(regionId))?.currencyCode ?? null,
      listItems: async (orderId) =>
        (await orderDal.listItemsPage({ orderId, page: 1, limit: 100 })).items,
      listShippingMethods: async (orderId) =>
        (await orderDal.findDraftShippingContext(orderId))
          ?.selectedShippingMethods ?? [],
      getDraftOrderEdit: (orderId) => draftOrderEditDal.get(orderId),
      createDraftOrder,
      updateDraftOrder: (input) =>
        orderDal.updateDraftFields(input.id, input.expectedUpdatedAt, {
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.noNotification !== undefined
            ? { noNotification: input.noNotification }
            : {}),
        }),
      updateDraftOrderEditFields: (input) => updateDraftOrderEditFields(input),
      deleteDraftOrder: (id, expectedUpdatedAt) =>
        orderDal.deleteDraftOrder(id, expectedUpdatedAt),
      convertDraftOrder: (id) => convertDraftOrderAndNotifyCustomer(id),
      beginDraftOrderEdit: (input) => beginDraftOrderEdit(input),
      addDraftOrderEditItems: (orderId, items) =>
        draftOrderEditDal.addItems(orderId, items),
      updateDraftOrderEditItem: (input) => draftOrderEditDal.updateItem(input),
      updateDraftOrderEditAction: (input) =>
        draftOrderEditDal.updateAddedItem(input),
      removeDraftOrderEditItem: (input) => draftOrderEditDal.removeItem(input),
      removeDraftOrderEditAction: (input) =>
        draftOrderEditDal.removeAction(input),
      addDraftOrderEditPromotions: (orderId, codes) =>
        addDraftOrderEditPromotions({ orderId, codes }),
      removeDraftOrderEditPromotions: (orderId, codes) =>
        removeDraftOrderEditPromotions({ orderId, codes }),
      addDraftOrderEditShippingMethod: (input) =>
        addDraftOrderEditShippingMethod(input),
      updateDraftOrderEditShippingMethod: (input) =>
        updateDraftOrderEditShippingMethod(input),
      updateDraftOrderEditShippingAction: (input) =>
        updateDraftOrderEditShippingAction(input),
      removeDraftOrderEditShippingMethod: (input) =>
        removeDraftOrderEditShippingMethod(input),
      removeDraftOrderEditShippingAction: (input) =>
        removeDraftOrderEditShippingAction(input),
      requestDraftOrderEdit: ({ orderId, actorId }) =>
        draftOrderEditDal.request(orderId, actorId),
      cancelDraftOrderEdit: ({ orderId, actorId }) =>
        draftOrderEditDal.cancel(orderId, actorId),
      confirmDraftOrderEdit: (input) => confirmDraftOrderEdit(input),
    });
  }
  if (/^orders\/[^/]+\/edit(?:\/confirm)?$/.test(path)) {
    const response = await handleAdminOrderEditsRequest(request, {
      authorize,
      get: (orderId) => orderEditRequestDal.get(orderId),
      request: (input) => orderEditService.request(input),
      cancel: (input) => orderEditRequestDal.cancel(input),
      confirm: (input) => orderEditService.confirm(input),
    });
    return (
      response ??
      new Response(
        JSON.stringify({
          error: "NOT_FOUND",
          message: "Order edit route not found",
        }),
        {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      )
    );
  }
  return handleAdminOrdersRequest(request, {
    authorize,
    listOrders: (input) => orderDal.listPage(input),
    findOrder: (id) => orderDal.findById(id),
    cancelOrder: (id, actorId) => orderWorkflowDal.cancel(id, actorId),
    listOrderFulfillments: (input) => orderDal.listFulfillmentsPage(input),
    findOrderFulfillment: async (input) => {
      const result = await orderDal.listFulfillmentsPage({
        ...input,
        page: 1,
        limit: 1,
      });
      return result.fulfillments[0] ?? null;
    },
    createFulfillment: (input, createdBy) =>
      orderFulfillmentDal.create({
        ...input,
        ...(createdBy ? { createdBy } : {}),
      }),
    cancelFulfillment: ({ orderId, fulfillmentId }) =>
      orderFulfillmentDal.cancel(fulfillmentId, orderId),
    markFulfillmentShipped: ({ orderId, fulfillmentId, actorId, labels }) =>
      orderFulfillmentDal.markShipped(fulfillmentId, actorId, orderId, labels),
    markFulfillmentDelivered: ({ orderId, fulfillmentId }) =>
      orderFulfillmentDal.markDelivered(fulfillmentId, orderId),
  });
};

export const Route = createFileRoute("/_backend/api/admin/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
