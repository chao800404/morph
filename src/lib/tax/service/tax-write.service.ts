import { taxDal } from "@/lib/tax/dal/tax.dal";
import type {
  TaxRateDTO,
  TaxRateRuleReference,
  TaxRegionDTO,
} from "@/lib/tax/dto/tax.dto";
import { taxProviderRegistry } from "@/lib/tax/providers/tax-provider-registry.server";
import type {
  createTaxProvinceInputSchema,
  createTaxRateInputSchema,
  createTaxRegionInputSchema,
  updateTaxRateInputSchema,
  updateTaxRegionInputSchema,
} from "@/lib/validations/tax";
import { getConfig } from "@/server/get-config";
import type { z } from "zod";

export type CreateTaxRegionInput = z.infer<typeof createTaxRegionInputSchema>;
export type CreateTaxProvinceInput = z.infer<
  typeof createTaxProvinceInputSchema
>;
export type CreateTaxRateInput = z.infer<typeof createTaxRateInputSchema>;
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateInputSchema>;
export type UpdateTaxRegionInput = z.infer<typeof updateTaxRegionInputSchema>;

export type TaxWriteErrorCode =
  | "NOT_FOUND"
  | "INVALID_REGION_LEVEL"
  | "COUNTRY_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "DUPLICATE_PROVINCE"
  | "INVALID_RULE_TARGETS"
  | "INVALID_RULES";

export type TaxWriteResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: TaxWriteErrorCode;
      message: string;
      errors?: Record<string, string[]>;
    };

type TaxWriteDependencies = {
  prepareProviders(): Promise<void>;
  listAvailableCountries(): Promise<Array<{ code: string; name: string }>>;
  listProviders(): Promise<Array<{ id: string }>>;
  findRegion(id: string): Promise<TaxRegionDTO | null>;
  findRegions(ids: string[]): Promise<TaxRegionDTO[]>;
  provinceCodeExists(parentId: string, provinceCode: string): Promise<boolean>;
  createRegion(input: {
    id: string;
    countryCode: string;
    provinceCode?: string | null;
    parentId?: string | null;
    providerId?: string | null;
    createdBy?: string | null;
    metadata?: TaxRegionDTO["metadata"];
    defaultTaxRate?: {
      name: string;
      code: string;
      rate: number | null;
      isCombinable: boolean;
    };
  }): Promise<void>;
  updateRegion(
    id: string,
    input: { providerId?: string | null; metadata?: TaxRegionDTO["metadata"] },
  ): Promise<void>;
  softDeleteRegions(ids: string[]): Promise<void>;
  findRate(id: string): Promise<TaxRateDTO | null>;
  findRates(ids: string[]): Promise<TaxRateDTO[]>;
  ruleTargetsExist(
    rules: Array<{ reference: TaxRateRuleReference; referenceId: string }>,
  ): Promise<boolean>;
  createRate(input: {
    id: string;
    taxRegionId: string;
    name: string;
    code: string;
    rate: number | null;
    isDefault: boolean;
    isCombinable: boolean;
    createdBy?: string | null;
    metadata?: TaxRateDTO["metadata"];
    rules?: Array<{
      reference: TaxRateRuleReference;
      referenceId: string;
    }>;
  }): Promise<void>;
  updateRate(
    id: string,
    taxRegionId: string,
    input: {
      name?: string;
      code?: string;
      rate?: number | null;
      isDefault?: boolean;
      isCombinable?: boolean;
      metadata?: TaxRateDTO["metadata"];
      rules?: Array<{
        reference: TaxRateRuleReference;
        referenceId: string;
      }>;
    },
  ): Promise<void>;
  softDeleteRates(ids: string[]): Promise<void>;
};

const failed = (
  error: TaxWriteErrorCode,
  message: string,
  errors?: Record<string, string[]>,
): TaxWriteResult<never> => ({
  success: false,
  error,
  message,
  ...(errors ? { errors } : {}),
});

