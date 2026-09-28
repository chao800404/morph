import type {
  RegionCountryDTO,
  RegionDTO,
  RegionInsertDTO,
  UpdateRegionDTO,
} from "@/lib/region/dto/region.dto";
import { regionDal } from "@/lib/region/dal/region.dal";
import type {
  createRegionInputSchema,
  updateRegionInputSchema,
} from "@/lib/validations/region";
import type { z } from "zod";

export type CreateRegionInput = z.infer<typeof createRegionInputSchema>;
export type UpdateRegionInput = z.infer<typeof updateRegionInputSchema>;

export type RegionWriteErrorCode =
  "NOT_FOUND" | "COUNTRY_TAKEN" | "PROVIDER_UNAVAILABLE";

export type RegionWriteResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: RegionWriteErrorCode;
      message: string;
      errors?: Record<string, string[]>;
    };

type RegionWriteDependencies = {
  ensureCountryCatalog(): Promise<void>;
  listAssignableCountries(regionId: string | null): Promise<RegionCountryDTO[]>;
  listEnabledPaymentProviders(): Promise<Array<{ id: string }>>;
  findById(id: string): Promise<RegionDTO | null>;
  findByIds(ids: string[]): Promise<RegionDTO[]>;
  createWithAssociations(
    input: RegionInsertDTO & {
      countries: string[];
      paymentProviderIds: string[];
    },
  ): Promise<void>;
  updateWithAssociations(
    id: string,
    input: {
      region: UpdateRegionDTO;
      countries?: string[];
      paymentProviderIds?: string[];
    },
  ): Promise<void>;
  softDelete(ids: string[]): Promise<void>;
};

const failed = (
  error: RegionWriteErrorCode,
  message: string,
  errors?: Record<string, string[]>,
): RegionWriteResult<never> => ({
  success: false,
  error,
  message,
  ...(errors ? { errors } : {}),
});

/**
 * Keep region writes shared by the dashboard Server Functions and Admin REST
 * API. The service validates all cross-module references before mutating the
 * region or its associations.
 */
export const createRegionWriteService = (
  dependencies: RegionWriteDependencies,
  createId: () => string = () => crypto.randomUUID(),
) => ({
  async create(
    input: CreateRegionInput,
  ): Promise<RegionWriteResult<{ id: string }>> {
    await dependencies.ensureCountryCatalog();

    const countries = [...new Set(input.countries)];
    const paymentProviderIds = [...new Set(input.paymentProviderIds)];
    const [assignableCountries, enabledProviders] = await Promise.all([
      dependencies.listAssignableCountries(null),
      dependencies.listEnabledPaymentProviders(),
    ]);
    const availableCountries = new Set(
      assignableCountries.map((country) => country.iso2),
    );
    const takenCountries = countries.filter(
      (code) => !availableCountries.has(code),
    );
    if (takenCountries.length > 0) {
      return failed(
        "COUNTRY_TAKEN",
        `${takenCountries.join(", ").toUpperCase()} already belongs to another region`,
        { countries: ["Already served by another region"] },
      );
    }

    const availableProviders = new Set(
      enabledProviders.map((provider) => provider.id),
    );
    if (paymentProviderIds.some((id) => !availableProviders.has(id))) {
      return failed(
        "PROVIDER_UNAVAILABLE",
        "One or more payment providers are unavailable",
        { paymentProviderIds: ["Select an enabled payment provider"] },
      );
    }

    const id = createId();
    await dependencies.createWithAssociations({
      id,
      name: input.name,
      currencyCode: input.currencyCode,
      automaticTaxes: input.automaticTaxes,
      isTaxInclusive: input.isTaxInclusive,
      metadata: input.metadata,
      countries,
      paymentProviderIds,
    });
    return { success: true, data: { id } };
  },

  async update(
    input: UpdateRegionInput,
  ): Promise<RegionWriteResult<{ id: string }>> {
    const existing = await dependencies.findById(input.id);
    if (!existing) return failed("NOT_FOUND", "Region not found");

    let countries: string[] | undefined;
    if (input.countries !== undefined) {
      await dependencies.ensureCountryCatalog();
      countries = [...new Set(input.countries)];
      const assignable = await dependencies.listAssignableCountries(input.id);
      const availableCountries = new Set(
        assignable.map((country) => country.iso2),
      );
      const takenCountries = countries.filter(
        (code) => !availableCountries.has(code),
      );
      if (takenCountries.length > 0) {
        return failed(
          "COUNTRY_TAKEN",
          `${takenCountries.join(", ").toUpperCase()} already belongs to another region`,
          { countries: ["Already served by another region"] },
        );
      }
    }

    let paymentProviderIds: string[] | undefined;
    if (input.paymentProviderIds !== undefined) {
      paymentProviderIds = [...new Set(input.paymentProviderIds)];
      const availableProviders = new Set(
        (await dependencies.listEnabledPaymentProviders()).map(
          (provider) => provider.id,
        ),
      );
      if (paymentProviderIds.some((id) => !availableProviders.has(id))) {
        return failed(
          "PROVIDER_UNAVAILABLE",
          "One or more payment providers are unavailable",
          { paymentProviderIds: ["Select an enabled payment provider"] },
        );
      }
    }

    await dependencies.updateWithAssociations(input.id, {
      region: {
        name: input.name,
        currencyCode: input.currencyCode,
        automaticTaxes: input.automaticTaxes,
        isTaxInclusive: input.isTaxInclusive,
        metadata: input.metadata,
      },
      ...(countries !== undefined ? { countries } : {}),
      ...(paymentProviderIds !== undefined ? { paymentProviderIds } : {}),
    });
    return { success: true, data: { id: input.id } };
  },

  async deleteMany(
    ids: string[],
  ): Promise<RegionWriteResult<{ deleted: number }>> {
    const existing = await dependencies.findByIds(ids);
    if (existing.length === 0) {
      return failed("NOT_FOUND", "No matching regions were found");
    }
    const existingIds = existing.map((region) => region.id);
    await dependencies.softDelete(existingIds);
    return { success: true, data: { deleted: existingIds.length } };
  },
});

export const regionWriteService = createRegionWriteService({
  ensureCountryCatalog: () => regionDal.ensureCountryCatalog(),
  listAssignableCountries: (id) => regionDal.listAssignableCountries(id),
  listEnabledPaymentProviders: () => regionDal.listEnabledPaymentProviders(),
  findById: (id) => regionDal.findById(id),
  findByIds: (ids) => regionDal.findByIds(ids),
  createWithAssociations: (input) => regionDal.createWithAssociations(input),
  updateWithAssociations: (id, input) =>
    regionDal.updateWithAssociations(id, input),
  softDelete: (ids) => regionDal.softDelete(ids),
});