/** Shared write path for Dashboard tax settings and the Medusa-shaped Admin API. */
export const createTaxWriteService = (
  dependencies: TaxWriteDependencies,
  createId: () => string = () => crypto.randomUUID(),
) => ({
  async listProviders() {
    await dependencies.prepareProviders();
    return dependencies.listProviders();
  },

  async createRegion(
    input: CreateTaxRegionInput,
    createdBy?: string,
  ): Promise<TaxWriteResult<{ id: string }>> {
    await dependencies.prepareProviders();
    const availableCountries = new Set(
      (await dependencies.listAvailableCountries()).map(
        (country) => country.code,
      ),
    );
    if (!availableCountries.has(input.countryCode))
      return failed(
        "COUNTRY_UNAVAILABLE",
        "A tax region already exists for this country",
        { countryCode: ["Select a country without a tax region"] },
      );

    const providers = new Set(
      (await dependencies.listProviders()).map((provider) => provider.id),
    );
    if (!providers.has(input.providerId))
      return failed("PROVIDER_UNAVAILABLE", "Tax provider is unavailable", {
        providerId: ["Select an enabled provider"],
      });

    const id = createId();
    try {
      await dependencies.createRegion({
        id,
        countryCode: input.countryCode,
        providerId: input.providerId,
        createdBy,
        metadata: input.metadata,
        defaultTaxRate: input.defaultTaxRate,
      });
    } catch (error) {
      // The partial unique index is the final guard against concurrent region
      // creation. Translate that race to the same field error as the precheck.
      if (
        !(await dependencies.listAvailableCountries()).some(
          ({ code }) => code === input.countryCode,
        )
      )
        return failed(
          "COUNTRY_UNAVAILABLE",
          "A tax region already exists for this country",
          { countryCode: ["Select a country without a tax region"] },
        );
      throw error;
    }
    return { success: true, data: { id } };
  },

  async createProvince(
    input: CreateTaxProvinceInput,
    createdBy?: string,
  ): Promise<TaxWriteResult<{ id: string }>> {
    const parent = await dependencies.findRegion(input.parentId);
    if (!parent || parent.parentId)
      return failed("NOT_FOUND", "Parent tax region not found");
    if (await dependencies.provinceCodeExists(parent.id, input.provinceCode))
      return failed(
        "DUPLICATE_PROVINCE",
        "This province tax region already exists",
        { provinceCode: ["Province code must be unique"] },
      );
    const id = createId();
    try {
      await dependencies.createRegion({
        id,
        countryCode: parent.countryCode,
        provinceCode: input.provinceCode,
        parentId: parent.id,
        providerId: null,
        createdBy,
        metadata: input.metadata,
        defaultTaxRate: input.defaultTaxRate,
      });
    } catch (error) {
      if (await dependencies.provinceCodeExists(parent.id, input.provinceCode))
        return failed(
          "DUPLICATE_PROVINCE",
          "This province tax region already exists",
          { provinceCode: ["Province code must be unique"] },
        );
      throw error;
    }
    return { success: true, data: { id } };
  },

  async updateRegion(
    input: UpdateTaxRegionInput,
  ): Promise<TaxWriteResult<{ id: string }>> {
    await dependencies.prepareProviders();
    const region = await dependencies.findRegion(input.id);
    if (!region) return failed("NOT_FOUND", "Tax region not found");
    if (region.parentId)
      return failed(
        "INVALID_REGION_LEVEL",
        "Province and state tax regions inherit their provider and cannot be edited directly",
      );
    if (input.providerId) {
      const providers = new Set(
        (await dependencies.listProviders()).map((provider) => provider.id),
      );
      if (!providers.has(input.providerId))
        return failed("PROVIDER_UNAVAILABLE", "Tax provider is unavailable", {
          providerId: ["Select an enabled provider"],
        });
    }
    await dependencies.updateRegion(input.id, {
      providerId: input.providerId,
      metadata: input.metadata,
    });
    return { success: true, data: { id: input.id } };
  },

  async deleteRegions(
    ids: string[],
  ): Promise<TaxWriteResult<{ deleted: number }>> {
    const regions = await dependencies.findRegions([...new Set(ids)]);
    if (!regions.length)
      return failed("NOT_FOUND", "No matching tax regions were found");
    const activeIds = regions.map(({ id }) => id);
    await dependencies.softDeleteRegions(activeIds);
    return { success: true, data: { deleted: activeIds.length } };
  },

  async createRate(
    input: CreateTaxRateInput,
    createdBy?: string,
  ): Promise<TaxWriteResult<{ id: string }>> {
    if (!(await dependencies.findRegion(input.taxRegionId)))
      return failed("NOT_FOUND", "Tax region not found");
    if (!(await dependencies.ruleTargetsExist(input.rules)))
      return failed(
        "INVALID_RULE_TARGETS",
        "One or more tax rule targets no longer exist",
        {
          rules: ["Refresh the page and select active targets"],
        },
      );
    if (input.isDefault && input.rules.length)
      return failed(
        "INVALID_RULES",
        "A default tax rate cannot have target rules",
        {
          rules: ["Default tax rates cannot have target rules"],
        },
      );
    if (!input.isDefault && !input.rules.length)
      return failed(
        "INVALID_RULES",
        "An override must target at least one item",
        {
          rules: ["Select at least one active target"],
        },
      );
    const id = createId();
    await dependencies.createRate({ ...input, id, createdBy });
    return { success: true, data: { id } };
  },

  async updateRate(
    input: UpdateTaxRateInput,
  ): Promise<TaxWriteResult<{ id: string }>> {
    const existing = await dependencies.findRate(input.id);
    if (!existing || existing.taxRegionId !== input.taxRegionId)
      return failed("NOT_FOUND", "Tax rate not found");

    const effectiveIsDefault = input.isDefault ?? existing.isDefault;
    const existingRules = existing.rules.map(({ reference, referenceId }) => ({
      reference,
      referenceId,
    }));
    const effectiveRules =
      input.rules ?? (input.isDefault === true ? [] : existingRules);
    if (effectiveIsDefault && effectiveRules.length)
      return failed(
        "INVALID_RULES",
        "A default tax rate cannot have target rules",
        {
          rules: ["Default tax rates cannot have target rules"],
        },
      );
    if (!effectiveIsDefault && !effectiveRules.length)
      return failed(
        "INVALID_RULES",
        "An override must target at least one item",
        {
          rules: ["Select at least one active target"],
        },
      );
    if (input.rules && !(await dependencies.ruleTargetsExist(input.rules)))
      return failed(
        "INVALID_RULE_TARGETS",
        "One or more tax rule targets no longer exist",
        {
          rules: ["Refresh the page and select active targets"],
        },
      );

    const rules = input.rules ?? (input.isDefault === true ? [] : undefined);
    await dependencies.updateRate(input.id, input.taxRegionId, {
      name: input.name,
      code: input.code,
      rate: input.rate,
      isDefault: input.isDefault,
      isCombinable: input.isCombinable,
      metadata: input.metadata,
      rules,
    });
    return { success: true, data: { id: input.id } };
  },

  async deleteRates(
    ids: string[],
  ): Promise<TaxWriteResult<{ deleted: number }>> {
    const rates = await dependencies.findRates([...new Set(ids)]);
    if (!rates.length)
      return failed("NOT_FOUND", "No matching tax rates were found");
    const activeIds = rates.map(({ id }) => id);
    await dependencies.softDeleteRates(activeIds);
    return { success: true, data: { deleted: activeIds.length } };
  },
});

export const taxWriteService = createTaxWriteService({
  prepareProviders: async () => {
    getConfig();
    await taxDal.ensureProviders(taxProviderRegistry.list());
  },
  listAvailableCountries: () => taxDal.listAvailableCountries(),
  listProviders: () => taxDal.listProviders(),
  findRegion: (id) => taxDal.findRegion(id),
  findRegions: (ids) => taxDal.findRegions(ids),
  provinceCodeExists: (parentId, code) =>
    taxDal.provinceCodeExists(parentId, code),
  createRegion: (input) => taxDal.createRegion(input),
  updateRegion: (id, input) => taxDal.updateRegion(id, input),
  softDeleteRegions: (ids) => taxDal.softDeleteRegions(ids),
  findRate: (id) => taxDal.findRate(id),
  findRates: (ids) => taxDal.findRates(ids),
  ruleTargetsExist: (rules) => taxDal.ruleTargetsExist(rules),
  createRate: (input) => taxDal.createRate(input),
  updateRate: (id, taxRegionId, input) =>
    taxDal.updateRate(id, taxRegionId, input),
  softDeleteRates: (ids) => taxDal.softDeleteRates(ids),
});
